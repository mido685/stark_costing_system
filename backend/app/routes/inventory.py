from fastapi import APIRouter, Depends, Query, Request

from app.api.responses import error, success
from app.database import inventory as inventory_db
from app.schemas import (
    ApproveAdjustmentRequest,
    StockAdjustmentRequest,
    StockCountRequest,
    StockIssueRequest,
    TransferRequest,
)
from app.security.dependencies import check_period_open, get_current_user, require_roles

router = APIRouter(tags=["inventory"])


def _resolve_ingredient(ingredient_id: int | None, item_id: int | None) -> int:
    resolved = ingredient_id or item_id
    if not resolved:
        raise ValueError("ingredient_id or item_id is required")
    return resolved


@router.get("/stock/finished-goods/{branch_id}")
def finished_goods_stock(branch_id: int, current_user: dict = Depends(get_current_user)):
    rows = inventory_db.get_finished_goods_balances(current_user["company_id"], branch_id)
    return success("Finished goods stock retrieved", stock=rows)


@router.get("/stock/{branch_id}")
def stock_balances(branch_id: int, current_user: dict = Depends(get_current_user)):
    rows = inventory_db.get_branch_stock_balances(current_user["company_id"], branch_id)
    return success("Stock balances retrieved", stock=rows)


@router.get("/stock-issues")
def list_stock_issues(branch_id: int | None = Query(None), limit: int = Query(50), current_user: dict = Depends(get_current_user)):
    rows = inventory_db.list_stock_issues(current_user["company_id"], branch_id, limit)
    return success("Stock issues retrieved", stock_issues=rows)


@router.post("/stock-issues")
def create_stock_issue(req: StockIssueRequest, request: Request, current_user: dict = Depends(require_roles("owner", "admin", "manager"))):
    check_period_open(str(req.entry_date), current_user)
    try:
        row = inventory_db.add_stock_issue(current_user["company_id"], current_user["id"], req.branch_id, req.ingredient_id, req.entry_date, req.qty_issued, req.issued_to, req.notes, request.client.host)
        return success("Stock issue recorded", stock_issue=row)
    except ValueError as e:
        return error(str(e))


@router.post("/stock-counts")
def create_stock_count(req: StockCountRequest, request: Request, current_user: dict = Depends(require_roles("owner", "admin", "manager"))):
    check_period_open(str(req.entry_date), current_user)
    try:
        row = inventory_db.add_stock_count(current_user["company_id"], current_user["id"], req.branch_id, req.ingredient_id, req.entry_date, req.system_qty, req.counted_qty, req.notes, request.client.host)
        return success("Stock count logged", stock_count=row, delta=row["delta"])
    except ValueError as e:
        return error(str(e))


@router.get("/stock-counts")
def list_stock_counts(branch_id: int | None = Query(None), limit: int = Query(50), current_user: dict = Depends(get_current_user)):
    rows = inventory_db.list_stock_counts(current_user["company_id"], branch_id, limit)
    return success("Stock counts retrieved", stock_counts=rows)


@router.get("/stock-counts/with-purchases")
def stock_counts_with_purchases(branch_id: int | None = Query(None), limit: int = Query(50), current_user: dict = Depends(get_current_user)):
    rows = inventory_db.list_stock_counts(current_user["company_id"], branch_id, limit, with_purchases=True)
    return success("Stock counts retrieved", stock_counts=rows)


@router.post("/inventory/adjustment")
def stock_adjustment(req: StockAdjustmentRequest, request: Request, current_user: dict = Depends(require_roles("owner", "admin", "manager"))):
    check_period_open(str(req.entry_date), current_user)
    try:
        ingredient_id = _resolve_ingredient(req.ingredient_id, req.item_id)
        delta = req.quantity_delta if req.quantity_delta is not None else req.counted_quantity
        row = inventory_db.add_adjustment(current_user["company_id"], current_user["id"], req.branch_id, ingredient_id, req.entry_date, delta, req.notes, request.client.host)
        return success("Adjustment recorded", adjustment=row)
    except ValueError as e:
        return error(str(e))


@router.get("/stock-adjustments/by-branch")
def stock_adjustments_by_branch(branch_id: int | None = Query(None), limit: int = Query(50), current_user: dict = Depends(get_current_user)):
    rows = inventory_db.list_adjustments(current_user["company_id"], branch_id, limit)
    return success("Stock adjustments retrieved", adjustments=rows)


@router.post("/stock-adjustments/{adj_id}/approve")
def approve_adjustment(adj_id: int, req: ApproveAdjustmentRequest, request: Request, current_user: dict = Depends(require_roles("owner", "admin", "manager"))):
    if req.status not in ("approved", "rejected"):
        return error("status must be 'approved' or 'rejected'")
    try:
        inventory_db.approve_adjustment(current_user["company_id"], current_user["id"], adj_id, req.status, req.notes, request.client.host)
        return success(f"Adjustment {req.status}")
    except ValueError as e:
        return error(str(e), status=404)


@router.get("/opening-stock/by-branch")
def opening_stock_by_branch(branch_id: int | None = Query(None), limit: int = Query(50), current_user: dict = Depends(get_current_user)):
    rows = inventory_db.list_opening_stock(current_user["company_id"], branch_id, limit)
    return success("Opening stock retrieved", opening_stock=rows)


@router.get("/transfers/by-branch")
def transfers_by_branch(branch_id: int | None = Query(None), limit: int = Query(50), current_user: dict = Depends(get_current_user)):
    rows = inventory_db.list_transfers(current_user["company_id"], branch_id, limit)
    return success("Transfers retrieved", transfers=rows)


@router.post("/transfers")
def create_transfer(req: TransferRequest, request: Request, current_user: dict = Depends(require_roles("owner", "admin", "manager"))):
    check_period_open(str(req.entry_date), current_user)
    try:
        row = inventory_db.add_transfer(current_user["company_id"], current_user["id"], req.from_branch_id, req.to_branch_id, req.ingredient_id, req.entry_date, req.quantity, req.notes, req.status, request.client.host)
        return success("Transfer recorded", transfer=row)
    except ValueError as e:
        return error(str(e))
# In inventory routes
@router.get("/inventory-movements/by-branch")
def inventory_movements_by_branch(
    branch_id: int | None = Query(None),
    movement_type: str | None = Query(None),
    current_user: dict = Depends(get_current_user),
):
    rows = inventory_db.list_inventory_movements(
        current_user["company_id"], branch_id, movement_type
    )
    return success("Movements retrieved", inventory_movements=rows)