import { Api } from "./api.js";
import { Gateway } from "./gateway.js";
import { VoiceSession } from "./rtc.js";
import { $, el, state, currentGuild, memberName, dmName, avatarNode, toast, initTheme } from "./store.js";
import { P, has, channelPermissions } from "./permissions.js";
import { icon, hydrateIcons } from "./icons.js";
import {
  initGuildUI,
  renderGuildSidebar,
  renderMemberList,
  openGuildMenuAction,
} from "./guild.js";
import { openUserSettings, openVoiceSettings } from "./settings.js";
import {
  knownServers, getServer, rememberServer, forgetServer, clearServerToken,
  normalizeUrl, parseMulaLink, shareLink,
} from "./servers.js";

initTheme();
hydrateIcons();

// ---------------- splash ----------------
const SPLASH_MIN = 1500;
const splashStart = performance.now();
let splashHidden = false;
function hideSplash() {
  if (splashHidden) return;
  splashHidden = true;
  const wait = Math.max(0, SPLASH_MIN - (performance.now() - splashStart));
  setTimeout(() => {
    $("splash")?.classList.add("gone");
    setTimeout(() => $("splash")?.remove(), 600);
  }, wait);
}

// ---------------- parallax do login ----------------
let parallaxRaf = 0;
document.addEventListener("mousemove", (e) => {
  if (document.documentElement.getAttribute("data-parallax") !== "on") return;
  if (!$("auth") || $("auth").hidden) return;
  cancelAnimationFrame(parallaxRaf);
  parallaxRaf = requestAnimationFrame(() => {
    const px = (e.clientX / window.innerWidth - 0.5) * 2;
    const py = (e.clientY / window.innerHeight - 0.5) * 2;
    document.documentElement.style.setProperty("--px", px.toFixed(3));
    document.documentElement.style.setProperty("--py", py.toFixed(3));
  });
});

// ---------------- barra de título ----------------
$("tb-min").addEventListener("click", () => window.mula?.win?.minimize());
$("tb-max").addEventListener("click", () => window.mula?.win?.toggleMaximize());
$("tb-close").addEventListener("click", () => window.mula?.win?.close());
window.mula?.win?.onState?.((maxed) => {
  $("tb-max").dataset.icon = maxed ? "restore" : "maximize";
  hydrateIcons($("tb-max").parentElement);
});

// ================= AUTH: escolher servidor =================
let authMode = "login";
let authTarget = null; // { url, name }

function showAuthStep(step) {
  $("auth-servers").hidden = step !== "servers";
  $("auth-creds").hidden = step !== "creds";
  $("host-panel").hidden = step !== "host";
  ["auth-error", "auth-error2", "auth-error3"].forEach((id) => ($(id).textContent = ""));
}

function renderKnownServers() {
  const box = $("known-servers");
  box.replaceChildren();
  for (const s of knownServers()) {
    box.append(serverCard({
      name: s.name, sub: s.url.replace(/^https?:\/\//, "") + (s.token ? " · sessão salva" : ""),
      saved: !!s.token,
      onClick: () => pickServer(s.url, { name: s.name, serverId: s.serverId, token: s.token }),
      onForget: () => { forgetServer(s.url); renderKnownServers(); },
    }));
  }
}

function serverCard({ name, sub, saved, members, onClick, onForget }) {
  const card = el("button", "server-card");
  const badge = el("div", "sc-badge" + (saved ? " saved" : ""), (name || "?").slice(0, 2).toUpperCase());
  const info = el("div", "sc-info");
  info.append(el("div", "sc-name", name || "servidor"));
  info.append(el("div", "sc-sub", sub || ""));
  card.append(badge, info);
  if (members != null) card.append(icon("users", 14));
  if (onForget) {
    const f = el("span", "sc-forget icon-btn");
    f.append(icon("x", 13));
    f.title = "Esquecer";
    f.addEventListener("click", (e) => { e.stopPropagation(); onForget(); });
    card.append(f);
  }
  card.addEventListener("click", onClick);
  return card;
}

let lanTimer = null;
async function startLanDiscovery() {
  if (!window.mula?.net?.discover) return;
  const group = $("lan-group");
  const box = $("lan-servers");
  try {
    const found = await window.mula.net.discover();
    const known = new Set(knownServers().map((s) => s.serverId).filter(Boolean));
    const fresh = found.filter((f) => !known.has(f.server_id));
    box.replaceChildren();
    for (const f of fresh) {
      box.append(serverCard({
        name: f.name, sub: f.address + " · " + (f.members ?? 0) + " membros", members: f.members,
        onClick: () => pickServer(f.url, { name: f.name, serverId: f.server_id }),
      }));
    }
    group.hidden = fresh.length === 0;
  } catch { group.hidden = true; }
}

$("lan-refresh").addEventListener("click", startLanDiscovery);

$("server-connect").addEventListener("click", async () => {
  const raw = $("server-url").value.trim();
  if (!raw) return;
  const link = parseMulaLink(raw);
  await pickServer(link ? link.url : normalizeUrl(raw), {});
});

async function pickServer(url, { name, serverId, token } = {}) {
  url = normalizeUrl(url);
  $("auth-error").textContent = "";
  $("server-connect").disabled = true;
  try {
    const info = await new Api(url).info();
    name = info.name || name || url;
    serverId = info.server_id || serverId;
    rememberServer({ url, name, serverId });
    if (token) {
      try {
        await boot(url, token);
        return;
      } catch { clearServerToken(url); }
    }
    const firstAccount = (info.members || 0) === 0 && info.open_registration !== false;
    authTarget = { url, name, openRegistration: info.open_registration !== false, firstAccount };
    $("creds-server-name").textContent = name;
    $("auth-tabs").style.display = authTarget.openRegistration ? "" : "none";
    $("creds-welcome").hidden = !firstAccount;
    showAuthStep("creds");
    setAuthMode(firstAccount ? "register" : "login");
    setTimeout(() => $(firstAccount ? "reg-username" : "login-id").focus(), 50);
  } catch {
    $("auth-error").textContent = "Não consegui falar com o servidor nesse endereço.";
  } finally {
    $("server-connect").disabled = false;
  }
}

// ================= AUTH: credenciais =================
function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll("#auth-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === mode));
  const reg = mode === "register";
  $("f-username").hidden = !reg;
  $("f-login").hidden = reg;
  $("pw-hint").hidden = !reg;
  $("email-toggle").hidden = !reg;
  $("f-email").hidden = true;           // e-mail sempre começa escondido; revela pelo link
  $("auth-submit").textContent = reg ? "Criar conta" : "Entrar";
}

$("email-toggle").addEventListener("click", () => {
  $("f-email").hidden = false;
  $("email-toggle").hidden = true;
  $("reg-email").focus();
});

$("auth-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tab]");
  if (btn) setAuthMode(btn.dataset.tab);
});

