# app/database/system_logs.py
from __future__ import annotations

import json
from typing import Any
from .connection import get_connection, dict_cursor


def list_system_logs(
    company_id:  int,
    date:        str | None = None,
    action:      str | None = None,
    user:        str | None = None,
    branch_id:   int | None = None,
    level:       str | None = None,
    entity_type: str | None = None,
    limit:       int        = 50,
    offset:      int        = 0,
) -> tuple[list[dict[str, Any]], int]:
    """
    Returns (rows, total_count) for the system_logs table.
    Joins app_users and branches so the frontend gets display_name
    and branch name without a second round-trip.
    """
    conn = get_connection()
    cur  = dict_cursor(conn)
    try:
        where:  list[str] = ["sl.company_id = %s"]
        params: list[Any] = [company_id]

        if date:
            where.append("sl.created_at::date = %s::date")
            params.append(date)
        if action:
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

        cur.execute(
            f"""
            SELECT
                sl.id,
                sl.company_id,
                sl.branch_id,
                b.name         AS branch_name,
                sl.user_id,
                u.display_name AS user_name,
                u.avatar_url   AS user_avatar,
                sl.level,
                sl.category,
                sl.action,
                sl.entity_type,
                sl.entity_id,
                sl.payload,
                sl.ip_address,
                sl.created_at
            FROM system_logs sl
            LEFT JOIN app_users u ON u.id = sl.user_id
            LEFT JOIN branches  b ON b.id = sl.branch_id
            {where_sql}
            ORDER BY sl.created_at DESC, sl.id DESC
            LIMIT %s OFFSET %s
            """,
            params + [limit, offset],
        )
        rows = [dict(r) for r in cur.fetchall()]

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