# app/database/expenses.py
"""
Accounting entries: expenses, payroll, depreciation, accruals, prepayments,
budgets, period snapshots, period backups, and period management.

Every public function accepts company_id for tenant isolation.
Table names passed to internal helpers are validated against an explicit
whitelist to prevent SQL injection.
"""
from __future__ import annotations

import calendar
from datetime import date, datetime
from typing import Any

import psycopg2.extras

from .connection import get_connection, dict_cursor
from .log_audit import log_audit
from .periods import is_period_frozen, set_period_status
from .reports import compute_kpis

# ─────────────────────────────────────────────────────────────────────────────
# Constants & whitelists
# ─────────────────────────────────────────────────────────────────────────────

BUDGET_CATEGORIES = frozenset({
    "food_cost", "labor", "rent", "utilities", "marketing", "other"
})

# Tables that have branch_id and entry_date columns
_BRANCH_SCOPED_TABLES: frozenset[str] = frozenset({
    "expenses",
    "payroll_entries",
    "depreciation_entries",
    "accrual_entries",
    "prepayment_entries",
    "inventory_movements",
    # add future branch-scoped tables here
})

# Tables that are company-level only (no branch_id, no entry_date)
_COMPANY_SCOPED_TABLES: frozenset[str] = frozenset({
    "period_snapshots",
    # add future company-scoped tables here
})

# Derived — single source of truth, no second definition below
_ALLOWED_LIST_TABLES: frozenset[str] = _BRANCH_SCOPED_TABLES | _COMPANY_SCOPED_TABLES

# Only these tables may be used with _add_simple_amount
_ALLOWED_SIMPLE_TABLES: dict[str, str] = {
    "depreciation_entries": "asset_name",
    "accrual_entries":      "category",
}

# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _floatify(value: Any) -> Any:
    return float(value) if hasattr(value, "__round__") and not isinstance(value, int) else value


def _row(row: dict[str, Any]) -> dict[str, Any]:
    return {k: _floatify(v) for k, v in row.items()}


def _verify_branch(cur, branch_id: int, company_id: int) -> None:
    """Raise ValueError if branch does not belong to company (tenant guard)."""
    cur.execute(
        "SELECT id FROM branches WHERE id = %s AND company_id = %s AND is_active = TRUE",
        (branch_id, company_id),
    )
    if not cur.fetchone():
        raise ValueError("Branch not found or access denied")


def _period_last_day(year: int, month: int) -> str:
    """Return the last calendar day of a month as YYYY-MM-DD string."""
    last = calendar.monthrange(year, month)[1]
    return f"{year}-{month:02d}-{last:02d}"


