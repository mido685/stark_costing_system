# app/database/reports.py
"""
All read-heavy reporting queries for the Restaurant Costing System.
Every public function accepts company_id for tenant isolation.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from .connection import get_connection, dict_cursor


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _floatify(value: Any) -> Any:
    """Convert Decimal / numeric DB types to float; leave everything else alone."""
    return float(value) if hasattr(value, "__round__") and not isinstance(value, int) else value


def _row(row: dict[str, Any]) -> dict[str, Any]:
    return {k: _floatify(v) for k, v in row.items()}


def _scalar(cur, sql: str, params: tuple = ()) -> float:
    cur.execute(sql, params)
    row = cur.fetchone()
    if not row:
        return 0.0
    value = next(iter(row.values()))
    return float(value or 0)


def _verify_branch(cur, branch_id: int, company_id: int) -> None:
    """Raise ValueError if branch does not belong to company (tenant guard)."""
    cur.execute(
        "SELECT id FROM branches WHERE id = %s AND company_id = %s AND is_active = TRUE",
        (branch_id, company_id),
    )
    if not cur.fetchone():
        raise ValueError("Branch not found or access denied")


# ─────────────────────────────────────────────────────────────────────────────
# Stable COGS helper
# ─────────────────────────────────────────────────────────────────────────────

def _compute_cogs(cur, branch_id: int, period: str) -> float:
    """
    Return COGS for a branch + period using a three-tier fallback so the
    figure is always stable:

    Tier 1 — production_costs material_cost × qty sold
             Most accurate when production is recorded before/with sales.

    Tier 2 — finished_goods_movements 'sale' rows (weighted avg unit cost)
             Used when production_costs rows exist but don't cover every product.

    Tier 3 — recipe cost × qty sold (theoretical)
             Pure fallback when neither production nor FGM data exists yet.

    The tiers are summed per-product so a product with production data uses
    Tier 1 while a brand-new product with no production records falls through
    to Tier 3 — giving you a complete, never-zero picture.
    """

    # --- Tier 1: production_costs -------------------------------------------
    tier1 = _scalar(cur, """
        SELECT COALESCE(SUM(
            s.quantity * (pc_avg.material_cost / NULLIF(pc_avg.quantity, 0))
        ), 0)
        FROM sales s
        JOIN (
            SELECT product_id,
                   SUM(material_cost) AS material_cost,
                   SUM(quantity)      AS quantity
            FROM production_costs
            WHERE branch_id = %s
              AND TO_CHAR(entry_date, 'YYYY-MM') = %s
            GROUP BY product_id
        ) pc_avg ON pc_avg.product_id = s.product_id
        WHERE s.branch_id = %s AND s.status = 'approved'
          AND TO_CHAR(s.entry_date, 'YYYY-MM') = %s
    """, (branch_id, period, branch_id, period))

    # Collect which product_ids Tier 1 already covered
    cur.execute("""
        SELECT DISTINCT product_id
        FROM production_costs
        WHERE branch_id = %s AND TO_CHAR(entry_date, 'YYYY-MM') = %s
    """, (branch_id, period))
    covered_by_tier1 = {r["product_id"] for r in cur.fetchall()}

    # --- Tier 2: FGM 'sale' rows for products NOT in Tier 1 -----------------
    if covered_by_tier1:
        cur.execute("""
            SELECT COALESCE(SUM(ABS(fgm.quantity_delta) * fgm.unit_cost), 0)
            FROM finished_goods_movements fgm
            WHERE fgm.branch_id = %s
              AND fgm.movement_type = 'sale'
              AND TO_CHAR(fgm.entry_date, 'YYYY-MM') = %s
              AND fgm.product_id <> ALL(%s)
        """, (branch_id, period, list(covered_by_tier1)))
    else:
        cur.execute("""
            SELECT COALESCE(SUM(ABS(quantity_delta) * unit_cost), 0)
            FROM finished_goods_movements
            WHERE branch_id = %s AND movement_type = 'sale'
              AND TO_CHAR(entry_date, 'YYYY-MM') = %s
        """, (branch_id, period))
    row = cur.fetchone()
    tier2 = float((row[list(row.keys())[0]] if row else 0) or 0)

    # Collect which product_ids Tier 2 covered
    if covered_by_tier1:
        cur.execute("""
            SELECT DISTINCT product_id
            FROM finished_goods_movements
            WHERE branch_id = %s AND movement_type = 'sale'
              AND TO_CHAR(entry_date, 'YYYY-MM') = %s
              AND product_id <> ALL(%s)
        """, (branch_id, period, list(covered_by_tier1)))
    else:
        cur.execute("""
            SELECT DISTINCT product_id
            FROM finished_goods_movements
            WHERE branch_id = %s AND movement_type = 'sale'
              AND TO_CHAR(entry_date, 'YYYY-MM') = %s
        """, (branch_id, period))
    covered_by_tier2 = {r["product_id"] for r in cur.fetchall()}

    # --- Tier 3: recipe cost × qty for products not covered by Tier 1 or 2 --
    all_covered = covered_by_tier1 | covered_by_tier2
    if all_covered:
        cur.execute("""
            SELECT COALESCE(SUM(
                s.quantity * (
                    SELECT COALESCE(SUM(
                        ri.qty_required * i.cost_per_unit
                        / NULLIF(r.yield_pct / 100.0, 0)
                    ), 0)
                    FROM recipes r
                    JOIN recipe_ingredients ri ON ri.recipe_id = r.id
                    JOIN ingredients i         ON i.id = ri.ingredient_id
                    WHERE r.product_id = s.product_id
                )
            ), 0)
            FROM sales s
            WHERE s.branch_id = %s AND s.status = 'approved'
              AND TO_CHAR(s.entry_date, 'YYYY-MM') = %s
              AND s.product_id <> ALL(%s)
        """, (branch_id, period, list(all_covered)))
    else:
        cur.execute("""
            SELECT COALESCE(SUM(
                s.quantity * (
                    SELECT COALESCE(SUM(
                        ri.qty_required * i.cost_per_unit
                        / NULLIF(r.yield_pct / 100.0, 0)
                    ), 0)
                    FROM recipes r
                    JOIN recipe_ingredients ri ON ri.recipe_id = r.id
                    JOIN ingredients i         ON i.id = ri.ingredient_id
                    WHERE r.product_id = s.product_id
                )
            ), 0)
            FROM sales s
            WHERE s.branch_id = %s AND s.status = 'approved'
              AND TO_CHAR(s.entry_date, 'YYYY-MM') = %s
        """, (branch_id, period))
    row = cur.fetchone()
    tier3 = float((row[list(row.keys())[0]] if row else 0) or 0)

    return tier1 + tier2 + tier3


# ─────────────────────────────────────────────────────────────────────────────
# Dashboard
# ─────────────────────────────────────────────────────────────────────────────

def dashboard(
    company_id: int,
    branch_id: int | None = None,
    date_from: str = "",
    date_to: str = "",
) -> dict[str, Any]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        where = ["b.company_id = %s", "s.status = 'approved'"]
        params: list[Any] = [company_id]
        if branch_id:
            where.append("s.branch_id = %s")
            params.append(branch_id)
        if date_from:
            where.append("s.entry_date >= %s")
            params.append(date_from)
        if date_to:
            where.append("s.entry_date <= %s")
            params.append(date_to)

        cur.execute(f"""
            SELECT COALESCE(SUM(s.net_amount), 0) AS total
            FROM sales s
            JOIN branches b ON b.id = s.branch_id
            WHERE {' AND '.join(where)}
        """, params)
        total_sales = float(cur.fetchone()["total"] or 0)

        today = date.today()
        this_month = today.strftime("%Y-%m")
        last_month = (
            f"{today.year}-{today.month - 1:02d}"
            if today.month > 1
            else f"{today.year - 1}-12"
        )

        this_month_sales = _scalar(cur, """
            SELECT COALESCE(SUM(s.net_amount), 0)
            FROM sales s
            JOIN branches b ON b.id = s.branch_id
            WHERE b.company_id = %s AND s.status = 'approved'
              AND TO_CHAR(s.entry_date, 'YYYY-MM') = %s
        """, (company_id, this_month))

        last_month_sales = _scalar(cur, """
            SELECT COALESCE(SUM(s.net_amount), 0)
            FROM sales s
            JOIN branches b ON b.id = s.branch_id
            WHERE b.company_id = %s AND s.status = 'approved'
              AND TO_CHAR(s.entry_date, 'YYYY-MM') = %s
        """, (company_id, last_month))

        if last_month_sales > 0:
            sales_change = round(
                (this_month_sales - last_month_sales) / last_month_sales * 100, 1
            )
        elif this_month_sales > 0:
            sales_change = 100.0
        else:
            sales_change = 0.0

        cur.execute("""
            SELECT s.id, s.entry_date::text AS date,
                   p.name || ' - ' || b.name AS description,
                   s.net_amount AS amount, s.status
            FROM sales s
            JOIN products  p ON p.id = s.product_id
            JOIN branches  b ON b.id = s.branch_id
            WHERE b.company_id = %s
            ORDER BY s.entry_date DESC, s.id DESC
            LIMIT 10
        """, (company_id,))
        transactions = []
        for item in cur.fetchall():
            tx = _row(dict(item))
            tx["type"] = "sale"
            transactions.append(tx)

        pending_count = _scalar(cur, """
            SELECT COUNT(*)
            FROM approval_requests ar
            LEFT JOIN branches b ON b.id = ar.branch_id
            WHERE ar.status = 'pending'
              AND (b.company_id = %s OR ar.branch_id IS NULL)
        """, (company_id,))

        branch_count = _scalar(cur, """
            SELECT COUNT(*) FROM branches
            WHERE company_id = %s AND is_active = TRUE
        """, (company_id,))

        inventory_value = _scalar(cur, """
            SELECT COALESCE(SUM(balance_qty * cost_per_unit), 0)
            FROM (
                SELECT i.id, i.cost_per_unit,
                       COALESCE(SUM(im.quantity_delta), 0) AS balance_qty
                FROM ingredients i
                LEFT JOIN inventory_movements im ON im.ingredient_id = i.id
                WHERE i.company_id = %s AND i.is_active = TRUE
                GROUP BY i.id, i.cost_per_unit
            ) stock
        """, (company_id,))

        return {
            "total_sales":         total_sales,
            "inventory_value":     inventory_value,
            "pending_approvals":   int(pending_count),
            "branch_count":        int(branch_count),
            "sales_change":        sales_change,
            "recent_transactions": transactions,
        }
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# KPIs
# ─────────────────────────────────────────────────────────────────────────────

def compute_kpis(branch_id: int, period: str, company_id: int) -> dict[str, Any]:
    """
    Compute and cache KPI snapshot for a branch + period.
    COGS uses the stable three-tier helper so the figure is never silently zero.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)

        revenue = _scalar(cur, """
            SELECT COALESCE(SUM(net_amount), 0)
            FROM sales
            WHERE branch_id = %s AND status = 'approved'
              AND TO_CHAR(entry_date, 'YYYY-MM') = %s
        """, (branch_id, period))

        food_cost = _compute_cogs(cur, branch_id, period)

        labor_cost = _scalar(cur, """
            SELECT COALESCE(SUM(total_amount), 0)
            FROM payroll_entries
            WHERE branch_id = %s AND TO_CHAR(entry_date, 'YYYY-MM') = %s
        """, (branch_id, period))

        waste_cost = _scalar(cur, """
            SELECT COALESCE(SUM(cost_value), 0)
            FROM waste_log
            WHERE branch_id = %s AND TO_CHAR(entry_date, 'YYYY-MM') = %s
        """, (branch_id, period))

        total_expenses = _scalar(cur, """
            SELECT COALESCE(SUM(amount), 0)
            FROM expenses
            WHERE branch_id = %s AND TO_CHAR(entry_date, 'YYYY-MM') = %s
        """, (branch_id, period))

        food_cost_pct  = round(food_cost  / revenue * 100, 2) if revenue else 0.0
        labor_cost_pct = round(labor_cost / revenue * 100, 2) if revenue else 0.0
        gross_profit   = round(revenue - food_cost - waste_cost, 2)
        net_profit     = round(gross_profit - total_expenses - labor_cost, 2)

        cur.execute("""
            INSERT INTO kpi_snapshots
                (branch_id, period, revenue, food_cost, labor_cost,
                 food_cost_pct, labor_cost_pct, waste_cost, gross_profit, net_profit)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (branch_id, period) DO UPDATE
                SET revenue        = EXCLUDED.revenue,
                    food_cost      = EXCLUDED.food_cost,
                    labor_cost     = EXCLUDED.labor_cost,
                    food_cost_pct  = EXCLUDED.food_cost_pct,
                    labor_cost_pct = EXCLUDED.labor_cost_pct,
                    waste_cost     = EXCLUDED.waste_cost,
                    gross_profit   = EXCLUDED.gross_profit,
                    net_profit     = EXCLUDED.net_profit,
                    computed_at    = NOW()
        """, (branch_id, period, revenue, food_cost, labor_cost,
              food_cost_pct, labor_cost_pct, waste_cost, gross_profit, net_profit))
        conn.commit()

        return {
            "branch_id":      branch_id,
            "period":         period,
            "revenue":        revenue,
            "food_cost":      food_cost,
            "food_cost_pct":  food_cost_pct,
            "labor_cost":     labor_cost,
            "labor_cost_pct": labor_cost_pct,
            "waste_cost":     waste_cost,
            "gross_profit":   gross_profit,
            "net_profit":     net_profit,
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# P&L Report
# ─────────────────────────────────────────────────────────────────────────────

def get_pl_report(branch_id: int, period: str, company_id: int) -> dict[str, Any]:
    """
    Full Profit & Loss for a branch + YYYY-MM period.
    COGS uses the same stable three-tier helper as compute_kpis.
    """
    kpi = compute_kpis(branch_id, period, company_id)

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        def _grouped(table: str, label_col: str, amount_col: str = "amount") -> list[dict[str, Any]]:
            """Group a time-series table by a label column for the given branch + period."""
            cur.execute(f"""
                SELECT {label_col} AS label,
                       COALESCE(SUM({amount_col}), 0) AS amount
                FROM {table}
                WHERE branch_id = %s AND TO_CHAR(entry_date, 'YYYY-MM') = %s
                GROUP BY {label_col}
                ORDER BY amount DESC
            """, (branch_id, period))
            return [_row({"category": r["label"], "amount": r["amount"]}) for r in cur.fetchall()]

        # Operating expenses — keep raw category column; NULL becomes its own group
        cur.execute("""
            SELECT category,
                   COALESCE(SUM(amount), 0) AS amount
            FROM expenses
            WHERE branch_id = %s AND TO_CHAR(entry_date, 'YYYY-MM') = %s
            GROUP BY category
            ORDER BY amount DESC
        """, (branch_id, period))
        expenses = [_row(dict(r)) for r in cur.fetchall()]

        payroll      = _grouped("payroll_entries",     "employee_group", "total_amount")
        depreciation = _grouped("depreciation_entries","asset_name")
        accruals     = _grouped("accrual_entries",     "category")
        prepayments  = _grouped("prepayment_entries",  "category", "monthly_expense")

        total_expenses     = sum(r["amount"] for r in expenses)
        total_payroll      = sum(r["amount"] for r in payroll)
        total_depreciation = sum(r["amount"] for r in depreciation)
        total_accruals     = sum(r["amount"] for r in accruals)
        total_prepayments  = sum(r["amount"] for r in prepayments)
        total_operating    = (
            total_expenses + total_payroll + total_depreciation
            + total_accruals + total_prepayments
        )
        operating_profit = kpi["gross_profit"] - total_operating
        revenue = kpi["revenue"]

        food_cost_pct    = kpi["food_cost_pct"]
        labor_cost_pct   = kpi["labor_cost_pct"]
        gross_margin_pct = round(kpi["gross_profit"]  / revenue * 100, 2) if revenue else 0.0
        net_margin_pct   = round(operating_profit     / revenue * 100, 2) if revenue else 0.0

        return {
            # KPI core
            "period":          period,
            "branch_id":       branch_id,
            "revenue":         round(revenue, 2),
            "food_cost":       round(kpi["food_cost"], 2),
            "cogs":            round(kpi["food_cost"], 2),
            "waste_cost":      round(kpi["waste_cost"], 2),
            "gross_profit":    round(kpi["gross_profit"], 2),
            "labor_cost":      round(kpi["labor_cost"], 2),
            # Line-item breakdowns
            "expenses":                 expenses,
            "total_expenses":           round(total_expenses, 2),
            "payroll":                  payroll,
            "total_payroll":            round(total_payroll, 2),
            "depreciation":             depreciation,
            "total_depreciation":       round(total_depreciation, 2),
            "accruals":                 accruals,
            "total_accruals":           round(total_accruals, 2),
            "prepayments":              prepayments,
            "total_prepayments":        round(total_prepayments, 2),
            "total_operating_expenses": round(total_operating, 2),
            "operating_profit":         round(operating_profit, 2),
            # Ratios
            "food_cost_pct":    food_cost_pct,
            "labor_cost_pct":   labor_cost_pct,
            "gross_margin_pct": gross_margin_pct,
            "net_margin_pct":   net_margin_pct,
        }
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Food Cost Trend
# ─────────────────────────────────────────────────────────────────────────────

def get_food_cost_trend(
    branch_id: int, months: int, company_id: int
) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)
        months = max(1, min(int(months or 6), 24))
        cur.execute("""
            SELECT ks.period, ks.revenue, ks.food_cost, ks.food_cost_pct,
                   ks.labor_cost, ks.labor_cost_pct, ks.waste_cost,
                   ks.gross_profit, ks.net_profit
            FROM kpi_snapshots ks
            WHERE ks.branch_id = %s
            ORDER BY ks.period DESC
            LIMIT %s
        """, (branch_id, months))
        return list(reversed([_row(dict(r)) for r in cur.fetchall()]))
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Variance Reports
# ─────────────────────────────────────────────────────────────────────────────

