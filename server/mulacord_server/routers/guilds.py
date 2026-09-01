"""Servidores (guilds): criação, convites, canais, categorias, cargos, membros."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from ..database import db
from ..replication import next_id
from ..deps import CurrentUser
from ..guilds_service import (
    create_default_layout,
    guild_owner_id,
    is_member,
    new_invite_code,
    require_guild_perm,
    serialize_guild,
    top_role_position,
)
from ..permissions import P
from ..realtime.manager import manager

router = APIRouter(prefix="/api", tags=["guilds"])


# ------------------------------------------------------------------ schemas
class GuildCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    icon: str | None = None


class GuildPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    icon: str | None = None


class ChannelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    type: str = Field(pattern="^(text|voice)$")
    category_id: int | None = None
    topic: str | None = Field(default=None, max_length=1024)


class ChannelPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    topic: str | None = Field(default=None, max_length=1024)
    category_id: int | None = None
    position: int | None = None


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)


class RoleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    color: str | None = None
    permissions: int = 0
    hoist: bool = False
    mentionable: bool = False


class RolePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    color: str | None = None
    permissions: int | None = None
    hoist: bool | None = None
    mentionable: bool | None = None
    position: int | None = None


class OverwriteIn(BaseModel):
    allow: int = 0
    deny: int = 0


class InviteCreate(BaseModel):
    max_uses: int = Field(default=0, ge=0)
    expires_in: int | None = Field(default=None, ge=60, description="segundos")


class NicknameIn(BaseModel):
    nickname: str | None = Field(default=None, max_length=64)


# ------------------------------------------------------------------ guilds
@router.get("/guilds")
async def my_guilds(user=CurrentUser) -> list[dict]:
    rows = await db.fetchall(
        "SELECT guild_id FROM guild_members WHERE user_id = ?", (user["id"],)
    )
    return [await serialize_guild(r["guild_id"]) for r in rows]


@router.post("/guilds", status_code=status.HTTP_201_CREATED)
async def create_guild(body: GuildCreate, user=CurrentUser) -> dict:
    gid = await next_id()
    await db.execute(
        "INSERT INTO guilds (id, name, icon, owner_id) VALUES (?, ?, ?, ?)",
        (gid, body.name, body.icon, user["id"]),
    )
    await db.execute(
        "INSERT INTO guild_members (guild_id, user_id) VALUES (?, ?)", (gid, user["id"])
    )
    await create_default_layout(gid, user["id"])
    payload = await serialize_guild(gid)
    await manager.notify_user(user["id"], {"t": "guild_create", "guild": payload})
    return payload


@router.get("/guilds/{gid}")
async def get_guild(gid: int, user=CurrentUser) -> dict:
    if not await is_member(gid, user["id"]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Você não está neste servidor")
    return await serialize_guild(gid)


@router.patch("/guilds/{gid}")
async def patch_guild(gid: int, body: GuildPatch, user=CurrentUser) -> dict:
    await require_guild_perm(gid, user["id"], P.MANAGE_GUILD)
    sets, params = [], []
    if body.name is not None:
        sets.append("name = ?"); params.append(body.name)
    if body.icon is not None:
        sets.append("icon = ?"); params.append(body.icon)
    if sets:
        params.append(gid)
        await db.execute(f"UPDATE guilds SET {', '.join(sets)} WHERE id = ?", params)
    payload = await serialize_guild(gid)
    await manager.broadcast_guild(gid, {"t": "guild_update", "guild": payload})
    return payload


@router.delete("/guilds/{gid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_guild(gid: int, user=CurrentUser) -> None:
    if await guild_owner_id(gid) != user["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Só o dono pode apagar o servidor")
    await manager.broadcast_guild(gid, {"t": "guild_delete", "guild_id": gid})
    await db.execute("DELETE FROM guilds WHERE id = ?", (gid,))


@router.delete("/guilds/{gid}/members/@me", status_code=status.HTTP_204_NO_CONTENT)
async def leave_guild(gid: int, user=CurrentUser) -> None:
    if not await is_member(gid, user["id"]):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Você não está neste servidor")
    if await guild_owner_id(gid) == user["id"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "O dono não pode sair; apague o servidor")
    await db.execute(
        "DELETE FROM guild_members WHERE guild_id = ? AND user_id = ?", (gid, user["id"])
    )
    await db.execute(
        "DELETE FROM member_roles WHERE guild_id = ? AND user_id = ?", (gid, user["id"])
    )
    await manager.notify_user(user["id"], {"t": "guild_delete", "guild_id": gid})
    await manager.broadcast_guild(gid, {"t": "guild_member_remove", "guild_id": gid, "user_id": user["id"]})


@router.delete("/guilds/{gid}/members/{uid}", status_code=status.HTTP_204_NO_CONTENT)
async def kick_member(gid: int, uid: int, user=CurrentUser) -> None:
    await require_guild_perm(gid, user["id"], P.KICK_MEMBERS)
    if uid == await guild_owner_id(gid):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Não dá para expulsar o dono")
    if await top_role_position(gid, uid) >= await top_role_position(gid, user["id"]) \
            and user["id"] != await guild_owner_id(gid):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Alvo tem cargo igual ou superior ao seu")
    await db.execute("DELETE FROM guild_members WHERE guild_id = ? AND user_id = ?", (gid, uid))
    await db.execute("DELETE FROM member_roles WHERE guild_id = ? AND user_id = ?", (gid, uid))
    await manager.notify_user(uid, {"t": "guild_delete", "guild_id": gid})
    await manager.broadcast_guild(gid, {"t": "guild_member_remove", "guild_id": gid, "user_id": uid})


@router.patch("/guilds/{gid}/members/@me")
async def set_my_nickname(gid: int, body: NicknameIn, user=CurrentUser) -> dict:
    await require_guild_perm(gid, user["id"], P.CHANGE_NICKNAME)
    await db.execute(
        "UPDATE guild_members SET nickname = ? WHERE guild_id = ? AND user_id = ?",
        (body.nickname, gid, user["id"]),
    )
    await manager.broadcast_guild(
        gid, {"t": "guild_member_update", "guild_id": gid, "user_id": user["id"], "nickname": body.nickname}
    )
    return {"nickname": body.nickname}


# ------------------------------------------------------------------ convites
@router.post("/guilds/{gid}/invites", status_code=status.HTTP_201_CREATED)
async def create_invite(gid: int, body: InviteCreate, user=CurrentUser) -> dict:
    await require_guild_perm(gid, user["id"], P.CREATE_INVITE)
    code = new_invite_code()
    expires = None
    if body.expires_in:
        expires = (datetime.now(timezone.utc) + timedelta(seconds=body.expires_in)).isoformat()
    await db.execute(
        """INSERT INTO invites (code, guild_id, creator_id, max_uses, expires_at)
           VALUES (?, ?, ?, ?, ?)""",
        (code, gid, user["id"], body.max_uses, expires),
    )
    return {"code": code, "guild_id": gid, "max_uses": body.max_uses, "expires_at": expires}


@router.get("/invites/{code}")
async def preview_invite(code: str, user=CurrentUser) -> dict:
    inv = await db.fetchone("SELECT * FROM invites WHERE code = ?", (code,))
    if inv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Convite inválido")
    g = await db.fetchone("SELECT id, name, icon FROM guilds WHERE id = ?", (inv["guild_id"],))
    count = await db.fetchone(
        "SELECT COUNT(*) AS n FROM guild_members WHERE guild_id = ?", (inv["guild_id"],)
    )
    return {"code": code, "guild": dict(g), "member_count": count["n"]}


@router.post("/invites/{code}", status_code=status.HTTP_201_CREATED)
async def use_invite(code: str, user=CurrentUser) -> dict:
    inv = await db.fetchone("SELECT * FROM invites WHERE code = ?", (code,))
    if inv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Convite inválido")
    if inv["expires_at"] and datetime.fromisoformat(inv["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_410_GONE, "Convite expirado")
    if inv["max_uses"] and inv["uses"] >= inv["max_uses"]:
        raise HTTPException(status.HTTP_410_GONE, "Convite esgotado")

    gid = inv["guild_id"]
    if not await is_member(gid, user["id"]):
        await db.execute(
            "INSERT INTO guild_members (guild_id, user_id) VALUES (?, ?)", (gid, user["id"])
        )
        await db.execute("UPDATE invites SET uses = uses + 1 WHERE code = ?", (code,))
        await manager.broadcast_guild(
            gid,
            {"t": "guild_member_add", "guild_id": gid,
             "member": {"id": user["id"], "username": user["username"],
                        "display_name": user["display_name"],
                        "avatar": user["avatar"] if "avatar" in user.keys() else None,
                        "nickname": None, "role_ids": []}},
        )
    payload = await serialize_guild(gid)
    await manager.notify_user(user["id"], {"t": "guild_create", "guild": payload})
    return payload


# ------------------------------------------------------------------ categorias
@router.post("/guilds/{gid}/categories", status_code=status.HTTP_201_CREATED)
async def create_category(gid: int, body: CategoryCreate, user=CurrentUser) -> dict:
    await require_guild_perm(gid, user["id"], P.MANAGE_CHANNELS)
    pos = await db.fetchone(
        "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM categories WHERE guild_id = ?", (gid,)
    )
    cat_id = await next_id()
    await db.execute(
        "INSERT INTO categories (id, guild_id, name, position) VALUES (?, ?, ?, ?)",
        (cat_id, gid, body.name, pos["p"]),
    )
    await _push_guild(gid)
    return {"id": cat_id, "name": body.name, "position": pos["p"]}


@router.delete("/categories/{cat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(cat_id: int, user=CurrentUser) -> None:
    cat = await db.fetchone("SELECT * FROM categories WHERE id = ?", (cat_id,))
    if cat is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Categoria não encontrada")
    await require_guild_perm(cat["guild_id"], user["id"], P.MANAGE_CHANNELS)
    await db.execute("DELETE FROM categories WHERE id = ?", (cat_id,))
    await _push_guild(cat["guild_id"])


# ------------------------------------------------------------------ canais
@router.post("/guilds/{gid}/channels", status_code=status.HTTP_201_CREATED)
async def create_channel(gid: int, body: ChannelCreate, user=CurrentUser) -> dict:
    await require_guild_perm(gid, user["id"], P.MANAGE_CHANNELS)
    pos = await db.fetchone(
        "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM channels WHERE guild_id = ?", (gid,)
    )
    cid_new = await next_id()
    await db.execute(
        """INSERT INTO channels (id, type, name, topic, guild_id, category_id, position)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (cid_new, body.type, body.name, body.topic, gid, body.category_id, pos["p"]),
    )
    from ..guilds_service import _channel
    ch = await db.fetchone("SELECT * FROM channels WHERE id = ?", (cid_new,))
    payload = _channel(ch, [])
    await manager.broadcast_guild(gid, {"t": "channel_create", "channel": payload})
    return payload


