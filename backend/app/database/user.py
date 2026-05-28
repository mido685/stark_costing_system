from .connection import get_connection, dict_cursor
from app.security.auth import hash_password
from .log_audit import log_audit
import psycopg2
from typing import Any

# Columns safe to return — never expose password_hash
_USER_COLS = "u.id, u.username, u.display_name, u.role_id, r.name AS role, u.is_active, u.created_at"


def list_users(company_id: int) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(f"""
            SELECT {_USER_COLS}
            FROM app_users u
            JOIN roles r ON r.id = u.role_id
            WHERE u.company_id = %s
            ORDER BY u.display_name
        """, (company_id,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def get_user(user_id: int, company_id: int) -> dict[str, Any] | None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(f"""
            SELECT {_USER_COLS}
            FROM app_users u
            JOIN roles r ON r.id = u.role_id
            WHERE u.id = %s AND u.company_id = %s
        """, (user_id, company_id))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        cur.close()
        conn.close()


def add_user(
    username: str,
    display_name: str,
    role_id: int,
    password: str,
    company_id: int,
    user_id: int | None = None,
    ip_address: str | None = None,
) -> dict:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        hashed = hash_password(password)
        cur.execute("""
            INSERT INTO app_users
                (company_id, username, display_name, role_id, password_hash)
            VALUES (%s, %s, %s, %s, %s)
        """, (company_id, username, display_name, role_id, hashed))
        cur.execute(f"""
            SELECT {_USER_COLS}
            FROM app_users u
            JOIN roles r ON r.id = u.role_id
            WHERE u.company_id = %s AND u.username = %s
        """, (company_id, username))
        user = dict(cur.fetchone())

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="CREATE",
            table_name="app_users",
            record_id=user["id"],
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


def update_user(
    user_id: int,
    company_id: int,
    actor_id: int | None = None,       # ← renamed from acting_user_id
    display_name: str | None = None,
    role_id: int | None = None,
    ip_address: str | None = None,
) -> dict:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT * FROM app_users WHERE id = %s AND company_id = %s",
            (user_id, company_id)
        )
        old = cur.fetchone()
        if not old:
            raise ValueError("User not found or access denied")

        cur.execute("""
            UPDATE app_users
            SET display_name = COALESCE(%s, display_name),
                role_id      = COALESCE(%s, role_id)
            WHERE id = %s AND company_id = %s
        """, (display_name, role_id, user_id, company_id))
        cur.execute(f"""
            SELECT {_USER_COLS}
            FROM app_users u
            JOIN roles r ON r.id = u.role_id
            WHERE u.id = %s AND u.company_id = %s
        """, (user_id, company_id))
        new = dict(cur.fetchone())

        log_audit(
            conn,
            company_id=company_id,
            user_id=actor_id,
            action="UPDATE",
            table_name="app_users",
            record_id=user_id,
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


def toggle_access(                      # ← new function
    user_id: int,
    company_id: int,
    actor_id: int | None = None,
    ip_address: str | None = None,
) -> dict:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT * FROM app_users WHERE id = %s AND company_id = %s",
            (user_id, company_id)
        )
        old = cur.fetchone()
        if not old:
            raise ValueError("User not found or access denied")

        cur.execute("""
            UPDATE app_users
            SET is_active = NOT is_active
            WHERE id = %s AND company_id = %s
        """, (user_id, company_id))
        cur.execute(f"""
            SELECT {_USER_COLS}
            FROM app_users u
            JOIN roles r ON r.id = u.role_id
            WHERE u.id = %s AND u.company_id = %s
        """, (user_id, company_id))
        new = dict(cur.fetchone())

        log_audit(
            conn,
            company_id=company_id,
            user_id=actor_id,
            action="UPDATE",
            table_name="app_users",
            record_id=user_id,
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


def get_role_id_by_name(company_id: int, role: str) -> int:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT id FROM roles WHERE company_id = %s AND name = %s AND is_active = TRUE",
            (company_id, role),
        )
        row = cur.fetchone()
        if not row:
            raise ValueError("Role not found for this company")
        return int(row["id"])
    finally:
        cur.close()
        conn.close()


def deactivate_user(
    user_id: int,
    company_id: int,
    actor_id: int | None = None,        # ← renamed from acting_user_id
    ip_address: str | None = None,
) -> None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT * FROM app_users WHERE id = %s AND company_id = %s",
            (user_id, company_id)
        )
        old = cur.fetchone()
        if not old:
            raise ValueError("User not found or access denied")

        cur.execute(
            "UPDATE app_users SET is_active = FALSE WHERE id = %s AND company_id = %s",
            (user_id, company_id)
        )
        log_audit(
            conn,
            company_id=company_id,
            user_id=actor_id,
            action="DELETE",
            table_name="app_users",
            record_id=user_id,
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
