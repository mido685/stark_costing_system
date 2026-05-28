from fastapi import APIRouter, Request, Depends
from app.api.responses import success, error
from app.schemas import IngredientRequest, IngredientUpdateRequest
from app.database import ingredients as ingredients_db
from app.security.dependencies import get_current_user, require_roles

router = APIRouter(prefix="/ingredients", tags=["ingredients"])


@router.get("")
def list_ingredients(current_user: dict = Depends(get_current_user)):
    ingredients = ingredients_db.list_ingredients(current_user["company_id"])
    return success("Ingredients retrieved", ingredients=ingredients)


@router.get("/low-stock")
def low_stock_alerts(current_user: dict = Depends(get_current_user)):
    alerts = ingredients_db.get_low_stock_alerts(current_user["company_id"])
    return success("Low stock alerts retrieved", alerts=alerts)


@router.get("/{ingredient_id}")
def get_ingredient(
    ingredient_id: int,
    current_user: dict = Depends(get_current_user),
):
    ingredient = ingredients_db.get_ingredient(ingredient_id, current_user["company_id"])
    if not ingredient:
        return error("Ingredient not found", status=404)
    return success("Ingredient retrieved", ingredient=ingredient)


@router.post("")
def create_ingredient(
    req: IngredientRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    try:
        ingredient = ingredients_db.add_ingredient(
            name=req.name,
            unit=req.unit,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            cost_per_unit=req.cost_per_unit,
            stock_qty=req.stock_qty,
            reorder_level=req.reorder_level,
            supplier_id=req.supplier_id,
            ip_address=request.client.host,
        )
        return success("Ingredient created", ingredient=ingredient)
    except ValueError as e:
        return error(str(e))


@router.put("/{ingredient_id}")
def update_ingredient(
    ingredient_id: int,
    req: IngredientUpdateRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    try:
        ingredient = ingredients_db.update_ingredient(
            ingredient_id=ingredient_id,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            name=req.name,
            unit=req.unit,
            cost_per_unit=req.cost_per_unit,
            reorder_level=req.reorder_level,
            supplier_id=req.supplier_id,
            ip_address=request.client.host,
        )
        return success("Ingredient updated", ingredient=ingredient)
    except ValueError as e:
        return error(str(e))


@router.delete("/{ingredient_id}")
def delete_ingredient(
    ingredient_id: int,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    try:
        ingredients_db.deactivate_ingredient(
            ingredient_id=ingredient_id,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            ip_address=request.client.host,
        )
        return success("Ingredient deleted")
    except ValueError as e:
        return error(str(e))
