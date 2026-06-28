# app/routes/system_logger.py
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from app.api.responses import success, error
from app.database.system_logs import list_system_logs
from app.security.dependencies import get_current_user, require_roles

router = APIRouter(prefix="/system-logs", tags=["system-logs"])


@router.get("")
def get_system_logs(
    date:        str | None = Query(None, description="YYYY-MM-DD — filter by day"),
    action:      str | None = Query(None),
    user:        str | None = Query(None, description="partial display_name search"),
    branch_id:   int | None = Query(None),
    level:       str | None = Query(None),
    entity_type: str | None = Query(None),
    limit:       int        = Query(50, ge=1, le=200),
    offset:      int        = Query(0,  ge=0),
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