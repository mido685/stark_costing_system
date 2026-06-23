from fastapi import APIRouter, Request, Depends
from app.api.responses import success, error
from app.schemas import RecipeRequest, RecipeIngredientRequest
from app.database import recipes as recipes_db
from app.security.dependencies import get_current_user, require_roles

router = APIRouter(prefix="/recipes", tags=["recipes"])

@router.get("/{product_id}/cost")
def get_recipe_cost(
    product_id: int,
    current_user: dict = Depends(get_current_user),
):
    cost = recipes_db.calculate_recipe_cost(product_id, current_user["company_id"])
    if not cost:
        return error("Recipe not found", status=404)
    return success("Recipe cost calculated", cost=cost)


@router.get("/{product_id}")
def get_recipe(
    product_id: int,
    current_user: dict = Depends(get_current_user),
):
    recipe = recipes_db.get_recipe(product_id, current_user["company_id"])
    if not recipe:
        return error("Recipe not found", status=404)

    # Calculate and attach cost in the same response
    cost = recipes_db.calculate_recipe_cost(product_id, current_user["company_id"])

    return success("Recipe retrieved", recipe=recipe, cost=cost)




@router.post("/{product_id}")
def save_recipe(
    product_id: int,
    req: RecipeRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner","admin", "manager")),
):
    try:
        recipe = recipes_db.save_recipe(
            product_id=product_id,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            yield_pct=req.yield_pct,
            portion_size=req.portion_size,
            portion_unit=req.portion_unit,
            notes=req.notes,
            ip_address=request.client.host,
        )
        return success("Recipe saved", recipe=recipe)
    except ValueError as e:
        return error(str(e))


@router.delete("/{product_id}")
def delete_recipe(
    product_id: int,
    request: Request,
    current_user: dict = Depends(require_roles("owner","admin", "manager")),
):
    try:
        recipes_db.delete_recipe(
            product_id=product_id,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            ip_address=request.client.host,
        )
        return success("Recipe deleted")
    except ValueError as e:
        return error(str(e))


@router.post("/{product_id}/ingredients")
def add_recipe_ingredient(
    product_id: int,
    req: RecipeIngredientRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner","admin", "manager")),
):
    try:
        # resolve recipe_id from product_id
        recipe = recipes_db.get_recipe(product_id, current_user["company_id"])
        if not recipe:
            return error("Recipe not found", status=404)

        row = recipes_db.save_recipe_ingredient(
            recipe_id=recipe["id"],
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            ingredient_id=req.ingredient_id,
            qty_required=req.qty_required,
            ip_address=request.client.host,
        )
        return success("Ingredient added to recipe", ingredient=row)
    except ValueError as e:
        return error(str(e))


@router.delete("/{product_id}/ingredients/{ingredient_id}")
def remove_recipe_ingredient(
    product_id: int,
    ingredient_id: int,
    request: Request,
    current_user: dict = Depends(require_roles("owner","admin", "manager")),
):
    try:
        recipe = recipes_db.get_recipe(product_id, current_user["company_id"])
        if not recipe:
            return error("Recipe not found", status=404)

        recipes_db.remove_recipe_ingredient(
            recipe_id=recipe["id"],
            ingredient_id=ingredient_id,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            ip_address=request.client.host,
        )
        return success("Ingredient removed from recipe")
    except ValueError as e:
        return error(str(e))
