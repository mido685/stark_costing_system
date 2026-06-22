"""
app/schemas.py
All Pydantic request/response models.
Import from app.schemas in route files.
"""

from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


# ─────────────────────────────────────────────────────────────────────────────
# AUTH
# ─────────────────────────────────────────────────────────────────────────────

class CompanyRegisterRequest(BaseModel):
    company_name:       str
    company_slug:       str
    owner_username:     str
    owner_display_name: str
    owner_password:     str


class LoginRequest(BaseModel):
    company_slug: Optional[str] = None
    username:     str
    password:     str


# ─────────────────────────────────────────────────────────────────────────────
# BRANCHES
# ─────────────────────────────────────────────────────────────────────────────

class BranchRequest(BaseModel):
    name:     str
    location: str | None = None
    manager:  str | None = None


class BranchUpdateRequest(BaseModel):
    name:     str | None = None
    location: str | None = None
    manager:  str | None = None


# ─────────────────────────────────────────────────────────────────────────────
# USERS
# ─────────────────────────────────────────────────────────────────────────────

class UserRequest(BaseModel):
    username:     str
    display_name: str
    role_id:      int | None = None
    role:         str | None = None
    password:     str


class UserUpdateRequest(BaseModel):
    display_name: str | None = None
    role_id:      int | None = None
    role:         str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password:     str


# ─────────────────────────────────────────────────────────────────────────────
# PRODUCTS
# ─────────────────────────────────────────────────────────────────────────────

class ProductRequest(BaseModel):
    name:       str
    unit:       str | None = None
    sale_price: float      = 0
    sku:        str | None = None
    sku_prefix: str | None = None


class ProductUpdateRequest(BaseModel):
    name:       str | None   = None
    unit:       str | None   = None
    sale_price: float | None = None
    sku:        str | None   = None


# ─────────────────────────────────────────────────────────────────────────────
# INGREDIENTS
# ─────────────────────────────────────────────────────────────────────────────

class IngredientRequest(BaseModel):
    name:          str
    unit:          str
    cost_per_unit: float      = 0
    stock_qty:     float      = 0
    reorder_level: float      = 0
    supplier_id:   int | None = None
    sku:           str | None = None
    sku_prefix:    str | None = None


class IngredientUpdateRequest(BaseModel):
    name:          str | None   = None
    unit:          str | None   = None
    cost_per_unit: float | None = None
    reorder_level: float | None = None
    supplier_id:   int | None   = None
    sku:           str | None   = None


# ─────────────────────────────────────────────────────────────────────────────
# ITEMS (unified raw_material / finished_good)
# ─────────────────────────────────────────────────────────────────────────────

class ItemRequest(BaseModel):
    name:          str
    unit:          str
    category:      str             # 'finished_good' or 'raw_material'
    sale_price:    float      = 0  # for finished_good
    standard_cost: float      = 0  # for raw_material
    reorder_level: float      = 0  # for raw_material
    sku:           str | None = None
    sku_prefix:    str | None = None


# ─────────────────────────────────────────────────────────────────────────────
# SUPPLIERS
# ─────────────────────────────────────────────────────────────────────────────

class SupplierRequest(BaseModel):
    name:                  str
    contact:               str | None = None
    phone:                 str | None = None
    email:                 str | None = None
    address:               str | None = None
    website:               str | None = None
    commercial_reg_number: str | None = None
    agent_name:            str | None = None
    agent_phone:           str | None = None
    category:              str | None = None
    notes:                 str        = ""


class SupplierUpdateRequest(BaseModel):
    """
    All fields optional — only non-None values are written to the database.
    Pass "" (empty string) to explicitly clear a nullable text field.
    Omit a field (or pass None) to leave it unchanged.
    """
    name:                  str | None = None
    contact:               str | None = None
    phone:                 str | None = None
    email:                 str | None = None
    address:               str | None = None
    website:               str | None = None
    commercial_reg_number: str | None = None
    agent_name:            str | None = None
    agent_phone:           str | None = None
    category:              str | None = None
    notes:                 str | None = None


class SupplierPriceRequest(BaseModel):
    supplier_id:   int
    ingredient_id: int
    price:         float = Field(..., gt=0, description="Must be greater than zero")
    purchase_date: str   = Field(..., description="ISO date: YYYY-MM-DD")
    notes:         str   = ""
    price_type: Literal[
        "initial_cost",
        "market_price",
        "contract_price",
        "spot_price",
    ] = "market_price"

    @field_validator("purchase_date", mode="before")
    @classmethod
    def validate_date_format(cls, v: str) -> str:
        try:
            date.fromisoformat(v)
        except ValueError:
            raise ValueError("Date must be in YYYY-MM-DD format")
        return v

