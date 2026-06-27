"""Routes: authentication, company registration, health."""

from __future__ import annotations
import os, shutil, uuid
from fastapi import APIRouter, Form, UploadFile, File, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.api.responses import error, success
from app.database import auth as auth_db
from app.database.connection import get_connection, dict_cursor
from app.schemas import LoginRequest
from app.security import auth
from app.config import APP_NAME, APP_VERSION

router = APIRouter(prefix="/auth", tags=["auth"])
bearer = HTTPBearer()

LOGO_DIR = "app/static/logos"
os.makedirs(LOGO_DIR, exist_ok=True)

SUPERADMIN_USERNAME = os.getenv("SUPERADMIN_USERNAME", "stark")
SUPERADMIN_PASSWORD = os.getenv("SUPERADMIN_PASSWORD", "stark@admin123")


# ─── Health ───────────────────────────────────────────────────────────────────

@router.get("/health")
def health():
    return success("API is running.", service=APP_NAME, version=APP_VERSION)


# ─── Register ─────────────────────────────────────────────────────────────────

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


# ─── Login ────────────────────────────────────────────────────────────────────

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


# ─── Me ───────────────────────────────────────────────────────────────────────

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


# ─── Companies (public list for login dropdown) ───────────────────────────────

@router.get("/companies")
def list_companies():
    try:
        companies = auth_db.list_companies()
        return success("Companies retrieved", companies=companies)
    except ValueError as e:
        return error(str(e), status=400)