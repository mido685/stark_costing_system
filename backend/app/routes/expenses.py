from fastapi import APIRouter, Depends, Query, Request

from app.api.responses import error, success
from app.database import expenses as expenses_db
from app.database.periods import get_period_status, is_period_frozen
from app.schemas import (
    AccrualRequest, BudgetRequest, ClosePeriodRequest, DepreciationRequest,
    ExpenseRequest, PayrollRequest, PeriodBackupRequest, PeriodSnapshotRequest,
    PeriodStatusRequest, PrepaymentRequest,
)
from app.security.dependencies import check_period_open, get_current_user, require_roles
from app.schemas import ExpenseCategoryRequest

router = APIRouter(tags=["expenses"])


@router.get("/expenses")
def list_expenses(branch_id: int | None = Query(None), period: str | None = Query(None), limit: int = Query(100), current_user: dict = Depends(get_current_user)):
    return success("Expenses retrieved", expenses=expenses_db.list_expenses(current_user["company_id"], branch_id, period, limit))


@router.post("/expenses")
def create_expense(req: ExpenseRequest, request: Request, current_user: dict = Depends(require_roles("owner", "admin", "manager"))):
    check_period_open(req.entry_date, current_user)
    try:
        row = expenses_db.add_expense(current_user["company_id"], current_user["id"], req.branch_id, req.entry_date, req.category, req.amount, req.expense_group, req.subtype, req.notes, request.client.host)
        return success("Expense recorded", expense=row)
    except ValueError as e:
        return error(str(e))


@router.get("/payroll")
def list_payroll(branch_id: int | None = Query(None), period: str | None = Query(None), limit: int = Query(100), current_user: dict = Depends(get_current_user)):
    return success("Payroll retrieved", payroll=expenses_db.list_payroll_entries(current_user["company_id"], branch_id, period, limit))


@router.post("/payroll")
def create_payroll(req: PayrollRequest, request: Request, current_user: dict = Depends(require_roles("owner", "admin", "manager"))):
    check_period_open(req.entry_date, current_user)
    try:
        row = expenses_db.add_payroll(current_user["company_id"], current_user["id"], req.branch_id, req.entry_date, req.employee_group, req.base_salary, req.employer_burden, req.notes, request.client.host)
        return success("Payroll entry saved", payroll=row)
    except ValueError as e:
        return error(str(e))


@router.get("/depreciation")
def list_depreciation(branch_id: int | None = Query(None), period: str | None = Query(None), limit: int = Query(100), current_user: dict = Depends(get_current_user)):
    return success("Depreciation retrieved", depreciation=expenses_db.list_depreciation_entries(current_user["company_id"], branch_id, period, limit))


@router.post("/depreciation")
def create_depreciation(req: DepreciationRequest, request: Request, current_user: dict = Depends(require_roles("owner", "admin", "manager"))):
    check_period_open(req.entry_date, current_user)
    try:
        row = expenses_db.add_depreciation(current_user["company_id"], current_user["id"], req.branch_id, req.entry_date, asset_name=req.asset_name, amount=req.amount, notes=req.notes, ip_address=request.client.host)
        return success("Depreciation entry saved", depreciation=row)
    except ValueError as e:
        return error(str(e))


@router.get("/accruals")
def list_accruals(branch_id: int | None = Query(None), period: str | None = Query(None), limit: int = Query(100), current_user: dict = Depends(get_current_user)):
    return success("Accruals retrieved", accruals=expenses_db.list_accrual_entries(current_user["company_id"], branch_id, period, limit))


@router.post("/accruals")
def create_accrual(req: AccrualRequest, request: Request, current_user: dict = Depends(require_roles("owner", "admin", "manager"))):
    check_period_open(req.entry_date, current_user)
    try:
        row = expenses_db.add_accrual(current_user["company_id"], current_user["id"], req.branch_id, req.entry_date, category=req.category, amount=req.amount, notes=req.notes, ip_address=request.client.host)
        return success("Accrual entry saved", accrual=row)
    except ValueError as e:
        return error(str(e))


@router.get("/prepayments")
def list_prepayments(branch_id: int | None = Query(None), period: str | None = Query(None), limit: int = Query(100), current_user: dict = Depends(get_current_user)):
    return success("Prepayments retrieved", prepayments=expenses_db.list_prepayment_entries(current_user["company_id"], branch_id, period, limit))


@router.post("/prepayments")
def create_prepayment(req: PrepaymentRequest, request: Request, current_user: dict = Depends(require_roles("owner", "admin", "manager"))):
    check_period_open(req.entry_date, current_user)
    try:
        row = expenses_db.add_prepayment(current_user["company_id"], current_user["id"], req.branch_id, req.entry_date, category=req.category, amount=req.amount, months=req.months, notes=req.notes, ip_address=request.client.host)
        return success("Prepayment entry saved", prepayment=row)
    except ValueError as e:
        return error(str(e))


