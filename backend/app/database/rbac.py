from typing import Any

import psycopg2

from .connection import get_connection, dict_cursor
from .log_audit import log_audit


# ── Roles ─────────────────────────────────────────────────────────────────────

def list_roles(company_id: int) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT id, name, description, is_active, created_at
            FROM roles
            WHERE company_id = %s
            ORDER BY name
        """, (company_id,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def get_role(role_id: int, company_id: int) -> dict[str, Any] | None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT id, name, description, is_active, created_at
            FROM roles
            WHERE id = %s AND company_id = %s
        """, (role_id, company_id))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        cur.close()
        conn.close()


def add_role(
    company_id: int,
    name: str,
    description: str = "",
    actor_id: int | None = None,
    ip_address: str | None = None,
) -> dict[str, Any]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            INSERT INTO roles (company_id, name, description)
            VALUES (%s, %s, %s)
            RETURNING id, name, description, is_active, created_at
        """, (company_id, name, description))
        role = dict(cur.fetchone())

        log_audit(
            conn,
            company_id=company_id,
            user_id=actor_id,
            action="CREATE",
            table_name="roles",
            record_id=role["id"],
            new_data=role,
            ip_address=ip_address,
        )
        conn.commit()
        return role

    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise ValueError(f"Role '{name}' already exists for this company")
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def update_role(
    role_id: int,
    company_id: int,
    name: str | None = None,
    description: str | None = None,
    actor_id: int | None = None,
    ip_address: str | None = None,
) -> dict[str, Any]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT * FROM roles WHERE id = %s AND company_id = %s",
            (role_id, company_id)
        )
        old = cur.fetchone()
        if not old:
            raise ValueError("Role not found or access denied")

        cur.execute("""
            UPDATE roles
            SET name        = COALESCE(%s, name),
                description = COALESCE(%s, description)
            WHERE id = %s AND company_id = %s
            RETURNING id, name, description, is_active, created_at
        """, (name, description, role_id, company_id))
        new = dict(cur.fetchone())

        log_audit(
            conn,
            company_id=company_id,
            user_id=actor_id,
            action="UPDATE",
            table_name="roles",
            record_id=role_id,
            old_data=dict(old),
            new_data=new,
            ip_address=ip_address,
        )
        conn.commit()
        return new

    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise ValueError(f"Role name already exists for this company")
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def toggle_role(
    role_id: int,
    company_id: int,
    actor_id: int | None = None,
    ip_address: str | None = None,
) -> dict[str, Any]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT * FROM roles WHERE id = %s AND company_id = %s",
            (role_id, company_id)
        )
        old = cur.fetchone()
        if not old:
            raise ValueError("Role not found or access denied")

        cur.execute("""
            UPDATE roles SET is_active = NOT is_active
            WHERE id = %s AND company_id = %s
            RETURNING id, name, description, is_active, created_at
        """, (role_id, company_id))
        new = dict(cur.fetchone())

        log_audit(
            conn,
            company_id=company_id,
            user_id=actor_id,
            action="UPDATE",
            table_name="roles",
            record_id=role_id,
            old_data=dict(old),
            new_data=new,
            ip_address=ip_address,
        )
        conn.commit()
        return new

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


# ── Permissions ───────────────────────────────────────────────────────────────

def list_permissions() -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("SELECT id, name, description FROM permissions ORDER BY name")
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def add_permission(
    name: str,
    description: str = "",
) -> dict[str, Any]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            INSERT INTO permissions (name, description)
            VALUES (%s, %s)
            ON CONFLICT (name) DO NOTHING
            RETURNING id, name, description
        """, (name, description))
        row = cur.fetchone()
        conn.commit()
        if not row:
            raise ValueError(f"Permission '{name}' already exists")
        return dict(row)

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


# ── Role-Permissions ──────────────────────────────────────────────────────────

