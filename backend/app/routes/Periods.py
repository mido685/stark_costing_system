# app/routes/periods.py
"""
Period management routes.

All write operations require manager or admin role.
Read operations are available to all authenticated users.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.database.periods import (
    get_period_status,
    set_period_status,
    list_period_statuses,
    list_period_history,
    is_period_frozen,
    run_pre_close_validation,
)
from app.security.dependencies import get_current_user, require_roles
from app.api.responses import error, success

router = APIRouter(prefix="/period", tags=["periods"])


# ─── GET /api/period/status?period=YYYY-MM ────────────────────────────────────

@router.get("/status")
def get_status(
    period: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    current_user: dict = Depends(get_current_user),
):
    """
    Return the current status row for a period.
    Falls back to {"status": "open"} if never touched.
    """
    company_id = current_user["company_id"]
    row = get_period_status(company_id, period)
    return success("Period status fetched", **row)


# ─── POST /api/period/status ──────────────────────────────────────────────────

@router.post("/status")
def set_status(
    body: dict,
    current_user: dict = Depends(require_roles("manager", "admin")),
):
    """
    Transition a period to a new status.
    Body: { period, status, notes? }

    State machine (enforced in DB layer):
      open → closed
      closed → open | locked
      locked → (terminal — no transitions allowed)
    """
    company_id = current_user["company_id"]
    user_id    = current_user["id"]
    user_role  = current_user["role"]

    period     = body.get("period")
    new_status = body.get("status")
    notes      = body.get("notes", "")

    if not period or not new_status:
        return error("period and status are required", status=400)

    if new_status not in ("open", "closed", "locked"):
        return error("status must be open, closed, or locked", status=400)

    try:
        row = set_period_status(
            company_id=company_id,
            period=period,
            new_status=new_status,
            user_id=user_id,
            user_role=user_role,
            note=notes or None,
        )
        return success("Period status updated", **row)
    except PermissionError as e:
        return error(str(e), status=403)
    except ValueError as e:
        return error(str(e), status=422)


# ─── GET /api/period/history?period=YYYY-MM ───────────────────────────────────

@router.get("/history")
def get_history(
    period: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    current_user: dict = Depends(get_current_user),
):
    """
    Return the full audit trail for a single period —
    every status transition, who made it, when, and why.
    Ordered oldest → newest.
    """
    company_id = current_user["company_id"]
    rows = list_period_history(company_id, period)
    return success("Period history fetched", history=rows)


# ─── GET /api/period/list ─────────────────────────────────────────────────────

@router.get("/list")
def get_list(
    limit:  int = Query(24, ge=1, le=60),
    offset: int = Query(0,  ge=0),
    current_user: dict = Depends(get_current_user),
):
    """
    Return all period statuses for this company, newest first.
    Default limit of 24 = 2 years of months.
    Frontend uses this to populate the "Past periods" tab.
    """
    company_id = current_user["company_id"]
    rows = list_period_statuses(company_id, limit=limit, offset=offset)
    return success("Period list fetched", periods=rows)


# ─── GET /api/period/is-closed?branch_id=&entry_date= ────────────────────────

@router.get("/is-closed")
def check_is_closed(
    branch_id:  int = Query(...),
    entry_date: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    """
    Quick frozen-check used by the frontend before showing write forms.
    Returns is_closed (bool) + current status string.
    """
    period = entry_date[:7]
    company_id = current_user["company_id"]
    frozen = is_period_frozen(company_id, entry_date)
    row = get_period_status(company_id, period)
    status = row.get("status", "open")
    return success(
        "Period closure checked",
        is_closed=frozen,
        is_locked=status == "locked",
        status=status,
    )

@router.get("/validate")
def validate_period(
    period: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    current_user: dict = Depends(get_current_user),
):
    try:
        run_pre_close_validation(current_user["company_id"], period)
        return success("All pre-close checks passed", checks_passed=True)
    except ValueError as e:
        return error(str(e), status=422)