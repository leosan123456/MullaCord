// Espelho de server/mulacord_server/permissions.py.
// O cliente calcula para mostrar/esconder UI; o servidor é quem aplica de fato.

export const P = {
  VIEW_CHANNEL: 1 << 0,
  SEND_MESSAGES: 1 << 1,
  MANAGE_MESSAGES: 1 << 2,
  MANAGE_CHANNELS: 1 << 3,
  MANAGE_ROLES: 1 << 4,
  MANAGE_GUILD: 1 << 5,
  KICK_MEMBERS: 1 << 6,
  BAN_MEMBERS: 1 << 7,
  CREATE_INVITE: 1 << 8,
  CHANGE_NICKNAME: 1 << 9,
  MANAGE_NICKNAMES: 1 << 10,
  MENTION_EVERYONE: 1 << 11,
  CONNECT: 1 << 12,
  SPEAK: 1 << 13,
  MUTE_MEMBERS: 1 << 14,
  DEAFEN_MEMBERS: 1 << 15,
  MOVE_MEMBERS: 1 << 16,
  ADMINISTRATOR: 1 << 17,
  ATTACH_FILES: 1 << 18,
  MANAGE_INVITES: 1 << 19,
};

export const PERMISSION_LABELS = {
  VIEW_CHANNEL: "Ver canal",
  SEND_MESSAGES: "Enviar mensagens",
  MANAGE_MESSAGES: "Gerenciar mensagens",
  MANAGE_CHANNELS: "Gerenciar canais",
  MANAGE_ROLES: "Gerenciar cargos",
  MANAGE_GUILD: "Gerenciar servidor",
  KICK_MEMBERS: "Expulsar membros",
  BAN_MEMBERS: "Banir membros",
  CREATE_INVITE: "Criar convite",
  CHANGE_NICKNAME: "Mudar o próprio apelido",
  MANAGE_NICKNAMES: "Gerenciar apelidos",
  MENTION_EVERYONE: "Mencionar @everyone",
  CONNECT: "Conectar (voz)",
  SPEAK: "Falar",
  MUTE_MEMBERS: "Silenciar membros",
  DEAFEN_MEMBERS: "Ensurdecer membros",
  MOVE_MEMBERS: "Mover membros",
  ADMINISTRATOR: "Administrador",
  ATTACH_FILES: "Anexar arquivos",
  MANAGE_INVITES: "Gerenciar convites",
};

// bit gigante com todas as flags ligadas
const ALL = Object.values(P).reduce((a, b) => a | b, 0);

export function has(permissions, flag) {
  if ((permissions & P.ADMINISTRATOR) === P.ADMINISTRATOR) return true;
  return (permissions & flag) === flag;
}

export function guildPermissions(guild, userId) {
  if (guild.owner_id === userId) return ALL;
  const myRoleIds = new Set(
    (guild.members.find((m) => m.id === userId)?.role_ids) || []
  );
  let perms = 0;
  for (const r of guild.roles) {
    if (r.is_default || myRoleIds.has(r.id)) perms |= r.permissions;
  }
  if (perms & P.ADMINISTRATOR) return ALL;
  return perms;
}

export function channelPermissions(guild, channel, userId) {
  const base = guildPermissions(guild, userId);
  if (guild.owner_id === userId || base & P.ADMINISTRATOR) return ALL;

  const everyone = guild.roles.find((r) => r.is_default);
  const myRoleIds = new Set(
    (guild.members.find((m) => m.id === userId)?.role_ids) || []
  );
  const ows = channel.overwrites || [];
  const byKey = new Map(ows.map((o) => [`${o.target_type}:${o.target_id}`, o]));

  let perms = base;
  const ev = byKey.get(`role:${everyone?.id}`);
  if (ev) perms = (perms & ~ev.deny) | ev.allow;

  let allow = 0;
  let deny = 0;
  for (const o of ows) {
    if (o.target_type === "role" && myRoleIds.has(o.target_id)) {
      allow |= o.allow;
      deny |= o.deny;
    }
  }
  perms = (perms & ~deny) | allow;

  const mem = byKey.get(`member:${userId}`);
  if (mem) perms = (perms & ~mem.deny) | mem.allow;

  return perms;
}