def get_variance_report(
    branch_id: int, period: str, company_id: int
) -> list[dict[str, Any]]:
    """
    Recipe-based variance: theoretical ingredient consumption vs actual issues.
    Single-query CTE — much faster than the original Python loop approach.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)
        cur.execute("""
            WITH sold AS (
                SELECT product_id, SUM(quantity) AS qty_sold
                FROM sales
                WHERE branch_id = %s AND status = 'approved'
                  AND TO_CHAR(entry_date, 'YYYY-MM') = %s
                GROUP BY product_id
            ),
            theoretical AS (
                SELECT ri.ingredient_id,
                       SUM(
                           s.qty_sold * ri.qty_required
                           / NULLIF(r.yield_pct / 100.0, 0)
                       ) AS theoretical_qty
                FROM sold s
                JOIN recipes r             ON r.product_id  = s.product_id
                JOIN recipe_ingredients ri ON ri.recipe_id  = r.id
                GROUP BY ri.ingredient_id
            ),
            actual AS (
                SELECT ingredient_id,
                       SUM(ABS(quantity_delta)) AS actual_qty
                FROM inventory_movements
                WHERE branch_id = %s AND movement_type = 'issue'
                  AND TO_CHAR(entry_date, 'YYYY-MM') = %s
                GROUP BY ingredient_id
            )
            SELECT
                i.id                                                    AS ingredient_id,
                i.name                                                  AS ingredient_name,
                i.unit,
                ROUND(i.cost_per_unit::numeric, 4)                     AS cost_per_unit,
                ROUND(COALESCE(t.theoretical_qty, 0)::numeric, 3)      AS theoretical_qty,
                ROUND(COALESCE(a.actual_qty,      0)::numeric, 3)      AS actual_qty,
                ROUND((COALESCE(a.actual_qty, 0)
                     - COALESCE(t.theoretical_qty, 0))::numeric, 3)    AS variance_qty,
                CASE
                    WHEN COALESCE(t.theoretical_qty, 0) <> 0
                    THEN ROUND(
                        (COALESCE(a.actual_qty, 0) - COALESCE(t.theoretical_qty, 0))
                        / t.theoretical_qty * 100, 2)
                    ELSE 0
                END                                                     AS variance_pct,
                ROUND((
                    (COALESCE(a.actual_qty, 0) - COALESCE(t.theoretical_qty, 0))
                    * i.cost_per_unit
                )::numeric, 2)                                          AS variance_cost
            FROM ingredients i
            LEFT JOIN theoretical t ON t.ingredient_id = i.id
            LEFT JOIN actual      a ON a.ingredient_id = i.id
            WHERE i.company_id = %s
              AND i.is_active = TRUE
              AND (COALESCE(t.theoretical_qty, 0) <> 0
                   OR COALESCE(a.actual_qty,   0) <> 0)
            ORDER BY ABS(
                (COALESCE(a.actual_qty, 0) - COALESCE(t.theoretical_qty, 0))
                * i.cost_per_unit
            ) DESC
        """, (branch_id, period, branch_id, period, company_id))
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def get_variance_legacy(
    company_id: int,
    branch_id: int | None = None,
    date_from: str = "",
    date_to: str = "",
) -> list[dict[str, Any]]:
    """
    Simpler date-range variance based on movement types (no recipe needed).
    Useful for ad-hoc investigation outside of a calendar month boundary.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        join_conditions = ["i.company_id = %s", "im.ingredient_id = i.id"]
        params: list[Any] = [company_id]
        if branch_id:
            join_conditions.append("im.branch_id = %s")
            params.append(branch_id)
        if date_from:
            join_conditions.append("im.entry_date >= %s")
            params.append(date_from)
        if date_to:
            join_conditions.append("im.entry_date <= %s")
            params.append(date_to)

        cur.execute(f"""
            SELECT
                i.id             AS ingredient_id,
                i.name,
                i.unit,
                i.cost_per_unit,
                COALESCE(SUM(im.quantity_delta)
                    FILTER (WHERE im.movement_type = 'issue'), 0)
                                                AS theoretical_usage,
                COALESCE(SUM(ABS(im.quantity_delta))
                    FILTER (WHERE im.movement_type IN ('waste','damage')), 0)
                                                AS actual_usage,
                COALESCE(SUM(ABS(im.quantity_delta))
                    FILTER (WHERE im.movement_type IN ('waste','damage')), 0)
                + COALESCE(SUM(im.quantity_delta)
                    FILTER (WHERE im.movement_type = 'issue'), 0)
                                                AS variance,
                COALESCE(SUM(ABS(im.quantity_delta) * im.unit_cost)
                    FILTER (WHERE im.movement_type IN ('waste','damage')), 0)
                                                AS variance_value
            FROM ingredients i
            LEFT JOIN inventory_movements im
                ON {' AND '.join(join_conditions[1:])}
            WHERE {join_conditions[0]}
              AND i.is_active = TRUE
            GROUP BY i.id, i.name, i.unit, i.cost_per_unit
            HAVING COALESCE(SUM(im.quantity_delta), 0) <> 0
            ORDER BY ABS(COALESCE(SUM(im.quantity_delta), 0)) DESC
        """, params)
        rows = [_row(dict(r)) for r in cur.fetchall()]
        for r in rows:
            theoretical = abs(r["theoretical_usage"])
            r["variance_pct"] = round(r["variance"] / theoretical * 100, 2) if theoretical else 0.0
        return rows
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Audit Log
# ─────────────────────────────────────────────────────────────────────────────

