"""Adventure Group models."""

from pydantic import BaseModel


class GroupCreate(BaseModel):
    name: str
    description: str | None = None
    target_date: str | None = None  # ISO date
    duration_days: int | None = None


class GroupUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    target_date: str | None = None
    duration_days: int | None = None


class InviteUserRequest(BaseModel):
    user_id: str
    role: str = "viewer"  # editor | viewer


class ChangeRoleRequest(BaseModel):
    role: str  # editor | viewer


class ShareItemRequest(BaseModel):
    item_type: str  # trip | route
    item_id: str
