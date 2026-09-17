# Recipes Module

## Purpose

Define the bill of materials for a finished-good product and calculate the
current recipe cost from its ingredient lines and standard ingredient costs.

## Data ownership

Primary tables: `recipes` and `recipe_ingredients`.

- A recipe belongs to exactly one product.
- A product can have at most one recipe.
- Each recipe line links one ingredient with its required quantity.

## API

Base path: `/api/recipes`

| Method | Path | Purpose |
|---|---|---|
| GET | `/{product_id}` | Retrieve a product recipe and its calculated cost. |
| GET | `/{product_id}/cost` | Retrieve only calculated cost information. |
| POST | `/{product_id}` | Create or update the recipe header. |
| DELETE | `/{product_id}` | Delete the recipe. |
| POST | `/{product_id}/ingredients` | Add or update an ingredient line. |
| DELETE | `/{product_id}/ingredients/{ingredient_id}` | Remove an ingredient line. |

All reads require authentication. Changes require `owner`, `admin`, or
`manager`.

## Business rules

- Recipe cost is calculated using the current ingredient `cost_per_unit`.
- A missing recipe returns a not-found response rather than a zero cost.
- Recipe lines are unique by recipe and ingredient.
- Recipe definition is separate from production execution and stock movement.

## Dependencies

- [Products](products.md) owns the finished good.
- [Ingredients](ingredients.md) supplies the material and standard cost.
- Inventory and production processes consume recipe data but own their own
  movement records.

## Implementation

- Route module: `backend/app/routes/recipes.py`
- Database module: `backend/app/database/recipes.py`
