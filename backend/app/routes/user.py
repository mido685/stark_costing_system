from fastapi import APIRouter, Request, Depends
from app.api.responses import success, error
from app.schemas import UserRequest, UserUpdateRequest
from app.database import user as users_db
from app.security.dependencies import get_current_user, require_roles

router = APIRouter(prefix="/users", tags=["users"])


def _resolve_role_id(req: UserRequest | UserUpdateRequest, company_id: int) -> int | None:
    if req.role_id is not None:
        return req.role_id
    if req.role:
        return users_db.get_role_id_by_name(company_id, req.role)
    return None


@router.get("")
def list_users(current_user: dict = Depends(get_current_user)):
    users = users_db.list_users(current_user["company_id"])
    return success("Users retrieved", users=users)


@router.post("")
def create_user(
    req: UserRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin")),
):
    try:
        role_id = _resolve_role_id(req, current_user["company_id"])
        if role_id is None:
            return error("Role is required")
        user = users_db.add_user(
            username=req.username,
            display_name=req.display_name,
            role_id=role_id,
            password=req.password,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            ip_address=request.client.host,
        )
        return success("User created", user=user)
    except ValueError as e:
        return error(str(e))


@router.get("/{user_id}")
def get_user(
    user_id: int,
    current_user: dict = Depends(get_current_user),
):
    user = users_db.get_user(user_id, current_user["company_id"])
    if not user:
        return error("User not found", status=404)
    return success("User retrieved", user=user)


@router.put("/{user_id}")
def update_user(
    user_id: int,
    req: UserUpdateRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin")),
):
    if user_id == current_user["id"]:
        return error("You cannot edit yourself", status=400)
    try:
        role_id = _resolve_role_id(req, current_user["company_id"])
        user = users_db.update_user(
            user_id=user_id,
            company_id=current_user["company_id"],
            actor_id=current_user["id"],
            display_name=req.display_name,
            role_id=role_id,
            ip_address=request.client.host,
        )
        return success("User updated", user=user)
    except ValueError as e:
        return error(str(e))


@router.patch("/{user_id}/role")
def update_user_role(
    user_id: int,
    req: UserUpdateRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin")),
):
    if user_id == current_user["id"]:
        return error("You cannot edit yourself", status=400)
    try:
        role_id = _resolve_role_id(req, current_user["company_id"])
        if role_id is None:
            return error("Role is required")
        user = users_db.update_user(
            user_id=user_id,
            company_id=current_user["company_id"],
            actor_id=current_user["id"],
            role_id=role_id,
            ip_address=request.client.host,
        )
        return success("User role updated", user=user)
    except ValueError as e:
        return error(str(e))


@router.patch("/{user_id}/access")
def toggle_user_access(
    user_id: int,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin")),
):
    if user_id == current_user["id"]:
        return error("You cannot deactivate yourself", status=400)
    try:
        user = users_db.toggle_access(
            user_id=user_id,
            company_id=current_user["company_id"],
            actor_id=current_user["id"],
            ip_address=request.client.host,
        )
        return success("User access updated", user=user)
    except ValueError as e:
        return error(str(e))


@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin")),
):
    if user_id == current_user["id"]:
        return error("You cannot delete yourself", status=400)
    try:
        users_db.deactivate_user(
            user_id=user_id,
            company_id=current_user["company_id"],
            actor_id=current_user["id"],
            ip_address=request.client.host,
        )
        return success("User deleted")
    except ValueError as e:
        return error(str(e))
