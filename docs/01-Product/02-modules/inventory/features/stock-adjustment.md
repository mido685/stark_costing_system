# Feature: Stock Adjustment

**Module:** Inventory
**Related Requirements:** INV-04, INV-07
**Primary Persona:** Storekeeper

---

## Purpose

Correct a stock balance when it no longer matches reality — spoilage,
breakage, theft, or a counting error — without ever allowing a silent,
unexplained change to inventory.

## User Story

As a Storekeeper, I want to adjust an item's stock balance up or down with a
documented reason, so that inventory stays accurate and every change is
explainable later.

## Preconditions

- The item exists and has a current stock balance at the branch
- The adjusting user has adjustment permission for the branch

## Main Flow

1. Storekeeper selects the item and branch
2. Storekeeper enters the adjustment quantity (positive or negative) and
   selects a reason code from a fixed list (e.g. damaged, expired, theft,
   count correction, other)
3. If "other" is selected, a free-text note is required
4. System writes an inventory movement (type: adjustment) with the reason
   code attached
5. System updates the stock balance
6. System writes an audit log entry

## Business Rules

- Reason code is **mandatory** on every adjustment — there is no path to
  submit one without it
- Adjustments beyond a configurable quantity/value threshold require
  Governance approval before taking effect (future extension — see
  Governance module)
- Adjustments in a locked period are not permitted

## Edge Cases

| Case | Expected behavior |
|---|---|
| Adjustment would bring balance negative | Allowed but flagged — negative balances usually indicate an earlier data problem and should surface, not be silently blocked |
| Large adjustment (e.g. >50% of balance) | Should be visually flagged for manager review, even without a hard threshold rule yet |
| Adjustment during a locked period | Blocked |

## Out of Scope (this feature)

- Automatic reason-code suggestions based on historical patterns
- Photo/attachment evidence for damage claims (candidate for a future version)

## Open Questions

- What's the actual quantity/value threshold that should trigger mandatory
  Governance approval? Needs a business decision, not just a technical one.
