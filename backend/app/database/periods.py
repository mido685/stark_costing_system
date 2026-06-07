from typing import Any
from .connection import get_connection, dict_cursor

# ─── State machine ────────────────────────────────────────────────────────────

VALID_TRANSITIONS: dict[str, set[str]] = {
    "open":   {"closed"},
    "closed": {"open", "locked"},
    "locked": set(),
}

ROLE_PERMISSIONS: dict[str, list[str]] = {
    "open":   ["accountant", "manager", "admin"],
    "closed": ["manager", "admin"],
    "locked": [],
}

# ─── Internal helpers ─────────────────────────────────────────────────────────

def _get_current_status(cur, company_id: int, period: str) -> str:
    """Fetch current period status using an existing cursor."""
    cur.execute("""
        SELECT status FROM company_period_statuses
        WHERE company_id = %s AND period = %s
    """, (company_id, period))
    row = cur.fetchone()
    return row["status"] if row else "open"


def _assert_valid_transition(current: str, new: str) -> None:
    """Raise if the state transition is not allowed."""
    if new not in VALID_TRANSITIONS[current]:
        raise ValueError(
            f"Cannot transition period from '{current}' to '{new}'. "
            f"Allowed: {VALID_TRANSITIONS[current] or {'none — terminal state'}}"
        )


def _assert_role_permitted(current: str, user_role: str) -> None:
    """Raise if the user's role cannot change this period state."""
    if user_role not in ROLE_PERMISSIONS[current]:
        raise PermissionError(
            f"Role '{user_role}' cannot change a '{current}' period."
        )


def _assert_prior_period_closed(cur, company_id: int, period: str) -> None:
    """Raise if the immediately preceding period is still open."""
    y, m = map(int, period.split("-"))
    prior = f"{y}-{m-1:02d}" if m > 1 else f"{y-1}-12"
    cur.execute("""
        SELECT status FROM company_period_statuses
        WHERE company_id = %s AND period = %s
    """, (company_id, prior))
    row = cur.fetchone()
    # No row means prior period was never touched — treated as open
    if row and row["status"] == "open":
        raise ValueError(
            f"Prior period {prior} must be closed before closing {period}."
        )


def _assert_no_pending_transactions(cur, company_id: int, period: str) -> None:
    """Raise if any pending/unposted transactions exist in this period."""
    cur.execute("""
        SELECT COUNT(*) AS cnt
        FROM transactions
        WHERE company_id = %s
          AND TO_CHAR(date, 'YYYY-MM') = %s
          AND status = 'pending'
    """, (company_id, period))
    row = cur.fetchone()
    if row and row["cnt"] > 0:
        raise ValueError(
            f"Period {period} has {row['cnt']} pending transaction(s). "
            "Resolve or post them before closing."
        )


def _assert_no_pending_approvals(cur, company_id: int, period: str) -> None:
    """Raise if any transactions are still awaiting approval."""
    cur.execute("""
        SELECT COUNT(*) AS cnt
        FROM transactions
        WHERE company_id = %s
          AND TO_CHAR(date, 'YYYY-MM') = %s
          AND status = 'awaiting_approval'
    """, (company_id, period))
    row = cur.fetchone()
    if row and row["cnt"] > 0:
        raise ValueError(
            f"Period {period} has {row['cnt']} transaction(s) awaiting approval. "
            "Approve or reject them before closing."
        )


def _run_pre_close_validation(cur, company_id: int, period: str) -> None:
    """Run all validations required before soft-closing a period."""
    _assert_prior_period_closed(cur, company_id, period)
    _assert_no_pending_transactions(cur, company_id, period)
    _assert_no_pending_approvals(cur, company_id, period)


def _write_audit_history(
    cur,
    company_id: int,
    period: str,
    from_status: str,
    to_status: str,
    user_id: int,
    note: str | None,
) -> None:
    """Append an immutable record to the period status history log."""
    cur.execute("""
        INSERT INTO company_period_status_history
            (company_id, period, from_status, to_status, changed_by, note)
        VALUES (%s, %s, %s, %s, %s, %s)
    """, (company_id, period, from_status, to_status, user_id, note))


def _capture_snapshot(cur, company_id: int, period: str) -> None:
    """
    Freeze a point-in-time snapshot of all period metrics.
    Called automatically on hard lock so past review is always stable,
    even if adjusting entries are posted against this period later.
    """
    cur.execute("""
        INSERT INTO period_snapshots
            (company_id, period,
             total_sales, total_expenses, total_purchases,
             cogs, gross_profit, inventory_value, snapped_at)
        SELECT
            %s, %s,
            COALESCE(SUM(CASE WHEN type = 'sale'     THEN amount END), 0),
            COALESCE(SUM(CASE WHEN type = 'expense'  THEN amount END), 0),
            COALESCE(SUM(CASE WHEN type = 'purchase' THEN amount END), 0),
            COALESCE(SUM(CASE WHEN type = 'cogs'     THEN amount END), 0),
            COALESCE(SUM(CASE WHEN type = 'sale'     THEN amount END), 0) -
            COALESCE(SUM(CASE WHEN type = 'cogs'     THEN amount END), 0),
            (
                SELECT COALESCE(inventory_value, 0)
                FROM inventory_summary
                WHERE company_id = %s AND period = %s
                LIMIT 1
            ),
            NOW()
        FROM transactions
        WHERE company_id = %s
          AND TO_CHAR(date, 'YYYY-MM') = %s
          AND status = 'approved'
        ON CONFLICT (company_id, period) DO UPDATE
            SET total_sales      = EXCLUDED.total_sales,
                total_expenses   = EXCLUDED.total_expenses,
                total_purchases  = EXCLUDED.total_purchases,
                cogs             = EXCLUDED.cogs,
                gross_profit     = EXCLUDED.gross_profit,
                inventory_value  = EXCLUDED.inventory_value,
                snapped_at       = EXCLUDED.snapped_at
    """, (company_id, period, company_id, period, company_id, period))


