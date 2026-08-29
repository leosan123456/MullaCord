// Estado compartilhado do cliente + helpers de nome.

export const state = {
  api: null,
  gw: null,
  me: null,
  serverUrl: "",
  view: { kind: "home", guildId: null }, // home | guild
  channels: new Map(),                   // dm/group -> channel
  guilds: new Map(),                     // guildId -> guild
  friends: [],
  online: new Set(),
  activities: new Map(),                 // userId -> { name, started_at }
  myGame: null,                          // atividade detectada localmente
  voiceStates: new Map(),                // userId -> { guildId, channelId }
  activeChannelId: null,
  voice: null,                           // VoiceSession
};

export const $ = (id) => document.getElementById(id);

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ---------------------------------------------------------------- aparência
export const BRAND_ACCENT = "#FACC15";

export const ACCENT_PRESETS = {
  "amarelo": "#FACC15",
  "ouro": "#EAB306",
  "âmbar": "#e8a64c",
  "turquesa": "#39b7ad",
  "violeta": "#8b6cf0",
  "rosa": "#e8698f",
  "verde": "#57bd7c",
  "azul": "#4f9ff2",
};

const UI_DEFAULTS = {
  theme: "dark",
  accent: BRAND_ACCENT,
  bg: "gradient",       // gradient | aurora | solid
  parallax: true,
  anim: true,
  compact: false,
};

export function loadUi() {
  try {
    return { ...UI_DEFAULTS, ...(JSON.parse(localStorage.getItem("mula.ui") || "{}")) };
  } catch { return { ...UI_DEFAULTS }; }
}
export function saveUi(patch) {
  const next = { ...loadUi(), ...patch };
  try { localStorage.setItem("mula.ui", JSON.stringify(next)); } catch {}
  applyUi(next);
  return next;
}

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function mixHex(hex, withHex, amount) {
  const p = (h) => { const n = parseInt(h.replace("#", ""), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const [r1, g1, b1] = p(hex), [r2, g2, b2] = p(withHex);
  const c = (a, b) => Math.round(a + (b - a) * amount).toString(16).padStart(2, "0");
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

export function applyUi(ui = loadUi()) {
  const root = document.documentElement;
  root.setAttribute("data-theme", ui.theme);
  root.setAttribute("data-bg", ui.bg);
  root.setAttribute("data-anim", ui.anim ? "on" : "off");
  root.setAttribute("data-compact", ui.compact ? "on" : "off");
  root.setAttribute("data-parallax", ui.parallax ? "on" : "off");

  if (ui.accent.toUpperCase() === BRAND_ACCENT) {
    // cor da marca: usa os hexes exatos definidos no CSS
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-gold");
    root.style.removeProperty("--accent-light");
    root.style.removeProperty("--text-on-accent");
  } else {
    root.style.setProperty("--accent", ui.accent);
    root.style.setProperty("--accent-gold", mixHex(ui.accent, "#000000", 0.16));
    root.style.setProperty("--accent-light", mixHex(ui.accent, "#ffffff", 0.24));
    root.style.setProperty("--text-on-accent", luminance(ui.accent) > 0.42 ? "#09090B" : "#ffffff");
  }
}

// compat
export function currentTheme() { return loadUi().theme; }
export function setTheme(theme) { saveUi({ theme }); }
export function initTheme() { applyUi(); }

// ---------------------------------------------------------------- toast
export function toast(message, type = "info", ms = 3600) {
  const box = $("toasts");
  if (!box) return;
  const t = el("div", "toast " + type);
  const glyph = { error: "✕", success: "✓", info: "•" }[type] || "•";
  t.append(el("span", "ico", glyph), el("span", null, message));
  box.append(t);
  setTimeout(() => {
    t.classList.add("leaving");
    setTimeout(() => t.remove(), 220);
  }, ms);
}

export function currentGuild() {
  return state.view.kind === "guild" ? state.guilds.get(state.view.guildId) : null;
}

export function memberName(userId) {
  const g = currentGuild();
  if (g) {
    const m = g.members.find((x) => x.id === userId);
    if (m) return m.nickname || m.display_name;
  }
  for (const c of state.channels.values()) {
    const m = c.members?.find((u) => u.id === userId);
    if (m) return m.display_name;
  }
  const f = state.friends.find((x) => x.user.id === userId);
  if (f) return f.user.display_name;
  if (userId === state.me?.id) return state.me.display_name;
  return `#${userId}`;
}

export function dmName(c) {
  if (c.type === "group") return c.name;
  const other = c.members.find((u) => u.id !== state.me.id);
  return other ? other.display_name : "DM";
}

export function userAvatar(userId) {
  const g = currentGuild();
  const gm = g?.members.find((x) => x.id === userId);
  if (gm?.avatar) return gm.avatar;
  for (const c of state.channels.values()) {
    const m = c.members?.find((u) => u.id === userId);
    if (m?.avatar) return m.avatar;
  }
  const f = state.friends.find((x) => x.user.id === userId);
  if (f?.user.avatar) return f.user.avatar;
  if (userId === state.me?.id && state.me.avatar) return state.me.avatar;
  return null;
}

// Nó de avatar: <img> se houver foto, senão um círculo com a inicial.
export function avatarNode(userId, cls = "avatar", fallbackName = null) {
  const url = userAvatar(userId);
  if (url) {
    const img = el("img", cls);
    img.src = url;
    return img;
  }
  const name = fallbackName || memberName(userId);
  return el("div", cls, (name || "?")[0].toUpperCase());
}

// ---------------------------------------------------------------- config de jogo
export function loadGameCfg() {
  try { return { enabled: true, custom: {}, ...(JSON.parse(localStorage.getItem("mula.games") || "{}")) }; }
  catch { return { enabled: true, custom: {} }; }
}
export function saveGameCfg(cfg) {
  try { localStorage.setItem("mula.games", JSON.stringify(cfg)); } catch {}
  window.mula?.game?.configure(cfg);
}

export function elapsedText(startedAt) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - startedAt);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

// linha "🎮 Jogo · 12:34" que se atualiza sozinha (ver tickActivities em app.js)
export function activityLine(activity) {
  if (!activity) return null;
  const line = el("span", "activity");
  line.append(el("span", "act-name", activity.name));
  const t = el("span", "act-time");
  t.dataset.since = activity.started_at;
  t.textContent = elapsedText(activity.started_at);
  line.append(t);
  return line;
}

export function hoistedRoleFor(guild, member) {
  const roles = member.role_ids
    .map((id) => guild.roles.find((r) => r.id === id))
    .filter((r) => r && r.hoist)
    .sort((a, b) => b.position - a.position);
  return roles[0] || null;
}
