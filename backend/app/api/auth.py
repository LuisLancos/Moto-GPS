"""Authentication API — register, login, profile management."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.auth.passwords import hash_password, verify_password
from app.auth.jwt import create_access_token
from app.auth.dependencies import get_current_user

router = APIRouter(tags=["auth"])


# ---------- Request / Response models ----------


class RegisterRequest(BaseModel):
    code: str
    name: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    token: str
    user: dict


class UpdateProfileRequest(BaseModel):
    name: str | None = None
    email: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


# ---------- Endpoints ----------


@router.post("/auth/register")
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Register a new user with an invite code."""
    # 1. Validate invite code — give specific error messages
    code_stripped = req.code.strip()
    result = await db.execute(
        text(
            "SELECT id, code, used_by, expires_at FROM invite_codes "
            "WHERE code = :code"
        ),
        {"code": code_stripped},
    )
    invite = result.fetchone()
    if not invite:
        raise HTTPException(status_code=400, detail="Invite code not found. Please check the code and try again.")
    if invite.used_by is not None:
        raise HTTPException(status_code=400, detail="This invite code has already been used.")
    if invite.expires_at is not None and invite.expires_at.timestamp() < __import__("time").time():
        raise HTTPException(status_code=400, detail="This invite code has expired. Please request a new one.")

    # 2. Check email uniqueness
    result = await db.execute(
        text("SELECT id FROM users WHERE email = :email"),
        {"email": req.email.lower().strip()},
    )
    if result.fetchone():
        raise HTTPException(status_code=400, detail="Email already registered")

    # 3. Validate password
    if len(req.password) < 8:
        raise HTTPException(
            status_code=400, detail="Password must be at least 8 characters"
        )

    # 4. Create user
    pw_hash = hash_password(req.password)
    result = await db.execute(
        text(
            "INSERT INTO users (name, email, password_hash) "
            "VALUES (:name, :email, :pw_hash) "
            "RETURNING id, name, email, is_admin"
        ),
        {
            "name": req.name.strip(),
            "email": req.email.lower().strip(),
            "pw_hash": pw_hash,
        },
    )
    user_row = result.fetchone()

    # 5. Mark invite code as used
    await db.execute(
        text(
            "UPDATE invite_codes SET used_by = :user_id, used_at = NOW() "
            "WHERE id = :invite_id"
        ),
        {"user_id": str(user_row.id), "invite_id": str(invite.id)},
    )

    await db.commit()

    # 6. Generate JWT
    token = create_access_token(str(user_row.id), user_row.is_admin)

    return {
        "token": token,
        "user": {
            "id": str(user_row.id),
            "name": user_row.name,
            "email": user_row.email,
            "is_admin": user_row.is_admin,
        },
    }


@router.post("/auth/login")
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Login with email and password."""
    result = await db.execute(
        text(
            "SELECT id, email, name, password_hash, is_admin, is_blocked, preferences "
            "FROM users WHERE email = :email"
        ),
        {"email": req.email.lower().strip()},
    )
    row = result.fetchone()

    if not row or not verify_password(req.password, row.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if row.is_blocked:
        raise HTTPException(status_code=403, detail="Account is blocked")

    token = create_access_token(str(row.id), row.is_admin)

    return {
        "token": token,
        "user": {
            "id": str(row.id),
            "name": row.name,
            "email": row.email,
            "is_admin": row.is_admin,
            "preferences": row.preferences if hasattr(row, "preferences") else {},
        },
    }


@router.get("/auth/me")
async def get_me(user: dict = Depends(get_current_user)):
    """Get current user profile."""
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "is_admin": user["is_admin"],
        "preferences": user.get("preferences", {}),
    }


@router.patch("/auth/me")
async def update_me(
    req: UpdateProfileRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update current user profile (name and/or email)."""
    updates = {}
    if req.name is not None:
        updates["name"] = req.name.strip()
    if req.email is not None:
        new_email = req.email.lower().strip()
        # Check uniqueness
        result = await db.execute(
            text("SELECT id FROM users WHERE email = :email AND id != :uid"),
            {"email": new_email, "uid": user["id"]},
        )
        if result.fetchone():
            raise HTTPException(status_code=400, detail="Email already in use")
        updates["email"] = new_email

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_parts = ", ".join(f"{k} = :{k}" for k in updates)
    updates["uid"] = user["id"]
    await db.execute(
        text(f"UPDATE users SET {set_parts}, updated_at = NOW() WHERE id = :uid"),
        updates,
    )
    await db.commit()

    return {"status": "updated"}


@router.patch("/auth/preferences")
async def update_preferences(
    prefs: dict,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update user preferences (units, etc.)."""
    import json
    # Merge with existing preferences
    existing = user.get("preferences", {}) or {}
    existing.update(prefs)

    await db.execute(
        text("UPDATE users SET preferences = :prefs, updated_at = NOW() WHERE id = :id"),
        {"prefs": json.dumps(existing), "id": user["id"]},
    )
    await db.commit()
    return {"preferences": existing}


@router.post("/auth/change-password")
async def change_password(
    req: ChangePasswordRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Change the current user's password."""
    # Verify current password
    result = await db.execute(
        text("SELECT password_hash FROM users WHERE id = :id"),
        {"id": user["id"]},
    )
    row = result.fetchone()
    if not row or not verify_password(req.current_password, row.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    if len(req.new_password) < 8:
        raise HTTPException(
            status_code=400, detail="New password must be at least 8 characters"
        )

    new_hash = hash_password(req.new_password)
    await db.execute(
        text(
            "UPDATE users SET password_hash = :pw, updated_at = NOW() WHERE id = :id"
        ),
        {"pw": new_hash, "id": user["id"]},
    )
    await db.commit()

    return {"status": "password_changed"}