# ─── Public API ───────────────────────────────────────────────────────────────

def is_period_frozen(branch_id: int, entry_date: str) -> bool:
    """
    Returns True if the period is closed OR locked.
    Use this guard on every write route (create/edit/delete transactions,
    purchases, expenses, adjustments).
    Accepts an existing cursor to avoid opening a new connection per call.
    """
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


def is_period_frozen_with_cur(cur, company_id: int, entry_date: str) -> bool:
    """
    Same freeze check but reuses an existing cursor.
    Use this inside DB functions that already hold a connection,
    to avoid hammering the connection pool on every transaction write.
    """
    period = entry_date[:7]
    cur.execute("""
        SELECT status FROM company_period_statuses
        WHERE company_id = %s AND period = %s
    """, (company_id, period))
    status_row = cur.fetchone()
    if not status_row:
        return False
    return status_row["status"] in ("closed", "locked")


def is_period_locked(company_id: int, period: str) -> bool:
    """
    Returns True only for hard-locked periods.
    Use this specifically to block re-open attempts at the route level.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT status FROM company_period_statuses
            WHERE company_id = %s AND period = %s
        """, (company_id, period))
        row = cur.fetchone()
        return row["status"] == "locked" if row else False
    finally:
        cur.close()
        conn.close()


def get_period_status(company_id: int, period: str) -> dict[str, Any]:
    """
    Returns the full status row for a period.
    Falls back to {"status": "open"} if no row exists yet.
    """
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
    new_status: str,
    user_id: int,
    user_role: str = "admin",
    note: str | None = None,
) -> dict[str, Any]:
    """
    Transition a period to a new status with full guards:
      - Role permission check
      - State machine transition check
      - Pre-close validation (pending transactions, prior period)
      - Audit history write on every change
      - Snapshot capture on hard lock
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        current = _get_current_status(cur, company_id, period)

        _assert_role_permitted(current, user_role)
        _assert_valid_transition(current, new_status)

        if new_status == "closed":
            _run_pre_close_validation(cur, company_id, period)

        if new_status == "locked":
            _capture_snapshot(cur, company_id, period)

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
        """, (company_id, period, new_status, user_id, note))
        row = dict(cur.fetchone())

        _write_audit_history(cur, company_id, period, current, new_status, user_id, note)

        conn.commit()
        return row

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def list_period_statuses(
    company_id: int,
    limit: int = 24,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """
    Returns period statuses newest-first, paginated.
    Default limit of 24 covers 2 years of months without loading
    unbounded history for long-running companies.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT * FROM company_period_statuses
            WHERE company_id = %s
            ORDER BY period DESC
            LIMIT %s OFFSET %s
        """, (company_id, limit, offset))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def get_period_snapshot(company_id: int, period: str) -> dict[str, Any] | None:
    """
    Returns the frozen snapshot for a locked period, or None if not yet locked.
    Use this in your dashboard when mode=snapshot is requested,
    so past review shows figures exactly as they were at lock time.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT * FROM period_snapshots
            WHERE company_id = %s AND period = %s
        """, (company_id, period))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        cur.close()
        conn.close()


def post_adjusting_entry(
    company_id: int,
    branch_id: int,
    amount: float,
    reason: str,
    user_id: int,
    references_period: str,
) -> dict[str, Any]:
    """
    Posts a correction in the current open period that references
    a past locked period. Never touches the locked period itself —
    the snapshot stays clean.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        if not is_period_locked(company_id, references_period):
            raise ValueError(
                f"Period {references_period} is not locked. "
                "Adjusting entries are only needed for locked periods — "
                "re-open the period directly instead."
            )

        cur.execute("""
            INSERT INTO transactions
                (company_id, branch_id, type, amount, date,
                 status, description, is_adjustment, references_period)
            VALUES
                (%s, %s, 'adjustment', %s, CURRENT_DATE,
                 'approved', %s, TRUE, %s)
            RETURNING *
        """, (company_id, branch_id, amount, reason, references_period))
        row = dict(cur.fetchone())
        conn.commit()
        return row

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def list_period_history(
    company_id: int,
    period: str,
) -> list[dict[str, Any]]:
    """
    Returns the full audit trail for a single period —
    every status change, who made it, when, and why.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT
                h.*,
                u.display_name AS changed_by_name
            FROM company_period_status_history h
            LEFT JOIN app_users u ON u.id = h.changed_by
            WHERE h.company_id = %s AND h.period = %s
            ORDER BY h.changed_at ASC
        """, (company_id, period))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()
def run_pre_close_validation(company_id: int, period: str) -> None:
    """Public entry point for the /validate route."""
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _run_pre_close_validation(cur, company_id, period)
    finally:
        cur.close()
        conn.close()