def list_audit_log(
    company_id: int, branch_id: int | None = None, limit: int = 100
) -> list[dict[str, Any]]:
    """
    Query audit_log via app_users (which carries company_id).
    audit_log has no company_id / branch_id columns directly.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        if branch_id:
            # Filter to entries whose details mention this branch
            cur.execute("""
                SELECT al.id, al.action, al.entity_type, al.entity_id,
                       al.details, al.created_at,
                       u.display_name AS user_name, u.company_id
                FROM audit_log al
                LEFT JOIN app_users u ON u.id = al.user_id
                WHERE u.company_id = %s
                  AND al.details ILIKE %s
                ORDER BY al.created_at DESC, al.id DESC
                LIMIT %s
            """, (company_id, f"%branch: {branch_id}%", limit))
        else:
            cur.execute("""
                SELECT al.id, al.action, al.entity_type, al.entity_id,
                       al.details, al.created_at,
                       u.display_name AS user_name, u.company_id
                FROM audit_log al
                LEFT JOIN app_users u ON u.id = al.user_id
                WHERE u.company_id = %s
                ORDER BY al.created_at DESC, al.id DESC
                LIMIT %s
            """, (company_id, limit))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Budget vs Actual
# ─────────────────────────────────────────────────────────────────────────────

def get_budget_vs_actual(
    company_id: int, branch_id: int, period: str
) -> list[dict[str, Any]]:
    """
    Full budget vs actual across all 6 budget categories.
    Actuals sourced from expenses table (by category) + payroll for 'labor',
    matching the original database.py logic — not derived from KPI arithmetic.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)

        # Actual operating expenses broken down by budget category
        cur.execute("""
            WITH actuals AS (
                -- Map expense categories to budget categories
                SELECT
                    CASE
                        WHEN LOWER(category) LIKE '%rent%'       THEN 'rent'
                        WHEN LOWER(category) LIKE '%utilit%'
                          OR LOWER(category) LIKE '%electric%'
                          OR LOWER(category) LIKE '%water%'      THEN 'utilities'
                        WHEN LOWER(category) LIKE '%market%'
                          OR LOWER(category) LIKE '%advertis%'   THEN 'marketing'
                        WHEN LOWER(category) LIKE '%food%'
                          OR LOWER(category) LIKE '%ingredient%' THEN 'food_cost'
                        ELSE 'other'
                    END AS budget_cat,
                    SUM(amount) AS actual_amount
                FROM expenses
                WHERE branch_id = %s
                  AND TO_CHAR(entry_date, 'YYYY-MM') = %s
                GROUP BY budget_cat

                UNION ALL

                -- Payroll → 'labor'
                SELECT 'labor' AS budget_cat,
                       SUM(total_amount) AS actual_amount
                FROM payroll_entries
                WHERE branch_id = %s
                  AND TO_CHAR(entry_date, 'YYYY-MM') = %s
            ),
            actuals_agg AS (
                SELECT budget_cat, SUM(actual_amount) AS actual_amount
                FROM actuals
                GROUP BY budget_cat
            )
            SELECT
                b.category,
                b.amount                                           AS budget_amount,
                COALESCE(a.actual_amount, 0)                      AS actual_amount,
                b.amount - COALESCE(a.actual_amount, 0)           AS variance,
                CASE WHEN b.amount > 0
                     THEN ROUND(
                         COALESCE(a.actual_amount, 0) / b.amount * 100, 1)
                     ELSE 0
                END                                               AS pct_used
            FROM budgets b
            LEFT JOIN actuals_agg a ON a.budget_cat = b.category
            WHERE b.branch_id = %s AND b.period = %s
            ORDER BY b.category
        """, (branch_id, period, branch_id, period, branch_id, period))

        rows = [_row(dict(r)) for r in cur.fetchall()]

        # Also surface actuals for categories that have spend but no budget line
        seen = {r["category"] for r in rows}
        cur.execute("""
            SELECT
                CASE
                    WHEN LOWER(category) LIKE '%rent%'       THEN 'rent'
                    WHEN LOWER(category) LIKE '%utilit%'
                      OR LOWER(category) LIKE '%electric%'
                      OR LOWER(category) LIKE '%water%'      THEN 'utilities'
                    WHEN LOWER(category) LIKE '%market%'
                      OR LOWER(category) LIKE '%advertis%'   THEN 'marketing'
                    WHEN LOWER(category) LIKE '%food%'
                      OR LOWER(category) LIKE '%ingredient%' THEN 'food_cost'
                    ELSE 'other'
                END AS category,
                COALESCE(SUM(amount), 0) AS actual_amount
            FROM expenses
            WHERE branch_id = %s AND TO_CHAR(entry_date, 'YYYY-MM') = %s
            GROUP BY category
        """, (branch_id, period))
        for r in cur.fetchall():
            if r["category"] not in seen:
                rows.append({
                    "category":      r["category"],
                    "budget_amount": 0.0,
                    "actual_amount": float(r["actual_amount"] or 0),
                    "variance":      -float(r["actual_amount"] or 0),
                    "pct_used":      0.0,
                })

        return rows
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Stock Balances
# ─────────────────────────────────────────────────────────────────────────────

