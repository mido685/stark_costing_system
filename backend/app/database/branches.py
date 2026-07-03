import psycopg2

from .connection import get_connection, dict_cursor
from .log_audit import log_audit
from .master_numbers import next_master_number
from .system_logger import log_event


def _verify_branch_company(cur, branch_id: int, company_id: int) -> dict:
    """Returns branch row if it belongs to company, raises ValueError otherwise."""
    cur.execute(
        "SELECT * FROM branches WHERE id = %s AND company_id = %s",
        (branch_id, company_id)
    )
    branch = cur.fetchone()
    if not branch:
        raise ValueError("Branch not found or access denied")
    return dict(branch)


# ---------------------------------------------------------------------------
# List / Get  (read-only — no logging needed)
# ---------------------------------------------------------------------------

def list_branches(company_id: int | None = None) -> list[dict]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        if company_id:
            cur.execute(
                "SELECT * FROM branches WHERE company_id = %s AND is_active = TRUE ORDER BY name",
                (company_id,)
            )
        else:
            cur.execute("SELECT * FROM branches WHERE is_active = TRUE ORDER BY name")
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def get_branch(branch_id: int, company_id: int) -> dict | None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT * FROM branches WHERE id = %s AND company_id = %s",
            (branch_id, company_id)
        )
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        cur.close()
        conn.close()


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

def add_branch(
    name: str,
    company_id: int,
    user_id: int,
    location: str | None = None,
    manager: str | None = None,
    ip_address: str | None = None,
) -> dict:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            INSERT INTO branches (company_id, branch_number, name, location, manager)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *
        """, (company_id, next_master_number(cur, "branches", company_id), name, location, manager))
        branch = dict(cur.fetchone())

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="CREATE",
            table_name="branches",
            record_id=branch["id"],
            new_data=branch,
            ip_address=ip_address,
        )
        log_event(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="created",
            category="system",
            entity_type="branches",
            entity_id=branch["id"],
            payload={
                "name":     name,
                "location": location,
                "manager":  manager,
            },
            ip_address=ip_address,
        )
        conn.commit()
        return branch

    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise ValueError("Branch name already exists for this company")
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

def update_branch(
    branch_id: int,
    company_id: int,
    user_id: int,
    name: str | None = None,
    location: str | None = None,
    manager: str | None = None,
    ip_address: str | None = None,
) -> dict:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        old = _verify_branch_company(cur, branch_id, company_id)

        cur.execute("""
            UPDATE branches
            SET name     = COALESCE(%s, name),
                location = COALESCE(%s, location),
                manager  = COALESCE(%s, manager)
            WHERE id = %s
            RETURNING *
        """, (name, location, manager, branch_id))
        new = dict(cur.fetchone())

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="UPDATE",
            table_name="branches",
            record_id=branch_id,
            old_data=old,
            new_data=new,
            ip_address=ip_address,
        )
        log_event(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="updated",
            category="system",
            entity_type="branches",
            entity_id=branch_id,
            payload={
                "changes": {
                    k: new[k]
                    for k in ("name", "location", "manager")
                    if new.get(k) != old.get(k)
                },
                "original": {
                    k: old[k]
                    for k in ("name", "location", "manager")
                    if new.get(k) != old.get(k)
                },
            },
            ip_address=ip_address,
        )
        conn.commit()
        return new

    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise ValueError("Branch name already exists for this company")
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


# ---------------------------------------------------------------------------
# Deactivate
# ---------------------------------------------------------------------------

def deactivate_branch(
    branch_id: int,
    company_id: int,
    user_id: int,
    ip_address: str | None = None,
) -> None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        old = _verify_branch_company(cur, branch_id, company_id)

        cur.execute("UPDATE branches SET is_active = FALSE WHERE id = %s", (branch_id,))

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="DELETE",
            table_name="branches",
            record_id=branch_id,
            old_data=old,
            ip_address=ip_address,
        )
        log_event(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="deactivated",
            category="system",
            level="warning",
            entity_type="branches",
            entity_id=branch_id,
            payload={
                "name":     old["name"],
                "location": old["location"],
                "manager":  old["manager"],
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
