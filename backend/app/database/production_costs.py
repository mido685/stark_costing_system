import psycopg2
from typing import Any
from .connection import get_connection, dict_cursor
from .log_audit import log_audit
from .recipes import get_recipe
from .periods import is_period_frozen


def list_production_costs(company_id: int, branch_id: int | None = None) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        if branch_id:
            cur.execute("""
                SELECT pc.*, b.name AS branch_name, p.name AS product_name, p.unit
                FROM production_costs pc
                JOIN branches b ON b.id = pc.branch_id
                JOIN products  p ON p.id = pc.product_id
                WHERE b.company_id = %s AND pc.branch_id = %s
                ORDER BY pc.entry_date DESC, pc.id DESC
            """, (company_id, branch_id))
        else:
            cur.execute("""
                SELECT pc.*, b.name AS branch_name, p.name AS product_name, p.unit
                FROM production_costs pc
                JOIN branches b ON b.id = pc.branch_id
                JOIN products  p ON p.id = pc.product_id
                WHERE b.company_id = %s
                ORDER BY pc.entry_date DESC, pc.id DESC
            """, (company_id,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def get_production_cost(production_id: int, company_id: int) -> dict[str, Any] | None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT pc.*, b.name AS branch_name, p.name AS product_name, p.unit
            FROM production_costs pc
            JOIN branches b ON b.id = pc.branch_id
            JOIN products  p ON p.id = pc.product_id
            WHERE pc.id = %s AND b.company_id = %s
        """, (production_id, company_id))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        cur.close()
        conn.close()


def add_production_cost(
    branch_id: int,
    product_id: int,
    entry_date: str,
    company_id: int,
    user_id: int,
    quantity: float = 0,
    material_cost: float = 0,
    labor_cost: float = 0,
    overhead_cost: float = 0,
    notes: str = "",
    ip_address: str | None = None,
) -> dict:
    if is_period_frozen(branch_id, entry_date):
        raise ValueError("This accounting period is closed for the selected branch")

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        # ── Auto-calculate material_cost from recipe ──────────────────────────
        recipe = get_recipe(product_id, company_id)
        if recipe and recipe.get("ingredients"):
            yield_factor = (float(recipe.get("yield_pct") or 100) / 100) or 1
            raw_cost_per_unit = sum(
                (float(ing["qty_required"]) / yield_factor) * float(ing.get("cost_per_unit") or 0)
                for ing in recipe["ingredients"]
            )
            material_cost = round(raw_cost_per_unit * quantity, 2)

        cur.execute("""
            INSERT INTO production_costs
                (branch_id, product_id, entry_date, quantity,
                 material_cost, labor_cost, overhead_cost, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (branch_id, product_id, entry_date, quantity,
              material_cost, labor_cost, overhead_cost, notes))
        production = dict(cur.fetchone())
        production_id = production["id"]

        # ── Deduct ingredients from inventory ─────────────────────────────────
        if recipe and recipe.get("ingredients"):
            for ing in recipe["ingredients"]:
                required_qty = quantity * float(ing["qty_required"]) / yield_factor
                unit_cost    = float(ing.get("cost_per_unit") or 0)
                cur.execute("""
                    INSERT INTO inventory_movements
                        (branch_id, ingredient_id, movement_type, entry_date,
                         quantity_delta, unit_cost, reference_table, reference_id, notes)
                    VALUES (%s, %s, 'issue', %s, %s, %s, 'production_costs', %s, %s)
                """, (branch_id, int(ing["ingredient_id"]), entry_date,
                      -required_qty, unit_cost, production_id, notes))

        # ── Add finished goods to inventory ───────────────────────────────────
        total_unit_cost = (
            (material_cost + labor_cost + overhead_cost) / quantity
            if quantity else 0
        )
        cur.execute("""
            INSERT INTO finished_goods_movements
                (branch_id, product_id, movement_type, entry_date,
                 quantity_delta, unit_cost, reference_table, reference_id, notes)
            VALUES (%s, %s, 'production', %s, %s, %s, 'production_costs', %s, %s)
        """, (branch_id, product_id, entry_date, quantity,
              total_unit_cost, production_id, notes))

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="CREATE",
            table_name="production_costs",
            record_id=production_id,
            new_data=production,
            ip_address=ip_address,
        )
        conn.commit()
        return production

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

def delete_production_cost(
    production_id: int,
    company_id: int,
    user_id: int,
    ip_address: str | None = None,
) -> None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT pc.* FROM production_costs pc
            JOIN branches b ON b.id = pc.branch_id
            WHERE pc.id = %s AND b.company_id = %s
        """, (production_id, company_id))
        old = cur.fetchone()
        if not old:
            raise ValueError("Production cost not found or access denied")

        if is_period_frozen(old["branch_id"], str(old["entry_date"])):
            raise ValueError("Cannot delete — accounting period is closed")

        # ── Reverse inventory movements ───────────────────────────────────────
        cur.execute("""
            DELETE FROM inventory_movements
            WHERE reference_table = 'production_costs' AND reference_id = %s
        """, (production_id,))
        cur.execute("""
            DELETE FROM finished_goods_movements
            WHERE reference_table = 'production_costs' AND reference_id = %s
        """, (production_id,))
        cur.execute("DELETE FROM production_costs WHERE id = %s", (production_id,))

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="DELETE",
            table_name="production_costs",
            record_id=production_id,
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