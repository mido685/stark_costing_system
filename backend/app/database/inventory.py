from __future__ import annotations

from typing import Any

from .connection import get_connection, dict_cursor
from .log_audit import log_audit
from .periods import is_period_closed


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _row(row: dict[str, Any]) -> dict[str, Any]:
    """Coerce Decimal columns to float for JSON serialisation."""
    return {
        k: float(v) if hasattr(v, "__round__") and not isinstance(v, int) else v
        for k, v in row.items()
    }


def _verify_branch(cur, branch_id: int, company_id: int) -> None:
    cur.execute(
        "SELECT id FROM branches WHERE id = %s AND company_id = %s",
        (branch_id, company_id),
    )
    if not cur.fetchone():
        raise ValueError("Branch not found or access denied")


def _ingredient_weighted_avg_cost(cur, ingredient_id: int, branch_id: int) -> float:
    """
    Weighted-average cost based on approved GRN movements for this branch.
    Falls back to master cost_per_unit if no GRN movements exist yet.
    """
    cur.execute(
        """
        SELECT
            CASE
                WHEN SUM(quantity_delta) FILTER (WHERE quantity_delta > 0) > 0
                THEN SUM(quantity_delta * unit_cost) FILTER (WHERE quantity_delta > 0)
                   / SUM(quantity_delta)             FILTER (WHERE quantity_delta > 0)
                ELSE NULL
            END AS wac
        FROM inventory_movements
        WHERE ingredient_id = %s
          AND branch_id     = %s
          AND movement_type = 'grn'
        """,
        (ingredient_id, branch_id),
    )
    row = cur.fetchone()
    if row and row["wac"] is not None:
        return float(row["wac"])

    # Fallback: master cost
    cur.execute(
        "SELECT cost_per_unit FROM ingredients WHERE id = %s",
        (ingredient_id,),
    )
    master = cur.fetchone()
    return float(master["cost_per_unit"] or 0) if master else 0.0


# ---------------------------------------------------------------------------
# Stock balances
# ---------------------------------------------------------------------------

def get_branch_stock_balances(company_id: int, branch_id: int) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)
        cur.execute(
            """
            SELECT
                i.id   AS ingredient_id,
                i.name,
                i.unit,
                i.reorder_level,
                i.cost_per_unit,
                COALESCE(SUM(im.quantity_delta), 0) AS balance_qty,
                CASE
                    WHEN SUM(im.quantity_delta) FILTER (WHERE im.movement_type = 'grn' AND im.quantity_delta > 0) > 0
                    THEN SUM(im.quantity_delta * im.unit_cost) FILTER (WHERE im.movement_type = 'grn' AND im.quantity_delta > 0)
                       / SUM(im.quantity_delta)               FILTER (WHERE im.movement_type = 'grn' AND im.quantity_delta > 0)
                    ELSE i.cost_per_unit
                END AS avg_unit_cost
            FROM ingredients i
            LEFT JOIN inventory_movements im
                ON im.ingredient_id = i.id AND im.branch_id = %s
            WHERE i.company_id = %s AND i.is_active = TRUE
            GROUP BY i.id, i.name, i.unit, i.reorder_level, i.cost_per_unit
            ORDER BY i.name
            """,
            (branch_id, company_id),
        )
        rows = [_row(dict(r)) for r in cur.fetchall()]
        for row in rows:
            qty = row["balance_qty"]
            cost = row["avg_unit_cost"]
            row["stock_value"]    = round(qty * cost, 2)
            row["inventory_value"] = row["stock_value"]
            row["negative_alert"] = qty < 0
            row["reorder_alert"]  = 0 <= qty <= row["reorder_level"]
        return rows
    finally:
        cur.close()
        conn.close()


