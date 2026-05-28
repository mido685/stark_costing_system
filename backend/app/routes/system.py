from fastapi import APIRouter
from app.config import APP_NAME, APP_VERSION, ENVIRONMENT
from app.api.responses import success

router = APIRouter(
    prefix="/system",
    tags=["system"]
)


@router.get("/info")
def system_info():
    return success({
        "app_name": APP_NAME,
        "version": APP_VERSION,
        "environment": ENVIRONMENT,
    })