"""
app/database/suppliers.py
Enterprise-grade supplier management with proper price type gating,
standard cost protection, and approval-based cost updating.
"""

import psycopg2
from typing import Any

from .connection import get_connection, dict_cursor
from .log_audit import log_audit

# ── Valid price types ─────────────────────────────────────────────────────────
VALID_PRICE_TYPES = {"initial_cost", "market_price", "contract_price", "spot_price"}

# Only initial_cost auto-approves and updates standard cost immediately.
# All other types require manager approval before touching cost_per_unit.
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
    purchase_date: str,
    company_id: int,
    user_id: int,
    notes: str = "",
    price_type: str = "market_price",
    ip_address: str | None = None,
) -> dict:
    """
    Record a supplier price quote.

    Price type controls approval flow and whether standard cost is updated:
      - initial_cost   → auto-approved, sets cost_per_unit immediately (first-time setup)
      - market_price   → pending approval; cost only updates after manager approves
      - contract_price → pending approval; informational until approved
      - spot_price     → pending approval; informational until approved
    """
    if price_type not in VALID_PRICE_TYPES:
        raise ValueError(
            f"Invalid price_type '{price_type}'. "
            f"Must be one of: {', '.join(sorted(VALID_PRICE_TYPES))}"
        )

    if price <= 0:
        raise ValueError("Price must be greater than zero")

    # initial_cost is system-generated at item creation — auto-approve it.
    # Everything else requires a manager to review before touching standard cost.
    initial_status = "approved" if price_type == "initial_cost" else "pending"

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        # Verify supplier and ingredient belong to this company and are active
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
                (supplier_id, ingredient_id, price, purchase_date, notes,
                 price_type, status, company_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (supplier_id, ingredient_id, price, purchase_date, notes,
              price_type, initial_status, company_id))
        price_row = dict(cur.fetchone())

        # Only initial_cost updates standard cost immediately (auto-approved).
        # All other types wait for approve_supplier_price() to be called.
        if price_type in COST_UPDATING_PRICE_TYPES:
            cur.execute("""
                UPDATE ingredients
                SET cost_per_unit = %s,
                    supplier_id   = %s
                WHERE id = %s AND company_id = %s
            """, (price, supplier_id, ingredient_id, company_id))

            try:
                cur.execute("""
                    INSERT INTO standard_cost_history
                        (company_id, ingredient_id, old_cost, new_cost,
                         effective_date, approved_by, notes)
                    SELECT %s, %s, cost_per_unit, %s, %s, %s,
                           'Set via initial_cost price entry'
                    FROM ingredients
                    WHERE id = %s AND company_id = %s
                """, (company_id, ingredient_id, price, purchase_date,
                      user_id, ingredient_id, company_id))
            except Exception:
                pass  # standard_cost_history may not exist on older installs

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="CREATE",
            table_name="supplier_price_history",
            record_id=price_row["id"],
            new_data={**price_row, "price_type": price_type, "status": initial_status},
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


