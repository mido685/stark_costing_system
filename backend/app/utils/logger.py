# utils/logger.py
from app.database.connection import get_connection, dict_cursor
import json

def log_event(
    company_id: int,
    action: str,
    category: str = "system",
    level: str = "info",
    entity_type: str = None,
    entity_id: int = None,
    payload: dict = None,
    branch_id: int = None,
    user_id: int = None,
    ip_address: str = None,
    session_id: str = None,
):
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            INSERT INTO system_logs
                (company_id, branch_id, user_id, level, category, action,
                 entity_type, entity_id, payload, ip_address, session_id)
            VALUES
                (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            company_id, branch_id, user_id, level, category, action,
            entity_type, entity_id,
            json.dumps(payload) if payload else None,
            ip_address, session_id
        ))
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"⚠️ Failed to write system log: {e}")
    finally:
        cur.close()
        conn.close()