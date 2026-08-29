"""Dependências FastAPI e helpers de consulta compartilhados."""
from __future__ import annotations

import aiosqlite
from fastapi import Depends, Header, HTTPException, status

from .database import db
from .security import decode_token


async def get_current_user(authorization: str = Header(default="")) -> aiosqlite.Row:
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token ausente")
    user_id = decode_token(authorization[7:].strip())
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido ou expirado")
    row = await db.fetchone("SELECT * FROM users WHERE id = ?", (user_id,))
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuário não encontrado")
    return row


CurrentUser = Depends(get_current_user)


def public_user(row: aiosqlite.Row) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "avatar": row["avatar"] if "avatar" in row.keys() else None,
    }


async def channel_members(channel_id: int) -> list[aiosqlite.Row]:
    return await db.fetchall(
        """
        SELECT u.* FROM channel_members cm
        JOIN users u ON u.id = cm.user_id
        WHERE cm.channel_id = ?
        ORDER BY u.username COLLATE NOCASE
        """,
        (channel_id,),
    )


async def is_member(channel_id: int, user_id: int) -> bool:
    row = await db.fetchone(
        "SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?",
        (channel_id, user_id),
    )
    return row is not None


async def require_member(channel_id: int, user_id: int) -> None:
    if not await is_member(channel_id, user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Você não participa deste canal")


async def serialize_channel(channel_id: int) -> dict:
    ch = await db.fetchone("SELECT * FROM channels WHERE id = ?", (channel_id,))
    members = await channel_members(channel_id)
    return {
        "id": ch["id"],
        "type": ch["type"],
        "name": ch["name"],
        "owner_id": ch["owner_id"],
        "members": [public_user(m) for m in members],
    }
