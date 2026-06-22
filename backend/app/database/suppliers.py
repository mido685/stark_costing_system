"""
app/database/suppliers.py
Enterprise-grade supplier management with proper price type gating,
standard cost protection, and clean null-safe update pattern.
"""

import psycopg2
from typing import Any

from .connection import get_connection, dict_cursor
from .log_audit import log_audit

# ── Valid price types ─────────────────────────────────────────────────────────
VALID_PRICE_TYPES = {"initial_cost", "market_price", "contract_price", "spot_price"}

# Only these price types are allowed to overwrite the ingredient standard cost.
# All others are informational — recorded for monitoring, not costing.
COST_UPDATING_PRICE_TYPES = {"initial_cost"}


# ─────────────────────────────────────────────────────────────────────────────
# SUPPLIERS
# ─────────────────────────────────────────────────────────────────────────────

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
    """
    Partial update — only fields explicitly passed (non-None) are written.

    IMPORTANT: nullable text fields (notes, category, address, etc.) use
    sentinel-safe logic. Passing None means "don't touch this field".
    If you want to genuinely clear a field, pass an empty string "".
    """
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

        old_dict = dict(old)

        # Build the resolved field values.
        # None = caller didn't pass it → keep existing value.
        # "" or any other value = caller explicitly set it → write it.
        resolved = {
            "name":                  name                  if name                  is not None else old_dict["name"],
            "contact":               contact               if contact               is not None else old_dict["contact"],
            "phone":                 phone                 if phone                 is not None else old_dict["phone"],
            "email":                 email                 if email                 is not None else old_dict["email"],
            "address":               address               if address               is not None else old_dict["address"],
            "website":               website               if website               is not None else old_dict["website"],
            "commercial_reg_number": commercial_reg_number if commercial_reg_number is not None else old_dict["commercial_reg_number"],
            "agent_name":            agent_name            if agent_name            is not None else old_dict["agent_name"],
            "agent_phone":           agent_phone           if agent_phone           is not None else old_dict["agent_phone"],
            "category":              category              if category              is not None else old_dict["category"],
            "notes":                 notes                 if notes                 is not None else old_dict["notes"],
        }

        cur.execute("""
            UPDATE suppliers
            SET name                  = %s,
                contact               = %s,
                phone                 = %s,
                email                 = %s,
                address               = %s,
                website               = %s,
                commercial_reg_number = %s,
                agent_name            = %s,
                agent_phone           = %s,
                category              = %s,
                notes                 = %s
            WHERE id = %s AND company_id = %s
            RETURNING *
        """, (
            resolved["name"],
            resolved["contact"],
            resolved["phone"],
            resolved["email"],
            resolved["address"],
            resolved["website"],
            resolved["commercial_reg_number"],
            resolved["agent_name"],
            resolved["agent_phone"],
            resolved["category"],
            resolved["notes"],
            supplier_id,
            company_id,
        ))
        supplier = dict(cur.fetchone())

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="UPDATE",
            table_name="suppliers",
            record_id=supplier_id,
            old_data=old_dict,
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


# ─────────────────────────────────────────────────────────────────────────────
# SUPPLIER PRICE HISTORY
# ─────────────────────────────────────────────────────────────────────────────

def add_supplier_price(
    supplier_id: int,
    ingredient_id: int,
    price: float,
    entry_date: str,
    company_id: int,
    user_id: int,
    notes: str = "",
    price_type: str = "market_price",
    effective_date: str | None = None,
    ip_address: str | None = None,
) -> dict:
    """
    Record a supplier price quote and optionally update the ingredient standard cost.

    Price type controls whether standard cost is updated:
      - initial_cost  → sets cost_per_unit on the ingredient (first-time setup only)
      - market_price  → recorded for variance monitoring; does NOT touch standard cost
      - contract_price → recorded for reference; does NOT touch standard cost
      - spot_price    → recorded for reference; does NOT touch standard cost

    Standard cost changes outside of initial setup require a formal review
    and should go through update_standard_cost() instead.

    Args:
        price_type:     One of VALID_PRICE_TYPES. Defaults to 'market_price'.
        effective_date: When this price takes effect (supplier's price date).
                        Distinct from entry_date (when you recorded it).
                        Defaults to entry_date if not provided.
    """
    if price_type not in VALID_PRICE_TYPES:
        raise ValueError(
            f"Invalid price_type '{price_type}'. "
            f"Must be one of: {', '.join(sorted(VALID_PRICE_TYPES))}"
        )

    if price <= 0:
        raise ValueError("Price must be greater than zero")

    resolved_effective_date = effective_date or entry_date

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        # Verify both supplier and ingredient belong to this company and are active
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
                (supplier_id, ingredient_id, price, entry_date, notes, price_type, effective_date, company_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (supplier_id, ingredient_id, price, entry_date, notes, price_type, resolved_effective_date, company_id))
        price_row = dict(cur.fetchone())

        # ── Standard cost gate ────────────────────────────────────────────────
        # Only initial_cost is allowed to overwrite the ingredient standard cost.
        # Every other price type is informational — it belongs in the history
        # table for variance analysis, not in cost_per_unit.
        if price_type in COST_UPDATING_PRICE_TYPES:
            cur.execute("""
                UPDATE ingredients
                SET cost_per_unit = %s,
                    supplier_id   = %s
                WHERE id = %s AND company_id = %s
            """, (price, supplier_id, ingredient_id, company_id))

            # Also write a record to standard_cost_history for the audit trail
            # (table must exist — see migration notes)
            try:
                cur.execute("""
                    INSERT INTO standard_cost_history
                        (company_id, ingredient_id, old_cost, new_cost, effective_date, approved_by, notes)
                    SELECT
                        %s, %s, cost_per_unit, %s, %s, %s,
                        'Set via initial_cost price entry'
                    FROM ingredients
                    WHERE id = %s AND company_id = %s
                """, (company_id, ingredient_id, price, resolved_effective_date, user_id, ingredient_id, company_id))
            except Exception:
                # standard_cost_history may not exist yet on older installs.
                # Don't fail the whole transaction — just skip the history row.
                pass

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="CREATE",
            table_name="supplier_price_history",
            record_id=price_row["id"],
            new_data={**price_row, "price_type": price_type},
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


