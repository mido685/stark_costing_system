from typing import Any

import psycopg2

from .connection import get_connection, dict_cursor
from .log_audit import log_audit
from .system_logger import log_event
from app.security.auth import hash_password


# ─── SuperAdmin identity ──────────────────────────────────────────────────────
# All platform-level actions are logged against this company ID.
# This must be the STARK AI / system owner company row in the companies table.
# Never set to a tenant company — this is the internal operator account.
SUPERADMIN_COMPANY_ID = 1


_USER_COLS = """
    u.id,
    u.username,
    u.display_name,
    u.role_id,
    r.name AS role,
    u.is_active,
    u.created_at
"""


# ─── Companies ────────────────────────────────────────────────────────────────

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
                    WHEN 'owner'      THEN 1
                    WHEN 'admin'      THEN 2
                    WHEN 'manager'    THEN 3
                    WHEN 'accountant' THEN 4
                    WHEN 'clerk'      THEN 5
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
        log_event(
            conn,
            company_id=SUPERADMIN_COMPANY_ID,
            action="activated" if is_active else "deactivated",
            category="security",
            level="warning" if not is_active else "info",
            entity_type="companies",
            entity_id=company_id,
            payload={
                "target_company":    old["name"],
                "target_company_id": company_id,
                "is_active":         is_active,
            },
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
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        old = _ensure_company(cur, company_id)

        b = "SELECT id FROM branches WHERE company_id = %s"

        # ── 1. Leaf tables (branch-scoped, no dependants) ─────────────────────
        for table in [
            "governance_action_log",
            "kpi_snapshots",
            "period_closures",
            "accrual_entries",
            "depreciation_entries",
            "prepayment_entries",
            "payroll_entries",
            "budgets",
            "assets",
            "stock_issues",
            "stock_counts",
            "stock_adjustments",
        ]:
            cur.execute(
                f"DELETE FROM {table} WHERE branch_id IN ({b})",  # noqa: S608
                (company_id,),
            )

        # ── 2. Period backups (branch-scoped first) ───────────────────────────
        cur.execute(f"DELETE FROM period_backups    WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM petty_cash_ledger WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM adjusting_entries WHERE branch_id IN ({b})", (company_id,))

        # ── 3. GRN — references purchases and branches ────────────────────────
        cur.execute(f"DELETE FROM goods_receipts WHERE branch_id IN ({b})", (company_id,))

        # ── 4. Movement / transaction tables ──────────────────────────────────
        cur.execute(f"DELETE FROM finished_goods_movements WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM inventory_movements      WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM production_costs         WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM waste_log                WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM damage_log               WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM customer_returns         WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM purchase_returns         WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM revenues                 WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM sales                    WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM expenses                 WHERE branch_id IN ({b})", (company_id,))
        cur.execute(f"DELETE FROM cash_purchases           WHERE branch_id IN ({b})", (company_id,))

        # transfers uses from/to branch ids
        cur.execute(
            f"DELETE FROM transfers WHERE from_branch_id IN ({b}) OR to_branch_id IN ({b})",
            (company_id, company_id),
        )

        # ── 5. Purchase history then purchases ────────────────────────────────
        cur.execute("DELETE FROM purchase_history WHERE company_id = %s", (company_id,))
        cur.execute(f"DELETE FROM purchases WHERE branch_id IN ({b})", (company_id,))

        # ── 6. Approval requests ──────────────────────────────────────────────
        cur.execute(f"DELETE FROM approval_requests WHERE branch_id IN ({b})", (company_id,))

        # ── 7. Company-scoped tables ──────────────────────────────────────────
        cur.execute("DELETE FROM period_backups                WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM period_snapshots              WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM company_period_status_history WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM company_period_statuses       WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM purchase_invoices             WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM adjusting_entries             WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM employee_groups               WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM sku_prefixes                  WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM company_po_sequences          WHERE company_id = %s", (company_id,))

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

        # supplier_price_history → suppliers
        cur.execute("""
            DELETE FROM supplier_price_history
            WHERE supplier_id IN (SELECT id FROM suppliers WHERE company_id = %s)
        """, (company_id,))

        cur.execute("DELETE FROM standard_cost_history WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM ingredients           WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM products              WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM suppliers             WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM expense_categories    WHERE company_id = %s", (company_id,))

        # ── 8. Tenant system_logs and audit_log ───────────────────────────────
        cur.execute("DELETE FROM system_logs WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM audit_log   WHERE company_id = %s", (company_id,))

        # ── 9. Log the purge against the SUPERADMIN company (safe — not deleted) ──
        log_audit(
            conn,
            company_id=company_id,       # will be gone after commit but written now
            user_id=None,
            action="SUPERADMIN_PURGE",
            table_name="companies",
            record_id=company_id,
            old_data=old,
            ip_address=ip_address,
        )
        log_event(
            conn,
            company_id=SUPERADMIN_COMPANY_ID,   # ← safe: never deleted
            action="purged",
            category="security",
            level="critical",
            entity_type="companies",
            entity_id=company_id,
            payload={
                "target_company":    old["name"],
                "target_company_id": company_id,
                "scope":             "all_operational_data",
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


def deactivate_company(company_id: int, ip_address: str | None = None) -> None:
    """Soft-delete: set is_active = FALSE."""
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
        log_event(
            conn,
            company_id=SUPERADMIN_COMPANY_ID,
            action="deactivated",
            category="security",
            level="warning",
            entity_type="companies",
            entity_id=company_id,
            payload={
                "target_company":    old["name"],
                "target_company_id": company_id,
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
        log_event(
            conn,
            company_id=SUPERADMIN_COMPANY_ID,
            action="user_created",
            category="security",
            entity_type="app_users",
            entity_id=user_id,
            payload={
                "target_company":    company["name"],
                "target_company_id": company_id,
                "username":          username.strip(),
                "display_name":      display_name.strip(),
                "role_id":           role_id,
            },
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
        company = _ensure_company(cur, company_id)

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
        log_event(
            conn,
            company_id=SUPERADMIN_COMPANY_ID,
            action="user_deactivated",
            category="security",
            level="warning",
            entity_type="app_users",
            entity_id=user_id,
            payload={
                "target_company":    company["name"],
                "target_company_id": company_id,
                "username":          old["username"],
                "display_name":      old["display_name"],
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
        company = _ensure_company(cur, company_id)
        if old["is_active"] is False:
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
        log_event(
            conn,
            company_id=SUPERADMIN_COMPANY_ID,
            action="user_restored",
            category="security",
            entity_type="app_users",
            entity_id=user_id,
            payload={
                "target_company":    company["name"],
                "target_company_id": company_id,
                "username":          user["username"],
                "display_name":      user["display_name"],
            },
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


def delete_company_forever(company_id: int, ip_address: str | None = None) -> None:
    """Purge all operational data then hard-delete the company row permanently."""

    # Step 1: purge all operational data (includes system_logs + audit_log for tenant)
    purge_company_data(company_id, ip_address=ip_address)

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        old = _ensure_company(cur, company_id)

        # Step 2: log against SUPERADMIN_COMPANY_ID BEFORE the hard delete
        # (safe — SUPERADMIN_COMPANY_ID is never the deleted company)
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
        log_event(
            conn,
            company_id=SUPERADMIN_COMPANY_ID,
            action="deleted_forever",
            category="security",
            level="critical",
            entity_type="companies",
            entity_id=company_id,
            payload={
                "target_company":    old["name"],
                "target_company_id": company_id,
                "permanent":         True,
            },
            ip_address=ip_address,
        )

        # Step 3: cascade user/role/branch dependencies
        cur.execute("DELETE FROM user_branches    WHERE user_id IN (SELECT id FROM app_users WHERE company_id = %s)", (company_id,))
        cur.execute("DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM app_users WHERE company_id = %s)", (company_id,))
        cur.execute("DELETE FROM company_period_status_history WHERE company_id = %s", (company_id,))
        cur.execute("""
            DELETE FROM governance_action_log
            WHERE actor_id IN (SELECT id FROM app_users WHERE company_id = %s)
        """, (company_id,))
        cur.execute("""
            DELETE FROM approval_requests
            WHERE requested_by IN (SELECT id FROM app_users WHERE company_id = %s)
               OR approved_by  IN (SELECT id FROM app_users WHERE company_id = %s)
               OR branch_id    IN (SELECT id FROM branches   WHERE company_id = %s)
        """, (company_id, company_id, company_id))
        cur.execute("DELETE FROM app_users        WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id = %s)", (company_id,))
        cur.execute("DELETE FROM roles            WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM branches         WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM sku_prefixes     WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM company_po_sequences WHERE company_id = %s", (company_id,))
        cur.execute("DELETE FROM employee_groups  WHERE company_id = %s", (company_id,))

        # Step 4: clear remaining audit trail for this tenant
        cur.execute("DELETE FROM audit_log WHERE company_id = %s", (company_id,))

        # Step 5: delete the company row itself
        cur.execute("DELETE FROM companies WHERE id = %s", (company_id,))

        conn.commit()
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
        SELECT id FROM roles
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