from fastapi import APIRouter, Depends, Query, Request
from app.api.responses import error, success
from app.database.connection import dict_cursor, get_connection
from app.security.dependencies import get_current_user, require_roles

router = APIRouter(tags=["approvals"])


# ─────────────────────────────────────────────────────────────────────────────
# PENDING APPROVALS
# ─────────────────────────────────────────────────────────────────────────────
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
            LEFT JOIN branches      b        ON b.id       = ar.branch_id
            LEFT JOIN app_users     u        ON u.id       = ar.requested_by
            LEFT JOIN purchases     p        ON ar.entity_type = 'purchase'
                                             AND ar.entity_id = p.id
            LEFT JOIN branches      p_branch ON p_branch.id = p.branch_id
            LEFT JOIN suppliers     s        ON s.id       = p.supplier_id
            LEFT JOIN ingredients   i        ON i.id       = p.ingredient_id
            LEFT JOIN supplier_price_history sph ON ar.entity_type = 'price_history'
                                                 AND ar.entity_id = sph.id
            LEFT JOIN suppliers     sph_s ON sph_s.id = sph.supplier_id
            LEFT JOIN ingredients   sph_i ON sph_i.id = sph.ingredient_id
            COALESCE(s.name,     sph_s.name) AS supplier_name,
                COALESCE(i.name,     sph_i.name) AS ingredient_name,
                COALESCE(i.unit,     sph_i.unit) AS unit,
                sph.price           AS unit_cost,
                sph.price_type      AS price_type,
            WHERE (b.company_id = %s OR p_branch.company_id = %s OR (
                ar.entity_type = 'price_history'
                AND ar.branch_id IS NULL
                AND %s IN (
                    SELECT company_id FROM supplier_price_history
                    WHERE id = ar.entity_id
                )
            ))
              AND ar.status = 'pending'
            ORDER BY ar.requested_at DESC
        """, (current_user["company_id"], current_user["company_id"], current_user["company_id"]))
        return success("Pending approvals retrieved",
                       approvals=[dict(r) for r in cur.fetchall()])
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# APPROVAL HISTORY
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/approvals/history")
def approvals_history(
    branch_id: int | None = Query(None),
    entity_type: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    current_user: dict = Depends(get_current_user),
):
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        where = ["(b.company_id = %s OR p_branch.company_id = %s)"]
        params: list = [current_user["company_id"], current_user["company_id"]]

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
            LEFT JOIN branches      b        ON b.id       = ar.branch_id
            LEFT JOIN app_users     u        ON u.id       = ar.requested_by
            LEFT JOIN app_users     ab       ON ab.id      = ar.approved_by
            LEFT JOIN purchases     p        ON ar.entity_type = 'purchase'
                                             AND ar.entity_id = p.id
            LEFT JOIN branches      p_branch ON p_branch.id = p.branch_id
            LEFT JOIN suppliers     s        ON s.id       = p.supplier_id
            LEFT JOIN ingredients   i        ON i.id       = p.ingredient_id
            WHERE {" AND ".join(where)}
            ORDER BY ar.requested_at DESC
            LIMIT %s
        """, params)
        return success("Approval history retrieved",
                       approvals=[dict(r) for r in cur.fetchall()])
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# APPROVE / REJECT
# ─────────────────────────────────────────────────────────────────────────────
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


