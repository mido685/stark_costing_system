from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError
from app.security import auth
from app.database.periods import get_period_status
from app.database.modules import company_has_module
security = HTTPBearer()

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    if credentials is None or credentials.credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = auth.decode_token(credentials.credentials)
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
def require_roles(*roles: str):
    def checker(current_user: dict = Depends(get_current_user)):
        if current_user.get("role") not in roles:
            raise HTTPException(
                status_code=403, detail={"error": "Insufficient permissions"}
            )
        return current_user
    return checker


def require_superadmin(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") != "superadmin":
        raise HTTPException(
            status_code=403, detail={"error": "System owner access required"}
        )
    return current_user


def check_period_open(entry_date: str, current_user: dict) -> None:
    period = str(entry_date)[:7]
    status = get_period_status(current_user["company_id"], period)
    if status.get("status") in ("closed", "locked"):
        raise HTTPException(
            status_code=409,
            detail={"error": "This accounting period is closed"},
        )
def require_module(module_key: str):
    def checker(current_user: dict = Depends(get_current_user)):
        company_id = current_user.get("company_id")
        if company_id is None:
            # superadmin tokens have no company_id — always allow
            return current_user

        if not company_has_module(company_id, module_key):
            raise HTTPException(
                status_code=403,
                detail={"error": f"Your plan does not include the {module_key} module"},
            )
        return current_user
    return checker
