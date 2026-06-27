import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response

from app.api.responses import success, error
from app.database import cash_purchases as cash_db
from app.schemas import CashPurchaseRequest, ExpenseCategoryRequest, PettyCashTopUpRequest
from app.security.dependencies import get_current_user, require_roles, check_period_open

router = APIRouter(tags=["cash_purchases"])

BASE_DIR = Path(__file__).resolve().parent.parent.parent
INVOICE_DIR = BASE_DIR / "uploads" / "invoices"
ALLOWED_MIME = {"image/jpeg", "image/png", "application/pdf"}
MIME_TO_EXT = {"image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf"}
MAX_SIZE_MB = 10
ALLOWED_REF_TABLES = {"cash_purchases", "expenses", "inventory_movements"}


# ── Cash Purchases ────────────────────────────────────────────────────────────

@router.get("/cash-purchases")
def list_cash_purchases(
    branch_id: int | None = Query(None),
    purchase_type: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    purchases = cash_db.list_cash_purchases(
        company_id=current_user["company_id"],
        branch_id=branch_id,
        purchase_type=purchase_type,
        limit=limit,
    )
    return success("Cash purchases retrieved", cash_purchases=purchases)


@router.get("/cash-purchases/{purchase_id}")
def get_cash_purchase(
    purchase_id: int,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    purchase = cash_db.get_cash_purchase(
        purchase_id=purchase_id,
        company_id=current_user["company_id"],
    )
    if not purchase:
        return error("Cash purchase not found", status=404)
    return success("Cash purchase retrieved", cash_purchase=purchase)


@router.post("/cash-purchases", status_code=201)
def create_cash_purchase(
    req: CashPurchaseRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    check_period_open(req.entry_date, current_user)
    try:
        purchase = cash_db.add_cash_purchase(
            branch_id=req.branch_id,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            supplier_id=req.supplier_id,
            ingredient_id=req.ingredient_id,
            category_id=req.category_id,
            entry_date=req.entry_date,
            quantity=req.quantity,
            unit_cost=req.unit_cost,
            purchase_type=req.purchase_type,
            tax_amount=req.tax_amount,
            payable_amount=req.payable_amount,
            petty_cash_used=req.petty_cash_used,
            notes=req.notes,
            status="pending",
            ip_address=request.client.host,
        )
        return success("Cash purchase recorded", cash_purchase=purchase)
    except ValueError as e:
        return error(str(e))


@router.post("/cash-purchases/{purchase_id}/approve")
def approve_cash_purchase(
    purchase_id: int,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    try:
        purchase = cash_db.approve_cash_purchase(
            purchase_id=purchase_id,
            company_id=current_user["company_id"],
            approved_by=current_user["id"],
            ip_address=request.client.host,
        )
        return success("Cash purchase approved", cash_purchase=purchase)
    except ValueError as e:
        status_code = 404 if "not found" in str(e).lower() else 409
        return error(str(e), status=status_code)


# ── Petty Cash ────────────────────────────────────────────────────────────────

@router.get("/petty-cash/balance")
def get_petty_cash_balance(
    branch_id: int = Query(...),
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    balance = cash_db.get_petty_cash_balance(
        company_id=current_user["company_id"],
        branch_id=branch_id,
    )
    return success("Petty cash balance retrieved", branch_id=branch_id, balance=balance)


@router.post("/petty-cash/top-up", status_code=201)
def top_up_petty_cash(
    req: PettyCashTopUpRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    check_period_open(req.entry_date, current_user)
    try:
        new_balance = cash_db.top_up_petty_cash(
            company_id=current_user["company_id"],
            branch_id=req.branch_id,
            amount=req.amount,
            entry_date=req.entry_date,
            notes=req.notes,
            user_id=current_user["id"],
            ip_address=request.client.host,
        )
        return success("Petty cash topped up", new_balance=new_balance, added=req.amount)
    except ValueError as e:
        return error(str(e))


@router.get("/petty-cash/ledger")
def list_petty_cash_ledger(
    branch_id: int = Query(...),
    limit: int = Query(50, ge=1, le=500),
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    ledger = cash_db.list_petty_cash_ledger(
        company_id=current_user["company_id"],
        branch_id=branch_id,
        limit=limit,
    )
    return success("Petty cash ledger retrieved", ledger=ledger)


# ── Expense Categories ────────────────────────────────────────────────────────

@router.get("/expense-categories")
def list_expense_categories(
    category_type: str | None = Query(None),
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    categories = cash_db.list_expense_categories(
        company_id=current_user["company_id"],
        category_type=category_type,
    )
    return success("Expense categories retrieved", categories=categories)


@router.post("/expense-categories", status_code=201)
def create_expense_category(
    req: ExpenseCategoryRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    try:
        category = cash_db.add_expense_category(
            company_id=current_user["company_id"],
            name=req.name,
            category_type=req.type,
            user_id=current_user["id"],
            ip_address=request.client.host,
        )
        return success("Expense category created", category=category)
    except ValueError as e:
        return error(str(e))


# ── Invoices ──────────────────────────────────────────────────────────────────
# IMPORTANT: /invoices/search and /invoices/file/{invoice_id} must be declared
# BEFORE /invoices/{ref_table}/{ref_id}, otherwise FastAPI matches the wildcard
# route first and these endpoints become unreachable.

@router.get("/invoices/search")
def search_invoices(
    ref_table:      str | None = Query(None),
    branch_id:      int | None = Query(None),
    supplier_id:    int | None = Query(None),
    invoice_number: str | None = Query(None),
    date_from:      str | None = Query(None),
    date_to:        str | None = Query(None),
    limit:          int        = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
):
    invoices = cash_db.search_invoices(
        company_id=current_user["company_id"],
        ref_table=ref_table,
        branch_id=branch_id,
        supplier_id=supplier_id,
        invoice_number=invoice_number,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
    )
    return success("Invoices retrieved", invoices=invoices)


@router.get("/invoices/file/{invoice_id}")
def download_invoice(
    invoice_id: int,
    current_user: dict = Depends(get_current_user),
):
    invoice = cash_db.get_invoice(
        company_id=current_user["company_id"],
        invoice_id=invoice_id,
    )
    if not invoice:
        return error("Invoice not found", status=404)

    file_path = Path(invoice["file_path"])
    if not file_path.exists():
        return error("Invoice file is missing from storage", status=500)

    content = file_path.read_bytes()
    return Response(
        content=content,
        media_type=invoice["mime_type"],
        headers={
            "Content-Disposition": f'attachment; filename="{invoice["file_name"]}"',
            "Content-Length": str(len(content)),
        },
    )


@router.get("/invoices/{ref_table}/{ref_id}")
def list_invoices(
    ref_table: str,
    ref_id: int,
    current_user: dict = Depends(get_current_user),
):
    invoices = cash_db.list_invoices(
        company_id=current_user["company_id"],
        ref_table=ref_table,
        ref_id=ref_id,
    )
    return success("Invoices retrieved", invoices=invoices)


@router.post("/invoices/upload", status_code=201)
async def upload_invoice(
    ref_table:      str          = Form(...),
    ref_id:         int          = Form(...),
    notes:          str          = Form(""),
    invoice_number: str          = Form(""),
    invoice_date:   str          = Form(""),
    amount:         float | None = Form(None),
    supplier_id:    int | None   = Form(None),
    branch_id:      int | None   = Form(None),
    file: UploadFile = File(...),
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    if ref_table not in ALLOWED_REF_TABLES:
        return error("Invalid reference table")
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, and PDF files are allowed")

    content = await file.read()
    size_kb = len(content) // 1024
    if size_kb > MAX_SIZE_MB * 1024:
        return error(f"File exceeds {MAX_SIZE_MB} MB limit")

    company_id = current_user["company_id"]
    ext = MIME_TO_EXT[file.content_type]
    dest_dir = INVOICE_DIR / str(company_id) / ref_table / str(ref_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    file_path = dest_dir / f"{uuid.uuid4().hex}.{ext}"
    file_path.write_bytes(content)

    try:
        invoice_id = cash_db.save_invoice_record(
            company_id=company_id,
            ref_table=ref_table,
            ref_id=ref_id,
            file_name=file.filename or file_path.name,
            file_path=str(file_path),
            mime_type=file.content_type,
            file_size_kb=size_kb,
            notes=notes,
            user_id=current_user["id"],
            supplier_id=supplier_id or None,
            invoice_number=invoice_number or None,
            invoice_date=invoice_date or None,
            amount=amount,
            branch_id=branch_id or None,
        )
    except Exception as e:
        file_path.unlink(missing_ok=True)
        return error(f"Invoice record could not be saved: {e}")

    return success(
        "Invoice uploaded",
        invoice_id=invoice_id,
        file_name=file.filename,
        size_kb=size_kb,
    )