"""Pedidos de amizade e lista de amigos."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from ..database import db
from ..deps import CurrentUser, public_user
from ..realtime.manager import manager
from ..schemas import FriendRequestIn

router = APIRouter(prefix="/api/friends", tags=["friends"])


@router.get("")
async def list_friends(user=CurrentUser) -> list[dict]:
    rows = await db.fetchall(
        """
        SELECT f.id, f.status, f.requester_id, f.addressee_id,
               u.id AS uid, u.username, u.display_name, u.avatar
        FROM friendships f
        JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id
                                    ELSE f.requester_id END
        WHERE f.requester_id = ? OR f.addressee_id = ?
        ORDER BY f.created_at DESC
        """,
        (user["id"], user["id"], user["id"]),
    )
    out = []
    for r in rows:
        if r["status"] == "accepted":
            direction = "friend"
        elif r["requester_id"] == user["id"]:
            direction = "outgoing"
        else:
            direction = "incoming"
        out.append(
            {
                "id": r["id"],
                "user": {"id": r["uid"], "username": r["username"],
                         "display_name": r["display_name"], "avatar": r["avatar"]},
                "status": r["status"],
                "direction": direction,
            }
        )
    return out


@router.post("/request", status_code=status.HTTP_201_CREATED)
async def send_request(body: FriendRequestIn, user=CurrentUser) -> dict:
    target = await db.fetchone("SELECT * FROM users WHERE username = ?", (body.username,))
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuário não encontrado")
    if target["id"] == user["id"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Não dá para adicionar a si mesmo")

    existing = await db.fetchone(
        """
        SELECT * FROM friendships
        WHERE (requester_id = ? AND addressee_id = ?)
           OR (requester_id = ? AND addressee_id = ?)
        """,
        (user["id"], target["id"], target["id"], user["id"]),
    )
    if existing:
        if existing["status"] == "accepted":
            raise HTTPException(status.HTTP_409_CONFLICT, "Vocês já são amigos")
        # Pedido recíproco pendente -> aceita direto.
        if existing["addressee_id"] == user["id"]:
            await db.execute(
                "UPDATE friendships SET status = 'accepted' WHERE id = ?", (existing["id"],)
            )
            await manager.notify_user(
                target["id"], {"t": "friend_accepted", "user": public_user(user)}
            )
            return {"status": "accepted"}
        raise HTTPException(status.HTTP_409_CONFLICT, "Pedido já enviado")

    await db.execute(
        "INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'pending')",
        (user["id"], target["id"]),
    )
    await manager.notify_user(
        target["id"], {"t": "friend_request", "user": public_user(user)}
    )
    return {"status": "pending"}


@router.post("/{friendship_id}/accept")
async def accept_request(friendship_id: int, user=CurrentUser) -> dict:
    fr = await db.fetchone("SELECT * FROM friendships WHERE id = ?", (friendship_id,))
    if fr is None or fr["addressee_id"] != user["id"] or fr["status"] != "pending":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado")
    await db.execute("UPDATE friendships SET status = 'accepted' WHERE id = ?", (friendship_id,))
    await manager.notify_user(
        fr["requester_id"], {"t": "friend_accepted", "user": public_user(user)}
    )
    return {"status": "accepted"}


@router.delete("/{friendship_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_friend(friendship_id: int, user=CurrentUser) -> None:
    fr = await db.fetchone("SELECT * FROM friendships WHERE id = ?", (friendship_id,))
    if fr is None or user["id"] not in (fr["requester_id"], fr["addressee_id"]):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido não encontrado")
    await db.execute("DELETE FROM friendships WHERE id = ?", (friendship_id,))
