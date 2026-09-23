from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel

from app.database.rbac import (
    list_roles, get_role, add_role, update_role, toggle_role,
    list_permissions, add_permission,
    get_role_permissions, assign_permission_to_role, revoke_permission_from_role,
    get_user_permissions, set_user_permission_override, remove_user_permission_override,
    list_user_branches, assign_user_to_branch, remove_user_from_branch,
)
from app.security.dependencies import get_current_user, require_roles

router = APIRouter(prefix="/rbac", tags=["RBAC"])


# ── Request Schemas ── (unchanged)
class RoleRequest(BaseModel):
    name: str
    description: str = ""

class RoleUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None

class PermissionRequest(BaseModel):
    name: str
    description: str = ""

class RolePermissionRequest(BaseModel):
    permission_id: int

class UserPermissionOverrideRequest(BaseModel):
    permission_id: int
    is_allowed: bool

class UserBranchRequest(BaseModel):
    branch_id: int


def _company(request: Request) -> int:
    company_id = request.state.user.get("company_id")
    if not company_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return company_id


def _actor(request: Request) -> int | None:
    return request.state.user.get("id")


def _ip(request: Request) -> str:
    return request.client.host if request.client else None


# ── Roles ──

@router.get("/roles")
def route_list_roles(request: Request, current_user: dict = Depends(get_current_user)):
    return list_roles(_company(request))


@router.get("/roles/{role_id}")
def route_get_role(role_id: int, request: Request, current_user: dict = Depends(get_current_user)):
    role = get_role(role_id, _company(request))
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    return role


@router.post("/roles", status_code=201)
def route_add_role(
    body: RoleRequest, request: Request,
    current_user: dict = Depends(require_roles("owner", "admin")),
):
    try:
        return add_role(
            company_id=_company(request), name=body.name, description=body.description,
            actor_id=_actor(request), ip_address=_ip(request),
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.patch("/roles/{role_id}")
def route_update_role(
    role_id: int, body: RoleUpdateRequest, request: Request,
    current_user: dict = Depends(require_roles("owner", "admin")),
):
    try:
        return update_role(
            role_id=role_id, company_id=_company(request), name=body.name,
            description=body.description, actor_id=_actor(request), ip_address=_ip(request),
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.patch("/roles/{role_id}/toggle")
def route_toggle_role(
    role_id: int, request: Request,
    current_user: dict = Depends(require_roles("owner", "admin")),
):
    try:
        return toggle_role(
            role_id=role_id, company_id=_company(request),
            actor_id=_actor(request), ip_address=_ip(request),
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Permissions ──
# Note: list_permissions/add_permission are global (no company scoping in the
# db layer), so a plain user could still see the full permission catalog via
# GET — that's fine (metadata, not sensitive). POST stays admin/owner-only.

@router.get("/permissions")
def route_list_permissions(current_user: dict = Depends(get_current_user)):
    return list_permissions()


@router.post("/permissions", status_code=201)
def route_add_permission(
    body: PermissionRequest,
    current_user: dict = Depends(require_roles("owner", "admin")),
):
    try:
        return add_permission(name=body.name, description=body.description)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


# ── Role-Permissions ──

@router.get("/roles/{role_id}/permissions")
def route_get_role_permissions(role_id: int, request: Request, current_user: dict = Depends(get_current_user)):
    try:
        return get_role_permissions(role_id, _company(request))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/roles/{role_id}/permissions", status_code=201)
def route_assign_permission(
    role_id: int, body: RolePermissionRequest, request: Request,
    current_user: dict = Depends(require_roles("owner", "admin")),
):
    try:
        return assign_permission_to_role(
            role_id=role_id, permission_id=body.permission_id, company_id=_company(request),
            actor_id=_actor(request), ip_address=_ip(request),
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/roles/{role_id}/permissions/{permission_id}")
def route_revoke_permission(
    role_id: int, permission_id: int, request: Request,
    current_user: dict = Depends(require_roles("owner", "admin")),
):
    try:
        return revoke_permission_from_role(
            role_id=role_id, permission_id=permission_id, company_id=_company(request),
            actor_id=_actor(request), ip_address=_ip(request),
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── User-Permissions ──

@router.get("/users/{user_id}/permissions")
def route_get_user_permissions(user_id: int, request: Request, current_user: dict = Depends(get_current_user)):
    try:
        return get_user_permissions(user_id, _company(request))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/users/{user_id}/permissions", status_code=201)
def route_set_user_permission(
    user_id: int, body: UserPermissionOverrideRequest, request: Request,
    current_user: dict = Depends(require_roles("owner", "admin")),
):
    try:
        return set_user_permission_override(
            user_id=user_id, permission_id=body.permission_id, is_allowed=body.is_allowed,
            company_id=_company(request), actor_id=_actor(request), ip_address=_ip(request),
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/users/{user_id}/permissions/{permission_id}")
def route_remove_user_permission(
    user_id: int, permission_id: int, request: Request,
    current_user: dict = Depends(require_roles("owner", "admin")),
):
    try:
        return remove_user_permission_override(
            user_id=user_id, permission_id=permission_id, company_id=_company(request),
            actor_id=_actor(request), ip_address=_ip(request),
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── User-Branches ──
# Branch assignment governs which data a user can see/act on — treated the
# same as role/permission changes.

@router.get("/users/{user_id}/branches")
def route_list_user_branches(user_id: int, request: Request, current_user: dict = Depends(get_current_user)):
    try:
        return list_user_branches(user_id, _company(request))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/users/{user_id}/branches", status_code=201)
def route_assign_branch(
    user_id: int, body: UserBranchRequest, request: Request,
    current_user: dict = Depends(require_roles("owner", "admin")),
):
    try:
        return assign_user_to_branch(
            user_id=user_id, branch_id=body.branch_id, company_id=_company(request),
            actor_id=_actor(request), ip_address=_ip(request),
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/users/{user_id}/branches/{branch_id}")
def route_remove_branch(
    user_id: int, branch_id: int, request: Request,
    current_user: dict = Depends(require_roles("owner", "admin")),
):
    try:
        return remove_user_from_branch(
            user_id=user_id, branch_id=branch_id, company_id=_company(request),
            actor_id=_actor(request), ip_address=_ip(request),
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))