# app/database/cash_purchases.py
from __future__ import annotations

from decimal import Decimal
from typing import Any

import psycopg2
import psycopg2.extras

from .connection import get_connection, dict_cursor
from .log_audit import log_audit
from .periods import is_period_frozen, is_period_frozen_with_cur
from .system_logger import log_event


_VALID_CATEGORY_TYPES = {"inventory", "expense", "asset", "service"}
_VALID_PURCHASE_TYPES = {"branch_cash", "emergency"}


# ── helpers ──────────────────────────────────────────────────────────────────

def _floatify(value: Any) -> Any:
    return float(value) if hasattr(value, "__round__") and not isinstance(value, int) else value

def _row(row: dict[str, Any]) -> dict[str, Any]:
    return {k: _floatify(v) for k, v in row.items()}

def _ensure_branch_access(cur, branch_id: int, company_id: int) -> None:
    cur.execute(
        "SELECT id FROM branches WHERE id = %s AND company_id = %s AND is_active = TRUE",
        (branch_id, company_id),
    )
    if not cur.fetchone():
        raise ValueError("Branch not found or access denied")

def _get_petty_cash_balance(cur, company_id: int, branch_id: int) -> Decimal:
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

def _deduct_petty_cash(cur, company_id, branch_id, amount, purchase_id, approved_by, entry_date, notes):
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
    """, (company_id, branch_id, entry_date, amount, new_balance, purchase_id, notes, approved_by))


# ── Cash Purchases — CRUD ────────────────────────────────────────────────────

def list_cash_purchases(company_id, branch_id=None, purchase_type=None, limit=50):
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        conditions = ["cp.company_id = %s"]
        params: list[Any] = [company_id]
        if branch_id:
            conditions.append("cp.branch_id = %s"); params.append(branch_id)
        if purchase_type:
            if purchase_type not in _VALID_PURCHASE_TYPES:
                raise ValueError(f"purchase_type must be one of {_VALID_PURCHASE_TYPES}")
            conditions.append("cp.purchase_type = %s"); params.append(purchase_type)
        cur.execute(f"""
            SELECT cp.*, b.name AS branch_name, s.name AS supplier_name,
                   i.name AS ingredient_name, i.unit AS ingredient_unit,
                   ec.name AS category_name, ec.type AS category_type
            FROM cash_purchases cp
            JOIN branches b ON b.id = cp.branch_id
            LEFT JOIN suppliers s ON s.id = cp.supplier_id
            LEFT JOIN ingredients i ON i.id = cp.ingredient_id
            LEFT JOIN expense_categories ec ON ec.id = cp.category_id
            WHERE {' AND '.join(conditions)}
            ORDER BY cp.entry_date DESC, cp.id DESC
            LIMIT %s
        """, params + [limit])
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()


def get_cash_purchase(purchase_id, company_id):
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT cp.*, b.name AS branch_name, s.name AS supplier_name,
                   i.name AS ingredient_name, i.unit AS ingredient_unit,
                   ec.name AS category_name, ec.type AS category_type
            FROM cash_purchases cp
            JOIN branches b ON b.id = cp.branch_id
            LEFT JOIN suppliers s ON s.id = cp.supplier_id
            LEFT JOIN ingredients i ON i.id = cp.ingredient_id
            LEFT JOIN expense_categories ec ON ec.id = cp.category_id
            WHERE cp.id = %s AND cp.company_id = %s
        """, (purchase_id, company_id))
        row = cur.fetchone()
        return _row(dict(row)) if row else None
    finally:
        cur.close(); conn.close()


