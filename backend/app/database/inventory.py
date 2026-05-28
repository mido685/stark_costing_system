from __future__ import annotations

from typing import Any

from .connection import get_connection, dict_cursor
from .log_audit import log_audit
from .periods import is_period_closed


def _row(row: dict[str, Any]) -> dict[str, Any]:
    return {k: float(v) if hasattr(v, "__round__") and not isinstance(v, int) else v for k, v in row.items()}


def _verify_branch(cur, branch_id: int, company_id: int) -> None:
    cur.execute("SELECT id FROM branches WHERE id = %s AND company_id = %s", (branch_id, company_id))
    if not cur.fetchone():
        raise ValueError("Branch not found or access denied")


def _ingredient_cost(cur, ingredient_id: int, company_id: int) -> float:
    cur.execute("SELECT cost_per_unit FROM ingredients WHERE id = %s AND company_id = %s", (ingredient_id, company_id))
    row = cur.fetchone()
    if not row:
        raise ValueError("Ingredient not found or access denied")
    return float(row["cost_per_unit"] or 0)


def get_branch_stock_balances(company_id: int, branch_id: int) -> list[dict[str, Any]]:
    conn = get_connection(); cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)
        cur.execute("""
            SELECT 
                i.id AS ingredient_id, i.name, i.unit, i.reorder_level, i.cost_per_unit,
                COALESCE(SUM(im.quantity_delta), 0) AS movement_qty,
                COALESCE(SUM(im.quantity_delta), 0) AS balance_qty
            FROM ingredients i
            LEFT JOIN inventory_movements im 
                ON im.ingredient_id = i.id AND im.branch_id = %s
            WHERE i.company_id = %s AND i.is_active = TRUE
            GROUP BY i.id, i.name, i.unit, i.reorder_level, i.cost_per_unit
            ORDER BY i.name
        """, (branch_id, company_id))
        rows = [_row(dict(r)) for r in cur.fetchall()]
        for row in rows:
            qty = row["balance_qty"]
            row["stock_value"]      = round(qty * row["cost_per_unit"], 2)
            row["inventory_value"]  = round(qty * row["cost_per_unit"], 2)
            row["negative_alert"]   = qty < 0
            row["reorder_alert"]    = 0 <= qty <= row["reorder_level"]
        return rows
    finally:
        cur.close(); conn.close()
        
def get_finished_goods_balances(company_id: int, branch_id: int) -> list[dict[str, Any]]:
    conn = get_connection(); cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)
        cur.execute("""
            SELECT p.id AS product_id, p.name, p.unit, p.sale_price,
                   COALESCE(SUM(fgm.quantity_delta), 0) AS balance_qty,
                   CASE WHEN COALESCE(SUM(fgm.quantity_delta) FILTER (WHERE fgm.quantity_delta > 0), 0) > 0
                        THEN SUM(fgm.quantity_delta * fgm.unit_cost) FILTER (WHERE fgm.quantity_delta > 0)
                           / SUM(fgm.quantity_delta) FILTER (WHERE fgm.quantity_delta > 0)
                        ELSE 0 END AS avg_unit_cost
            FROM products p
            LEFT JOIN finished_goods_movements fgm ON fgm.product_id = p.id AND fgm.branch_id = %s
            WHERE p.company_id = %s AND p.is_active = TRUE
            GROUP BY p.id, p.name, p.unit, p.sale_price
            ORDER BY p.name
        """, (branch_id, company_id))
        rows = [_row(dict(r)) for r in cur.fetchall()]
        for row in rows:
            qty = row["balance_qty"]
            row["stock_value"]     = round(qty * row["avg_unit_cost"], 2)
            row["inventory_value"] = round(qty * row["avg_unit_cost"], 2)
            row["negative_alert"]  = qty < 0
            row["reorder_alert"]   = False
        return rows
    finally:
        cur.close(); conn.close()


def list_stock_issues(company_id: int, branch_id: int | None = None, limit: int = 50) -> list[dict[str, Any]]:
    conn = get_connection(); cur = dict_cursor(conn)
    try:
        where = ["b.company_id = %s"]
        params: list[Any] = [company_id]
        if branch_id:
            where.append("si.branch_id = %s"); params.append(branch_id)
        cur.execute(f"""
            SELECT si.*, b.name AS branch_name, i.name AS ingredient_name, i.unit
            FROM stock_issues si
            JOIN branches b ON b.id = si.branch_id
            JOIN ingredients i ON i.id = si.ingredient_id
            WHERE {' AND '.join(where)}
            ORDER BY si.entry_date DESC, si.id DESC
            LIMIT %s
        """, params + [limit])
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()