def get_role_permissions(role_id: int, company_id: int) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        # Verify role belongs to company
        cur.execute(
            "SELECT id FROM roles WHERE id = %s AND company_id = %s",
            (role_id, company_id)
        )
        if not cur.fetchone():
            raise ValueError("Role not found or access denied")

        cur.execute("""
            SELECT p.id, p.name, p.description
            FROM permissions p
            JOIN role_permissions rp ON rp.permission_id = p.id
            WHERE rp.role_id = %s
            ORDER BY p.name
        """, (role_id,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def assign_permission_to_role(
    role_id: int,
    permission_id: int,
    company_id: int,
    actor_id: int | None = None,
    ip_address: str | None = None,
) -> dict[str, Any]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        # Verify role belongs to company
        cur.execute(
            "SELECT id FROM roles WHERE id = %s AND company_id = %s",
            (role_id, company_id)
        )
        if not cur.fetchone():
            raise ValueError("Role not found or access denied")

        cur.execute("""
            INSERT INTO role_permissions (role_id, permission_id)
            VALUES (%s, %s)
            ON CONFLICT (role_id, permission_id) DO NOTHING
            RETURNING id, role_id, permission_id
        """, (role_id, permission_id))
        row = cur.fetchone()

        log_audit(
            conn,
            company_id=company_id,
            user_id=actor_id,
            action="CREATE",
            table_name="role_permissions",
            record_id=row["id"] if row else None,
            new_data={"role_id": role_id, "permission_id": permission_id},
            ip_address=ip_address,
        )
        conn.commit()
        return {"role_id": role_id, "permission_id": permission_id, "assigned": True}

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def revoke_permission_from_role(
    role_id: int,
    permission_id: int,
    company_id: int,
    actor_id: int | None = None,
    ip_address: str | None = None,
) -> dict[str, Any]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        # Verify role belongs to company
        cur.execute(
            "SELECT id FROM roles WHERE id = %s AND company_id = %s",
            (role_id, company_id)
        )
        if not cur.fetchone():
            raise ValueError("Role not found or access denied")

        cur.execute("""
            DELETE FROM role_permissions
            WHERE role_id = %s AND permission_id = %s
        """, (role_id, permission_id))

        log_audit(
            conn,
            company_id=company_id,
            user_id=actor_id,
            action="DELETE",
            table_name="role_permissions",
            record_id=None,
            old_data={"role_id": role_id, "permission_id": permission_id},
            ip_address=ip_address,
        )
        conn.commit()
        return {"role_id": role_id, "permission_id": permission_id, "revoked": True}

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


# ── User-Permissions (overrides) ──────────────────────────────────────────────

def get_user_permissions(user_id: int, company_id: int) -> dict[str, Any]:
    """
    Returns both role-level permissions and any user-level overrides.
    is_allowed=True means granted, is_allowed=False means explicitly denied.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        # Verify user belongs to company
        cur.execute(
            "SELECT role_id FROM app_users WHERE id = %s AND company_id = %s",
            (user_id, company_id)
        )
        user = cur.fetchone()
        if not user:
            raise ValueError("User not found or access denied")

        # Role-level permissions
        cur.execute("""
            SELECT p.id, p.name, p.description, TRUE AS is_allowed, 'role' AS source
            FROM permissions p
            JOIN role_permissions rp ON rp.permission_id = p.id
            WHERE rp.role_id = %s
            ORDER BY p.name
        """, (user["role_id"],))
        role_perms = [dict(r) for r in cur.fetchall()]

        # User-level overrides
        cur.execute("""
            SELECT p.id, p.name, p.description, up.is_allowed, 'override' AS source
            FROM permissions p
            JOIN user_permissions up ON up.permission_id = p.id
            WHERE up.user_id = %s
            ORDER BY p.name
        """, (user_id,))
        user_perms = [dict(r) for r in cur.fetchall()]

        return {
            "user_id": user_id,
            "role_permissions": role_perms,
            "user_overrides": user_perms,
        }
    finally:
        cur.close()
        conn.close()


def set_user_permission_override(
    user_id: int,
    permission_id: int,
    is_allowed: bool,
    company_id: int,
    actor_id: int | None = None,
    ip_address: str | None = None,
) -> dict[str, Any]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        # Verify user belongs to company
        cur.execute(
            "SELECT id FROM app_users WHERE id = %s AND company_id = %s",
            (user_id, company_id)
        )
        if not cur.fetchone():
            raise ValueError("User not found or access denied")

        cur.execute("""
            INSERT INTO user_permissions (user_id, permission_id, is_allowed)
            VALUES (%s, %s, %s)
            ON CONFLICT (user_id, permission_id)
            DO UPDATE SET is_allowed = EXCLUDED.is_allowed
            RETURNING id, user_id, permission_id, is_allowed
        """, (user_id, permission_id, is_allowed))
        row = dict(cur.fetchone())

        log_audit(
            conn,
            company_id=company_id,
            user_id=actor_id,
            action="UPDATE",
            table_name="user_permissions",
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


def remove_user_permission_override(
    user_id: int,
    permission_id: int,
    company_id: int,
    actor_id: int | None = None,
    ip_address: str | None = None,
) -> dict[str, Any]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT id FROM app_users WHERE id = %s AND company_id = %s",
            (user_id, company_id)
        )
        if not cur.fetchone():
            raise ValueError("User not found or access denied")

        cur.execute("""
            DELETE FROM user_permissions
            WHERE user_id = %s AND permission_id = %s
        """, (user_id, permission_id))

        log_audit(
            conn,
            company_id=company_id,
            user_id=actor_id,
            action="DELETE",
            table_name="user_permissions",
            record_id=None,
            old_data={"user_id": user_id, "permission_id": permission_id},
            ip_address=ip_address,
        )
        conn.commit()
        return {"user_id": user_id, "permission_id": permission_id, "removed": True}

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


# ── User-Branches ─────────────────────────────────────────────────────────────

def list_user_branches(user_id: int, company_id: int) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT id FROM app_users WHERE id = %s AND company_id = %s",
            (user_id, company_id)
        )
        if not cur.fetchone():
            raise ValueError("User not found or access denied")

        cur.execute("""
            SELECT b.id, b.name, b.location, b.is_active
            FROM branches b
            JOIN user_branches ub ON ub.branch_id = b.id
            WHERE ub.user_id = %s
            ORDER BY b.name
        """, (user_id,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def assign_user_to_branch(
    user_id: int,
    branch_id: int,
    company_id: int,
    actor_id: int | None = None,
    ip_address: str | None = None,
) -> dict[str, Any]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        # Verify user and branch both belong to company
        cur.execute(
            "SELECT id FROM app_users WHERE id = %s AND company_id = %s",
            (user_id, company_id)
        )
        if not cur.fetchone():
            raise ValueError("User not found or access denied")

        cur.execute(
            "SELECT id FROM branches WHERE id = %s AND company_id = %s",
            (branch_id, company_id)
        )
        if not cur.fetchone():
            raise ValueError("Branch not found or access denied")

        cur.execute("""
            INSERT INTO user_branches (user_id, branch_id)
            VALUES (%s, %s)
            ON CONFLICT (user_id, branch_id) DO NOTHING
            RETURNING id, user_id, branch_id
        """, (user_id, branch_id))
        row = cur.fetchone()

        log_audit(
            conn,
            company_id=company_id,
            user_id=actor_id,
            action="CREATE",
            table_name="user_branches",
            record_id=row["id"] if row else None,
            new_data={"user_id": user_id, "branch_id": branch_id},
            ip_address=ip_address,
        )
        conn.commit()
        return {"user_id": user_id, "branch_id": branch_id, "assigned": True}

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def remove_user_from_branch(
    user_id: int,
    branch_id: int,
    company_id: int,
    actor_id: int | None = None,
    ip_address: str | None = None,
) -> dict[str, Any]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT id FROM app_users WHERE id = %s AND company_id = %s",
            (user_id, company_id)
        )
        if not cur.fetchone():
            raise ValueError("User not found or access denied")

        cur.execute("""
            DELETE FROM user_branches
            WHERE user_id = %s AND branch_id = %s
        """, (user_id, branch_id))

        log_audit(
            conn,
            company_id=company_id,
            user_id=actor_id,
            action="DELETE",
            table_name="user_branches",
            record_id=None,
            old_data={"user_id": user_id, "branch_id": branch_id},
            ip_address=ip_address,
        )
        conn.commit()
        return {"user_id": user_id, "branch_id": branch_id, "removed": True}

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


# ── Permission Check Helper ───────────────────────────────────────────────────

def user_has_permission(user_id: int, company_id: int, permission_name: str) -> bool:
    """
    Fast check: does this user have a given permission?
    User-level overrides take priority over role-level grants.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        # Check user-level override first
        cur.execute("""
            SELECT up.is_allowed
            FROM user_permissions up
            JOIN permissions p ON p.id = up.permission_id
            WHERE up.user_id = %s AND p.name = %s
        """, (user_id, permission_name))
        override = cur.fetchone()
        if override is not None:
            return override["is_allowed"]

        # Fall back to role-level
        cur.execute("""
            SELECT 1
            FROM role_permissions rp
            JOIN permissions p ON p.id = rp.permission_id
            JOIN app_users u ON u.role_id = rp.role_id
            WHERE u.id = %s AND u.company_id = %s AND p.name = %s
        """, (user_id, company_id, permission_name))
        return cur.fetchone() is not None

    finally:
        cur.close()
        conn.close()