$("auth-back").addEventListener("click", () => { authTarget = null; showAuthStep("servers"); renderKnownServers(); });

$("auth-submit").addEventListener("click", async () => {
  if (!authTarget) return;
  const { url } = authTarget;
  const password = $("password").value;
  $("auth-error2").textContent = "";
  const api = new Api(url);
  try {
    let res;
    if (authMode === "register") {
      const username = $("reg-username").value.trim();
      if (username.length < 3) { $("auth-error2").textContent = "Escolha um nome com pelo menos 3 letras."; return; }
      if (password.length < 6) { $("auth-error2").textContent = "A senha precisa de 6 caracteres."; return; }
      const email = $("reg-email").value.trim();
      res = await api.register({ username, password, ...(email ? { email } : {}) });
      toast(`Conta criada. Bem-vindo, ${res.user.display_name}!`, "success");
    } else {
      res = await api.login({ username_or_email: $("login-id").value.trim(), password });
    }
    rememberServer({ url, name: authTarget.name, token: res.access_token });
    localStorage.setItem("mula.server", url);
    await boot(url, res.access_token);
  } catch (err) {
    $("auth-error2").textContent = err.message || "Falha na autenticação.";
  }
});

// ================= AUTH: hospedar =================
$("host-btn").addEventListener("click", () => {
  showAuthStep("host");
  refreshHostStatus();
});
$("host-back").addEventListener("click", () => showAuthStep("servers"));

let hostPollTimer = null;
window.mula?.host?.onLog?.((line) => {
  const log = $("host-log");
  log.hidden = false;
  log.textContent = (log.textContent + line).slice(-4000);
  log.scrollTop = log.scrollHeight;
});

async function refreshHostStatus() {
  if (!window.mula?.host) { $("host-state").textContent = "indisponível fora do app"; return; }
  const s = await window.mula.host.status();
  renderHostStatus(s);
}

function renderHostStatus(s) {
  const stateEl = $("host-state");
  stateEl.className = "host-state" + (s.running ? (s.ready ? " running" : " starting") : "");
  stateEl.textContent = s.running ? (s.ready ? "servidor no ar" : "iniciando…") : "parado";
  $("host-start").hidden = s.running;
  $("host-stop").hidden = !s.running;
  $("host-enter").hidden = !s.ready;

  const addrs = $("host-addrs");
  addrs.replaceChildren();
  if (s.ready) {
    const targets = [
      { label: "Neste PC", host: "127.0.0.1" },
      ...(s.lan || []).map((a) => ({ label: a.name, host: a.address })),
    ];
    for (const t of targets) {
      const link = shareLink(`http://${t.host}:${s.port}`);
      const row = el("div", "host-addr");
      row.append(el("span", "ha-link", link));
      const copy = el("button", "ha-copy icon-btn");
      copy.append(icon("link", 13));
      copy.title = "Copiar";
      copy.addEventListener("click", () => {
        navigator.clipboard?.writeText(link);
        toast("Link copiado", "success");
      });
      row.append(copy);
      addrs.append(row);
    }
  }
  hydrateIcons(addrs);
}

$("host-start").addEventListener("click", async () => {
  $("auth-error3").textContent = "";
  $("host-log").textContent = "";
  await window.mula.host.start({ name: $("host-name").value.trim() || "Meu servidor Mulla Cord" });
  clearInterval(hostPollTimer);
  hostPollTimer = setInterval(async () => {
    const s = await window.mula.host.status();
    renderHostStatus(s);
    if (s.ready) clearInterval(hostPollTimer);
  }, 800);
});
$("host-stop").addEventListener("click", async () => {
  clearInterval(hostPollTimer);
  renderHostStatus(await window.mula.host.stop());
});
$("host-enter").addEventListener("click", () => pickServer(`http://127.0.0.1:8787`, {}));

// ================= AUTH: boot inicial =================
window.addEventListener("DOMContentLoaded", async () => {
  renderKnownServers();
  showAuthStep("servers");
  startLanDiscovery();

  const last = knownServers()[0] || (localStorage.getItem("mula.server") && getServer(localStorage.getItem("mula.server")));
  if (last && last.token) {
    try { await boot(last.url, last.token); return; }
    catch { clearServerToken(last.url); renderKnownServers(); }
  }
  hideSplash();
});

window.mula?.onDeepLink?.((url) => {
  const link = parseMulaLink(url);
  if (link) { showAuthStep("servers"); pickServer(link.url, {}); }
});

$("logout").addEventListener("click", () => {
  if (state.serverUrl) clearServerToken(state.serverUrl);
  state.gw?.close();
  state.voice?.leave();
  location.reload();
});

$("open-user-settings").addEventListener("click", () => openUserSettings());
$("open-voice-settings").addEventListener("click", () => openVoiceSettings(state.voice));
$("btn-mute-quick").addEventListener("click", () => state.voice?.toggleMute());
$("btn-deafen-quick").addEventListener("click", () => state.voice?.toggleDeafen());
window.addEventListener("mula:refresh", () => { refreshMeIdentity(); renderView(); });

function refreshMeIdentity() {
  $("me-name").textContent = state.me.display_name;
  const av = $("me-avatar");
  av.replaceChildren();
  if (state.me.avatar) {
    const img = el("img"); img.src = state.me.avatar;
    img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%";
    av.append(img);
  } else {
    av.textContent = (state.me.display_name || "?")[0].toUpperCase();
  }
}

