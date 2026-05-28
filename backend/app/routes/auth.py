"""Routes: authentication, company registration, health."""

from __future__ import annotations
import os, shutil, uuid
from fastapi import APIRouter, Form, UploadFile, File, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.api.responses import error, success
from dotenv import load_dotenv
from app.database import auth as auth_db
from app.database.connection import get_connection, dict_cursor
from app.schemas import LoginRequest
from app.security import auth
from app.security.dependencies import require_superadmin
from app.config import APP_NAME, APP_VERSION

router = APIRouter(prefix="/auth", tags=["auth"])
bearer = HTTPBearer()

LOGO_DIR = "app/static/logos"
os.makedirs(LOGO_DIR, exist_ok=True)

# ── Superadmin credentials from environment ───────────────────────────────────
SUPERADMIN_USERNAME = os.getenv("SUPERADMIN_USERNAME", "stark")
SUPERADMIN_PASSWORD = os.getenv("SUPERADMIN_PASSWORD", "stark@admin123")


# ─────────────────────────────────────────────────────────────────────────────
# Health & Auth
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/health")
def health():
    return success("API is running.", service=APP_NAME, version=APP_VERSION)


@router.post("/register")
async def register(
    company_name:       str             = Form(...),
    company_slug:       str             = Form(...),
    owner_username:     str             = Form(...),
    owner_display_name: str             = Form(...),
    owner_password:     str             = Form(...),
    logo: UploadFile | None             = File(None),
):
    logo_url = None
    if logo and logo.filename:
        ext      = logo.filename.rsplit(".", 1)[-1].lower()
        filename = f"{company_slug.lower().strip()}_{uuid.uuid4().hex[:8]}.{ext}"
        filepath = os.path.join(LOGO_DIR, filename)
        with open(filepath, "wb") as f:
            shutil.copyfileobj(logo.file, f)
        logo_url = f"/static/logos/{filename}"

    try:
        result = auth_db.register_company(
            company_name=company_name,
            company_slug=company_slug,
            owner_username=owner_username,
            owner_display_name=owner_display_name,
            owner_password=owner_password,
            logo_url=logo_url,
        )
        return success("Company registered", **result)
    except ValueError as e:
        return error(str(e))


@router.post("/login")
def login(req: LoginRequest):
    try:
        user_data = auth_db.login_user(
            company_slug=req.company_slug,
            username=req.username,
            password=req.password,
        )
        token = auth.create_token(user_data)
        return success("Login successful", token=token, user=user_data)
    except ValueError as e:
        return error(str(e), status=401)


@router.post("/superadmin/login")
def superadmin_login(req: LoginRequest):
    if req.username != SUPERADMIN_USERNAME or req.password != SUPERADMIN_PASSWORD:
        return error("Invalid superadmin credentials", status=401)

    user_data = {
        "id":           0,
        "username":     SUPERADMIN_USERNAME,
        "display_name": "System Owner",
        "role":         "superadmin",
        "company_id":   None,
        "company_logo": None,
    }
    token = auth.create_token(user_data)
    return success("Login successful", token=token, user=user_data)


