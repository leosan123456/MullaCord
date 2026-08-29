"""Canais: DMs e grupos."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from ..database import db
from ..deps import CurrentUser, require_member, serialize_channel
from ..realtime.manager import manager
from ..schemas import CreateGroupIn, OpenDMIn

router = APIRouter(prefix="/api/channels", tags=["channels"])


async def _are_friends(a: int, b: int) -> bool:
    row = await db.fetchone(
        """
        SELECT 1 FROM friendships
        WHERE status = 'accepted'
          AND ((requester_id = ? AND addressee_id = ?)
            OR (requester_id = ? AND addressee_id = ?))
        """,
        (a, b, b, a),
    )
    return row is not None


async def _find_dm(a: int, b: int) -> int | None:
    row = await db.fetchone(
        """
        SELECT c.id FROM channels c
        JOIN channel_members m1 ON m1.channel_id = c.id AND m1.user_id = ?
        JOIN channel_members m2 ON m2.channel_id = c.id AND m2.user_id = ?
        WHERE c.type = 'dm'
        LIMIT 1
        """,
        (a, b),
    )
    return row["id"] if row else None


@router.get("")
async def my_channels(user=CurrentUser) -> list[dict]:
    rows = await db.fetchall(
        "SELECT channel_id FROM channel_members WHERE user_id = ?", (user["id"],)
    )
    return [await serialize_channel(r["channel_id"]) for r in rows]


@router.post("/dm", status_code=status.HTTP_201_CREATED)
async def open_dm(body: OpenDMIn, user=CurrentUser) -> dict:
    if body.user_id == user["id"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "DM consigo mesmo não faz sentido")
    other = await db.fetchone("SELECT * FROM users WHERE id = ?", (body.user_id,))
    if other is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuário não encontrado")
    if not await _are_friends(user["id"], body.user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Vocês precisam ser amigos")

    existing = await _find_dm(user["id"], body.user_id)
    if existing:
        return await serialize_channel(existing)

    cur = await db.execute("INSERT INTO channels (type) VALUES ('dm')", ())
    channel_id = cur.lastrowid
    await db.execute(
        "INSERT INTO channel_members (channel_id, user_id) VALUES (?, ?), (?, ?)",
        (channel_id, user["id"], channel_id, body.user_id),
    )
    payload = await serialize_channel(channel_id)
    await manager.notify_user(body.user_id, {"t": "channel_create", "channel": payload})
    return payload


@router.post("/group", status_code=status.HTTP_201_CREATED)
async def create_group(body: CreateGroupIn, user=CurrentUser) -> dict:
    member_ids = {user["id"], *body.member_ids}
    for mid in member_ids:
        if mid != user["id"] and not await _are_friends(user["id"], mid):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Usuário {mid} não é seu amigo")

    cur = await db.execute(
        "INSERT INTO channels (type, name, owner_id) VALUES ('group', ?, ?)",
        (body.name, user["id"]),
    )
    channel_id = cur.lastrowid
    for mid in member_ids:
        await db.execute(
            "INSERT INTO channel_members (channel_id, user_id) VALUES (?, ?)",
            (channel_id, mid),
        )
    payload = await serialize_channel(channel_id)
    for mid in member_ids:
        if mid != user["id"]:
            await manager.notify_user(mid, {"t": "channel_create", "channel": payload})
    return payload


@router.post("/{channel_id}/members/{user_id}", status_code=status.HTTP_201_CREATED)
async def add_member(channel_id: int, user_id: int, user=CurrentUser) -> dict:
    ch = await db.fetchone("SELECT * FROM channels WHERE id = ?", (channel_id,))
    if ch is None or ch["type"] != "group":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Grupo não encontrado")
    await require_member(channel_id, user["id"])
    if not await _are_friends(user["id"], user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Só dá para adicionar amigos")
    await db.execute(
        "INSERT OR IGNORE INTO channel_members (channel_id, user_id) VALUES (?, ?)",
        (channel_id, user_id),
    )
    payload = await serialize_channel(channel_id)
    await manager.broadcast_channel(channel_id, {"t": "channel_update", "channel": payload})
    await manager.notify_user(user_id, {"t": "channel_create", "channel": payload})
    return payload


@router.delete("/{channel_id}/members/me", status_code=status.HTTP_204_NO_CONTENT)
async def leave_channel(channel_id: int, user=CurrentUser) -> None:
    await require_member(channel_id, user["id"])
    await db.execute(
        "DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?",
        (channel_id, user["id"]),
    )
    remaining = await db.fetchone(
        "SELECT COUNT(*) AS n FROM channel_members WHERE channel_id = ?", (channel_id,)
    )
    if remaining["n"] == 0:
        await db.execute("DELETE FROM channels WHERE id = ?", (channel_id,))
    else:
        payload = await serialize_channel(channel_id)
        await manager.broadcast_channel(channel_id, {"t": "channel_update", "channel": payload})