// ================= BOOT =================
async function boot(url, token) {
  state.serverUrl = url;
  state.api = new Api(url, token);
  state.me = await state.api.me();          // valida o token (401 => catch no chamador)
  rememberServer({ url, token });

  $("auth").hidden = true;
  $("app").hidden = false;
  hideSplash();
  refreshMeIdentity();
  hydrateIcons();

  initGuildUI({ openText: openChannel, joinVoice: joinVoiceChannel });

  state.gw = new Gateway(url, token);
  wireGateway(state.gw);
  state.gw.connect();
}

function renderConnStatus() {
  const gw = state.gw;
  const s = $("side-status");
  if (!gw) return;
  s.className = { open: "", connecting: "reconnecting", reconnecting: "reconnecting", closed: "off" }[gw.state] || "";
  s.replaceChildren();
  if (gw.state === "open") {
    s.append(el("span", null, "conectado"));
    if (gw.latency != null) s.append(el("span", "lat", ` · ${gw.latency} ms`));
  } else if (gw.state === "reconnecting" || gw.state === "connecting") {
    s.append(el("span", null, "reconectando…"));
    const btn = el("button", "");
    btn.id = "reconnect-now";
    btn.textContent = "tentar agora";
    btn.addEventListener("click", () => gw.reconnectNow());
    s.append(btn);
  } else {
    s.append(el("span", null, "desconectado"));
  }
}

// ================= GATEWAY =================
function wireGateway(gw) {
  gw.on("ready", (d) => {
    state.channels.clear();
    d.channels.forEach((c) => state.channels.set(c.id, c));
    state.guilds.clear();
    (d.guilds || []).forEach((g) => state.guilds.set(g.id, g));
    state.friends = d.friends;
    state.online = new Set(d.online);
    state.voiceStates.clear();
    (d.voice_states || []).forEach((s) =>
      state.voiceStates.set(s.user_id, { guildId: s.guild_id, channelId: s.channel_id })
    );
    renderRail();
    renderView();
    renderConnStatus();
  });
  gw.on("conn", () => renderConnStatus());
  gw.on("latency", () => renderConnStatus());
  gw.on("disconnected", () => renderConnStatus());

  gw.on("message_create", (d) => {
    if (d.message.channel_id === state.activeChannelId) appendMessage(d.message);
    else markUnread(d.message.channel_id, mentionsMe(d.message.content));
  });
  gw.on("message_update", (d) => {
    if (d.message.channel_id !== state.activeChannelId) return;
    const node = document.querySelector(`.msg[data-id="${d.message.id}"]`);
    if (node) patchMessageNode(node, d.message);
  });
  gw.on("message_delete", (d) => {
    if (d.channel_id !== state.activeChannelId) return;
    document.querySelector(`.msg[data-id="${d.message_id}"]`)?.remove();
  });

  gw.on("typing", (d) => {
    if (d.channel_id !== state.activeChannelId || d.user_id === state.me.id) return;
    $("typing").textContent = `${memberName(d.user_id)} está digitando…`;
    clearTimeout(typingClear);
    typingClear = setTimeout(() => ($("typing").textContent = ""), 3000);
  });

  gw.on("presence", (d) => {
    if (d.status === "online") state.online.add(d.user_id);
    else state.online.delete(d.user_id);
    renderView();
  });

  // -- DM / grupos --
  gw.on("channel_create", (d) => {
    if (d.channel.guild_id) return applyGuildChannel(d.channel, "upsert");
    state.channels.set(d.channel.id, d.channel);
    renderView();
  });
  gw.on("channel_update", (d) => {
    if (d.channel.guild_id) return applyGuildChannel(d.channel, "upsert");
    state.channels.set(d.channel.id, d.channel);
    renderView();
  });
  gw.on("channel_delete", (d) => applyGuildChannel({ id: d.channel_id, guild_id: d.guild_id }, "delete"));

  gw.on("friend_request", () => refreshFriends());
  gw.on("friend_accepted", () => refreshFriends());

  gw.on("user_update", (d) => {
    const u = d.user;
    for (const f of state.friends) if (f.user.id === u.id) Object.assign(f.user, u);
    for (const g of state.guilds.values()) {
      const m = g.members.find((x) => x.id === u.id);
      if (m) { m.display_name = u.display_name; m.avatar = u.avatar; }
    }
    for (const c of state.channels.values()) {
      const m = c.members?.find((x) => x.id === u.id);
      if (m) { m.display_name = u.display_name; m.avatar = u.avatar; }
    }
    renderView();
  });

  // -- guilds --
  gw.on("guild_create", (d) => {
    state.guilds.set(d.guild.id, d.guild);
    renderRail();
    renderView();
  });
  gw.on("guild_update", (d) => {
    state.guilds.set(d.guild.id, d.guild);
    renderRail();
    renderView();
    window.dispatchEvent(new CustomEvent("mula:refresh"));
  });
  gw.on("guild_delete", (d) => {
    state.guilds.delete(d.guild_id);
    if (state.view.kind === "guild" && state.view.guildId === d.guild_id) setView("home");
    renderRail();
    renderView();
  });
  gw.on("guild_member_add", (d) => {
    const g = state.guilds.get(d.guild_id);
    if (g && !g.members.some((m) => m.id === d.member.id)) g.members.push(d.member);
    renderView();
  });
  gw.on("guild_member_remove", (d) => {
    const g = state.guilds.get(d.guild_id);
    if (g) g.members = g.members.filter((m) => m.id !== d.user_id);
    renderView();
  });
  gw.on("guild_member_update", (d) => {
    const g = state.guilds.get(d.guild_id);
    const m = g?.members.find((x) => x.id === d.user_id);
    if (m) {
      if (d.role_ids) m.role_ids = d.role_ids;
      if ("nickname" in d) m.nickname = d.nickname;
    }
    renderView();
  });

  gw.on("voice_state_update", (d) => {
    if (d.channel_id == null) state.voiceStates.delete(d.user_id);
    else state.voiceStates.set(d.user_id, { guildId: d.guild_id, channelId: d.channel_id });
    if (state.view.kind === "guild") renderGuildSidebar();
  });
}