def get_finished_goods_balances(company_id: int, branch_id: int) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)
        cur.execute(
            """
            SELECT
                p.id   AS product_id,
                p.name,
                p.unit,
                p.sale_price,
                COALESCE(SUM(fgm.quantity_delta), 0) AS balance_qty,
                CASE
                    WHEN SUM(fgm.quantity_delta) FILTER (WHERE fgm.quantity_delta > 0) > 0
                    THEN SUM(fgm.quantity_delta * fgm.unit_cost) FILTER (WHERE fgm.quantity_delta > 0)
                       / SUM(fgm.quantity_delta)                 FILTER (WHERE fgm.quantity_delta > 0)
                    ELSE 0
                END AS avg_unit_cost
            FROM products p
            LEFT JOIN finished_goods_movements fgm
                ON fgm.product_id = p.id AND fgm.branch_id = %s
            WHERE p.company_id = %s AND p.is_active = TRUE
            GROUP BY p.id, p.name, p.unit, p.sale_price
            ORDER BY p.name
            """,
            (branch_id, company_id),
        )
        rows = [_row(dict(r)) for r in cur.fetchall()]
        for row in rows:
            qty  = row["balance_qty"]
            cost = row["avg_unit_cost"]
            row["stock_value"]    = round(qty * cost, 2)
            row["inventory_value"] = row["stock_value"]
            row["negative_alert"] = qty < 0
            row["reorder_alert"]  = False
        return rows
    finally:
        cur.close()
        conn.close()


# ---------------------------------------------------------------------------
# GRN  —  Goods Receipt Note (THIS is when stock actually increases)
# ---------------------------------------------------------------------------

def create_grn(
    company_id: int,
    user_id: int,
    branch_id: int,
    purchase_id: int,
    ingredient_id: int,
    entry_date: str,
    received_qty: float,
    unit_cost: float,
    notes: str = "",
    ip_address: str | None = None,
) -> dict:
    """
    Record physical receipt of goods.
    Stock increases HERE — not at PO creation or PO approval.
    """
    if is_period_closed(branch_id, entry_date):
        raise ValueError("This accounting period is closed for the selected branch")

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)
        # Verify the purchase belongs to this company (purchases has no company_id; join via branches)
        cur.execute(
            """
            SELECT p.id FROM purchases p
            JOIN branches b ON b.id = p.branch_id
            WHERE p.id = %s AND b.company_id = %s AND p.status = 'approved'
            """,
            (purchase_id, company_id),
        )
        if not cur.fetchone():
            raise ValueError("Purchase not found, not approved, or access denied")
        # Insert GRN record
        cur.execute(
            """
            INSERT INTO goods_receipts
                (branch_id, purchase_id, ingredient_id, entry_date, received_qty, unit_cost, notes, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (branch_id, purchase_id, ingredient_id, entry_date, received_qty, unit_cost, notes, user_id),
        )
        grn = dict(cur.fetchone())

        # ✅ Stock increases here via inventory_movements
        cur.execute(
            """
            INSERT INTO inventory_movements
                (branch_id, ingredient_id, movement_type, entry_date,
                 quantity_delta, unit_cost, reference_table, reference_id, notes)
            VALUES (%s, %s, 'grn', %s, %s, %s, 'goods_receipts', %s, %s)
            """,
            (branch_id, ingredient_id, entry_date, received_qty, unit_cost, grn["id"], notes),
        )

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            branch_id=branch_id,
            action="CREATE",
            table_name="goods_receipts",
            record_id=grn["id"],
            new_data=grn,
            ip_address=ip_address,
        )
        conn.commit()
        return grn
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def list_grns(
    company_id: int,
    branch_id: int | None = None,
    purchase_id: int | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        where = ["b.company_id = %s"]
        params: list[Any] = [company_id]
        if branch_id:
            where.append("gr.branch_id = %s")
            params.append(branch_id)
        if purchase_id:
            where.append("gr.purchase_id = %s")
            params.append(purchase_id)
        cur.execute(
            f"""
            SELECT gr.*, b.name AS branch_name, i.name AS ingredient_name, i.unit,
                   u.display_name AS received_by
            FROM goods_receipts gr
            JOIN branches b ON b.id = gr.branch_id
            JOIN ingredients i ON i.id = gr.ingredient_id
            LEFT JOIN app_users u ON u.id = gr.created_by
            WHERE {' AND '.join(where)}
            ORDER BY gr.entry_date DESC, gr.id DESC
            LIMIT %s
            """,
            params + [limit],
        )
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


# ---------------------------------------------------------------------------
# Stock issues
# ---------------------------------------------------------------------------

def list_stock_issues(
    company_id: int,
    branch_id: int | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        where = ["b.company_id = %s"]
        params: list[Any] = [company_id]
        if branch_id:
            where.append("si.branch_id = %s")
            params.append(branch_id)
        cur.execute(
            f"""
            SELECT si.*, b.name AS branch_name, i.name AS ingredient_name, i.unit
            FROM stock_issues si
            JOIN branches b ON b.id = si.branch_id
            JOIN ingredients i ON i.id = si.ingredient_id
            WHERE {' AND '.join(where)}
            ORDER BY si.entry_date DESC, si.id DESC
            LIMIT %s
            """,
            params + [limit],
        )
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def add_stock_issue(
    company_id: int,
    user_id: int,
    branch_id: int,
    ingredient_id: int,
    entry_date: str,
    qty_issued: float,
    issued_to: str | None = None,
    notes: str = "",
    ip_address: str | None = None,
) -> dict:
    if is_period_closed(branch_id, entry_date):
        raise ValueError("This accounting period is closed for the selected branch")

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)
        unit_cost = _ingredient_weighted_avg_cost(cur, ingredient_id, branch_id)

        cur.execute(
            """
            INSERT INTO stock_issues
                (branch_id, ingredient_id, entry_date, qty_issued, issued_to, notes)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (branch_id, ingredient_id, entry_date, qty_issued, issued_to, notes),
        )
        issue = dict(cur.fetchone())

        is_opening = issued_to == "opening_stock"
        movement_type  = "opening_stock" if is_opening else "issue"
        quantity_delta = qty_issued if is_opening else -qty_issued

        cur.execute(
            """
            INSERT INTO inventory_movements
                (branch_id, ingredient_id, movement_type, entry_date,
                 quantity_delta, unit_cost, reference_table, reference_id, notes)
            VALUES (%s, %s, %s, %s, %s, %s, 'stock_issues', %s, %s)
            """,
            (branch_id, ingredient_id, movement_type, entry_date,
             quantity_delta, unit_cost, issue["id"], notes),
        )

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            branch_id=branch_id,
            action="CREATE",
            table_name="stock_issues",
            record_id=issue["id"],
            new_data=issue,
            ip_address=ip_address,
        )
        conn.commit()
        return issue
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


