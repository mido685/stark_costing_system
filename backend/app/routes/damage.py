from fastapi import APIRouter, Request, Depends, Query

from app.api.responses import success, error
from app.database import damage as damage_db
from app.schemas import DamageRequest
from app.security.dependencies import get_current_user, require_roles, check_period_open

router = APIRouter(prefix="/damage", tags=["damage"])


@router.get("")
def list_damage(
    branch_id: int | None = Query(None),
    limit: int = Query(50),
    current_user: dict = Depends(get_current_user),
):
    damage = damage_db.list_damage(
        company_id=current_user["company_id"],
        branch_id=branch_id,
        limit=limit,
    )
    return success("Damage retrieved", damage=damage)


@router.get("/{damage_id}")
def get_damage(
    damage_id: int,
    current_user: dict = Depends(get_current_user),
):
    damage = damage_db.get_damage(damage_id, current_user["company_id"])
    if not damage:
        return error("Damage record not found", status=404)
    return success("Damage retrieved", damage=damage)


@router.post("", status_code=201)
def create_damage(
    req: DamageRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    check_period_open(req.entry_date, current_user)
    try:
        ingredient_id = req.ingredient_id
        product_id = req.product_id
        if req.item_id and not ingredient_id and not product_id:
            product_id = req.item_id
        damage = damage_db.add_damage(
            branch_id=req.branch_id,
            entry_date=req.entry_date,
            quantity=req.quantity,
            reason=req.reason,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            ingredient_id=ingredient_id,
            product_id=product_id,
            notes=req.notes,
            ip_address=request.client.host,
        )
        return success("Damage recorded", damage=damage)
    except ValueError as e:
        return error(str(e))


@router.delete("/{damage_id}")
def delete_damage(
    damage_id: int,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    try:
        damage_db.delete_damage(
            damage_id=damage_id,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            ip_address=request.client.host,
        )
        return success("Damage deleted")
    except ValueError as e:
        return error(str(e), status=404)