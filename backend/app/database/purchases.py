from typing import Any

from .connection import get_connection, dict_cursor
from .log_audit import log_audit
from .periods import is_period_closed


def _ensure_purchase_access(cur, branch_id: int, supplier_id: int, ingredient_id: int, company_id: int) -> None:
    cur.execute("""
        SELECT b.id
        FROM branches b
        JOIN suppliers s ON s.company_id = b.company_id
        JOIN ingredients i ON i.company_id = b.company_id
        WHERE b.id = %s
          AND s.id = %s
          AND i.id = %s
          AND b.company_id = %s
          AND s.is_active = TRUE
          AND i.is_active = TRUE
    """, (branch_id, supplier_id, ingredient_id, company_id))
    if not cur.fetchone():
        raise ValueError("Branch, supplier, or ingredient not found or access denied")


def list_purchases(
    company_id: int,
    branch_id: int | None = None,
    status: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        conditions = ["b.company_id = %s"]
        params: list[Any] = [company_id]
        if branch_id:
            conditions.append("p.branch_id = %s")
            params.append(branch_id)
        if status:
            conditions.append("p.status = %s")
            params.append(status)

        cur.execute(f"""
            SELECT p.*, b.name AS branch_name,
                   i.name AS ingredient_name, i.unit,
                   s.name AS supplier_name
            FROM purchases p
            JOIN branches b ON b.id = p.branch_id
            JOIN ingredients i ON i.id = p.ingredient_id
            JOIN suppliers s ON s.id = p.supplier_id
            WHERE {' AND '.join(conditions)}
            ORDER BY p.entry_date DESC, p.id DESC
            LIMIT %s
        """, params + [limit])
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def get_purchase(purchase_id: int, company_id: int) -> dict[str, Any] | None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT p.*, b.name AS branch_name,
                   i.name AS ingredient_name, i.unit,
                   s.name AS supplier_name, s.phone AS supplier_phone
            FROM purchases p
            JOIN branches b ON b.id = p.branch_id
            JOIN ingredients i ON i.id = p.ingredient_id
            JOIN suppliers s ON s.id = p.supplier_id
            WHERE p.id = %s AND b.company_id = %s
        """, (purchase_id, company_id))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        cur.close()
        conn.close()


def add_purchase(
    branch_id: int,
    supplier_id: int,
    ingredient_id: int,
    entry_date: str,
    quantity: float,
    unit_cost: float,
    company_id: int,
    user_id: int,
    tax_amount: float = 0,
    payable_amount: float = 0,
    notes: str = "",
    status: str = "approved",
    ip_address: str | None = None,
) -> dict:
    if is_period_closed(branch_id, entry_date):
        raise ValueError("This accounting period is closed for the selected branch")

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _ensure_purchase_access(cur, branch_id, supplier_id, ingredient_id, company_id)
        gross_amount = quantity * unit_cost
        payable = payable_amount or gross_amount + tax_amount

        cur.execute("""
            INSERT INTO purchases
                (branch_id, supplier_id, ingredient_id, entry_date, quantity,
                 unit_cost, gross_amount, tax_amount, payable_amount,
                 notes, status, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (branch_id, supplier_id, ingredient_id, entry_date, quantity,
              unit_cost, gross_amount, tax_amount, payable, notes, status, user_id))
        purchase = dict(cur.fetchone())

        if status == "approved":
            cur.execute("""
                INSERT INTO inventory_movements
                    (branch_id, ingredient_id, movement_type, entry_date,
                     quantity_delta, unit_cost, reference_table, reference_id, notes)
                VALUES (%s, %s, 'purchase', %s, %s, %s, 'purchases', %s, %s)
            """, (branch_id, ingredient_id, entry_date, quantity, unit_cost, purchase["id"], notes))
            cur.execute("""
                UPDATE ingredients
                SET cost_per_unit = %s, supplier_id = %s
                WHERE id = %s AND company_id = %s
            """, (unit_cost, supplier_id, ingredient_id, company_id))

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            branch_id=branch_id,
            action="CREATE",
            table_name="purchases",
            record_id=purchase["id"],
            new_data=purchase,
            ip_address=ip_address,
        )
        conn.commit()
        return purchase
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def add_purchase_return(
    branch_id: int,
    supplier_id: int,
    ingredient_id: int,
    entry_date: str,
    quantity: float,
    unit_cost: float,
    company_id: int,
    user_id: int,
    refund_amount: float = 0,
    notes: str = "",
    status: str = "approved",
    ip_address: str | None = None,
) -> dict:
    if is_period_closed(branch_id, entry_date):
        raise ValueError("This accounting period is closed for the selected branch")

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _ensure_purchase_access(cur, branch_id, supplier_id, ingredient_id, company_id)
        refund = refund_amount or quantity * unit_cost

        cur.execute("""
            INSERT INTO purchase_returns
                (branch_id, supplier_id, ingredient_id, entry_date, quantity,
                 unit_cost, refund_amount, notes, status, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (branch_id, supplier_id, ingredient_id, entry_date, quantity,
              unit_cost, refund, notes, status, user_id))
        purchase_return = dict(cur.fetchone())

        if status == "approved":
            cur.execute("""
                INSERT INTO inventory_movements
                    (branch_id, ingredient_id, movement_type, entry_date,
                     quantity_delta, unit_cost, reference_table, reference_id, notes)
                VALUES (%s, %s, 'purchase_return', %s, %s, %s, 'purchase_returns', %s, %s)
            """, (branch_id, ingredient_id, entry_date,
                  -quantity, unit_cost, purchase_return["id"], notes))

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            branch_id=branch_id,
            action="CREATE",
            table_name="purchase_returns",
            record_id=purchase_return["id"],
            new_data=purchase_return,
            ip_address=ip_address,
        )
        conn.commit()
        return purchase_return
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()
# app/database/purchases.py
def update_purchase(purchase_id: int, company_id: int, quantity: float, unit_cost: float, notes: str) -> dict:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            UPDATE purchases
            SET quantity = %s, unit_cost = %s,
                gross_amount = %s * %s,
                payable_amount = %s * %s,
                notes = %s
            WHERE id = %s
              AND company_id = (SELECT company_id FROM branches WHERE id = branch_id)
              AND status = 'pending'
            RETURNING *
        """, (quantity, unit_cost, quantity, unit_cost, quantity, unit_cost, notes, purchase_id))
        row = cur.fetchone()
        if not row:
            raise ValueError("PO not found or already approved — cannot edit")
        conn.commit()
        return dict(row)
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()