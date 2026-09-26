from fastapi import APIRouter, Depends, Query, Request
from app.api.responses import error, success
from app.database.connection import dict_cursor, get_connection
from app.database.suppliers import approve_supplier_price
from app.database.cash_purchases import approve_cash_purchase,reject_cash_purchase

from app.database.log_audit import log_audit
from app.database.system_logger import log_event
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

                b.name AS branch_name,
                u.display_name AS submitted_by,

                COALESCE(p.quantity, cp.quantity) AS quantity,
                p.po_number,
                COALESCE(p.ingredient_id, cp.ingredient_id) AS ingredient_id,
                COALESCE(p.unit_cost, cp.unit_cost, sph.price) AS unit_cost,
                COALESCE(p.gross_amount, cp.gross_amount) AS amount,
                COALESCE(p.tax_amount, cp.tax_amount) AS tax_amount,
                COALESCE(p.payable_amount, cp.payable_amount) AS payable_amount,
                COALESCE(p.entry_date, cp.entry_date) AS entry_date,
                COALESCE(p.notes, cp.notes) AS notes,

                cp.purchase_type,
                cp.petty_cash_used,
                ec.name AS expense_category,

                COALESCE(s.name, cs.name, sph_s.name) AS supplier_name,
                COALESCE(s.phone, cs.phone) AS supplier_phone,
                COALESCE(i.name, ci.name, sph_i.name) AS ingredient_name,
                COALESCE(i.unit, ci.unit, sph_i.unit) AS unit,

                -- Support ordinary purchases, cash purchases and price history.
                COALESCE(
                    NULLIF(i.sku, ''),
                    NULLIF(ci.sku, ''),
                    CASE
                        WHEN i.id IS NOT NULL THEN 'RM-' || i.id::text
                        WHEN ci.id IS NOT NULL THEN 'RM-' || ci.id::text
                    END,
                    NULLIF(sph_i.sku, '')
                ) AS item_sku,

                sph.price_type,
                (
                    SELECT sph2.price
                    FROM supplier_price_history sph2
                    WHERE sph2.ingredient_id = sph.ingredient_id
                    AND sph2.supplier_id   = sph.supplier_id
                    AND sph2.status        = 'approved'
                    AND sph2.id            < sph.id
                    ORDER BY sph2.id DESC
                    LIMIT 1
                ) AS previous_price

            FROM approval_requests ar

            LEFT JOIN branches b
                ON b.id = ar.branch_id

            LEFT JOIN app_users u
                ON u.id = ar.requested_by

            LEFT JOIN purchases p
                ON ar.entity_type = 'purchase'
                AND ar.entity_id = p.id
            LEFT JOIN cash_purchases cp
                ON ar.entity_type = 'cash_purchase'
                AND ar.entity_id = cp.id

            LEFT JOIN suppliers cs
                ON cs.id = cp.supplier_id

            LEFT JOIN ingredients ci
                ON ci.id = cp.ingredient_id

            LEFT JOIN expense_categories ec
                ON ec.id = cp.category_id
            
            LEFT JOIN branches p_branch
                ON p_branch.id = p.branch_id

            LEFT JOIN suppliers s
                ON s.id = p.supplier_id

            LEFT JOIN ingredients i
                ON i.id = p.ingredient_id

            LEFT JOIN supplier_price_history sph
                ON ar.entity_type = 'price_history'
                AND ar.entity_id = sph.id

            LEFT JOIN suppliers sph_s
                ON sph_s.id = sph.supplier_id

            LEFT JOIN ingredients sph_i
                ON sph_i.id = sph.ingredient_id

            WHERE (
                b.company_id = %s
                OR p_branch.company_id = %s
                OR cp.company_id = %s
                OR (
                    ar.entity_type = 'price_history'
                    AND ar.branch_id IS NULL
                    AND %s IN (
                        SELECT company_id
                        FROM supplier_price_history
                        WHERE id = ar.entity_id
                    )
                )
            )
            AND ar.status = 'pending'
            ORDER BY ar.requested_at DESC
        """, (
            current_user["company_id"],
            current_user["company_id"],
            current_user["company_id"],
            current_user["company_id"]
        ))
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
        where = [
            "(b.company_id = %s OR p_branch.company_id = %s OR cp.company_id = %s)"
        ]
        params: list = [
            current_user["company_id"],
            current_user["company_id"],
            current_user["company_id"],
        ]

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
                COALESCE(p.quantity, cp.quantity) AS quantity,
                p.po_number,
                COALESCE(p.unit_cost, cp.unit_cost) AS unit_cost,
                COALESCE(p.gross_amount, cp.gross_amount) AS amount,
                COALESCE(p.tax_amount, cp.tax_amount) AS tax_amount,
                COALESCE(p.payable_amount, cp.payable_amount) AS payable_amount,
                COALESCE(p.entry_date, cp.entry_date) AS entry_date,
                COALESCE(p.notes, cp.notes) AS notes,
                COALESCE(s.name, cs.name) AS supplier_name,
                COALESCE(s.phone, cs.phone) AS supplier_phone,
                COALESCE(i.name, ci.name) AS ingredient_name,
                COALESCE(i.unit, ci.unit) AS unit,
                cp.purchase_type,
                cp.petty_cash_used,
                ec.name AS expense_category
            FROM approval_requests ar
            LEFT JOIN branches      b        ON b.id       = ar.branch_id
            LEFT JOIN app_users     u        ON u.id       = ar.requested_by
            LEFT JOIN app_users     ab       ON ab.id      = ar.approved_by
            LEFT JOIN purchases p
                ON ar.entity_type = 'purchase'
                AND ar.entity_id = p.id

            LEFT JOIN cash_purchases cp
                ON ar.entity_type = 'cash_purchase'
                AND ar.entity_id = cp.id

            LEFT JOIN suppliers cs
                ON cs.id = cp.supplier_id

            LEFT JOIN ingredients ci
                ON ci.id = cp.ingredient_id

            LEFT JOIN expense_categories ec
                ON ec.id = cp.category_id

            LEFT JOIN branches p_branch
                ON p_branch.id = p.branch_id
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
                COALESCE(p.quantity, cp.quantity) AS quantity,
                p.po_number,
                COALESCE(p.ingredient_id, cp.ingredient_id) AS ingredient_id,
                COALESCE(p.unit_cost, cp.unit_cost) AS unit_cost,
                COALESCE(p.gross_amount, cp.gross_amount) AS po_amount,
                COALESCE(p.tax_amount, cp.tax_amount) AS tax_amount,
                COALESCE(p.payable_amount, cp.payable_amount) AS payable_amount,
                COALESCE(p.entry_date, cp.entry_date) AS po_date,
                COALESCE(s.name, cs.name) AS supplier_name,
                COALESCE(i.name, ci.name, ec.name) AS ingredient_name,
                COALESCE(i.unit, ci.unit) AS unit,
                COALESCE(
                    NULLIF(i.sku, ''),
                    NULLIF(ci.sku, ''),
                    CASE
                        WHEN i.id IS NOT NULL THEN 'RM-' || i.id::text
                        WHEN ci.id IS NOT NULL THEN 'RM-' || ci.id::text
                    END
                ) AS item_sku,
                cp.purchase_type,
                cp.petty_cash_used,
                ec.name AS expense_category,
                sub.display_name    AS submitter_name
            FROM governance_action_log gal
            LEFT JOIN branches          b   ON b.id   = gal.branch_id
            LEFT JOIN app_users         u   ON u.id   = gal.actor_id
            LEFT JOIN purchases         p   ON gal.entity_type = 'purchase'
                                           AND gal.item_id::integer = p.id
            LEFT JOIN cash_purchases cp
                ON gal.entity_type = 'cash_purchase'
                AND gal.item_id::integer = cp.id

            LEFT JOIN suppliers cs
                ON cs.id = cp.supplier_id

            LEFT JOIN ingredients ci
                ON ci.id = cp.ingredient_id

            LEFT JOIN expense_categories ec
                ON ec.id = cp.category_id
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
                ar.branch_id,
                b_ar.company_id     AS ar_company_id,
                u.display_name      AS submitted_by,

                p.branch_id AS p_branch_id,
                COALESCE(p.ingredient_id, cp.ingredient_id) AS ingredient_id,
                COALESCE(p.supplier_id, cp.supplier_id) AS supplier_id,
                COALESCE(p.quantity, cp.quantity) AS quantity,
                COALESCE(p.unit_cost, cp.unit_cost) AS unit_cost,
                COALESCE(p.gross_amount, cp.gross_amount) AS gross_amount,
                COALESCE(p.payable_amount, cp.payable_amount) AS payable_amount,
                COALESCE(p.entry_date, cp.entry_date) AS purchase_date,
                COALESCE(p.notes, cp.notes) AS purchase_notes,
                b_p.company_id AS purchase_company_id,
                cp.company_id AS cash_purchase_company_id,
                COALESCE(s.name, cs.name) AS supplier_name,
                COALESCE(i.name, ci.name, ec.name) AS ingredient_name,
                sph.company_id      AS price_history_company_id
            FROM approval_requests ar
            LEFT JOIN branches    b_ar ON b_ar.id  = ar.branch_id
            LEFT JOIN app_users   u    ON u.id     = ar.requested_by
            LEFT JOIN purchases   p    ON ar.entity_type = 'purchase'
                                       AND ar.entity_id = p.id
            LEFT JOIN cash_purchases cp
                ON ar.entity_type = 'cash_purchase'
                AND ar.entity_id = cp.id

            LEFT JOIN suppliers cs
                ON cs.id = cp.supplier_id

            LEFT JOIN ingredients ci
                ON ci.id = cp.ingredient_id

            LEFT JOIN expense_categories ec
                ON ec.id = cp.category_id
            LEFT JOIN branches    b_p  ON b_p.id   = p.branch_id
            LEFT JOIN suppliers   s    ON s.id     = p.supplier_id
            LEFT JOIN ingredients i    ON i.id     = p.ingredient_id
            LEFT JOIN supplier_price_history sph
                                       ON ar.entity_type = 'price_history'
                                       AND ar.entity_id = sph.id
            WHERE ar.id = %s
            FOR UPDATE OF ar
        """, (request_id,))
        old = cur.fetchone()

        if not old:
            return error("Approval request not found", status=404)

        company_id = (
            old["purchase_company_id"]
            or old["cash_purchase_company_id"]
            or old["price_history_company_id"]
            or old["ar_company_id"]
        )
        if company_id != current_user["company_id"]:
            return error("Approval request not found", status=404)

        if old["ar_status"] != "pending":
            return error(
                f"This request is already {old['ar_status']} and cannot be changed",
                status=409,
            )

        old_dict = dict(old)

        # ── Update approval_requests ──────────────────────────────────────────
        cur.execute("""
            UPDATE approval_requests
               SET status = %s, approved_by = %s, approved_at = NOW()
             WHERE id = %s
         RETURNING *
        """, (status, current_user["id"], request_id))
        row = dict(cur.fetchone())

        # ── Sync source table status ──────────────────────────────────────────
        if old["entity_type"] == "purchase":
            cur.execute(
                "UPDATE purchases SET status = %s WHERE id = %s",
                (status, old["entity_id"]),
            )
        elif old["entity_type"] == "cash_purchase":
            if status == "approved":
                approve_cash_purchase(
                    purchase_id=old["entity_id"],
                    company_id=company_id,
                    approved_by=current_user["id"],
                    ip_address=ip_address,
                    conn=conn,
                )
            else:
                reject_cash_purchase(
                    purchase_id=old["entity_id"],
                    company_id=company_id,
                    rejected_by=current_user["id"],
                    ip_address=ip_address,
                    conn=conn,
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
            # Delegate entirely to the db function — it handles
            # supplier_price_history status, ingredients.cost_per_unit,
            # standard_cost_history, log_audit, and log_event in one place.
            conn.commit()
            approve_supplier_price(
                price_id=old["entity_id"],
                company_id=company_id,
                approver_id=current_user["id"],
                action=status,
                ip_address=ip_address,
            )
            # governance log + audit for the approval_requests row itself
            # are handled below; re-open connection for those writes.
            conn2 = get_connection()
            cur2 = dict_cursor(conn2)
            try:
                _write_governance_and_audit(
                    cur2, conn2,
                    old_dict=old_dict,
                    row=row,
                    status=status,
                    company_id=company_id,
                    current_user=current_user,
                    ip_address=ip_address,
                )
                conn2.commit()
            except Exception:
                conn2.rollback()
                raise
            finally:
                cur2.close()
                conn2.close()
            return success(f"Approval {status}", approval=row)

        # ── Audit + log_event for approval_requests row ───────────────────────
        _write_governance_and_audit(
            cur, conn,
            old_dict=old_dict,
            row=row,
            status=status,
            company_id=company_id,
            current_user=current_user,
            ip_address=ip_address,
        )

        conn.commit()
        return success(f"Approval {status}", approval=row)

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def _write_governance_and_audit(
    cur, conn,
    old_dict: dict,
    row: dict,
    status: str,
    company_id: int,
    current_user: dict,
    ip_address: str | None,
) -> None:
    """Write governance log, log_audit, and log_event for an approval decision."""

    # ── Build governance log description ─────────────────────────────────────
    if old_dict["entity_type"] in ("purchase", "cash_purchase"):
        description = (
            f"{status.title()} purchase of "
            f"{old_dict.get('ingredient_name') or 'item'} "
            f"from {old_dict.get('supplier_name') or 'supplier'} — "
            f"{old_dict.get('quantity') or ''} units "
            f"@ {old_dict.get('unit_cost') or ''} "
            f"(payable: {old_dict.get('payable_amount') or old_dict.get('gross_amount') or ''})"
        )
    else:
        description = (
            f"{status.title()} {old_dict['entity_type']} #{old_dict['entity_id']}"
        )

    # ── Insert governance log ─────────────────────────────────────────────────
    cur.execute("""
        INSERT INTO governance_action_log
            (item_id, entity_type, description, submitted_by, original_date,
             action, amount, currency, from_procurement, actor_id, branch_id,
             company_id)
        VALUES (%s, %s, %s, %s, NOW(), %s, %s, %s, %s, %s, %s, %s)
    """, (
        str(old_dict["entity_id"]),
        old_dict["entity_type"],
        description,
        old_dict.get("submitted_by") or current_user.get("username"),
        "approve" if status == "approved" else "reject",
        float(old_dict["payable_amount"] or old_dict["gross_amount"] or 0)
        if old_dict["entity_type"] in ("purchase", "cash_purchase") else None,
        None,
        old_dict["entity_type"] == "purchase",
        current_user["id"],
        old_dict["branch_id"],
        company_id,
    ))

    # ── log_audit ─────────────────────────────────────────────────────────────
    log_audit(
        conn,
        company_id=company_id,
        user_id=current_user["id"],
        action="UPDATE",
        table_name="approval_requests",
        record_id=row["id"],
        old_data={"status": "pending"},
        new_data={"status": status, "approved_by": current_user["id"]},
        ip_address=ip_address,
    )

    # ── log_event ─────────────────────────────────────────────────────────────
    log_event(
        conn,
        company_id=company_id,
        user_id=current_user["id"],
        action="approved" if status == "approved" else "rejected",
        category="data",
        level="info" if status == "approved" else "warning",
        entity_type="approval_requests",
        entity_id=row["id"],
        payload={
            "entity_type":  old_dict["entity_type"],
            "entity_id":    old_dict["entity_id"],
            "branch_id":    old_dict["branch_id"],
            "submitted_by": old_dict.get("submitted_by"),
            "changes":      {"status": status},
            "original":     {"status": "pending"},
            **(
                {
                    "supplier_name":    old_dict.get("supplier_name"),
                    "ingredient_name":  old_dict.get("ingredient_name"),
                    "quantity":         float(old_dict["quantity"]) if old_dict.get("quantity") else None,
                    "payable_amount":   float(old_dict["payable_amount"] or old_dict.get("gross_amount") or 0),
                }
                if old_dict["entity_type"] in ("purchase", "cash_purchase") else {}
            ),
        },
        ip_address=ip_address,
    )
