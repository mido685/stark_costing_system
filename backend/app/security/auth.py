"""
auth.py  ─  JWT + bcrypt authentication
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import jwt

SECRET_KEY         = os.getenv("JWT_SECRET", "change-this-secret-in-production-min-32")
ALGORITHM          = "HS256"
TOKEN_EXPIRE_HOURS = int(os.getenv("TOKEN_EXPIRE_HOURS", "12"))

def hash_password(password: str) -> str:
    hashed = bcrypt.hashpw(password[:72].encode("utf-8"), bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain[:72].encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(data: dict[str, Any]) -> str:
    # role_id is optional for superadmin (who has no company)
    required = {"id", "username", "role"}
    missing = required - data.keys()
    if missing:
        raise ValueError(f"Token data missing required fields: {missing}")
    payload = {**data, "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS)}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])