function applyGuildChannel(channel, mode) {
  const g = state.guilds.get(channel.guild_id);
  if (!g) return;
  if (mode === "delete") {
    g.channels = g.channels.filter((c) => c.id !== channel.id);
    if (state.activeChannelId === channel.id) { state.activeChannelId = null; clearChat(); }
  } else {
    const i = g.channels.findIndex((c) => c.id === channel.id);
    if (i >= 0) g.channels[i] = { ...g.channels[i], ...channel };
    else g.channels.push(channel);
  }
  if (state.view.kind === "guild" && state.view.guildId === g.id) renderGuildSidebar();
}

async function refreshFriends() {
  state.friends = await state.api.friends();
  renderView();
}

// ================= VIEW ROUTING =================
$("rail-home").addEventListener("click", () => setView("home"));
$("rail-add").addEventListener("click", () => addServerModal());

function setView(kind, guildId = null) {
  state.view = { kind, guildId };
  state.activeChannelId = null;
  clearChat();
  $("channel-title").textContent = "Selecione um canal";
  $("channel-sig").hidden = true;
  $("channel-topic").hidden = true;
  $("messages").hidden = true;
  $("empty-state").hidden = false;
  $("composer-input").disabled = true;
  $("composer").querySelector(".send-btn").disabled = true;
  $("btn-voice").hidden = true;
  $("btn-screen").hidden = true;
  $("btn-members").hidden = kind !== "guild";
  $("memberlist").hidden = kind !== "guild";
  $("home-sidebar").hidden = kind !== "home";
  $("guild-sidebar").hidden = kind !== "guild";
  $("guild-menu").hidden = true;
  renderRail();
  renderView();
  const c = document.querySelector(".content");
  c.classList.remove("view-anim"); void c.offsetWidth; c.classList.add("view-anim");
}

function renderRail() {
  $("rail-home-item").classList.toggle("active", state.view.kind === "home");
  const box = $("rail-guilds");
  box.innerHTML = "";
  for (const g of state.guilds.values()) {
    const item = el("div", "rail-item" + (state.view.guildId === g.id ? " active" : ""));
    const b = el("button", "rail-btn");
    b.title = g.name;
    if (g.icon) {
      const img = el("img", "ico-img"); img.src = g.icon; b.append(img);
    } else {
      b.textContent = g.name.slice(0, 2).toUpperCase();
    }
    b.addEventListener("click", () => setView("guild", g.id));
    item.append(b);
    box.append(item);
  }
}

function renderView() {
  if (state.view.kind === "home") {
    renderHomeSidebar();
    $("memberlist").hidden = true;
  } else {
    renderGuildSidebar();
    renderMemberList();
  }
  const noChannel = !state.activeChannelId;
  $("empty-state").hidden = !noChannel;
  $("messages").hidden = noChannel;
}

// ================= HOME SIDEBAR =================
function renderHomeSidebar() {
  const cl = $("channel-list");
  cl.replaceChildren();
  for (const c of state.channels.values()) {
    const li = el("li", c.id === state.activeChannelId ? "active" : "");
    li.dataset.id = c.id;
    const online = c.type === "dm" && c.members.some((u) => u.id !== state.me.id && state.online.has(u.id));
    li.append(
      c.type === "dm"
        ? avatarNode(c.members.find((u) => u.id !== state.me.id)?.id ?? -1, "avatar-sm", dmName(c))
        : icon("users", 16)
    );
    if (c.type === "dm") li.append(el("span", "dot" + (online ? " online" : "")));
    li.append(el("span", "name", dmName(c)));
    li.addEventListener("click", () => openChannel(c.id));
    cl.append(li);
  }

  const fl = $("friend-list");
  fl.replaceChildren();
  for (const f of state.friends) {
    const li = el("li");
    li.append(
      avatarNode(f.user.id, "avatar-sm", f.user.display_name),
      el("span", "dot" + (state.online.has(f.user.id) ? " online" : "")),
      el("span", "name", f.user.display_name)
    );
    const actions = el("div", "friend-actions");
    if (f.direction === "incoming") {
      const acc = el("button", "primary", "aceitar");
      acc.addEventListener("click", async (e) => {
        e.stopPropagation();
        await state.api.acceptFriend(f.id); refreshFriends();
        toast("Amizade aceita", "success");
      });
      actions.append(acc);
    } else if (f.direction === "outgoing") {
      actions.append(el("span", "small muted", "pendente"));
    } else {
      const dm = el("button", "icon-btn");
      dm.title = "Abrir DM";
      dm.append(icon("send", 15));
      dm.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ch = await state.api.openDM(f.user.id);
        state.channels.set(ch.id, ch);
        renderHomeSidebar();
        openChannel(ch.id);
      });
      actions.append(dm);
    }
    li.append(actions);
    fl.append(li);
  }
}

$("friend-add").addEventListener("click", async () => {
  const u = $("friend-username").value.trim();
  if (!u) return;
  try {
    await state.api.addFriend(u);
    $("friend-username").value = "";
    refreshFriends();
    toast("Pedido enviado", "success");
  } catch (e) { toast(e.message, "error"); }
});

// ================= GUILD MENU =================
document.querySelector(".guild-head").addEventListener("click", (e) => {
  e.stopPropagation();
  $("guild-menu").hidden = !$("guild-menu").hidden;
});
document.addEventListener("click", () => ($("guild-menu").hidden = true));
$("guild-menu").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  $("guild-menu").hidden = true;
  openGuildMenuAction(btn.dataset.act);
});
$("btn-members").addEventListener("click", () => {
  const ml = $("memberlist");
  ml.hidden = !ml.hidden;
});

