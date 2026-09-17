# Products Module

## Purpose

Manage company-scoped finished goods: their name, unit, SKU, selling price,
image, active state, and local display number.

## Data ownership

Primary table: `products`.

- A product belongs to one company.
- A product can have one recipe through `recipes.product_id`.
- Deletion is a deactivation, not a hard delete.
- Active product names are unique per company, case-insensitively.

## API

Base path: `/api/products`

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | List the current company’s products. |
| GET | `/{product_id}` | Retrieve one product. |
| POST | `/` | Create a product. |
| PUT | `/{product_id}` | Update a product. |
| DELETE | `/{product_id}` | Deactivate a product. |
| GET | `/items` | List finished goods and raw materials in one view. |
| POST | `/items` | Create a finished good or raw material based on `category`. |
| POST | `/{item_id}/image?category=...` | Upload a JPG, PNG, or WEBP item image. |

All reads require an authenticated user. Create and update require `owner`,
`admin`, or `manager`; deletion requires `owner` or `admin`.

## Business rules

- Product records are always company-scoped.
- `/items` is a convenience view; raw materials are stored in `ingredients`,
  not in `products`.
- Item images are limited to JPG, PNG, or WEBP and a maximum size of 5 MB.
- Recipe costing is documented in [Recipes](recipes.md).

## Implementation

- Route module: `backend/app/routes/products.py`
- Database module: `backend/app/database/products.py`
- Request schemas: `ProductRequest`, `ProductUpdateRequest`, and `ItemRequest`
