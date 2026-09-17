# Enterprise Costing System
**Document:** Requirements Specification
**Version:** 1.0
**Author:** Mohamed Ibrahim

---

## 1. Purpose

This document defines the functional and non-functional requirements of the
Enterprise Costing System. Requirements are derived from the Product Vision
and the User Personas documents, and are organized by module so they can be
traced directly to features, permissions, and the personas who depend on
them.

---

## 2. Scope

Requirements cover the modules defined in the Product Vision (Inventory,
Purchasing, Production, Recipes, Costing, Sales, Reporting) and the platform
capabilities that support them (Multi-Tenancy, RBAC, Governance, Period
Management, Audit Trail). Items listed as Out of Scope in the Product Vision
(Payroll, HR, CRM, Delivery Management, full Accounting Ledger) are excluded
here as well.

---

## 3. Requirement Conventions

Each requirement has an ID, a description, and the persona(s) it primarily
serves. Priority follows MoSCoW:

- **M** — Must have (v1 blocking)
- **S** — Should have (v1 target, not blocking)
- **C** — Could have (nice to have)
- **W** — Won't have this version

---

## 4. Functional Requirements

### 4.1 Inventory Management

| ID | Requirement | Persona(s) | Priority |
|---|---|---|---|
| INV-01 | System shall maintain real-time stock balances per branch, sourced from a single ledger of inventory movements | Storekeeper, Branch Manager | M |
| INV-02 | System shall support goods receipt against purchase orders | Storekeeper | M |
| INV-03 | System shall support stock transfers between branches | Storekeeper, Branch Manager | M |
| INV-04 | System shall support stock adjustments with a mandatory reason code | Storekeeper | M |
| INV-05 | System shall support physical stock counts and reconcile variances against system balances | Storekeeper, Branch Manager | M |
| INV-06 | System shall flag negative or below-threshold stock levels | Branch Manager, Storekeeper | S |
| INV-07 | Every inventory transaction shall write to the audit trail with actor, timestamp, and before/after quantities | System Administrator | M |

### 4.2 Purchasing Management

| ID | Requirement | Persona(s) | Priority |
|---|---|---|---|
| PUR-01 | System shall support creation of purchase requests and purchase orders | Purchasing Officer | M |
| PUR-02 | System shall support cash purchases and petty cash tracking outside the formal PO flow | Purchasing Officer, Accountant | M |
| PUR-03 | System shall maintain a supplier registry with pricing history per ingredient | Purchasing Officer | M |
| PUR-04 | Supplier price changes shall route through a Governance approval request before the new price takes effect | Purchasing Officer, Branch Manager | M |
| PUR-05 | System shall support purchase invoice upload and retrieval | Purchasing Officer, Accountant | M |
| PUR-06 | System shall track delivery status against purchase orders | Purchasing Officer | S |
| PUR-07 | System shall support approval routing for purchase requests above a configurable threshold | Branch Manager, Restaurant Owner | S |

### 4.3 Production Management

| ID | Requirement | Persona(s) | Priority |
|---|---|---|---|
| PRD-01 | System shall support creation of production orders tied to a recipe | Production Supervisor | M |
| PRD-02 | System shall automatically consume ingredient stock according to the recipe's bill of materials on production confirmation | Production Supervisor, Kitchen Manager | M |
| PRD-03 | System shall record actual vs. expected ingredient consumption to surface waste or deviation | Production Supervisor, Kitchen Manager | S |
| PRD-04 | System shall support recording of finished-goods output from a production run | Production Supervisor | M |

### 4.4 Recipe Management

| ID | Requirement | Persona(s) | Priority |
|---|---|---|---|
| RCP-01 | System shall support structured recipes with ingredient quantities and units | Kitchen Manager, Production Supervisor | M |
| RCP-02 | System shall calculate recipe cost automatically from current ingredient costs | Kitchen Manager, Accountant | M |
| RCP-03 | System shall support recipe versioning so historical costing is not affected by later recipe edits | Kitchen Manager | S |
| RCP-04 | System shall flag recipes whose cost has changed materially since last review | Kitchen Manager, Restaurant Owner | C |

### 4.5 Food Cost Calculation / Costing

| ID | Requirement | Persona(s) | Priority |
|---|---|---|---|
| CST-01 | System shall calculate food cost per menu item from live recipe and ingredient cost data | Accountant, Restaurant Owner | M |
| CST-02 | System shall support cost trend reporting over configurable date ranges | Accountant, Restaurant Owner | S |
| CST-03 | System shall support variance reporting between expected and actual cost | Accountant | S |

### 4.6 Sales Tracking