// ================= CANAL ATIVO (texto) =================
async function openChannel(id) {
  state.activeChannelId = id;
  let canSend = true;
  const sig = $("channel-sig");

  const g = currentGuild();
  if (g) {
    const c = g.channels.find((x) => x.id === id);
    if (!c) return;
    sig.hidden = false;
    sig.replaceChildren(icon(c.type === "voice" ? "volume" : "hash", 18));
    $("channel-title").textContent = c.name;
    $("channel-topic").textContent = c.topic || "";
    $("channel-topic").hidden = !c.topic;
    canSend = has(channelPermissions(g, c, state.me.id), P.SEND_MESSAGES);
    renderGuildSidebar();
  } else {
    const c = state.channels.get(id);
    if (!c) return;
    sig.hidden = false;
    sig.replaceChildren(icon(c.type === "group" ? "users" : "atSign", 18));
    $("channel-title").textContent = dmName(c);
    $("channel-topic").hidden = true;
    renderHomeSidebar();
  }

  $("empty-state").hidden = true;
  $("messages").hidden = false;
  $("composer-input").disabled = !canSend;
  $("attach-btn").disabled = !canSend;
  $("composer-input").placeholder = canSend ? "Mensagem" : "Você não pode enviar mensagens neste canal";
  $("btn-voice").hidden = !!g;
  $("typing").textContent = "";
  clearPending();
  updateSendEnabled();
  document.querySelectorAll(`[data-cid="${id}"] .unread, #channel-list li[data-id="${id}"] .unread`)
    .forEach((n) => n.remove());

  const box = $("messages");
  box.replaceChildren(...skeletonRows(6));
  let msgs;
  try {
    msgs = await state.api.history(id);
  } catch (e) {
    box.replaceChildren(el("p", "empty-state", e.message));
    return;
  }
  if (state.activeChannelId !== id) return; // trocou de canal enquanto carregava
  box.replaceChildren();
  let prev = null;
  for (const m of msgs) {
    const node = buildMessageNode(m, prev);
    node.dataset.authorId = m.author.id;
    node.dataset.ts = m.created_at;
    box.append(node);
    prev = m;
  }
  box.scrollTop = box.scrollHeight;
}

function skeletonRows(n) {
  return Array.from({ length: n }, () => {
    const r = el("div", "skeleton-msg");
    const lines = el("div", "sk-lines");
    const a = el("div", "sk-bar"); a.style.width = (30 + Math.random() * 20) + "%";
    const b = el("div", "sk-bar"); b.style.width = (50 + Math.random() * 40) + "%";
    lines.append(a, b);
    r.append(el("div", "sk-av"), lines);
    return r;
  });
}

function clearChat() {
  $("messages").innerHTML = "";
  $("typing").textContent = "";
}

function canManageMessages() {
  const g = currentGuild();
  if (!g) return false;
  const c = g.channels.find((x) => x.id === state.activeChannelId);
  return c && has(channelPermissions(g, c, state.me.id), P.MANAGE_MESSAGES);
}

// nomes mencionáveis no canal atual (membros + cargos)
function mentionTargets() {
  const g = currentGuild();
  if (g) {
    return [
      ...g.members.map((m) => ({ label: m.username, display: m.nickname || m.display_name, kind: "user" })),
      ...g.roles.filter((r) => !r.is_default).map((r) => ({ label: r.name, display: r.name, kind: "role" })),
    ];
  }
  const c = state.channels.get(state.activeChannelId);
  return (c?.members || []).map((m) => ({ label: m.username || m.display_name, display: m.display_name, kind: "user" }));
}

function mentionsMe(content) {
  const me = state.me;
  const g = currentGuild();
  const nick = g?.members.find((m) => m.id === me.id)?.nickname;
  return new RegExp(`@(${[me.username, me.display_name, nick].filter(Boolean).map(escapeRe).join("|")})\\b`, "i").test(content);
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function renderContent(text) {
  const frag = document.createDocumentFragment();
  const targets = new Set(mentionTargets().map((t) => t.label.toLowerCase()));
  const re = /(^|\s)@([A-Za-z0-9_.\- ]{1,32}?)(?=$|\s|[.,!?])/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    frag.append(document.createTextNode(text.slice(last, m.index + m[1].length)));
    const name = m[2];
    if (targets.has(name.toLowerCase()) || ["everyone", "here"].includes(name.toLowerCase())) {
      const span = el("span", "mention", "@" + name);
      if ([state.me.username, state.me.display_name].some((n) => n && n.toLowerCase() === name.toLowerCase()))
        span.classList.add("me");
      frag.append(span);
    } else {
      frag.append(document.createTextNode("@" + name));
    }
    last = m.index + m[0].length;
  }
  frag.append(document.createTextNode(text.slice(last)));
  return frag;
}

function buildMessageNode(m, prev) {
  const grouped =
    prev &&
    prev.author.id === m.author.id &&
    new Date(m.created_at + "Z") - new Date(prev.created_at + "Z") < 5 * 60 * 1000;

  const wrap = el("div", "msg" + (grouped ? " grouped" : ""));
  wrap.dataset.id = m.id;
  wrap.append(avatarNode(m.author.id, "avatar", m.author.display_name));
  const body = el("div", "body");
  const head = el("div", "head");
  head.append(el("strong", null, memberName(m.author.id)));
  head.append(el("span", "when", new Date(m.created_at + "Z").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })));
  body.append(head);
  const textEl = el("div", "text");
  textEl.append(renderContent(m.content));
  if (m.edited_at) textEl.append(el("span", "edited", "(editado)"));
  if (m.content || m.edited_at) body.append(textEl);
  if (m.attachments?.length) body.append(renderAttachments(m.attachments));
  wrap.append(body);

  const mine = m.author.id === state.me.id;
  if (mine || canManageMessages()) {
    const actions = el("div", "msg-actions");
    if (mine) {
      const ed = el("button", "icon-btn");
      ed.append(icon("pencil", 15));
      ed.title = "Editar";
      ed.addEventListener("click", () => startEdit(wrap, m));
      actions.append(ed);
    }
    const del = el("button", "icon-btn danger");
    del.append(icon("trash", 15));
    del.title = "Apagar";
    del.addEventListener("click", async () => {
      if (confirm("Apagar mensagem?")) {
        try { await state.api.deleteMessage(m.channel_id, m.id); }
        catch (e) { toast(e.message, "error"); }
      }
    });
    actions.append(del);
    wrap.append(actions);
  }
  return wrap;
}

function patchMessageNode(node, m) {
  let textEl = node.querySelector(".text");
  if (!textEl) { textEl = el("div", "text"); node.querySelector(".body").insertBefore(textEl, node.querySelector(".msg-attachments")); }
  textEl.replaceChildren(renderContent(m.content));
  if (m.edited_at) textEl.append(el("span", "edited", "(editado)"));
}

