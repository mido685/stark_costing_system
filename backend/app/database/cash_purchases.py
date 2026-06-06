# app/database/cash_purchases.py
"""
Cash purchases, petty cash ledger, expense categories, and invoice storage.
Every public function accepts company_id for tenant isolation.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

import psycopg2
import psycopg2.extras

from .connection import get_connection, dict_cursor
from .log_audit import log_audit
from .periods import is_period_frozen, is_period_frozen_with_cur


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

_VALID_CATEGORY_TYPES = {"inventory", "expense", "asset", "service"}
_VALID_PURCHASE_TYPES = {"branch_cash", "emergency"}


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _floatify(value: Any) -> Any:
    return float(value) if hasattr(value, "__round__") and not isinstance(value, int) else value


def _row(row: dict[str, Any]) -> dict[str, Any]:
    return {k: _floatify(v) for k, v in row.items()}


def _ensure_branch_access(cur, branch_id: int, company_id: int) -> None:
    """Raise ValueError if branch does not belong to company (tenant guard)."""
    cur.execute(
        "SELECT id FROM branches WHERE id = %s AND company_id = %s AND is_active = TRUE",
        (branch_id, company_id),
    )
    if not cur.fetchone():
        raise ValueError("Branch not found or access denied")


def _get_petty_cash_balance(cur, company_id: int, branch_id: int) -> Decimal:
    """
    Return the current petty cash balance as Decimal for safe arithmetic.
    Uses the most recent ledger row ordered by (entry_date DESC, id DESC)
    so same-day multiple entries are handled correctly.
    """
    cur.execute("""
        SELECT COALESCE(balance_after, 0) AS balance
        FROM petty_cash_ledger
        WHERE company_id = %s AND branch_id = %s
          AND balance_after IS NOT NULL
        ORDER BY entry_date DESC, id DESC
        LIMIT 1
    """, (company_id, branch_id))
    row = cur.fetchone()
    return Decimal(str(row["balance"] if row else 0))


def _deduct_petty_cash(
    cur,
    company_id: int,
    branch_id: int,
    amount: Decimal,
    purchase_id: int,
    approved_by: int | None,
    entry_date: str,
    notes: str,
) -> None:
    """
    Deduct petty cash inside an existing transaction cursor.
    Raises ValueError if the balance would go negative.
    """
    balance = _get_petty_cash_balance(cur, company_id, branch_id)
    new_balance = balance - amount
    if new_balance < 0:
        raise ValueError(
            f"Insufficient petty cash balance "
            f"(available: {float(balance):.2f}, required: {float(amount):.2f})"
        )
    cur.execute("""
        INSERT INTO petty_cash_ledger
            (company_id, branch_id, entry_date, txn_type, amount,
             balance_after, ref_table, ref_id, notes, created_by)
        VALUES (%s, %s, %s, 'spend', %s, %s, 'cash_purchases', %s, %s, %s)
    """, (
        company_id, branch_id, entry_date,
        amount, new_balance,
        purchase_id, notes, approved_by,
    ))


# ─────────────────────────────────────────────────────────────────────────────
# Cash Purchases — CRUD
# ─────────────────────────────────────────────────────────────────────────────

def list_cash_purchases(
    company_id: int,
    branch_id: int | None = None,
    purchase_type: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        conditions = ["cp.company_id = %s"]
        params: list[Any] = [company_id]
        if branch_id:
            conditions.append("cp.branch_id = %s")
            params.append(branch_id)
        if purchase_type:
            if purchase_type not in _VALID_PURCHASE_TYPES:
                raise ValueError(f"purchase_type must be one of {_VALID_PURCHASE_TYPES}")
            conditions.append("cp.purchase_type = %s")
            params.append(purchase_type)

        cur.execute(f"""
            SELECT cp.*,
                   b.name  AS branch_name,
                   s.name  AS supplier_name,
                   i.name  AS ingredient_name,
                   i.unit  AS ingredient_unit,
                   ec.name AS category_name,
                   ec.type AS category_type
            FROM cash_purchases cp
            JOIN branches b              ON b.id  = cp.branch_id
            LEFT JOIN suppliers   s      ON s.id  = cp.supplier_id
            LEFT JOIN ingredients i      ON i.id  = cp.ingredient_id
            LEFT JOIN expense_categories ec ON ec.id = cp.category_id
            WHERE {' AND '.join(conditions)}
            ORDER BY cp.entry_date DESC, cp.id DESC
            LIMIT %s
        """, params + [limit])
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def get_cash_purchase(purchase_id: int, company_id: int) -> dict[str, Any] | None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT cp.*,
                   b.name  AS branch_name,
                   s.name  AS supplier_name,
                   i.name  AS ingredient_name,
                   i.unit  AS ingredient_unit,
                   ec.name AS category_name,
                   ec.type AS category_type
            FROM cash_purchases cp
            JOIN branches b              ON b.id  = cp.branch_id
            LEFT JOIN suppliers   s      ON s.id  = cp.supplier_id
            LEFT JOIN ingredients i      ON i.id  = cp.ingredient_id
            LEFT JOIN expense_categories ec ON ec.id = cp.category_id
            WHERE cp.id = %s AND cp.company_id = %s
        """, (purchase_id, company_id))
        row = cur.fetchone()
        return _row(dict(row)) if row else None
    finally:
        cur.close()
        conn.close()


