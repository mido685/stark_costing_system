from fastapi import APIRouter, Depends, Request

from app.api.responses import error, success
from app.database import superadmin as superadmin_db
from app.schemas import UserRequest
from app.security.dependencies import require_superadmin


router = APIRouter(prefix="/superadmin", tags=["superadmin"])


@router.get("/companies")
def list_companies(_: dict = Depends(require_superadmin)):
    try:
        companies = superadmin_db.list_companies()
        return success("Companies retrieved", companies=companies)
    except ValueError as e:
        return error(str(e))


@router.get("/companies/{company_id}/roles")
def list_company_roles(company_id: int, _: dict = Depends(require_superadmin)):
    try:
        roles = superadmin_db.list_company_roles(company_id)
        return success("Roles retrieved", roles=roles)
    except ValueError as e:
        return error(str(e), status=404)


@router.patch("/companies/{company_id}/activate")
def activate_company(company_id: int, request: Request, _: dict = Depends(require_superadmin)):
    try:
        company = superadmin_db.set_company_active(company_id=company_id, is_active=True, ip_address=request.client.host)
        return success("Company activated", company=company)
    except ValueError as e:
        return error(str(e), status=404)


@router.patch("/companies/{company_id}/deactivate")
def deactivate_company(company_id: int, request: Request, _: dict = Depends(require_superadmin)):
    try:
        company = superadmin_db.set_company_active(company_id=company_id, is_active=False, ip_address=request.client.host)
        return success("Company deactivated", company=company)
    except ValueError as e:
        return error(str(e), status=404)


@router.delete("/companies/{company_id}/purge")
def purge_company_data(company_id: int, request: Request, _: dict = Depends(require_superadmin)):
    try:
        superadmin_db.purge_company_data(company_id=company_id, ip_address=request.client.host)
        return success("Company data purged")
    except ValueError as e:
        return error(str(e), status=404)


# ✅ Only ONE delete route — permanently deletes forever
@router.delete("/companies/{company_id}")
def delete_company(company_id: int, request: Request, _: dict = Depends(require_superadmin)):
    try:
        superadmin_db.delete_company_forever(company_id, ip_address=request.client.host)
        return success("Company permanently deleted")
    except ValueError as e:
        return error(str(e), status=404)


@router.get("/companies/{company_id}/users")
def list_company_users(company_id: int, _: dict = Depends(require_superadmin)):
    try:
        users = superadmin_db.list_company_users(company_id)
        return success("Users retrieved", users=users)
    except ValueError as e:
        return error(str(e), status=404)


@router.post("/companies/{company_id}/users")
def create_company_user(company_id: int, req: UserRequest, request: Request, _: dict = Depends(require_superadmin)):
    try:
        user = superadmin_db.add_company_user(
            company_id=company_id,
            username=req.username,
            display_name=req.display_name,
            role_id=req.role_id,
            password=req.password,
            ip_address=request.client.host,
        )
        return success("User created", user=user)
    except ValueError as e:
        return error(str(e), status=400)


@router.patch("/companies/{company_id}/users/{user_id}/restore")
def restore_company_user(company_id: int, user_id: int, request: Request, _: dict = Depends(require_superadmin)):
    try:
        user = superadmin_db.restore_company_user(company_id=company_id, user_id=user_id, ip_address=request.client.host)
        return success("User restored", user=user)
    except ValueError as e:
        return error(str(e), status=400)


@router.delete("/companies/{company_id}/users/{user_id}")
def delete_company_user(company_id: int, user_id: int, request: Request, _: dict = Depends(require_superadmin)):
    try:
        superadmin_db.deactivate_company_user(company_id=company_id, user_id=user_id, ip_address=request.client.host)
        return success("User suspended")
    except ValueError as e:
        return error(str(e), status=404)