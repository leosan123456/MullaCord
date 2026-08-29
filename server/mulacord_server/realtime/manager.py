"""Gerencia conexões WebSocket ativas, presença e broadcast."""
from __future__ import annotations

import asyncio
from collections import defaultdict

from fastapi import WebSocket

from ..database import db


class ConnectionManager:
    def __init__(self) -> None:
        self._conns: dict[int, set[WebSocket]] = defaultdict(set)
        self._activity: dict[int, dict] = {}   # user_id -> {type, name, started_at}
        self._lock = asyncio.Lock()

    # -- ciclo de vida --------------------------------------------------
    async def register(self, user_id: int, ws: WebSocket) -> bool:
        async with self._lock:
            first = user_id not in self._conns or not self._conns[user_id]
            self._conns[user_id].add(ws)
        if first:
            await self._broadcast_presence(user_id, "online")
        return first

    async def unregister(self, user_id: int, ws: WebSocket) -> None:
        async with self._lock:
            self._conns.get(user_id, set()).discard(ws)
            gone = not self._conns.get(user_id)
            if gone:
                self._conns.pop(user_id, None)
        if gone:
            self._activity.pop(user_id, None)
            await self._broadcast_presence(user_id, "offline")

    # -- atividade (jogo) ---------------------------------------------
    async def set_activity(self, user_id: int, activity: dict | None) -> None:
        if activity:
            self._activity[user_id] = activity
        else:
            self._activity.pop(user_id, None)
        await self.broadcast_user_scope(
            user_id, {"t": "activity", "user_id": user_id, "activity": activity}
        )

    async def activities_for(self, user_id: int) -> dict[str, dict]:
        """Atividades de quem o usuário "vê" (amigos, co-membros) + a dele."""
        scope = set(await self._scope_user_ids(user_id)) | {user_id}
        return {str(uid): act for uid, act in self._activity.items() if uid in scope}

    def online_users(self) -> list[int]:
        return list(self._conns.keys())

    def is_online(self, user_id: int) -> bool:
        return bool(self._conns.get(user_id))

    # -- envio --------------------------------------------------------
    async def _send(self, ws: WebSocket, payload: dict) -> None:
        try:
            await ws.send_json(payload)
        except Exception:
            pass

    async def notify_user(self, user_id: int, payload: dict) -> None:
        for ws in list(self._conns.get(user_id, ())):
            await self._send(ws, payload)

    async def broadcast_channel(self, channel_id: int, payload: dict, exclude: int | None = None) -> None:
        ch = await db.fetchone("SELECT guild_id FROM channels WHERE id = ?", (channel_id,))
        if ch and ch["guild_id"] is not None:
            # Só quem enxerga o canal (respeita VIEW_CHANNEL / overwrites).
            from ..guilds_service import channel_perms
            from ..permissions import P, has

            members = await db.fetchall(
                "SELECT user_id FROM guild_members WHERE guild_id = ?", (ch["guild_id"],)
            )
            for m in members:
                uid = m["user_id"]
                if uid == exclude:
                    continue
                if has(await channel_perms(channel_id, uid), P.VIEW_CHANNEL):
                    await self.notify_user(uid, payload)
            return
        rows = await db.fetchall(
            "SELECT user_id FROM channel_members WHERE channel_id = ?", (channel_id,)
        )
        for r in rows:
            if r["user_id"] == exclude:
                continue
            await self.notify_user(r["user_id"], payload)

    async def broadcast_guild(self, guild_id: int, payload: dict, exclude: int | None = None) -> None:
        rows = await db.fetchall(
            "SELECT user_id FROM guild_members WHERE guild_id = ?", (guild_id,)
        )
        for r in rows:
            if r["user_id"] != exclude:
                await self.notify_user(r["user_id"], payload)

    async def _scope_user_ids(self, user_id: int) -> list[int]:
        """Quem "vê" esse usuário: amigos, quem compartilha dm/grupo e co-membros de guild."""
        rows = await db.fetchall(
            """
            SELECT DISTINCT uid FROM (
                SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS uid
                FROM friendships
                WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)
                UNION
                SELECT cm2.user_id AS uid
                FROM channel_members cm1
                JOIN channel_members cm2 ON cm2.channel_id = cm1.channel_id
                WHERE cm1.user_id = ?
                UNION
                SELECT gm2.user_id AS uid
                FROM guild_members gm1
                JOIN guild_members gm2 ON gm2.guild_id = gm1.guild_id
                WHERE gm1.user_id = ?
            )
            """,
            (user_id, user_id, user_id, user_id, user_id),
        )
        return [r["uid"] for r in rows if r["uid"] != user_id]

    async def broadcast_user_scope(self, user_id: int, payload: dict) -> None:
        for uid in await self._scope_user_ids(user_id):
            await self.notify_user(uid, payload)

    async def _broadcast_presence(self, user_id: int, status: str) -> None:
        await self.broadcast_user_scope(
            user_id, {"t": "presence", "user_id": user_id, "status": status}
        )


manager = ConnectionManager()
