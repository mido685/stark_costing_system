from fastapi import HTTPException  # add this
def success(message: str = "OK", **extra) -> dict:
    return {"success": True, "message": message, **extra}


def error(message: str, status: int = 400):
    raise HTTPException(
        status_code=status,
        detail={"success": False, "error": message},
    )
