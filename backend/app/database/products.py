import psycopg2
from typing import Any
from .connection import get_connection, dict_cursor
from .log_audit import log_audit
from .sku_prefixes import next_sku


def list_products(company_id: int) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT * FROM products WHERE company_id = %s AND is_active = TRUE ORDER BY name",
            (company_id,)
        )
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def add_product(
    name: str,
    company_id: int,
    user_id: int,
    unit: str | None = None,
    sale_price: float = 0,
    sku: str | None = None,
    sku_prefix: str | None = None,
    ip_address: str | None = None,
) -> dict:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        # Check if product exists but is inactive → reactivate it
        cur.execute("""
            SELECT * FROM products
            WHERE company_id = %s AND LOWER(name) = LOWER(%s) AND is_active = FALSE
        """, (company_id, name))
        existing = cur.fetchone()

        if existing:
            auto_sku = sku or existing["sku"] or next_sku(company_id, sku_prefix or "DISH", "products")
            cur.execute("""
                UPDATE products
                SET is_active  = TRUE,
                    unit       = %s,
                    sale_price = %s,
                    sku        = %s
                WHERE id = %s AND company_id = %s
                RETURNING *
            """, (unit, sale_price, auto_sku, existing["id"], company_id))
            product = dict(cur.fetchone())
        else:
            auto_sku = sku or next_sku(company_id, sku_prefix or "DISH", "products")
            cur.execute("""
                INSERT INTO products (company_id, name, unit, sale_price, sku)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING *
            """, (company_id, name, unit, sale_price, auto_sku))
            product = dict(cur.fetchone())

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="CREATE",
            table_name="products",
            record_id=product["id"],
            new_data=product,
            ip_address=ip_address,
        )
        conn.commit()
        return product

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

def update_product(
    product_id: int,
    company_id: int,
    user_id: int,
    name: str | None = None,
    unit: str | None = None,
    sale_price: float | None = None,
    sku: str | None = None,
    ip_address: str | None = None,
) -> dict:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT * FROM products WHERE id = %s AND company_id = %s",
            (product_id, company_id)
        )
        old = cur.fetchone()
        if not old:
            raise ValueError("Product not found or access denied")

        cur.execute("""
            UPDATE products
            SET name       = COALESCE(%s, name),
                unit       = COALESCE(%s, unit),
                sale_price = COALESCE(%s, sale_price),
                sku        = CASE WHEN %s IS NOT NULL THEN %s ELSE sku END
            WHERE id = %s AND company_id = %s
            RETURNING *
        """, (name, unit, sale_price, sku, sku, product_id, company_id))
        new = dict(cur.fetchone())

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="UPDATE",
            table_name="products",
            record_id=product_id,
            old_data=dict(old),
            new_data=new,
            ip_address=ip_address,
        )
        conn.commit()
        return new

    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise ValueError("Product name already exists for this company")
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def update_image(product_id: int, company_id: int, image_url: str) -> None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            UPDATE products
            SET image_url = %s
            WHERE id = %s AND company_id = %s AND is_active = TRUE
        """, (image_url, product_id, company_id))
        if cur.rowcount == 0:
            raise ValueError("Product not found or access denied")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def deactivate_product(
    product_id: int,
    company_id: int,
    user_id: int,
    ip_address: str | None = None,
) -> None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT * FROM products WHERE id = %s AND company_id = %s",
            (product_id, company_id)
        )
        old = cur.fetchone()
        if not old:
            raise ValueError("Product not found or access denied")

        cur.execute(
            "UPDATE products SET is_active = FALSE WHERE id = %s",
            (product_id,)
        )
        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="DELETE",
            table_name="products",
            record_id=product_id,
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