| ID | Requirement | Persona(s) | Priority |
|---|---|---|---|
| SLS-01 | System shall record sales transactions and link them to recipe/menu-item cost data | Restaurant Owner, Accountant | M |
| SLS-02 | System shall calculate gross margin per menu item from linked sales and cost data | Restaurant Owner, Accountant | S |

### 4.7 Reporting & Analytics

| ID | Requirement | Persona(s) | Priority |
|---|---|---|---|
| RPT-01 | System shall provide a P&L report per branch and per company | Restaurant Owner, Accountant | M |
| RPT-02 | System shall provide budget-vs-actual reporting | Restaurant Owner, Accountant | M |
| RPT-03 | System shall provide role-appropriate dashboards on login | All personas | M |
| RPT-04 | Reports shall be exportable (e.g. PDF) | Accountant, Restaurant Owner | S |

---

## 5. Platform Requirements

### 5.1 Multi-Tenancy / Multi-Branch

| ID | Requirement | Priority |
|---|---|---|
| TEN-01 | System shall isolate all data by company; no company shall be able to query another's data | M |
| TEN-02 | System shall support multiple branches per company, each with independent inventory and reporting | M |
| TEN-03 | System Administrator shall be able to manage company lifecycle (create, suspend, purge, delete) | M |

### 5.2 Role-Based Access Control

| ID | Requirement | Priority |
|---|---|---|
| RBAC-01 | System shall enforce role-based permissions on every module and action | M |
| RBAC-02 | System shall support the roles: Owner, Admin, Manager, Accountant, Clerk | M |
| RBAC-03 | Personas defined in the Persona document shall map to one of the above system roles (see Section 6 — mapping gap noted) | M |
| RBAC-04 | Unauthorized access attempts shall be logged | S |

### 5.3 Governance & Approvals

| ID | Requirement | Priority |
|---|---|---|
| GOV-01 | Price and cost-affecting changes shall require approval before taking effect | M |
| GOV-02 | System shall maintain a queue of pending approval requests visible to authorized approvers | M |
| GOV-03 | Approval decisions (approve/reject) shall be logged with actor and timestamp | M |

### 5.4 Period Management

| ID | Requirement | Priority |
|---|---|---|
| PER-01 | System shall support opening, closing, and locking of accounting periods | M |
| PER-02 | No write action shall be permitted against a locked period, across all modules | M |
| PER-03 | Only authorized roles shall be able to lock/unlock a period | M |

### 5.5 Audit Trail

| ID | Requirement | Priority |
|---|---|---|
| AUD-01 | Every create/update/delete action across every module shall write an audit log entry | M |
| AUD-02 | Audit log entries shall capture actor, company, category, and before/after state where applicable | M |
| AUD-03 | Audit logs shall be viewable and filterable by System Administrator | M |
| AUD-04 | Audit logs shall be immutable (no update/delete from the application layer) | S |

---

## 6. Persona-to-Role Mapping (Gap to Resolve)

The Persona document defines **8 personas**, but the system's implemented
RBAC currently supports **5 roles** (owner, admin, manager, accountant,
clerk). This mapping needs to be finalized before permissions can be built
against personas 1:1:

| Persona | Suggested System Role |
|---|---|
| Restaurant Owner | Owner |
| Branch Manager | Manager |
| Storekeeper | Clerk |
| Purchasing Officer | Clerk or Manager (depending on approval authority) |
| Production Supervisor | Clerk or Manager |
| Accountant | Accountant |
| Kitchen Manager | Clerk or Manager |
| System Administrator | Admin |

Several personas (Storekeeper, Purchasing Officer, Production Supervisor,
Kitchen Manager) currently collapse into the same system role, which means
they'd have identical permissions today. Decide whether to:
- (a) keep 5 roles and treat the extra personas as UI/workflow framing only, or
- (b) extend RBAC to more granular roles matching the personas exactly.

---

## 7. Non-Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| NFR-01 | System shall be accessible as a cloud-hosted, multi-tenant SaaS application | M |
| NFR-02 | System shall support English and Arabic, including RTL layout | M |
| NFR-03 | System shall support light and dark theme | S |
| NFR-04 | API responses for standard operations shall return within an acceptable interactive threshold under normal load | S |
| NFR-05 | System shall enforce authentication via JWT with session expiry and a global 401 handling flow | M |
| NFR-06 | System shall be horizontally scalable to support enterprise-level company/branch counts | S |

---

## 8. Out of Scope

As defined in the Product Vision: Payroll, HR Management, CRM, Delivery
Management, and full general-ledger accounting are out of scope for this
version.