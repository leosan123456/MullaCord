"""Diretório de usuários do servidor — para achar quem adicionar."""
from __future__ import annotations

from fastapi import APIRouter, Query

from ..database import db
from ..deps import CurrentUser

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("")
async def list_users(
    user=CurrentUser,
    q: str = Query(default="", max_length=64),
    limit: int = Query(default=30, le=100),
) -> list[dict]:
    """Lista/busca contas deste servidor (menos você), com o status de amizade."""
    like = f"%{q.strip()}%"
    rows = await db.fetchall(
        """
        SELECT u.id, u.username, u.display_name, u.avatar,
               f.id AS fid, f.status AS fstatus, f.requester_id
        FROM users u
        LEFT JOIN friendships f
          ON (f.requester_id = u.id AND f.addressee_id = ?)
          OR (f.addressee_id = u.id AND f.requester_id = ?)
        WHERE u.id != ?
          AND (? = '' OR u.username LIKE ? OR u.display_name LIKE ?)
        ORDER BY u.display_name COLLATE NOCASE
        LIMIT ?
        """,
        (user["id"], user["id"], user["id"], q.strip(), like, like, limit),
    )
    out = []
    for r in rows:
        if r["fstatus"] == "accepted":
            rel = "friend"
        elif r["fstatus"] == "pending":
            rel = "outgoing" if r["requester_id"] == user["id"] else "incoming"
        else:
            rel = "none"
        out.append({
            "id": r["id"],
            "username": r["username"],
            "display_name": r["display_name"],
            "avatar": r["avatar"],
            "relationship": rel,
        })
    return out
