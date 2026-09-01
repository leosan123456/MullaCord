"""Consultas e regras compartilhadas de guilds/canais/permissões."""
from __future__ import annotations

import secrets

from fastapi import HTTPException, status

from .database import db
from .permissions import (
    DEFAULT_EVERYONE,
    base_permissions,
    channel_permissions,
    has,
)


# ---------------------------------------------------------------- membros / cargos
async def is_member(guild_id: int, user_id: int) -> bool:
    row = await db.fetchone(
        "SELECT 1 FROM guild_members WHERE guild_id = ? AND user_id = ?", (guild_id, user_id)
    )
    return row is not None


async def guild_owner_id(guild_id: int) -> int | None:
    row = await db.fetchone("SELECT owner_id FROM guilds WHERE id = ?", (guild_id,))
    return row["owner_id"] if row else None


async def everyone_role(guild_id: int):
    return await db.fetchone(
        "SELECT * FROM roles WHERE guild_id = ? AND is_default = 1", (guild_id,)
    )


async def member_role_rows(guild_id: int, user_id: int) -> list:
    """Cargos do membro + o @everyone, ordenados por posição desc."""
    return await db.fetchall(
        """
        SELECT r.* FROM roles r
        WHERE r.guild_id = ?
          AND (r.is_default = 1 OR r.id IN (
              SELECT role_id FROM member_roles WHERE guild_id = ? AND user_id = ?
          ))
        ORDER BY r.position DESC
        """,
        (guild_id, guild_id, user_id),
    )


async def top_role_position(guild_id: int, user_id: int) -> int:
    rows = await member_role_rows(guild_id, user_id)
    return max((r["position"] for r in rows), default=0)


# ---------------------------------------------------------------- permissões
async def guild_permissions(guild_id: int, user_id: int) -> int:
    owner = await guild_owner_id(guild_id)
    roles = await member_role_rows(guild_id, user_id)
    return base_permissions([r["permissions"] for r in roles], is_owner=(owner == user_id))


async def channel_perms(channel_id: int, user_id: int) -> int:
    ch = await db.fetchone("SELECT * FROM channels WHERE id = ?", (channel_id,))
    if ch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Canal não encontrado")
    if ch["guild_id"] is None:
        # dm/group: acesso por participação, todas as permissões de conversa.
        member = await db.fetchone(
            "SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?",
            (channel_id, user_id),
        )
        return DEFAULT_EVERYONE if member else 0

    gid = ch["guild_id"]
    owner = await guild_owner_id(gid)
    roles = await member_role_rows(gid, user_id)
    base = base_permissions([r["permissions"] for r in roles], is_owner=(owner == user_id))
    ev = await everyone_role(gid)
    ows = await db.fetchall(
        "SELECT target_type, target_id, allow, deny FROM channel_overwrites WHERE channel_id = ?",
        (channel_id,),
    )
    return channel_permissions(
        base,
        is_owner=(owner == user_id),
        overwrites=[dict(o) for o in ows],
        everyone_role_id=ev["id"] if ev else 0,
        member_role_ids={r["id"] for r in roles},
        user_id=user_id,
    )