def add_cash_purchase(
    branch_id: int,
    company_id: int,
    user_id: int,
    entry_date: str,
    supplier_id: int | None = None,
    ingredient_id: int | None = None,
    category_id: int | None = None,
    quantity: float = 0,
    unit_cost: float = 0,
    purchase_type: str = "branch_cash",
    tax_amount: float = 0,
    payable_amount: float = 0,
    petty_cash_used: bool = False,
    notes: str = "",
    status: str = "pending",
    ip_address: str | None = None,
) -> dict[str, Any]:
    """
    Create a cash purchase record.

    Validation rules:
    - Exactly one of ingredient_id or category_id must be set.
      ingredient_id alone covers inventory-type purchases.
      category_id alone covers expense / asset / service purchases.
    - Both None OR both set → ValueError.
    - Period must be open.
    - Branch must belong to company.
    - category_id (if given) must be active and belong to this company.
    - purchase_type must be a valid value.
    """
    # ── Input validation ─────────────────────────────────────────────────────
    has_ingredient = bool(ingredient_id)
    has_category   = bool(category_id)
    if has_ingredient and has_category:
        raise ValueError("Provide exactly one of ingredient_id or category_id, not both")
    if not has_ingredient and not has_category:
        raise ValueError("Provide exactly one of ingredient_id or category_id")
    if purchase_type not in _VALID_PURCHASE_TYPES:
        raise ValueError(f"purchase_type must be one of {_VALID_PURCHASE_TYPES}")
    if is_period_frozen(branch_id, entry_date):
        raise ValueError("This accounting period is closed for the selected branch")
 

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _ensure_branch_access(cur, branch_id, company_id)

        # Validate category belongs to this company and is active
        if category_id:
            cur.execute("""
                SELECT id FROM expense_categories
                WHERE id = %s AND company_id = %s AND is_active = TRUE
            """, (category_id, company_id))
            if not cur.fetchone():
                raise ValueError("Invalid or inactive category_id for this company")

        gross_amount = round(quantity * unit_cost, 2)
        payable      = payable_amount or round(gross_amount + tax_amount, 2)

        cur.execute("""
            INSERT INTO cash_purchases
                (company_id, branch_id, supplier_id, ingredient_id, category_id,
                 purchase_type, entry_date, quantity, unit_cost, gross_amount,
                 tax_amount, payable_amount, petty_cash_used, status, notes, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (
            company_id, branch_id, supplier_id, ingredient_id, category_id,
            purchase_type, entry_date, quantity, unit_cost, gross_amount,
            tax_amount, payable, petty_cash_used, status, notes, user_id,
        ))
        purchase = _row(dict(cur.fetchone()))

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            branch_id=branch_id,
            action="CREATE",
            table_name="cash_purchases",
            record_id=purchase["id"],
            new_data=purchase,
            ip_address=ip_address,
        )
        conn.commit()
        return purchase
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def approve_cash_purchase(
    purchase_id: int,
    company_id: int,
    approved_by: int,
    ip_address: str | None = None,
) -> dict[str, Any]:
    """
    Approve a cash purchase and route its financial effect:

      ingredient_id set  → inventory_movements (adds stock)
      category_type = 'inventory'  → inventory_movements (adds stock via category)
      category_type = 'expense'    → expenses table
      category_type = 'service'    → expenses table
      category_type = 'asset'      → assets table

    Petty cash is deducted ONLY on approval (never on creation) and
    ONLY if balance is sufficient — raises ValueError otherwise.

    Uses SELECT … FOR UPDATE to prevent double-approval race conditions.
    Does NOT update ingredient.cost_per_unit on approval — that is a
    deliberate choice to keep cost_per_unit as the master price set by
    procurement, not overwritten by every cash purchase.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        # Lock the row to prevent concurrent approvals
        cur.execute("""
            SELECT cp.*,
                   ec.type AS category_type,
                   ec.name AS category_name
            FROM cash_purchases cp
            LEFT JOIN expense_categories ec ON ec.id = cp.category_id
            WHERE cp.id = %s AND cp.company_id = %s
            FOR UPDATE of cp
        """, (purchase_id, company_id))
        purchase = cur.fetchone()
        if not purchase:
            raise ValueError("Cash purchase not found or access denied")

        purchase = dict(purchase)

        # Idempotency / state guard
        if purchase["status"] == "approved":
            raise ValueError("This cash purchase is already approved")
        if purchase["status"] == "rejected":
            raise ValueError("Rejected purchases cannot be approved")

        # Period must still be open at approval time
        if is_period_frozen_with_cur(cur, company_id, str(purchase["entry_date"])):
            raise ValueError("This accounting period is closed for the selected branch")

        category_type = purchase.get("category_type")
        ingredient_id = purchase.get("ingredient_id")

        # Routing guard — every purchase must land somewhere
        if not ingredient_id and not category_type:
            raise ValueError(
                "Cannot approve: purchase has no ingredient_id and no category — "
                "cannot determine routing"
            )

        # ── Route financial effect ────────────────────────────────────────────

        if ingredient_id:
            # Direct ingredient purchase → add to stock
            cur.execute("""
                INSERT INTO inventory_movements
                    (branch_id, ingredient_id, movement_type, entry_date,
                     quantity_delta, unit_cost, reference_table, reference_id, notes)
                VALUES (%s, %s, 'purchase', %s, %s, %s, 'cash_purchases', %s, %s)
            """, (
                purchase["branch_id"], ingredient_id, purchase["entry_date"],
                purchase["quantity"], purchase["unit_cost"],
                purchase_id, purchase["notes"],
            ))

        elif category_type == "inventory":
            # Category-routed inventory purchase — ingredient_id is required
            if not ingredient_id:
                raise ValueError(
                    "Inventory category purchase requires ingredient_id"
                )
            cur.execute("""
                INSERT INTO inventory_movements
                    (branch_id, ingredient_id, movement_type, entry_date,
                     quantity_delta, unit_cost, reference_table, reference_id, notes)
                VALUES (%s, %s, 'purchase', %s, %s, %s, 'cash_purchases', %s, %s)
            """, (
                purchase["branch_id"], ingredient_id, purchase["entry_date"],
                purchase["quantity"], purchase["unit_cost"],
                purchase_id, purchase["notes"],
            ))

        elif category_type in ("expense", "service"):
            cur.execute("""
                INSERT INTO expenses
                    (branch_id, entry_date, category_id, amount, reference_id, notes)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                purchase["branch_id"], purchase["entry_date"],
                purchase["category_id"], purchase["payable_amount"],
                purchase_id, purchase["notes"],
            ))

        elif category_type == "asset":
            cur.execute("""
                INSERT INTO assets
                    (branch_id, category_id, entry_date, cost, reference_id, notes)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                purchase["branch_id"], purchase["category_id"],
                purchase["entry_date"], purchase["payable_amount"],
                purchase_id, purchase["notes"],
            ))

        else:
            raise ValueError(f"Unhandled category type: {category_type!r}")

        # ── Petty cash deduction (balance-checked, inside transaction) ────────
        if purchase["petty_cash_used"]:
            _deduct_petty_cash(
                cur,
                company_id=company_id,
                branch_id=purchase["branch_id"],
                amount=Decimal(str(purchase["payable_amount"])),
                purchase_id=purchase_id,
                approved_by=approved_by,
                entry_date=str(purchase["entry_date"]),
                notes=purchase["notes"] or "",
            )

        # ── Mark approved ─────────────────────────────────────────────────────
        cur.execute("""
            UPDATE cash_purchases
            SET status = 'approved', approved_by = %s, approved_at = NOW()
            WHERE id = %s
            RETURNING *
        """, (approved_by, purchase_id))
        approved = _row(dict(cur.fetchone()))

        log_audit(
            conn,
            company_id=company_id,
            user_id=approved_by,
            branch_id=approved["branch_id"],
            action="APPROVE",
            table_name="cash_purchases",
            record_id=purchase_id,
            old_data=purchase,
            new_data=approved,
            ip_address=ip_address,
        )
        conn.commit()
        return approved

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def reject_cash_purchase(
    purchase_id: int,
    company_id: int,
    rejected_by: int,
    reason: str = "",
    ip_address: str | None = None,
) -> dict[str, Any]:
    """
    Reject a pending cash purchase. No financial movements are created.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT * FROM cash_purchases
            WHERE id = %s AND company_id = %s
            FOR UPDATE
        """, (purchase_id, company_id))
        purchase = cur.fetchone()
        if not purchase:
            raise ValueError("Cash purchase not found or access denied")
        if purchase["status"] != "pending":
            raise ValueError("Only pending cash purchases can be rejected")

        cur.execute("""
            UPDATE cash_purchases
            SET status = 'rejected', approved_by = %s, approved_at = NOW(),
                notes = CASE WHEN notes = '' OR notes IS NULL
                             THEN %s
                             ELSE notes || E'\n' || %s
                        END
            WHERE id = %s
            RETURNING *
        """, (rejected_by, reason, reason, purchase_id))
        rejected = _row(dict(cur.fetchone()))

        log_audit(
            conn,
            company_id=company_id,
            user_id=rejected_by,
            branch_id=rejected["branch_id"],
            action="REJECT",
            table_name="cash_purchases",
            record_id=purchase_id,
            old_data=dict(purchase),
            new_data=rejected,
            ip_address=ip_address,
        )
        conn.commit()
        return rejected
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Petty Cash
# ─────────────────────────────────────────────────────────────────────────────

