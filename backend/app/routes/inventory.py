from fastapi import APIRouter, Depends, Query, Request

from app.api.responses import error, success
from app.database import inventory as inventory_db
from app.schemas import (
    ApproveAdjustmentRequest,
    GRNRequest,
    StockAdjustmentRequest,
    StockCountRequest,
    StockIssueRequest,
    TransferRequest,
)
from app.security.dependencies import check_period_open, get_current_user, require_roles

router = APIRouter(tags=["inventory"])


# ---------------------------------------------------------------------------
# Stock balances
# ---------------------------------------------------------------------------

@router.get("/stock/{branch_id}")
def stock_balances(branch_id: int, current_user: dict = Depends(get_current_user)):
    rows = inventory_db.get_branch_stock_balances(current_user["company_id"], branch_id)
    return success("Stock balances retrieved", stock=rows)


@router.get("/stock/finished-goods/{branch_id}")
def finished_goods_stock(branch_id: int, current_user: dict = Depends(get_current_user)):
    rows = inventory_db.get_finished_goods_balances(current_user["company_id"], branch_id)
    return success("Finished goods stock retrieved", stock=rows)


# ---------------------------------------------------------------------------
# GRN — Goods Receipt Note
# Stock increases HERE after physical delivery, not at PO approval
# ---------------------------------------------------------------------------

@router.post("/grn")
def create_grn(req: GRNRequest, request: Request, current_user: dict = Depends(require_roles("owner", "admin", "manager"))):
    check_period_open(str(req.entry_date), current_user)
    try:
        row = inventory_db.create_grn(
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            branch_id=req.branch_id,
            purchase_id=req.purchase_id,
            ingredient_id=req.ingredient_id,
            entry_date=req.entry_date,
            received_qty=req.received_qty,
            unit_cost=req.unit_cost,
            notes=req.notes,
            ip_address=request.client.host,
        )
        return success("Goods receipt recorded — stock updated", grn=row)
    except ValueError as e:
        return error(str(e))


@router.get("/grn")
def list_grns(
    branch_id: int | None = Query(None),
    purchase_id: int | None = Query(None),
    limit: int = Query(50),
    current_user: dict = Depends(get_current_user),
):
    rows = inventory_db.list_grns(current_user["company_id"], branch_id, purchase_id, limit)
    return success("GRNs retrieved", grns=rows)


# ---------------------------------------------------------------------------
# Stock issues
# ---------------------------------------------------------------------------

@router.get("/stock-issues")
def list_stock_issues(
    branch_id: int | None = Query(None),
    limit: int = Query(50),
    current_user: dict = Depends(get_current_user),
):
    rows = inventory_db.list_stock_issues(current_user["company_id"], branch_id, limit)
    return success("Stock issues retrieved", stock_issues=rows)


@router.post("/stock-issues")
def create_stock_issue(req: StockIssueRequest, request: Request, current_user: dict = Depends(require_roles("owner", "admin", "manager"))):
    check_period_open(str(req.entry_date), current_user)
    try:
        row = inventory_db.add_stock_issue(
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            branch_id=req.branch_id,
            ingredient_id=req.ingredient_id,
            entry_date=req.entry_date,
            qty_issued=req.qty_issued,
            issued_to=req.issued_to,
            notes=req.notes,
            ip_address=request.client.host,
        )
        return success("Stock issue recorded", stock_issue=row)
    except ValueError as e:
        return error(str(e))


# ---------------------------------------------------------------------------
# Stock counts
# ---------------------------------------------------------------------------

@router.get("/stock-counts")
def list_stock_counts(
    branch_id: int | None = Query(None),
    limit: int = Query(50),
    current_user: dict = Depends(get_current_user),
):
    rows = inventory_db.list_stock_counts(current_user["company_id"], branch_id, limit)
    return success("Stock counts retrieved", stock_counts=rows)