class StandardCostUpdateRequest(BaseModel):
    """
    Formal standard cost revision — restricted to owner/admin roles.
    Used after quarterly reviews or approved contract renegotiations.
    Never call this in response to a single market price quote.
    """
    new_cost:       float = Field(..., gt=0, description="New standard cost per unit")
    effective_date: str   = Field(..., description="When this cost takes effect: YYYY-MM-DD")
    notes:          str   = ""

    @field_validator("effective_date", mode="before")
    @classmethod
    def validate_date_format(cls, v: str) -> str:
        try:
            date.fromisoformat(v)
        except ValueError:
            raise ValueError("effective_date must be in YYYY-MM-DD format")
        return v


# ─────────────────────────────────────────────────────────────────────────────
# PURCHASES (PO)
# ─────────────────────────────────────────────────────────────────────────────

class PurchaseRequest(BaseModel):
    branch_id:     int
    supplier_id:   int
    ingredient_id: int | None = None
    item_id:       int | None = None  # alias for ingredient_id (legacy support)
    entry_date:    str
    quantity:      float
    unit_cost:     float
    tax_amount:    float = 0
    payable_amount: float = 0
    notes:         str   = ""
    status:        str   = "pending"  # PO starts as pending — no stock impact yet


class PurchaseUpdateRequest(BaseModel):
    quantity:      float
    unit_cost:     float
    notes:         str = ""
    change_reason: str = ""


class PurchaseReturnRequest(BaseModel):
    branch_id:     int
    supplier_id:   int
    ingredient_id: int | None = None
    item_id:       int | None = None
    entry_date:    str
    quantity:      float
    unit_cost:     float
    refund_amount: float = 0
    notes:         str   = ""
    status:        str   = "pending"


# ─────────────────────────────────────────────────────────────────────────────
# GRN — GOODS RECEIPT NOTE
# Stock increases HERE when goods are physically received, not at PO approval.
# ─────────────────────────────────────────────────────────────────────────────

class GRNRequest(BaseModel):
    branch_id:     int
    purchase_id:   int    # must reference an approved PO
    ingredient_id: int
    entry_date:    str
    received_qty:  float  # actual delivered quantity (may differ from PO qty)
    unit_cost:     float  # actual unit cost from supplier invoice
    notes:         str    = ""


# ─────────────────────────────────────────────────────────────────────────────
# CASH PURCHASES & PETTY CASH
# ─────────────────────────────────────────────────────────────────────────────

class CashPurchaseRequest(BaseModel):
    branch_id:       int
    entry_date:      str
    supplier_id:     int | None = None
    ingredient_id:   int | None = None
    category_id:     int | None = None
    purchase_type:   str   = "branch_cash"
    quantity:        float = 0
    unit_cost:       float = 0
    tax_amount:      float = 0
    payable_amount:  float = 0
    petty_cash_used: bool  = False
    notes:           str   = ""


class PettyCashTopUpRequest(BaseModel):
    branch_id:  int
    amount:     float
    entry_date: str
    notes:      str = ""


class ExpenseCategoryRequest(BaseModel):
    name: str
    type: str


# ─────────────────────────────────────────────────────────────────────────────
# EXPENSES & FINANCE
# ─────────────────────────────────────────────────────────────────────────────

class ExpenseRequest(BaseModel):
    branch_id:     int
    entry_date:    str
    category:      str
    amount:        float
    expense_group: str = "operating"
    subtype:       str = "admin"
    notes:         str = ""


class PayrollRequest(BaseModel):
    branch_id:       int
    entry_date:      str
    employee_group:  str
    base_salary:     float = 0
    employer_burden: float = 0
    total_amount:    float = 0
    notes:           str   = ""


class DepreciationRequest(BaseModel):
    branch_id:  int
    entry_date: str
    asset_name: str
    amount:     float
    notes:      str = ""


class AccrualRequest(BaseModel):
    branch_id:  int
    entry_date: str
    category:   str
    amount:     float
    notes:      str = ""


class PrepaymentRequest(BaseModel):
    branch_id:  int
    entry_date: str
    category:   str
    amount:     float
    months:     int = 1
    notes:      str = ""


class BudgetRequest(BaseModel):
    branch_id: int
    period:    str
    category:  str
    amount:    float