@router.get("/me")
def me(credentials: HTTPAuthorizationCredentials = Depends(bearer)):
    try:
        payload = auth.decode_token(credentials.credentials)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    if payload.get("role") == "superadmin":
        return success("OK", user={
            "id":           0,
            "username":     payload.get("username", "superadmin"),
            "display_name": "System Owner",
            "role":         "superadmin",
            "company_id":   None,
            "company_logo": None,
        })

    user_id    = payload.get("id")
    company_id = payload.get("company_id")
    if not user_id or not company_id:
        raise HTTPException(status_code=401, detail="Malformed token")

    conn = get_connection()
    cur  = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT
                u.id,
                u.username,
                u.display_name,
                u.company_id,
                r.name     AS role,
                c.logo_url AS company_logo
            FROM app_users u
            JOIN roles     r ON r.id = u.role_id
            JOIN companies c ON c.id = u.company_id
            WHERE u.id = %s
              AND u.company_id = %s
              AND u.is_active = TRUE
        """, (user_id, company_id))
        user = cur.fetchone()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return success("OK", user=dict(user))
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Superadmin — Companies
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/companies")
def list_companies(_: dict = Depends(require_superadmin)):
    try:
        companies = auth_db.list_companies()
        return success("Companies retrieved", companies=companies)
    except ValueError as e:
        return error(str(e), status=401)


@router.patch("/superadmin/companies/{company_id}/activate")
def activate_company(company_id: int, _: dict = Depends(require_superadmin)):
    """Set company is_active = TRUE."""
    conn = get_connection()
    cur  = dict_cursor(conn)
    try:
        cur.execute(
            "UPDATE companies SET is_active = TRUE WHERE id = %s RETURNING id, name",
            (company_id,),
        )
        row = cur.fetchone()
        if not row:
            return error("Company not found", status=404)
        conn.commit()
        return success("Company activated", company=dict(row))
    except Exception as e:
        conn.rollback()
        return error(str(e), status=500)
    finally:
        cur.close()
        conn.close()


@router.patch("/superadmin/companies/{company_id}/deactivate")
def deactivate_company(company_id: int, _: dict = Depends(require_superadmin)):
    """Set company is_active = FALSE — users can no longer log in."""
    conn = get_connection()
    cur  = dict_cursor(conn)
    try:
        cur.execute(
            "UPDATE companies SET is_active = FALSE WHERE id = %s RETURNING id, name",
            (company_id,),
        )
        row = cur.fetchone()
        if not row:
            return error("Company not found", status=404)
        conn.commit()
        return success("Company deactivated", company=dict(row))
    except Exception as e:
        conn.rollback()
        return error(str(e), status=500)
    finally:
        cur.close()
        conn.close()


@router.delete("/superadmin/companies/{company_id}/purge")
def purge_company_data(company_id: int, _: dict = Depends(require_superadmin)):
    """
    Wipe all operational data for a company while keeping the company
    account and its users intact.

    Adjust the table list below to match your schema — order matters
    for FK constraints (most-dependent first).
    """
    conn = get_connection()
    cur  = conn.cursor()
    try:
        # Verify the company exists first
        cur.execute("SELECT id, name FROM companies WHERE id = %s", (company_id,))
        row = cur.fetchone()
        if not row:
            return error("Company not found", status=404)

        # ── Delete operational data (FK order: child → parent) ────────────────
        tables = [
            "finished_goods_movements",
            "production_orders",
            "purchase_order_items",
            "purchase_orders",
            "inventory_movements",
            "sales",
            "recipe_ingredients",
            "recipes",
            "inventory_items",
            "suppliers",
            "categories",
        ]
        for table in tables:
            cur.execute(
                f"DELETE FROM {table} WHERE company_id = %s",  # noqa: S608
                (company_id,),
            )

        conn.commit()
        return success(f"All data purged for company {row[1]}")
    except Exception as e:
        conn.rollback()
        return error(str(e), status=500)
    finally:
        cur.close()
        conn.close()


@router.delete("/superadmin/companies/{company_id}")
def delete_company(company_id: int, _: dict = Depends(require_superadmin)):
    """Permanently delete a company and cascade-remove all its data."""
    conn = get_connection()
    cur  = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT id, name FROM companies WHERE id = %s", (company_id,)
        )
        row = cur.fetchone()
        if not row:
            return error("Company not found", status=404)

        # If your schema has ON DELETE CASCADE this single statement is enough.
        # Otherwise purge child tables first (same order as purge_company_data).
        cur.execute("DELETE FROM companies WHERE id = %s", (company_id,))
        conn.commit()
        return success(f"Company '{row['name']}' deleted")
    except Exception as e:
        conn.rollback()
        return error(str(e), status=500)
    finally:
        cur.close()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Superadmin — Company Users
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/superadmin/companies/{company_id}/users")
def list_company_users(company_id: int, _: dict = Depends(require_superadmin)):
    conn = get_connection()
    cur  = dict_cursor(conn)
    try:
        cur.execute("""
            SELECT
                u.id,
                u.username,
                u.display_name,
                u.role_id,
                r.name  AS role,
                u.is_active,
                u.created_at
            FROM app_users u
            JOIN roles r ON r.id = u.role_id
            WHERE u.company_id = %s
            ORDER BY u.created_at
        """, (company_id,))
        users = [dict(row) for row in cur.fetchall()]
        return success("Users retrieved", users=users)
    finally:
        cur.close()
        conn.close()


@router.get("/superadmin/companies/{company_id}/roles")
def list_company_roles(company_id: int, _: dict = Depends(require_superadmin)):
    conn = get_connection()
    cur  = dict_cursor(conn)
    try:
        cur.execute(
            "SELECT id, name FROM roles WHERE company_id = %s ORDER BY id",
            (company_id,),
        )
        roles = [dict(row) for row in cur.fetchall()]
        return success("Roles retrieved", roles=roles)
    finally:
        cur.close()
        conn.close()


@router.post("/superadmin/companies/{company_id}/users")
def create_company_user(
    company_id: int,
    body: dict,
    _: dict = Depends(require_superadmin),
):
    from app.security.auth import hash_password  # reuse your existing helper

    username     = (body.get("username") or "").strip().lower()
    display_name = (body.get("display_name") or "").strip()
    password     = body.get("password") or ""
    role_id      = body.get("role_id")

    if not username or not display_name or not password or not role_id:
        return error("username, display_name, password, and role_id are required", status=422)

    conn = get_connection()
    cur  = dict_cursor(conn)
    try:
        # Check username uniqueness within company
        cur.execute(
            "SELECT id FROM app_users WHERE company_id = %s AND username = %s",
            (company_id, username),
        )
        if cur.fetchone():
            return error("Username already exists in this company", status=409)

        hashed = hash_password(password)
        cur.execute("""
            INSERT INTO app_users (company_id, username, display_name, password_hash, role_id, is_active)
            VALUES (%s, %s, %s, %s, %s, TRUE)
            RETURNING id, username, display_name, role_id, is_active, created_at
        """, (company_id, username, display_name, hashed, role_id))
        user = dict(cur.fetchone())
        conn.commit()
        return success("User created", user=user)
    except Exception as e:
        conn.rollback()
        return error(str(e), status=500)
    finally:
        cur.close()
        conn.close()


@router.delete("/superadmin/companies/{company_id}/users/{user_id}")
def disable_company_user(
    company_id: int,
    user_id: int,
    _: dict = Depends(require_superadmin),
):
    """Soft-delete: set is_active = FALSE."""
    conn = get_connection()
    cur  = dict_cursor(conn)
    try:
        cur.execute("""
            UPDATE app_users
            SET is_active = FALSE
            WHERE id = %s AND company_id = %s
            RETURNING id, username
        """, (user_id, company_id))
        row = cur.fetchone()
        if not row:
            return error("User not found", status=404)
        conn.commit()
        return success("User suspended", user=dict(row))
    except Exception as e:
        conn.rollback()
        return error(str(e), status=500)
    finally:
        cur.close()
        conn.close()


@router.patch("/superadmin/companies/{company_id}/users/{user_id}/restore")
def restore_company_user(
    company_id: int,
    user_id: int,
    _: dict = Depends(require_superadmin),
):
    """Restore a suspended user: set is_active = TRUE."""
    conn = get_connection()
    cur  = dict_cursor(conn)
    try:
        cur.execute("""
            UPDATE app_users
            SET is_active = TRUE
            WHERE id = %s AND company_id = %s
            RETURNING id, username
        """, (user_id, company_id))
        row = cur.fetchone()
        if not row:
            return error("User not found", status=404)
        conn.commit()
        return success("User restored", user=dict(row))
    except Exception as e:
        conn.rollback()
        return error(str(e), status=500)
    finally:
        cur.close()
        conn.close()