def get_branch_stock_balances(
    company_id: int, branch_id: int
) -> list[dict[str, Any]]:
    """
    Returns per-ingredient stock balance with reorder and negative alert flags.
    Restores the alert fields that were dropped from the previous version.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)
        cur.execute("""
            SELECT
                i.id            AS ingredient_id,
                i.name,
                i.unit,
                i.cost_per_unit,
                i.reorder_level,
                COALESCE(SUM(im.quantity_delta), 0)              AS balance_qty,
                COALESCE(SUM(im.quantity_delta), 0)
                    * i.cost_per_unit                            AS stock_value
            FROM ingredients i
            LEFT JOIN inventory_movements im
                ON im.ingredient_id = i.id AND im.branch_id = %s
            WHERE i.company_id = %s AND i.is_active = TRUE
            GROUP BY i.id, i.name, i.unit, i.cost_per_unit, i.reorder_level
            ORDER BY i.name
        """, (branch_id, company_id))
        rows = [_row(dict(r)) for r in cur.fetchall()]
        for r in rows:
            r["negative_alert"] = r["balance_qty"] < 0
            r["reorder_alert"]  = 0 <= r["balance_qty"] <= r["reorder_level"]
        return rows
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Menu Engineering
# ─────────────────────────────────────────────────────────────────────────────

def get_menu_engineering(
    company_id: int, branch_id: int | None = None
) -> list[dict[str, Any]]:
    """
    Menu engineering matrix (Star / Plow Horse / Puzzle / Dog).
    Recipe cost computed in-SQL — no Python loop per product.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        sale_filter = "AND s.branch_id = %s" if branch_id else ""
        params: list[Any] = [company_id]
        if branch_id:
            params.append(branch_id)
        params.append(company_id)

        cur.execute(f"""
            SELECT
                p.id           AS product_id,
                p.name         AS product_name,
                p.sale_price,
                COALESCE(SUM(s.quantity),   0) AS qty_sold,
                COALESCE(SUM(s.net_amount), 0) AS revenue,
                COALESCE((
                    SELECT SUM(
                        ri.qty_required * i.cost_per_unit
                        / NULLIF(r.yield_pct / 100.0, 0)
                    )
                    FROM recipes r
                    JOIN recipe_ingredients ri ON ri.recipe_id = r.id
                    JOIN ingredients i         ON i.id = ri.ingredient_id
                    WHERE r.product_id = p.id
                ), 0) AS raw_cost
            FROM products p
            LEFT JOIN sales s
                ON s.product_id = p.id AND s.status = 'approved' {sale_filter}
            WHERE p.company_id = %s AND p.is_active = TRUE
            GROUP BY p.id, p.name, p.sale_price
            ORDER BY revenue DESC
        """, params)
        rows = [_row(dict(r)) for r in cur.fetchall()]

        for r in rows:
            r["margin"]        = round(r["sale_price"] - r["raw_cost"], 2)
            r["food_cost_pct"] = (
                round(r["raw_cost"] / r["sale_price"] * 100, 2)
                if r["sale_price"] else 0.0
            )

        if rows:
            avg_qty    = sum(r["qty_sold"] for r in rows) / len(rows)
            avg_margin = sum(r["margin"]   for r in rows) / len(rows)
            for r in rows:
                high_pop    = r["qty_sold"] >= avg_qty
                high_margin = r["margin"]   >= avg_margin
                r["classification"] = (
                    "Star"       if high_pop and high_margin else
                    "Plow Horse" if high_pop                 else
                    "Puzzle"     if high_margin              else
                    "Dog"
                )

        return rows
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Waste Summary
# ─────────────────────────────────────────────────────────────────────────────