# ---------------------------------------------------------------------------
# Stock counts
# ---------------------------------------------------------------------------

def list_stock_counts(
    company_id: int,
    branch_id: int | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        where = ["b.company_id = %s"]
        params: list[Any] = [company_id]
        if branch_id:
            where.append("sc.branch_id = %s")
            params.append(branch_id)
        cur.execute(
            f"""
            SELECT sc.*, b.name AS branch_name, i.name AS ingredient_name, i.unit,
                   u.display_name AS counted_by
            FROM stock_counts sc
            JOIN branches b ON b.id = sc.branch_id
            JOIN ingredients i ON i.id = sc.ingredient_id
            LEFT JOIN app_users u ON u.id = sc.created_by
            WHERE {' AND '.join(where)}
            ORDER BY sc.entry_date DESC, sc.id DESC
            LIMIT %s
            """,
            params + [limit],
        )
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def add_stock_count(
    company_id: int,
    user_id: int,
    branch_id: int,
    ingredient_id: int,
    entry_date: str,
    system_qty: float,
    counted_qty: float,
    notes: str = "",
    ip_address: str | None = None,
) -> dict:
    if is_period_closed(branch_id, entry_date):
        raise ValueError("This accounting period is closed for the selected branch")

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)
        delta = counted_qty - system_qty

        cur.execute(
            """
            INSERT INTO stock_counts
                (branch_id, ingredient_id, entry_date, system_qty, counted_qty, delta, notes, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (branch_id, ingredient_id, entry_date, system_qty, counted_qty, delta, notes, user_id),
        )
        count = dict(cur.fetchone())

        # Apply the delta to inventory so the balance reflects the physical count
        if delta != 0:
            unit_cost = _ingredient_weighted_avg_cost(cur, ingredient_id, branch_id)
            cur.execute(
                """
                INSERT INTO inventory_movements
                    (branch_id, ingredient_id, movement_type, entry_date,
                     quantity_delta, unit_cost, reference_table, reference_id, notes)
                VALUES (%s, %s, 'stock_count', %s, %s, %s, 'stock_counts', %s, %s)
                """,
                (branch_id, ingredient_id, entry_date, delta, unit_cost, count["id"], notes or "stock count adjustment"),
            )

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            branch_id=branch_id,
            action="CREATE",
            table_name="stock_counts",
            record_id=count["id"],
            new_data=count,
            ip_address=ip_address,
        )
        conn.commit()
        return count
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


# ---------------------------------------------------------------------------
# Adjustments
# ---------------------------------------------------------------------------

def list_adjustments(
    company_id: int,
    branch_id: int | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        where = ["b.company_id = %s", "a.status IS NOT NULL"]
        params: list[Any] = [company_id]
        if branch_id:
            where.append("a.branch_id = %s")
            params.append(branch_id)
        cur.execute(
            f"""
            SELECT a.id, a.branch_id, a.ingredient_id, i.name AS ingredient_name, i.unit,
                   a.quantity_delta, a.entry_date, a.notes, a.status, a.approved_by,
                   u.display_name AS approver_name
            FROM stock_adjustments a
            JOIN branches b ON b.id = a.branch_id
            JOIN ingredients i ON i.id = a.ingredient_id
            LEFT JOIN app_users u ON u.id = a.approved_by
            WHERE {' AND '.join(where)}
            ORDER BY a.entry_date DESC, a.id DESC
            LIMIT %s
            """,
            params + [limit],
        )
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def add_adjustment(
    company_id: int,
    user_id: int,
    branch_id: int,
    ingredient_id: int,
    entry_date: str,
    quantity_delta: float,
    notes: str = "",
    ip_address: str | None = None,
) -> dict:
    """
    Create a pending adjustment. Stock does NOT change yet.
    Stock only changes once the adjustment is approved via approve_adjustment().
    """
    if is_period_closed(branch_id, entry_date):
        raise ValueError("This accounting period is closed for the selected branch")

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)

        cur.execute(
            """
            INSERT INTO stock_adjustments
                (branch_id, ingredient_id, entry_date, quantity_delta, notes, status, created_by)
            VALUES (%s, %s, %s, %s, %s, 'pending', %s)
            RETURNING *
            """,
            (branch_id, ingredient_id, entry_date, quantity_delta, notes or "adjustment", user_id),
        )
        adjustment = dict(cur.fetchone())

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            branch_id=branch_id,
            action="CREATE",
            table_name="stock_adjustments",
            record_id=adjustment["id"],
            new_data=adjustment,
            ip_address=ip_address,
        )
        conn.commit()
        return adjustment
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def approve_adjustment(
    company_id: int,
    user_id: int,
    adj_id: int,
    status: str,
    notes: str = "",
    ip_address: str | None = None,
) -> None:
    """
    Approve or reject a pending adjustment.
    Stock movement is inserted ONLY on approval.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            SELECT a.*, b.company_id
            FROM stock_adjustments a
            JOIN branches b ON b.id = a.branch_id
            WHERE a.id = %s AND b.company_id = %s AND a.status = 'pending'
            """,
            (adj_id, company_id),
        )
        adjustment = cur.fetchone()
        if not adjustment:
            raise ValueError("Adjustment not found, already processed, or access denied")

        adjustment = dict(adjustment)

        # Update the adjustment record status
        cur.execute(
            "UPDATE stock_adjustments SET status = %s, approved_by = %s, approval_notes = %s WHERE id = %s",
            (status, user_id, notes, adj_id),
        )

        # ✅ Insert inventory movement ONLY when approved
        if status == "approved":
            unit_cost = _ingredient_weighted_avg_cost(
                cur, adjustment["ingredient_id"], adjustment["branch_id"]
            )
            cur.execute(
                """
                INSERT INTO inventory_movements
                    (branch_id, ingredient_id, movement_type, entry_date,
                     quantity_delta, unit_cost, reference_table, reference_id, notes)
                VALUES (%s, %s, 'adjustment', %s, %s, %s, 'stock_adjustments', %s, %s)
                """,
                (
                    adjustment["branch_id"],
                    adjustment["ingredient_id"],
                    adjustment["entry_date"],
                    adjustment["quantity_delta"],
                    unit_cost,
                    adj_id,
                    notes or adjustment["notes"],
                ),
            )

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            branch_id=adjustment["branch_id"],
            action=f"ADJUSTMENT_{status.upper()}",
            table_name="stock_adjustments",
            record_id=adj_id,
            old_data=adjustment,
            new_data={"status": status, "notes": notes},
            ip_address=ip_address,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


# ---------------------------------------------------------------------------
# Opening stock
# ---------------------------------------------------------------------------

def list_opening_stock(
    company_id: int,
    branch_id: int | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        where = ["b.company_id = %s", "si.issued_to = 'opening_stock'"]
        params: list[Any] = [company_id]
        if branch_id:
            where.append("si.branch_id = %s")
            params.append(branch_id)
        cur.execute(
            f"""
            SELECT si.*, b.name AS branch_name, i.name AS ingredient_name, i.unit
            FROM stock_issues si
            JOIN branches b ON b.id = si.branch_id
            JOIN ingredients i ON i.id = si.ingredient_id
            WHERE {' AND '.join(where)}
            ORDER BY si.entry_date DESC, si.id DESC
            LIMIT %s
            """,
            params + [limit],
        )
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


# ---------------------------------------------------------------------------
# Transfers
# ---------------------------------------------------------------------------

def list_transfers(
    company_id: int,
    branch_id: int | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        if branch_id:
            where = "WHERE (t.from_branch_id = %s OR t.to_branch_id = %s) AND bf.company_id = %s AND bt.company_id = %s"
            direction_expr = "CASE WHEN t.to_branch_id = %s THEN 'in' ELSE 'out' END"
            params = [branch_id, branch_id, company_id, company_id, branch_id, limit]
        else:
            where = "WHERE bf.company_id = %s AND bt.company_id = %s"
            direction_expr = "NULL"
            params = [company_id, company_id, limit]

        cur.execute(
            f"""
            SELECT t.*, bf.name AS from_branch_name, bt.name AS to_branch_name,
                   i.name AS ingredient_name, i.unit, {direction_expr} AS direction
            FROM transfers t
            JOIN branches bf ON bf.id = t.from_branch_id
            JOIN branches bt ON bt.id = t.to_branch_id
            JOIN ingredients i ON i.id = t.ingredient_id
            {where}
            ORDER BY t.entry_date DESC, t.id DESC
            LIMIT %s
            """,
            params,
        )
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def add_transfer(
    company_id: int,
    user_id: int,
    from_branch_id: int,
    to_branch_id: int,
    ingredient_id: int,
    entry_date: str,
    quantity: float,
    notes: str = "",
    status: str = "approved",
    ip_address: str | None = None,
) -> dict:
    if is_period_closed(from_branch_id, entry_date) or is_period_closed(to_branch_id, entry_date):
        raise ValueError("This accounting period is closed for one of the selected branches")

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _verify_branch(cur, from_branch_id, company_id)
        _verify_branch(cur, to_branch_id, company_id)

        # Use weighted-average cost from the sending branch
        unit_cost = _ingredient_weighted_avg_cost(cur, ingredient_id, from_branch_id)

        cur.execute(
            """
            INSERT INTO transfers
                (from_branch_id, to_branch_id, ingredient_id, entry_date, quantity, notes, status, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (from_branch_id, to_branch_id, ingredient_id, entry_date, quantity, notes, status, user_id),
        )
        transfer = dict(cur.fetchone())

        if status == "approved":
            cur.execute(
                """
                INSERT INTO inventory_movements
                    (branch_id, ingredient_id, movement_type, entry_date, quantity_delta, unit_cost, reference_table, reference_id, notes)
                VALUES
                    (%s, %s, 'transfer_out', %s, %s, %s, 'transfers', %s, %s),
                    (%s, %s, 'transfer_in',  %s, %s, %s, 'transfers', %s, %s)
                """,
                (
                    from_branch_id, ingredient_id, entry_date, -quantity, unit_cost, transfer["id"], notes,
                    to_branch_id,   ingredient_id, entry_date,  quantity, unit_cost, transfer["id"], notes,
                ),
            )

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            branch_id=from_branch_id,
            action="CREATE",
            table_name="transfers",
            record_id=transfer["id"],
            new_data=transfer,
            ip_address=ip_address,
        )
        conn.commit()
        return transfer
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


