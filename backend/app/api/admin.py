"""Admin API — user management and invite code generation."""

import secrets
import time as _time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.auth.dependencies import get_current_admin

router = APIRouter(tags=["admin"])


# ---------- Request models ----------


class BlockRequest(BaseModel):
    blocked: bool


class AdminRoleRequest(BaseModel):
    is_admin: bool


class GenerateCodeRequest(BaseModel):
    expires_in_days: int | None = None


# ---------- User management ----------


@router.get("/admin/users")
async def list_users(
    admin: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all users."""
    result = await db.execute(
        text(
            "SELECT id, name, email, is_admin, is_blocked, created_at "
            "FROM users ORDER BY created_at DESC"
        )
    )
    rows = result.fetchall()
    return [
        {
            "id": str(r.id),
            "name": r.name,
            "email": r.email,
            "is_admin": r.is_admin,
            "is_blocked": r.is_blocked,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.delete("/admin/users/{user_id}")
async def delete_user(
    user_id: str,
    admin: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Delete a user (cascades to vehicles, group memberships, etc.)."""
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    result = await db.execute(
        text("DELETE FROM users WHERE id = :id RETURNING id"),
        {"id": user_id},
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="User not found")

    await db.commit()
    return {"status": "deleted"}


@router.patch("/admin/users/{user_id}/block")
async def block_user(
    user_id: str,
    req: BlockRequest,
    admin: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Block or unblock a user."""
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot block yourself")

    result = await db.execute(
        text(
            "UPDATE users SET is_blocked = :blocked, updated_at = NOW() "
            "WHERE id = :id RETURNING id"
        ),
        {"blocked": req.blocked, "id": user_id},
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="User not found")

    await db.commit()
    return {"status": "blocked" if req.blocked else "unblocked"}


@router.patch("/admin/users/{user_id}/admin")
async def set_admin_role(
    user_id: str,
    req: AdminRoleRequest,
    admin: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Promote or demote a user to/from admin."""
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot change your own admin status")

    result = await db.execute(
        text(
            "UPDATE users SET is_admin = :is_admin, updated_at = NOW() "
            "WHERE id = :id RETURNING id"
        ),
        {"is_admin": req.is_admin, "id": user_id},
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="User not found")

    await db.commit()
    return {"status": "promoted" if req.is_admin else "demoted"}


# ---------- Invite codes ----------


@router.get("/admin/invite-codes")
async def list_invite_codes(
    admin: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all invite codes with their status."""
    result = await db.execute(
        text(
            "SELECT ic.id, ic.code, ic.expires_at, ic.created_at, ic.used_at, "
            "  creator.name AS created_by_name, "
            "  consumer.name AS used_by_name "
            "FROM invite_codes ic "
            "JOIN users creator ON creator.id = ic.created_by "
            "LEFT JOIN users consumer ON consumer.id = ic.used_by "
            "ORDER BY ic.created_at DESC"
        )
    )
    rows = result.fetchall()
    return [
        {
            "id": str(r.id),
            "code": r.code,
            "created_by_name": r.created_by_name,
            "used_by_name": r.used_by_name,
            "used_at": r.used_at.isoformat() if r.used_at else None,
            "expires_at": r.expires_at.isoformat() if r.expires_at else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "status": (
                "used"
                if r.used_by_name
                else (
                    "expired"
                    if r.expires_at and r.expires_at.timestamp() < _time.time()
                    else "available"
                )
            ),
        }
        for r in rows
    ]


@router.post("/admin/invite-codes")
async def generate_invite_code(
    req: GenerateCodeRequest = GenerateCodeRequest(),
    admin: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Generate a new invite code."""
    code = secrets.token_urlsafe(6)  # produces 8-char string

    params: dict = {"code": code, "created_by": admin["id"]}

    if req.expires_in_days is not None:
        params["interval"] = f"{req.expires_in_days} days"
        sql = (
            "INSERT INTO invite_codes (code, created_by, expires_at) "
            "VALUES (:code, :created_by, NOW() + :interval::interval) "
            "RETURNING id, code, expires_at, created_at"
        )
    else:
        sql = (
            "INSERT INTO invite_codes (code, created_by) "
            "VALUES (:code, :created_by) "
            "RETURNING id, code, expires_at, created_at"
        )

    result = await db.execute(text(sql), params)
    row = result.fetchone()
    await db.commit()

    return {
        "id": str(row.id),
        "code": row.code,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.delete("/admin/invite-codes/{code_id}")
async def delete_invite_code(
    code_id: str,
    admin: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Delete an unused invite code."""
    result = await db.execute(
        text(
            "DELETE FROM invite_codes WHERE id = :id AND used_by IS NULL "
            "RETURNING id"
        ),
        {"id": code_id},
    )
    if not result.fetchone():
        raise HTTPException(
            status_code=400,
            detail="Code not found or already used (used codes cannot be deleted)",
        )
    await db.commit()
    return {"status": "deleted"}
