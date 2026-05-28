from fastapi import APIRouter, Request, Depends, Query
from app.api.responses import success, error
from app.schemas import SaleRequest
from app.database import sales as sales_db
from app.security.dependencies import get_current_user, require_roles, check_period_open

router = APIRouter(prefix="/sales", tags=["sales"])


@router.get("")
def list_sales(
    branch_id: int | None = Query(None),
    period: str | None = Query(None),
    current_user: dict = Depends(get_current_user),
):
    items = sales_db.list_sales(
        company_id=current_user["company_id"],
        branch_id=branch_id,
        period=period,
    )
    return success("Sales retrieved", sales=items)


@router.get("/{sale_id}")
def get_sale(
    sale_id: int,
    current_user: dict = Depends(get_current_user),
):
    sale = sales_db.get_sale(sale_id, current_user["company_id"])
    if not sale:
        return error("Sale not found", status=404)
    return success("Sale retrieved", sale=sale)


@router.post("")
def create_sale(
    req: SaleRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    check_period_open(req.entry_date, current_user)
    product_id = req.product_id or req.item_id
    if not product_id:
        return error("product_id or item_id is required")
    try:
        sale = sales_db.add_sale(
            branch_id=req.branch_id,
            product_id=product_id,
            entry_date=req.entry_date,
            quantity=req.quantity,
            unit_price=req.unit_price,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            discount_amount=req.discount_amount,
            promotion_amount=req.promotion_amount,
            tax_amount=req.tax_amount,
            payment_method=req.payment_method,
            receivable_amount=req.receivable if req.receivable is not None else req.receivable_amount,
            notes=req.notes,
            status=req.status,
            ip_address=request.client.host,
        )
        return success("Sale recorded", sale=sale)
    except ValueError as e:
        return error(str(e))


@router.post("/returns")
def create_sale_return(
    req: SaleRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    check_period_open(req.entry_date, current_user)
    product_id = req.product_id or req.item_id
    if not product_id:
        return error("product_id or item_id is required")
    try:
        refund = req.receivable if req.receivable is not None else req.receivable_amount
        sale_return = sales_db.add_sale(
            branch_id=req.branch_id,
            product_id=product_id,
            entry_date=req.entry_date,
            quantity=-abs(req.quantity),  # always negative for returns
            unit_price=req.unit_price or refund or 0,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            discount_amount=0,
            promotion_amount=0,
            tax_amount=0,
            payment_method=req.payment_method,
            receivable_amount=refund or 0,
            notes=req.notes,
            status=req.status,
            ip_address=request.client.host,
            is_return=True,  # skip stock validation, add back to inventory
        )
        return success("Sale return recorded", sale_return=sale_return)
    except ValueError as e:
        return error(str(e))


@router.delete("/{sale_id}")
def delete_sale(
    sale_id: int,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    try:
        sales_db.delete_sale(
            sale_id=sale_id,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            ip_address=request.client.host,
        )
        return success("Sale deleted")
    except ValueError as e:
        return error(str(e))