def get_waste_summary(
    company_id: int, branch_id: int | None = None
) -> list[dict[str, Any]]:
    """Waste by reason — restores incident count that was missing from v2."""
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        where = ["b.company_id = %s"]
        params: list[Any] = [company_id]
        if branch_id:
            where.append("w.branch_id = %s")
            params.append(branch_id)
        cur.execute(f"""
            SELECT
                w.reason,
                COUNT(*)             AS incidents,
                COALESCE(SUM(w.quantity),   0) AS total_qty,
                COALESCE(SUM(w.cost_value), 0) AS total_cost
            FROM waste_log w
            JOIN branches b ON b.id = w.branch_id
            WHERE {' AND '.join(where)}
            GROUP BY w.reason
            ORDER BY total_cost DESC
        """, params)
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Branch Comparison
# ─────────────────────────────────────────────────────────────────────────────

def compare_branches_by_period(company_id: int, period: str) -> list[dict[str, Any]]:
    """
    Cross-branch P&L for a given YYYY-MM period — single JOIN query.
    Includes waste_cost and labor_cost which were absent from the original.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT
                b.id   AS branch_id,
                b.name AS branch_name,

                COALESCE(SUM(s.net_amount)
                    FILTER (WHERE s.status = 'approved'), 0)                AS revenue,

                COALESCE(SUM(ABS(fgm.quantity_delta) * fgm.unit_cost)
                    FILTER (WHERE fgm.movement_type = 'sale'), 0)            AS food_cost,

                COALESCE(SUM(w.cost_value), 0)                               AS waste_cost,

                COALESCE(SUM(pe.total_amount), 0)                            AS labor_cost,

                COALESCE(SUM(e.amount), 0)                                   AS total_expenses,

                COALESCE(SUM(s.net_amount)
                    FILTER (WHERE s.status = 'approved'), 0)
                - COALESCE(SUM(ABS(fgm.quantity_delta) * fgm.unit_cost)
                    FILTER (WHERE fgm.movement_type = 'sale'), 0)
                - COALESCE(SUM(w.cost_value), 0)                             AS gross_profit,

                COALESCE(SUM(s.net_amount)
                    FILTER (WHERE s.status = 'approved'), 0)
                - COALESCE(SUM(ABS(fgm.quantity_delta) * fgm.unit_cost)
                    FILTER (WHERE fgm.movement_type = 'sale'), 0)
                - COALESCE(SUM(w.cost_value), 0)
                - COALESCE(SUM(pe.total_amount), 0)
                - COALESCE(SUM(e.amount), 0)                                 AS net_profit,

                CASE
                    WHEN COALESCE(SUM(s.net_amount)
                        FILTER (WHERE s.status = 'approved'), 0) > 0
                    THEN ROUND(
                        COALESCE(SUM(ABS(fgm.quantity_delta) * fgm.unit_cost)
                            FILTER (WHERE fgm.movement_type = 'sale'), 0)
                        / NULLIF(SUM(s.net_amount)
                            FILTER (WHERE s.status = 'approved'), 0)
                        * 100, 2)
                    ELSE 0
                END                                                          AS food_cost_pct

            FROM branches b

            LEFT JOIN sales s
                ON  s.branch_id = b.id
                AND TO_CHAR(s.entry_date, 'YYYY-MM') = %s

            LEFT JOIN finished_goods_movements fgm
                ON  fgm.branch_id = b.id
                AND TO_CHAR(fgm.entry_date, 'YYYY-MM') = %s

            LEFT JOIN waste_log w
                ON  w.branch_id = b.id
                AND TO_CHAR(w.entry_date, 'YYYY-MM') = %s

            LEFT JOIN payroll_entries pe
                ON  pe.branch_id = b.id
                AND TO_CHAR(pe.entry_date, 'YYYY-MM') = %s

            LEFT JOIN expenses e
                ON  e.branch_id = b.id
                AND TO_CHAR(e.entry_date, 'YYYY-MM') = %s

            WHERE b.company_id = %s AND b.is_active = TRUE
            GROUP BY b.id, b.name
            ORDER BY net_profit DESC
        """, (period, period, period, period, period, company_id))
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Dashboard Rows (legacy helper — wraps compare_branches_by_period)
# ─────────────────────────────────────────────────────────────────────────────

