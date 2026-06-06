"""
All Pydantic request/response models.
Import from app.schemas in route files.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


# ── Auth ─────────────────────────────────────────────────────────────────────

class CompanyRegisterRequest(BaseModel):
    company_name: str
    company_slug: str
    owner_username: str
    owner_display_name: str
    owner_password: str


class LoginRequest(BaseModel):
    company_slug: Optional[str] = None
    username: str
    password: str


# ── Branches ─────────────────────────────────────────────────────────────────

class BranchRequest(BaseModel):
    name: str
    location: str | None = None
    manager: str | None = None


class BranchUpdateRequest(BaseModel):
    name: str | None = None
    location: str | None = None
    manager: str | None = None


# ── Users ────────────────────────────────────────────────────────────────────

class UserRequest(BaseModel):
    username: str
    display_name: str
    role_id: int | None = None
    role: str | None = None
    password: str


class UserUpdateRequest(BaseModel):
    display_name: str | None = None
    role_id: int | None = None
    role: str | None = None


# ── Products ─────────────────────────────────────────────────────────────────

class ProductRequest(BaseModel):
    name: str
    unit: str | None = None
    sale_price: float = 0
    sku: str | None = None
    sku_prefix: str | None = None


class ProductUpdateRequest(BaseModel):
    name: str | None = None
    unit: str | None = None
    sale_price: float | None = None
    sku: str | None = None


# ── Ingredients ──────────────────────────────────────────────────────────────

class IngredientRequest(BaseModel):
    name: str
    unit: str
    cost_per_unit: float = 0
    stock_qty: float = 0
    reorder_level: float = 0
    supplier_id: int | None = None
    sku: str | None = None
    sku_prefix: str | None = None


class IngredientUpdateRequest(BaseModel):
    name: str | None = None
    unit: str | None = None
    cost_per_unit: float | None = None
    reorder_level: float | None = None
    supplier_id: int | None = None
    sku: str | None = None


# ── Suppliers ────────────────────────────────────────────────────────────────

class SupplierRequest(BaseModel):
    name: str
    contact: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    website: str | None = None
    commercial_reg_number: str | None = None
    agent_name: str | None = None
    agent_phone: str | None = None
    category: str | None = None
    notes: str = ""


class SupplierUpdateRequest(BaseModel):
    name: str | None = None
    contact: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    website: str | None = None
    commercial_reg_number: str | None = None
    agent_name: str | None = None
    agent_phone: str | None = None
    category: str | None = None
    notes: str | None = None


class SupplierPriceRequest(BaseModel):
    supplier_id: int
    ingredient_id: int
    price: float
    entry_date: str
    notes: str = ""


# ── Cash Purchases, Petty Cash, Expense Categories ───────────────────────────

class CashPurchaseRequest(BaseModel):
    branch_id: int
    entry_date: str
    supplier_id: int | None = None
    ingredient_id: int | None = None
    category_id: int | None = None
    purchase_type: str = "branch_cash"
    quantity: float = 0
    unit_cost: float = 0
    tax_amount: float = 0
    payable_amount: float = 0
    petty_cash_used: bool = False
    notes: str = ""


class PettyCashTopUpRequest(BaseModel):
    branch_id: int
    amount: float
    entry_date: str
    notes: str = ""


class ExpenseCategoryRequest(BaseModel):
    name: str
    type: str


# ── Purchases ────────────────────────────────────────────────────────────────

class PurchaseRequest(BaseModel):
    branch_id: int
    supplier_id: int
    ingredient_id: int | None = None
    item_id: int | None = None
    entry_date: str
    quantity: float
    unit_cost: float
    tax_amount: float = 0
    payable_amount: float = 0
    notes: str = ""
    status: str = "pending"  # PO starts as pending — no stock impact at this stage


class PurchaseReturnRequest(BaseModel):
    branch_id: int
    supplier_id: int
    ingredient_id: int | None = None
    item_id: int | None = None
    entry_date: str
    quantity: float
    unit_cost: float
    refund_amount: float = 0
    notes: str = ""
    status: str = "pending"


# ── GRN — Goods Receipt Note ─────────────────────────────────────────────────
# Stock increases HERE when goods are physically received, not at PO approval.

class GRNRequest(BaseModel):
    branch_id: int
    purchase_id: int        # must reference an approved PO
    ingredient_id: int
    entry_date: str
    received_qty: float     # actual delivered quantity (may differ from PO quantity)
    unit_cost: float        # actual unit cost from supplier invoice
    notes: str = ""


# ── Expenses & Periods ───────────────────────────────────────────────────────

class ExpenseRequest(BaseModel):
    branch_id: int
    entry_date: str
    category: str
    amount: float
    expense_group: str = "operating"
    subtype: str = "admin"
    notes: str = ""


class PayrollRequest(BaseModel):
    branch_id: int
    entry_date: str
    employee_group: str
    base_salary: float = 0
    employer_burden: float = 0
    total_amount: float = 0
    notes: str = ""


class DepreciationRequest(BaseModel):
    branch_id: int
    entry_date: str
    asset_name: str
    amount: float
    notes: str = ""


class AccrualRequest(BaseModel):
    branch_id: int
    entry_date: str
    category: str
    amount: float
    notes: str = ""


class PrepaymentRequest(BaseModel):
    branch_id: int
    entry_date: str
    category: str
    amount: float
    months: int = 1
    notes: str = ""


class BudgetRequest(BaseModel):
    branch_id: int
    period: str
    category: str
    amount: float


class PeriodSnapshotRequest(BaseModel):
    branch_id: int
    period_label: str
    entry_date: str
    notes: str = ""
    locked_by: str = ""
    opening_value: float = 0
    closing_value: float = 0
    purchases_value: float = 0
    cogs: float = 0


class PeriodBackupRequest(BaseModel):
    months: int = 4
    locked_by: str = ""
    notes: str = ""


class PeriodStatusRequest(BaseModel):
    period: str
    status: str
    notes: str = ""


class ClosePeriodRequest(BaseModel):
    branch_id: int
    closed_to: str
    user_id: int | None = None
    notes: str = ""


# ── Items (unified) ──────────────────────────────────────────────────────────

class ItemRequest(BaseModel):
    name: str
    unit: str
    category: str                   # 'finished_good' or 'raw_material'
    sale_price: float = 0           # for finished_good
    standard_cost: float = 0        # for raw_material
    reorder_level: float = 0        # for raw_material
    sku: str | None = None
    sku_prefix: str | None = None   # auto-generate SKU from this prefix


# ── Password Change ──────────────────────────────────────────────────────────

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


# ── Recipes ──────────────────────────────────────────────────────────────────

class RecipeRequest(BaseModel):
    yield_pct: float = 100
    portion_size: float = 1
    portion_unit: str = "plate"
    notes: str = ""


class RecipeIngredientRequest(BaseModel):
    ingredient_id: int
    qty_required: float


class ProductionRequest(BaseModel):
    branch_id: int
    product_id: int
    entry_date: str
    quantity: float
    material_cost: float = 0
    labor_cost: float = 0
    overhead_cost: float = 0
    notes: str = ""


# ── Revenue ──────────────────────────────────────────────────────────────────

class RevenueRequest(BaseModel):
    branch_id: int
    entry_date: str
    amount: float
    product_id: int | None = None
    quantity: float = 0
    notes: str = ""


# ── Sales ────────────────────────────────────────────────────────────────────

class SaleRequest(BaseModel):
    branch_id: int
    product_id: int | None = None
    item_id: int | None = None
    entry_date: str
    quantity: float
    unit_price: float = 0
    discount_amount: float = 0
    promotion_amount: float = 0
    tax_amount: float = 0
    payment_method: str = "cash"
    receivable_amount: float = 0
    receivable: float | None = None
    notes: str = ""
    status: str = "approved"


# ── Waste & Damage ───────────────────────────────────────────────────────────

class WasteRequest(BaseModel):
    branch_id: int
    entry_date: str
    quantity: float
    reason: str = "other"
    ingredient_id: int | None = None
    product_id: int | None = None
    item_id: int | None = None
    notes: str = ""


class DamageRequest(BaseModel):
    branch_id: int
    entry_date: str
    quantity: float
    reason: str = "damage"
    ingredient_id: int | None = None
    product_id: int | None = None
    item_id: int | None = None
    notes: str = ""


# ── Inventory ────────────────────────────────────────────────────────────────

class StockIssueRequest(BaseModel):
    branch_id: int
    ingredient_id: int
    entry_date: str
    qty_issued: float
    issued_to: str | None = None
    notes: str = ""


class StockCountRequest(BaseModel):
    branch_id: int
    ingredient_id: int
    entry_date: str
    system_qty: float
    counted_qty: float
    notes: str = ""


class StockAdjustmentRequest(BaseModel):
    branch_id: int
    entry_date: str
    ingredient_id: int | None = None
    item_id: int | None = None          # alias for ingredient_id (legacy support)
    quantity_delta: float | None = None
    counted_quantity: float = 0         # alias for quantity_delta (legacy support)
    notes: str = ""


class ApproveAdjustmentRequest(BaseModel):
    status: Literal["approved", "rejected"]
    notes: str = ""


class TransferRequest(BaseModel):
    from_branch_id: int
    to_branch_id: int
    ingredient_id: int
    entry_date: str
    quantity: float
    notes: str = ""
    status: str = "approved"


# ── SKU Prefixes ─────────────────────────────────────────────────────────────

class SkuPrefixRequest(BaseModel):
    label: str
    prefix: str
    item_type: Literal["raw_material", "finished_good", "both"] = "raw_material"
class PurchaseUpdateRequest(BaseModel):
    quantity:   float
    unit_cost:  float
    notes:      str = ""