// ---------------- render de anexos ----------------
function renderAttachments(atts) {
  const grid = el("div", "msg-attachments n" + Math.min(atts.length, 4));
  atts.forEach((a, i) => {
    const cell = el("div", "att-cell");
    const url = state.api.attachmentUrl(a);
    if (a.kind === "image") {
      const img = el("img", "att-img");
      img.src = url; img.loading = "lazy"; img.alt = a.filename;
      if (a.width && a.height) img.style.aspectRatio = `${a.width} / ${a.height}`;
      img.addEventListener("click", () => openLightbox(atts, i));
      cell.append(img);
    } else {
      const v = el("video", "att-video");
      v.src = url; v.controls = true; v.preload = "metadata";
      cell.append(v);
    }
    const dl = el("a", "att-dl");
    dl.href = url; dl.download = a.filename; dl.title = "Baixar";
    dl.append(icon("download", 14));
    cell.append(dl);
    grid.append(cell);
  });
  return grid;
}

function openLightbox(atts, start) {
  const images = atts.filter((a) => a.kind === "image");
  let idx = Math.max(0, images.findIndex((a) => a === atts[start]));
  const back = el("div", "lightbox");
  const img = el("img");
  const caption = el("div", "lb-caption");
  const show = () => {
    img.src = state.api.attachmentUrl(images[idx]);
    caption.textContent = `${images[idx].filename}  ·  ${idx + 1}/${images.length}`;
  };
  const nav = (d) => { idx = (idx + d + images.length) % images.length; show(); };
  back.append(img, caption);
  if (images.length > 1) {
    const prev = el("button", "lb-nav prev"); prev.append(icon("arrowLeft", 22));
    const next = el("button", "lb-nav next"); next.append(icon("chevronRight", 22));
    prev.addEventListener("click", (e) => { e.stopPropagation(); nav(-1); });
    next.addEventListener("click", (e) => { e.stopPropagation(); nav(1); });
    back.append(prev, next);
  }
  const onKey = (e) => {
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") nav(-1);
    if (e.key === "ArrowRight") nav(1);
  };
  const close = () => { back.remove(); window.removeEventListener("keydown", onKey); };
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  window.addEventListener("keydown", onKey);
  show();
  document.body.append(back);
}

function startEdit(node, m) {
  const textEl = node.querySelector(".text");
  const box = el("div", "edit-box");
  const inp = el("input");
  inp.value = m.content;
  const ok = el("button", "primary", "Salvar");
  const cancel = el("button", null, "Cancelar");
  box.append(inp, ok, cancel);
  textEl.replaceWith(box);
  inp.focus();
  const restore = (msg) => {
    const t = el("div", "text");
    t.append(renderContent(msg.content));
    if (msg.edited_at) t.append(el("span", "edited", "(editado)"));
    box.replaceWith(t);
  };
  cancel.addEventListener("click", () => restore(m));
  const submit = async () => {
    const v = inp.value.trim();
    if (!v || v === m.content) return restore(m);
    try {
      const updated = await state.api.editMessage(m.channel_id, m.id, v);
      restore(updated);
    } catch (e) { toast(e.message, "error"); restore(m); }
  };
  ok.addEventListener("click", submit);
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") restore(m);
  });
}

function appendMessage(m) {
  const box = $("messages");
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const prevNode = box.lastElementChild;
  const prev = prevNode && prevNode.classList.contains("msg")
    ? { author: { id: +prevNode.dataset.authorId || -1 }, created_at: prevNode.dataset.ts || "" }
    : null;
  const node = buildMessageNode(m, prev);
  node.dataset.authorId = m.author.id;
  node.dataset.ts = m.created_at;
  box.append(node);
  if (atBottom) box.scrollTop = box.scrollHeight;
}

function markUnread(channelId, isMention) {
  const li = document.querySelector(`#channel-list li[data-id="${channelId}"]`);
  if (li && !li.querySelector(".unread")) li.append(el("span", "unread"));
  const row = document.querySelector(`#guild-channels .chan-row[data-cid="${channelId}"]`);
  if (row && !row.querySelector(".unread"))
    row.append(el("span", "unread" + (isMention ? " mention" : ""), isMention ? "@" : ""));
}

$("composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (mentionPop && mentionPop.visible) return;
  const input = $("composer-input");
  const text = input.value.trim();
  const cid = state.activeChannelId;
  if (!cid || (!text && !state.pending.length)) return;

  if (state.pending.length) {
    const files = state.pending.map((p) => p.file);
    setPendingUploading(true);
    let atts;
    try {
      atts = await state.api.uploadAttachments(cid, files, (p) => setPendingProgress(p));
    } catch (err) {
      toast(err.message, "error");
      setPendingUploading(false);
      return;
    }
    state.gw.sendMessage(cid, text, atts.map((a) => a.id));
    clearPending();
  } else {
    state.gw.sendMessage(cid, text);
  }
  input.value = "";
  updateSendEnabled();
  closeMentionPop();
});

// ---------------- anexos ----------------
state.pending = [];

function updateSendEnabled() {
  const has = !!$("composer-input").value.trim() || state.pending.length > 0;
  $("composer").querySelector(".send-btn").disabled = $("composer-input").disabled || !has;
}

