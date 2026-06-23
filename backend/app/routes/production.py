from fastapi import APIRouter, Depends, Query, Request

from app.api.responses import error, success
from app.database import production_costs as production_db
from app.schemas import ProductionRequest
from app.security.dependencies import check_period_open, get_current_user, require_roles


router = APIRouter(prefix="/production", tags=["production"])


@router.get("")
def list_production(
    branch_id: int | None = Query(None),
    current_user: dict = Depends(get_current_user),
):
    rows = production_db.list_production_costs(current_user["company_id"], branch_id)
    return success("Production retrieved", production=rows)


@router.get("/{production_id}")
def get_production(
    production_id: int,
    current_user: dict = Depends(get_current_user),
):
    row = production_db.get_production_cost(production_id, current_user["company_id"])
    if not row:
        return error("Production batch not found", status=404)
    return success("Production retrieved", production=row)


@router.post("")
def create_production(
    req: ProductionRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    try:
        check_period_open(req.entry_date, current_user)
        row = production_db.add_production_cost(
            branch_id=req.branch_id,
            product_id=req.product_id,
            entry_date=req.entry_date,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            quantity=req.quantity,
            material_cost=req.material_cost,
            labor_cost=req.labor_cost,
            overhead_cost=req.overhead_cost,
            notes=req.notes,
            ip_address=request.client.host,
        )
        return success("Production recorded", production=row)
    except ValueError as e:
        return error(str(e))


@router.delete("/{production_id}")
def delete_production(
    production_id: int,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    try:
        production_db.delete_production_cost(
            production_id=production_id,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            ip_address=request.client.host,
        )
        return success("Production deleted")
    except ValueError as e:
        return error(str(e), status=404)