def add_cash_purchase(
    branch_id, company_id, user_id, entry_date,
    supplier_id=None, ingredient_id=None, category_id=None,
    quantity=0, unit_cost=0, purchase_type="branch_cash",
    tax_amount=0, payable_amount=0, petty_cash_used=False,
    notes="", status="pending", ip_address=None,
):
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
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING *
        """, (
            company_id, branch_id, supplier_id, ingredient_id, category_id,
            purchase_type, entry_date, quantity, unit_cost, gross_amount,
            tax_amount, payable, petty_cash_used, status, notes, user_id,
        ))
        purchase = _row(dict(cur.fetchone()))

        log_audit(conn, company_id=company_id, user_id=user_id, branch_id=branch_id,
                  action="CREATE", table_name="cash_purchases",
                  record_id=purchase["id"], new_data=purchase, ip_address=ip_address)
        log_event(conn, company_id=company_id, user_id=user_id, branch_id=branch_id,
                  action="created", category="data", entity_type="cash_purchases",
                  entity_id=purchase["id"], payload={
                      "purchase_type":   purchase_type,
                      "ingredient_id":   ingredient_id,
                      "category_id":     category_id,
                      "quantity":        quantity,
                      "unit_cost":       unit_cost,
                      "payable_amount":  payable,
                      "petty_cash_used": petty_cash_used,
                      "status":          status,
                  }, ip_address=ip_address)

        conn.commit()
        return purchase
    except Exception:
        conn.rollback(); raise
    finally:
        cur.close(); conn.close()


def approve_cash_purchase(purchase_id, company_id, approved_by, ip_address=None):
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT cp.*, ec.type AS category_type, ec.name AS category_name
            FROM cash_purchases cp
            LEFT JOIN expense_categories ec ON ec.id = cp.category_id
            WHERE cp.id = %s AND cp.company_id = %s
            FOR UPDATE of cp
        """, (purchase_id, company_id))
        purchase = cur.fetchone()
        if not purchase:
            raise ValueError("Cash purchase not found or access denied")
        purchase = dict(purchase)

        if purchase["status"] == "approved":
            raise ValueError("This cash purchase is already approved")
        if purchase["status"] == "rejected":
            raise ValueError("Rejected purchases cannot be approved")
        if is_period_frozen_with_cur(cur, company_id, str(purchase["entry_date"])):
            raise ValueError("This accounting period is closed for the selected branch")

        category_type = purchase.get("category_type")
        ingredient_id = purchase.get("ingredient_id")
        if not ingredient_id and not category_type:
            raise ValueError("Cannot approve: purchase has no ingredient_id and no category")

        if ingredient_id:
            cur.execute("""
                INSERT INTO inventory_movements
                    (branch_id, ingredient_id, movement_type, entry_date,
                     quantity_delta, unit_cost, reference_table, reference_id, notes)
                VALUES (%s,%s,'purchase',%s,%s,%s,'cash_purchases',%s,%s)
            """, (purchase["branch_id"], ingredient_id, purchase["entry_date"],
                  purchase["quantity"], purchase["unit_cost"], purchase_id, purchase["notes"]))

        elif category_type == "inventory":
            if not ingredient_id:
                raise ValueError("Inventory category purchase requires ingredient_id")
            cur.execute("""
                INSERT INTO inventory_movements
                    (branch_id, ingredient_id, movement_type, entry_date,
                     quantity_delta, unit_cost, reference_table, reference_id, notes)
                VALUES (%s,%s,'purchase',%s,%s,%s,'cash_purchases',%s,%s)
            """, (purchase["branch_id"], ingredient_id, purchase["entry_date"],
                  purchase["quantity"], purchase["unit_cost"], purchase_id, purchase["notes"]))

        elif category_type in ("expense", "service"):
            cur.execute("""
                INSERT INTO expenses
                    (branch_id, entry_date, category_id, amount, reference_id, notes)
                VALUES (%s,%s,%s,%s,%s,%s)
            """, (purchase["branch_id"], purchase["entry_date"],
                  purchase["category_id"], purchase["payable_amount"],
                  purchase_id, purchase["notes"]))

        elif category_type == "asset":
            cur.execute("""
                INSERT INTO assets
                    (branch_id, category_id, entry_date, cost, reference_id, notes)
                VALUES (%s,%s,%s,%s,%s,%s)
            """, (purchase["branch_id"], purchase["category_id"],
                  purchase["entry_date"], purchase["payable_amount"],
                  purchase_id, purchase["notes"]))
        else:
            raise ValueError(f"Unhandled category type: {category_type!r}")

        if purchase["petty_cash_used"]:
            _deduct_petty_cash(
                cur, company_id=company_id, branch_id=purchase["branch_id"],
                amount=Decimal(str(purchase["payable_amount"])),
                purchase_id=purchase_id, approved_by=approved_by,
                entry_date=str(purchase["entry_date"]),
                notes=purchase["notes"] or "",
            )

        cur.execute("""
            UPDATE cash_purchases
            SET status = 'approved', approved_by = %s, approved_at = NOW()
            WHERE id = %s RETURNING *
        """, (approved_by, purchase_id))
        approved = _row(dict(cur.fetchone()))

        log_audit(conn, company_id=company_id, user_id=approved_by,
                  branch_id=approved["branch_id"], action="APPROVE",
                  table_name="cash_purchases", record_id=purchase_id,
                  old_data=purchase, new_data=approved, ip_address=ip_address)
        log_event(conn, company_id=company_id, user_id=approved_by,
                  branch_id=approved["branch_id"],
                  action="approved", category="data", entity_type="cash_purchases",
                  entity_id=purchase_id, payload={
                      "purchase_type":   purchase["purchase_type"],
                      "category_type":   category_type,
                      "ingredient_id":   ingredient_id,
                      "payable_amount":  purchase["payable_amount"],
                      "petty_cash_used": purchase["petty_cash_used"],
                      "changes":         {"status": "approved"},
                      "original":        {"status": purchase["status"]},
                  }, ip_address=ip_address)

        conn.commit()
        return approved
    except Exception:
        conn.rollback(); raise
    finally:
        cur.close(); conn.close()


