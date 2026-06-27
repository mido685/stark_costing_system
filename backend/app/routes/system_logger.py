# ─── app/routes/system_logs.py ───────────────────────────────────────────────
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from app.api.responses import success, error
from app.database.system_logs import list_system_logs
from app.security.dependencies import get_current_user, require_roles

router = APIRouter(prefix="/system-logs", tags=["system-logs"])


@router.get("")
def get_system_logs(
    date:       str | None = Query(None, description="YYYY-MM-DD — filter by day"),
    action:     str | None = Query(None),
    user:       str | None = Query(None, description="partial display_name search"),
    branch_id:  int | None = Query(None),
    level:      str | None = Query(None),
    entity_type:str | None = Query(None),
    limit:      int        = Query(50, ge=1, le=200),
    offset:     int        = Query(0,  ge=0),
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    """
    Paginated system log viewer.
    Only owner / admin / manager roles can read logs.
    """
    rows, total = list_system_logs(
        company_id  = current_user["company_id"],
        date        = date,
        action      = action,
        user        = user,
        branch_id   = branch_id,
        level       = level,
        entity_type = entity_type,
        limit       = limit,
        offset      = offset,
    )
    return success("System logs retrieved", rows=rows, total=total)


# ─── app/database/system_logs.py ─────────────────────────────────────────────
"""
Read-only query layer for system_logs.
The write side lives in db/system_logger.py (log_event).
"""
from __future__ import annotations

from typing import Any
from .connection import get_connection, dict_cursor


def list_system_logs(
    company_id:   int,
    date:         str | None       = None,
    action:       str | None       = None,
    user:         str | None       = None,
    branch_id:    int | None       = None,
    level:        str | None       = None,
    entity_type:  str | None       = None,
    limit:        int              = 50,
    offset:       int              = 0,
) -> tuple[list[dict[str, Any]], int]:
    """
    Returns (rows, total_count) for the system_logs table.

    Joins app_users so the frontend gets display_name and avatar
    without a second round-trip.
    """
    conn = get_connection()
    cur  = dict_cursor(conn)
    try:
        where:  list[str]  = ["sl.company_id = %s"]
        params: list[Any]  = [company_id]

        if date:
            where.append("sl.created_at::date = %s::date")
            params.append(date)

        if action:
            # Case-insensitive match; supports partial prefix ("creat" → "created")
            where.append("sl.action ILIKE %s")
            params.append(f"{action}%")

        if user:
            where.append("u.display_name ILIKE %s")
            params.append(f"%{user}%")

        if branch_id:
            where.append("sl.branch_id = %s")
            params.append(branch_id)

        if level:
            where.append("sl.level = %s")
            params.append(level)

        if entity_type:
            where.append("sl.entity_type = %s")
            params.append(entity_type)

        where_sql = "WHERE " + " AND ".join(where)

        # Total count (no limit/offset)
        cur.execute(
            f"""
            SELECT COUNT(*) AS cnt
            FROM system_logs sl
            LEFT JOIN app_users u ON u.id = sl.user_id
            {where_sql}
            """,
            params,
        )
        total = cur.fetchone()["cnt"]

        # Paginated rows
        cur.execute(
            f"""
            SELECT
                sl.id,
                sl.company_id,
                sl.branch_id,
                b.name          AS branch_name,
                sl.user_id,
                u.display_name  AS user_name,
                u.avatar_url    AS user_avatar,
                sl.level,
                sl.category,
                sl.action,
                sl.entity_type,
                sl.entity_id,
                sl.payload,
                sl.ip_address,
                sl.created_at
            FROM system_logs sl
            LEFT JOIN app_users u ON u.id    = sl.user_id
            LEFT JOIN branches  b ON b.id    = sl.branch_id
            {where_sql}
            ORDER BY sl.created_at DESC, sl.id DESC
            LIMIT %s OFFSET %s
            """,
            params + [limit, offset],
        )
        rows = [dict(r) for r in cur.fetchall()]

        # Deserialize payload JSON if psycopg2 returns it as a string
        import json
        for row in rows:
            if isinstance(row.get("payload"), str):
                try:
                    row["payload"] = json.loads(row["payload"])
                except Exception:
                    row["payload"] = None

        return rows, total

    finally:
        cur.close()
        conn.close()