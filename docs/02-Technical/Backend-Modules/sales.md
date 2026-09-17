# Sales Module

## Purpose

Record branch sales and sales returns for products, including price, quantity,
discount, promotion, tax, payment method, and receivable data.

## Data ownership

Primary table: `sales`.

Sales reference a product, branch, company, and creating user. Returns are
stored through the same sales workflow with a negative quantity.

## API

Base path: `/api/sales`

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | List sales, optionally filtered by branch and period. |
| GET | `/{sale_id}` | Retrieve one sale. |
| POST | `/` | Record a sale. |
| POST | `/returns` | Record a sales return. |
| DELETE | `/{sale_id}` | Delete a sale where allowed. |

All reads require authentication. Create, return, and delete operations require
`owner`, `admin`, or `manager`; writes require an open company period.

## Business rules

- A sale must identify a product through `product_id` or `item_id`.
- A sales return always posts a negative quantity and returns inventory through
  the sales database workflow.
- Product sale price and recipe cost are related reporting inputs, but the sale
  records the transaction price supplied at the time of sale.
- All records are company-scoped and branch-scoped.

## Dependencies

- [Products](products.md) provides finished-good records.
- [Recipes](recipes.md) provides cost data used by margin and reporting logic.
- Period status controls whether a sale date can be written.

## Implementation

- Route module: `backend/app/routes/sales.py`
- Database module: `backend/app/database/sales.py`
