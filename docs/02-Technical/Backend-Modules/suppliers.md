# Suppliers Module

## Purpose

Manage suppliers and preserve a controlled, auditable history of supplier price
quotes and formal standard-cost changes.

## Data ownership

Primary tables: `suppliers`, `supplier_price_history`, and
`standard_cost_history`.

Supplier records contain contact and registration information. Price-history
records link a supplier to an ingredient and preserve status, price type,
approval metadata, and notes.

## API

Base path: `/api/suppliers`

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | List suppliers. |
| GET | `/{supplier_id}` | Retrieve a supplier. |
| POST | `/` | Create a supplier. |
| PUT | `/{supplier_id}` | Update a supplier. |
| DELETE | `/{supplier_id}` | Deactivate a supplier. |
| GET | `/price/pending` | List pending price approvals. |
| POST | `/price` | Record a supplier price quote. |
| POST | `/price/{price_id}/approve` | Approve or reject a pending quote. |
| GET | `/price-history/{ingredient_id}` | List an ingredient’s supplier-price history. |
| GET | `/price-variance/{ingredient_id}` | Compare standard cost with approved market price. |
| POST | `/standard-cost/{ingredient_id}` | Formally revise an ingredient’s standard cost. |

Supplier CRUD requires `owner`, `admin`, or `manager`. A `clerk` may record a
price quote, but approval requires `owner`, `admin`, or `manager`. Formal
standard-cost revision is limited to `owner` and `admin`.

## Business rules

- `initial_cost` is applied immediately for initial item setup.
- `market_price`, `contract_price`, and `spot_price` remain pending until an
  authorized user approves them.
- Approval updates the ingredient standard cost and records the change in
  `standard_cost_history`; rejection preserves the quote without changing cost.
- Formal standard-cost changes are auditable and must not be used as a shortcut
  for an unapproved market quote.

## Implementation

- Route module: `backend/app/routes/suppliers.py`
- Database module: `backend/app/database/suppliers.py`
