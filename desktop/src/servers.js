// Servidores conhecidos (persistidos) + parsing de link mula://

const KEY = "mula.servers";

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
  catch { return []; }
}
function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}

export function knownServers() {
  return read().sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
}

export function getServer(url) {
  return read().find((s) => s.url === normalizeUrl(url));
}

export function rememberServer({ url, name, serverId, token }) {
  url = normalizeUrl(url);
  const list = read();
  const i = list.findIndex((s) => s.url === url);
  const entry = {
    url,
    name: name || (list[i] && list[i].name) || url,
    serverId: serverId || (list[i] && list[i].serverId) || null,
    token: token !== undefined ? token : (list[i] && list[i].token) || null,
    lastUsed: Date.now(),
  };
  if (i >= 0) list[i] = entry; else list.push(entry);
  write(list);
  return entry;
}

export function forgetServer(url) {
  write(read().filter((s) => s.url !== normalizeUrl(url)));
}

export function clearServerToken(url) {
  const list = read();
  const s = list.find((x) => x.url === normalizeUrl(url));
  if (s) { s.token = null; write(list); }
}

export function normalizeUrl(url) {
  if (!url) return "";
  let u = url.trim();
  if (u.startsWith("mula://")) u = "http://" + u.slice("mula://".length);
  if (!/^https?:\/\//i.test(u)) u = "http://" + u;
  return u.replace(/\/+$/, "");
}

// mula://host:porta  ->  { url }
export function parseMulaLink(str) {
  if (!str) return null;
  const s = str.trim();
  if (!s.startsWith("mula://")) return null;
  return { url: normalizeUrl(s) };
}

export function shareLink(url) {
  return normalizeUrl(url).replace(/^https?:\/\//, "mula://");
}
