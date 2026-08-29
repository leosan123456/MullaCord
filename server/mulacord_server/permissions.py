"""Motor de permissões estilo Discord: bitfield + hierarquia de cargos + overwrites por canal.

O mesmo algoritmo está espelhado em `desktop/src/permissions.js` (o cliente calcula
para mostrar/esconder UI; o servidor é quem realmente aplica).
"""
from __future__ import annotations


class P:
    VIEW_CHANNEL = 1 << 0
    SEND_MESSAGES = 1 << 1
    MANAGE_MESSAGES = 1 << 2
    MANAGE_CHANNELS = 1 << 3
    MANAGE_ROLES = 1 << 4
    MANAGE_GUILD = 1 << 5
    KICK_MEMBERS = 1 << 6
    BAN_MEMBERS = 1 << 7
    CREATE_INVITE = 1 << 8
    CHANGE_NICKNAME = 1 << 9
    MANAGE_NICKNAMES = 1 << 10
    MENTION_EVERYONE = 1 << 11
    CONNECT = 1 << 12
    SPEAK = 1 << 13
    MUTE_MEMBERS = 1 << 14
    DEAFEN_MEMBERS = 1 << 15
    MOVE_MEMBERS = 1 << 16
    ADMINISTRATOR = 1 << 17
    ATTACH_FILES = 1 << 18
    MANAGE_INVITES = 1 << 19


PERMISSION_NAMES = {v: k for k, v in vars(P).items() if isinstance(v, int) and not k.startswith("_")}

ALL_PERMISSIONS = 0
for _v in PERMISSION_NAMES:
    ALL_PERMISSIONS |= _v

# @everyone padrão: conversar, entrar em voz, criar convite, trocar o próprio apelido.
DEFAULT_EVERYONE = (
    P.VIEW_CHANNEL
    | P.SEND_MESSAGES
    | P.ATTACH_FILES
    | P.CREATE_INVITE
    | P.CHANGE_NICKNAME
    | P.CONNECT
    | P.SPEAK
)


def has(permissions: int, flag: int) -> bool:
    return permissions & P.ADMINISTRATOR == P.ADMINISTRATOR or permissions & flag == flag


def base_permissions(role_permission_values: list[int], is_owner: bool) -> int:
    """Permissões no nível do servidor (soma dos cargos, sem canal)."""
    if is_owner:
        return ALL_PERMISSIONS
    perms = 0
    for value in role_permission_values:
        perms |= value
    if perms & P.ADMINISTRATOR:
        return ALL_PERMISSIONS
    return perms


def channel_permissions(
    base: int,
    is_owner: bool,
    overwrites: list[dict],
    everyone_role_id: int,
    member_role_ids: set[int],
    user_id: int,
) -> int:
    """Aplica os overwrites do canal sobre as permissões base (algoritmo do Discord)."""
    if is_owner or base & P.ADMINISTRATOR:
        return ALL_PERMISSIONS

    perms = base
    by_key = {(o["target_type"], o["target_id"]): o for o in overwrites}

    ow = by_key.get(("role", everyone_role_id))
    if ow:
        perms = (perms & ~ow["deny"]) | ow["allow"]

    allow_acc = deny_acc = 0
    for (ttype, tid), o in by_key.items():
        if ttype == "role" and tid in member_role_ids:
            allow_acc |= o["allow"]
            deny_acc |= o["deny"]
    perms = (perms & ~deny_acc) | allow_acc

    ow = by_key.get(("member", user_id))
    if ow:
        perms = (perms & ~ow["deny"]) | ow["allow"]

    return perms
