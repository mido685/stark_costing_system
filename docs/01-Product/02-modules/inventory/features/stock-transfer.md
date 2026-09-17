# Feature: Stock Transfer

**Module:** Inventory
**Related Requirements:** INV-03, INV-07
**Primary Persona:** Storekeeper, Branch Manager

---

## Purpose

Move stock from one branch to another within the same company, keeping both
branches' balances accurate without treating the movement as a purchase or
a loss.

## User Story

As a Storekeeper, I want to send stock from my branch to another branch (or
receive stock sent to mine), so that inventory can be shared across
locations without going through a supplier.

## Preconditions

- Both branches belong to the same company
- The initiating user has permission to transfer stock from the source branch
- Source branch has sufficient stock balance for the requested item(s)

## Main Flow

1. Storekeeper at the source branch creates a transfer request: destination
   branch, items, quantities
2. System reserves the stock at the source branch (or immediately decrements,
   depending on configuration — see Business Rules)
3. Transfer is marked "in transit"
4. Storekeeper (or system, if same-company auto-accept is enabled) at the
   destination branch confirms receipt
5. System writes two inventory movements: an issue at the source branch, a
   receipt at the destination branch
6. System writes an audit log entry for both sides

## Business Rules

- A transfer cannot be created for more than the source branch's current
  available balance
- Both movement records (issue + receipt) must reference the same transfer
  ID so the transfer can be traced end-to-end
- Transfers into or out of a branch during a locked period are not permitted

## Edge Cases

| Case | Expected behavior |
|---|---|
| Source branch balance insufficient | Blocked at creation, with available quantity shown |
| Destination branch never confirms | Transfer remains "in transit" indefinitely — needs a stale-transfer visibility view for managers |
| Transfer cancelled after creation but before confirmation | Stock is released back to source branch balance |

## Out of Scope (this feature)

- Cross-company transfers (not supported — tenant isolation)
- Transfer cost/freight tracking

## Open Questions

- Should destination-branch confirmation be mandatory, or can source-branch
  managers force-complete a transfer?
