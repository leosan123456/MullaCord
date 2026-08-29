"""Endpoint WebSocket — o "gateway" em tempo real do Mulacord.

Protocolo: JSON. Cliente envia {"op": "...", ...}. Servidor envia {"t": "...", ...}.
Ver docs/ARCHITECTURE.md para a lista completa de eventos.
"""
from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..database import db
from ..deps import serialize_channel
from ..guilds_service import channel_perms, serialize_guild, user_guild_ids
from ..permissions import P, has
from ..security import decode_token
from ..routers.messages import create_message
from .manager import manager

router = APIRouter()

# channel_id -> {user_id} atualmente em call de voz/tela nesse canal.
_voice_rooms: dict[int, set[int]] = defaultdict(set)


async def _dm_channels_payload(user_id: int) -> list[dict]:
    rows = await db.fetchall(
        """
        SELECT cm.channel_id FROM channel_members cm
        JOIN channels c ON c.id = cm.channel_id
        WHERE cm.user_id = ? AND c.guild_id IS NULL
        """,
        (user_id,),
    )
    return [await serialize_channel(r["channel_id"]) for r in rows]


async def _friends_payload(user_id: int) -> list[dict]:
    rows = await db.fetchall(
        """
        SELECT f.id, f.status, f.requester_id,
               u.id AS uid, u.username, u.display_name, u.avatar
        FROM friendships f
        JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id
                                    ELSE f.requester_id END
        WHERE f.requester_id = ? OR f.addressee_id = ?
        """,
        (user_id, user_id, user_id),
    )
    out = []
    for r in rows:
        if r["status"] == "accepted":
            direction = "friend"
        elif r["requester_id"] == user_id:
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
                "online": manager.is_online(r["uid"]),
            }
        )
    return out


async def _voice_states_payload(guild_ids: list[int]) -> list[dict]:
    if not guild_ids:
        return []
    placeholders = ",".join("?" * len(guild_ids))
    chans = await db.fetchall(
        f"SELECT id, guild_id FROM channels WHERE type = 'voice' AND guild_id IN ({placeholders})",
        guild_ids,
    )
    states = []
    for c in chans:
        for uid in _voice_rooms.get(c["id"], ()):
            states.append({"guild_id": c["guild_id"], "channel_id": c["id"], "user_id": uid})
    return states


async def _can(channel_id, user_id: int, flag: int) -> bool:
    if not isinstance(channel_id, int):
        return False
    try:
        return has(await channel_perms(channel_id, user_id), flag)
    except Exception:
        return False


async def _guild_of(channel_id: int) -> int | None:
    row = await db.fetchone("SELECT guild_id FROM channels WHERE id = ?", (channel_id,))
    return row["guild_id"] if row else None


@router.websocket("/gateway")
async def gateway(ws: WebSocket) -> None:
    await ws.accept()
    user_id: int | None = None
    joined_voice: set[int] = set()

    try:
        hello = await ws.receive_json()
        if hello.get("op") != "identify" or not (uid := decode_token(hello.get("token", ""))):
            await ws.send_json({"t": "error", "message": "identify inválido"})
            await ws.close(code=4001)
            return
        user = await db.fetchone("SELECT * FROM users WHERE id = ?", (uid,))
        if user is None:
            await ws.close(code=4001)
            return

        user_id = uid
        await manager.register(user_id, ws)
        gids = await user_guild_ids(user_id)
        await ws.send_json(
            {
                "t": "ready",
                "user": {"id": user["id"], "username": user["username"], "display_name": user["display_name"]},
                "channels": await _dm_channels_payload(user_id),
                "friends": await _friends_payload(user_id),
                "guilds": [await serialize_guild(g) for g in gids],
                "voice_states": await _voice_states_payload(gids),
                "online": manager.online_users(),
            }
        )

        while True:
            msg = await ws.receive_json()
            op = msg.get("op")

            if op == "heartbeat":
                await ws.send_json({"t": "heartbeat_ack", "ts": msg.get("ts")})

            elif op == "send_message":
                cid, content = msg.get("channel_id"), (msg.get("content") or "").strip()
                att_ids = [str(a) for a in (msg.get("attachment_ids") or [])][:10]
                if (not content and not att_ids) or not await _can(cid, user_id, P.SEND_MESSAGES):
                    continue
                out = await create_message(cid, user_id, content[:4000], att_ids)
                await manager.broadcast_channel(cid, {"t": "message_create", "message": out})

            elif op == "typing":
                cid = msg.get("channel_id")
                if await _can(cid, user_id, P.SEND_MESSAGES):
                    await manager.broadcast_channel(
                        cid, {"t": "typing", "channel_id": cid, "user_id": user_id}, exclude=user_id
                    )

            elif op == "rtc_join":
                cid = msg.get("channel_id")
                if not await _can(cid, user_id, P.CONNECT):
                    continue
                gid = await _guild_of(cid)
                # Num servidor você só fica em um canal de voz por vez.
                if gid is not None:
                    for other in list(joined_voice):
                        if await _guild_of(other) == gid:
                            _leave_voice(other, user_id)
                            joined_voice.discard(other)
                            await manager.broadcast_channel(
                                other, {"t": "rtc_peer_leave", "channel_id": other, "user_id": user_id},
                                exclude=user_id,
                            )
                peers = sorted(_voice_rooms[cid])
                _voice_rooms[cid].add(user_id)
                joined_voice.add(cid)
                await ws.send_json({"t": "rtc_peers", "channel_id": cid, "user_ids": peers})
                for pid in peers:
                    await manager.notify_user(
                        pid, {"t": "rtc_peer_join", "channel_id": cid, "user_id": user_id}
                    )
                if gid is not None:
                    await manager.broadcast_guild(
                        gid, {"t": "voice_state_update", "guild_id": gid, "channel_id": cid, "user_id": user_id}
                    )

            elif op == "rtc_leave":
                cid = msg.get("channel_id")
                _leave_voice(cid, user_id)
                joined_voice.discard(cid)
                await manager.broadcast_channel(
                    cid, {"t": "rtc_peer_leave", "channel_id": cid, "user_id": user_id}, exclude=user_id
                )
                gid = await _guild_of(cid)
                if gid is not None:
                    await manager.broadcast_guild(
                        gid, {"t": "voice_state_update", "guild_id": gid, "channel_id": None, "user_id": user_id}
                    )

            elif op == "rtc_signal":
                cid, to = msg.get("channel_id"), msg.get("to_user_id")
                if to in _voice_rooms.get(cid, set()):
                    await manager.notify_user(
                        to,
                        {
                            "t": "rtc_signal",
                            "channel_id": cid,
                            "from_user_id": user_id,
                            "data": msg.get("data"),
                        },
                    )

    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001
        try:
            await ws.send_json({"t": "error", "message": str(exc)})
        except Exception:
            pass
    finally:
        if user_id is not None:
            for cid in list(joined_voice):
                _leave_voice(cid, user_id)
                await manager.broadcast_channel(
                    cid, {"t": "rtc_peer_leave", "channel_id": cid, "user_id": user_id}, exclude=user_id
                )
                gid = await _guild_of(cid)
                if gid is not None:
                    await manager.broadcast_guild(
                        gid, {"t": "voice_state_update", "guild_id": gid, "channel_id": None, "user_id": user_id}
                    )
            await manager.unregister(user_id, ws)


def _leave_voice(channel_id, user_id: int) -> None:
    room = _voice_rooms.get(channel_id)
    if room:
        room.discard(user_id)
        if not room:
            _voice_rooms.pop(channel_id, None)
