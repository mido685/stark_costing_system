import csv
import io
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from app.api.responses import error, success
from app.database import reports as reports_db
from app.security.dependencies import get_current_user

router = APIRouter(tags=["reports"])


def _csv_response(filename: str, data: Any) -> StreamingResponse:
    output = io.StringIO()
    rows = data if isinstance(data, list) else [data]
    if rows:
        writer = csv.DictWriter(output, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/dashboard")
def dashboard(
    branch_id: str = Query(""),
    date_from: str = Query(""),
    date_to: str = Query(""),
    current_user: dict = Depends(get_current_user),
):
    data = reports_db.dashboard(
        company_id=current_user["company_id"],
        branch_id=int(branch_id) if branch_id else None,
        date_from=date_from,
        date_to=date_to,
    )
    return success("Dashboard retrieved", dashboard=data)


@router.get("/kpi/{branch_id}/{period}")
def kpi(
    branch_id: int,
    period: str,
    current_user: dict = Depends(get_current_user),
):
    try:
        data = reports_db.compute_kpis(branch_id, period, current_user["company_id"])
        return success("KPI computed", kpi=data)
    except ValueError as e:
        return error(str(e), status=404)


@router.get("/reports/pl")
def pl_report(
    branch_id: int = Query(...),
    period: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    try:
        report = reports_db.get_pl_report(branch_id, period, current_user["company_id"])
        return success("P&L report retrieved", report=report)
    except ValueError as e:
        return error(str(e), status=404)


@router.get("/reports/food-cost-trend")
def food_cost_trend(
    branch_id: int = Query(...),
    months: int = Query(6, ge=1, le=24),
    period: str = Query(""),
    current_user: dict = Depends(get_current_user),
):
    if period:
        reports_db.compute_kpis(branch_id, period, current_user["company_id"])
    trend = reports_db.get_food_cost_trend(branch_id, months, current_user["company_id"])
    return success("Food cost trend retrieved", trend=trend)


@router.get("/reports/variance-recipe")
def variance_report_recipe(
    branch_id: int = Query(...),
    period: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    rows = reports_db.get_variance_report(branch_id, period, current_user["company_id"])
    return success("Variance report retrieved", variance=rows)


@router.get("/reports/variance")
def variance_report_legacy(
    branch_id: int | None = Query(None),
    date_from: str = Query(""),
    date_to: str = Query(""),
    current_user: dict = Depends(get_current_user),
):
    rows = reports_db.get_variance_legacy(
        company_id=current_user["company_id"],
        branch_id=branch_id,
        date_from=date_from,
        date_to=date_to,
    )
    return success("Variance report retrieved", variance=rows)


@router.get("/audit-log")
def audit_log(
    branch_id: int | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
):
    rows = reports_db.list_audit_log(current_user["company_id"], branch_id, limit)
    return success("Audit log retrieved", audit_log=rows)


@router.get("/export")
def export_report(
    branch_id: int = Query(...),
    date_from: str = Query(""),
    date_to: str = Query(""),
    format: str = Query("csv"),
    current_user: dict = Depends(get_current_user),
):
    rows = reports_db.get_sales_export_rows(
        company_id=current_user["company_id"],
        branch_id=branch_id,
        date_from=date_from,
        date_to=date_to,
    )
    return _csv_response(f"sales_report_{branch_id}_{date_from or 'all'}.csv", rows)
    
@router.get("/reports/{report_type}")
def get_report(
    report_type: str,
    branch_id: int | None = Query(None),
    period: str = Query(""),
    fmt: str = Query("json"),
    format: str = Query(""),
    current_user: dict = Depends(get_current_user),
):
    company_id = current_user["company_id"]
    output_fmt = format or fmt or "json"

    if report_type == "dashboard":
        summary, rows = reports_db.get_dashboard_rows(company_id, branch_id)
        data = {"summary": summary, "branches": rows}
    elif report_type == "product-costs":
        data = reports_db.get_product_cost_rows(company_id, branch_id)
    elif report_type == "kpi":
        if not branch_id or not period:
            return error("branch_id and period (YYYY-MM) are required")
        data = reports_db.compute_kpis(branch_id, period, company_id)
    elif report_type == "branch-compare":
        if not period:
            return error("period (YYYY-MM) is required")
        data = reports_db.compare_branches_by_period(company_id, period)
    elif report_type == "menu":
        data = reports_db.get_menu_engineering(company_id, branch_id)
    elif report_type == "waste-summary":
        data = reports_db.get_waste_summary(company_id, branch_id)
    elif report_type == "stock":
        if not branch_id:
            return error("branch_id is required")
        data = reports_db.get_branch_stock_balances(company_id, branch_id)
    elif report_type == "budget":
        if not branch_id or not period:
            return error("branch_id and period (YYYY-MM) are required")
        data = reports_db.get_budget_vs_actual(company_id, branch_id, period)
    else:
        return error(f"Unknown report type: {report_type}", status=404)

    if output_fmt == "csv":
        return _csv_response(f"{report_type}.csv", data)
    return success("Report retrieved", report=data)
