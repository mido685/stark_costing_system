# Backend Module Documentation

This folder documents the implemented backend domains. It complements the
business-level material in `docs/01-Product/`; it does not replace it.

| Module | Primary responsibility | Main API area |
|---|---|---|
| [Products](products.md) | Finished goods and their selling data | `/api/products` |
| [Ingredients](ingredients.md) | Raw materials, stock thresholds, and standard cost | `/api/ingredients` |
| [Suppliers](suppliers.md) | Supplier records and controlled supplier-price updates | `/api/suppliers` |
| [Recipes](recipes.md) | Product bills of materials and calculated recipe cost | `/api/recipes` |
| [Inventory](inventory.md) | Branch stock, receipts, issues, counts, adjustments, and transfers | `/api/stock`, `/api/grn`, and related paths |
| [Purchases](purchases.md) | Purchase orders, approval, history, returns, and fulfilment | `/api/purchases` |
| [Sales](sales.md) | Sales and sales returns | `/api/sales` |

## Documentation rules

- Keep a module document aligned with its route and database code.
- Document business rules and API contracts, not every line of implementation.
- Record schema changes in Alembic migrations; see
  `backend/alembic/README.md` for the migration workflow.
- Add separate documents when a cross-cutting area becomes large enough, such
  as authentication, period control, governance, reporting, or administration.
