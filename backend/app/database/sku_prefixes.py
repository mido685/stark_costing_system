import psycopg2
import re
from typing import Any
from .connection import get_connection, dict_cursor

DEFAULT_RAW_MATERIAL_PREFIXES = [
    {"label": "Raw Material",       "prefix": "RM",    "item_type": "raw_material"},
    {"label": "Dairy",              "prefix": "DAIRY", "item_type": "raw_material"},
    {"label": "Meat & Poultry",     "prefix": "MEAT",  "item_type": "raw_material"},
    {"label": "Produce",            "prefix": "PRD",   "item_type": "raw_material"},
    {"label": "Dry Goods",          "prefix": "DRY",   "item_type": "raw_material"},
    {"label": "Frozen Items",       "prefix": "FRZ",   "item_type": "raw_material"},
    {"label": "Beverages Supply",   "prefix": "BEVS",  "item_type": "raw_material"},
    {"label": "Seafood",            "prefix": "SEA",   "item_type": "raw_material"},
    {"label": "Oils & Fats",        "prefix": "OIL",   "item_type": "raw_material"},
    {"label": "Spices & Herbs",     "prefix": "SPICE", "item_type": "raw_material"},
    {"label": "Bakery Supply",      "prefix": "BAKS",  "item_type": "raw_material"},
    {"label": "Packaging",          "prefix": "PKG",   "item_type": "raw_material"},
]

DEFAULT_FINISHED_GOOD_PREFIXES = [
    {"label": "Main Dish",    "prefix": "DISH", "item_type": "finished_good"},
    {"label": "Appetizer",    "prefix": "APP",  "item_type": "finished_good"},
    {"label": "Dessert",      "prefix": "DES",  "item_type": "finished_good"},
    {"label": "Beverage",     "prefix": "BEV",  "item_type": "finished_good"},
    {"label": "Breakfast",    "prefix": "BRK",  "item_type": "finished_good"},
    {"label": "Sandwich",     "prefix": "SAND", "item_type": "finished_good"},
    {"label": "Cake & Pastry","prefix": "CAKE", "item_type": "finished_good"},
    {"label": "Salad",        "prefix": "SAL",  "item_type": "finished_good"},
    {"label": "Soup",         "prefix": "SOUP", "item_type": "finished_good"},
    {"label": "Pizza",        "prefix": "PIZ",  "item_type": "finished_good"},
    {"label": "Grill",        "prefix": "GRL",  "item_type": "finished_good"},
    {"label": "Kids Meal",    "prefix": "KIDS", "item_type": "finished_good"},
]

ALL_DEFAULT_PREFIXES = DEFAULT_RAW_MATERIAL_PREFIXES + DEFAULT_FINISHED_GOOD_PREFIXES


def seed_default_prefixes(company_id: int) -> None:
    """Call this when a new company registers."""
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        for p in ALL_DEFAULT_PREFIXES:
            cur.execute("""
                INSERT INTO sku_prefixes (company_id, label, prefix, item_type)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (company_id, prefix) DO NOTHING
            """, (company_id, p["label"], p["prefix"], p["item_type"]))
        conn.commit()
    finally:
        cur.close()
        conn.close()


def list_prefixes(company_id: int, item_type: str | None = None) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        if item_type:
            cur.execute("""
                SELECT * FROM sku_prefixes
                WHERE company_id = %s AND item_type = %s
                ORDER BY label
            """, (company_id, item_type))
        else:
            cur.execute("""
                SELECT * FROM sku_prefixes
                WHERE company_id = %s
                ORDER BY item_type, label
            """, (company_id,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def add_prefix(
    company_id: int,
    label: str,
    prefix: str,
    item_type: str = "both",
) -> dict[str, Any]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            INSERT INTO sku_prefixes (company_id, label, prefix, item_type)
            VALUES (%s, %s, %s, %s)
            RETURNING *
        """, (company_id, label, prefix.upper(), item_type))
        result = dict(cur.fetchone())
        conn.commit()
        return result
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise ValueError(f"Prefix '{prefix.upper()}' already exists for this company")
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def delete_prefix(company_id: int, prefix_id: int) -> None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "DELETE FROM sku_prefixes WHERE id = %s AND company_id = %s",
            (prefix_id, company_id)
        )
        if cur.rowcount == 0:
            raise ValueError("Prefix not found or access denied")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def next_sku(company_id: int, prefix: str, table: str) -> str:
    """
    Generate next sequential SKU for a given prefix and company.
    Counts ALL rows (active + inactive) with this prefix to avoid duplicates.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        if table not in {"ingredients", "products"}:
            raise ValueError("Invalid SKU table")

        prefix = prefix.upper().strip()
        prefix_pattern = re.escape(prefix)
        cur.execute(f"""
            SELECT
                COALESCE(MAX(CAST(SUBSTRING(sku FROM %s) AS INTEGER)), 0) AS max_suffix
            FROM {table}
            WHERE company_id = %s
              AND sku ~ %s
        """, (
            rf"{prefix_pattern}-([0-9]+)",
            company_id,
            rf"^{prefix_pattern}-[0-9]+$",
        ))
        row = cur.fetchone()
        max_suffix = int(row["max_suffix"] or 0)
        next_number = max_suffix + 1
        return f"{prefix}-{str(next_number).zfill(5)}"
    finally:
        cur.close()
        conn.close()