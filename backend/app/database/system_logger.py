# app/database/system_logger.py
from __future__ import annotations

from psycopg2.extras import Json


def log_event(
    conn,
    company_id: int,
    action: str,
    category: str = "data",
    level: str = "info",
    entity_type: str | None = None,
    entity_id: int | None = None,
    payload: dict | None = None,
    branch_id: int | None = None,
    user_id: int | None = None,
    ip_address: str | None = None,
    session_id: str | None = None,
) -> None:
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO system_logs
                (company_id, branch_id, user_id, level, category, action,
                 entity_type, entity_id, payload, ip_address, session_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                company_id, branch_id, user_id, level, category, action,
                entity_type, entity_id,
                Json(payload) if payload else None,
                ip_address, session_id,
            ),
        )
        cur.close()
    except Exception as e:
        print(f"⚠️ system_log write failed: {e}")