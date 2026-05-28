from typing import Any

import psycopg2

from .connection import get_connection, dict_cursor
from .log_audit import log_audit
from app.security.auth import hash_password


_USER_COLS = """
    u.id,
    u.username,
    u.display_name,
    u.role_id,
    r.name AS role,
    u.is_active,
    u.created_at
"""


def list_companies() -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT id, name, slug, logo_url, plan, max_branches, max_users,
                   is_active, created_at
            FROM companies
            ORDER BY is_active DESC, name
        """)
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def list_company_roles(company_id: int) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _ensure_company(cur, company_id)
        cur.execute("""
            SELECT id, name, description, is_active, created_at
            FROM roles
            WHERE company_id = %s AND is_active = TRUE
            ORDER BY
                CASE name
                    WHEN 'owner' THEN 1
                    WHEN 'admin' THEN 2
                    WHEN 'manager' THEN 3
                    WHEN 'accountant' THEN 4
                    WHEN 'clerk' THEN 5
                    ELSE 9
                END,
                name
        """, (company_id,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def list_company_users(company_id: int) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _ensure_company(cur, company_id)
        cur.execute(f"""
            SELECT {_USER_COLS}
            FROM app_users u
            JOIN roles r ON r.id = u.role_id
            WHERE u.company_id = %s
            ORDER BY u.is_active DESC, u.display_name
        """, (company_id,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def set_company_active(
    company_id: int,
    is_active: bool,
    ip_address: str | None = None,
) -> dict[str, Any]:
    """Activate or deactivate a company. Returns the updated company row."""
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        old = _ensure_company(cur, company_id)
        cur.execute("""
            UPDATE companies
            SET is_active = %s
            WHERE id = %s
            RETURNING id, name, slug, logo_url, plan, max_branches, max_users,
                      is_active, created_at
        """, (is_active, company_id))
        updated = dict(cur.fetchone())

        action = "SUPERADMIN_ACTIVATE" if is_active else "SUPERADMIN_DEACTIVATE"
        log_audit(
            conn,
            company_id=company_id,
            user_id=None,
            action=action,
            table_name="companies",
            record_id=company_id,
            old_data=old,
            new_data=updated,
            ip_address=ip_address,
        )
        conn.commit()
        return updated
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def purge_company_data(
    company_id: int,
    ip_address: str | None = None,
) -> None:
    """
    Delete all operational data for a company while keeping:
      companies, roles, app_users, branches, user_branches, user_permissions,
      role_permissions, permissions, expense_categories intact.

    Deletion is in strict FK-safe order (most-dependent child first).

    Two strategies based on the actual schema:
      - branch-scoped  → DELETE WHERE branch_id IN (SELECT id FROM branches WHERE company_id = %s)
      - company-scoped → DELETE WHERE company_id = %s
      - special        → transfers uses from_branch_id / to_branch_id
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        old = _ensure_company(cur, company_id)

        b = "SELECT id FROM branches WHERE company_id = %s"  # branch subquery

        # ── 1. Leaf tables with no dependants ─────────────────────────────────
        # governance_action_log, kpi_snapshots, period_snapshots, period_closures,
        # accrual/depreciation/prepayment/payroll entries, budgets, assets
        leaf_branch = [
            "governance_action_log",
            "kpi_snapshots",
            "period_snapshots",
            "period_closures",
            "accrual_entries",
            "depreciation_entries",
            "prepayment_entries",
            "payroll_entries",
            "budgets",
            "assets",
            "stock_counts",
            "stock_issues",
        ]
        for table in leaf_branch:
            cur.execute(f"DELETE FROM {table} WHERE branch_id IN ({b})", (company_id,))  # noqa: S608

        # ── 2. Period backups (has both branch_id and company_id) ─────────────
        cur.execute(f"DELETE FROM period_backups WHERE branch_id IN ({b})", (company_id,))

        # ── 3. Petty cash ledger (branch_id + company_id) ─────────────────────
        cur.execute(f"DELETE FROM petty_cash_ledger WHERE branch_id IN ({b})", (company_id,))

        # ── 4. Movement / transaction tables ──────────────────────────────────
        cur.execute(f"DELETE FROM finished_goods_movements WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM inventory_movements      WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM production_costs         WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM waste_log                WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM damage_log               WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM stock_counts             WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM customer_returns         WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM purchase_returns         WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM revenues                 WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM sales                    WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM purchases                WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM expenses                 WHERE branch_id IN ({b})", (company_id,))

        # cash_purchases has both branch_id and company_id — branch delete is enough
        cur.execute(f"DELETE FROM cash_purchases WHERE branch_id IN ({b})", (company_id,))

        # transfers uses from_branch_id (no company_id column)
        cur.execute(
            f"DELETE FROM transfers WHERE from_branch_id IN ({b}) OR to_branch_id IN ({b})",
            (company_id, company_id),
        )

        # ── 5. Approval requests ──────────────────────────────────────────────
        cur.execute(f"DELETE FROM approval_requests WHERE branch_id IN ({b})", (company_id,))

        # ── 6. Company-scoped tables ──────────────────────────────────────────
        # Must come after branch-scoped deletes that reference these rows
        cur.execute("DELETE FROM period_backups          WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM company_period_statuses WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM purchase_invoices        WHERE company_id = %s", (company_id,))

        # recipe_ingredients → recipes → products
        cur.execute("""
            DELETE FROM recipe_ingredients
            WHERE recipe_id IN (
                SELECT r.id FROM recipes r
                JOIN products p ON p.id = r.product_id
                WHERE p.company_id = %s
            )
        """, (company_id,))
        cur.execute("""
            DELETE FROM recipes
            WHERE product_id IN (SELECT id FROM products WHERE company_id = %s)
        """, (company_id,))

        # supplier_price_history → suppliers / ingredients
        cur.execute("""
            DELETE FROM supplier_price_history
            WHERE supplier_id IN (SELECT id FROM suppliers WHERE company_id = %s)
        """, (company_id,))

        cur.execute("DELETE FROM ingredients        WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM products           WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM suppliers          WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM expense_categories WHERE company_id = %s", (company_id,))

        # ── 7. Audit log last (it references everything) ──────────────────────
        cur.execute("DELETE FROM audit_log WHERE company_id = %s", (company_id,))

        log_audit(
            conn,
            company_id=company_id,
            user_id=None,
            action="SUPERADMIN_PURGE",
            table_name="companies",
            record_id=company_id,
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


def deactivate_company(company_id: int, ip_address: str | None = None) -> None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        old = _ensure_company(cur, company_id)
        cur.execute("""
            UPDATE companies
            SET is_active = FALSE
            WHERE id = %s
        """, (company_id,))
        log_audit(
            conn,
            company_id=company_id,
            user_id=None,
            action="SUPERADMIN_DELETE",
            table_name="companies",
            record_id=company_id,
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


def add_company_user(
    company_id: int,
    username: str,
    display_name: str,
    role_id: int,
    password: str,
    ip_address: str | None = None,
) -> dict[str, Any]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        company = _ensure_company(cur, company_id)
        if company["is_active"] is False:
            raise ValueError("Company is inactive")
        _ensure_role(cur, role_id, company_id)
        _ensure_user_limit(cur, company_id, company["max_users"])

        cur.execute("""
            INSERT INTO app_users
                (company_id, username, display_name, role_id, password_hash)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
        """, (
            company_id,
            username.strip(),
            display_name.strip(),
            role_id,
            hash_password(password),
        ))
        user_id = cur.fetchone()["id"]
        user = _get_user(cur, user_id, company_id)

        log_audit(
            conn,
            company_id=company_id,
            user_id=None,
            action="SUPERADMIN_CREATE",
            table_name="app_users",
            record_id=user_id,
            new_data=user,
            ip_address=ip_address,
        )
        conn.commit()
        return user

    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise ValueError("Username already exists for this company")
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def deactivate_company_user(
    company_id: int,
    user_id: int,
    ip_address: str | None = None,
) -> None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        old = _get_user(cur, user_id, company_id)
        if not old:
            raise ValueError("User not found or access denied")

        cur.execute("""
            UPDATE app_users
            SET is_active = FALSE
            WHERE id = %s AND company_id = %s
        """, (user_id, company_id))

        log_audit(
            conn,
            company_id=company_id,
            user_id=None,
            action="SUPERADMIN_DELETE",
            table_name="app_users",
            record_id=user_id,
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


def restore_company_user(
    company_id: int,
    user_id: int,
    ip_address: str | None = None,
) -> dict[str, Any]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        old = _get_user(cur, user_id, company_id)
        if not old:
            raise ValueError("User not found or access denied")
        if old["is_active"] is False:
            company = _ensure_company(cur, company_id)
            _ensure_user_limit(cur, company_id, company["max_users"])

        cur.execute("""
            UPDATE app_users
            SET is_active = TRUE
            WHERE id = %s AND company_id = %s
        """, (user_id, company_id))
        user = _get_user(cur, user_id, company_id)

        log_audit(
            conn,
            company_id=company_id,
            user_id=None,
            action="SUPERADMIN_RESTORE",
            table_name="app_users",
            record_id=user_id,
            old_data=old,
            new_data=user,
            ip_address=ip_address,
        )
        conn.commit()
        return user

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


# ─── Private helpers ──────────────────────────────────────────────────────────

def _ensure_company(cur, company_id: int) -> dict[str, Any]:
    cur.execute("""
        SELECT id, name, is_active, max_users
        FROM companies
        WHERE id = %s
    """, (company_id,))
    company = cur.fetchone()
    if not company:
        raise ValueError("Company not found")
    return dict(company)


def _ensure_role(cur, role_id: int, company_id: int) -> None:
    cur.execute("""
        SELECT id
        FROM roles
        WHERE id = %s AND company_id = %s AND is_active = TRUE
    """, (role_id, company_id))
    if not cur.fetchone():
        raise ValueError("Role not found for this company")


def _ensure_user_limit(cur, company_id: int, max_users: int) -> None:
    cur.execute("""
        SELECT COUNT(*) AS active_users
        FROM app_users
        WHERE company_id = %s AND is_active = TRUE
    """, (company_id,))
    if cur.fetchone()["active_users"] >= max_users:
        raise ValueError("Company user limit reached")


def _get_user(cur, user_id: int, company_id: int) -> dict[str, Any] | None:
    cur.execute(f"""
        SELECT {_USER_COLS}
        FROM app_users u
        JOIN roles r ON r.id = u.role_id
        WHERE u.id = %s AND u.company_id = %s
    """, (user_id, company_id))
    row = cur.fetchone()
    return dict(row) if row else None
def delete_company_forever(company_id: int, ip_address: str | None = None) -> None:
    """Purge all data then hard-delete the company row permanently."""
    # Step 1: purge all operational data (handles all FK-safe deletions)
    purge_company_data(company_id, ip_address=ip_address)

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        old = _ensure_company(cur, company_id)

        # Step 2: log BEFORE deleting the company row (FK constraint)
        log_audit(
            conn,
            company_id=company_id,
            user_id=None,
            action="SUPERADMIN_DELETE",
            table_name="companies",
            record_id=company_id,
            old_data=old,
            ip_address=ip_address,
        )

        # Step 3: remove structural data
        cur.execute("DELETE FROM user_branches   WHERE user_id  IN (SELECT id FROM app_users WHERE company_id = %s)", (company_id,))
        cur.execute("DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM app_users WHERE company_id = %s)", (company_id,))
        cur.execute("DELETE FROM app_users        WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM role_permissions WHERE role_id  IN (SELECT id FROM roles    WHERE company_id = %s)", (company_id,))
        cur.execute("DELETE FROM roles            WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM branches         WHERE company_id = %s", (company_id,))

        # Step 4: audit_log rows must go before companies row (FK)
        cur.execute("DELETE FROM audit_log WHERE company_id = %s", (company_id,))

        # Step 5: finally delete the company itself
        cur.execute("DELETE FROM companies WHERE id = %s", (company_id,))

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()