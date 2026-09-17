# Feature: Stock Count

**Module:** Inventory
**Related Requirements:** INV-01, INV-05, INV-06, INV-07
**Primary Persona:** Storekeeper, Branch Manager

---

## Purpose

Periodically compare what the system believes is on hand against what's
physically on the shelf, surface the variance, and give managers visibility
into low or negative stock before it becomes an operational problem.

## User Story

As a Storekeeper, I want to record a physical count of items at my branch
and see how it compares to the system's balance, so that discrepancies get
caught and corrected instead of silently accumulating.

## Preconditions

- Branch has an active stock balance for the items being counted
- Counting user has permission for the branch

## Main Flow

1. Storekeeper starts a stock count session (full count or a filtered subset
   of items)
2. For each item, Storekeeper enters the physically counted quantity
3. System calculates variance (counted − system balance) per item, in real
   time as entries are made
4. Storekeeper submits the count
5. System either:
   - auto-generates a stock adjustment per variance line (with reason code
     "count correction"), or
   - routes the count for manager review before adjustments are applied
     (configurable)
6. System writes an audit log entry for the count session and any resulting
   adjustments

## Business Rules

- A count session must be completed or explicitly cancelled — it cannot be
  left half-entered and silently ignored
- Variance beyond a configurable threshold should require manager
  confirmation before auto-adjusting (ties into Governance)
- Stock balances remain live and queryable at all times (INV-01) — a count
  in progress does not lock the item from other transactions

## Low-Stock / Negative-Stock Alerts (INV-06)

- System flags any item whose balance drops below a configurable
  branch-level threshold
- System flags any item with a negative balance as a data-integrity signal,
  separate from a normal low-stock warning
- Alerts surface on the Branch Manager's dashboard, not just buried in a
  report

## Edge Cases

| Case | Expected behavior |
|---|---|
| Count session abandoned mid-entry | Session stays in "draft" state; does not affect live balances until submitted |
| Large variance on a single item | Flagged for manager review rather than silently auto-adjusted |
| Count during a locked period | Count itself is allowed (it's a reconciliation activity), but resulting adjustments queue until the period reopens — needs a product decision |

## Out of Scope (this feature)

- Barcode/scanner-based counting workflow (future enhancement)
- Cycle-count scheduling automation

## Open Questions

- What's the variance threshold that requires manager confirmation vs.
  auto-adjusting?
- Should counts during a locked period be blocked entirely, or allowed with
  adjustments deferred?
