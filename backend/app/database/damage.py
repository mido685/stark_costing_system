# app/database/damage.py
"""
Damage log — records physical damage to ingredients or finished goods.

Key design decisions:
- Deleting a damage record creates a COMPENSATING inventory movement
  (positive quantity_delta) rather than hard-deleting the original movement.
  This preserves the audit trail while correctly restoring stock.
- reason is validated against DAMAGE_REASONS at the Python layer so the
  error message is clear before the DB constraint fires.
- unit_cost and cost_value are always floated before return so callers
  never receive raw Decimal objects.
"""
from __future__ import annotations
from .system_logger import log_event


from typing import Any

from .connection import get_connection, dict_cursor
from .log_audit import log_audit
from .periods import is_period_frozen
from .waste import (
    _ensure_single_item,
    _get_finished_good_unit_cost,
    _get_ingredient_unit_cost,
)


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

# Mirrors the damage_log.reason column — free-text up to 80 chars in the DB,
# but we enforce a controlled vocabulary at the application layer.
DAMAGE_REASONS = frozenset({
    "damage",
    "fire",
    "flood",
    "theft",
    "pest",
    "equipment_failure",
    "other",
})


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _floatify(value: Any) -> Any:
    return float(value) if hasattr(value, "__round__") and not isinstance(value, int) else value


def _row(row: dict[str, Any]) -> dict[str, Any]:
    return {k: _floatify(v) for k, v in row.items()}