def reject_cash_purchase(purchase_id, company_id, rejected_by, reason="", ip_address=None):
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT * FROM cash_purchases
            WHERE id = %s AND company_id = %s FOR UPDATE
        """, (purchase_id, company_id))
        purchase = cur.fetchone()
        if not purchase:
            raise ValueError("Cash purchase not found or access denied")
        if purchase["status"] != "pending":
            raise ValueError("Only pending cash purchases can be rejected")

        purchase = dict(purchase)

        cur.execute("""
            UPDATE cash_purchases
            SET status = 'rejected', approved_by = %s, approved_at = NOW(),
                notes = CASE WHEN notes = '' OR notes IS NULL THEN %s ELSE notes || E'\n' || %s END
            WHERE id = %s RETURNING *
        """, (rejected_by, reason, reason, purchase_id))
        rejected = _row(dict(cur.fetchone()))

        log_audit(conn, company_id=company_id, user_id=rejected_by,
                  branch_id=rejected["branch_id"], action="REJECT",
                  table_name="cash_purchases", record_id=purchase_id,
                  old_data=purchase, new_data=rejected, ip_address=ip_address)
        log_event(conn, company_id=company_id, user_id=rejected_by,
                  branch_id=rejected["branch_id"],
                  action="rejected", category="data", level="warning",
                  entity_type="cash_purchases", entity_id=purchase_id,
                  payload={
                      "purchase_type":  purchase["purchase_type"],
                      "payable_amount": purchase["payable_amount"],
                      "reason":         reason,
                      "changes":        {"status": "rejected"},
                      "original":       {"status": "pending"},
                  }, ip_address=ip_address)

        conn.commit()
        return rejected
    except Exception:
        conn.rollback(); raise
    finally:
        cur.close(); conn.close()


# ── Petty Cash ───────────────────────────────────────────────────────────────

def get_petty_cash_balance(company_id, branch_id):
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        _ensure_branch_access(cur, branch_id, company_id)
        return float(_get_petty_cash_balance(cur, company_id, branch_id))
    finally:
        cur.close(); conn.close()


def top_up_petty_cash(company_id, branch_id, amount, entry_date, user_id, notes="", ip_address=None):
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
            VALUES (%s,%s,%s,'top_up',%s,%s,%s,%s)
            RETURNING *
        """, (company_id, branch_id, entry_date, amount, new_balance, notes, user_id))
        row = dict(cur.fetchone())

        log_audit(conn, company_id=company_id, user_id=user_id, branch_id=branch_id,
                  action="CREATE", table_name="petty_cash_ledger",
                  record_id=row["id"], new_data=row, ip_address=ip_address)
        log_event(conn, company_id=company_id, user_id=user_id, branch_id=branch_id,
                  action="top_up", category="data", entity_type="petty_cash_ledger",
                  entity_id=row["id"], payload={
                      "amount":         amount,
                      "balance_before": float(balance),
                      "balance_after":  float(new_balance),
                  }, ip_address=ip_address)

        conn.commit()
        return float(new_balance)
    except Exception:
        conn.rollback(); raise
    finally:
        cur.close(); conn.close()


