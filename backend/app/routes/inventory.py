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

@router.get("/stock/finished-goods/{branch_id}")
def finished_goods_stock(branch_id: int, current_user: dict = Depends(get_current_user)):
    rows = inventory_db.get_finished_goods_balances(current_user["company_id"], branch_id)
    return success("Finished goods stock retrieved", stock=rows)


@router.get("/stock/{branch_id}")
def stock_balances(branch_id: int, current_user: dict = Depends(get_current_user)):
    rows = inventory_db.get_branch_stock_balances(current_user["company_id"], branch_id)
    return success("Stock balances retrieved", stock=rows)


# ---------------------------------------------------------------------------
# GRN — Goods Receipt Note
# ---------------------------------------------------------------------------

@router.post("/grn", status_code=201)
def create_grn(
    req: GRNRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
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
# Stock counts
# ---------------------------------------------------------------------------

@router.get("/stock-counts/with-purchases")
def stock_counts_with_purchases(
    branch_id: int | None = Query(None),
    limit: int = Query(200),
    current_user: dict = Depends(get_current_user),
):
    # FIX: uses a dedicated DB function that joins purchase data,
    # instead of calling the same list_stock_counts as the base route.
    rows = inventory_db.list_stock_counts_with_purchases(current_user["company_id"], branch_id, limit)
    return success("Stock counts retrieved", data=rows)


@router.get("/stock-counts")
def list_stock_counts(
    branch_id: int | None = Query(None),
    limit: int = Query(50),
    current_user: dict = Depends(get_current_user),
):
    rows = inventory_db.list_stock_counts(current_user["company_id"], branch_id, limit)
    return success("Stock counts retrieved", stock_counts=rows)


@router.post("/stock-counts", status_code=201)
def create_stock_count(
    req: StockCountRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
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


@router.post("/stock-issues", status_code=201)
def create_stock_issue(
    req: StockIssueRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
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
# Stock adjustments
# ---------------------------------------------------------------------------

@router.get("/stock-adjustments/by-branch")
def adjustments_by_branch(
    branch_id: int | None = Query(None),
    limit: int = Query(200),
    current_user: dict = Depends(get_current_user),
):
    # FIX: uses a dedicated DB function that groups/aggregates by branch,
    # instead of calling the same list_adjustments as the base route.
    rows = inventory_db.list_adjustments_by_branch(current_user["company_id"], branch_id, limit)
    return success("Adjustments retrieved", data=rows)


@router.get("/stock-adjustments")
def list_adjustments(
    branch_id: int | None = Query(None),
    limit: int = Query(50),
    current_user: dict = Depends(get_current_user),
):
    rows = inventory_db.list_adjustments(current_user["company_id"], branch_id, limit)
    return success("Stock adjustments retrieved", adjustments=rows)


@router.post("/stock-adjustments", status_code=201)
def create_adjustment(
    req: StockAdjustmentRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    check_period_open(str(req.entry_date), current_user)
    try:
        ingredient_id = req.ingredient_id or req.item_id
        if not ingredient_id:
            return error("ingredient_id or item_id is required", status=422)

        # FIX: quantity_delta and counted_quantity are semantically different fields.
        # quantity_delta is a signed delta (e.g. +10 or -5).
        # counted_quantity is an absolute physical count — silently using it as a
        # delta would post the wrong value. Require quantity_delta explicitly.
        if req.quantity_delta is None:
            return error("quantity_delta is required", status=422)

        row = inventory_db.add_adjustment(
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            branch_id=req.branch_id,
            ingredient_id=ingredient_id,
            entry_date=req.entry_date,
            quantity_delta=req.quantity_delta,
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
        return error("status must be 'approved' or 'rejected'", status=422)
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

@router.get("/opening-stock/by-branch")
def opening_stock_by_branch(
    branch_id: int | None = Query(None),
    limit: int = Query(200),
    current_user: dict = Depends(get_current_user),
):
    # FIX: uses a dedicated DB function that groups by branch,
    # instead of calling the same list_opening_stock as the base route.
    rows = inventory_db.list_opening_stock_by_branch(current_user["company_id"], branch_id, limit)
    return success("Opening stock retrieved", data=rows)


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

@router.get("/transfers/by-branch")
def transfers_by_branch(
    branch_id: int | None = Query(None),
    limit: int = Query(200),
    current_user: dict = Depends(get_current_user),
):
    # FIX: uses a dedicated DB function that groups/filters by branch,
    # instead of calling the same list_transfers as the base route.
    rows = inventory_db.list_transfers_by_branch(current_user["company_id"], branch_id, limit)
    return success("Transfers retrieved", data=rows)


@router.get("/transfers")
def list_transfers(
    branch_id: int | None = Query(None),
    limit: int = Query(50),
    current_user: dict = Depends(get_current_user),
):
    rows = inventory_db.list_transfers(current_user["company_id"], branch_id, limit)
    return success("Transfers retrieved", transfers=rows)


@router.post("/transfers", status_code=201)
def create_transfer(
    req: TransferRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
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

@router.get("/inventory-movements/by-branch")
def movements_by_branch(
    branch_id: int | None = Query(None),
    movement_type: str | None = Query(None),
    limit: int = Query(200),
    current_user: dict = Depends(get_current_user),
):
    # FIX: uses a dedicated DB function that groups/filters by branch,
    # instead of calling the same list_inventory_movements as the base route.
    rows = inventory_db.list_inventory_movements_by_branch(
        current_user["company_id"], branch_id, movement_type, limit
    )
    return success("Movements retrieved", data=rows)


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