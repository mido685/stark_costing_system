"""
app/database/suppliers.py  — full replacement
Adds: email, address, website, commercial_reg_number, agent_name, agent_phone
"""

import psycopg2
from typing import Any

from .connection import get_connection, dict_cursor
from .log_audit import log_audit


def list_suppliers(company_id: int) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT *
            FROM suppliers
            WHERE company_id = %s AND is_active = TRUE
            ORDER BY name
        """, (company_id,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def get_supplier(supplier_id: int, company_id: int) -> dict[str, Any] | None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT *
            FROM suppliers
            WHERE id = %s AND company_id = %s
        """, (supplier_id, company_id))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        cur.close()
        conn.close()


def add_supplier(
    name: str,
    company_id: int,
    user_id: int,
    contact: str | None = None,
    phone: str | None = None,
    email: str | None = None,
    address: str | None = None,
    website: str | None = None,
    commercial_reg_number: str | None = None,
    agent_name: str | None = None,
    agent_phone: str | None = None,
    category: str | None = None,
    notes: str = "",
    ip_address: str | None = None,
) -> dict:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            INSERT INTO suppliers (
                company_id, name, contact, phone,
                email, address, website, commercial_reg_number,
                agent_name, agent_phone, category, notes
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (
            company_id, name, contact, phone,
            email, address, website, commercial_reg_number,
            agent_name, agent_phone, category, notes,
        ))
        supplier = dict(cur.fetchone())

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="CREATE",
            table_name="suppliers",
            record_id=supplier["id"],
            new_data=supplier,
            ip_address=ip_address,
        )
        conn.commit()
        return supplier
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise ValueError("Supplier name already exists for this company")
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def update_supplier(
    supplier_id: int,
    company_id: int,
    user_id: int,
    name: str | None = None,
    contact: str | None = None,
    phone: str | None = None,
    email: str | None = None,
    address: str | None = None,
    website: str | None = None,
    commercial_reg_number: str | None = None,
    agent_name: str | None = None,
    agent_phone: str | None = None,
    category: str | None = None,
    notes: str | None = None,
    ip_address: str | None = None,
) -> dict:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT * FROM suppliers WHERE id = %s AND company_id = %s",
            (supplier_id, company_id),
        )
        old = cur.fetchone()
        if not old:
            raise ValueError("Supplier not found or access denied")

        cur.execute("""
            UPDATE suppliers
            SET name                  = COALESCE(%s, name),
                contact               = COALESCE(%s, contact),
                phone                 = COALESCE(%s, phone),
                email                 = COALESCE(%s, email),
                address               = COALESCE(%s, address),
                website               = COALESCE(%s, website),
                commercial_reg_number = COALESCE(%s, commercial_reg_number),
                agent_name            = COALESCE(%s, agent_name),
                agent_phone           = COALESCE(%s, agent_phone),
                category              = COALESCE(%s, category),
                notes                 = COALESCE(%s, notes)
            WHERE id = %s AND company_id = %s
            RETURNING *
        """, (
            name, contact, phone,
            email, address, website, commercial_reg_number,
            agent_name, agent_phone,
            category, notes,
            supplier_id, company_id,
        ))
        supplier = dict(cur.fetchone())

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="UPDATE",
            table_name="suppliers",
            record_id=supplier_id,
            old_data=dict(old),
            new_data=supplier,
            ip_address=ip_address,
        )
        conn.commit()
        return supplier
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise ValueError("Supplier name already exists for this company")
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def deactivate_supplier(
    supplier_id: int,
    company_id: int,
    user_id: int,
    ip_address: str | None = None,
) -> None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT * FROM suppliers WHERE id = %s AND company_id = %s",
            (supplier_id, company_id),
        )
        old = cur.fetchone()
        if not old:
            raise ValueError("Supplier not found or access denied")

        cur.execute(
            "UPDATE suppliers SET is_active = FALSE WHERE id = %s",
            (supplier_id,),
        )

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="DELETE",
            table_name="suppliers",
            record_id=supplier_id,
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


def add_supplier_price(
    supplier_id: int,
    ingredient_id: int,
    price: float,
    entry_date: str,
    company_id: int,
    user_id: int,
    notes: str = "",
    ip_address: str | None = None,
) -> dict:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT s.id
            FROM suppliers s
            JOIN ingredients i ON i.company_id = s.company_id
            WHERE s.id = %s
              AND i.id = %s
              AND s.company_id = %s
              AND s.is_active = TRUE
              AND i.is_active = TRUE
        """, (supplier_id, ingredient_id, company_id))
        if not cur.fetchone():
            raise ValueError("Supplier or ingredient not found or access denied")

        cur.execute("""
            INSERT INTO supplier_price_history
                (supplier_id, ingredient_id, price, entry_date, notes)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *
        """, (supplier_id, ingredient_id, price, entry_date, notes))
        price_row = dict(cur.fetchone())

        cur.execute("""
            UPDATE ingredients
            SET cost_per_unit = %s, supplier_id = %s
            WHERE id = %s AND company_id = %s
        """, (price, supplier_id, ingredient_id, company_id))

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="CREATE",
            table_name="supplier_price_history",
            record_id=price_row["id"],
            new_data=price_row,
            ip_address=ip_address,
        )
        conn.commit()
        return price_row
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def get_supplier_price_history(
    ingredient_id: int,
    company_id: int,
) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT sph.*, s.name AS supplier_name, i.name AS ingredient_name
            FROM supplier_price_history sph
            JOIN suppliers s ON s.id = sph.supplier_id
            JOIN ingredients i ON i.id = sph.ingredient_id
            WHERE sph.ingredient_id = %s
              AND i.company_id = %s
              AND s.company_id = %s
            ORDER BY sph.entry_date DESC, sph.id DESC
        """, (ingredient_id, company_id, company_id))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()