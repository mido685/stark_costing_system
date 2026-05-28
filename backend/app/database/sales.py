import psycopg2
from typing import Any
from .connection import get_connection, dict_cursor
from .log_audit import log_audit
from .periods import is_period_closed


def list_sales(
    company_id: int,
    branch_id: int | None = None,
    period: str | None = None,
) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        conditions = ["b.company_id = %s"]
        params: list[Any] = [company_id]

        if branch_id:
            conditions.append("s.branch_id = %s")
            params.append(branch_id)
        if period:
            conditions.append("TO_CHAR(s.entry_date, 'YYYY-MM') = %s")
            params.append(period)

        cur.execute(f"""
            SELECT s.*, b.name AS branch_name, p.name AS product_name
            FROM sales s
            JOIN branches b ON b.id = s.branch_id
            JOIN products p ON p.id = s.product_id
            WHERE {' AND '.join(conditions)}
            ORDER BY s.entry_date DESC, s.id DESC
        """, params)
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def get_sale(sale_id: int, company_id: int) -> dict[str, Any] | None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT s.*, b.name AS branch_name, p.name AS product_name
            FROM sales s
            JOIN branches b ON b.id = s.branch_id
            JOIN products p ON p.id = s.product_id
            WHERE s.id = %s AND b.company_id = %s
        """, (sale_id, company_id))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        cur.close()
        conn.close()


def add_sale(
    branch_id: int,
    product_id: int,
    entry_date: str,
    quantity: float,
    unit_price: float,
    company_id: int,
    user_id: int,
    discount_amount: float = 0,
    promotion_amount: float = 0,
    tax_amount: float = 0,
    payment_method: str = "cash",
    receivable_amount: float = 0,
    notes: str = "",
    status: str = "approved",
    ip_address: str | None = None,
) -> dict:
    if is_period_closed(branch_id, entry_date):
        raise ValueError("This accounting period is closed for the selected branch")

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        gross_amount = quantity * unit_price
        net_amount   = gross_amount - discount_amount - promotion_amount + tax_amount

        cur.execute("""
            INSERT INTO sales (
                branch_id, product_id, entry_date, quantity, unit_price,
                gross_amount, discount_amount, promotion_amount, tax_amount,
                net_amount, payment_method, receivable_amount,
                notes, status, created_by
            )
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING *
        """, (
            branch_id, product_id, entry_date, quantity, unit_price,
            gross_amount, discount_amount, promotion_amount, tax_amount,
            net_amount, payment_method, receivable_amount,
            notes, status, user_id,
        ))
        sale = dict(cur.fetchone())

        # ── Deduct from finished goods inventory ──────────────────────────────
        cur.execute("""
            INSERT INTO finished_goods_movements
                (branch_id, product_id, movement_type, entry_date,
                 quantity_delta, unit_cost, reference_table, reference_id, notes)
            VALUES (%s, %s, 'sale', %s, %s, %s, 'sales', %s, %s)
        """, (branch_id, product_id, entry_date,
              -quantity, unit_price, sale["id"], notes))

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="CREATE",
            table_name="sales",
            record_id=sale["id"],
            new_data=sale,
            ip_address=ip_address,
        )
        conn.commit()
        return sale

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def delete_sale(
    sale_id: int,
    company_id: int,
    user_id: int,
    ip_address: str | None = None,
) -> None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT s.* FROM sales s
            JOIN branches b ON b.id = s.branch_id
            WHERE s.id = %s AND b.company_id = %s
        """, (sale_id, company_id))
        old = cur.fetchone()
        if not old:
            raise ValueError("Sale not found or access denied")

        if is_period_closed(old["branch_id"], str(old["entry_date"])):
            raise ValueError("Cannot delete — accounting period is closed")

        # ── Reverse finished goods movement ───────────────────────────────────
        cur.execute("""
            DELETE FROM finished_goods_movements
            WHERE reference_table = 'sales' AND reference_id = %s
        """, (sale_id,))

        cur.execute("DELETE FROM sales WHERE id = %s", (sale_id,))

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="DELETE",
            table_name="sales",
            record_id=sale_id,
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