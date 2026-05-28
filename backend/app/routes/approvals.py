from fastapi import APIRouter, Depends, Query, Request
from app.api.responses import error, success
from app.database.connection import dict_cursor, get_connection
from app.security.dependencies import get_current_user, require_roles

router = APIRouter(tags=["approvals"])


@router.get("/approvals/pending")
def pending_approvals(current_user: dict = Depends(get_current_user)):
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT
                ar.id,
                ar.entity_type,
                ar.entity_id,
                ar.branch_id,
                ar.status,
                ar.requested_by,
                ar.requested_at,
                ar.approved_by,
                ar.approved_at,
                b.name              AS branch_name,
                u.display_name      AS submitted_by,
                -- Purchase details (joined when entity_type = 'purchase')
                p.quantity          AS quantity,
                p.unit_cost         AS unit_cost,
                p.gross_amount      AS amount,
                p.tax_amount        AS tax_amount,
                p.payable_amount    AS payable_amount,
                p.entry_date        AS entry_date,
                p.notes             AS notes,
                s.name              AS supplier_name,
                s.phone             AS supplier_phone,
                i.name              AS ingredient_name,
                i.unit              AS unit
            FROM approval_requests ar
            LEFT JOIN branches    b ON b.id = ar.branch_id
            LEFT JOIN app_users   u ON u.id = ar.requested_by
            -- Join purchase data only when entity_type = 'purchase'
            LEFT JOIN purchases   p ON ar.entity_type = 'purchase'
                                    AND ar.entity_id = p.id
            LEFT JOIN suppliers   s ON s.id = p.supplier_id
            LEFT JOIN ingredients i ON i.id = p.ingredient_id
            WHERE (b.company_id = %s OR ar.branch_id IS NULL)
              AND ar.status = 'pending'
            ORDER BY ar.requested_at DESC
        """, (current_user["company_id"],))
        return success("Pending approvals retrieved",
                       approvals=[dict(r) for r in cur.fetchall()])
    finally:
        cur.close()
        conn.close()


@router.get("/approvals/history")
def approvals_history(
    branch_id: int | None = Query(None),
    entity_type: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    current_user: dict = Depends(get_current_user),
):
    """Full approval history — all statuses with rich PO details."""
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        where = ["(b.company_id = %s OR ar.branch_id IS NULL)"]
        params: list = [current_user["company_id"]]
        if branch_id:
            where.append("ar.branch_id = %s")
            params.append(branch_id)
        if entity_type:
            where.append("ar.entity_type = %s")
            params.append(entity_type)
        if status:
            where.append("ar.status = %s")
            params.append(status)
        params.append(limit)

        cur.execute(f"""
            SELECT
                ar.id,
                ar.entity_type,
                ar.entity_id,
                ar.branch_id,
                ar.status,
                ar.requested_at,
                ar.approved_at,
                b.name              AS branch_name,
                u.display_name      AS submitted_by,
                ab.display_name     AS approved_by_name,
                p.quantity,
                p.unit_cost,
                p.gross_amount      AS amount,
                p.tax_amount,
                p.payable_amount,
                p.entry_date,
                p.notes,
                s.name              AS supplier_name,
                s.phone             AS supplier_phone,
                i.name              AS ingredient_name,
                i.unit
            FROM approval_requests ar
            LEFT JOIN branches    b  ON b.id  = ar.branch_id
            LEFT JOIN app_users   u  ON u.id  = ar.requested_by
            LEFT JOIN app_users   ab ON ab.id = ar.approved_by
            LEFT JOIN purchases   p  ON ar.entity_type = 'purchase'
                                     AND ar.entity_id = p.id
            LEFT JOIN suppliers   s  ON s.id = p.supplier_id
            LEFT JOIN ingredients i  ON i.id = p.ingredient_id
            WHERE {" AND ".join(where)}
            ORDER BY ar.requested_at DESC
            LIMIT %s
        """, params)
        return success("Approval history retrieved",
                       approvals=[dict(r) for r in cur.fetchall()])
    finally:
        cur.close()
        conn.close()


@router.post("/approvals/{request_id}/approve")
def approve_request(
    request_id: int,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    return _set_approval_status(request_id, "approved", request.client.host, current_user)


@router.post("/approvals/{request_id}/reject")
def reject_request(
    request_id: int,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    return _set_approval_status(request_id, "rejected", request.client.host, current_user)


@router.get("/governance/history")
def governance_history(
    branch_id: int | None = Query(None),
    action: str | None = Query(None),
    current_user: dict = Depends(get_current_user),
):
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        where = ["(b.company_id = %s OR gal.branch_id IS NULL)"]
        params: list = [current_user["company_id"]]
        if branch_id:
            where.append("gal.branch_id = %s")
            params.append(branch_id)
        if action:
            where.append("gal.action = %s")
            params.append(action)

        cur.execute(f"""
            SELECT
                gal.*,
                b.name              AS branch_name,
                u.display_name      AS actor_name,
                -- Enrich with purchase details when available
                p.quantity,
                p.unit_cost,
                p.gross_amount      AS po_amount,
                p.tax_amount,
                p.payable_amount,
                p.entry_date        AS po_date,
                s.name              AS supplier_name,
                i.name              AS ingredient_name,
                i.unit,
                sub.display_name    AS submitter_name
            FROM governance_action_log gal
            LEFT JOIN branches    b   ON b.id  = gal.branch_id
            LEFT JOIN app_users   u   ON u.id  = gal.actor_id
            LEFT JOIN purchases   p   ON gal.entity_type = 'purchase'
                                      AND gal.item_id::integer = p.id
            LEFT JOIN suppliers   s   ON s.id = p.supplier_id
            LEFT JOIN ingredients i   ON i.id = p.ingredient_id
            LEFT JOIN approval_requests ar
                                      ON gal.entity_type = ar.entity_type
                                      AND gal.item_id::integer = ar.entity_id
            LEFT JOIN app_users   sub ON sub.id = ar.requested_by
            WHERE {" AND ".join(where)}
            ORDER BY gal.action_date DESC
            LIMIT 500
        """, params)
        return success("Governance history retrieved",
                       history=[dict(r) for r in cur.fetchall()])
    finally:
        cur.close()
        conn.close()


def _set_approval_status(
    request_id: int, status: str, ip_address: str | None, current_user: dict
):
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        # ── Fetch approval request with full purchase details ─────────────────
        cur.execute("""
            SELECT
                ar.*,
                b.company_id,
                b.name          AS branch_name,
                u.display_name  AS submitted_by,
                p.gross_amount,
                p.payable_amount,
                p.quantity,
                p.unit_cost,
                p.ingredient_id,
                p.supplier_id,
                s.name          AS supplier_name,
                i.name          AS ingredient_name
            FROM approval_requests ar
            LEFT JOIN branches    b ON b.id  = ar.branch_id
            LEFT JOIN app_users   u ON u.id  = ar.requested_by
            LEFT JOIN purchases   p ON ar.entity_type = 'purchase'
                                    AND ar.entity_id = p.id
            LEFT JOIN suppliers   s ON s.id = p.supplier_id
            LEFT JOIN ingredients i ON i.id = p.ingredient_id
            WHERE ar.id = %s
        """, (request_id,))
        old = cur.fetchone()

        if not old or (
            old["company_id"] is not None
            and old["company_id"] != current_user["company_id"]
        ):
            return error("Approval request not found", status=404)

        # ── Update approval_requests ──────────────────────────────────────────
        cur.execute("""
            UPDATE approval_requests
            SET status = %s, approved_by = %s, approved_at = NOW()
            WHERE id = %s
            RETURNING *
        """, (status, current_user["id"], request_id))
        row = dict(cur.fetchone())

        # ── Sync status back to the source table ──────────────────────────────
        if old["entity_type"] == "purchase":
            cur.execute("""
                UPDATE purchases SET status = %s WHERE id = %s
            """, (status, old["entity_id"]))

        elif old["entity_type"] == "transfer":
            cur.execute("""
                UPDATE transfers SET status = %s WHERE id = %s
            """, (status, old["entity_id"]))

        elif old["entity_type"] == "expense":
            cur.execute("""
                UPDATE expenses SET status = %s WHERE id = %s
            """, (status, old["entity_id"]))

        # ── Write rich governance log entry ───────────────────────────────────
        description = (
            f"{status.title()} purchase of {old.get('ingredient_name') or 'item'} "
            f"from {old.get('supplier_name') or 'supplier'} "
            f"— {old.get('quantity') or ''} units @ {old.get('unit_cost') or ''} "
            f"(payable: {old.get('payable_amount') or old.get('gross_amount') or ''})"
            if old["entity_type"] == "purchase"
            else f"{status.title()} {old['entity_type']} #{old['entity_id']}"
        )

        cur.execute("""
            INSERT INTO governance_action_log
                (item_id, entity_type, description, submitted_by, original_date,
                 action, amount, currency, from_procurement,
                 actor_id, branch_id)
            VALUES (%s, %s, %s, %s, NOW(), %s, %s, %s, %s, %s, %s)
        """, (
            str(old["entity_id"]),
            old["entity_type"],
            description,
            old.get("submitted_by") or current_user.get("username"),
            "approve" if status == "approved" else "reject",
            float(old["payable_amount"] or old["gross_amount"] or 0)
            if old["entity_type"] == "purchase" else None,
            None,  # currency — add if you store it
            old["entity_type"] == "purchase",
            current_user["id"],
            old["branch_id"],
        ))

        conn.commit()
        return success(f"Approval {status}", approval=row)

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()