@router.post("/stock-counts")
def create_stock_count(req: StockCountRequest, request: Request, current_user: dict = Depends(require_roles("owner", "admin", "manager"))):
    check_period_open(str(req.entry_date), current_user)
    try:
        row = inventory_db.add_stock_count(
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            branch_id=req.branch_id,
            ingredient_id=req.ingredient_id,
            entry_date=req.entry_date,
            system_qty=req.system_qty,
            counted_qty=req.counted_qty,
            notes=req.notes,
            ip_address=request.client.host,
        )
        return success("Stock count recorded", stock_count=row, delta=row["delta"])
    except ValueError as e:
        return error(str(e))


# ---------------------------------------------------------------------------
# Adjustments  (pending → approved/rejected, stock moves only on approval)
# ---------------------------------------------------------------------------

@router.get("/stock-adjustments")
def list_adjustments(
    branch_id: int | None = Query(None),
    limit: int = Query(50),
    current_user: dict = Depends(get_current_user),
):
    rows = inventory_db.list_adjustments(current_user["company_id"], branch_id, limit)
    return success("Stock adjustments retrieved", adjustments=rows)


@router.post("/stock-adjustments")
def create_adjustment(req: StockAdjustmentRequest, request: Request, current_user: dict = Depends(require_roles("owner", "admin", "manager"))):
    check_period_open(str(req.entry_date), current_user)
    try:
        ingredient_id = req.ingredient_id or req.item_id
        if not ingredient_id:
            return error("ingredient_id or item_id is required")
        quantity_delta = req.quantity_delta if req.quantity_delta is not None else req.counted_quantity
        row = inventory_db.add_adjustment(
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            branch_id=req.branch_id,
            ingredient_id=ingredient_id,
            entry_date=req.entry_date,
            quantity_delta=quantity_delta,
            notes=req.notes,
            ip_address=request.client.host,
        )
        return success("Adjustment created — pending approval", adjustment=row)
    except ValueError as e:
        return error(str(e))


@router.post("/stock-adjustments/{adj_id}/approve")
def approve_adjustment(
    adj_id: int,
    req: ApproveAdjustmentRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    if req.status not in ("approved", "rejected"):
        return error("status must be 'approved' or 'rejected'")
    try:
        inventory_db.approve_adjustment(
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            adj_id=adj_id,
            status=req.status,
            notes=req.notes,
            ip_address=request.client.host,
        )
        return success(f"Adjustment {req.status}")
    except ValueError as e:
        return error(str(e), status=404)


# ---------------------------------------------------------------------------
# Opening stock
# ---------------------------------------------------------------------------

@router.get("/opening-stock")
def opening_stock(
    branch_id: int | None = Query(None),
    limit: int = Query(50),
    current_user: dict = Depends(get_current_user),
):
    rows = inventory_db.list_opening_stock(current_user["company_id"], branch_id, limit)
    return success("Opening stock retrieved", opening_stock=rows)


# ---------------------------------------------------------------------------
# Transfers
# ---------------------------------------------------------------------------

@router.get("/transfers")
def list_transfers(
    branch_id: int | None = Query(None),
    limit: int = Query(50),
    current_user: dict = Depends(get_current_user),
):
    rows = inventory_db.list_transfers(current_user["company_id"], branch_id, limit)
    return success("Transfers retrieved", transfers=rows)


@router.post("/transfers")
def create_transfer(req: TransferRequest, request: Request, current_user: dict = Depends(require_roles("owner", "admin", "manager"))):
    check_period_open(str(req.entry_date), current_user)
    try:
        row = inventory_db.add_transfer(
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            from_branch_id=req.from_branch_id,
            to_branch_id=req.to_branch_id,
            ingredient_id=req.ingredient_id,
            entry_date=req.entry_date,
            quantity=req.quantity,
            notes=req.notes,
            status=req.status,
            ip_address=request.client.host,
        )
        return success("Transfer recorded", transfer=row)
    except ValueError as e:
        return error(str(e))


# ---------------------------------------------------------------------------
# Inventory movements ledger (read-only)
# ---------------------------------------------------------------------------

@router.get("/inventory-movements")
def inventory_movements(
    branch_id: int | None = Query(None),
    movement_type: str | None = Query(None),
    limit: int = Query(100),
    current_user: dict = Depends(get_current_user),
):
    rows = inventory_db.list_inventory_movements(
        current_user["company_id"], branch_id, movement_type, limit
    )
    return success("Movements retrieved", inventory_movements=rows)