def get_petty_cash_balance(company_id: int, branch_id: int) -> float:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _ensure_branch_access(cur, branch_id, company_id)
        return float(_get_petty_cash_balance(cur, company_id, branch_id))
    finally:
        cur.close()
        conn.close()


def top_up_petty_cash(
    company_id: int,
    branch_id: int,
    amount: float,
    entry_date: str,
    user_id: int,
    notes: str = "",
    ip_address: str | None = None,
) -> float:
    """
    Add funds to petty cash. Returns the new balance.
    Validates amount > 0 and period is open before writing.
    """
    if amount <= 0:
        raise ValueError("Top-up amount must be greater than zero")
    if is_period_frozen(branch_id, entry_date):
        raise ValueError("This accounting period is closed for the selected branch")

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _ensure_branch_access(cur, branch_id, company_id)

        balance     = _get_petty_cash_balance(cur, company_id, branch_id)
        new_balance = balance + Decimal(str(amount))

        cur.execute("""
            INSERT INTO petty_cash_ledger
                (company_id, branch_id, entry_date, txn_type, amount,
                 balance_after, notes, created_by)
            VALUES (%s, %s, %s, 'top_up', %s, %s, %s, %s)
            RETURNING *
        """, (company_id, branch_id, entry_date, amount, new_balance, notes, user_id))
        row = dict(cur.fetchone())

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            branch_id=branch_id,
            action="CREATE",
            table_name="petty_cash_ledger",
            record_id=row["id"],
            new_data=row,
            ip_address=ip_address,
        )
        conn.commit()
        return float(new_balance)
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def list_petty_cash_ledger(
    company_id: int,
    branch_id: int,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Returns petty cash ledger with branch_name — restores join dropped in v2."""
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _ensure_branch_access(cur, branch_id, company_id)
        cur.execute("""
            SELECT pcl.*, b.name AS branch_name
            FROM petty_cash_ledger pcl
            JOIN branches b ON b.id = pcl.branch_id
            WHERE pcl.company_id = %s AND pcl.branch_id = %s
            ORDER BY pcl.entry_date DESC, pcl.id DESC
            LIMIT %s
        """, (company_id, branch_id, limit))
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Expense Categories
# ─────────────────────────────────────────────────────────────────────────────

def list_expense_categories(
    company_id: int,
    category_type: str | None = None,
) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        if category_type:
            if category_type not in _VALID_CATEGORY_TYPES:
                raise ValueError(f"category_type must be one of {_VALID_CATEGORY_TYPES}")
            cur.execute("""
                SELECT id, name, type, is_active, created_at
                FROM expense_categories
                WHERE company_id = %s AND type = %s AND is_active = TRUE
                ORDER BY name
            """, (company_id, category_type))
        else:
            cur.execute("""
                SELECT id, name, type, is_active, created_at
                FROM expense_categories
                WHERE company_id = %s AND is_active = TRUE
                ORDER BY type, name
            """, (company_id,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def add_expense_category(
    company_id: int,
    name: str,
    category_type: str,
    user_id: int,
    ip_address: str | None = None,
) -> dict[str, Any]:
    """
    Create a custom category for a company.
    Validates type, strips whitespace, raises friendly error on duplicate.
    """
    name = name.strip()
    if not name:
        raise ValueError("Category name cannot be empty")
    if category_type not in _VALID_CATEGORY_TYPES:
        raise ValueError(f"category_type must be one of {sorted(_VALID_CATEGORY_TYPES)}")

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            INSERT INTO expense_categories (company_id, name, type)
            VALUES (%s, %s, %s)
            RETURNING *
        """, (company_id, name, category_type))
        category = dict(cur.fetchone())

        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="CREATE",
            table_name="expense_categories",
            record_id=category["id"],
            new_data=category,
            ip_address=ip_address,
        )
        conn.commit()
        return category
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise ValueError(f"Category '{name}' already exists for this company")
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def deactivate_expense_category(
    company_id: int,
    category_id: int,
    user_id: int,
    ip_address: str | None = None,
) -> None:
    """Soft-delete a category. Existing records that reference it are unaffected."""
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            UPDATE expense_categories
            SET is_active = FALSE
            WHERE id = %s AND company_id = %s
            RETURNING id
        """, (category_id, company_id))
        if not cur.fetchone():
            raise ValueError("Category not found or access denied")
        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="DEACTIVATE",
            table_name="expense_categories",
            record_id=category_id,
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
# Invoice Storage
# ─────────────────────────────────────────────────────────────────────────────

def save_invoice_record(
    company_id: int,
    ref_table: str,
    ref_id: int,
    file_name: str,
    file_path: str,
    mime_type: str,
    file_size_kb: int,
    user_id: int,
    notes: str = "",
    supplier_id: int | None = None,
    invoice_number: str | None = None,
    invoice_date: str | None = None,
    amount: float | None = None,
    branch_id: int | None = None,
    ip_address: str | None = None,
) -> int:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            INSERT INTO purchase_invoices
                (company_id, ref_table, ref_id, file_name, file_path,
                 mime_type, file_size_kb, notes, uploaded_by,
                 supplier_id, invoice_number, invoice_date, amount, branch_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (
            company_id, ref_table, ref_id, file_name, file_path,
            mime_type, file_size_kb, notes, user_id,
            supplier_id, invoice_number, invoice_date, amount, branch_id,
        ))
        invoice_id = cur.fetchone()["id"]
        log_audit(
            conn,
            company_id=company_id,
            user_id=user_id,
            action="CREATE",
            table_name="purchase_invoices",
            record_id=invoice_id,
            new_data={
                "ref_table": ref_table, "ref_id": ref_id,
                "file_name": file_name, "invoice_number": invoice_number,
                "invoice_date": invoice_date, "amount": amount,
            },
            ip_address=ip_address,
        )
        conn.commit()
        return invoice_id
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

def get_invoice(company_id: int, invoice_id: int) -> dict[str, Any] | None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT id, company_id, ref_table, ref_id, file_name,
                   file_path, mime_type, file_size_kb, notes,
                   uploaded_by, uploaded_at
            FROM purchase_invoices
            WHERE company_id = %s AND id = %s
        """, (company_id, invoice_id))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        cur.close()
        conn.close()


