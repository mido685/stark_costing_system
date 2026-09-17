# Purchases Module

## Purpose

Manage purchase orders, their approval lifecycle, fulfilment, edit history,
returns, and PDF export. Purchase-order approval is deliberately separate from
physical inventory receipt.

## Data ownership

Primary tables: `purchases`, `company_po_sequences`, `purchase_history`, and
`purchase_returns`. Goods receipts are owned by the inventory workflow.

## API

Base path: `/api/purchases`

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | List purchase orders, optionally by branch. |
| GET | `/by-branch` | List purchase orders for branch-oriented views. |
| GET | `/fulfillment` | Show PO fulfilment from goods receipts. |
| GET | `/{purchase_id}` | Retrieve one purchase order. |
| POST | `/` | Create a pending purchase order. |
| POST | `/{purchase_id}/approve` | Approve a purchase order. |
| POST | `/{purchase_id}/reject` | Reject a purchase order. |
| PUT | `/{purchase_id}` | Edit an eligible purchase order. |
| GET | `/{purchase_id}/history` | View recorded modifications. |
| DELETE | `/{purchase_id}` | Delete a purchase and related records where allowed. |
| POST | `/returns` | Record a purchase return. |
| GET | `/{purchase_id}/pdf` | Export a purchase order PDF. |

All reads require authentication. Writes require `owner`, `admin`, or
`manager`; write dates must be in an open company period.

## Business rules

- New purchase orders start as `pending` and produce an approval request.
- Approving a purchase order does not add stock.
- Stock changes only when [Inventory](inventory.md) records a GRN.
- Only eligible pending records may be edited; edits are logged in
  `purchase_history` with the reason supplied by the caller.
- Purchase returns are separate records and use the period-control check.

## Dependencies

- [Suppliers](suppliers.md) supplies supplier master records.
- [Ingredients](ingredients.md) supplies the purchased material.
- [Inventory](inventory.md) records physical receipt and PO fulfilment.

## Implementation

- Route module: `backend/app/routes/purchases.py`
- Database module: `backend/app/database/purchases.py`