# ─────────────────────────────────────────────────────────────────────────────
# PERIOD MANAGEMENT
# ─────────────────────────────────────────────────────────────────────────────

class PeriodSnapshotRequest(BaseModel):
    period:          str    # YYYY-MM
    total_sales:     float = 0
    total_expenses:  float = 0
    total_purchases: float = 0
    cogs:            float = 0
    gross_profit:    float = 0
    inventory_value: float = 0


class PeriodBackupRequest(BaseModel):
    months:    int = 4
    locked_by: str = ""
    notes:     str = ""


class PeriodStatusRequest(BaseModel):
    period: str
    status: str
    notes:  str = ""


class ClosePeriodRequest(BaseModel):
    branch_id: int
    closed_to: str
    user_id:   int | None = None
    notes:     str        = ""


# ─────────────────────────────────────────────────────────────────────────────
# RECIPES & PRODUCTION
# ─────────────────────────────────────────────────────────────────────────────

class RecipeRequest(BaseModel):
    yield_pct:    float = 100
    portion_size: float = 1
    portion_unit: str   = "plate"
    notes:        str   = ""


class RecipeIngredientRequest(BaseModel):
    ingredient_id: int
    qty_required:  float


class ProductionRequest(BaseModel):
    branch_id:     int
    product_id:    int
    entry_date:    str
    quantity:      float
    material_cost: float = 0
    labor_cost:    float = 0
    overhead_cost: float = 0
    notes:         str   = ""


# ─────────────────────────────────────────────────────────────────────────────
# REVENUE & SALES
# ─────────────────────────────────────────────────────────────────────────────

class RevenueRequest(BaseModel):
    branch_id:  int
    entry_date: str
    amount:     float
    product_id: int | None = None
    quantity:   float      = 0
    notes:      str        = ""


class SaleRequest(BaseModel):
    branch_id:        int
    product_id:       int | None = None
    item_id:          int | None = None
    entry_date:       str
    quantity:         float
    unit_price:       float = 0
    discount_amount:  float = 0
    promotion_amount: float = 0
    tax_amount:       float = 0
    payment_method:   str   = "cash"
    receivable_amount: float = 0
    receivable:       float | None = None  # legacy alias for receivable_amount
    notes:            str   = ""
    status:           str   = "approved"


# ─────────────────────────────────────────────────────────────────────────────
# WASTE & DAMAGE
# ─────────────────────────────────────────────────────────────────────────────

class WasteRequest(BaseModel):
    branch_id:     int
    entry_date:    str
    quantity:      float
    reason:        str        = "other"
    ingredient_id: int | None = None
    product_id:    int | None = None
    item_id:       int | None = None
    notes:         str        = ""


class DamageRequest(BaseModel):
    branch_id:     int
    entry_date:    str
    quantity:      float
    reason:        str        = "damage"
    ingredient_id: int | None = None
    product_id:    int | None = None
    item_id:       int | None = None
    notes:         str        = ""


# ─────────────────────────────────────────────────────────────────────────────
# INVENTORY
# ─────────────────────────────────────────────────────────────────────────────

class StockIssueRequest(BaseModel):
    branch_id:     int
    ingredient_id: int
    entry_date:    str
    qty_issued:    float
    issued_to:     str | None = None
    notes:         str        = ""


class StockCountRequest(BaseModel):
    branch_id:     int
    ingredient_id: int
    entry_date:    str
    system_qty:    float
    counted_qty:   float
    notes:         str = ""


class StockAdjustmentRequest(BaseModel):
    branch_id:        int
    entry_date:       str
    ingredient_id:    int | None   = None
    item_id:          int | None   = None    # alias for ingredient_id (legacy support)
    quantity_delta:   float | None = None
    counted_quantity: float        = 0       # alias for quantity_delta (legacy support)
    notes:            str          = ""


class ApproveAdjustmentRequest(BaseModel):
    status: Literal["approved", "rejected"]
    notes:  str = ""


class TransferRequest(BaseModel):
    from_branch_id: int
    to_branch_id:   int
    ingredient_id:  int
    entry_date:     str
    quantity:       float
    notes:          str = ""
    status:         str = "approved"


# ─────────────────────────────────────────────────────────────────────────────
# SKU PREFIXES
# ─────────────────────────────────────────────────────────────────────────────

class SkuPrefixRequest(BaseModel):
    label:     str
    prefix:    str
    item_type: Literal["raw_material", "finished_good", "both"] = "raw_material"
    
class SupplierPriceApprovalRequest(BaseModel):
    action: Literal["approved", "rejected"]