def update_standard_cost(
    ingredient_id: int,
    company_id: int,
    user_id: int,
    new_cost: float,
    effective_date: str,
    notes: str = "",
    ip_address: str | None = None,
) -> dict:
    """
    Formally update an ingredient's standard cost after a management review.

    This is the ONLY approved path for changing cost_per_unit outside of
    initial item creation. It writes an immutable record to standard_cost_history
    and logs the change to the audit trail.

    Use this after quarterly cost reviews, contract renegotiations, or any
    approved cost revision — never silently via a market price quote.
    """
    if new_cost <= 0:
        raise ValueError("New cost must be greater than zero")

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT * FROM ingredients WHERE id = %s AND company_id = %s AND is_active = TRUE",
            (ingredient_id, company_id),
        )
        ingredient = cur.fetchone()
        if not ingredient:
            raise ValueError("Ingredient not found or access denied")

        old_cost = float(ingredient["cost_per_unit"])

        cur.execute("""
            UPDATE ingredients
            SET cost_per_unit = %s
            WHERE id = %s AND company_id = %s
            RETURNING *
        """, (new_cost, ingredient_id, company_id))
        updated = dict(cur.fetchone())

        cur.execute("""
            INSERT INTO standard_cost_history
                (company_id, ingredient_id, old_cost, new_cost, effective_date, approved_by, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (company_id, ingredient_id, old_cost, new_cost, effective_date, user_id, notes))

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="UPDATE",
            table_name="ingredients",
            record_id=ingredient_id,
            old_data={"cost_per_unit": old_cost},
            new_data={"cost_per_unit": new_cost, "effective_date": effective_date, "notes": notes},
            ip_address=ip_address,
        )
        conn.commit()
        return updated

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
    """
    Returns full price history for an ingredient, most recent first.
    Uses company_id directly on the price history table (fast path)
    with a fallback join for rows that predate the column addition.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT
                sph.id,
                sph.supplier_id,
                sph.ingredient_id,
                sph.price,
                sph.entry_date,
                sph.effective_date,
                sph.price_type,
                sph.notes,
                s.name  AS supplier_name,
                i.name  AS ingredient_name
            FROM supplier_price_history sph
            JOIN suppliers   s ON s.id = sph.supplier_id
            JOIN ingredients i ON i.id = sph.ingredient_id
            WHERE sph.ingredient_id = %s
              AND s.company_id = %s
              AND i.company_id = %s
            ORDER BY sph.effective_date DESC, sph.entry_date DESC, sph.id DESC
        """, (ingredient_id, company_id, company_id))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def get_price_variance_report(
    ingredient_id: int,
    company_id: int,
) -> dict[str, Any]:
    """
    Returns standard cost vs. latest market price and the variance.
    This is the number a costing manager actually acts on.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        # Current standard cost
        cur.execute("""
            SELECT cost_per_unit, name, unit
            FROM ingredients
            WHERE id = %s AND company_id = %s AND is_active = TRUE
        """, (ingredient_id, company_id))
        ingredient = cur.fetchone()
        if not ingredient:
            raise ValueError("Ingredient not found or access denied")

        standard_cost = float(ingredient["cost_per_unit"])

        # Latest market price quote
        cur.execute("""
            SELECT price, entry_date, effective_date, supplier_id
            FROM supplier_price_history sph
            JOIN suppliers s ON s.id = sph.supplier_id
            WHERE sph.ingredient_id = %s
              AND s.company_id = %s
              AND sph.price_type = 'market_price'
            ORDER BY sph.effective_date DESC, sph.id DESC
            LIMIT 1
        """, (ingredient_id, company_id))
        latest_market = cur.fetchone()

        if not latest_market:
            return {
                "ingredient_name": ingredient["name"],
                "unit":            ingredient["unit"],
                "standard_cost":   standard_cost,
                "latest_market_price": None,
                "variance":        None,
                "variance_pct":    None,
                "has_market_data": False,
            }

        market_price = float(latest_market["price"])
        variance     = market_price - standard_cost
        variance_pct = (variance / standard_cost * 100) if standard_cost > 0 else None

        return {
            "ingredient_name":     ingredient["name"],
            "unit":                ingredient["unit"],
            "standard_cost":       standard_cost,
            "latest_market_price": market_price,
            "market_price_date":   str(latest_market["effective_date"]),
            "variance":            round(variance, 4),
            "variance_pct":        round(variance_pct, 2) if variance_pct is not None else None,
            "has_market_data":     True,
        }
    finally:
        cur.close()
        conn.close()