def list_invoices(
    company_id: int, ref_table: str, ref_id: int
) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT pi.id, pi.file_name, pi.mime_type, pi.file_size_kb,
                   pi.notes, pi.uploaded_at, pi.uploaded_by,
                   pi.invoice_number, pi.invoice_date, pi.amount,
                   pi.branch_id, pi.supplier_id,
                   b.name  AS branch_name,
                   s.name  AS supplier_name
            FROM purchase_invoices pi
            LEFT JOIN branches   b ON b.id = pi.branch_id
            LEFT JOIN suppliers  s ON s.id = pi.supplier_id
            WHERE pi.company_id = %s AND pi.ref_table = %s AND pi.ref_id = %s
            ORDER BY pi.uploaded_at ASC, pi.id ASC
        """, (company_id, ref_table, ref_id))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()
def search_invoices(
    company_id:     int,
    ref_table:      str | None = None,
    branch_id:      int | None = None,
    supplier_id:    int | None = None,
    invoice_number: str | None = None,
    date_from:      str | None = None,
    date_to:        str | None = None,
    limit:          int = 50,
) -> list[dict[str, Any]]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        conditions = ["pi.company_id = %s"]
        params: list[Any] = [company_id]

        if ref_table:
            conditions.append("pi.ref_table = %s")
            params.append(ref_table)
        if branch_id:
            conditions.append("pi.branch_id = %s")
            params.append(branch_id)
        if supplier_id:
            conditions.append("pi.supplier_id = %s")
            params.append(supplier_id)
        if invoice_number:
            conditions.append("pi.invoice_number ILIKE %s")
            params.append(f"%{invoice_number}%")
        if date_from:
            conditions.append("pi.invoice_date >= %s")
            params.append(date_from)
        if date_to:
            conditions.append("pi.invoice_date <= %s")
            params.append(date_to)

        cur.execute(f"""
            SELECT
                pi.id, pi.ref_table, pi.ref_id,
                pi.file_name, pi.mime_type, pi.file_size_kb,
                pi.notes, pi.uploaded_at,
                pi.invoice_number, pi.invoice_date, pi.amount,
                b.name AS branch_name,
                s.name AS supplier_name
            FROM purchase_invoices pi
            LEFT JOIN branches  b ON b.id = pi.branch_id
            LEFT JOIN suppliers s ON s.id = pi.supplier_id
            WHERE {' AND '.join(conditions)}
            ORDER BY pi.uploaded_at DESC
            LIMIT %s
        """, params + [limit])
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()