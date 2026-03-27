"""Adventure Groups API — groups, members, invitations, sharing."""

from datetime import date as dt_date
from uuid import UUID

from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.auth.dependencies import get_current_user
from app.models.group import (
    GroupCreate,
    GroupUpdate,
    InviteUserRequest,
    ChangeRoleRequest,
    ShareItemRequest,
)

router = APIRouter(tags=["groups"])

VALID_ROLES = {"owner", "editor", "viewer"}


# ---------- Helpers ----------

async def _check_group_role(
    db: AsyncSession, group_id: str, user_id: str, required_roles: list[str],
) -> str:
    """Returns the user's role if in required_roles, else raises 403."""
    result = await db.execute(
        text("SELECT role FROM group_members WHERE group_id = :gid AND user_id = :uid"),
        {"gid": group_id, "uid": user_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=403, detail="Not a member of this group")
    if row.role not in required_roles:
        raise HTTPException(
            status_code=403,
            detail=f"Requires role: {', '.join(required_roles)}",
        )
    return row.role


# ---------- Group CRUD ----------

@router.post("/groups")
async def create_group(
    req: GroupCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new adventure group. Creator becomes owner."""
    target_date = dt_date.fromisoformat(req.target_date) if req.target_date else None

    result = await db.execute(
        text(
            "INSERT INTO adventure_groups (name, description, target_date, duration_days, created_by) "
            "VALUES (:name, :desc, :date, :dur, :uid) "
            "RETURNING id, created_at"
        ),
        {
            "name": req.name.strip(),
            "desc": req.description,
            "date": target_date,
            "dur": req.duration_days,
            "uid": user["id"],
        },
    )
    group = result.fetchone()

    # Add creator as owner
    await db.execute(
        text(
            "INSERT INTO group_members (group_id, user_id, role) "
            "VALUES (:gid, :uid, 'owner')"
        ),
        {"gid": str(group.id), "uid": user["id"]},
    )
    await db.commit()

    return {
        "id": str(group.id),
        "created_at": group.created_at.isoformat(),
    }


@router.get("/groups")
async def list_groups(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List groups the current user belongs to."""
    result = await db.execute(
        text("""
            SELECT g.id, g.name, g.description, g.target_date, g.duration_days,
                   g.created_by, g.created_at, gm.role,
                   (SELECT COUNT(*) FROM group_members gm2 WHERE gm2.group_id = g.id) AS member_count,
                   (SELECT COUNT(*) FROM group_shared_items gsi WHERE gsi.group_id = g.id) AS shared_item_count
            FROM adventure_groups g
            JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = :uid
            ORDER BY g.created_at DESC
        """),
        {"uid": user["id"]},
    )
    return [
        {
            "id": str(r.id),
            "name": r.name,
            "description": r.description,
            "target_date": r.target_date.isoformat() if r.target_date else None,
            "duration_days": r.duration_days,
            "created_by": str(r.created_by),
            "member_count": r.member_count,
            "shared_item_count": r.shared_item_count,
            "my_role": r.role,
            "created_at": r.created_at.isoformat() if r.created_at else "",
        }
        for r in result.fetchall()
    ]


@router.get("/groups/{group_id}")
async def get_group(
    group_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get group detail with members and shared items."""
    await _check_group_role(db, str(group_id), user["id"], ["owner", "editor", "viewer"])

    # Group info
    result = await db.execute(
        text("SELECT * FROM adventure_groups WHERE id = :id"),
        {"id": str(group_id)},
    )
    g = result.fetchone()
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")

    # Members
    members_result = await db.execute(
        text("""
            SELECT gm.user_id, u.name, u.email, gm.role, gm.joined_at
            FROM group_members gm
            JOIN users u ON u.id = gm.user_id
            WHERE gm.group_id = :gid
            ORDER BY gm.role, u.name
        """),
        {"gid": str(group_id)},
    )
    members = [
        {
            "user_id": str(m.user_id),
            "name": m.name,
            "email": m.email,
            "role": m.role,
            "joined_at": m.joined_at.isoformat() if m.joined_at else "",
        }
        for m in members_result.fetchall()
    ]

    # Shared items
    shared_result = await db.execute(
        text("""
            SELECT gsi.id, gsi.item_type, gsi.item_id, gsi.shared_at,
                   u.name AS shared_by_name,
                   CASE
                     WHEN gsi.item_type = 'route' THEN (SELECT name FROM saved_routes WHERE id = gsi.item_id)
                     WHEN gsi.item_type = 'trip' THEN (SELECT name FROM trips WHERE id = gsi.item_id)
                   END AS item_name,
                   CASE
                     WHEN gsi.item_type = 'route' THEN (SELECT total_distance_m FROM saved_routes WHERE id = gsi.item_id)
                     WHEN gsi.item_type = 'trip' THEN (SELECT total_distance_m FROM trips WHERE id = gsi.item_id)
                   END AS item_distance_m
            FROM group_shared_items gsi
            JOIN users u ON u.id = gsi.shared_by
            WHERE gsi.group_id = :gid
            ORDER BY gsi.shared_at DESC
        """),
        {"gid": str(group_id)},
    )
    shared_items = [
        {
            "id": str(s.id),
            "item_type": s.item_type,
            "item_id": str(s.item_id),
            "shared_by_name": s.shared_by_name,
            "item_name": s.item_name or "Unnamed",
            "item_distance_m": s.item_distance_m,
            "shared_at": s.shared_at.isoformat() if s.shared_at else "",
        }
        for s in shared_result.fetchall()
    ]

    # My role
    role_result = await db.execute(
        text("SELECT role FROM group_members WHERE group_id = :gid AND user_id = :uid"),
        {"gid": str(group_id), "uid": user["id"]},
    )
    my_role = role_result.fetchone().role

    return {
        "id": str(g.id),
        "name": g.name,
        "description": g.description,
        "target_date": g.target_date.isoformat() if g.target_date else None,
        "duration_days": g.duration_days,
        "created_by": str(g.created_by),
        "created_at": g.created_at.isoformat() if g.created_at else "",
        "my_role": my_role,
        "members": members,
        "shared_items": shared_items,
    }


@router.patch("/groups/{group_id}")
async def update_group(
    group_id: UUID,
    req: GroupUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update group metadata (owner only)."""
    await _check_group_role(db, str(group_id), user["id"], ["owner"])

    updates = {}
    if req.name is not None:
        updates["name"] = req.name.strip()
    if req.description is not None:
        updates["description"] = req.description
    if req.target_date is not None:
        updates["target_date"] = req.target_date
    if req.duration_days is not None:
        updates["duration_days"] = req.duration_days

    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")

    set_parts = ", ".join(f"{k} = :{k}" for k in updates)
    updates["gid"] = str(group_id)
    await db.execute(
        text(f"UPDATE adventure_groups SET {set_parts}, updated_at = NOW() WHERE id = :gid"),
        updates,
    )
    await db.commit()
    return {"status": "updated"}


@router.delete("/groups/{group_id}")
async def delete_group(
    group_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a group (owner only, cascades)."""
    await _check_group_role(db, str(group_id), user["id"], ["owner"])
    await db.execute(
        text("DELETE FROM adventure_groups WHERE id = :gid"),
        {"gid": str(group_id)},
    )
    await db.commit()
    return {"status": "deleted"}


# ---------- Members ----------

@router.post("/groups/{group_id}/invite")
async def invite_user(
    group_id: UUID,
    req: InviteUserRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Invite a user to the group (owner only)."""
    await _check_group_role(db, str(group_id), user["id"], ["owner"])

    if req.role not in ("editor", "viewer"):
        raise HTTPException(status_code=400, detail="Role must be 'editor' or 'viewer'")

    # Check target user exists
    result = await db.execute(
        text("SELECT id FROM users WHERE id = :uid"),
        {"uid": req.user_id},
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="User not found")

    # Check not already a member
    result = await db.execute(
        text("SELECT id FROM group_members WHERE group_id = :gid AND user_id = :uid"),
        {"gid": str(group_id), "uid": req.user_id},
    )
    if result.fetchone():
        raise HTTPException(status_code=400, detail="User is already a member")

    # Create or update invitation
    await db.execute(
        text("""
            INSERT INTO group_invitations (group_id, invited_by, invited_user_id, role, status)
            VALUES (:gid, :inviter, :invitee, :role, 'pending')
            ON CONFLICT (group_id, invited_user_id)
            DO UPDATE SET role = :role, status = 'pending', responded_at = NULL, invited_by = :inviter
        """),
        {
            "gid": str(group_id),
            "inviter": user["id"],
            "invitee": req.user_id,
            "role": req.role,
        },
    )
    await db.commit()
    return {"status": "invited"}


@router.patch("/groups/{group_id}/members/{member_id}/role")
async def change_member_role(
    group_id: UUID,
    member_id: UUID,
    req: ChangeRoleRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Change a member's role (owner only)."""
    await _check_group_role(db, str(group_id), user["id"], ["owner"])

    if req.role not in ("editor", "viewer"):
        raise HTTPException(status_code=400, detail="Role must be 'editor' or 'viewer'")

    result = await db.execute(
        text(
            "UPDATE group_members SET role = :role "
            "WHERE group_id = :gid AND user_id = :uid AND role != 'owner' "
            "RETURNING id"
        ),
        {"role": req.role, "gid": str(group_id), "uid": str(member_id)},
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Member not found or is owner")
    await db.commit()
    return {"status": "role_changed"}


@router.delete("/groups/{group_id}/members/{member_id}")
async def remove_member(
    group_id: UUID,
    member_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a member (owner can remove anyone; members can leave)."""
    is_self = str(member_id) == user["id"]
    if not is_self:
        await _check_group_role(db, str(group_id), user["id"], ["owner"])

    # Can't remove the owner
    result = await db.execute(
        text("SELECT role FROM group_members WHERE group_id = :gid AND user_id = :uid"),
        {"gid": str(group_id), "uid": str(member_id)},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Member not found")
    if row.role == "owner":
        raise HTTPException(status_code=400, detail="Cannot remove the owner")

    await db.execute(
        text("DELETE FROM group_members WHERE group_id = :gid AND user_id = :uid"),
        {"gid": str(group_id), "uid": str(member_id)},
    )
    await db.commit()
    return {"status": "removed"}


# ---------- Invitations (for the invited user) ----------

@router.get("/invitations")
async def list_invitations(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List pending invitations for the current user."""
    result = await db.execute(
        text("""
            SELECT gi.id, gi.group_id, g.name AS group_name,
                   u.name AS invited_by_name, gi.role, gi.created_at
            FROM group_invitations gi
            JOIN adventure_groups g ON g.id = gi.group_id
            JOIN users u ON u.id = gi.invited_by
            WHERE gi.invited_user_id = :uid AND gi.status = 'pending'
            ORDER BY gi.created_at DESC
        """),
        {"uid": user["id"]},
    )
    return [
        {
            "id": str(r.id),
            "group_id": str(r.group_id),
            "group_name": r.group_name,
            "invited_by_name": r.invited_by_name,
            "role": r.role,
            "created_at": r.created_at.isoformat() if r.created_at else "",
        }
        for r in result.fetchall()
    ]


@router.post("/invitations/{invitation_id}/accept")
async def accept_invitation(
    invitation_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Accept a group invitation."""
    result = await db.execute(
        text(
            "SELECT id, group_id, role FROM group_invitations "
            "WHERE id = :id AND invited_user_id = :uid AND status = 'pending'"
        ),
        {"id": str(invitation_id), "uid": user["id"]},
    )
    inv = result.fetchone()
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation not found")

    # Add as member
    await db.execute(
        text(
            "INSERT INTO group_members (group_id, user_id, role) "
            "VALUES (:gid, :uid, :role) "
            "ON CONFLICT (group_id, user_id) DO NOTHING"
        ),
        {"gid": str(inv.group_id), "uid": user["id"], "role": inv.role},
    )

    # Mark invitation as accepted
    await db.execute(
        text(
            "UPDATE group_invitations SET status = 'accepted', responded_at = NOW() "
            "WHERE id = :id"
        ),
        {"id": str(invitation_id)},
    )
    await db.commit()
    return {"status": "accepted"}


@router.post("/invitations/{invitation_id}/decline")
async def decline_invitation(
    invitation_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Decline a group invitation."""
    result = await db.execute(
        text(
            "UPDATE group_invitations SET status = 'declined', responded_at = NOW() "
            "WHERE id = :id AND invited_user_id = :uid AND status = 'pending' "
            "RETURNING id"
        ),
        {"id": str(invitation_id), "uid": user["id"]},
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Invitation not found")
    await db.commit()
    return {"status": "declined"}


# ---------- Sharing ----------

@router.post("/groups/{group_id}/share")
async def share_item(
    group_id: UUID,
    req: ShareItemRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Share a trip or route into the group (owner or editor)."""
    await _check_group_role(db, str(group_id), user["id"], ["owner", "editor"])

    if req.item_type not in ("trip", "route"):
        raise HTTPException(status_code=400, detail="item_type must be 'trip' or 'route'")

    # Verify item exists
    table = "trips" if req.item_type == "trip" else "saved_routes"
    result = await db.execute(
        text(f"SELECT id FROM {table} WHERE id = :id"),
        {"id": req.item_id},
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Item not found")

    await db.execute(
        text(
            "INSERT INTO group_shared_items (group_id, item_type, item_id, shared_by) "
            "VALUES (:gid, :type, :item_id, :uid) "
            "ON CONFLICT DO NOTHING"
        ),
        {
            "gid": str(group_id),
            "type": req.item_type,
            "item_id": req.item_id,
            "uid": user["id"],
        },
    )
    await db.commit()
    return {"status": "shared"}


@router.get("/groups/{group_id}/shared")
async def list_shared_items(
    group_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List shared items in the group."""
    await _check_group_role(db, str(group_id), user["id"], ["owner", "editor", "viewer"])

    result = await db.execute(
        text("""
            SELECT gsi.id, gsi.item_type, gsi.item_id, gsi.shared_at,
                   u.name AS shared_by_name,
                   CASE
                     WHEN gsi.item_type = 'route' THEN (SELECT name FROM saved_routes WHERE id = gsi.item_id)
                     WHEN gsi.item_type = 'trip' THEN (SELECT name FROM trips WHERE id = gsi.item_id)
                   END AS item_name,
                   CASE
                     WHEN gsi.item_type = 'route' THEN (SELECT total_distance_m FROM saved_routes WHERE id = gsi.item_id)
                     WHEN gsi.item_type = 'trip' THEN (SELECT total_distance_m FROM trips WHERE id = gsi.item_id)
                   END AS item_distance_m
            FROM group_shared_items gsi
            JOIN users u ON u.id = gsi.shared_by
            WHERE gsi.group_id = :gid
            ORDER BY gsi.shared_at DESC
        """),
        {"gid": str(group_id)},
    )
    return [
        {
            "id": str(s.id),
            "item_type": s.item_type,
            "item_id": str(s.item_id),
            "shared_by_name": s.shared_by_name,
            "item_name": s.item_name or "Unnamed",
            "item_distance_m": s.item_distance_m,
            "shared_at": s.shared_at.isoformat() if s.shared_at else "",
        }
        for s in result.fetchall()
    ]


@router.delete("/groups/{group_id}/shared/{shared_item_id}")
async def unshare_item(
    group_id: UUID,
    shared_item_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Unshare an item (owner or the person who shared it)."""
    role = await _check_group_role(db, str(group_id), user["id"], ["owner", "editor", "viewer"])

    # Check who shared it
    result = await db.execute(
        text("SELECT shared_by FROM group_shared_items WHERE id = :id AND group_id = :gid"),
        {"id": str(shared_item_id), "gid": str(group_id)},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Shared item not found")

    if role != "owner" and str(row.shared_by) != user["id"]:
        raise HTTPException(status_code=403, detail="Only the owner or the sharer can unshare")

    await db.execute(
        text("DELETE FROM group_shared_items WHERE id = :id"),
        {"id": str(shared_item_id)},
    )
    await db.commit()
    return {"status": "unshared"}


@router.post("/groups/{group_id}/shared/{shared_item_id}/clone")
async def clone_shared_item(
    group_id: UUID,
    shared_item_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Clone a shared item to the user's own trips."""
    await _check_group_role(db, str(group_id), user["id"], ["owner", "editor", "viewer"])

    # Get shared item details
    result = await db.execute(
        text("SELECT item_type, item_id FROM group_shared_items WHERE id = :id AND group_id = :gid"),
        {"id": str(shared_item_id), "gid": str(group_id)},
    )
    item = result.fetchone()
    if not item:
        raise HTTPException(status_code=404, detail="Shared item not found")

    if item.item_type == "route":
        # Clone from saved_routes
        result = await db.execute(
            text("""
                INSERT INTO saved_routes (name, description, route_type, waypoints, preferences,
                                          route_data, total_distance_m, total_time_s, total_moto_score, user_id)
                SELECT name || ' (copy)', description, route_type, waypoints, preferences,
                       route_data, total_distance_m, total_time_s, total_moto_score, :uid
                FROM saved_routes WHERE id = :id
                RETURNING id
            """),
            {"uid": user["id"], "id": str(item.item_id)},
        )
    else:
        # Clone from trips
        result = await db.execute(
            text("""
                INSERT INTO trips (name, description, route_type, preferences, waypoints,
                                   route_data, day_overlays, daily_target_m,
                                   total_distance_m, total_time_s, total_moto_score, user_id)
                SELECT name || ' (copy)', description, route_type, preferences, waypoints,
                       route_data, day_overlays, daily_target_m,
                       total_distance_m, total_time_s, total_moto_score, :uid
                FROM trips WHERE id = :id
                RETURNING id
            """),
            {"uid": user["id"], "id": str(item.item_id)},
        )

    await db.commit()
    cloned = result.fetchone()
    return {"id": str(cloned.id) if cloned else None, "status": "cloned"}


# ---------- User search (for invitations) ----------

@router.get("/users/search")
async def search_users(
    q: str = Query(..., min_length=2),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Search users by name or email (for inviting to groups)."""
    result = await db.execute(
        text("""
            SELECT id, name, email FROM users
            WHERE (name ILIKE :q OR email ILIKE :q) AND id != :uid AND is_blocked = FALSE
            ORDER BY name LIMIT 10
        """),
        {"q": f"%{q}%", "uid": user["id"]},
    )
    return [
        {"id": str(r.id), "name": r.name, "email": r.email}
        for r in result.fetchall()
    ]
