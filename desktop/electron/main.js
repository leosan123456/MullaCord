"use strict";

const { app, BrowserWindow, Tray, Menu, ipcMain, session, desktopCapturer, nativeImage } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const dgram = require("dgram");
const { spawn } = require("child_process");
const games = require("./games");

const isDev = !app.isPackaged;
let mainWindow = null;
let pendingDeepLink = null;
let lastLanBeacons = [];   // último resultado de descoberta LAN (pra seed de peers)
let tray = null;
let quitting = false;
let trayHintShown = false;

// -------------------------------------------------- comunidade (nó local)
// Um "community" é um grupo lógico de nós que compartilham contas e histórico.
// Persistido em userData/community.json; cada comunidade tem seu próprio data dir.
function communityConfigPath() {
  return path.join(app.getPath("userData"), "community.json");
}

function readCommunity() {
  try {
    const raw = fs.readFileSync(communityConfigPath(), "utf-8");
    const c = JSON.parse(raw);
    if (c && c.id) return c;
  } catch { /* sem config ainda */ }
  return null;
}

function writeCommunity(c) {
  const full = {
    id: c.id,
    name: c.name || "Minha comunidade",
    secret: c.secret || "",
    priority: Number(c.priority) || 0,
    publicHost: c.publicHost || "",
    bootstrap: Array.isArray(c.bootstrap) ? c.bootstrap.slice(0, 20) : [],
  };
  fs.mkdirSync(path.dirname(communityConfigPath()), { recursive: true });
  fs.writeFileSync(communityConfigPath(), JSON.stringify(full, null, 2), "utf-8");
  return full;
}

// Garante que sempre exista uma comunidade (cria uma no primeiro uso).
function ensureCommunity() {
  let c = readCommunity();
  if (!c) {
    c = writeCommunity({ id: crypto.randomUUID().replace(/-/g, ""), name: "Minha comunidade" });
  }
  return c;
}

function communityDataDir(id) {
  return path.join(app.getPath("userData"), "communities", id);
}

// -------------------------------------------------- preferências do dispositivo
function prefsPath() { return path.join(app.getPath("userData"), "prefs.json"); }

function readPrefs() {
  try { return { background: false, openAtLogin: false, ...JSON.parse(fs.readFileSync(prefsPath(), "utf-8")) }; }
  catch { return { background: false, openAtLogin: false }; }
}

function writePrefs(patch) {
  const p = { ...readPrefs(), ...patch };
  fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
  fs.writeFileSync(prefsPath(), JSON.stringify(p, null, 2), "utf-8");
  applyPrefs(p);
  return p;
}

function applyPrefs(p) {
  try {
    app.setLoginItemSettings({ openAtLogin: !!p.openAtLogin, args: ["--background"] });
  } catch {}
  if (tray) refreshTrayMenu();
}

// convite: mula://join/<base64url(json)>  — carrega id, nome, segredo e endereços
function buildInvite() {
  const c = ensureCommunity();
  const addrs = lanAddresses().map((a) => `${a.address}:${HOST_PORT}`);
  if (c.publicHost) addrs.unshift(c.publicHost);
  const payload = { id: c.id, name: c.name, secret: c.secret || "", addrs };
  const b64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  return { link: `mula://join/${b64}`, code: b64, addrs, community: c };
}

function parseInvite(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  const m = s.match(/mula:\/\/join\/([A-Za-z0-9_-]+)/);
  if (m) s = m[1];
  try {
    const json = JSON.parse(Buffer.from(s, "base64url").toString("utf-8"));
    if (json && json.id) return json;
  } catch { /* não é um convite base64 */ }
  return null;
}

// -------------------------------------------------- deep link mula://
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const link = argv.find((a) => a.startsWith("mula://"));
    if (link) routeDeepLink(link);
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
}
app.setAsDefaultProtocolClient("mula");
app.on("open-url", (e, url) => { e.preventDefault(); routeDeepLink(url); });

