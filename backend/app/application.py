from fastapi.staticfiles import StaticFiles
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import schema as db
from app.config import APP_NAME, APP_VERSION
from dotenv import load_dotenv
from pathlib import Path
import os

load_dotenv(Path(__file__).parent / ".env")


def _cors_origins() -> list[str]:
    configured = os.getenv("CORS_ORIGINS", "")
    extra_origins = [origin.strip() for origin in configured.split(",") if origin.strip()]
    return [
        "https://stark-costing-system.vercel.app",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        *extra_origins,
    ]


def create_app() -> FastAPI:
    application = FastAPI(title=APP_NAME, version=APP_VERSION)

    application.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins(),
        allow_origin_regex=r"https://(.*\.vercel\.app|.*\.trycloudflare\.com)",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    os.makedirs("app/static/logos", exist_ok=True)
    application.mount("/static", StaticFiles(directory="app/static"), name="static")

    db.init_db()

    from app.routes import (
        approvals as approvals_router,
        auth as auth_router,
        branches as branches_router,
        cash_purchases as cash_purchases_router,
        damage as damage_router,
        expenses as expenses_router,
        ingredients as ingredients_router,
        inventory as inventory_router,
        products as products_router,
        production as production_router,
        purchases as purchases_router,
        recipes as recipes_router,
        reports as reports_router,
        revenues as revenues_router,
        sales as sales_router,
        suppliers as suppliers_router,
        superadmin as superadmin_router,
        user as user_router,
        waste as waste_router,
        rbac as rbac_router,
        system as system_router,
        sku_prefixes as sku_prefixes_router,
        Periods as periods_router,
        system_logs as system_logs_router,   # ← added
    )

    application.include_router(system_router.router,        prefix="/api")
    application.include_router(approvals_router.router,     prefix="/api")
    application.include_router(auth_router.router,          prefix="/api")
    application.include_router(branches_router.router,      prefix="/api")
    application.include_router(cash_purchases_router.router,prefix="/api")
    application.include_router(expenses_router.router,      prefix="/api")
    application.include_router(inventory_router.router,     prefix="/api")
    application.include_router(products_router.router,      prefix="/api")
    application.include_router(production_router.router,    prefix="/api")
    application.include_router(purchases_router.router,     prefix="/api")
    application.include_router(ingredients_router.router,   prefix="/api")
    application.include_router(recipes_router.router,       prefix="/api")
    application.include_router(reports_router.router,       prefix="/api")
    application.include_router(revenues_router.router,      prefix="/api")
    application.include_router(sales_router.router,         prefix="/api")
    application.include_router(suppliers_router.router,     prefix="/api")
    application.include_router(superadmin_router.router,    prefix="/api")
    application.include_router(waste_router.router,         prefix="/api")
    application.include_router(damage_router.router,        prefix="/api")
    application.include_router(user_router.router,          prefix="/api")
    application.include_router(rbac_router.router,          prefix="/api")
    application.include_router(sku_prefixes_router.router,  prefix="/api")
    application.include_router(periods_router.router,       prefix="/api")
    application.include_router(system_logs_router.router,   prefix="/api")   # ← added

    return application