function addPendingFiles(fileList) {
  if ($("attach-btn").disabled) return;
  const files = [...fileList].filter((f) => /^(image|video)\//.test(f.type));
  for (const f of files) {
    if (state.pending.length >= 10) { toast("Máximo de 10 arquivos", "error"); break; }
    if (f.size > 50 * 1024 * 1024) { toast(`${f.name}: maior que 50 MB`, "error"); continue; }
    state.pending.push({ file: f, url: URL.createObjectURL(f) });
  }
  renderPendingStrip();
  updateSendEnabled();
}

function removePending(i) {
  URL.revokeObjectURL(state.pending[i]?.url);
  state.pending.splice(i, 1);
  renderPendingStrip();
  updateSendEnabled();
}

function clearPending() {
  state.pending.forEach((p) => URL.revokeObjectURL(p.url));
  state.pending = [];
  renderPendingStrip();
  updateSendEnabled();
}

let _uploadPct = 0, _uploading = false;
function setPendingUploading(v) { _uploading = v; if (!v) _uploadPct = 0; renderPendingStrip(); }
function setPendingProgress(p) { _uploadPct = p; renderPendingStrip(); }

function renderPendingStrip() {
  const strip = $("pending-strip");
  strip.hidden = state.pending.length === 0;
  strip.replaceChildren();
  state.pending.forEach((p, i) => {
    const chip = el("div", "pending-chip");
    if (p.file.type.startsWith("image/")) {
      const img = el("img"); img.src = p.url; chip.append(img);
    } else {
      const v = el("video"); v.src = p.url; v.muted = true; chip.append(v);
      chip.append(icon("play", 18));
    }
    if (_uploading) {
      const bar = el("div", "chip-progress");
      bar.style.width = Math.round(_uploadPct * 100) + "%";
      chip.append(bar);
    } else {
      const rm = el("button", "chip-x");
      rm.append(icon("x", 12));
      rm.addEventListener("click", () => removePending(i));
      chip.append(rm);
    }
    strip.append(chip);
  });
}

$("attach-btn").addEventListener("click", () => $("attach-input").click());
$("attach-input").addEventListener("change", (e) => { addPendingFiles(e.target.files); e.target.value = ""; });

$("composer-input").addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addPendingFiles(files); }
});

// drag & drop na área de conversa
const content = document.querySelector(".content");
let dragDepth = 0;
content.addEventListener("dragenter", (e) => {
  if (!e.dataTransfer?.types.includes("Files") || $("attach-btn").disabled) return;
  dragDepth++;
  $("drop-hint").hidden = false;
});
content.addEventListener("dragover", (e) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); });
content.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("drop-hint").hidden = true; } });
content.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  $("drop-hint").hidden = true;
  if (e.dataTransfer?.files?.length) addPendingFiles(e.dataTransfer.files);
});

let typingSent = 0;
let typingClear = null;
$("composer-input").addEventListener("input", () => {
  updateSendEnabled();
  const now = Date.now();
  if (state.activeChannelId && now - typingSent > 2000) {
    state.gw.typing(state.activeChannelId);
    typingSent = now;
  }
  updateMentionPop();
});

// -- autocomplete de @menção --
let mentionPop = null;
function closeMentionPop() {
  mentionPop?.node.remove();
  mentionPop = null;
}
function updateMentionPop() {
  const input = $("composer-input");
  const upto = input.value.slice(0, input.selectionStart);
  const m = /@([A-Za-z0-9_.\-]*)$/.exec(upto);
  if (!m) return closeMentionPop();
  const q = m[1].toLowerCase();
  const opts = mentionTargets()
    .filter((t) => t.label.toLowerCase().includes(q))
    .slice(0, 8);
  if (!opts.length) return closeMentionPop();

  closeMentionPop();
  const node = el("div", "mention-pop");
  opts.forEach((o, i) => {
    const row = el("div", "mi" + (i === 0 ? " active" : ""));
    row.append(el("span", null, (o.kind === "role" ? "🏷️ " : "@") + o.label));
    if (o.display !== o.label) row.append(el("span", "muted small", o.display));
    row.addEventListener("mousedown", (e) => { e.preventDefault(); pick(o); });
    node.append(row);
  });
  document.querySelector(".content").append(node);
  mentionPop = { node, opts, idx: 0, visible: true, start: m.index };

  function pick(o) {
    const before = input.value.slice(0, mentionPop.start);
    const after = input.value.slice(input.selectionStart);
    input.value = `${before}@${o.label} ${after}`;
    input.selectionStart = input.selectionEnd = (before + "@" + o.label + " ").length;
    closeMentionPop();
    input.focus();
  }
  mentionPop.pick = pick;
}
$("composer-input").addEventListener("keydown", (e) => {
  if (!mentionPop) return;
  const rows = [...mentionPop.node.querySelectorAll(".mi")];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    mentionPop.idx = (mentionPop.idx + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length;
    rows.forEach((r, i) => r.classList.toggle("active", i === mentionPop.idx));
  } else if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    mentionPop.pick(mentionPop.opts[mentionPop.idx]);
  } else if (e.key === "Escape") {
    closeMentionPop();
  }
});
$("composer-input").addEventListener("blur", () => setTimeout(closeMentionPop, 150));

// ================= VOZ =================
$("btn-voice").addEventListener("click", () => {
  if (state.activeChannelId) startVoice(state.activeChannelId, dmName(state.channels.get(state.activeChannelId)));
});

async function joinVoiceChannel(channelId) {
  const g = currentGuild();
  const c = g?.channels.find((x) => x.id === channelId);
  if (!c) return;
  if (!has(channelPermissions(g, c, state.me.id), P.CONNECT)) {
    toast("Sem permissão para conectar neste canal de voz.", "error");
    return;
  }
  await startVoice(channelId, c.name);
}

async function startVoice(channelId, label) {
  if (state.voice) state.voice.leave();
  const v = new VoiceSession(state.gw, channelId, state.me.id);
  state.voice = v;
  v.on("state", renderVoice);
  try {
    await v.start();
    $("voice-panel").hidden = false;
    $("voice-title").dataset.name = label || "Chamada de voz";
    $("btn-screen").hidden = false;
    $("btn-voice").hidden = true;
    $("btn-mute-quick").hidden = false;
    $("btn-deafen-quick").hidden = false;
  } catch (e) {
    toast("Não consegui acessar o microfone: " + e.message, "error");
    state.voice = null;
  }
}

$("btn-leave-voice").addEventListener("click", () => {
  state.voice?.leave();
  state.voice = null;
  $("voice-panel").hidden = true;
  $("btn-screen").hidden = true;
  $("btn-voice").hidden = state.view.kind === "guild";
  $("btn-mute-quick").hidden = true;
  $("btn-deafen-quick").hidden = true;
  $("videos").replaceChildren();
});

$("btn-mute").addEventListener("click", () => {
  state.voice?.toggleMute();
});
$("btn-deafen").addEventListener("click", () => {
  state.voice?.toggleDeafen();
});
$("btn-voice-settings").addEventListener("click", () => openVoiceSettings(state.voice));

function btnContent(btn, iconName, label) {
  btn.replaceChildren(icon(iconName, 15), el("span", null, label));
}

