from typing import Any
from .connection import get_connection, dict_cursor


def is_period_closed(branch_id: int, entry_date: str) -> bool:
    """Used inside DB functions — returns True if period is closed or locked."""
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT company_id FROM branches WHERE id = %s",
            (branch_id,)
        )
        row = cur.fetchone()
        if not row:
            return False

        period = entry_date[:7]
        cur.execute("""
            SELECT status FROM company_period_statuses
            WHERE company_id = %s AND period = %s
        """, (row["company_id"], period))
        status_row = cur.fetchone()
        if not status_row:
            return False

        return status_row["status"] in ("closed", "locked")
    finally:
        cur.close()
        conn.close()


def get_period_status(company_id: int, period: str) -> dict[str, Any]:
    """Used by check_period_open in routes — returns status row."""
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT * FROM company_period_statuses
            WHERE company_id = %s AND period = %s
        """, (company_id, period))
        row = cur.fetchone()
        return dict(row) if row else {"status": "open"}
    finally:
        cur.close()
        conn.close()

def set_period_status(
    company_id: int,
    period: str,
    status: str,
    user_id: int,
    note: str | None = None
) -> dict[str, Any]:
    """Admin only — open, close, or lock a period."""
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            INSERT INTO company_period_statuses
                (company_id, period, status, updated_by, note)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (company_id, period) DO UPDATE
                SET status     = EXCLUDED.status,
                    updated_by = EXCLUDED.updated_by,
                    note       = EXCLUDED.note,
                    updated_at = NOW()
            RETURNING *
        """, (company_id, period, status, user_id, note))
        row = dict(cur.fetchone())
        conn.commit()
        return row
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def list_period_statuses(company_id: int) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT * FROM company_period_statuses
            WHERE company_id = %s
            ORDER BY period DESC
        """, (company_id,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()