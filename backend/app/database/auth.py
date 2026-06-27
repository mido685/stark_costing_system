import psycopg2
from typing import Any

from .connection import get_connection, dict_cursor
from app.security.auth import hash_password, verify_password


# ─── Companies ────────────────────────────────────────────────────────────────

def list_companies() -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT id, name, slug, logo_url
            FROM companies
            WHERE is_active = TRUE
            ORDER BY name
        """)
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def register_company(
    company_name: str,
    company_slug: str,
    owner_username: str,
    owner_display_name: str,
    owner_password: str,
    logo_url: str | None = None,
) -> dict:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        # ── 1. Create company ─────────────────────────────────────────────────
        cur.execute("""
            INSERT INTO companies (name, slug, logo_url)
            VALUES (%s, %s, %s)
            RETURNING *
        """, (company_name, company_slug.lower().strip(), logo_url))
        company = dict(cur.fetchone())

        # ── 2. Seed default roles ─────────────────────────────────────────────
        for name, description in [
            ("owner",      "Full system access"),
            ("admin",      "Company administration"),
            ("manager",    "Branch management"),
            ("accountant", "Accounting only"),
            ("clerk",      "Data entry only"),
        ]:
            cur.execute("""
                INSERT INTO roles (company_id, name, description)
                VALUES (%s, %s, %s)
                ON CONFLICT (company_id, name) DO NOTHING
            """, (company["id"], name, description))

        # ── 3. Fetch owner role id ────────────────────────────────────────────
        cur.execute("""
            SELECT id FROM roles
            WHERE company_id = %s AND name = 'owner'
        """, (company["id"],))
        owner_role_id = cur.fetchone()["id"]

        # ── 4. Create owner user ──────────────────────────────────────────────
        cur.execute("""
            INSERT INTO app_users
                (company_id, username, display_name, role_id, password_hash)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, username, display_name, role_id, is_active, created_at
        """, (
            company["id"],
            owner_username,
            owner_display_name,
            owner_role_id,
            hash_password(owner_password),
        ))
        user = dict(cur.fetchone())

        conn.commit()
        return {"company": company, "user": user}

    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise ValueError("Company name or slug already exists")
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


# ─── Auth ─────────────────────────────────────────────────────────────────────

def login_user(company_slug: str, username: str, password: str) -> dict:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        # ── 1. Verify company exists and is active ────────────────────────────
        cur.execute("""
            SELECT id, logo_url
            FROM companies
            WHERE slug = %s AND is_active = TRUE
        """, (company_slug.lower().strip(),))
        company = cur.fetchone()
        if not company:
            raise ValueError("Company not found")

        # ── 2. Verify user credentials ────────────────────────────────────────
        cur.execute("""
            SELECT
                u.id,
                u.username,
                u.display_name,
                u.role_id,
                u.password_hash,
                r.name AS role
            FROM app_users u
            JOIN roles r ON r.id = u.role_id
            WHERE u.company_id = %s
              AND u.username = %s
              AND u.is_active = TRUE
        """, (company["id"], username))
        user = cur.fetchone()

        if not user or not verify_password(password, user["password_hash"]):
            raise ValueError("Invalid credentials")

        return {
            "id":           user["id"],
            "username":     user["username"],
            "display_name": user["display_name"],
            "role_id":      user["role_id"],
            "role":         user["role"],
            "company_id":   company["id"],
            "company_logo": company["logo_url"],
        }

    except ValueError:
        raise
    except Exception:
        raise
    finally:
        cur.close()
        conn.close()