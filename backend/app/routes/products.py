import shutil
from pathlib import Path
from fastapi import APIRouter, Request, Depends, Query, UploadFile, File
from app.api.responses import success, error
from app.schemas import ProductRequest, ProductUpdateRequest, ItemRequest
from app.database import products as products_db
from app.database import ingredients as ingredients_db
from app.security.dependencies import get_current_user, require_roles

router = APIRouter(prefix="/products", tags=["products"])

UPLOAD_DIR = Path("app/static/item_images")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_SIZE_MB   = 5


# ── Products ──────────────────────────────────────────────────────────────────

@router.get("")
def list_products(current_user: dict = Depends(get_current_user)):
    products = products_db.list_products(current_user["company_id"])
    return success("Products retrieved", products=products)


# ── Items (unified view: finished goods + raw materials) ──────────────────────

@router.get("/items")
def list_items(
    category: str = Query(""),
    current_user: dict = Depends(get_current_user),
):
    company_id = current_user["company_id"]
    items = []

    if category in ("", "finished_good"):
        for p in products_db.list_products(company_id):
            items.append({
                "id":            p["id"],
                "display_number": p.get("product_number") or p["id"],
                "product_number": p.get("product_number"),
                "name":          p["name"],
                "sku":           p.get("sku") or f"FG-{p['id']}",
                "category":      "finished_good",
                "unit":          p.get("unit", ""),
                "sale_price":    float(p.get("sale_price") or 0),
                "reorder_level": 0,
                "standard_cost": float(p.get("sale_price") or 0),
                "image_url":     p.get("image_url") or None,
            })

    if category in ("", "raw_material"):
        for i in ingredients_db.list_ingredients(company_id):
            items.append({
                "id":            i["id"],
                "display_number": i.get("ingredient_number") or i["id"],
                "ingredient_number": i.get("ingredient_number"),
                "name":          i["name"],
                "sku":           i.get("sku") or f"RM-{i['id']}",
                "category":      "raw_material",
                "unit":          i.get("unit", ""),
                "sale_price":    0,
                "reorder_level": float(i.get("reorder_level") or 0),
                "standard_cost": float(i.get("cost_per_unit") or 0),
                "image_url":     i.get("image_url") or None,
            })

    return success("Items retrieved", items=sorted(items, key=lambda x: x["name"]))


@router.post("/items")
@router.post("/items")
def create_item(
    req: ItemRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    try:

        if req.category == "raw_material":
            item = ingredients_db.add_ingredient(
                name=req.name,
                unit=req.unit,
                company_id=current_user["company_id"],
                user_id=current_user["id"],
                cost_per_unit=req.standard_cost,
                reorder_level=req.reorder_level,
                sku=req.sku,
                sku_prefix=req.sku_prefix,
                ip_address=request.client.host,
            )

        else:
            item = products_db.add_product(
                name=req.name,
                company_id=current_user["company_id"],
                user_id=current_user["id"],
                unit=req.unit,
                sale_price=req.sale_price,
                sku=req.sku,
                sku_prefix=req.sku_prefix,
                ip_address=request.client.host,
            )

        return success("Item created", item=item)

    except ValueError as e:
        return error(str(e))

    except psycopg2.errors.UniqueViolation:
        return error("Item already exists")

    except Exception as e:
        print("create_item error:", repr(e))
        return error("Unexpected server error")# ── Image Upload ──────────────────────────────────────────────────────────────

@router.post("/{item_id}/image")
async def upload_item_image(
    item_id: int,
    file: UploadFile = File(...),
    category: str = Query(...),
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    import traceback
    try:
        if file.content_type not in ALLOWED_TYPES:
            return error("Only JPG, PNG, or WEBP images are allowed", status=400)

        contents = await file.read()
        if len(contents) > MAX_SIZE_MB * 1024 * 1024:
            return error(f"Image must be under {MAX_SIZE_MB}MB", status=400)

        ext      = (file.filename or "image.jpg").rsplit(".", 1)[-1].lower()
        filename = f"{category}_{current_user['company_id']}_{item_id}.{ext}"
        dest     = UPLOAD_DIR / filename
        dest.write_bytes(contents)

        image_url = f"/static/item_images/{filename}"

        if category == "raw_material":
            ingredients_db.update_image(item_id, current_user["company_id"], image_url)
        else:
            products_db.update_image(item_id, current_user["company_id"], image_url)

        return success("Image uploaded", image_url=image_url)

    except Exception as e:
        traceback.print_exc()
        return error(f"Upload failed: {str(e)}", status=500)

# ── Single product ────────────────────────────────────────────────────────────

@router.get("/{product_id}")
def get_product(
    product_id: int,
    current_user: dict = Depends(get_current_user),
):
    product = products_db.get_product(product_id, current_user["company_id"])
    if not product:
        return error("Product not found", status=404)
    return success("Product retrieved", product=product)


@router.post("")
def create_product(
    req: ProductRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    try:
        product = products_db.add_product(
            name=req.name,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            unit=req.unit,
            sale_price=req.sale_price,
            sku=req.sku,
            ip_address=request.client.host,
        )
        return success("Product created", product=product)
    except ValueError as e:
        return error(str(e))


@router.put("/{product_id}")
def update_product(
    product_id: int,
    req: ProductUpdateRequest,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin", "manager")),
):
    try:
        product = products_db.update_product(
            product_id=product_id,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            name=req.name,
            unit=req.unit,
            sale_price=req.sale_price,
            sku=req.sku,
            ip_address=request.client.host,
        )
        return success("Product updated", product=product)
    except ValueError as e:
        return error(str(e))


@router.delete("/{product_id}")
def delete_product(
    product_id: int,
    request: Request,
    current_user: dict = Depends(require_roles("owner", "admin")),
):
    try:
        products_db.deactivate_product(
            product_id=product_id,
            company_id=current_user["company_id"],
            user_id=current_user["id"],
            ip_address=request.client.host,
        )
        return success("Product deleted")
    except ValueError as e:
        return error(str(e))