def _verify_branch(cur, branch_id: int, company_id: int) -> None:
    """Raise ValueError if branch does not belong to company."""
    cur.execute(
        "SELECT id FROM branches WHERE id = %s AND company_id = %s AND is_active = TRUE",
        (branch_id, company_id),
    )
    if not cur.fetchone():
        raise ValueError("Branch not found or access denied")


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def list_damage(
    company_id: int,
    branch_id: int | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """
    List damage records for a company, optionally filtered by branch.
    Returns floated numeric fields and convenience columns:
      item_name  — product_name if a finished good, otherwise ingredient_name
      unit       — the item's unit of measure
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        conditions = ["b.company_id = %s"]
        params: list[Any] = [company_id]
        if branch_id:
            conditions.append("d.branch_id = %s")
            params.append(branch_id)

        cur.execute(f"""
            SELECT
                d.*,
                b.name                              AS branch_name,
                i.name                              AS ingredient_name,
                i.unit                              AS ingredient_unit,
                p.name                              AS product_name,
                p.unit                              AS product_unit,
                COALESCE(p.name, i.name)            AS item_name,
                COALESCE(p.unit, i.unit)            AS unit
            FROM damage_log d
            JOIN branches    b ON b.id = d.branch_id
            LEFT JOIN ingredients i ON i.id = d.ingredient_id
            LEFT JOIN products    p ON p.id = d.product_id
            WHERE {' AND '.join(conditions)}
            ORDER BY d.entry_date DESC, d.id DESC
            LIMIT %s
        """, params + [limit])
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def get_damage(damage_id: int, company_id: int) -> dict[str, Any] | None:
    """
    Fetch a single damage record. Returns None if not found or belongs
    to a different company (tenant isolation via branch → company chain).
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT
                d.*,
                b.name                              AS branch_name,
                i.name                              AS ingredient_name,
                i.unit                              AS ingredient_unit,
                p.name                              AS product_name,
                p.unit                              AS product_unit,
                COALESCE(p.name, i.name)            AS item_name,
                COALESCE(p.unit, i.unit)            AS unit
            FROM damage_log d
            JOIN branches    b ON b.id = d.branch_id
            LEFT JOIN ingredients i ON i.id = d.ingredient_id
            LEFT JOIN products    p ON p.id = d.product_id
            WHERE d.id = %s AND b.company_id = %s
        """, (damage_id, company_id))
        row = cur.fetchone()
        return _row(dict(row)) if row else None
    finally:
        cur.close()
        conn.close()


def add_damage(
    branch_id: int,
    entry_date: str,
    quantity: float,
    reason: str,
    company_id: int,
    user_id: int,
    ingredient_id: int | None = None,
    product_id: int | None = None,
    notes: str = "",
    ip_address: str | None = None,
) -> dict[str, Any]:
    """
    Record physical damage to an ingredient or finished good.

    Exactly one of ingredient_id / product_id must be supplied.
    quantity must be > 0.
    reason must be in DAMAGE_REASONS.

    Side effects (all in one transaction):
      - Inserts a damage_log row
      - Inserts a negative inventory_movements row (ingredient)
        OR a negative finished_goods_movements row (product)
    """
    # ── Input validation ─────────────────────────────────────────────────────
    _ensure_single_item(ingredient_id, product_id)
    if quantity <= 0:
        raise ValueError("quantity must be greater than zero")
    if reason not in DAMAGE_REASONS:
        raise ValueError(
            f"reason must be one of: {', '.join(sorted(DAMAGE_REASONS))}"
        )
    if is_period_frozen(branch_id, entry_date):
        raise ValueError("This accounting period is closed for the selected branch")

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)

        # ── Determine cost ────────────────────────────────────────────────────
        if ingredient_id:
            unit_cost = _get_ingredient_unit_cost(cur, ingredient_id, company_id)
        else:
            unit_cost = _get_finished_good_unit_cost(
                cur, branch_id, int(product_id), company_id  # type: ignore[arg-type]
            )
        cost_value = round(unit_cost * quantity, 2)

        # ── Insert damage_log ─────────────────────────────────────────────────
        cur.execute("""
            INSERT INTO damage_log
                (branch_id, ingredient_id, product_id,
                 entry_date, quantity, reason, cost_value, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (
            branch_id,
            ingredient_id, product_id,
            entry_date, quantity, reason, cost_value, notes,
        ))
        damage = _row(dict(cur.fetchone()))
        damage_id = damage["id"]

        # ── Insert movement (negative = stock leaves) ─────────────────────────
        if ingredient_id:
            cur.execute("""
                INSERT INTO inventory_movements
                    (branch_id, ingredient_id, movement_type, entry_date,
                     quantity_delta, unit_cost,
                     reference_table, reference_id, notes)
                VALUES (%s, %s, 'damage', %s, %s, %s, 'damage_log', %s, %s)
            """, (
                branch_id, ingredient_id, entry_date,
                -quantity, unit_cost, damage_id, notes,
            ))
        else:
            cur.execute("""
                INSERT INTO finished_goods_movements
                    (branch_id, product_id, movement_type, entry_date,
                     quantity_delta, unit_cost,
                     reference_table, reference_id, notes)
                VALUES (%s, %s, 'damage', %s, %s, %s, 'damage_log', %s, %s)
            """, (
                branch_id, product_id, entry_date,
                -quantity, unit_cost, damage_id, notes,
            ))

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            branch_id=branch_id,          # was missing in v2
            action="CREATE",
            table_name="damage_log",
            record_id=damage_id,
            new_data=damage,
            ip_address=ip_address,
        )
        log_event(
            conn,
            company_id=company_id,
            user_id=user_id,
            branch_id=branch_id,
            action="created",
            category="data",
            entity_type="damage_log",
            entity_id=damage_id,
            payload={
                "ingredient_id": ingredient_id,
                "product_id":    product_id,
                "quantity":      quantity,
                "reason":        reason,
                "unit_cost":     unit_cost,
                "cost_value":    cost_value,
            },
            ip_address=ip_address,
        )
        conn.commit()
        return damage

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def delete_damage(
    damage_id: int,
    company_id: int,
    user_id: int,
    ip_address: str | None = None,
) -> None:
    """
    Soft-reverse a damage record by inserting COMPENSATING movements
    rather than deleting the original movements.

    Why compensating entries instead of hard deletes:
    - Preserves the complete audit trail in inventory_movements /
      finished_goods_movements — no gaps in the ledger.
    - The damage_log row itself is hard-deleted (it was a mistake),
      but the stock effect is cleanly reversed with a matching positive
      movement tagged back to the same damage_id.
    - Period closure is checked so closed-period records cannot be reversed.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        # Fetch and lock the record, enforcing tenant isolation
        cur.execute("""
            SELECT d.*
            FROM damage_log d
            JOIN branches b ON b.id = d.branch_id
            WHERE d.id = %s AND b.company_id = %s
            FOR UPDATE
        """, (damage_id, company_id))
        old = cur.fetchone()
        if not old:
            raise ValueError("Damage record not found or access denied")
        old = dict(old)

        if is_period_frozen(old["branch_id"], str(old["entry_date"])):
            raise ValueError(
                "Cannot delete — the accounting period for this entry is closed"
            )

        # ── Insert compensating movement (restores stock) ─────────────────────
        unit_cost  = float(old.get("cost_value") or 0) / float(old["quantity"]) \
                     if old["quantity"] else 0.0
        reversal_note = f"Reversal of damage_log #{damage_id}"

        if old["ingredient_id"]:
            cur.execute("""
                INSERT INTO inventory_movements
                    (branch_id, ingredient_id, movement_type, entry_date,
                     quantity_delta, unit_cost,
                     reference_table, reference_id, notes)
                VALUES (%s, %s, 'adjustment', %s, %s, %s,
                        'damage_log', %s, %s)
            """, (
                old["branch_id"], old["ingredient_id"], old["entry_date"],
                float(old["quantity"]), unit_cost,
                damage_id, reversal_note,
            ))
        elif old["product_id"]:
            cur.execute("""
                INSERT INTO finished_goods_movements
                    (branch_id, product_id, movement_type, entry_date,
                     quantity_delta, unit_cost,
                     reference_table, reference_id, notes)
                VALUES (%s, %s, 'adjustment', %s, %s, %s,
                        'damage_log', %s, %s)
            """, (
                old["branch_id"], old["product_id"], old["entry_date"],
                float(old["quantity"]), unit_cost,
                damage_id, reversal_note,
            ))

        # ── Hard-delete the damage_log row ────────────────────────────────────
        cur.execute("DELETE FROM damage_log WHERE id = %s", (damage_id,))

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            branch_id=old["branch_id"],
            action="DELETE",
            table_name="damage_log",
            record_id=damage_id,
            old_data=old,
            ip_address=ip_address,
        )
        log_event(
            conn,
            company_id=company_id,
            user_id=user_id,
            branch_id=old["branch_id"],
            action="deleted",
            category="data",
            level="warning",
            entity_type="damage_log",
            entity_id=damage_id,
            payload={
                "ingredient_id": old["ingredient_id"],
                "product_id":    old["product_id"],
                "quantity":      float(old["quantity"]),
                "reason":        old["reason"],
                "cost_value":    float(old["cost_value"] or 0),
                "entry_date":    str(old["entry_date"]),
                "reversal":      True,
            },
            ip_address=ip_address,
        )
        conn.commit()

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def get_damage_summary(
    company_id: int,
    branch_id: int | None = None,
) -> list[dict[str, Any]]:
    """
    Aggregate damage cost and incident count by reason.
    Mirrors get_waste_summary in reports.py for dashboard parity.
    Was missing from both the original database.py and v2.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        conditions = ["b.company_id = %s"]
        params: list[Any] = [company_id]
        if branch_id:
            conditions.append("d.branch_id = %s")
            params.append(branch_id)

        cur.execute(f"""
            SELECT
                d.reason,
                COUNT(*)                       AS incidents,
                COALESCE(SUM(d.quantity),   0) AS total_qty,
                COALESCE(SUM(d.cost_value), 0) AS total_cost
            FROM damage_log d
            JOIN branches b ON b.id = d.branch_id
            WHERE {' AND '.join(conditions)}
            GROUP BY d.reason
            ORDER BY total_cost DESC
        """, params)
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()