$("btn-screen").addEventListener("click", async () => {
  if (!state.voice) return;
  if (state.voice.screenStream) {
    state.voice.stopScreenShare();
    btnContent($("btn-screen"), "screenShare", "Tela");
    return;
  }
  const sources = await window.mula.listScreenSources();
  const grid = $("screen-sources");
  grid.replaceChildren();
  sources.forEach((s) => {
    const div = el("div", "src");
    const img = el("img"); img.src = s.thumbnail;
    div.append(img, el("span", null, s.name));
    div.addEventListener("click", async () => {
      await window.mula.setScreenSource(s.id);
      $("screen-modal").hidden = true;
      try {
        await state.voice.startScreenShare();
        btnContent($("btn-screen"), "x", "Parar tela");
      } catch (e) { toast("Falha ao compartilhar: " + e.message, "error"); }
    });
    grid.append(div);
  });
  $("screen-modal").hidden = false;
});
$("screen-cancel").addEventListener("click", () => ($("screen-modal").hidden = true));

function renderVoice(snap) {
  btnContent($("btn-mute"), snap.muted ? "micOff" : "mic", snap.muted ? "Desmutar" : "Mutar");
  btnContent($("btn-deafen"), snap.deafened ? "headphonesOff" : "headphones", snap.deafened ? "Reativar" : "Ensurdecer");
  $("btn-mute-quick").classList.toggle("on", snap.muted);
  $("btn-mute-quick").dataset.icon = snap.muted ? "micOff" : "mic";
  $("btn-deafen-quick").classList.toggle("on", snap.deafened);
  $("btn-deafen-quick").dataset.icon = snap.deafened ? "headphonesOff" : "headphones";
  hydrateIcons($("user-panel"));

  const modeLabel = { open: "sempre ativo", vad: "ativado por voz", ptt: "push-to-talk" }[snap.mode];
  const tx = snap.transmitting ? "transmitindo" : "em silêncio";
  $("voice-title").replaceChildren(
    icon("volume", 14),
    el("span", null, `${$("voice-title").dataset.name || "Chamada"}  ·  ${modeLabel} · ${tx}`)
  );

  const box = $("videos");
  box.replaceChildren();
  if (snap.sharingScreen && snap.screenStream) box.append(videoTile(snap.screenStream, "Sua tela", true, null));
  snap.peers.forEach((p) => box.append(videoTile(p.stream, memberName(p.userId), false, p)));
  if (!snap.peers.length && !snap.sharingScreen)
    box.append(el("p", "muted small", "Esperando outras pessoas entrarem…"));
}

function videoTile(stream, label, muted, peer) {
  const tile = el("div", "tile");
  if (stream && stream.getVideoTracks().length > 0) {
    const video = el("video");
    video.autoplay = true; video.playsInline = true; video.muted = muted;
    video.srcObject = stream;
    tile.append(video);
  } else if (peer) {
    tile.append(avatarNode(peer.userId, "avatar", label));
  } else {
    tile.append(el("div", "avatar", label[0].toUpperCase()));
  }
  tile.append(el("div", "tag", label));
  if (peer) {
    const vol = el("input", "vol");
    vol.type = "range"; vol.min = "0"; vol.max = "1"; vol.step = "0.05";
    vol.value = peer.volume;
    vol.title = "Volume de " + label;
    vol.addEventListener("input", () => state.voice?.setUserVolume(peer.userId, +vol.value));
    tile.append(vol);
  }
  return tile;
}

// ================= GRUPO (home) =================
$("new-group").addEventListener("click", () => {
  const box = $("group-members");
  box.replaceChildren();
  state.friends.filter((f) => f.direction === "friend").forEach((f) => {
    const lab = el("label");
    const cb = el("input"); cb.type = "checkbox"; cb.value = f.user.id;
    lab.append(cb, avatarNode(f.user.id, "avatar-sm", f.user.display_name), el("span", null, f.user.display_name));
    box.append(lab);
  });
  $("group-name").value = "";
  $("group-modal").hidden = false;
});
$("group-cancel").addEventListener("click", () => ($("group-modal").hidden = true));
$("group-create").addEventListener("click", async () => {
  const name = $("group-name").value.trim();
  if (!name) return;
  const ids = [...$("group-members").querySelectorAll("input:checked")].map((c) => +c.value);
  try {
    const ch = await state.api.createGroup(name, ids);
    state.channels.set(ch.id, ch);
    $("group-modal").hidden = true;
    renderHomeSidebar();
    openChannel(ch.id);
  } catch (e) { toast(e.message, "error"); }
});

// ================= ADICIONAR SERVIDOR =================
function addServerModal() {
  const back = el("div", "modal");
  const card = el("div", "modal-card");
  card.innerHTML = `
    <h3>Adicionar servidor</h3>
    <div class="tabs">
      <button data-t="create" class="active">Criar</button>
      <button data-t="join">Entrar por convite</button>
    </div>
    <label id="s-create">Nome do servidor <input id="s-name" /></label>
    <label id="s-join" hidden>Código do convite <input id="s-code" /></label>
    <div class="modal-actions">
      <button id="s-cancel">Cancelar</button>
      <button id="s-ok" class="primary">Criar</button>
    </div>`;
  back.append(card);
  document.body.append(back);
  let mode = "create";
  card.querySelector(".tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-t]");
    if (!b) return;
    mode = b.dataset.t;
    card.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
    card.querySelector("#s-create").hidden = mode !== "create";
    card.querySelector("#s-join").hidden = mode !== "join";
    card.querySelector("#s-ok").textContent = mode === "create" ? "Criar" : "Entrar";
  });
  card.querySelector("#s-cancel").addEventListener("click", () => back.remove());
  back.addEventListener("click", (e) => { if (e.target === back) back.remove(); });
  card.querySelector("#s-ok").addEventListener("click", async () => {
    try {
      let g;
      if (mode === "create") g = await state.api.createGuild(card.querySelector("#s-name").value.trim());
      else g = await state.api.useInvite(card.querySelector("#s-code").value.trim());
      state.guilds.set(g.id, g);
      back.remove();
      setView("guild", g.id);
      toast(mode === "create" ? "Servidor criado" : "Você entrou no servidor", "success");
    } catch (e) { toast(e.message, "error"); }
  });
  hydrateIcons(card);
}
