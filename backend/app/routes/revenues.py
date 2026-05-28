from fastapi import APIRouter, Request, Depends, Query
from app.api.responses import success, error
from app.schemas import RevenueRequest
from app.database import revenues as revenues_db
from app.database.periods import get_period_status
from app.security.dependencies import get_current_user, require_roles, check_period_open

router = APIRouter(prefix="/revenues", tags=["revenues"])


@router.get("")
def list_revenues(
    branch_id: int | None = Query(None),
    current_user: dict = Depends(get_current_user),
):
    revenues = revenues_db.list_revenues(
        company_id=current_user["company_id"],
        branch_id=branch_id,
    )
    return success("Revenues retrieved", revenues=revenues)


@router.get("/{revenue_id}")
def get_revenue(
    revenue_id: int,
    current_user: dict = Depends(get_current_user),
):
    revenue = revenues_db.get_revenue(revenue_id, current_user["company_id"])
    if not revenue:
        return error("Revenue not found", status=404)
    return success("Revenue retrieved", revenue=revenue)


@router.post("")
def create_revenue(
    req: RevenueRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner","admin", "manager")),
):
    check_period_open(req.entry_date, current_user)
    try:
        revenue = revenues_db.add_revenue(
            branch_id=req.branch_id,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            entry_date=req.entry_date,
            amount=req.amount,
            product_id=req.product_id,
            quantity=req.quantity,
            notes=req.notes,
            ip_address=request.client.host,
        )
        return success("Revenue created", revenue=revenue)
    except ValueError as e:
        return error(str(e))


@router.delete("/{revenue_id}")
def delete_revenue(
    revenue_id: int,
    request: Request,
    current_user: dict = Depends(require_roles("owner","admin", "manager")),
):
    try:
        revenues_db.delete_revenue(
            revenue_id=revenue_id,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            ip_address=request.client.host,
        )
        return success("Revenue deleted")
    except ValueError as e:
        return error(str(e))
