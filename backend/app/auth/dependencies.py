"""FastAPI dependencies for authentication and authorization."""

from fastapi import Depends, Header, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

import jwt as pyjwt

from app.db.database import get_db
from app.auth.jwt import decode_access_token


async def get_current_user(
    authorization: str = Header(..., description="Bearer <token>"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Extract and validate JWT from Authorization header.
    Returns user dict: {id, email, name, is_admin, is_blocked}.
    Raises 401 if invalid/expired token or user not found.
    Raises 403 if user is blocked."""

    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization[7:]  # strip "Bearer "

    try:
        payload = decode_access_token(token)
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    result = await db.execute(
        text(
            "SELECT id, email, name, is_admin, is_blocked, preferences "
            "FROM users WHERE id = :id"
        ),
        {"id": user_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="User not found")

    user = {
        "id": str(row.id),
        "email": row.email,
        "name": row.name,
        "is_admin": row.is_admin,
        "is_blocked": row.is_blocked,
        "preferences": row.preferences if hasattr(row, "preferences") else {},
    }

    if user["is_blocked"]:
        raise HTTPException(status_code=403, detail="Account is blocked")

    return user


async def get_current_admin(
    user: dict = Depends(get_current_user),
) -> dict:
    """Requires the current user to be an admin. Raises 403 otherwise."""
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def get_optional_user(
    authorization: str | None = Header(None),
    db: AsyncSession = Depends(get_db),
) -> dict | None:
    """Returns user dict if a valid token is present, None if no token.
    Used during migration period for backwards compatibility."""
    if not authorization or not authorization.startswith("Bearer "):
        return None

    token = authorization[7:]
    try:
        payload = decode_access_token(token)
    except (pyjwt.ExpiredSignatureError, pyjwt.InvalidTokenError):
        return None

    user_id = payload.get("sub")
    if not user_id:
        return None

    result = await db.execute(
        text(
            "SELECT id, email, name, is_admin, is_blocked, preferences "
            "FROM users WHERE id = :id"
        ),
        {"id": user_id},
    )
    row = result.fetchone()
    if not row or row.is_blocked:
        return None

    return {
        "id": str(row.id),
        "email": row.email,
        "name": row.name,
        "is_admin": row.is_admin,
        "is_blocked": row.is_blocked,
        "preferences": row.preferences if hasattr(row, "preferences") else {},
    }