# ─────────────────────────────────────────────────────────────────────────────
# GOVERNANCE HISTORY
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/governance/history")
def governance_history(
    branch_id: int | None = Query(None),
    action: str | None = Query(None),
    current_user: dict = Depends(get_current_user),
):
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        where = ["gal.company_id = %s"]
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
            LEFT JOIN branches          b   ON b.id   = gal.branch_id
            LEFT JOIN app_users         u   ON u.id   = gal.actor_id
            LEFT JOIN purchases         p   ON gal.entity_type = 'purchase'
                                           AND gal.item_id::integer = p.id
            LEFT JOIN suppliers         s   ON s.id   = p.supplier_id
            LEFT JOIN ingredients       i   ON i.id   = p.ingredient_id
            LEFT JOIN approval_requests ar  ON gal.entity_type = ar.entity_type
                                           AND gal.item_id::integer = ar.entity_id
            LEFT JOIN app_users         sub ON sub.id = ar.requested_by
            WHERE {" AND ".join(where)}
            ORDER BY gal.action_date DESC
            LIMIT 500
        """, params)
        return success("Governance history retrieved",
                       history=[dict(r) for r in cur.fetchall()])
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# CORE APPROVAL LOGIC
# ─────────────────────────────────────────────────────────────────────────────
def _set_approval_status(
    request_id: int, status: str, ip_address: str | None, current_user: dict
):
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT
                ar.id               AS ar_id,
                ar.entity_type,
                ar.entity_id,
                ar.status           AS ar_status,
                ar.requested_by,
                b_ar.company_id     AS ar_company_id,
                u.display_name      AS submitted_by,
                p.branch_id         AS branch_id,
                p.ingredient_id     AS ingredient_id,
                p.supplier_id       AS supplier_id,
                p.quantity          AS quantity,
                p.unit_cost         AS unit_cost,
                p.gross_amount      AS gross_amount,
                p.payable_amount    AS payable_amount,
                p.entry_date        AS purchase_date,
                p.notes             AS purchase_notes,
                b_p.company_id      AS purchase_company_id,
                s.name              AS supplier_name,
                i.name              AS ingredient_name
            FROM approval_requests ar
            LEFT JOIN branches    b_ar ON b_ar.id  = ar.branch_id
            LEFT JOIN app_users   u    ON u.id     = ar.requested_by
            LEFT JOIN purchases   p    ON ar.entity_type = 'purchase'
                                       AND ar.entity_id = p.id
            LEFT JOIN branches    b_p  ON b_p.id   = p.branch_id
            LEFT JOIN suppliers   s    ON s.id      = p.supplier_id
            LEFT JOIN ingredients i    ON i.id      = p.ingredient_id
            WHERE ar.id = %s
        """, (request_id,))
        old = cur.fetchone()

        if not old:
            return error("Approval request not found", status=404)

        company_id = old["purchase_company_id"] or old["ar_company_id"]
        if company_id != current_user["company_id"]:
            return error("Approval request not found", status=404)

        if old["ar_status"] != "pending":
            return error(
                f"This request is already {old['ar_status']} and cannot be changed",
                status=409,
            )

        # ── Update approval_requests ──────────────────────────────────────────
        cur.execute("""
            UPDATE approval_requests
               SET status = %s, approved_by = %s, approved_at = NOW()
             WHERE id = %s
         RETURNING *
        """, (status, current_user["id"], request_id))
        row = dict(cur.fetchone())

        # ── Sync source table status ──────────────────────────────────────────
        # Stock only increases when a GRN is recorded against this PO.
        if old["entity_type"] == "purchase":
            cur.execute(
                "UPDATE purchases SET status = %s WHERE id = %s",
                (status, old["entity_id"]),
            )
        elif old["entity_type"] == "transfer":
            cur.execute(
                "UPDATE transfers SET status = %s WHERE id = %s",
                (status, old["entity_id"]),
            )
        elif old["entity_type"] == "expense":
            cur.execute(
                "UPDATE expenses SET status = %s WHERE id = %s",
                (status, old["entity_id"]),
            )
        elif old["entity_type"] == "price_history":
            cur.execute("""
                UPDATE supplier_price_history
                SET status      = %s,
                    approved_by = %s,
                    approved_at = NOW()
                WHERE id = %s
            """, (status, current_user["id"], old["entity_id"]))

            # On approval → update ingredient standard cost
            if status == "approved":
                cur.execute("""
                    UPDATE ingredients i
                    SET cost_per_unit = sph.price,
                        supplier_id   = sph.supplier_id
                    FROM supplier_price_history sph
                    WHERE sph.id = %s
                      AND i.id   = sph.ingredient_id
                """, (old["entity_id"],))

        # ── Build governance log description ──────────────────────────────────
        if old["entity_type"] == "purchase":
            description = (
                f"{status.title()} purchase of "
                f"{old.get('ingredient_name') or 'item'} "
                f"from {old.get('supplier_name') or 'supplier'} — "
                f"{old.get('quantity') or ''} units "
                f"@ {old.get('unit_cost') or ''} "
                f"(payable: {old.get('payable_amount') or old.get('gross_amount') or ''})"
            )
        else:
            description = f"{status.title()} {old['entity_type']} #{old['entity_id']}"

        # ── Insert governance log with company_id ─────────────────────────────
        cur.execute("""
            INSERT INTO governance_action_log
                (item_id, entity_type, description, submitted_by, original_date,
                 action, amount, currency, from_procurement, actor_id, branch_id,
                 company_id)
            VALUES (%s, %s, %s, %s, NOW(), %s, %s, %s, %s, %s, %s, %s)
        """, (
            str(old["entity_id"]),
            old["entity_type"],
            description,
            old.get("submitted_by") or current_user.get("username"),
            "approve" if status == "approved" else "reject",
            float(old["payable_amount"] or old["gross_amount"] or 0)
            if old["entity_type"] == "purchase" else None,
            None,
            old["entity_type"] == "purchase",
            current_user["id"],
            old["branch_id"],
            current_user["company_id"],
        ))

        conn.commit()
        return success(f"Approval {status}", approval=row)

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()