def list_petty_cash_ledger(company_id, branch_id, limit=50):
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
        cur.close(); conn.close()


# ── Expense Categories ───────────────────────────────────────────────────────

def list_expense_categories(company_id, category_type=None):
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        if category_type:
            if category_type not in _VALID_CATEGORY_TYPES:
                raise ValueError(f"category_type must be one of {_VALID_CATEGORY_TYPES}")
            cur.execute("""
                SELECT id, name, type, is_active, created_at
                FROM expense_categories
                WHERE company_id = %s AND type = %s AND is_active = TRUE ORDER BY name
            """, (company_id, category_type))
        else:
            cur.execute("""
                SELECT id, name, type, is_active, created_at
                FROM expense_categories
                WHERE company_id = %s AND is_active = TRUE ORDER BY type, name
            """, (company_id,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()


def add_expense_category(company_id, name, category_type, user_id, ip_address=None):
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
            VALUES (%s,%s,%s) RETURNING *
        """, (company_id, name, category_type))
        category = dict(cur.fetchone())

        log_audit(conn, company_id=company_id, user_id=user_id, action="CREATE",
                  table_name="expense_categories", record_id=category["id"],
                  new_data=category, ip_address=ip_address)
        log_event(conn, company_id=company_id, user_id=user_id,
                  action="created", category="data", entity_type="expense_categories",
                  entity_id=category["id"], payload={
                      "name":          name,
                      "category_type": category_type,
                  }, ip_address=ip_address)

        conn.commit()
        return category
    except psycopg2.errors.UniqueViolation:
        conn.rollback()
        raise ValueError(f"Category '{name}' already exists for this company")
    except Exception:
        conn.rollback(); raise
    finally:
        cur.close(); conn.close()


def deactivate_expense_category(company_id, category_id, user_id, ip_address=None):
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        # Fetch old data first so log_audit has the full snapshot
        cur.execute(
            "SELECT * FROM expense_categories WHERE id = %s AND company_id = %s",
            (category_id, company_id),
        )
        old = cur.fetchone()
        if not old:
            raise ValueError("Category not found or access denied")
        old_dict = dict(old)

        cur.execute("""
            UPDATE expense_categories SET is_active = FALSE
            WHERE id = %s AND company_id = %s
        """, (category_id, company_id))

        log_audit(conn, company_id=company_id, user_id=user_id, action="DELETE",
                  table_name="expense_categories", record_id=category_id,
                  old_data=old_dict, ip_address=ip_address)
        log_event(conn, company_id=company_id, user_id=user_id,
                  action="deactivated", category="data", level="warning",
                  entity_type="expense_categories", entity_id=category_id,
                  payload={
                      "name": old_dict["name"],
                      "type": old_dict["type"],
                  }, ip_address=ip_address)

        conn.commit()
    except Exception:
        conn.rollback(); raise
    finally:
        cur.close(); conn.close()


# ── Invoice Storage ──────────────────────────────────────────────────────────

def save_invoice_record(
    company_id, ref_table, ref_id, file_name, file_path,
    mime_type, file_size_kb, user_id, notes="",
    supplier_id=None, invoice_number=None, invoice_date=None,
    amount=None, branch_id=None, ip_address=None,
):
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            INSERT INTO purchase_invoices
                (company_id, ref_table, ref_id, file_name, file_path,
                 mime_type, file_size_kb, notes, uploaded_by,
                 supplier_id, invoice_number, invoice_date, amount, branch_id)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING id
        """, (
            company_id, ref_table, ref_id, file_name, file_path,
            mime_type, file_size_kb, notes, user_id,
            supplier_id, invoice_number, invoice_date, amount, branch_id,
        ))
        invoice_id = cur.fetchone()["id"]

        log_audit(conn, company_id=company_id, user_id=user_id, action="CREATE",
                  table_name="purchase_invoices", record_id=invoice_id,
                  new_data={
                      "ref_table":      ref_table,
                      "ref_id":         ref_id,
                      "file_name":      file_name,
                      "invoice_number": invoice_number,
                      "invoice_date":   invoice_date,
                      "amount":         amount,
                  }, ip_address=ip_address)
        log_event(conn, company_id=company_id, user_id=user_id, branch_id=branch_id,
                  action="uploaded", category="data", entity_type="purchase_invoices",
                  entity_id=invoice_id, payload={
                      "ref_table":      ref_table,
                      "ref_id":         ref_id,
                      "file_name":      file_name,
                      "invoice_number": invoice_number,
                      "invoice_date":   str(invoice_date) if invoice_date else None,
                      "amount":         amount,
                      "file_size_kb":   file_size_kb,
                  }, ip_address=ip_address)

        conn.commit()
        return invoice_id
    except Exception:
        conn.rollback(); raise
    finally:
        cur.close(); conn.close()


def get_invoice(company_id, invoice_id):
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT id, company_id, ref_table, ref_id, file_name,
                   file_path, mime_type, file_size_kb, notes,
                   uploaded_by, uploaded_at
            FROM purchase_invoices WHERE company_id = %s AND id = %s
        """, (company_id, invoice_id))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        cur.close(); conn.close()


def list_invoices(company_id, ref_table, ref_id):
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT pi.id, pi.file_name, pi.mime_type, pi.file_size_kb,
                   pi.notes, pi.uploaded_at, pi.uploaded_by,
                   pi.invoice_number, pi.invoice_date, pi.amount,
                   pi.branch_id, pi.supplier_id,
                   b.name AS branch_name, s.name AS supplier_name
            FROM purchase_invoices pi
            LEFT JOIN branches b ON b.id = pi.branch_id
            LEFT JOIN suppliers s ON s.id = pi.supplier_id
            WHERE pi.company_id = %s AND pi.ref_table = %s AND pi.ref_id = %s
            ORDER BY pi.uploaded_at ASC, pi.id ASC
        """, (company_id, ref_table, ref_id))
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()


