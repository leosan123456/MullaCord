import { Api } from "./api.js";
import { Gateway } from "./gateway.js";
import { VoiceSession } from "./rtc.js";
import { $, el, state, currentGuild, memberName, dmName, avatarNode, toast, initTheme, elapsedText, activityLine, loadGameCfg } from "./store.js";
import { P, has, channelPermissions } from "./permissions.js";
import { icon, hydrateIcons } from "./icons.js";
import { SignalWave, registerWave, pulseSignal, setSignalLevel, refreshWaves } from "./wave.js";
import {
  initGuildUI,
  renderGuildSidebar,
  renderMemberList,
  openGuildMenuAction,
} from "./guild.js";
import { openUserSettings, openVoiceSettings } from "./settings.js";
import {
  resolveActive, getSession, saveSession, clearSession, SELF_URL,
} from "./community.js";

initTheme();
hydrateIcons();

// ---------------- linha de sinal (assinatura) ----------------
let spineWave = null, emptyWave = null;
try {
  const sc = $("splash-wave");
  if (sc) { const w = new SignalWave(sc, { thickness: 2, level: 0.14, density: 7 }); w.retune(); }
} catch {}
function initSignalWaves() {
  try {
    if (!spineWave && $("wave-spine"))
      spineWave = registerWave(new SignalWave($("wave-spine"), { thickness: 1.5, level: 0.14, density: 11 }));
    if (!emptyWave && $("empty-wave"))
      emptyWave = registerWave(new SignalWave($("empty-wave"), { thickness: 2, level: 0.2, density: 6 }));
  } catch {}
}

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

// ================= AUTH: comunidade + nó coordenador =================
let authMode = "login";
let community = null;       // { id, name, secret, priority, publicHost }
let activeNode = null;      // { url, info, source } — o coordenador eleito

function showAuthStep(step) {
  $("auth-welcome").hidden = step !== "welcome";
  $("auth-creds").hidden = step !== "creds";
  ["auth-error", "auth-error2"].forEach((id) => { const n = $(id); if (n) n.textContent = ""; });
}

// espera o próprio nó local ficar pronto (ele sobe sozinho no launch)
async function waitOwnNode(timeoutMs = 8000) {
  if (!window.mula?.host) return;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await window.mula.host.status().catch(() => null);
    if (s?.ready) return;
    await new Promise((r) => setTimeout(r, 400));
  }
}

