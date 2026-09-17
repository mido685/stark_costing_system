# Inventory — Module Overview

## Purpose

Inventory is the single source of truth for what stock exists, where it is,
and how it got there. Every other module (Purchasing, Production, Sales,
Reports) reads stock data from here rather than maintaining its own copy —
that's what keeps balances from drifting out of sync across the system.

## Key Entities

| Entity | Description |
|---|---|
| Item / Ingredient | A stockable unit (raw ingredient, packaging, semi-finished good) |
| Stock Balance | Current on-hand quantity of an item, per branch |
| Inventory Movement | An immutable record of a quantity change (receipt, issue, transfer, adjustment) — the ledger that stock balances are derived from |
| Stock Count | A physical count session used to reconcile system balances against reality |

## Personas

| Persona | Role in this module |
|---|---|
| Storekeeper | Primary daily user — performs receipts, transfers, adjustments, counts |
| Branch Manager | Reviews balances, approves adjustments/transfers where required, monitors low-stock alerts |
| System Administrator | Reviews audit trail of inventory activity |

## Dependencies

Inventory has no upstream dependencies — it's the foundation. Downstream,
it's read by:
- **Purchasing** — goods receipts write into inventory
- **Production** — consumes raw stock, produces finished stock
- **Sales** — indirectly, through margin calculations that reference cost
- **Reports** — stock valuation, variance, and trend reporting

## Cross-Cutting Rule

Every inventory movement, regardless of feature, writes an audit trail entry
capturing actor, timestamp, and before/after quantity. This is not a
separate feature — it's a property of every feature in this module (see
`AUD-01`/`INV-07` in the Requirements doc).

## Features in This Module

- [Goods Receipt](features/goods-receipt.md)
- [Stock Transfer](features/stock-transfer.md)
- [Stock Adjustment](features/stock-adjustment.md)
- [Stock Count](features/stock-count.md)
