"""
app/api/routes/suppliers.py
Enterprise-grade supplier routes with approval-based price flow,
standard cost protection, and variance reporting.
"""

from fastapi import APIRouter, Request, Depends

from app.api.responses import success, error
from app.database import suppliers as suppliers_db
from app.schemas import (
    SupplierPriceRequest,
    SupplierPriceApprovalRequest,
    SupplierRequest,
    SupplierUpdateRequest,
    StandardCostUpdateRequest,
)
from app.security.dependencies import get_current_user, require_roles

router = APIRouter(prefix="/suppliers", tags=["suppliers"])


# ─────────────────────────────────────────────────────────────────────────────
# SUPPLIERS — CRUD
# ─────────────────────────────────────────────────────────────────────────────

@router.get("")
def list_suppliers(current_user: dict = Depends(get_current_user)):
    suppliers = suppliers_db.list_suppliers(current_user["company_id"])
    return success("Suppliers retrieved", suppliers=suppliers)

@router.get("/price/pending")
def get_pending_approvals(
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    """
    Returns all pending price records for this company.
    Used to populate the manager's approval queue.
    """
    prices = suppliers_db.get_pending_price_approvals(current_user["company_id"])
    return success("Pending price approvals retrieved", prices=prices)
    

@router.get("/{supplier_id}")
def get_supplier(
    supplier_id: int,
    current_user: dict = Depends(get_current_user),
):
    supplier = suppliers_db.get_supplier(supplier_id, current_user["company_id"])
    if not supplier:
        return error("Supplier not found", status=404)
    return success("Supplier retrieved", supplier=supplier)


@router.post("")
def create_supplier(
    req: SupplierRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    try:
        supplier = suppliers_db.add_supplier(
            name=req.name,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            contact=req.contact,
            phone=req.phone,
            email=req.email,
            address=req.address,
            website=req.website,
            commercial_reg_number=req.commercial_reg_number,
            agent_name=req.agent_name,
            agent_phone=req.agent_phone,
            category=req.category,
            notes=req.notes,
            ip_address=request.client.host,
        )
        return success("Supplier created", supplier=supplier)
    except ValueError as e:
        return error(str(e))


@router.put("/{supplier_id}")
def update_supplier(
    supplier_id: int,
    req: SupplierUpdateRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    try:
        supplier = suppliers_db.update_supplier(
            supplier_id=supplier_id,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            name=req.name,
            contact=req.contact,
            phone=req.phone,
            email=req.email,
            address=req.address,
            website=req.website,
            commercial_reg_number=req.commercial_reg_number,
            agent_name=req.agent_name,
            agent_phone=req.agent_phone,
            category=req.category,
            notes=req.notes,
            ip_address=request.client.host,
        )
        return success("Supplier updated", supplier=supplier)
    except ValueError as e:
        return error(str(e))


@router.delete("/{supplier_id}")
def delete_supplier(
    supplier_id: int,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    try:
        suppliers_db.deactivate_supplier(
            supplier_id=supplier_id,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            ip_address=request.client.host,
        )
        return success("Supplier deleted")
    except ValueError as e:
        return error(str(e))


# ─────────────────────────────────────────────────────────────────────────────
# SUPPLIER PRICE HISTORY
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/price")
def add_supplier_price(
    req: SupplierPriceRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager", "clerk")),
):
    """
    Record a supplier price quote.

    price_type controls the approval flow:
      - initial_cost   → auto-approved; sets cost_per_unit immediately (item creation only)
      - market_price   → status = pending; cost unchanged until manager approves
      - contract_price → status = pending; cost unchanged until manager approves
      - spot_price     → status = pending; cost unchanged until manager approves

    Clerks can record prices. Only managers/admins can approve them.
    """
    try:
        price = suppliers_db.add_supplier_price(
            supplier_id=req.supplier_id,
            ingredient_id=req.ingredient_id,
            price=req.price,
            purchase_date=req.purchase_date,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            notes=req.notes,
            price_type=req.price_type,
            ip_address=request.client.host,
        )
        return success(
            "Supplier price recorded — pending manager approval" if price["status"] == "pending"
            else "Supplier price recorded and applied",
            price=price,
        )
    except ValueError as e:
        return error(str(e))


@router.post("/price/{price_id}/approve")
def approve_supplier_price(
    price_id: int,
    req: SupplierPriceApprovalRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    """
    Approve or reject a pending supplier price record.

    On approval → ingredient cost_per_unit is updated and written to
    standard_cost_history. On rejection → record is preserved for audit,
    standard cost is untouched.
    """
    try:
        updated = suppliers_db.approve_supplier_price(
            price_id=price_id,
            company_id=current_user["company_id"],
            approver_id=current_user["id"],
            action=req.action,
            ip_address=request.client.host,
        )
        msg = "Price approved and standard cost updated" if req.action == "approved" \
              else "Price rejected"
        return success(msg, price=updated)
    except ValueError as e:
        return error(str(e))




@router.get("/price-history/{ingredient_id}")
def supplier_price_history(
    ingredient_id: int,
    current_user: dict = Depends(get_current_user),
):
    """
    Full price history for an ingredient, most recent first.
    Includes status (pending/approved/rejected) on every row.
    """
    prices = suppliers_db.get_supplier_price_history(
        ingredient_id=ingredient_id,
        company_id=current_user["company_id"],
    )
    return success("Supplier price history retrieved", prices=prices)


@router.get("/price-variance/{ingredient_id}")
def price_variance_report(
    ingredient_id: int,
    current_user: dict = Depends(get_current_user),
):
    """
    Standard cost vs. latest approved market price with variance %.
    Only approved prices count — pending records never affect costing numbers.
    """
    try:
        report = suppliers_db.get_price_variance_report(
            ingredient_id=ingredient_id,
            company_id=current_user["company_id"],
        )
        return success("Price variance report retrieved", report=report)
    except ValueError as e:
        return error(str(e), status=404)


# ─────────────────────────────────────────────────────────────────────────────
# STANDARD COST — FORMAL REVISION
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/standard-cost/{ingredient_id}")
def update_standard_cost(
    ingredient_id: int,
    req: StandardCostUpdateRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin")),
):
    """
    Formally revise an ingredient's standard cost after management review.

    Restricted to owner and admin. Writes to standard_cost_history and audit_log.
    Use after quarterly cost reviews or approved contract renegotiations —
    never directly in response to a market price quote.
    """
    try:
        updated = suppliers_db.update_standard_cost(
            ingredient_id=ingredient_id,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            new_cost=req.new_cost,
            effective_date=req.effective_date,
            notes=req.notes,
            ip_address=request.client.host,
        )
        return success("Standard cost updated", ingredient=updated)
    except ValueError as e:
        return error(str(e))