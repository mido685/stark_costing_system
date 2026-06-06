from typing import Any

from .connection import get_connection, dict_cursor
from .log_audit import log_audit
from .periods import is_period_frozen


def _ensure_single_item(ingredient_id: int | None, product_id: int | None) -> None:
    if bool(ingredient_id) == bool(product_id):
        raise ValueError("Provide exactly one of ingredient_id or product_id")


def _get_ingredient_unit_cost(cur, ingredient_id: int, company_id: int) -> float:
    cur.execute(
        "SELECT cost_per_unit FROM ingredients WHERE id = %s AND company_id = %s",
        (ingredient_id, company_id),
    )
    row = cur.fetchone()
    if not row:
        raise ValueError("Ingredient not found or access denied")
    return float(row["cost_per_unit"] or 0)


def _get_finished_good_unit_cost(cur, branch_id: int, product_id: int, company_id: int) -> float:
    cur.execute(
        "SELECT id FROM products WHERE id = %s AND company_id = %s",
        (product_id, company_id),
    )
    if not cur.fetchone():
        raise ValueError("Product not found or access denied")

    cur.execute("""
        SELECT CASE
            WHEN COALESCE(SUM(quantity_delta) FILTER (WHERE quantity_delta > 0), 0) > 0
            THEN SUM(quantity_delta * unit_cost) FILTER (WHERE quantity_delta > 0)
               / SUM(quantity_delta) FILTER (WHERE quantity_delta > 0)
            ELSE 0
        END AS unit_cost
        FROM finished_goods_movements
        WHERE branch_id = %s
          AND product_id = %s
          AND movement_type = 'production'
    """, (branch_id, product_id))
    row = cur.fetchone()
    return float((row or {}).get("unit_cost") or 0)


def list_waste(
    company_id: int,
    branch_id: int | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        conditions = ["b.company_id = %s"]
        params: list[Any] = [company_id]
        if branch_id:
            conditions.append("w.branch_id = %s")
            params.append(branch_id)

        cur.execute(f"""
            SELECT w.*, b.name AS branch_name,
                   i.name AS ingredient_name,
                   p.name AS product_name
            FROM waste_log w
            JOIN branches b ON b.id = w.branch_id
            LEFT JOIN ingredients i ON i.id = w.ingredient_id
            LEFT JOIN products p ON p.id = w.product_id
            WHERE {' AND '.join(conditions)}
            ORDER BY w.entry_date DESC, w.id DESC
            LIMIT %s
        """, params + [limit])
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def get_waste(waste_id: int, company_id: int) -> dict[str, Any] | None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT w.*, b.name AS branch_name,
                   i.name AS ingredient_name,
                   p.name AS product_name
            FROM waste_log w
            JOIN branches b ON b.id = w.branch_id
            LEFT JOIN ingredients i ON i.id = w.ingredient_id
            LEFT JOIN products p ON p.id = w.product_id
            WHERE w.id = %s AND b.company_id = %s
        """, (waste_id, company_id))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        cur.close()
        conn.close()


def add_waste(
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
) -> dict:
    _ensure_single_item(ingredient_id, product_id)
    if is_period_frozen(branch_id, entry_date):
        raise ValueError("This accounting period is closed for the selected branch")

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        if ingredient_id:
            unit_cost = _get_ingredient_unit_cost(cur, ingredient_id, company_id)
        else:
            unit_cost = _get_finished_good_unit_cost(cur, branch_id, product_id, company_id)
        cost_value = unit_cost * quantity

        cur.execute("""
            INSERT INTO waste_log
                (branch_id, ingredient_id, product_id, entry_date,
                 quantity, reason, cost_value, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (branch_id, ingredient_id, product_id, entry_date,
              quantity, reason, cost_value, notes))
        waste = dict(cur.fetchone())

        if ingredient_id:
            cur.execute("""
                INSERT INTO inventory_movements
                    (branch_id, ingredient_id, movement_type, entry_date,
                     quantity_delta, unit_cost, reference_table, reference_id, notes)
                VALUES (%s, %s, 'waste', %s, %s, %s, 'waste_log', %s, %s)
            """, (branch_id, ingredient_id, entry_date,
                  -quantity, unit_cost, waste["id"], notes))
        else:
            cur.execute("""
                INSERT INTO finished_goods_movements
                    (branch_id, product_id, movement_type, entry_date,
                     quantity_delta, unit_cost, reference_table, reference_id, notes)
                VALUES (%s, %s, 'waste', %s, %s, %s, 'waste_log', %s, %s)
            """, (branch_id, product_id, entry_date,
                  -quantity, unit_cost, waste["id"], notes))

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="CREATE",
            table_name="waste_log",
            record_id=waste["id"],
            new_data=waste,
            ip_address=ip_address,
        )
        conn.commit()
        return waste
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def delete_waste(
    waste_id: int,
    company_id: int,
    user_id: int,
    ip_address: str | None = None,
) -> None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT w.* FROM waste_log w
            JOIN branches b ON b.id = w.branch_id
            WHERE w.id = %s AND b.company_id = %s
        """, (waste_id, company_id))
        old = cur.fetchone()
        if not old:
            raise ValueError("Waste record not found or access denied")
        if is_period_frozen(old["branch_id"], str(old["entry_date"])):
            raise ValueError("Cannot delete — accounting period is closed")

        cur.execute("""
            DELETE FROM inventory_movements
            WHERE reference_table = 'waste_log' AND reference_id = %s
        """, (waste_id,))
        cur.execute("""
            DELETE FROM finished_goods_movements
            WHERE reference_table = 'waste_log' AND reference_id = %s
        """, (waste_id,))
        cur.execute("DELETE FROM waste_log WHERE id = %s", (waste_id,))

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="DELETE",
            table_name="waste_log",
            record_id=waste_id,
            old_data=dict(old),
            ip_address=ip_address,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()
