import psycopg2
from typing import Any
from .connection import get_connection, dict_cursor
from .log_audit import log_audit
from .sku_prefixes import next_sku


def list_ingredients(company_id: int) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT i.*, s.name AS supplier_name
            FROM ingredients i
            LEFT JOIN suppliers s ON s.id = i.supplier_id
            WHERE i.company_id = %s AND i.is_active = TRUE
            ORDER BY i.name
        """, (company_id,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def get_ingredient(ingredient_id: int, company_id: int) -> dict[str, Any] | None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT i.*, s.name AS supplier_name
            FROM ingredients i
            LEFT JOIN suppliers s ON s.id = i.supplier_id
            WHERE i.id = %s AND i.company_id = %s
        """, (ingredient_id, company_id))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        cur.close()
        conn.close()


def add_ingredient(
    name: str,
    unit: str,
    company_id: int,
    user_id: int,
    cost_per_unit: float = 0,
    stock_qty: float = 0,
    reorder_level: float = 0,
    supplier_id: int | None = None,
    sku: str | None = None,
    sku_prefix: str | None = None,
    ip_address: str | None = None,
) -> dict:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        # Check if ingredient exists but is inactive → reactivate it
        cur.execute("""
            SELECT * FROM ingredients
            WHERE company_id = %s AND LOWER(name) = LOWER(%s) AND is_active = FALSE
        """, (company_id, name))
        existing = cur.fetchone()

        if existing:
            auto_sku = sku or existing["sku"] or next_sku(company_id, sku_prefix or "RM", "ingredients")
            cur.execute("""
                UPDATE ingredients
                SET is_active     = TRUE,
                    unit          = %s,
                    cost_per_unit = %s,
                    stock_qty     = %s,
                    reorder_level = %s,
                    supplier_id   = %s,
                    sku           = %s
                WHERE id = %s AND company_id = %s
                RETURNING *
            """, (unit, cost_per_unit, stock_qty, reorder_level, supplier_id, auto_sku, existing["id"], company_id))
            ingredient = dict(cur.fetchone())
        else:
            auto_sku = sku or next_sku(company_id, sku_prefix or "RM", "ingredients")
            cur.execute("""
                INSERT INTO ingredients
                    (company_id, name, unit, cost_per_unit, stock_qty, reorder_level, supplier_id, sku)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (company_id, name, unit, cost_per_unit, stock_qty, reorder_level, supplier_id, auto_sku))
            ingredient = dict(cur.fetchone())

        log_audit(conn, company_id=company_id, user_id=user_id,
                  action="CREATE", table_name="ingredients",
                  record_id=ingredient["id"], new_data=ingredient, ip_address=ip_address)
        conn.commit()
        return ingredient

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

def update_ingredient(
    ingredient_id: int,
    company_id: int,
    user_id: int,
    name: str | None = None,
    unit: str | None = None,
    cost_per_unit: float | None = None,
    reorder_level: float | None = None,
    supplier_id: int | None = None,
    sku: str | None = None,
    ip_address: str | None = None,
) -> dict:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT * FROM ingredients WHERE id = %s AND company_id = %s",
            (ingredient_id, company_id)
        )
        old = cur.fetchone()
        if not old:
            raise ValueError("Ingredient not found or access denied")

        cur.execute("""
            UPDATE ingredients
            SET name          = COALESCE(%s, name),
                unit          = COALESCE(%s, unit),
                cost_per_unit = COALESCE(%s, cost_per_unit),
                reorder_level = COALESCE(%s, reorder_level),
                supplier_id   = COALESCE(%s, supplier_id),
                sku           = CASE WHEN %s IS NOT NULL THEN %s ELSE sku END
            WHERE id = %s AND company_id = %s
            RETURNING *
        """, (name, unit, cost_per_unit, reorder_level, supplier_id, sku, sku, ingredient_id, company_id))
        new = dict(cur.fetchone())

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="UPDATE",
            table_name="ingredients",
            record_id=ingredient_id,
            old_data=dict(old),
            new_data=new,
            ip_address=ip_address,
        )
        conn.commit()
        return new

    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise ValueError("Ingredient name already exists for this company")
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def deactivate_ingredient(
    ingredient_id: int,
    company_id: int,
    user_id: int,
    ip_address: str | None = None,
) -> None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT * FROM ingredients WHERE id = %s AND company_id = %s",
            (ingredient_id, company_id)
        )
        old = cur.fetchone()
        if not old:
            raise ValueError("Ingredient not found or access denied")

        cur.execute(
            "UPDATE ingredients SET is_active = FALSE WHERE id = %s",
            (ingredient_id,)
        )
        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="DELETE",
            table_name="ingredients",
            record_id=ingredient_id,
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


def get_low_stock_alerts(company_id: int) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT i.*, s.name AS supplier_name,
                   (i.reorder_level - COALESCE(bal.balance_qty, 0)) AS shortage
            FROM ingredients i
            LEFT JOIN suppliers s ON s.id = i.supplier_id
            LEFT JOIN (
                SELECT ingredient_id, SUM(quantity_delta) AS balance_qty
                FROM inventory_movements
                GROUP BY ingredient_id
            ) bal ON bal.ingredient_id = i.id
            WHERE COALESCE(bal.balance_qty, 0) <= i.reorder_level
              AND i.is_active = TRUE
              AND i.company_id = %s
            ORDER BY shortage DESC
        """, (company_id,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def update_image(ingredient_id: int, company_id: int, image_url: str) -> None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            UPDATE ingredients
            SET image_url = %s
            WHERE id = %s AND company_id = %s AND is_active = TRUE
        """, (image_url, ingredient_id, company_id))
        if cur.rowcount == 0:
            raise ValueError("Ingredient not found or access denied")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()
