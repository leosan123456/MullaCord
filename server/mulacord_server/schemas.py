"""Modelos Pydantic de request/response."""
from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, field_validator

# E-mail como string simples: nada de checagem de DNS (o servidor roda offline
# na casa do usuário). Só validamos o formato básico. É OPCIONAL.
Email = Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=254)]


class RegisterIn(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_.-]+$")
    email: Email | None = None
    password: str = Field(min_length=6, max_length=128)
    display_name: str | None = Field(default=None, max_length=64)

    @field_validator("email")
    @classmethod
    def _check_email(cls, v: str | None) -> str | None:
        if v in (None, ""):
            return None
        import re
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
            raise ValueError("e-mail inválido")
        return v


class LoginIn(BaseModel):
    username_or_email: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


class UserOut(BaseModel):
    id: int
    username: str
    display_name: str
    avatar: str | None = None
    email: str | None = None


class PublicUser(BaseModel):
    id: int
    username: str
    display_name: str
    avatar: str | None = None


class ProfilePatch(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=64)
    avatar: str | None = Field(default=None, max_length=400_000)  # data URL base64


class FriendRequestIn(BaseModel):
    username: str


class FriendshipOut(BaseModel):
    id: int
    user: PublicUser
    status: str
    direction: str  # incoming | outgoing | friend


class CreateGroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    member_ids: list[int] = Field(default_factory=list)


class OpenDMIn(BaseModel):
    user_id: int


class ChannelOut(BaseModel):
    id: int
    type: str
    name: str | None
    owner_id: int | None
    members: list[PublicUser]


class MessageOut(BaseModel):
    id: int
    channel_id: int
    author: PublicUser
    content: str
    created_at: str


class SendMessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


TokenOut.model_rebuild()
