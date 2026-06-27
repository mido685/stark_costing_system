import psycopg2
from typing import Any
from .connection import get_connection, dict_cursor
from .log_audit import log_audit
from .periods import is_period_frozen
from .system_logger import log_event


def list_revenues(company_id: int, branch_id: int | None = None) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        if branch_id:
            cur.execute("""
                SELECT r.*, b.name AS branch_name, p.name AS product_name
                FROM revenues r
                JOIN branches b ON b.id = r.branch_id
                LEFT JOIN products p ON p.id = r.product_id
                WHERE b.company_id = %s AND r.branch_id = %s
                ORDER BY r.entry_date DESC, r.id DESC
            """, (company_id, branch_id))
        else:
            cur.execute("""
                SELECT r.*, b.name AS branch_name, p.name AS product_name
                FROM revenues r
                JOIN branches b ON b.id = r.branch_id
                LEFT JOIN products p ON p.id = r.product_id
                WHERE b.company_id = %s
                ORDER BY r.entry_date DESC, r.id DESC
            """, (company_id,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def get_revenue(revenue_id: int, company_id: int) -> dict[str, Any] | None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT r.*, b.name AS branch_name, p.name AS product_name
            FROM revenues r
            JOIN branches b ON b.id = r.branch_id
            LEFT JOIN products p ON p.id = r.product_id
            WHERE r.id = %s AND b.company_id = %s
        """, (revenue_id, company_id))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        cur.close()
        conn.close()


def add_revenue(
    branch_id: int,
    company_id: int,
    user_id: int,
    entry_date: str,
    amount: float,
    product_id: int | None = None,
    quantity: float = 0,
    notes: str = "",
    ip_address: str | None = None,
) -> dict:
    if is_period_frozen(branch_id, entry_date):
        raise ValueError("This accounting period is closed for the selected branch")

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            INSERT INTO revenues (branch_id, product_id, entry_date, quantity, amount, notes)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (branch_id, product_id, entry_date, quantity, amount, notes))
        revenue = dict(cur.fetchone())

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="CREATE",
            table_name="revenues",
            record_id=revenue["id"],
            new_data=revenue,
            ip_address=ip_address,
        )
        log_event(
            conn,
            company_id=company_id,
            user_id=user_id,
            branch_id=branch_id,
            action="created",
            category="data",
            entity_type="revenues",
            entity_id=revenue["id"],
            payload={
                "product_id": product_id,
                "quantity":   quantity,
                "amount":     amount,
                "entry_date": entry_date,
            },
            ip_address=ip_address,
        )
        conn.commit()
        return revenue

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def delete_revenue(
    revenue_id: int,
    company_id: int,
    user_id: int,
    ip_address: str | None = None,
) -> None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT r.* FROM revenues r
            JOIN branches b ON b.id = r.branch_id
            WHERE r.id = %s AND b.company_id = %s
        """, (revenue_id, company_id))
        old = cur.fetchone()
        if not old:
            raise ValueError("Revenue not found or access denied")

        if is_period_frozen(old["branch_id"], str(old["entry_date"])):
            raise ValueError("Cannot delete — accounting period is closed")

        cur.execute("DELETE FROM revenues WHERE id = %s", (revenue_id,))

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="DELETE",
            table_name="revenues",
            record_id=revenue_id,
            old_data=dict(old),
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
            entity_type="revenues",
            entity_id=revenue_id,
            payload={
                "product_id": old["product_id"],
                "amount":     float(old["amount"]),
                "quantity":   float(old["quantity"] or 0),
                "entry_date": str(old["entry_date"]),
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