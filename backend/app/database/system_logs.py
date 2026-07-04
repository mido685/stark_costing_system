# app/database/system_logs.py
from __future__ import annotations

import json
from typing import Any
from .connection import get_connection, dict_cursor


def _coerce_int(value: Any) -> int | None:
    try:
        if isinstance(value, bool) or value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _collect_ingredient_ids(value: Any, ids: set[int]) -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            if key == "ingredient_id":
                ingredient_id = _coerce_int(nested)
                if ingredient_id is not None:
                    ids.add(ingredient_id)
            else:
                _collect_ingredient_ids(nested, ids)
    elif isinstance(value, list):
        for nested in value:
            _collect_ingredient_ids(nested, ids)


def _enrich_ingredient_refs(value: Any, ingredients: dict[int, dict[str, Any]]) -> Any:
    if isinstance(value, dict):
        enriched: dict[str, Any] = {}
        for key, nested in value.items():
            if key == "ingredient_id":
                ingredient_id = _coerce_int(nested)
                ingredient = ingredients.get(ingredient_id) if ingredient_id is not None else None
                if ingredient:
                    enriched[key] = ingredient["ingredient_number"] or ingredient_id
                    enriched.setdefault("ingredient_name", ingredient["name"])
                else:
                    enriched[key] = nested
            else:
                enriched[key] = _enrich_ingredient_refs(nested, ingredients)
        return enriched
    if isinstance(value, list):
        return [_enrich_ingredient_refs(nested, ingredients) for nested in value]
    return value


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
                NULL           AS user_avatar,
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

        ingredient_ids: set[int] = set()
        for row in rows:
            _collect_ingredient_ids(row.get("payload"), ingredient_ids)

        if ingredient_ids:
            cur.execute(
                """
                SELECT id, ingredient_number, name
                FROM ingredients
                WHERE company_id = %s AND id = ANY(%s)
                """,
                (company_id, list(ingredient_ids)),
            )
            ingredients = {r["id"]: dict(r) for r in cur.fetchall()}
            for row in rows:
                row["payload"] = _enrich_ingredient_refs(row.get("payload"), ingredients)

        return rows, total

    finally:
        cur.close()
        conn.close()
# app/database/system_logs.py — add this
def log_system_event(
    company_id: int,
    action: str,
    level: str = "info",
    category: str = "system",
    user_id: int | None = None,
    branch_id: int | None = None,
    entity_type: str | None = None,
    entity_id: int | None = None,
    payload: dict | None = None,
    ip_address: str | None = None,
) -> None:
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute(
            """
            INSERT INTO system_logs
                (company_id, branch_id, user_id, level, category,
                 action, entity_type, entity_id, payload, ip_address)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (company_id, branch_id, user_id, level, category,
             action, entity_type, entity_id,
             json.dumps(payload) if payload else None, ip_address),
        )
        conn.commit()
    finally:
        cur.close()
        conn.close()
