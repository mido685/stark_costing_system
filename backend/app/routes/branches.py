from fastapi import APIRouter, Request, Depends
from app.api.responses import success, error
from app.schemas import BranchRequest, BranchUpdateRequest
from app.database import branches as branches_db
from app.security.dependencies import get_current_user, require_roles

router = APIRouter(prefix="/branches", tags=["branches"])


@router.get("")
def list_branches(current_user: dict = Depends(get_current_user)):
    branches = branches_db.list_branches(current_user["company_id"])
    return success("Branches retrieved", branches=branches)


@router.get("/{branch_id}")
def get_branch(
    branch_id: int,
    current_user: dict = Depends(get_current_user),
):
    branch = branches_db.get_branch(branch_id, current_user["company_id"])
    if not branch:
        return error("Branch not found", status=404)
    return success("Branch retrieved", branch=branch)


@router.post("", status_code=201)
def create_branch(
    req: BranchRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    try:
        branch = branches_db.add_branch(
            name=req.name,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            location=req.location,
            manager=req.manager,
            ip_address=request.client.host,
        )
        return success("Branch created", branch=branch)
    except ValueError as e:
        return error(str(e))


@router.put("/{branch_id}")
def update_branch(
    branch_id: int,
    req: BranchUpdateRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    try:
        branch = branches_db.update_branch(
            branch_id=branch_id,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            name=req.name,
            location=req.location,
            manager=req.manager,
            ip_address=request.client.host,
        )
        return success("Branch updated", branch=branch)
    except ValueError as e:
        return error(str(e))


@router.delete("/{branch_id}")
def delete_branch(
    branch_id: int,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    try:
        branches_db.deactivate_branch(
            branch_id=branch_id,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            ip_address=request.client.host,
        )
        return success("Branch deleted")
    except ValueError as e:
        return error(str(e), status=404)