from fastapi import APIRouter, Depends
from app.api.responses import success, error
from app.database import sku_prefixes as sku_db
from app.security.dependencies import get_current_user, require_roles
from app.schemas import SkuPrefixRequest

router = APIRouter(prefix="/sku-prefixes", tags=["sku-prefixes"])


@router.get("")
def list_prefixes(
    item_type: str = "",
    current_user: dict = Depends(get_current_user),
):
    prefixes = sku_db.list_prefixes(
        current_user["company_id"],
        item_type=item_type or None,
    )
    return success("SKU prefixes retrieved", prefixes=prefixes)


@router.post("/seed-defaults")
def seed_defaults(
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    try:
        sku_db.seed_default_prefixes(current_user["company_id"])
        return success("Default prefixes seeded")
    except Exception as e:
        return error(str(e))


@router.post("")
def add_prefix(
    req: SkuPrefixRequest,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    try:
        prefix = sku_db.add_prefix(
            company_id=current_user["company_id"],
            label=req.label,
            prefix=req.prefix,
            item_type=req.item_type,
        )
        return success("SKU prefix added", prefix=prefix)
    except ValueError as e:
        return error(str(e))


@router.delete("/{prefix_id}")
def delete_prefix(
    prefix_id: int,
    current_user: dict = Depends(require_roles("owner", "admin")),
):
    try:
        sku_db.delete_prefix(current_user["company_id"], prefix_id)
        return success("SKU prefix deleted")
    except ValueError as e:
        return error(str(e))