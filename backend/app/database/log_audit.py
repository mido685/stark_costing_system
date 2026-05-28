from .connection import dict_cursor
import json
from datetime import datetime, date
from decimal import Decimal

def _serialize(obj):
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError(f"Type {type(obj)} not serializable")
def log_audit(
    conn,
    company_id: int,
    action: str,
    table_name: str,
    record_id: int | None = None,
    old_data: dict | None = None,
    new_data: dict | None = None,
    user_id: int | None = None,
    branch_id: int | None = None,
    ip_address: str | None = None,
):
    cur = dict_cursor(conn)
    cur.execute("""
        INSERT INTO audit_log
            (company_id, user_id, branch_id, action, table_name, record_id, old_data, new_data, ip_address)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
    """, (
        company_id, user_id, branch_id, action, table_name,
        record_id,
        json.dumps(old_data, default=_serialize) if old_data else None,
        json.dumps(new_data, default=_serialize) if new_data else None,
        ip_address,
    ))
    cur.close()