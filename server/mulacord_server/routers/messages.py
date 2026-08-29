"""Histórico e envio de mensagens (REST). O envio em tempo real vai pelo gateway."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status

from ..database import db
from ..deps import CurrentUser
from ..guilds_service import channel_perms
from ..permissions import P, has
from ..realtime.manager import manager
from ..schemas import SendMessageIn

router = APIRouter(prefix="/api/channels/{channel_id}/messages", tags=["messages"])


def _serialize(row) -> dict:
    return {
        "id": row["id"],
        "channel_id": row["channel_id"],
        "author": {
            "id": row["author_id"],
            "username": row["username"],
            "display_name": row["display_name"],
            "avatar": row["avatar"],
        },
        "content": row["content"],
        "created_at": row["created_at"],
        "edited_at": row["edited_at"],
    }


async def _require(channel_id: int, user_id: int, flag: int) -> None:
    ch = await db.fetchone("SELECT type FROM channels WHERE id = ?", (channel_id,))
    if ch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Canal não encontrado")
    if ch["type"] == "voice":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Canal de voz não tem chat")
    if not has(await channel_perms(channel_id, user_id), flag):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sem acesso a este canal")


@router.get("")
async def history(
    channel_id: int,
    user=CurrentUser,
    before: int | None = Query(default=None),
    limit: int = Query(default=50, le=100),
) -> list[dict]:
    await _require(channel_id, user["id"], P.VIEW_CHANNEL)
    params: list = [channel_id]
    clause = ""
    if before is not None:
        clause = "AND m.id < ?"
        params.append(before)
    params.append(limit)
    rows = await db.fetchall(
        f"""
        SELECT m.*, u.username, u.display_name, u.avatar
        FROM messages m JOIN users u ON u.id = m.author_id
        WHERE m.channel_id = ? {clause}
        ORDER BY m.id DESC
        LIMIT ?
        """,
        params,
    )
    return [_serialize(r) for r in reversed(rows)]


@router.post("", status_code=201)
async def post_message(channel_id: int, body: SendMessageIn, user=CurrentUser) -> dict:
    await _require(channel_id, user["id"], P.SEND_MESSAGES)
    msg = await create_message(channel_id, user["id"], body.content)
    await manager.broadcast_channel(channel_id, {"t": "message_create", "message": msg})
    return msg


async def _load(message_id: int, channel_id: int):
    return await db.fetchone(
        """
        SELECT m.*, u.username, u.display_name, u.avatar
        FROM messages m JOIN users u ON u.id = m.author_id
        WHERE m.id = ? AND m.channel_id = ?
        """,
        (message_id, channel_id),
    )


@router.patch("/{message_id}")
async def edit_message(channel_id: int, message_id: int, body: SendMessageIn, user=CurrentUser) -> dict:
    row = await _load(message_id, channel_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mensagem não encontrada")
    if row["author_id"] != user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Só o autor pode editar")
    await db.execute(
        "UPDATE messages SET content = ?, edited_at = datetime('now') WHERE id = ?",
        (body.content, message_id),
    )
    msg = _serialize(await _load(message_id, channel_id))
    await manager.broadcast_channel(channel_id, {"t": "message_update", "message": msg})
    return msg


@router.delete("/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(channel_id: int, message_id: int, user=CurrentUser) -> None:
    row = await _load(message_id, channel_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mensagem não encontrada")
    if row["author_id"] != user["id"]:
        await _require(channel_id, user["id"], P.MANAGE_MESSAGES)
    await db.execute("DELETE FROM messages WHERE id = ?", (message_id,))
    await manager.broadcast_channel(
        channel_id, {"t": "message_delete", "channel_id": channel_id, "message_id": message_id}
    )


async def create_message(channel_id: int, author_id: int, content: str) -> dict:
    cur = await db.execute(
        "INSERT INTO messages (channel_id, author_id, content) VALUES (?, ?, ?)",
        (channel_id, author_id, content),
    )
    row = await db.fetchone(
        """
        SELECT m.*, u.username, u.display_name, u.avatar
        FROM messages m JOIN users u ON u.id = m.author_id
        WHERE m.id = ?
        """,
        (cur.lastrowid,),
    )
    return _serialize(row)
