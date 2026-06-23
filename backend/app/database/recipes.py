import psycopg2
from typing import Any
from .connection import get_connection, dict_cursor
from .log_audit import log_audit


def get_recipe(product_id: int, company_id: int) -> dict[str, Any] | None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT r.*, p.name AS product_name, p.sale_price
            FROM recipes r
            JOIN products p ON p.id = r.product_id
            WHERE r.product_id = %s AND p.company_id = %s
        """, (product_id, company_id))
        row = cur.fetchone()
        if not row:
            return None
        recipe = dict(row)

        cur.execute("""
            SELECT ri.*, i.name AS ingredient_name, i.unit, i.cost_per_unit,
                   ri.qty_required * i.cost_per_unit AS line_cost
            FROM recipe_ingredients ri
            JOIN ingredients i ON i.id = ri.ingredient_id
            WHERE ri.recipe_id = %s
        """, (recipe["id"],))
        recipe["ingredients"] = [dict(r) for r in cur.fetchall()]
        return recipe
    finally:
        cur.close()
        conn.close()


def save_recipe(
    product_id: int,
    company_id: int,
    user_id: int,
    yield_pct: float = 100,
    portion_size: float = 1,
    portion_unit: str = "plate",
    notes: str = "",
    ip_address: str | None = None,
) -> dict:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        # verify product belongs to company
        cur.execute(
            "SELECT id FROM products WHERE id = %s AND company_id = %s",
            (product_id, company_id)
        )
        if not cur.fetchone():
            raise ValueError("Product not found or access denied")

        cur.execute("""
            INSERT INTO recipes (product_id, yield_pct, portion_size, portion_unit, notes)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (product_id) DO UPDATE
                SET yield_pct    = EXCLUDED.yield_pct,
                    portion_size = EXCLUDED.portion_size,
                    portion_unit = EXCLUDED.portion_unit,
                    notes        = EXCLUDED.notes
            RETURNING *
        """, (product_id, yield_pct, portion_size, portion_unit, notes))
        recipe = dict(cur.fetchone())

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="CREATE",
            table_name="recipes",
            record_id=recipe["id"],
            new_data=recipe,
            ip_address=ip_address,
        )
        conn.commit()
        return recipe

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def delete_recipe(
    product_id: int,
    company_id: int,
    user_id: int,
    ip_address: str | None = None,
) -> None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT r.* FROM recipes r
            JOIN products p ON p.id = r.product_id
            WHERE r.product_id = %s AND p.company_id = %s
        """, (product_id, company_id))
        old = cur.fetchone()
        if not old:
            raise ValueError("Recipe not found or access denied")

        cur.execute(
            "DELETE FROM recipe_ingredients WHERE recipe_id = %s",
            (old["id"],)
        )
        cur.execute("DELETE FROM recipes WHERE id = %s", (old["id"],))

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="DELETE",
            table_name="recipes",
            record_id=old["id"],
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


def save_recipe_ingredient(
    recipe_id: int,
    company_id: int,
    user_id: int,
    ingredient_id: int,
    qty_required: float,
    ip_address: str | None = None,
) -> dict:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        # verify recipe belongs to company
        cur.execute("""
            SELECT r.id FROM recipes r
            JOIN products p ON p.id = r.product_id
            WHERE r.id = %s AND p.company_id = %s
        """, (recipe_id, company_id))
        if not cur.fetchone():
            raise ValueError("Recipe not found or access denied")

        cur.execute("""
            INSERT INTO recipe_ingredients (recipe_id, ingredient_id, qty_required)
            VALUES (%s, %s, %s)
            ON CONFLICT (recipe_id, ingredient_id) DO UPDATE
                SET qty_required = EXCLUDED.qty_required
            RETURNING *
        """, (recipe_id, ingredient_id, qty_required))
        row = dict(cur.fetchone())

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="UPDATE",
            table_name="recipe_ingredients",
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


def remove_recipe_ingredient(
    recipe_id: int,
    ingredient_id: int,
    company_id: int,
    user_id: int,
    ip_address: str | None = None,
) -> None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT ri.* FROM recipe_ingredients ri
            JOIN recipes r ON r.id = ri.recipe_id
            JOIN products p ON p.id = r.product_id
            WHERE ri.recipe_id = %s AND ri.ingredient_id = %s AND p.company_id = %s
        """, (recipe_id, ingredient_id, company_id))
        old = cur.fetchone()
        if not old:
            raise ValueError("Recipe ingredient not found or access denied")

        cur.execute("""
            DELETE FROM recipe_ingredients
            WHERE recipe_id = %s AND ingredient_id = %s
        """, (recipe_id, ingredient_id))

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="DELETE",
            table_name="recipe_ingredients",
            record_id=old["id"],
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


def calculate_recipe_cost(product_id: int, company_id: int) -> dict[str, Any]:
    recipe = get_recipe(product_id, company_id)
    if not recipe:
        return {}

    yield_factor = (float(recipe.get("yield_pct") or 100) / 100) or 1
    raw_cost = sum(
        (float(i["qty_required"]) / yield_factor) * float(i["cost_per_unit"])
        for i in recipe["ingredients"]
    )
    sale_price = float(recipe["sale_price"])
    food_cost_pct = round(raw_cost / sale_price * 100, 2) if sale_price else 0

    return {
        "product_name":  recipe["product_name"],
        "portion_size":  recipe["portion_size"],
        "portion_unit":  recipe["portion_unit"],
        "yield_pct":     recipe["yield_pct"],
        "raw_cost":      round(raw_cost, 2),
        "sale_price":    sale_price,
        "food_cost_pct": food_cost_pct,
        "gross_margin":  round(sale_price - raw_cost, 2),
        "ingredients":   recipe["ingredients"],
    }