def _list_entries(
    table: str,
    company_id: int,
    branch_id: int | None,
    period: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    """
    Generic list query for accounting entry tables.
    table must be in _ALLOWED_LIST_TABLES — raises ValueError otherwise.
    Branch and period filtering only applied to branch-scoped tables.
    """
    if table not in _ALLOWED_LIST_TABLES:
        raise ValueError(f"Table '{table}' is not permitted for generic listing")

    is_branch_scoped = table in _BRANCH_SCOPED_TABLES

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        if is_branch_scoped:
            where = ["b.company_id = %s"]
            params: list[Any] = [company_id]
            if branch_id:
                where.append("e.branch_id = %s")
                params.append(branch_id)
            if period:
                where.append("TO_CHAR(e.entry_date, 'YYYY-MM') = %s")
                params.append(period)

            cur.execute(f"""
                SELECT e.*, b.name AS branch_name
                FROM {table} e
                JOIN branches b ON b.id = e.branch_id
                WHERE {' AND '.join(where)}
                ORDER BY e.entry_date DESC, e.id DESC
                LIMIT %s
            """, params + [limit])

        else:
            # Company-scoped table: no branch join, no entry_date
            cur.execute(f"""
                SELECT e.*
                FROM {table} e
                WHERE e.company_id = %s
                ORDER BY e.id DESC
                LIMIT %s
            """, [company_id, limit])

        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()

def _add_simple_amount(
    table: str,
    company_id: int,
    user_id: int,
    branch_id: int,
    entry_date: str,
    label: str,
    amount: float,
    notes: str = "",
    ip_address: str | None = None,
) -> dict[str, Any]:
    """
    Generic INSERT for tables with (branch_id, entry_date, <label_col>, amount, notes).
    table must be in _ALLOWED_SIMPLE_TABLES.
    """
    if table not in _ALLOWED_SIMPLE_TABLES:
        raise ValueError(f"Table '{table}' is not permitted for generic inserts")
    if amount <= 0:
        raise ValueError("amount must be greater than zero")
    if is_period_frozen(branch_id, entry_date):
        raise ValueError("This accounting period is frozen for the selected branch")

    label_col = _ALLOWED_SIMPLE_TABLES[table]

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)
        # table and label_col are both whitelist-validated above
        cur.execute(f"""
            INSERT INTO {table} (branch_id, entry_date, {label_col}, amount, notes)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *
        """, (branch_id, entry_date, label, amount, notes))
        row = _row(dict(cur.fetchone()))
        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            branch_id=branch_id,
            action="CREATE",
            table_name=table,
            record_id=row["id"],
            new_data=row,
            ip_address=ip_address,
        )
        conn.commit()
        return row
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def _delete_entry(
    table: str,
    entry_id: int,
    company_id: int,
    user_id: int,
    ip_address: str | None = None,
) -> None:
    """
    Generic soft-guarded delete for accounting entry tables.
    Checks tenant isolation via branch → company and period closure.
    """
    if table not in _ALLOWED_LIST_TABLES:
        raise ValueError(f"Table '{table}' is not permitted for generic deletes")

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(f"""
            SELECT e.* FROM {table} e
            JOIN branches b ON b.id = e.branch_id
            WHERE e.id = %s AND b.company_id = %s
            FOR UPDATE
        """, (entry_id, company_id))
        old = cur.fetchone()
        if not old:
            raise ValueError("Record not found or access denied")
        old = dict(old)

        if is_period_frozen(old["branch_id"], str(old["entry_date"])):
            raise ValueError("Cannot delete — accounting period is frozen")

        cur.execute(f"DELETE FROM {table} WHERE id = %s", (entry_id,))
        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            branch_id=old["branch_id"],
            action="DELETE",
            table_name=table,
            record_id=entry_id,
            old_data=old,
            ip_address=ip_address,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Expenses
# ─────────────────────────────────────────────────────────────────────────────

