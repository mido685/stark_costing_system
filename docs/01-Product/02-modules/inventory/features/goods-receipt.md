# Feature: Goods Receipt

**Module:** Inventory
**Related Requirements:** INV-02, INV-07
**Primary Persona:** Storekeeper

---

## Purpose

Record that ordered stock has physically arrived at a branch, and update
stock balances accordingly — while keeping a link back to the purchase
order it was ordered against.

## User Story

As a Storekeeper, when a delivery arrives, I want to record what was
actually received against the original purchase order, so that the system
reflects true stock on hand and flags any discrepancy between what was
ordered and what showed up.

## Preconditions

- A purchase order exists in "sent" or "partially received" status
- The receiving user has permission to perform receipts for the branch

## Main Flow

1. Storekeeper opens the relevant purchase order
2. Storekeeper enters received quantity per line item (defaults to ordered
   quantity, editable)
3. System calculates variance per line (received vs. ordered)
4. Storekeeper confirms the receipt
5. System writes an inventory movement (type: receipt) for each line,
   increasing stock balance for that item/branch
6. System updates the purchase order status (received / partially received)
7. System writes an audit log entry

## Business Rules

- A receipt cannot exceed the outstanding ordered quantity without an
  explicit over-receipt flag (configurable — off by default)
- Receipt quantity cannot be negative
- A purchase order can be received across multiple partial receipts
- Receiving against a purchase order in a **locked period** is not
  permitted (see Period Management)

## Edge Cases

| Case | Expected behavior |
|---|---|
| Received quantity ≠ ordered quantity | System records variance, does not block the receipt |
| Receipt against an already-fully-received PO | Blocked, with a clear error |
| Receipt during a locked period | Blocked, with a message pointing to the period status |
| Partial receipt | PO remains open for the remaining quantity |

## Out of Scope (this feature)

- Quality inspection / rejection workflow (not currently modeled)
- Automatic supplier notification of variance

## Open Questions

- Should over-receipt require Governance approval, or just a warning?
