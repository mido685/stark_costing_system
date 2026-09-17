# Inventory Module

## Purpose

Maintain branch-level stock and an auditable movement ledger for goods receipts,
issues, counts, adjustments, transfers, and opening stock.

## Data ownership

Core tables include `goods_receipts`, `stock_issues`, `stock_counts`,
`stock_adjustments`, and `inventory_movements`. Inventory balances are derived
from movement data and related transaction records.

## API

The inventory router uses `/api` directly rather than a single `/inventory`
prefix.

| Area | Paths |
|---|---|
| Balances | `GET /stock/{branch_id}`, `GET /stock/finished-goods/{branch_id}` |
| Goods receipts | `POST /grn`, `GET /grn` |
| Stock counts | `GET/POST /stock-counts`, `GET /stock-counts/with-purchases` |
| Stock issues | `GET/POST /stock-issues` |
| Adjustments | `GET/POST /stock-adjustments`, `POST /stock-adjustments/{adj_id}/approve` |
| Opening stock | `GET /opening-stock` |
| Transfers | `GET/POST /transfers` |
| Ledger | `GET /inventory-movements` |

Most write actions require `owner`, `admin`, or `manager`, and the relevant
accounting period must be open. Read actions require authentication.

## Business rules

- Stock increases from a goods receipt note (GRN), not merely from purchase-order
  approval.
- A GRN may be partial; received quantity can differ from the purchase quantity.
- A stock adjustment requires an explicit signed `quantity_delta` and is pending
  until approved or rejected.
- A stock count records physical count versus system quantity and its variance.
- Transfers affect source and destination branch stock through inventory movement
  records.
- The movement ledger is read-only through the API.

## Dependencies

- [Purchases](purchases.md) supplies purchase orders that are received through
  GRNs.
- [Ingredients](ingredients.md) supplies the raw-material master data.

## Implementation

- Route module: `backend/app/routes/inventory.py`
- Database module: `backend/app/database/inventory.py`
