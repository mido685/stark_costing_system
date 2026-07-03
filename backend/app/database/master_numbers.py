from typing import Any


MASTER_NUMBER_COLUMNS = {
    "branches": "branch_number",
    "suppliers": "supplier_number",
    "ingredients": "ingredient_number",
    "products": "product_number",
    "app_users": "user_number",
}


def next_master_number(cur: Any, table: str, company_id: int) -> int:
    """Return the next company-local display number for a master-data table."""
    column = MASTER_NUMBER_COLUMNS.get(table)
    if not column:
        raise ValueError("Unsupported master-data table")

    cur.execute(
        "SELECT pg_advisory_xact_lock(hashtext(%s))",
        (f"master-number:{table}:{company_id}",),
    )
    cur.execute(
        f"""
        SELECT COALESCE(MAX({column}), 0) + 1 AS next_number
        FROM {table}
        WHERE company_id = %s
        """,
        (company_id,),
    )
    return int(cur.fetchone()["next_number"])