async def require_guild_perm(guild_id: int, user_id: int, flag: int) -> None:
    if not await is_member(guild_id, user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Você não está neste servidor")
    if not has(await guild_permissions(guild_id, user_id), flag):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Permissão insuficiente")


async def require_channel_perm(channel_id: int, user_id: int, flag: int) -> int:
    perms = await channel_perms(channel_id, user_id)
    if not has(perms, flag):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Permissão insuficiente")
    return perms


# ---------------------------------------------------------------- serialização
def _role(r) -> dict:
    return {
        "id": r["id"],
        "guild_id": r["guild_id"],
        "name": r["name"],
        "color": r["color"],
        "permissions": r["permissions"],
        "position": r["position"],
        "hoist": bool(r["hoist"]),
        "mentionable": bool(r["mentionable"]),
        "is_default": bool(r["is_default"]),
    }


def _channel(c, overwrites: list) -> dict:
    return {
        "id": c["id"],
        "type": c["type"],
        "name": c["name"],
        "topic": c["topic"],
        "guild_id": c["guild_id"],
        "category_id": c["category_id"],
        "position": c["position"],
        "overwrites": [
            {"target_type": o["target_type"], "target_id": o["target_id"],
             "allow": o["allow"], "deny": o["deny"]}
            for o in overwrites
        ],
    }


async def serialize_guild(guild_id: int) -> dict:
    g = await db.fetchone("SELECT * FROM guilds WHERE id = ?", (guild_id,))
    if g is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Servidor não encontrado")

    roles = await db.fetchall(
        "SELECT * FROM roles WHERE guild_id = ? ORDER BY position DESC", (guild_id,)
    )
    cats = await db.fetchall(
        "SELECT * FROM categories WHERE guild_id = ? ORDER BY position, id", (guild_id,)
    )
    chans = await db.fetchall(
        "SELECT * FROM channels WHERE guild_id = ? ORDER BY position, id", (guild_id,)
    )
    all_ows = await db.fetchall(
        """
        SELECT o.* FROM channel_overwrites o
        JOIN channels c ON c.id = o.channel_id
        WHERE c.guild_id = ?
        """,
        (guild_id,),
    )
    ows_by_channel: dict[int, list] = {}
    for o in all_ows:
        ows_by_channel.setdefault(o["channel_id"], []).append(o)

    members = await db.fetchall(
        """
        SELECT u.id, u.username, u.display_name, u.avatar, gm.nickname
        FROM guild_members gm JOIN users u ON u.id = gm.user_id
        WHERE gm.guild_id = ?
        """,
        (guild_id,),
    )
    mr = await db.fetchall(
        "SELECT user_id, role_id FROM member_roles WHERE guild_id = ?", (guild_id,)
    )
    roles_by_user: dict[int, list[int]] = {}
    for row in mr:
        roles_by_user.setdefault(row["user_id"], []).append(row["role_id"])

    return {
        "id": g["id"],
        "name": g["name"],
        "icon": g["icon"],
        "owner_id": g["owner_id"],
        "roles": [_role(r) for r in roles],
        "categories": [
            {"id": c["id"], "name": c["name"], "position": c["position"]} for c in cats
        ],
        "channels": [_channel(c, ows_by_channel.get(c["id"], [])) for c in chans],
        "members": [
            {
                "id": m["id"],
                "username": m["username"],
                "display_name": m["display_name"],
                "avatar": m["avatar"],
                "nickname": m["nickname"],
                "role_ids": roles_by_user.get(m["id"], []),
            }
            for m in members
        ],
    }


async def user_guild_ids(user_id: int) -> list[int]:
    rows = await db.fetchall(
        "SELECT guild_id FROM guild_members WHERE user_id = ?", (user_id,)
    )
    return [r["guild_id"] for r in rows]


# ---------------------------------------------------------------- criação
async def create_default_layout(guild_id: int, owner_id: int) -> None:
    """@everyone + categoria Geral + canais #geral e Voz Geral."""
    from .replication import next_id

    await db.execute(
        """INSERT INTO roles (id, guild_id, name, color, permissions, position, is_default)
           VALUES (?, ?, '@everyone', NULL, ?, 0, 1)""",
        (await next_id(), guild_id, DEFAULT_EVERYONE),
    )
    cat_id = await next_id()
    await db.execute(
        "INSERT INTO categories (id, guild_id, name, position) VALUES (?, ?, 'Geral', 0)",
        (cat_id, guild_id),
    )
    await db.execute(
        """INSERT INTO channels (id, type, name, guild_id, category_id, position)
           VALUES (?, 'text', 'geral', ?, ?, 0), (?, 'voice', 'Voz Geral', ?, ?, 1)""",
        (await next_id(), guild_id, cat_id, await next_id(), guild_id, cat_id),
    )


def new_invite_code() -> str:
    return secrets.token_urlsafe(6)