def search_invoices(
    company_id, ref_table=None, branch_id=None, supplier_id=None,
    invoice_number=None, date_from=None, date_to=None, limit=50,
):
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        conditions = ["pi.company_id = %s"]
        params: list[Any] = [company_id]
        if ref_table:      conditions.append("pi.ref_table = %s");          params.append(ref_table)
        if branch_id:      conditions.append("pi.branch_id = %s");          params.append(branch_id)
        if supplier_id:    conditions.append("pi.supplier_id = %s");        params.append(supplier_id)
        if invoice_number: conditions.append("pi.invoice_number ILIKE %s"); params.append(f"%{invoice_number}%")
        if date_from:      conditions.append("pi.invoice_date >= %s");      params.append(date_from)
        if date_to:        conditions.append("pi.invoice_date <= %s");      params.append(date_to)

        cur.execute(f"""
            SELECT pi.id, pi.ref_table, pi.ref_id, pi.file_name, pi.mime_type,
                   pi.file_size_kb, pi.notes, pi.uploaded_at, pi.invoice_number,
                   pi.invoice_date, pi.amount,
                   b.name AS branch_name, s.name AS supplier_name
            FROM purchase_invoices pi
            LEFT JOIN branches b ON b.id = pi.branch_id
            LEFT JOIN suppliers s ON s.id = pi.supplier_id
            WHERE {' AND '.join(conditions)}
            ORDER BY pi.uploaded_at DESC LIMIT %s
        """, params + [limit])
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()