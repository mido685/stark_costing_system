"""
app/api/routes/suppliers.py  — full replacement
Adds: email, address, website, commercial_reg_number, agent_name, agent_phone
"""

from fastapi import APIRouter, Request, Depends

from app.api.responses import success, error
from app.database import suppliers as suppliers_db
from app.schemas import SupplierPriceRequest, SupplierRequest, SupplierUpdateRequest
from app.security.dependencies import get_current_user, require_roles

router = APIRouter(prefix="/suppliers", tags=["suppliers"])


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


@router.post("/price")
def add_supplier_price(
    req: SupplierPriceRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    try:
        price = suppliers_db.add_supplier_price(
            supplier_id=req.supplier_id,
            ingredient_id=req.ingredient_id,
            price=req.price,
            entry_date=req.entry_date,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            notes=req.notes,
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
    prices = suppliers_db.get_supplier_price_history(
        ingredient_id=ingredient_id,
        company_id=current_user["company_id"],
    )
    return success("Supplier price history retrieved", prices=prices)