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
    """Raise if the user's role cannot change this period's state."""
    if user_role not in ROLE_PERMISSIONS[current]:
        raise PermissionError(
            f"Role '{user_role}' cannot change a '{current}' period."
        )


def _assert_prior_period_closed(cur, company_id: int, period: str) -> None:
    """
    Raise if the immediately preceding period exists and is still open.
    No row = period was never touched — allowed for new companies.
    """
    y, m = map(int, period.split("-"))
    prior = f"{y}-{m-1:02d}" if m > 1 else f"{y-1}-12"
    cur.execute("""
        SELECT status FROM company_period_statuses
        WHERE company_id = %s AND period = %s
    """, (company_id, prior))
    row = cur.fetchone()
    if row and row["status"] == "open":
        raise ValueError(
            f"Prior period {prior} must be closed before closing {period}."
        )


def _assert_no_pending_transactions(cur, company_id: int, period: str) -> None:
    """
    Raise if any pending purchases or cash purchases exist in this period.
    Queries the actual schema tables — there is no generic 'transactions' table.
    """
    # Pending POs
    cur.execute("""
        SELECT COUNT(*) AS cnt
        FROM purchases p
        JOIN branches b ON b.id = p.branch_id
        WHERE b.company_id = %s
          AND TO_CHAR(p.entry_date, 'YYYY-MM') = %s
          AND p.status = 'pending'
    """, (company_id, period))
    row = cur.fetchone()
    if row and row["cnt"] > 0:
        raise ValueError(
            f"Period {period} has {row['cnt']} pending purchase order(s). "
            "Approve or reject them before closing."
        )

    # Pending cash purchases
    cur.execute("""
        SELECT COUNT(*) AS cnt
        FROM cash_purchases
        WHERE company_id = %s
          AND TO_CHAR(entry_date, 'YYYY-MM') = %s
          AND status = 'pending'
    """, (company_id, period))
    row = cur.fetchone()
    if row and row["cnt"] > 0:
        raise ValueError(
            f"Period {period} has {row['cnt']} pending cash purchase(s). "
            "Approve or reject them before closing."
        )


def _assert_no_pending_approvals(cur, company_id: int, period: str) -> None:
    """Raise if any approval requests are still pending for this period."""
    cur.execute("""
        SELECT COUNT(*) AS cnt
        FROM approval_requests ar
        JOIN branches b ON b.id = ar.branch_id
        WHERE b.company_id = %s
          AND ar.status = 'pending'
          AND EXISTS (
              SELECT 1 FROM purchases p
              WHERE p.id = ar.entity_id
                AND ar.entity_type = 'purchase'
                AND TO_CHAR(p.entry_date, 'YYYY-MM') = %s
          )
    """, (company_id, period))
    row = cur.fetchone()
    if row and row["cnt"] > 0:
        raise ValueError(
            f"Period {period} has {row['cnt']} purchase(s) awaiting approval. "
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
    Called automatically on hard lock. Uses actual schema tables.
    The snapshot is never modified after creation — adjusting entries
    post to the current open period and reference this one.
    """
    cur.execute("""
        INSERT INTO period_snapshots
            (company_id, period,
             total_sales, total_expenses, total_purchases,
             cogs, gross_profit, inventory_value, snapped_at)
        VALUES (
            %s, %s,
            -- total_sales: net revenue from approved sales
            COALESCE((
                SELECT SUM(s.net_amount)
                FROM sales s
                JOIN branches b ON b.id = s.branch_id
                WHERE b.company_id = %s
                  AND TO_CHAR(s.entry_date, 'YYYY-MM') = %s
                  AND s.status = 'approved'
            ), 0),
            -- total_expenses: all expense entries
            COALESCE((
                SELECT SUM(e.amount)
                FROM expenses e
                JOIN branches b ON b.id = e.branch_id
                WHERE b.company_id = %s
                  AND TO_CHAR(e.entry_date, 'YYYY-MM') = %s
            ), 0),
            -- total_purchases: approved PO payable amounts
            COALESCE((
                SELECT SUM(p.payable_amount)
                FROM purchases p
                JOIN branches b ON b.id = p.branch_id
                WHERE b.company_id = %s
                  AND TO_CHAR(p.entry_date, 'YYYY-MM') = %s
                  AND p.status = 'approved'
            ), 0),
            -- cogs: material cost from production
            COALESCE((
                SELECT SUM(pc.material_cost)
                FROM production_costs pc
                JOIN branches b ON b.id = pc.branch_id
                WHERE b.company_id = %s
                  AND TO_CHAR(pc.entry_date, 'YYYY-MM') = %s
            ), 0),
            -- gross_profit: sales - cogs
            COALESCE((
                SELECT SUM(s.net_amount)
                FROM sales s
                JOIN branches b ON b.id = s.branch_id
                WHERE b.company_id = %s
                  AND TO_CHAR(s.entry_date, 'YYYY-MM') = %s
                  AND s.status = 'approved'
            ), 0)
            - COALESCE((
                SELECT SUM(pc.material_cost)
                FROM production_costs pc
                JOIN branches b ON b.id = pc.branch_id
                WHERE b.company_id = %s
                  AND TO_CHAR(pc.entry_date, 'YYYY-MM') = %s
            ), 0),
            -- inventory_value: running balance from movements ledger
            -- as of the last day of this period
            COALESCE((
                SELECT SUM(im.quantity_delta * im.unit_cost)
                FROM inventory_movements im
                JOIN branches b ON b.id = im.branch_id
                WHERE b.company_id = %s
                  AND im.entry_date <= (
                      ((%s || '-01')::date + interval '1 month' - interval '1 day')::date
                  )
            ), 0),
            NOW()
        )
        ON CONFLICT (company_id, period) DO UPDATE
            SET total_sales      = EXCLUDED.total_sales,
                total_expenses   = EXCLUDED.total_expenses,
                total_purchases  = EXCLUDED.total_purchases,
                cogs             = EXCLUDED.cogs,
                gross_profit     = EXCLUDED.gross_profit,
                inventory_value  = EXCLUDED.inventory_value,
                snapped_at       = EXCLUDED.snapped_at
    """, (
        company_id, period,
        company_id, period,   # total_sales
        company_id, period,   # total_expenses
        company_id, period,   # total_purchases
        company_id, period,   # cogs
        company_id, period,   # gross_profit sales
        company_id, period,   # gross_profit cogs
        company_id, period,   # inventory_value
    ))


# ─── Public API ───────────────────────────────────────────────────────────────

def is_period_frozen(branch_id: int, entry_date: str) -> bool:
    """
    Returns True if the period is closed OR locked.
    Use this guard on every write route (purchases, sales, expenses, etc.).
    Opens its own connection — use is_period_frozen_with_cur inside DB functions.
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
    Use this inside DB functions that already hold a connection
    to avoid hammering the connection pool on every write.
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
    Used to gate adjusting entries and block re-open attempts.
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
      - Pre-close validation (pending items, prior period)
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


def run_pre_close_validation(company_id: int, period: str) -> None:
    """
    Public entry point for the /validate route.
    Raises ValueError with a human-readable message if any check fails.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _run_pre_close_validation(cur, company_id, period)
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
    Default limit of 24 covers 2 years of months.
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
    Use this in the dashboard for stable past-period review.
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
    a past locked period. Never touches the locked period or its snapshot.
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
            INSERT INTO adjusting_entries
                (company_id, branch_id, amount, description,
                 references_period, created_by)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (company_id, branch_id, amount, reason, references_period, user_id))
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
    every status transition, who made it, when, and why.
    Ordered oldest → newest.
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