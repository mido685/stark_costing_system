from typing import Any

from .connection import get_connection, dict_cursor


def company_has_module(company_id: int, module_key: str) -> bool:
    """
    True if this company can use the given module.
    No restriction rows for this company at all = unrestricted (full access).
    Restriction rows exist but this module isn't among them, or is disabled = blocked.
    """
    conn = get_connection()
    cur = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT 1
            FROM company_module_access
            WHERE company_id = %s
            LIMIT 1
        """, (company_id,))
        has_any_restriction = cur.fetchone() is not None

        if not has_any_restriction:
            return True

        cur.execute("""
            SELECT cma.is_enabled
            FROM company_module_access cma
            JOIN modules m ON m.id = cma.module_id
            WHERE cma.company_id = %s AND m.module_key = %s
        """, (company_id, module_key))
        row = cur.fetchone()
        return bool(row and row["is_enabled"])
    finally:
        cur.close()
        conn.close()