function routeDeepLink(url) {
  if (mainWindow) mainWindow.webContents.send("deep-link", url);
  else pendingDeepLink = url;
}

// -------------------------------------------------- rede local
function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) out.push({ name, address: a.address });
    }
  }
  return out;
}

function discoverLan(port = 8788, timeout = 1600) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const nonce = Math.random().toString(36).slice(2);
    const found = new Map();
    sock.on("message", (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.service !== "mulacord" || data.nonce !== nonce) return;
        const url = `http://${rinfo.address}:${data.http_port || 8787}`;
        found.set(data.node_id || data.server_id || url, {
          url, name: data.name,
          server_id: data.server_id,
          node_id: data.node_id || data.server_id,
          version: data.version, members: data.members, address: rinfo.address,
          community_id: data.community_id || null,
          community_name: data.community_name || null,
          node_priority: data.node_priority || 0,
          started_at: data.started_at || 0,
          public_host: data.public_host || "",
        });
      } catch { /* ignora */ }
    });
    sock.on("error", () => { try { sock.close(); } catch {} resolve([]); });
    sock.bind(() => {
      sock.setBroadcast(true);
      const probe = Buffer.from("MULACORD_DISCOVER " + nonce);
      for (const t of ["255.255.255.255", ...lanAddresses().map((a) => broadcastOf(a.address))]) {
        try { sock.send(probe, port, t); } catch {}
      }
      setTimeout(() => {
        try { sock.close(); } catch {}
        const list = [...found.values()];
        if (list.length) lastLanBeacons = list;
        resolve(list);
      }, timeout);
    });
  });
}
// -------------------------------------------------- UPnP (best-effort, sem dependência)
// Descobre o roteador por SSDP e pede um port-forward via SOAP. Se o roteador não
// tiver UPnP (ou estiver desligado), falha em silêncio — aí é endereço manual.
function ssdpDiscover(timeout = 2500) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket("udp4");
    const msg = Buffer.from(
      "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\n" +
      "MX: 2\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n\r\n"
    );
    let location = null;
    sock.on("message", (buf) => {
      const m = buf.toString().match(/LOCATION:\s*(\S+)/i);
      if (m && !location) { location = m[1]; try { sock.close(); } catch {} }
    });
    sock.on("error", () => { try { sock.close(); } catch {} resolve(null); });
    sock.bind(() => {
      try { sock.send(msg, 1900, "239.255.255.250"); } catch {}
      setTimeout(() => { try { sock.close(); } catch {} resolve(location); }, timeout);
    });
  });
}

function httpGet(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 4000 }, (res) => {
      let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => resolve({ body: b, url }));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

