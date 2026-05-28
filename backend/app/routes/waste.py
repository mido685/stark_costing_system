from fastapi import APIRouter, Request, Depends, Query

from app.api.responses import success, error
from app.database import waste as waste_db
from app.schemas import WasteRequest
from app.security.dependencies import get_current_user, require_roles, check_period_open

router = APIRouter(prefix="/waste", tags=["waste"])


@router.get("")
def list_waste(
    branch_id: int | None = Query(None),
    limit: int = Query(50),
    current_user: dict = Depends(get_current_user),
):
    waste = waste_db.list_waste(
        company_id=current_user["company_id"],
        branch_id=branch_id,
        limit=limit,
    )
    return success("Waste retrieved", waste=waste)


@router.get("/summary")
def waste_summary(
    branch_id: int | None = Query(None),
    current_user: dict = Depends(get_current_user),
):
    from app.database.connection import dict_cursor, get_connection

    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        params: list = [current_user["company_id"]]
        branch_filter = ""
        if branch_id:
            branch_filter = "AND x.branch_id = %s"
            params.append(branch_id)
        cur.execute(f"""
            SELECT
                x.reason,
                SUM(x.quantity) AS total_quantity,
                SUM(x.cost_value) AS total_cost,
                COUNT(*) AS entries
            FROM (
                SELECT w.branch_id, w.reason, w.quantity, w.cost_value
                FROM waste_log w
                JOIN branches b ON b.id = w.branch_id
                WHERE b.company_id = %s
                UNION ALL
                SELECT d.branch_id, d.reason, d.quantity, d.cost_value
                FROM damage_log d
                JOIN branches b ON b.id = d.branch_id
                WHERE b.company_id = %s
            ) x
            WHERE 1 = 1 {branch_filter}
            GROUP BY x.reason
            ORDER BY total_cost DESC
        """, [current_user["company_id"], current_user["company_id"]] + ([branch_id] if branch_id else []))
        return success("Waste summary retrieved", summary=[dict(r) for r in cur.fetchall()])
    finally:
        cur.close()
        conn.close()


@router.get("/{waste_id}")
def get_waste(
    waste_id: int,
    current_user: dict = Depends(get_current_user),
):
    waste = waste_db.get_waste(waste_id, current_user["company_id"])
    if not waste:
        return error("Waste record not found", status=404)
    return success("Waste retrieved", waste=waste)


@router.post("")
def create_waste(
    req: WasteRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    check_period_open(req.entry_date, current_user)
    try:
        ingredient_id = req.ingredient_id
        product_id = req.product_id
        if req.item_id and not ingredient_id and not product_id:
            product_id = req.item_id
        waste = waste_db.add_waste(
            branch_id=req.branch_id,
            entry_date=req.entry_date,
            quantity=req.quantity,
            reason=req.reason,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            ingredient_id=ingredient_id,
            product_id=product_id,
            notes=req.notes,
            ip_address=request.client.host,
        )
        return success("Waste recorded", waste=waste)
    except ValueError as e:
        return error(str(e))


@router.delete("/{waste_id}")
def delete_waste(
    waste_id: int,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin")),
):
    try:
        waste_db.delete_waste(
            waste_id=waste_id,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            ip_address=request.client.host,
        )
        return success("Waste deleted")
    except ValueError as e:
        return error(str(e))
