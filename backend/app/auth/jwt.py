"""JWT token creation and validation."""

from datetime import datetime, timedelta, timezone

import jwt

from app.config import settings


def create_access_token(user_id: str, is_admin: bool = False) -> str:
    """Create a JWT access token for the given user."""
    payload = {
        "sub": user_id,
        "is_admin": is_admin,
        "exp": datetime.now(timezone.utc)
        + timedelta(minutes=settings.jwt_expire_minutes),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    """Decode and validate a JWT token. Returns payload dict.
    Raises jwt.ExpiredSignatureError or jwt.InvalidTokenError on failure."""
    return jwt.decode(
        token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
    )
