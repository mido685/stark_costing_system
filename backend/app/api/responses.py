from fastapi import HTTPException


def success(message: str = "OK", **extra) -> dict:
    if not isinstance(message, str):
        return {"success": True, "message": "OK", "data": message}

    if "data" in extra and len(extra) == 1:
        data = extra["data"]
    elif len(extra) == 1:
        data = next(iter(extra.values()))
    elif extra:
        data = extra
    else:
        data = None

    return {"success": True, "message": message, "data": data}


def error(message: str, status: int = 400):
    raise HTTPException(
        status_code=status,
        detail={"success": False, "error": message},
    )