@router.post("/budgets")
def set_budget(req: BudgetRequest, current_user: dict = Depends(require_roles("owner", "admin", "manager"))):
    check_period_open(f"{req.period}-01", current_user)
    try:
        return success("Budget saved", budget=expenses_db.set_budget(current_user["company_id"], req.branch_id, req.period, req.category, req.amount))
    except ValueError as e:
        return error(str(e))


@router.get("/budgets/{branch_id}/{period}")
def budget_vs_actual(branch_id: int, period: str, current_user: dict = Depends(get_current_user)):
    return success("Budget vs actual retrieved", budget=expenses_db.get_budget_vs_actual(current_user["company_id"], branch_id, period))


@router.post("/period-snapshots")
def create_period_snapshot(req: PeriodSnapshotRequest, current_user: dict = Depends(require_roles("owner", "admin"))):
    try:
        row = expenses_db.create_period_snapshot(current_user["company_id"], current_user["id"], **req.model_dump())
        return success("Period snapshot created", snapshot=row)
    except Exception as e:
        return error(str(e))


@router.get("/period-snapshots")
def list_period_snapshots(current_user: dict = Depends(get_current_user)):
    return success("Period snapshots retrieved", snapshots=expenses_db.list_period_snapshots(current_user["company_id"]))

@router.post("/period-backups/generate")
def generate_period_backups(req: PeriodBackupRequest, current_user: dict = Depends(require_roles("owner", "admin"))):
    rows = expenses_db.generate_period_backups(current_user["company_id"], current_user["id"], req.months, req.locked_by or current_user.get("username", ""), req.notes)
    return success("Period backups generated", count=len(rows), rows=rows)


@router.get("/period-backups")
def list_period_backups(branch_id: int | None = Query(None), months: int = Query(4, ge=1, le=24), date_from: str | None = Query(None), date_to: str | None = Query(None), refresh: bool = Query(False), current_user: dict = Depends(get_current_user)):
    if refresh:
        if current_user.get("role") not in {"owner", "admin"}:
            return error("Insufficient permissions", status=403)
        expenses_db.generate_period_backups(current_user["company_id"], current_user["id"], months, current_user.get("username", ""), "Refreshed from period backup list")
    return success("Period backups retrieved", backups=expenses_db.list_period_backups(current_user["company_id"], branch_id, months, date_from, date_to))


@router.get("/period/status")
def get_period_status_api(period: str = Query(...), current_user: dict = Depends(get_current_user)):
    status = get_period_status(current_user["company_id"], period)
    return success("Period status retrieved", **status, is_closed=status["status"] in {"closed", "locked"}, is_locked=status["status"] == "locked")


@router.post("/period/status")
def set_period_status_api(req: PeriodStatusRequest, current_user: dict = Depends(require_roles("owner", "admin"))):
    try:
        status = expenses_db.set_company_period_status(current_user["company_id"], req.period, req.status, current_user["id"], req.notes)
        if req.status in {"closed", "locked"}:
            expenses_db.generate_period_backups(current_user["company_id"], current_user["id"], 4, current_user.get("username", ""), f"Generated when period {req.period} was {req.status}")
        return success("Period status saved", **status, is_closed=status["status"] in {"closed", "locked"}, is_locked=status["status"] == "locked")
    except ValueError as e:
        return error(str(e))


@router.post("/period/close")
def close_period(req: ClosePeriodRequest, current_user: dict = Depends(require_roles("owner", "admin"))):
    row = expenses_db.close_period(req.branch_id, current_user["company_id"], req.closed_to, req.user_id or current_user["id"], req.notes)
    return success("Period closed", closure=row)


@router.get("/period/is-closed")
def is_period_closed_api(branch_id: int = Query(...), entry_date: str = Query(...), current_user: dict = Depends(get_current_user)):
    status = get_period_status(current_user["company_id"], entry_date[:7])
    return success("Period closure checked", is_closed=is_period_frozen(branch_id, entry_date), is_locked=status["status"] == "locked", status=status["status"])
# ─── Expense Categories ───────────────────────────────────────────────────────

@router.get("/expense-categories")
def list_expense_categories_api(current_user: dict = Depends(get_current_user)):
    rows = expenses_db.list_expense_categories(current_user["company_id"])
    return success("Expense categories retrieved", categories=[{"id": r["id"], "name": r["name"], "type": r["type"]} for r in rows])


@router.post("/expense-categories")
def create_expense_category_api(
    req: ExpenseCategoryRequest,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    name = req.name.strip()

    if not name:
        return error("Category name is required", status=422)

    row = expenses_db.create_expense_category(
        current_user["company_id"],
        name,
        req.type
    )

    return success(
        "Expense category created",
        category={
            "id": row["id"],
            "name": row["name"],
            "type": row["type"],
        }
    )