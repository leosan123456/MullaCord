// Comunidade + resolução do nó coordenador.
//
// Um "community" é um grupo lógico de nós (um por app aberto) que compartilham
// contas e histórico. O Electron (main.js) guarda qual comunidade é a nossa em
// userData/community.json e sobe o nó local sempre. Aqui a gente descobre, entre
// os nós vivos da comunidade (LAN + próprio + endereços de internet salvos), qual
// é o coordenador — e é nele que o cliente conecta.

import { Api } from "./api.js";

const SELF_URL = "http://127.0.0.1:8787";

// ---- sessão salva, por comunidade ----
function sessKey(communityId) { return `mula.session.${communityId}`; }

export function getSession(communityId) {
  try { return JSON.parse(localStorage.getItem(sessKey(communityId)) || "null"); }
  catch { return null; }
}
export function saveSession(communityId, data) {
  try { localStorage.setItem(sessKey(communityId), JSON.stringify(data)); } catch {}
}
export function clearSession(communityId) {
  try { localStorage.removeItem(sessKey(communityId)); } catch {}
}

// ---- endereços de internet conhecidos, por comunidade ----
function addrKey(communityId) { return `mula.addrs.${communityId}`; }

export function knownAddrs(communityId) {
  try { return JSON.parse(localStorage.getItem(addrKey(communityId)) || "[]"); }
  catch { return []; }
}
export function rememberAddrs(communityId, addrs) {
  const set = new Set([...(knownAddrs(communityId)), ...addrs].filter(Boolean));
  try { localStorage.setItem(addrKey(communityId), JSON.stringify([...set].slice(0, 12))); } catch {}
}

function toUrl(addr) {
  if (!addr) return null;
  let a = String(addr).trim();
  if (a.startsWith("mula://")) a = a.slice("mula://".length);
  if (!/^https?:\/\//i.test(a)) a = "http://" + a;
  return a.replace(/\/+$/, "");
}

async function probe(url, timeoutMs = 1800) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url + "/api/info", { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
  finally { clearTimeout(t); }
}

function _elect(a, b) {
  return (b.info.node_priority || 0) - (a.info.node_priority || 0)
    || (a.info.started_at || 0) - (b.info.started_at || 0)
    || String(a.info.node_id).localeCompare(String(b.info.node_id));
}

/**
 * Descobre os nós vivos da comunidade e escolhe em qual conectar.
 * No enxame todo nó tem a réplica inteira, então o padrão é usar o NÓ LOCAL
 * (leitura instantânea + realtime pela porta local). `preferRemote` força um peer
 * — usado logo após entrar numa comunidade, enquanto o nó local ainda sincroniza.
 * @returns {{url, info, source}}
 */
export async function resolveActive(community, { bootstrap = [], preferRemote = false } = {}) {
  const seen = new Map();
  const add = (url, source) => {
    url = toUrl(url);
    if (url && !seen.has(url)) seen.set(url, source);
  };

  add(SELF_URL, "self");
  try {
    const lan = (await window.mula?.net?.discover?.()) || [];
    for (const b of lan) if (!community || b.community_id === community.id) add(b.url, "lan");
  } catch {}
  for (const a of knownAddrs(community?.id)) add(a, "remote");
  for (const a of bootstrap) add(a, "bootstrap");

  const alive = [];
  await Promise.all([...seen.entries()].map(async ([url, source]) => {
    const info = await probe(url);
    if (!info || info.service !== "mulacord") return;
    const ok = !community || info.community_id === community.id
      || source === "self" || source === "bootstrap";
    if (ok) alive.push({ url, source, info });
  }));

  if (!alive.length) return { url: SELF_URL, info: null, source: "self" };

  const remotes = alive.filter((n) => n.source !== "self" && !n.url.includes("127.0.0.1"));
  if (remotes.length && community) {
    rememberAddrs(community.id, remotes.map((n) => n.url.replace(/^https?:\/\//, "")));
  }

  const self = alive.find((n) => n.source === "self");
  const selfOk = self && (!community || self.info.community_id === community.id);

  if (preferRemote && remotes.length) {
    remotes.sort(_elect);
    return remotes[0];
  }
  if (selfOk) return self;
  if (remotes.length) {
    remotes.sort(_elect);
    return remotes[0];
  }
  return self || { url: SELF_URL, info: null, source: "self" };
}

export { SELF_URL, probe };