def list_expenses(
    company_id: int,
    branch_id: int | None = None,
    period: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    return _list_entries("expenses", company_id, branch_id, period, limit)


def add_expense(
    company_id: int,
    user_id: int,
    branch_id: int,
    entry_date: str,
    category: str,
    amount: float,
    expense_group: str = "operating",
    subtype: str = "admin",
    notes: str = "",
    ip_address: str | None = None,
) -> dict[str, Any]:
    if amount <= 0:
        raise ValueError("amount must be greater than zero")
    if not category or not category.strip():
        raise ValueError("category cannot be empty")
    if is_period_frozen(branch_id, entry_date):
        raise ValueError("This accounting period is frozen for the selected branch")

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)
        cur.execute("""
            INSERT INTO expenses
                (branch_id, entry_date, category, expense_group, subtype, amount, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (branch_id, entry_date, category.strip(), expense_group, subtype, amount, notes))
        row = _row(dict(cur.fetchone()))
        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            branch_id=branch_id,
            action="CREATE",
            table_name="expenses",
            record_id=row["id"],
            new_data=row,
            ip_address=ip_address,
        )
        conn.commit()
        return row
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def delete_expense(
    expense_id: int,
    company_id: int,
    user_id: int,
    ip_address: str | None = None,
) -> None:
    _delete_entry("expenses", expense_id, company_id, user_id, ip_address)


# ─────────────────────────────────────────────────────────────────────────────
# Payroll
# ─────────────────────────────────────────────────────────────────────────────

def list_payroll_entries(
    company_id: int,
    branch_id: int | None = None,
    period: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    return _list_entries("payroll_entries", company_id, branch_id, period, limit)


def add_payroll(
    company_id: int,
    user_id: int,
    branch_id: int,
    entry_date: str,
    employee_group: str,
    base_salary: float,
    employer_burden: float,
    notes: str = "",
    ip_address: str | None = None,
) -> dict[str, Any]:
    if base_salary < 0 or employer_burden < 0:
        raise ValueError("base_salary and employer_burden must be >= 0")
    if base_salary + employer_burden <= 0:
        raise ValueError("Total payroll amount must be greater than zero")
    if not employee_group or not employee_group.strip():
        raise ValueError("employee_group cannot be empty")
    if is_period_frozen(branch_id, entry_date):
        raise ValueError("This accounting period is frozen for the selected branch")

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)
        total = base_salary + employer_burden
        cur.execute("""
            INSERT INTO payroll_entries
                (branch_id, entry_date, employee_group,
                 base_salary, employer_burden, total_amount, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (branch_id, entry_date, employee_group.strip(),
              base_salary, employer_burden, total, notes))
        row = _row(dict(cur.fetchone()))
        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            branch_id=branch_id,
            action="CREATE",
            table_name="payroll_entries",
            record_id=row["id"],
            new_data=row,
            ip_address=ip_address,
        )
        conn.commit()
        return row
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def delete_payroll(
    entry_id: int,
    company_id: int,
    user_id: int,
    ip_address: str | None = None,
) -> None:
    _delete_entry("payroll_entries", entry_id, company_id, user_id, ip_address)


# ─────────────────────────────────────────────────────────────────────────────
# Depreciation
# ─────────────────────────────────────────────────────────────────────────────

