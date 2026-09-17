# Enterprise Costing System
**Document:** Permission Matrix
**Version:** 1.0
**Author:** Mohamed Ibrahim

---

# 1. Purpose

This document defines the access rights for each user role across the
Enterprise Costing System. It ensures that users only have access to the
modules and actions required for their responsibilities, supporting security,
accountability, and operational integrity.

---

# 2. Permission Levels

| Level | Description |
|--------|-------------|
| Full | Full access to all operations within the module. |
| Manage | Create, edit, approve, and view records. |
| Edit | Create, update, and view records. |
| View | Read-only access. |
| None | No access. |

---

# 3. Permission Matrix

| Module | Owner | Branch Manager | Storekeeper | Purchasing Officer | Production Supervisor | Kitchen Manager | Accountant | System Admin |
|--------|:----:|:--------------:|:-----------:|:------------------:|:---------------------:|:---------------:|:----------:|:------------:|
| Dashboard | Full | Full | View | View | View | View | Full | Full |
| Inventory | Full | Manage | Edit | View | View | View | View | Full |
| Categories | Full | Manage | View | View | View | View | View | Full |
| Units | Full | Manage | View | View | View | View | View | Full |
| Suppliers | Full | Manage | View | Manage | None | None | View | Full |
| Purchase Requests | Full | Manage | View | Edit | None | None | View | Full |
| Purchase Orders | Full | Approve | View | Edit | None | None | View | Full |
| Goods Receipt | Full | Manage | Edit | Edit | None | None | View | Full |
| Purchase Invoice | Full | View | None | Edit | None | None | Manage | Full |
| Recipes | Full | View | None | None | View | Manage | View | Full |
| Production | Full | Manage | View | None | Manage | Edit | View | Full |
| Finished Goods | Full | Manage | Edit | None | Manage | Edit | View | Full |
| Sales | Full | Manage | None | None | None | None | View | Full |
| Reports | Full | Branch Reports | Inventory Reports | Purchase Reports | Production Reports | Kitchen Reports | Full | Full |
| Budget vs Actual | Full | Branch View | None | None | None | None | Manage | Full |
| Audit Trail | Full | View | None | None | None | None | View | Full |
| User Management | Full | None | None | None | None | None | None | Full |
| Roles & Permissions | Full | None | None | None | None | None | None | Full |
| Companies | Full | None | None | None | None | None | None | Full |
| Branches | Full | View | None | None | None | None | View | Full |
| System Settings | Full | None | None | None | None | None | None | Full |

---

# 4. General Security Rules

- Users may only access companies they are assigned to.
- Users may only access branches they are assigned to.
- All write operations are recorded in the Audit Trail.
- Deleted records should be soft-deleted unless business rules require permanent deletion.
- Approval actions require the appropriate approval permission.
- Locked accounting periods prevent modifications regardless of role.
- Permission changes take effect immediately after the user signs in again.

---

# 5. Approval Authority

| Process | Required Role |
|----------|---------------|
| Purchase Order Approval | Branch Manager or Owner |
| Supplier Price Change | Branch Manager or Owner |
| Inventory Adjustment Approval | Branch Manager |
| Period Closing | Owner |
| Period Reopening | Owner |
| User Creation | System Administrator |
| Company Creation | Owner |