def get_dashboard_rows(
    company_id: int,
    branch_id: int | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    period = date.today().strftime("%Y-%m")
    rows   = compare_branches_by_period(company_id, period)
    if branch_id:
        rows = [r for r in rows if r["branch_id"] == branch_id]
    summary = {
        "revenue":        round(sum(r["revenue"]        for r in rows), 2),
        "food_cost":      round(sum(r["food_cost"]      for r in rows), 2),
        "waste_cost":     round(sum(r["waste_cost"]     for r in rows), 2),
        "labor_cost":     round(sum(r["labor_cost"]     for r in rows), 2),
        "total_expenses": round(sum(r["total_expenses"] for r in rows), 2),
        "gross_profit":   round(sum(r["gross_profit"]   for r in rows), 2),
        "net_profit":     round(sum(r["net_profit"]     for r in rows), 2),
    }
    return summary, rows


# ─────────────────────────────────────────────────────────────────────────────
# Product Cost Rows
# ─────────────────────────────────────────────────────────────────────────────

def get_product_cost_rows(
    company_id: int, branch_id: int | None = None
) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        where = ["p.company_id = %s"]
        params: list[Any] = [company_id]
        if branch_id:
            where.append("pc.branch_id = %s")
            params.append(branch_id)
        cur.execute(f"""
            SELECT
                p.id   AS product_id,
                p.name AS product_name,
                COALESCE(SUM(pc.quantity), 0) AS quantity,
                COALESCE(SUM(pc.material_cost + pc.labor_cost + pc.overhead_cost), 0)
                                              AS total_cost,
                CASE WHEN COALESCE(SUM(pc.quantity), 0) > 0
                     THEN SUM(pc.material_cost + pc.labor_cost + pc.overhead_cost)
                          / SUM(pc.quantity)
                     ELSE 0
                END                           AS cost_per_unit
            FROM products p
            LEFT JOIN production_costs pc ON pc.product_id = p.id
            WHERE {' AND '.join(where)}
            GROUP BY p.id, p.name
            ORDER BY p.name
        """, params)
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Sales Export
# ─────────────────────────────────────────────────────────────────────────────

def get_sales_export_rows(
    company_id: int,
    branch_id: int,
    date_from: str = "",
    date_to: str = "",
) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        where = ["b.company_id = %s", "s.branch_id = %s"]
        params: list[Any] = [company_id, branch_id]
        if date_from:
            where.append("s.entry_date >= %s")
            params.append(date_from)
        if date_to:
            where.append("s.entry_date <= %s")
            params.append(date_to)
        cur.execute(f"""
            SELECT s.entry_date, p.name AS product,
                   s.quantity, s.unit_price,
                   s.gross_amount, s.discount_amount,
                   s.tax_amount, s.net_amount,
                   s.payment_method, s.status
            FROM sales s
            JOIN branches b ON b.id = s.branch_id
            JOIN products p ON p.id = s.product_id
            WHERE {' AND '.join(where)}
            ORDER BY s.entry_date DESC
        """, params)
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()