@router.patch("/channels/{cid}")
async def patch_channel(cid: int, body: ChannelPatch, user=CurrentUser) -> dict:
    ch = await db.fetchone("SELECT * FROM channels WHERE id = ?", (cid,))
    if ch is None or ch["guild_id"] is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Canal de servidor não encontrado")
    await require_guild_perm(ch["guild_id"], user["id"], P.MANAGE_CHANNELS)
    sets, params = [], []
    for field in ("name", "topic", "category_id", "position"):
        val = getattr(body, field)
        if val is not None:
            sets.append(f"{field} = ?"); params.append(val)
    if sets:
        params.append(cid)
        await db.execute(f"UPDATE channels SET {', '.join(sets)} WHERE id = ?", params)
    return await _push_channel(cid)


@router.delete("/channels/{cid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_channel(cid: int, user=CurrentUser) -> None:
    ch = await db.fetchone("SELECT * FROM channels WHERE id = ?", (cid,))
    if ch is None or ch["guild_id"] is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Canal de servidor não encontrado")
    await require_guild_perm(ch["guild_id"], user["id"], P.MANAGE_CHANNELS)
    await db.execute("DELETE FROM channels WHERE id = ?", (cid,))
    await manager.broadcast_guild(ch["guild_id"], {"t": "channel_delete", "channel_id": cid, "guild_id": ch["guild_id"]})


@router.put("/channels/{cid}/overwrites/{target_type}/{target_id}")
async def set_overwrite(cid: int, target_type: str, target_id: int, body: OverwriteIn, user=CurrentUser) -> dict:
    if target_type not in ("role", "member"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "target_type inválido")
    ch = await db.fetchone("SELECT * FROM channels WHERE id = ?", (cid,))
    if ch is None or ch["guild_id"] is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Canal não encontrado")
    await require_guild_perm(ch["guild_id"], user["id"], P.MANAGE_ROLES)
    await db.execute(
        """INSERT INTO channel_overwrites (channel_id, target_type, target_id, allow, deny)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(channel_id, target_type, target_id)
           DO UPDATE SET allow = excluded.allow, deny = excluded.deny""",
        (cid, target_type, target_id, body.allow, body.deny),
    )
    return await _push_channel(cid)


@router.delete("/channels/{cid}/overwrites/{target_type}/{target_id}")
async def clear_overwrite(cid: int, target_type: str, target_id: int, user=CurrentUser) -> dict:
    ch = await db.fetchone("SELECT * FROM channels WHERE id = ?", (cid,))
    if ch is None or ch["guild_id"] is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Canal não encontrado")
    await require_guild_perm(ch["guild_id"], user["id"], P.MANAGE_ROLES)
    await db.execute(
        "DELETE FROM channel_overwrites WHERE channel_id = ? AND target_type = ? AND target_id = ?",
        (cid, target_type, target_id),
    )
    return await _push_channel(cid)


# ------------------------------------------------------------------ cargos
@router.post("/guilds/{gid}/roles", status_code=status.HTTP_201_CREATED)
async def create_role(gid: int, body: RoleCreate, user=CurrentUser) -> dict:
    await require_guild_perm(gid, user["id"], P.MANAGE_ROLES)
    await _guard_permission_grant(gid, user["id"], body.permissions)
    pos = await db.fetchone(
        "SELECT COALESCE(MAX(position), 0) + 1 AS p FROM roles WHERE guild_id = ?", (gid,)
    )
    rid = await next_id()
    await db.execute(
        """INSERT INTO roles (id, guild_id, name, color, permissions, position, hoist, mentionable)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (rid, gid, body.name, body.color, body.permissions, pos["p"], int(body.hoist), int(body.mentionable)),
    )
    await _push_guild(gid)
    return {"id": rid}


@router.patch("/roles/{rid}")
async def patch_role(rid: int, body: RolePatch, user=CurrentUser) -> dict:
    role = await db.fetchone("SELECT * FROM roles WHERE id = ?", (rid,))
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cargo não encontrado")
    gid = role["guild_id"]
    await require_guild_perm(gid, user["id"], P.MANAGE_ROLES)
    if user["id"] != await guild_owner_id(gid) and role["position"] >= await top_role_position(gid, user["id"]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cargo acima ou igual ao seu")
    if body.permissions is not None:
        await _guard_permission_grant(gid, user["id"], body.permissions)
    sets, params = [], []
    for field in ("name", "color", "permissions", "position"):
        val = getattr(body, field)
        if val is not None:
            sets.append(f"{field} = ?"); params.append(val)
    for field in ("hoist", "mentionable"):
        val = getattr(body, field)
        if val is not None:
            sets.append(f"{field} = ?"); params.append(int(val))
    if sets:
        if role["is_default"] and body.position is not None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "@everyone fica sempre na posição 0")
        params.append(rid)
        await db.execute(f"UPDATE roles SET {', '.join(sets)} WHERE id = ?", params)
    await _push_guild(gid)
    return {"ok": True}


@router.delete("/roles/{rid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(rid: int, user=CurrentUser) -> None:
    role = await db.fetchone("SELECT * FROM roles WHERE id = ?", (rid,))
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cargo não encontrado")
    if role["is_default"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Não dá para apagar o @everyone")
    await require_guild_perm(role["guild_id"], user["id"], P.MANAGE_ROLES)
    await db.execute("DELETE FROM roles WHERE id = ?", (rid,))
    await _push_guild(role["guild_id"])


@router.put("/guilds/{gid}/members/{uid}/roles/{rid}", status_code=status.HTTP_204_NO_CONTENT)
async def add_member_role(gid: int, uid: int, rid: int, user=CurrentUser) -> None:
    await require_guild_perm(gid, user["id"], P.MANAGE_ROLES)
    role = await db.fetchone("SELECT * FROM roles WHERE id = ? AND guild_id = ?", (rid, gid))
    if role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cargo não encontrado")
    if user["id"] != await guild_owner_id(gid) and role["position"] >= await top_role_position(gid, user["id"]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cargo acima ou igual ao seu")
    await db.execute(
        "INSERT OR IGNORE INTO member_roles (guild_id, user_id, role_id) VALUES (?, ?, ?)",
        (gid, uid, rid),
    )
    await _push_member_roles(gid, uid)


@router.delete("/guilds/{gid}/members/{uid}/roles/{rid}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member_role(gid: int, uid: int, rid: int, user=CurrentUser) -> None:
    await require_guild_perm(gid, user["id"], P.MANAGE_ROLES)
    await db.execute(
        "DELETE FROM member_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?",
        (gid, uid, rid),
    )
    await _push_member_roles(gid, uid)


# ------------------------------------------------------------------ helpers
async def _guard_permission_grant(gid: int, user_id: int, requested: int) -> None:
    """Não deixa conceder permissão que o próprio autor não tem (salvo dono)."""
    if user_id == await guild_owner_id(gid):
        return
    from ..guilds_service import guild_permissions

    own = await guild_permissions(gid, user_id)
    if own & P.ADMINISTRATOR:
        return
    if requested & ~own:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Você não pode conceder permissões que não possui")


async def _push_guild(gid: int) -> dict:
    payload = await serialize_guild(gid)
    await manager.broadcast_guild(gid, {"t": "guild_update", "guild": payload})
    return payload


async def _push_channel(cid: int) -> dict:
    from ..guilds_service import _channel

    ch = await db.fetchone("SELECT * FROM channels WHERE id = ?", (cid,))
    ows = await db.fetchall("SELECT * FROM channel_overwrites WHERE channel_id = ?", (cid,))
    payload = _channel(ch, ows)
    await manager.broadcast_guild(ch["guild_id"], {"t": "channel_update", "channel": payload})
    return payload


async def _push_member_roles(gid: int, uid: int) -> None:
    rows = await db.fetchall(
        "SELECT role_id FROM member_roles WHERE guild_id = ? AND user_id = ?", (gid, uid)
    )
    await manager.broadcast_guild(
        gid,
        {"t": "guild_member_update", "guild_id": gid, "user_id": uid,
         "role_ids": [r["role_id"] for r in rows]},
    )
