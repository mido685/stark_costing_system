"""
app/api/routes/suppliers.py
Enterprise-grade supplier routes with price_type, effective_date,
standard cost update endpoint, and variance report endpoint.
"""

from fastapi import APIRouter, Request, Depends

from app.api.responses import success, error
from app.database import suppliers as suppliers_db
from app.schemas import (
    SupplierPriceRequest,
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
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    """
    Record a supplier price quote.

    price_type controls what happens to the ingredient's standard cost:
      - initial_cost   → sets cost_per_unit (first-time setup, item creation)
      - market_price   → recorded only; standard cost unchanged (default)
      - contract_price → recorded only; standard cost unchanged
      - spot_price     → recorded only; standard cost unchanged

    Pass effective_date when the supplier's price takes effect on a date
    different from today (e.g. next month's contract price).
    """
    try:
        price = suppliers_db.add_supplier_price(
            supplier_id=req.supplier_id,
            ingredient_id=req.ingredient_id,
            price=req.price,
            entry_date=req.entry_date,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            notes=req.notes,
            price_type=req.price_type,
            effective_date=req.effective_date,
            ip_address=request.client.host,
        )
        return success("Supplier price recorded", price=price)
    except ValueError as e:
        return error(str(e))


@router.get("/price-history/{ingredient_id}")
def supplier_price_history(
    ingredient_id: int,
    current_user: dict = Depends(get_current_user),
):
    """
    Full price quote history for an ingredient, most recent effective date first.
    Includes price_type and effective_date on every row.
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
    Returns standard cost vs. latest market price quote with variance and variance %.
    This is the number a costing manager acts on — not the raw history table.
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

    This is the ONLY approved path for changing cost_per_unit outside of
    initial item creation. Restricted to owner and admin roles.

    Writes an immutable record to standard_cost_history and logs to audit_log.
    Use after quarterly cost reviews, contract renegotiations, or any
    approved cost revision.
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