// descobre em qual nó conectar e mostra a tela de credenciais
async function resolveAndShowCreds({ bootstrap = [], preferRemote = false } = {}) {
  activeNode = await resolveActive(community, { bootstrap, preferRemote });
  const info = activeNode.info || await new Api(activeNode.url).info().catch(() => null);
  activeNode.info = info;
  const members = info?.members || 0;
  const openReg = info?.open_registration !== false;

  $("creds-server-name").textContent = community.name;
  const node = $("creds-node");
  const onSelf = activeNode.source === "self" || activeNode.url.includes("127.0.0.1");
  node.textContent = onSelf
    ? "neste PC — ninguém mais da comunidade está no ar agora"
    : "conectando no " + activeNode.url.replace(/^https?:\/\//, "");
  node.hidden = false;

  const firstAccount = members === 0 && openReg;
  $("creds-welcome").hidden = !firstAccount;
  $("auth-tabs").style.display = openReg ? "" : "none";
  $("auth-back").hidden = false;
  showAuthStep("creds");
  setAuthMode(firstAccount ? "register" : "login");
  setTimeout(() => $(firstAccount ? "reg-username" : "login-id")?.focus(), 50);
}

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll("#auth-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === mode));
  const reg = mode === "register";
  $("f-username").hidden = !reg;
  $("f-login").hidden = reg;
  $("pw-hint").hidden = !reg;
  $("email-toggle").hidden = !reg;
  $("f-email").hidden = true;
  $("password").autocomplete = reg ? "new-password" : "current-password";
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

$("auth-back").addEventListener("click", () => { showAuthStep("welcome"); });

// -- primeiro uso: criar comunidade --
$("create-comm").addEventListener("click", async () => {
  const btn = $("create-comm");
  const name = $("new-comm-name").value.trim();
  $("auth-error").textContent = "";
  btn.disabled = true;
  try {
    community = await window.mula.community.create({ name: name || undefined });
    await waitOwnNode();
    await resolveAndShowCreds();
  } catch (e) {
    $("auth-error").textContent = e.message || "Não deu pra criar a comunidade.";
  } finally { btn.disabled = false; }
});

// -- primeiro uso: entrar com convite --
$("join-comm").addEventListener("click", async () => {
  const btn = $("join-comm");
  const invite = $("join-invite").value.trim();
  if (!invite) { $("auth-error").textContent = "Cole um convite."; return; }
  btn.disabled = true;
  try { await joinCommunity(invite); }
  catch (e) { $("auth-error").textContent = e.message || "Convite inválido."; }
  finally { btn.disabled = false; }
});

async function joinCommunity(payload) {
  $("auth-error").textContent = "";
  const res = await window.mula.community.join(payload);
  community = res;
  await waitOwnNode();
  // entra por um peer que já tem os dados; o nó local sincroniza em segundo plano
  await resolveAndShowCreds({ bootstrap: res.bootstrap || [], preferRemote: true });
}

// varre a LAN por comunidades já rodando e oferece entrar em uma clique
async function scanLanForCommunities() {
  const wrap = $("lan-found");
  const box = $("lan-found-list");
  if (!wrap || !window.mula?.net?.discover) return;
  let beacons = [];
  try { beacons = (await window.mula.net.discover()) || []; } catch {}
  const byComm = new Map();
  for (const b of beacons) {
    if (!b.community_id || b.community_id === community?.id) continue;
    if (!byComm.has(b.community_id)) {
      byComm.set(b.community_id, {
        id: b.community_id,
        name: b.community_name || b.name || "Comunidade",
        members: b.members || 0,
        addrs: [],
      });
    }
    byComm.get(b.community_id).addrs.push(`${b.address}:${b.http_port || 8787}`);
  }
  const comms = [...byComm.values()];
  box.replaceChildren();
  wrap.hidden = comms.length === 0;
  for (const c of comms) {
    const card = el("button", "server-card");
    card.append(el("div", "sc-badge", (c.name || "?").slice(0, 2).toUpperCase()));
    const inf = el("div", "sc-info");
    inf.append(el("div", "sc-name", c.name));
    inf.append(el("div", "sc-sub", `${c.members} ${c.members === 1 ? "pessoa" : "pessoas"} · nesta rede`));
    card.append(inf, icon("users", 14));
    card.addEventListener("click", async () => {
      card.disabled = true;
      try { await joinCommunity({ id: c.id, name: c.name, secret: "", addrs: c.addrs }); }
      catch (e) { $("auth-error").textContent = e.message || "Não deu pra entrar."; card.disabled = false; }
    });
    box.append(card);
  }
  hydrateIcons(box);
}

$("auth-submit").addEventListener("click", async () => {
  if (!activeNode || !community) return;
  const url = activeNode.url;
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
    saveSession(community.id, { token: res.access_token, url, node_id: activeNode.info?.node_id || null });
    localStorage.setItem("mula.comm.setup." + community.id, "1");
    await boot(url, res.access_token);
  } catch (err) {
    $("auth-error2").textContent = err.message || "Falha na autenticação.";
  }
});

// ================= AUTH: boot inicial =================
window.addEventListener("DOMContentLoaded", async () => {
  try { community = await window.mula?.community?.get?.(); } catch {}
  if (!community) {
    showAuthStep("welcome");
    $("auth-error").textContent = "Abra pelo app Mulla Cord.";
    hideSplash();
    return;
  }

  await waitOwnNode(6000);
  activeNode = await resolveActive(community);
  activeNode.info = activeNode.info || await new Api(activeNode.url).info().catch(() => null);

  const sess = getSession(community.id);
  if (sess?.token) {
    // token é assinado com a chave da comunidade — vale em qualquer nó dela.
    // tenta o nó local primeiro; se ele ainda não sincronizou sua conta, tenta o de origem.
    for (const url of [activeNode.url, sess.url].filter((u, i, a) => u && a.indexOf(u) === i)) {
      try { await boot(url, sess.token); return; }
      catch { /* tenta o próximo */ }
    }
    clearSession(community.id);
  }

  const setup = localStorage.getItem("mula.comm.setup." + community.id) === "1";
  const isDefaultName = !community.name || community.name === "Minha comunidade";
  const members = activeNode.info?.members || 0;
  if (!setup && isDefaultName && members === 0) {
    $("new-comm-name").value = "";
    showAuthStep("welcome");
    scanLanForCommunities();
  } else {
    await resolveAndShowCreds();
  }
  hideSplash();
});

window.mula?.onDeepLink?.((url) => {
  if (String(url).includes("mula://join/")) {
    $("join-invite").value = url;
    showAuthStep("welcome");
  }
});

$("logout").addEventListener("click", () => {
  if (community) clearSession(community.id);
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
  const av = $("me-avatar");
  av.replaceChildren();
  if (state.me.avatar) {
    const img = el("img"); img.src = state.me.avatar;
    img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%";
    av.append(img);
  } else {
    av.textContent = (state.me.display_name || "?")[0].toUpperCase();
  }
  renderMePanel();
}

function renderMePanel() {
  const box = document.querySelector("#user-panel .me-identity");
  if (!box || !state.me) return;
  const info = el("div", "me-info");
  const nm = el("span", "me-name", state.me.display_name);
  nm.id = "me-name";
  info.append(nm);
  const g = state.myGame;
  if (g) {
    const a = el("span", "activity me");
    a.append(icon("gamepad", 12), el("span", "act-name", g.name));
    const t = el("span", "act-time"); t.dataset.since = g.started_at; t.textContent = elapsedText(g.started_at);
    a.append(t);
    info.append(a);
  }
  box.replaceChildren($("me-avatar"), info);
}

// ================= BOOT =================
async function boot(url, token) {
  state.serverUrl = url;
  state.community = community;
  state.api = new Api(url, token);
  state.me = await state.api.me();          // valida o token (401 => catch no chamador)
  if (community) {
    saveSession(community.id, { token, url, node_id: activeNode?.info?.node_id || null });
    localStorage.setItem("mula.comm.setup." + community.id, "1");
  }

  $("auth").hidden = true;
  $("app").hidden = false;
  hideSplash();
  initSignalWaves();
  refreshMeIdentity();
  hydrateIcons();

  initGuildUI({ openText: openChannel, joinVoice: joinVoiceChannel });

  state.gw = new Gateway(url, token);
  wireGateway(state.gw);
  state.gw.connect();
  initGameDetection();

  // entrou por um peer? migra pro nó local assim que ele terminar de sincronizar
  if (!url.includes("127.0.0.1")) migrateToLocalWhenReady(token);
}

async function migrateToLocalWhenReady(token) {
  const local = SELF_URL;
  toast("Sincronizando esta comunidade no seu PC…", "info");
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    if (state.serverUrl === local) return;
    try {
      const info = await new Api(local).info();
      if (info.community_id !== community?.id) continue;
      const me = await new Api(local, token).me();   // nó local já conhece minha conta?
      if (!me?.id) continue;
      state.serverUrl = local;
      state.api = new Api(local, token);
      saveSession(community.id, { token, url: local });
      state.gw?.close();
      state.gw = new Gateway(local, token);
      wireGateway(state.gw);
      state.gw.connect();
      toast("Pronto — tudo sincronizado neste PC", "success");
      return;
    } catch { /* ainda não */ }
  }
}

// ================= DETECÇÃO DE JOGO =================
let _gameWired = false;
function initGameDetection() {
  const cfg = loadGameCfg();
  window.mula?.game?.configure(cfg);
  if (_gameWired) return;
  _gameWired = true;
  window.mula?.game?.onChange((activity) => {
    state.myGame = activity ? { name: activity.name, started_at: activity.since } : null;
    state.gw?.setActivity(state.myGame?.name, state.myGame?.started_at);
    if (state.me) {
      if (state.myGame) state.activities.set(state.me.id, state.myGame);
      else state.activities.delete(state.me.id);
    }
    renderMePanel();
    renderView();
  });
  // relógio: atualiza todos os timers de atividade a cada segundo
  setInterval(() => {
    document.querySelectorAll(".act-time[data-since]").forEach((n) => {
      n.textContent = elapsedText(+n.dataset.since);
    });
  }, 1000);
}

function renderConnStatus() {
  const gw = state.gw;
  const s = $("side-status");
  if (!gw) return;
  s.className = { open: "", connecting: "reconnecting", reconnecting: "reconnecting", closed: "off" }[gw.state] || "";
  s.replaceChildren();
  if (gw.state === "open") {
    s.append(el("span", null, "no ar"));
    if (gw.latency != null) s.append(el("span", "lat", ` · ${gw.latency} ms`));
  } else if (gw.state === "reconnecting" || gw.state === "connecting") {
    s.append(el("span", null, "sintonizando…"));
    const btn = el("button", "");
    btn.id = "reconnect-now";
    btn.textContent = "tentar agora";
    btn.addEventListener("click", () => gw.reconnectNow());
    s.append(btn);
  } else {
    s.append(el("span", null, "fora do ar"));
  }
  renderHeaderReadout();
}

// telemetria da conexão no canto do header do canal
function renderHeaderReadout() {
  const box = $("conn-readout");
  const gw = state.gw;
  if (!box || !gw || !state.activeChannelId) { if (box) box.hidden = true; return; }
  box.hidden = false;
  box.classList.toggle("off", gw.state === "closed");
  box.classList.toggle("tuning", gw.state === "reconnecting" || gw.state === "connecting");
  const parts = [];
  parts.push(gw.state === "open" ? "no ar" : gw.state === "closed" ? "fora do ar" : "sintonizando");
  if (gw.state === "open" && gw.latency != null) parts.push(`${gw.latency} ms`);
  const here = state.online?.size;
  if (here) parts.push(`${here} no ar`);
  box.replaceChildren(el("span", "seg-dot"));
  parts.forEach((p, i) => {
    if (i) box.append(el("span", "cr-sep", "·"));
    box.append(el("span", null, p));
  });
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
    state.activities.clear();
    for (const [uid, act] of Object.entries(d.activities || {})) {
      if (act) state.activities.set(+uid, act);
    }
    if (state.myGame) state.activities.set(state.me.id, state.myGame);
    renderRail();
    renderView();
    renderConnStatus();
    renderMePanel();
    // re-anuncia o jogo atual ao (re)conectar
    if (state.myGame) state.gw.setActivity(state.myGame.name, state.myGame.started_at);
  });
  gw.on("conn", () => renderConnStatus());
  gw.on("latency", () => renderConnStatus());
  gw.on("disconnected", () => renderConnStatus());

  gw.on("activity", (d) => {
    if (d.user_id === state.me.id) return;
    if (d.activity) state.activities.set(d.user_id, d.activity);
    else state.activities.delete(d.user_id);
    renderView();
  });

  gw.on("message_create", (d) => {
    const mine = d.message.author?.id === state.me.id;
    if (!mine) pulseSignal(mentionsMe(d.message.content) ? 1.5 : 0.85);
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
    pulseSignal(0.28);
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

  gw.on("friend_request", (d) => {
    refreshFriends();
    toast(`${d.user?.display_name || "Alguém"} quer ser seu amigo`, "info");
  });
  gw.on("friend_accepted", (d) => {
    refreshFriends();
    toast(`${d.user?.display_name || "Alguém"} aceitou seu pedido`, "success");
  });

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
  if (!$("people-results").hidden) runPeopleSearch($("friend-username").value.trim());
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
  if ($("wave-spine")) $("wave-spine").hidden = true;
  if ($("conn-readout")) $("conn-readout").hidden = true;
  requestAnimationFrame(refreshWaves);
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
  if ($("wave-spine")) $("wave-spine").hidden = noChannel;
  requestAnimationFrame(refreshWaves);
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
    const act = state.online.has(f.user.id) && state.activities.get(f.user.id);
    if (act) li.classList.add("has-activity");
    li.append(
      avatarNode(f.user.id, "avatar-sm", f.user.display_name),
      el("span", "dot" + (state.online.has(f.user.id) ? " online" : ""))
    );
    const nameWrap = el("div", "fr-name");
    nameWrap.append(el("span", "name", f.user.display_name));
    if (act) {
      const a = activityLine(act);
      a.prepend(icon("gamepad", 11));
      nameWrap.append(a);
    }
    li.append(nameWrap);
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

// ---------------- encontrar pessoas no servidor ----------------
let _peopleTimer = null;
async function runPeopleSearch(q) {
  const box = $("people-results");
  let list;
  try { list = await state.api.searchUsers(q); }
  catch (e) { toast(e.message, "error"); return; }
  box.replaceChildren();
  box.hidden = false;
  if (!list.length) {
    box.append(el("div", "people-empty", q ? "Ninguém encontrado" : "Você é a única conta aqui ainda"));
    return;
  }
  for (const u of list) {
    const row = el("div", "person-row");
    row.append(
      avatarNode(u.id, "avatar-sm", u.display_name),
      el("div", "pr-info"),
    );
    row.querySelector(".pr-info").append(
      el("span", "pr-name", u.display_name),
      el("span", "pr-user", "@" + u.username),
    );
    const act = el("div", "pr-action");
    if (u.relationship === "friend") act.append(el("span", "small muted", "amigos"));
    else if (u.relationship === "outgoing") act.append(el("span", "small muted", "pendente"));
    else if (u.relationship === "incoming") {
      const b = el("button", "primary", "aceitar");
      b.addEventListener("click", async () => {
        const fr = state.friends.find((f) => f.user.id === u.id && f.direction === "incoming");
        if (fr) { await state.api.acceptFriend(fr.id); refreshFriends(); runPeopleSearch(q); }
      });
      act.append(b);
    } else {
      const b = el("button", "");
      b.append(icon("plus", 14));
      b.title = "Adicionar";
      b.addEventListener("click", async () => {
        try {
          await state.api.addFriend(u.username);
          toast(`Pedido enviado para ${u.display_name}`, "success");
          refreshFriends();
          runPeopleSearch(q);
        } catch (e) { toast(e.message, "error"); }
      });
      act.append(b);
    }
    row.append(act);
    box.append(row);
  }
}

$("friend-username").addEventListener("input", () => {
  clearTimeout(_peopleTimer);
  const q = $("friend-username").value.trim();
  if (!q) { $("people-results").hidden = true; return; }
  _peopleTimer = setTimeout(() => runPeopleSearch(q), 220);
});
$("friend-username").addEventListener("focus", () => {
  const q = $("friend-username").value.trim();
  if (q) runPeopleSearch(q);
});
$("find-people").addEventListener("click", () => {
  $("friend-username").focus();
  runPeopleSearch("");
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".add-friend") && !e.target.closest("#people-results") && !e.target.closest("#find-people"))
    $("people-results").hidden = true;
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
  if ($("wave-spine")) $("wave-spine").hidden = false;
  requestAnimationFrame(refreshWaves);
  renderHeaderReadout();
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
  pulseSignal(0.9);
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
    setSignalLevel(0.5);
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
  setSignalLevel(0);
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