def approve_supplier_price(
    price_id: int,
    company_id: int,
    approver_id: int,
    action: str,  # "approved" or "rejected"
    ip_address: str | None = None,
) -> dict:
    """
    Approve or reject a pending supplier price record.

    Only on approval does the ingredient standard cost get updated.
    Rejected records are preserved in history for audit purposes.
    """
    if action not in {"approved", "rejected"}:
        raise ValueError("Action must be 'approved' or 'rejected'")

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT sph.*
            FROM supplier_price_history sph
            JOIN suppliers s ON s.id = sph.supplier_id
            WHERE sph.id = %s
              AND s.company_id = %s
              AND sph.status = 'pending'
        """, (price_id, company_id))
        price_row = cur.fetchone()
        if not price_row:
            raise ValueError("Price record not found, already reviewed, or access denied")

        price_row = dict(price_row)

        cur.execute("""
            UPDATE supplier_price_history
            SET status      = %s,
                approved_by = %s,
                approved_at = NOW()
            WHERE id = %s
            RETURNING *
        """, (action, approver_id, price_id))
        updated = dict(cur.fetchone())

        # Update standard cost only on approval
        if action == "approved":
            cur.execute("""
                UPDATE ingredients
                SET cost_per_unit = %s,
                    supplier_id   = %s
                WHERE id = %s AND company_id = %s
            """, (price_row["price"], price_row["supplier_id"],
                  price_row["ingredient_id"], company_id))

            try:
                cur.execute("""
                    INSERT INTO standard_cost_history
                        (company_id, ingredient_id, old_cost, new_cost,
                         effective_date, approved_by, notes)
                    SELECT %s, %s, cost_per_unit, %s, %s, %s,
                           'Approved via supplier price review'
                    FROM ingredients
                    WHERE id = %s AND company_id = %s
                """, (company_id, price_row["ingredient_id"], price_row["price"],
                      price_row["purchase_date"], approver_id,
                      price_row["ingredient_id"], company_id))
            except Exception:
                pass  # standard_cost_history may not exist on older installs

        log_audit(
            conn,
            company_id=company_id,
            user_id=approver_id,
            action="UPDATE",
            table_name="supplier_price_history",
            record_id=price_id,
            old_data={"status": "pending"},
            new_data={"status": action, "approved_by": approver_id},
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
    initial item creation or price approval. It writes an immutable record
    to standard_cost_history and logs the change to the audit trail.
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
                (company_id, ingredient_id, old_cost, new_cost,
                 effective_date, approved_by, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (company_id, ingredient_id, old_cost, new_cost,
              effective_date, user_id, notes))

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
    Includes status so the frontend can show pending/approved/rejected badges.
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
                sph.purchase_date,
                sph.price_type,
                sph.status,
                sph.approved_by,
                sph.approved_at,
                sph.notes,
                s.name AS supplier_name,
                i.name AS ingredient_name
            FROM supplier_price_history sph
            JOIN suppliers   s ON s.id = sph.supplier_id
            JOIN ingredients i ON i.id = sph.ingredient_id
            WHERE sph.ingredient_id = %s
              AND s.company_id = %s
              AND i.company_id = %s
            ORDER BY sph.purchase_date DESC, sph.id DESC
        """, (ingredient_id, company_id, company_id))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def get_pending_price_approvals(company_id: int) -> list[dict[str, Any]]:
    """
    Returns all pending price records across all ingredients for this company.
    Used to populate the manager's approval queue.
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
                sph.purchase_date,
                sph.price_type,
                sph.status,
                sph.notes,
                s.name AS supplier_name,
                i.name AS ingredient_name,
                i.unit AS ingredient_unit,
                i.cost_per_unit AS current_standard_cost
            FROM supplier_price_history sph
            JOIN suppliers   s ON s.id = sph.supplier_id
            JOIN ingredients i ON i.id = sph.ingredient_id
            WHERE sph.status = 'pending'
              AND s.company_id = %s
              AND i.company_id = %s
            ORDER BY sph.purchase_date DESC, sph.id DESC
        """, (company_id, company_id))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def get_price_variance_report(
    ingredient_id: int,
    company_id: int,
) -> dict[str, Any]:
    """
    Returns standard cost vs. latest approved market price and the variance.
    Only approved prices are used — pending records don't affect costing numbers.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT cost_per_unit, name, unit
            FROM ingredients
            WHERE id = %s AND company_id = %s AND is_active = TRUE
        """, (ingredient_id, company_id))
        ingredient = cur.fetchone()
        if not ingredient:
            raise ValueError("Ingredient not found or access denied")

        standard_cost = float(ingredient["cost_per_unit"])

        # Only approved market prices count for variance reporting
        cur.execute("""
            SELECT sph.price, sph.purchase_date, sph.supplier_id
            FROM supplier_price_history sph
            JOIN suppliers s ON s.id = sph.supplier_id
            WHERE sph.ingredient_id = %s
              AND s.company_id = %s
              AND sph.price_type = 'market_price'
              AND sph.status = 'approved'
            ORDER BY sph.purchase_date DESC, sph.id DESC
            LIMIT 1
        """, (ingredient_id, company_id))
        latest_market = cur.fetchone()

        if not latest_market:
            return {
                "ingredient_name":     ingredient["name"],
                "unit":                ingredient["unit"],
                "standard_cost":       standard_cost,
                "latest_market_price": None,
                "variance":            None,
                "variance_pct":        None,
                "has_market_data":     False,
            }

        market_price = float(latest_market["price"])
        variance     = market_price - standard_cost
        variance_pct = (variance / standard_cost * 100) if standard_cost > 0 else None

        return {
            "ingredient_name":     ingredient["name"],
            "unit":                ingredient["unit"],
            "standard_cost":       standard_cost,
            "latest_market_price": market_price,
            "market_price_date":   str(latest_market["purchase_date"]),
            "variance":            round(variance, 4),
            "variance_pct":        round(variance_pct, 2) if variance_pct is not None else None,
            "has_market_data":     True,
        }
    finally:
        cur.close()
        conn.close()