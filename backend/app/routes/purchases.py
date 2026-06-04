import io
from datetime import date

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response

from app.api.responses import success, error
from app.database import purchases as purchases_db
from app.schemas import PurchaseRequest, PurchaseReturnRequest
from app.security.dependencies import get_current_user, require_roles, check_period_open

router = APIRouter(prefix="/purchases", tags=["purchases"])


@router.get("")
def list_purchases(
    branch_id: int | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
):
    purchases = purchases_db.list_purchases(
        company_id=current_user["company_id"],
        branch_id=branch_id,
        limit=limit,
    )
    return success("Purchases retrieved", purchases=purchases)


@router.get("/by-branch")
def purchases_by_branch(
    branch_id: int | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
):
    purchases = purchases_db.list_purchases(
        company_id=current_user["company_id"],
        branch_id=branch_id,
        status="approved",
        limit=limit,
    )
    return success("Approved purchases retrieved", purchases=purchases)


@router.get("/{purchase_id}")
def get_purchase(
    purchase_id: int,
    current_user: dict = Depends(get_current_user),
):
    purchase = purchases_db.get_purchase(purchase_id, current_user["company_id"])
    if not purchase:
        return error("Purchase not found", status=404)
    return success("Purchase retrieved", purchase=purchase)


@router.post("")
def create_purchase(
    req: PurchaseRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    check_period_open(req.entry_date, current_user)
    ingredient_id = req.ingredient_id or req.item_id
    if not ingredient_id:
        return error("ingredient_id or item_id is required")
    try:
        purchase = purchases_db.add_purchase(
            branch_id=req.branch_id,
            supplier_id=req.supplier_id,
            ingredient_id=ingredient_id,
            entry_date=req.entry_date,
            quantity=req.quantity,
            unit_cost=req.unit_cost,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            tax_amount=req.tax_amount,
            payable_amount=req.payable_amount,
            notes=req.notes,
            status="pending",          # ← always force pending, ignore req.status
            ip_address=request.client.host,
        )

        # ── Register in approval queue ────────────────────────────────────
        from app.database.connection import get_connection, dict_cursor
        conn = get_connection()
        cur = dict_cursor(conn)
        try:
            cur.execute("""
                INSERT INTO approval_requests
                    (entity_type, entity_id, branch_id, requested_by, status)
                VALUES ('purchase', %s, %s, %s, 'pending')
            """, (purchase["id"], req.branch_id, current_user["id"]))
            conn.commit()
        finally:
            cur.close()
            conn.close()

        return success("Purchase recorded", purchase=purchase)
    except ValueError as e:
        return error(str(e))


@router.post("/returns")
def create_purchase_return(
    req: PurchaseReturnRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    check_period_open(req.entry_date, current_user)
    ingredient_id = req.ingredient_id or req.item_id
    if not ingredient_id:
        return error("ingredient_id or item_id is required")
    try:
        purchase_return = purchases_db.add_purchase_return(
            branch_id=req.branch_id,
            supplier_id=req.supplier_id,
            ingredient_id=ingredient_id,
            entry_date=req.entry_date,
            quantity=req.quantity,
            unit_cost=req.unit_cost,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            refund_amount=req.refund_amount,
            notes=req.notes,
            status=req.status,
            ip_address=request.client.host,
        )
        return success("Purchase return recorded", purchase_return=purchase_return)
    except ValueError as e:
        return error(str(e))
@router.options("/{purchase_id}/pdf")
def pdf_options(purchase_id: int):
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": "https://stark-costing-system.vercel.app",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, ngrok-skip-browser-warning, Content-Type",
            "Access-Control-Allow-Credentials": "true",
        },
    )


@router.get("/{purchase_id}/pdf")
def export_purchase_pdf(
    purchase_id: int,
    current_user: dict = Depends(get_current_user),
):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import cm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    purchase = purchases_db.get_purchase(purchase_id, current_user["company_id"])
    if not purchase:
        return error("Purchase order not found", status=404)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=2 * cm,
        leftMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
    )
    styles = getSampleStyleSheet()
    elements = []

    elements.append(Paragraph("STARK AI - Purchase Order", styles["Title"]))
    elements.append(Spacer(1, 0.4 * cm))
    elements.append(Paragraph(
        f"<b>PO #:</b> {purchase['id']} &nbsp;&nbsp; "
        f"<b>Date:</b> {purchase['entry_date']} &nbsp;&nbsp; "
        f"<b>Status:</b> {str(purchase.get('status', '')).upper()}",
        styles["Normal"],
    ))
    elements.append(Spacer(1, 0.6 * cm))

    info_table = Table([
        ["Branch", purchase.get("branch_name") or "-"],
        ["Supplier", purchase.get("supplier_name") or "-"],
        ["Phone", purchase.get("supplier_phone") or "-"],
        ["Notes", purchase.get("notes") or "-"],
    ], colWidths=[4 * cm, 13 * cm])
    info_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#374151")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 0.8 * cm))

    qty = float(purchase.get("quantity") or 0)
    unit_cost = float(purchase.get("unit_cost") or 0)
    gross = qty * unit_cost
    tax = float(purchase.get("tax_amount") or 0)
    payable = float(purchase.get("payable_amount") or gross + tax)

    items_table = Table([
        ["Item", "Unit", "Qty", "Unit Cost", "Gross Amount"],
        [
            purchase.get("ingredient_name") or "-",
            purchase.get("unit") or "-",
            f"{qty:,.3f}",
            f"{unit_cost:,.2f}",
            f"{gross:,.2f}",
        ],
    ], colWidths=[6 * cm, 2.5 * cm, 2.5 * cm, 3 * cm, 3 * cm])
    items_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a5f")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e5e7eb")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
    ]))
    elements.append(items_table)
    elements.append(Spacer(1, 0.4 * cm))

    totals_table = Table([
        ["", "Gross Amount:", f"{gross:,.2f}"],
        ["", "Tax:", f"{tax:,.2f}"],
        ["", "Total Payable:", f"{payable:,.2f}"],
    ], colWidths=[9 * cm, 4 * cm, 4 * cm])
    totals_table.setStyle(TableStyle([
        ("FONTNAME", (1, -1), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("LINEABOVE", (1, -1), (-1, -1), 0.8, colors.HexColor("#1e3a5f")),
        ("TEXTCOLOR", (1, -1), (-1, -1), colors.HexColor("#1e3a5f")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(totals_table)
    elements.append(Spacer(1, 1 * cm))
    elements.append(Paragraph(
        f"Generated by STARK AI Costing Platform - {date.today().isoformat()}",
        styles["Normal"],
    ))
    doc.build(elements)
    pdf_bytes = buffer.getvalue()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="PO-{purchase_id}.pdf"',
            "Content-Length": str(len(pdf_bytes)),
            "Access-Control-Allow-Origin": "https://stark-costing-system.vercel.app",
            "Access-Control-Allow-Credentials": "true",
        },
    )