function soap(controlUrl, serviceType, action, args) {
  const body =
    `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>` +
    `<u:${action} xmlns:u="${serviceType}">` +
    Object.entries(args).map(([k, v]) => `<${k}>${v}</${k}>`).join("") +
    `</u:${action}></s:Body></s:Envelope>`;
  return new Promise((resolve) => {
    const u = new URL(controlUrl);
    const req = http.request({
      host: u.hostname, port: u.port || 80, path: u.pathname, method: "POST",
      timeout: 5000,
      headers: {
        "Content-Type": 'text/xml; charset="utf-8"',
        "Content-Length": Buffer.byteLength(body),
        SOAPACTION: `"${serviceType}#${action}"`,
      },
    }, (res) => {
      let b = ""; res.on("data", (d) => (b += d));
      res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

async function upnpMapPort(port) {
  try {
    const loc = await ssdpDiscover();
    if (!loc) return null;
    const desc = await httpGet(loc);
    if (!desc) return null;
    // acha um serviço WANIP/WANPPP connection e monta a control URL absoluta
    const svc = desc.body.match(
      /<service>[\s\S]*?<serviceType>(urn:schemas-upnp-org:service:WAN(?:IP|PPP)Connection:\d)<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>[\s\S]*?<\/service>/i
    );
    if (!svc) return null;
    const base = new URL(loc);
    const control = new URL(svc[2], `${base.protocol}//${base.host}`).toString();
    const stype = svc[1];

    const lan = lanAddresses()[0];
    if (!lan) return null;
    await soap(control, stype, "AddPortMapping", {
      NewRemoteHost: "", NewExternalPort: port, NewProtocol: "TCP",
      NewInternalPort: port, NewInternalClient: lan.address, NewEnabled: 1,
      NewPortMappingDescription: "Mulla Cord", NewLeaseDuration: 0,
    });
    const ext = await soap(control, stype, "GetExternalIPAddress", {});
    const ip = ext && ext.body.match(/<NewExternalIPAddress>([^<]+)</i);
    if (ip && ip[1] && ip[1] !== "0.0.0.0") {
      console.log("UPnP: porta", port, "mapeada, IP externo", ip[1]);
      return `${ip[1]}:${port}`;
    }
  } catch (e) { console.log("UPnP falhou:", e.message); }
  return null;
}

function broadcastOf(ip) {
  const p = ip.split(".");
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.255` : "255.255.255.255";
}

// -------------------------------------------------- servidor local (modo host)
let serverProc = null;
let serverLog = [];
let serverReady = false;
const HOST_PORT = 8787;

function serverCommand() {
  if (app.isPackaged) {
    const exe = path.join(process.resourcesPath, "server", process.platform === "win32" ? "mulacord-server.exe" : "mulacord-server");
    return { cmd: exe, args: [], cwd: path.dirname(exe) };
  }
  const serverDir = path.join(__dirname, "..", "..", "server");
  const venvPy = path.join(serverDir, ".venv", process.platform === "win32" ? "Scripts\\python.exe" : "bin/python");
  const fs = require("fs");
  const py = fs.existsSync(venvPy) ? venvPy : (process.platform === "win32" ? "py" : "python3");
  return { cmd: py, args: ["run.py"], cwd: serverDir };
}

function startHost(opts = {}) {
  if (serverProc) return { running: true, port: HOST_PORT };
  const { cmd, args, cwd } = serverCommand();
  serverLog = [];
  serverReady = false;

  const c = ensureCommunity();
  const dataDir = communityDataDir(c.id);
  fs.mkdirSync(dataDir, { recursive: true });

  // peers de partida: convite + endereço público + outros nós já vistos na LAN
  const boot = new Set(c.bootstrap || []);
  if (c.publicHost) boot.add(c.publicHost);
  try {
    for (const b of (lastLanBeacons || [])) {
      if (b.community_id === c.id && b.address) boot.add(`${b.address}:${b.http_port || HOST_PORT}`);
    }
  } catch {}

  const env = {
    ...process.env,
    MULACORD_HOST: "0.0.0.0",
    MULACORD_PORT: String(HOST_PORT),
    MULACORD_DATA_DIR: dataDir,
    MULACORD_COMMUNITY_ID: c.id,
    MULACORD_COMMUNITY_NAME: c.name,
    MULACORD_COMMUNITY_SECRET: c.secret || "",
    MULACORD_NODE_PRIORITY: String(c.priority || 0),
    MULACORD_PUBLIC_HOST: c.publicHost || "",
    MULACORD_BOOTSTRAP_PEERS: [...boot].join(","),
    MULACORD_SERVER_NAME: c.name,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  if (opts.name) { env.MULACORD_SERVER_NAME = opts.name; env.MULACORD_COMMUNITY_NAME = opts.name; }

  serverProc = spawn(cmd, args, { cwd, env });
  const onData = (buf) => {
    const line = buf.toString();
    serverLog.push(line);
    if (serverLog.length > 400) serverLog.shift();
    if (/Uvicorn running|Application startup complete/.test(line)) serverReady = true;
    mainWindow?.webContents.send("host-log", line);
  };
  serverProc.stdout.on("data", onData);
  serverProc.stderr.on("data", onData);
  serverProc.on("exit", (code) => {
    mainWindow?.webContents.send("host-log", `\n[servidor encerrou: ${code}]\n`);
    serverProc = null;
    serverReady = false;
    mainWindow?.webContents.send("host-state", hostStatus());
  });
  return { running: true, port: HOST_PORT };
}

function stopHost() {
  if (serverProc) {
    try { process.platform === "win32" ? spawn("taskkill", ["/pid", serverProc.pid, "/f", "/t"]) : serverProc.kill(); }
    catch {}
    serverProc = null;
    serverReady = false;
  }
  return hostStatus();
}

function hostStatus() {
  return {
    running: !!serverProc,
    ready: serverReady,
    port: HOST_PORT,
    pid: serverProc?.pid || null,
    lan: lanAddresses(),
    community: readCommunity(),
    log: serverLog.slice(-40).join(""),
  };
}

// Reinicia o nó (usado ao criar / entrar / sair de uma comunidade).
async function restartNode() {
  stopHost();
  await new Promise((r) => setTimeout(r, 400));
  return startHost();
}

// -------------------------------------------------- bandeja (semente do enxame)
function showWindow() {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  else createWindow();
}

function refreshTrayMenu() {
  if (!tray) return;
  const p = readPrefs();
  const c = readCommunity();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: c ? `${c.name} — no ar` : "Mulla Cord", enabled: false },
    { type: "separator" },
    { label: "Abrir Mulla Cord", click: showWindow },
    {
      label: "Manter no ar em segundo plano", type: "checkbox", checked: !!p.background,
      click: (mi) => writePrefs({ background: mi.checked }),
    },
    {
      label: "Iniciar com o Windows", type: "checkbox", checked: !!p.openAtLogin,
      click: (mi) => writePrefs({ openAtLogin: mi.checked }),
    },
    { type: "separator" },
    { label: "Sair", click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  if (tray) return;
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, "tray.png"));
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 18, height: 18 }));
    tray.setToolTip("Mulla Cord");
    tray.on("click", showWindow);
    refreshTrayMenu();
  } catch (e) { console.error("tray falhou:", e.message); }
}

// -------------------------------------------------- janela
function createWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: "#09090B",
    title: "Mulla Cord",
    frame: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    trafficLightPosition: { x: 12, y: 10 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;

  win.loadFile(path.join(__dirname, "..", "src", "index.html"));
  if (isDev && process.argv.includes("--dev")) win.webContents.openDevTools({ mode: "detach" });

  win.webContents.on("did-finish-load", () => {
    if (pendingDeepLink) { win.webContents.send("deep-link", pendingDeepLink); pendingDeepLink = null; }
  });

  // com "manter no ar" ligado, fechar a janela só esconde — o nó segue no enxame
  win.on("close", (e) => {
    if (!quitting && readPrefs().background) {
      e.preventDefault();
      win.hide();
      if (process.platform === "win32" && !trayHintShown) {
        tray?.displayBalloon?.({ title: "Mulla Cord", content: "Ainda no ar aqui na bandeja — seus amigos continuam alcançando esta comunidade." });
        trayHintShown = true;
      }
    }
  });

  // controles de janela
  ipcMain.handle("win:minimize", () => win.minimize());
  ipcMain.handle("win:toggle-maximize", () => { win.isMaximized() ? win.unmaximize() : win.maximize(); return win.isMaximized(); });
  ipcMain.handle("win:close", () => win.close());
  win.on("maximize", () => win.webContents.send("win:state", true));
  win.on("unmaximize", () => win.webContents.send("win:state", false));

  // descoberta / rede
  ipcMain.handle("net:discover", (_e, port) => discoverLan(port || 8788));
  ipcMain.handle("net:lan", () => lanAddresses());

  // detecção de jogos
  games.start((activity) => win.webContents.send("game-activity", activity));
  ipcMain.handle("game:configure", (_e, cfg) => games.configure(cfg || {}));
  ipcMain.handle("game:candidates", () => games.candidateProcesses());
  ipcMain.handle("game:current", () => games.current);

  // nó local (sempre no ar) + modo host manual
  ipcMain.handle("host:start", (_e, opts) => startHost(opts || {}));
  ipcMain.handle("host:stop", () => stopHost());
  ipcMain.handle("host:status", () => hostStatus());

  // comunidade
  ipcMain.handle("community:get", () => ensureCommunity());
  ipcMain.handle("community:create", async (_e, { name } = {}) => {
    const c = writeCommunity({ id: crypto.randomUUID().replace(/-/g, ""), name: name || "Minha comunidade", secret: "" });
    await restartNode();
    return c;
  });
  ipcMain.handle("community:join", async (_e, invite) => {
    // aceita um convite mula://join/… (string) ou um objeto {id,name,secret,addrs}
    // vindo direto de um beacon da rede local
    const parsed = (invite && typeof invite === "object" && invite.id) ? invite : parseInvite(invite);
    if (!parsed || !parsed.id) throw new Error("Convite inválido.");
    const c = writeCommunity({
      id: parsed.id, name: parsed.name || "Comunidade", secret: parsed.secret || "",
      bootstrap: parsed.addrs || [],
    });
    await restartNode();
    return { ...c, bootstrap: parsed.addrs || [] };
  });
  ipcMain.handle("community:update", async (_e, patch = {}) => {
    const cur = ensureCommunity();
    const c = writeCommunity({ ...cur, ...patch });
    await restartNode();
    return c;
  });
  ipcMain.handle("community:invite", () => buildInvite());

  // preferências do dispositivo (bandeja / iniciar com o Windows)
  ipcMain.handle("prefs:get", () => readPrefs());
  ipcMain.handle("prefs:set", (_e, patch) => writePrefs(patch || {}));

  // compartilhamento de tela
  let chosenSource = null;
  ipcMain.handle("screen:list-sources", async () => {
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 } });
    return sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
  });
  ipcMain.handle("screen:set-source", (_e, id) => { chosenSource = id; return true; });
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer.getSources({ types: ["screen", "window"] }).then((sources) => {
        const match = sources.find((s) => s.id === chosenSource) || sources[0];
        callback({ video: match, audio: "loopback" });
      });
    },
    { useSystemPicker: false }
  );
}

app.whenReady().then(() => {
  const link = process.argv.find((a) => a.startsWith("mula://"));
  if (link) pendingDeepLink = link;
  applyPrefs(readPrefs());
  // o nó local sobe sempre, em segundo plano — sem passo de "hospedar"
  try { startHost(); } catch (e) { console.error("falha ao subir o nó local:", e); }
  createTray();
  const startedHidden = process.argv.includes("--background") && readPrefs().background;
  if (!startedHidden) createWindow();

  // tenta abrir a porta no roteador pra alcance pela internet (best-effort)
  setTimeout(async () => {
    try {
      const c = ensureCommunity();
      if (c.publicHost) return;               // já tem endereço manual
      const ext = await upnpMapPort(HOST_PORT);
      if (ext && ext !== c.publicHost) {
        writeCommunity({ ...c, publicHost: ext });
        await restartNode();
        mainWindow?.webContents.send("host-log", `\n[UPnP: alcançável em ${ext}]\n`);
      }
    } catch {}
  }, 4000);

  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else showWindow(); });
});

app.on("before-quit", () => { quitting = true; stopHost(); games.stop(); });
app.on("window-all-closed", () => {
  if (readPrefs().background) return;   // segue vivo na bandeja
  stopHost(); games.stop();
  if (process.platform !== "darwin") app.quit();
});