def list_depreciation_entries(
    company_id: int,
    branch_id: int | None = None,
    period: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    return _list_entries("depreciation_entries", company_id, branch_id, period, limit)


def add_depreciation(
    company_id: int,
    user_id: int,
    branch_id: int,
    entry_date: str,
    asset_name: str,
    amount: float,
    notes: str = "",
    ip_address: str | None = None,
) -> dict[str, Any]:
    """Explicit signature — no *args magic, fully type-checkable."""
    if not asset_name or not asset_name.strip():
        raise ValueError("asset_name cannot be empty")
    return _add_simple_amount(
        "depreciation_entries", company_id, user_id, branch_id,
        entry_date, asset_name.strip(), amount, notes, ip_address,
    )


def delete_depreciation(
    entry_id: int,
    company_id: int,
    user_id: int,
    ip_address: str | None = None,
) -> None:
    _delete_entry("depreciation_entries", entry_id, company_id, user_id, ip_address)


# ─────────────────────────────────────────────────────────────────────────────
# Accruals
# ─────────────────────────────────────────────────────────────────────────────

def list_accrual_entries(
    company_id: int,
    branch_id: int | None = None,
    period: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    return _list_entries("accrual_entries", company_id, branch_id, period, limit)


def add_accrual(
    company_id: int,
    user_id: int,
    branch_id: int,
    entry_date: str,
    category: str,
    amount: float,
    notes: str = "",
    ip_address: str | None = None,
) -> dict[str, Any]:
    """Explicit signature — no *args magic, fully type-checkable."""
    if not category or not category.strip():
        raise ValueError("category cannot be empty")
    return _add_simple_amount(
        "accrual_entries", company_id, user_id, branch_id,
        entry_date, category.strip(), amount, notes, ip_address,
    )


def delete_accrual(
    entry_id: int,
    company_id: int,
    user_id: int,
    ip_address: str | None = None,
) -> None:
    _delete_entry("accrual_entries", entry_id, company_id, user_id, ip_address)


# ─────────────────────────────────────────────────────────────────────────────
# Prepayments
# ─────────────────────────────────────────────────────────────────────────────

def list_prepayment_entries(
    company_id: int,
    branch_id: int | None = None,
    period: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    return _list_entries("prepayment_entries", company_id, branch_id, period, limit)


def add_prepayment(
    company_id: int,
    user_id: int,
    branch_id: int,
    entry_date: str,
    category: str,
    amount: float,
    months: int,
    notes: str = "",
    ip_address: str | None = None,
) -> dict[str, Any]:
    if not category or not category.strip():
        raise ValueError("category cannot be empty")
    if amount <= 0:
        raise ValueError("amount must be greater than zero")
    if months <= 0:
        raise ValueError("months must be greater than zero")
    if is_period_frozen(branch_id, entry_date):
        raise ValueError("This accounting period is frozen for the selected branch")

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)
        monthly = round(amount / months, 2)
        cur.execute("""
            INSERT INTO prepayment_entries
                (branch_id, entry_date, category, amount, months, monthly_expense, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (branch_id, entry_date, category.strip(), amount, months, monthly, notes))
        row = _row(dict(cur.fetchone()))
        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            branch_id=branch_id,
            action="CREATE",
            table_name="prepayment_entries",
            record_id=row["id"],
            new_data=row,
            ip_address=ip_address,
        )
        conn.commit()
        return row
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def delete_prepayment(
    entry_id: int,
    company_id: int,
    user_id: int,
    ip_address: str | None = None,
) -> None:
    _delete_entry("prepayment_entries", entry_id, company_id, user_id, ip_address)


# ─────────────────────────────────────────────────────────────────────────────
# Budgets
# ─────────────────────────────────────────────────────────────────────────────

def set_budget(
    company_id: int,
    branch_id: int,
    period: str,
    category: str,
    amount: float,
    user_id: int | None = None,
    ip_address: str | None = None,
) -> dict[str, Any]:
    """
    Upsert a budget line for a branch + period + category.
    category must be one of BUDGET_CATEGORIES.
    amount must be >= 0 (a zero budget line is valid — it means "budgeted nothing").
    """
    if category not in BUDGET_CATEGORIES:
        raise ValueError(
            f"category must be one of: {', '.join(sorted(BUDGET_CATEGORIES))}"
        )
    if amount < 0:
        raise ValueError("budget amount must be >= 0")

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)
        cur.execute("""
            INSERT INTO budgets (branch_id, period, category, amount)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (branch_id, period, category)
            DO UPDATE SET amount = EXCLUDED.amount
            RETURNING *
        """, (branch_id, period, category, amount))
        row = _row(dict(cur.fetchone()))
        if user_id:
            log_audit(
                conn,
                company_id=company_id,
                user_id=user_id,
                branch_id=branch_id,
                action="UPSERT",
                table_name="budgets",
                record_id=row["id"],
                new_data=row,
                ip_address=ip_address,
            )
        conn.commit()
        return row
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()
def get_budget_summary(company_id: int, branch_id: int, period: str) -> list[dict[str, Any]]:
    """Return budget vs actual for each category in the given period."""
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)
        cur.execute("""
            SELECT
                b.category,
                b.amount                       AS budgeted,
                COALESCE(SUM(e.amount), 0)     AS actual,
                b.amount - COALESCE(SUM(e.amount), 0) AS variance
            FROM budgets b
            LEFT JOIN expenses e
                ON  e.branch_id = b.branch_id
                AND e.category  = b.category
                AND TO_CHAR(e.entry_date, 'YYYY-MM') = b.period
            WHERE b.branch_id = %s
              AND b.period    = %s
            GROUP BY b.category, b.amount
            ORDER BY b.category
        """, (branch_id, period))
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()
# ─────────────────────────────────────────────────────────────────────────────
# Period Snapshots
# ─────────────────────────────────────────────────────────────────────────────

def create_period_snapshot(
    company_id: int,
    user_id: int,
    period: str,
    total_sales: float = 0,
    total_expenses: float = 0,
    total_purchases: float = 0,
    cogs: float = 0,
    gross_profit: float = 0,
    inventory_value: float = 0,
    ip_address: str | None = None,
) -> dict[str, Any]:
    """
    Upsert a company-level financial snapshot for a given period (YYYY-MM).
    If a snapshot already exists for this company + period, it is refreshed.
    No branch_id — period_snapshots is company-scoped.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            INSERT INTO period_snapshots
                (company_id, period, total_sales, total_expenses,
                 total_purchases, cogs, gross_profit, inventory_value, snapped_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (company_id, period)
            DO UPDATE SET
                total_sales      = EXCLUDED.total_sales,
                total_expenses   = EXCLUDED.total_expenses,
                total_purchases  = EXCLUDED.total_purchases,
                cogs             = EXCLUDED.cogs,
                gross_profit     = EXCLUDED.gross_profit,
                inventory_value  = EXCLUDED.inventory_value,
                snapped_at       = NOW()
            RETURNING *
        """, (
            company_id, period,
            total_sales, total_expenses, total_purchases,
            cogs, gross_profit, inventory_value,
        ))
        row = _row(dict(cur.fetchone()))
        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="UPSERT",
            table_name="period_snapshots",
            record_id=row["id"],
            new_data=row,
            ip_address=ip_address,
        )
        conn.commit()
        return row
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

def list_period_snapshots(
    company_id: int,
    branch_id: int | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    return _list_entries("period_snapshots", company_id, branch_id, None, limit)


# ─────────────────────────────────────────────────────────────────────────────
# Period Backups
# ─────────────────────────────────────────────────────────────────────────────

def _build_backup_payload(
    cur,
    branch_id: int,
    company_id: int,
    period: str,
    period_start: str,
    period_end: str,
    branch_name: str,
) -> dict[str, Any]:
    """
    Build the JSONB payload for a period backup.
    Calls compute_kpis (which also caches the KPI snapshot) and assembles
    a complete financial summary with expenses, payroll, sales, and purchases.
    """
    def scalar(sql: str, params: tuple) -> float:
        cur.execute(sql, params)
        row = cur.fetchone()
        value = next(iter(row.values())) if row else 0
        return float(value or 0)

    def rows(sql: str, params: tuple) -> list[dict[str, Any]]:
        cur.execute(sql, params)
        return [_row(dict(r)) for r in cur.fetchall()]

    opening_raw = scalar("""
        SELECT COALESCE(SUM(quantity_delta * unit_cost), 0)
        FROM inventory_movements
        WHERE branch_id = %s AND entry_date < %s
    """, (branch_id, period_start))

    opening_finished = scalar("""
        SELECT COALESCE(SUM(quantity_delta * unit_cost), 0)
        FROM finished_goods_movements
        WHERE branch_id = %s AND entry_date < %s
    """, (branch_id, period_start))

    closing_raw = scalar("""
        SELECT COALESCE(SUM(quantity_delta * unit_cost), 0)
        FROM inventory_movements
        WHERE branch_id = %s AND entry_date <= %s
    """, (branch_id, period_end))

    closing_finished = scalar("""
        SELECT COALESCE(SUM(quantity_delta * unit_cost), 0)
        FROM finished_goods_movements
        WHERE branch_id = %s AND entry_date <= %s
    """, (branch_id, period_end))

    purchases_value = scalar("""
        SELECT COALESCE(SUM(payable_amount), 0)
        FROM purchases
        WHERE branch_id = %s AND status = 'approved'
          AND entry_date BETWEEN %s AND %s
    """, (branch_id, period_start, period_end))

    # compute_kpis opens its own connection internally — safe to call here
    kpi = compute_kpis(branch_id, period, company_id)

    opening_value = opening_raw + opening_finished
    closing_value = closing_raw + closing_finished

    return {
        "company_id":   company_id,
        "branch_id":    branch_id,
        "branch_name":  branch_name,
        "period":       period,
        "period_start": period_start,
        "period_end":   period_end,
        "summary": {
            "opening_value":   round(opening_value, 2),
            "closing_value":   round(closing_value, 2),
            "purchases_value": round(purchases_value, 2),
            "inventory_cogs":  round(opening_value + purchases_value - closing_value, 2),
            **kpi,
        },
        "expenses": rows("""
            SELECT category, expense_group, subtype,
                   COALESCE(SUM(amount), 0) AS amount
            FROM expenses
            WHERE branch_id = %s AND entry_date BETWEEN %s AND %s
            GROUP BY category, expense_group, subtype
            ORDER BY amount DESC
        """, (branch_id, period_start, period_end)),
        "payroll": rows("""
            SELECT employee_group,
                   COALESCE(SUM(total_amount), 0) AS total_amount
            FROM payroll_entries
            WHERE branch_id = %s AND entry_date BETWEEN %s AND %s
            GROUP BY employee_group
            ORDER BY total_amount DESC
        """, (branch_id, period_start, period_end)),
        "sales": rows("""
            SELECT pr.name AS product_name,
                   COALESCE(SUM(s.quantity),   0) AS quantity,
                   COALESCE(SUM(s.net_amount), 0) AS net_amount
            FROM sales s
            JOIN products pr ON pr.id = s.product_id
            WHERE s.branch_id = %s AND s.status = 'approved'
              AND s.entry_date BETWEEN %s AND %s
            GROUP BY pr.name
            ORDER BY net_amount DESC
        """, (branch_id, period_start, period_end)),
        "purchases": rows("""
            SELECT i.name AS ingredient_name,
                   COALESCE(SUM(p.quantity),       0) AS quantity,
                   COALESCE(SUM(p.payable_amount), 0) AS payable_amount
            FROM purchases p
            JOIN ingredients i ON i.id = p.ingredient_id
            WHERE p.branch_id = %s AND p.status = 'approved'
              AND p.entry_date BETWEEN %s AND %s
            GROUP BY i.name
            ORDER BY payable_amount DESC
        """, (branch_id, period_start, period_end)),
    }


def generate_period_backups(
    company_id: int,
    user_id: int,
    months: int = 4,
    locked_by: str = "",
    notes: str = "",
) -> list[dict[str, Any]]:
    """
    Generate (or refresh) period backup records for all active branches
    for the last `months` calendar months.

    Fixes from v2:
    - Uses calendar.monthrange() to compute correct period_end (no hardcoded -28).
    - Uses datetime arithmetic instead of fragile while-loop month subtraction.
    - Populates backup_data with real P&L payload via _build_backup_payload().
    - months is clamped to 1–24.
    """
    months = max(1, min(int(months), 24))
    today  = date.today()

    # Build list of (period, period_start, period_end) using safe datetime arithmetic
    periods: list[tuple[str, str, str]] = []
    for offset in range(months):
        # Go back `offset` months from the current month
        month = today.month - offset
        year  = today.year
        while month <= 0:
            month += 12
            year  -= 1
        last_day  = calendar.monthrange(year, month)[1]
        period    = f"{year}-{month:02d}"
        p_start   = f"{year}-{month:02d}-01"
        p_end     = f"{year}-{month:02d}-{last_day:02d}"
        periods.append((period, p_start, p_end))

    conn = get_connection()
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute("""
            SELECT id, name FROM branches
            WHERE company_id = %s AND is_active = TRUE
            ORDER BY name
        """, (company_id,))
        branches = [dict(r) for r in cur.fetchall()]

        backups: list[dict[str, Any]] = []
        for branch in branches:
            for period, p_start, p_end in periods:
                payload = _build_backup_payload(
                    cur,
                    branch_id=branch["id"],
                    company_id=company_id,
                    period=period,
                    period_start=p_start,
                    period_end=p_end,
                    branch_name=branch["name"],
                )
                cur.execute("""
                    INSERT INTO period_backups
                        (company_id, branch_id, period, period_start, period_end,
                         backup_data, locked_by, notes, created_by)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (company_id, branch_id, period) DO UPDATE
                        SET period_start = EXCLUDED.period_start,
                            period_end   = EXCLUDED.period_end,
                            backup_data  = EXCLUDED.backup_data,
                            locked_by    = EXCLUDED.locked_by,
                            notes        = EXCLUDED.notes,
                            created_by   = EXCLUDED.created_by,
                            created_at   = NOW()
                    RETURNING *
                """, (
                    company_id, branch["id"], period, p_start, p_end,
                    psycopg2.extras.Json(payload),
                    locked_by, notes, user_id,
                ))
                backups.append(_row(dict(cur.fetchone())))

        conn.commit()
        return backups
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def list_period_backups(
    company_id: int,
    branch_id: int | None = None,
    months: int = 4,
    date_from: str | None = None,
    date_to: str | None = None,
) -> list[dict[str, Any]]:
    months = max(1, min(int(months), 24))
    conn = get_connection()
    cur  = dict_cursor(conn)
    try:
        where  = ["pb.company_id = %s"]
        params: list[Any] = [company_id]
        if branch_id:
            where.append("pb.branch_id = %s")
            params.append(branch_id)
        if date_from:
            where.append("pb.period_end >= %s")
            params.append(date_from)
        if date_to:
            where.append("pb.period_start <= %s")
            params.append(date_to)
        row_limit = months * 100 if not (date_from or date_to) else 2400
        cur.execute(f"""
            SELECT pb.*, b.name AS branch_name
            FROM period_backups pb
            JOIN branches b ON b.id = pb.branch_id
            WHERE {' AND '.join(where)}
            ORDER BY pb.period DESC, b.name
            LIMIT %s
        """, params + [row_limit])
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Period Status & Closure
# ─────────────────────────────────────────────────────────────────────────────
def set_company_period_status(
    company_id: int,
    period: str,
    status: str,
    user_id: int,
    notes: str = "",
    ip_address: str | None = None,
) -> dict[str, Any]:
    row = set_period_status(company_id, period, status, user_id, note=notes)

    # Open a dedicated connection for the audit log
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="SET_PERIOD_STATUS",
            table_name="company_period_statuses",
            record_id=row.get("id"),
            new_data=row,
            ip_address=ip_address,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

    return row

def close_period(
    branch_id: int,
    company_id: int,
    closed_to: str,
    user_id: int,
    notes: str = "",
    ip_address: str | None = None,
) -> dict[str, Any]:
    """
    Insert or update a branch-level period closure.
    company_id is required for tenant isolation — verifies branch ownership
    before writing, which the v2 version did not do.
    """
    conn = get_connection()
    cur  = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)
        cur.execute("""
            INSERT INTO period_closures (branch_id, closed_to, notes, closed_by)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (branch_id, closed_to)
            DO UPDATE SET notes = EXCLUDED.notes, closed_by = EXCLUDED.closed_by
            RETURNING *
        """, (branch_id, closed_to, notes, user_id))
        row = _row(dict(cur.fetchone()))
        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            branch_id=branch_id,
            action="CLOSE_PERIOD",
            table_name="period_closures",
            record_id=row["id"],
            new_data=row,
            ip_address=ip_address,
        )
        conn.commit()
        return row
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()
# ─────────────────────────────────────────────────────────────────────────────
# Expense Categories
# ─────────────────────────────────────────────────────────────────────────────

def list_expense_categories(company_id: int) -> list[dict[str, Any]]:
    conn = get_connection()
    cur  = dict_cursor(conn)
    try:
        cur.execute(
            """SELECT id, name, COALESCE(type, 'expense') AS type
               FROM expense_categories
               WHERE company_id = %s AND is_active = TRUE
               ORDER BY name""",
            (company_id,)
        )
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def create_expense_category(company_id: int, name: str, type_: str) -> dict[str, Any]:
    conn = get_connection()
    cur  = dict_cursor(conn)
    try:
        cur.execute(
            """INSERT INTO expense_categories (company_id, name, type)
               VALUES (%s, %s, %s)
               ON CONFLICT (company_id, name)
               DO UPDATE SET is_active = TRUE, type = EXCLUDED.type
               RETURNING id, name, type""",
            (company_id, name, type_)
        )
        row = dict(cur.fetchone())
        conn.commit()
        return row
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()