# ---------------------------------------------------------------------------
# Inventory movements (read-only audit / ledger view)
# ---------------------------------------------------------------------------

def list_inventory_movements(
    company_id: int,
    branch_id: int | None = None,
    movement_type: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        where = ["b.company_id = %s"]
        params: list[Any] = [company_id]
        if branch_id:
            where.append("im.branch_id = %s")
            params.append(branch_id)
        if movement_type:
            where.append("im.movement_type = %s")
            params.append(movement_type)
        cur.execute(
            f"""
            SELECT im.*, i.name AS ingredient_name, i.unit, b.name AS branch_name
            FROM inventory_movements im
            JOIN ingredients i ON i.id = im.ingredient_id
            JOIN branches b ON b.id = im.branch_id
            WHERE {' AND '.join(where)}
            ORDER BY im.entry_date DESC, im.id DESC
            LIMIT %s
            """,
            params + [limit],
        )
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()
# ---------------------------------------------------------------------------
# PO Fulfillment  (costing manager — received vs ordered per PO)
# ---------------------------------------------------------------------------

def get_po_fulfillment(
    company_id: int,
    branch_id: int | None = None,
    ingredient_id: int | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        where = ["b.company_id = %s", "p.status = 'approved'"]
        params: list[Any] = [company_id]

        if branch_id:
            where.append("b.id = %s")
            params.append(branch_id)
        if ingredient_id:
            where.append("p.ingredient_id = %s")
            params.append(ingredient_id)

        cur.execute(
            f"""
            SELECT
                p.id                                            AS po_id,
                p.entry_date                                    AS po_date,
                p.branch_id,
                b.name                                          AS branch_name,
                p.supplier_id,
                s.name                                          AS supplier_name,
                p.ingredient_id,
                i.name                                          AS ingredient_name,
                i.unit,
                p.quantity                                      AS po_qty,
                p.unit_cost                                     AS po_unit_cost,
                p.payable_amount                                AS po_value,
                COALESCE(SUM(gr.received_qty), 0)              AS total_received,
                p.quantity - COALESCE(SUM(gr.received_qty), 0) AS pending_qty,
                COUNT(gr.id)                                    AS grn_count,
                MAX(gr.entry_date)                              AS last_grn_date,
                CASE
                    WHEN COALESCE(SUM(gr.received_qty), 0) = 0           THEN 'not_received'
                    WHEN COALESCE(SUM(gr.received_qty), 0) >= p.quantity THEN 'fully_received'
                    ELSE 'partially_received'
                END                                             AS fulfillment_status,
                COALESCE(AVG(gr.unit_cost), p.unit_cost)       AS avg_grn_unit_cost,
                COALESCE(AVG(gr.unit_cost), p.unit_cost)
                    - p.unit_cost                               AS cost_variance,
                CASE
                    WHEN p.unit_cost > 0
                    THEN ROUND(
                        (COALESCE(AVG(gr.unit_cost), p.unit_cost) - p.unit_cost)
                        / p.unit_cost * 100, 2)
                    ELSE 0
                END                                             AS cost_variance_pct
            FROM purchases p
            JOIN branches    b ON b.id = p.branch_id
            JOIN suppliers   s ON s.id = p.supplier_id
            JOIN ingredients i ON i.id = p.ingredient_id
            LEFT JOIN goods_receipts gr ON gr.purchase_id = p.id
            WHERE {' AND '.join(where)}
            GROUP BY
                p.id, p.entry_date, p.branch_id, b.name,
                p.supplier_id, s.name,
                p.ingredient_id, i.name, i.unit,
                p.quantity, p.unit_cost, p.payable_amount
            ORDER BY p.entry_date DESC, p.id DESC
            LIMIT %s
            """,
            params + [limit],
        )
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()