# Ingredients Module

## Purpose

Manage company-scoped raw materials used in recipes, purchasing, and inventory.
An ingredient holds the standard unit cost and reorder threshold used by those
domains.

## Data ownership

Primary table: `ingredients`.

Related data includes `suppliers`, `supplier_price_history`,
`standard_cost_history`, recipe lines, purchase records, and inventory
movements.

- An ingredient can reference a preferred supplier.
- Active ingredient names are unique per company, case-insensitively.
- Deletion is a deactivation, not a hard delete.

## API

Base path: `/api/ingredients`

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | List ingredients for the current company. |
| GET | `/low-stock` | Return ingredients at or below their reorder level. |
| GET | `/{ingredient_id}` | Retrieve one ingredient. |
| POST | `/` | Create an ingredient. |
| PUT | `/{ingredient_id}` | Update an ingredient. |
| DELETE | `/{ingredient_id}` | Deactivate an ingredient. |

All reads require authentication. Create, update, and deactivation require
`owner`, `admin`, or `manager`.

## Business rules

- `cost_per_unit` is the current standard cost used by recipe costing.
- Supplier market, contract, and spot prices do not change standard cost until
  the required approval completes; see [Suppliers](suppliers.md).
- Stock quantity changes must go through inventory transactions, not a normal
  ingredient update; see [Inventory](inventory.md).

## Implementation

- Route module: `backend/app/routes/ingredients.py`
- Database module: `backend/app/database/ingredients.py`