def add_stock_issue(company_id: int, user_id: int, branch_id: int, ingredient_id: int,
                    entry_date: str, qty_issued: float, issued_to: str | None = None,
                    notes: str = "", ip_address: str | None = None) -> dict:
    if is_period_closed(branch_id, entry_date):
        raise ValueError("This accounting period is closed for the selected branch")
    conn = get_connection(); cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)
        unit_cost = _ingredient_cost(cur, ingredient_id, company_id)
        cur.execute("""
            INSERT INTO stock_issues (branch_id, ingredient_id, entry_date, qty_issued, issued_to, notes)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (branch_id, ingredient_id, entry_date, qty_issued, issued_to, notes))
        issue = dict(cur.fetchone())
        movement_type = "opening_stock" if issued_to == "opening_stock" else "issue"
        quantity_delta = qty_issued if movement_type == "opening_stock" else -qty_issued
        cur.execute("""
            INSERT INTO inventory_movements
                (branch_id, ingredient_id, movement_type, entry_date,
                 quantity_delta, unit_cost, reference_table, reference_id, notes)
            VALUES (%s, %s, %s, %s, %s, %s, 'stock_issues', %s, %s)
        """, (branch_id, ingredient_id, movement_type, entry_date, quantity_delta, unit_cost, issue["id"], notes))
        log_audit(conn, company_id=company_id, user_id=user_id, branch_id=branch_id,
                  action="CREATE", table_name="stock_issues", record_id=issue["id"],
                  new_data=issue, ip_address=ip_address)
        conn.commit(); return issue
    except Exception:
        conn.rollback(); raise
    finally:
        cur.close(); conn.close()


def add_stock_count(company_id: int, user_id: int, branch_id: int, ingredient_id: int,
                    entry_date: str, system_qty: float, counted_qty: float,
                    notes: str = "", ip_address: str | None = None) -> dict:
    if is_period_closed(branch_id, entry_date):
        raise ValueError("This accounting period is closed for the selected branch")
    conn = get_connection(); cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)
        _ingredient_cost(cur, ingredient_id, company_id)
        delta = counted_qty - system_qty
        cur.execute("""
            INSERT INTO stock_counts
                (branch_id, ingredient_id, entry_date, system_qty, counted_qty, delta, notes, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (branch_id, ingredient_id, entry_date, system_qty, counted_qty, delta, notes, user_id))
        count = dict(cur.fetchone())
        log_audit(conn, company_id=company_id, user_id=user_id, branch_id=branch_id,
                  action="CREATE", table_name="stock_counts", record_id=count["id"],
                  new_data=count, ip_address=ip_address)
        conn.commit(); return count
    except Exception:
        conn.rollback(); raise
    finally:
        cur.close(); conn.close()


def list_stock_counts(company_id: int, branch_id: int | None = None, limit: int = 50, with_purchases: bool = False) -> list[dict[str, Any]]:
    conn = get_connection(); cur = dict_cursor(conn)
    try:
        where = ["b.company_id = %s"]
        params: list[Any] = [company_id]
        if branch_id:
            where.append("sc.branch_id = %s"); params.append(branch_id)
        purchase_cols = """
               COALESCE(p.total_purchased_qty, 0) AS total_purchased_qty,
               COALESCE(p.total_purchased_value, 0) AS total_purchased_value,
               COALESCE(p.purchase_count, 0) AS purchase_count,
        """ if with_purchases else ""
        purchase_join = """
            LEFT JOIN (
                SELECT ingredient_id, branch_id,
                       SUM(quantity) AS total_purchased_qty,
                       SUM(payable_amount) AS total_purchased_value,
                       COUNT(*) AS purchase_count
                FROM purchases WHERE status = 'approved'
                GROUP BY ingredient_id, branch_id
            ) p ON p.ingredient_id = sc.ingredient_id AND p.branch_id = sc.branch_id
        """ if with_purchases else ""
        cur.execute(f"""
            SELECT sc.*, b.name AS branch_name, i.name AS ingredient_name, i.unit,
                   {purchase_cols}
                   u.display_name AS counted_by
            FROM stock_counts sc
            JOIN branches b ON b.id = sc.branch_id
            JOIN ingredients i ON i.id = sc.ingredient_id
            LEFT JOIN app_users u ON u.id = sc.created_by
            {purchase_join}
            WHERE {' AND '.join(where)}
            ORDER BY sc.entry_date DESC, sc.id DESC
            LIMIT %s
        """, params + [limit])
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()


def add_adjustment(company_id: int, user_id: int, branch_id: int, ingredient_id: int,
                   entry_date: str, quantity_delta: float, notes: str = "",
                   ip_address: str | None = None) -> dict:
    if is_period_closed(branch_id, entry_date):
        raise ValueError("This accounting period is closed for the selected branch")
    conn = get_connection(); cur = dict_cursor(conn)
    try:
        _verify_branch(cur, branch_id, company_id)
        unit_cost = _ingredient_cost(cur, ingredient_id, company_id)
        cur.execute("""
            INSERT INTO inventory_movements
                (branch_id, ingredient_id, movement_type, entry_date, quantity_delta, unit_cost, notes)
            VALUES (%s, %s, 'adjustment', %s, %s, %s, %s)
            RETURNING *
        """, (branch_id, ingredient_id, entry_date, quantity_delta, unit_cost, notes or "adjustment"))
        movement = dict(cur.fetchone())
        log_audit(conn, company_id=company_id, user_id=user_id, branch_id=branch_id,
                  action="ADJUSTMENT", table_name="inventory_movements",
                  record_id=movement["id"], new_data=movement, ip_address=ip_address)
        conn.commit(); return movement
    except Exception:
        conn.rollback(); raise
    finally:
        cur.close(); conn.close()


def list_adjustments(company_id: int, branch_id: int | None = None, limit: int = 50) -> list[dict[str, Any]]:
    conn = get_connection(); cur = dict_cursor(conn)
    try:
        where = ["b.company_id = %s", "im.movement_type = 'adjustment'"]
        params: list[Any] = [company_id]
        if branch_id:
            where.append("im.branch_id = %s"); params.append(branch_id)
        cur.execute(f"""
            SELECT im.id, im.branch_id, im.ingredient_id, i.name AS ingredient_name, i.unit,
                   im.quantity_delta, im.entry_date, im.notes, 'pending' AS status
            FROM inventory_movements im
            JOIN branches b ON b.id = im.branch_id
            JOIN ingredients i ON i.id = im.ingredient_id
            WHERE {' AND '.join(where)}
            ORDER BY im.entry_date DESC, im.id DESC
            LIMIT %s
        """, params + [limit])
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()


def approve_adjustment(company_id: int, user_id: int, adj_id: int, status: str, notes: str = "", ip_address: str | None = None) -> None:
    conn = get_connection(); cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT im.*, b.company_id
            FROM inventory_movements im
            JOIN branches b ON b.id = im.branch_id
            WHERE im.id = %s AND b.company_id = %s AND im.movement_type = 'adjustment'
        """, (adj_id, company_id))
        movement = cur.fetchone()
        if not movement:
            raise ValueError("Adjustment not found or access denied")
        log_audit(conn, company_id=company_id, user_id=user_id, branch_id=movement["branch_id"],
                  action=f"ADJUSTMENT_{status.upper()}", table_name="inventory_movements",
                  record_id=adj_id, old_data=dict(movement), new_data={"status": status, "notes": notes},
                  ip_address=ip_address)
        conn.commit()
    except Exception:
        conn.rollback(); raise
    finally:
        cur.close(); conn.close()


def list_opening_stock(company_id: int, branch_id: int | None = None, limit: int = 50) -> list[dict[str, Any]]:
    conn = get_connection(); cur = dict_cursor(conn)
    try:
        where = ["b.company_id = %s", "si.issued_to = 'opening_stock'"]
        params: list[Any] = [company_id]
        if branch_id:
            where.append("si.branch_id = %s"); params.append(branch_id)
        cur.execute(f"""
            SELECT si.*, b.name AS branch_name, i.name AS ingredient_name, i.unit
            FROM stock_issues si
            JOIN branches b ON b.id = si.branch_id
            JOIN ingredients i ON i.id = si.ingredient_id
            WHERE {' AND '.join(where)}
            ORDER BY si.entry_date DESC, si.id DESC
            LIMIT %s
        """, params + [limit])
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()


def list_transfers(company_id: int, branch_id: int | None = None, limit: int = 50) -> list[dict[str, Any]]:
    conn = get_connection(); cur = dict_cursor(conn)
    try:
        if branch_id:
            where = "WHERE (t.from_branch_id = %s OR t.to_branch_id = %s) AND bf.company_id = %s AND bt.company_id = %s"
            direction_expr = "CASE WHEN t.to_branch_id = %s THEN 'in' ELSE 'out' END"
            params = [branch_id, branch_id, company_id, company_id, branch_id, limit]
        else:
            where = "WHERE bf.company_id = %s AND bt.company_id = %s"
            direction_expr = "NULL"
            params = [company_id, company_id, limit]
        cur.execute(f"""
            SELECT t.*, bf.name AS from_branch_name, bt.name AS to_branch_name,
                   i.name AS ingredient_name, i.unit, {direction_expr} AS direction
            FROM transfers t
            JOIN branches bf ON bf.id = t.from_branch_id
            JOIN branches bt ON bt.id = t.to_branch_id
            JOIN ingredients i ON i.id = t.ingredient_id
            {where}
            ORDER BY t.entry_date DESC, t.id DESC
            LIMIT %s
        """, params)
        return [_row(dict(r)) for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()


def add_transfer(company_id: int, user_id: int, from_branch_id: int, to_branch_id: int,
                 ingredient_id: int, entry_date: str, quantity: float, notes: str = "",
                 status: str = "approved", ip_address: str | None = None) -> dict:
    if is_period_closed(from_branch_id, entry_date) or is_period_closed(to_branch_id, entry_date):
        raise ValueError("This accounting period is closed for one of the selected branches")
    conn = get_connection(); cur = dict_cursor(conn)
    try:
        _verify_branch(cur, from_branch_id, company_id)
        _verify_branch(cur, to_branch_id, company_id)
        unit_cost = _ingredient_cost(cur, ingredient_id, company_id)
        cur.execute("""
            INSERT INTO transfers
                (from_branch_id, to_branch_id, ingredient_id, entry_date, quantity, notes, status, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (from_branch_id, to_branch_id, ingredient_id, entry_date, quantity, notes, status, user_id))
        transfer = dict(cur.fetchone())
        if status == "approved":
            cur.execute("""
                INSERT INTO inventory_movements
                    (branch_id, ingredient_id, movement_type, entry_date, quantity_delta, unit_cost, reference_table, reference_id, notes)
                VALUES (%s, %s, 'transfer_out', %s, %s, %s, 'transfers', %s, %s),
                       (%s, %s, 'transfer_in', %s, %s, %s, 'transfers', %s, %s)
            """, (from_branch_id, ingredient_id, entry_date, -quantity, unit_cost, transfer["id"], notes,
                  to_branch_id, ingredient_id, entry_date, quantity, unit_cost, transfer["id"], notes))
        log_audit(conn, company_id=company_id, user_id=user_id, branch_id=from_branch_id,
                  action="CREATE", table_name="transfers", record_id=transfer["id"],
                  new_data=transfer, ip_address=ip_address)
        conn.commit(); return transfer
    except Exception:
        conn.rollback(); raise
    finally:
        cur.close(); conn.close()
# In inventory database
def list_inventory_movements(
    company_id: int,
    branch_id: int | None = None,
    movement_type: str | None = None,
) -> list[dict]:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        where = ["b.company_id = %s"]
        params: list = [company_id]
        if branch_id:
            where.append("im.branch_id = %s")
            params.append(branch_id)
        if movement_type:
            where.append("im.movement_type = %s")
            params.append(movement_type)
        cur.execute(f"""
            SELECT im.*, i.name AS ingredient_name, i.unit
            FROM inventory_movements im
            JOIN ingredients i ON i.id = im.ingredient_id
            JOIN branches b ON b.id = im.branch_id
            WHERE {' AND '.join(where)}
            ORDER BY im.entry_date DESC, im.id DESC
        """, params)
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()
