"use strict";

const { app, BrowserWindow, ipcMain, session, desktopCapturer } = require("electron");
const path = require("path");
const os = require("os");
const dgram = require("dgram");
const { spawn } = require("child_process");
const games = require("./games");

const isDev = !app.isPackaged;
let mainWindow = null;
let pendingDeepLink = null;

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
        found.set(data.server_id || url, {
          url, name: data.name, server_id: data.server_id,
          version: data.version, members: data.members, address: rinfo.address,
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
      setTimeout(() => { try { sock.close(); } catch {} resolve([...found.values()]); }, timeout);
    });
  });
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
  const env = { ...process.env, MULACORD_HOST: "0.0.0.0", MULACORD_PORT: String(HOST_PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  if (opts.name) env.MULACORD_SERVER_NAME = opts.name;

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
    log: serverLog.slice(-40).join(""),
  };
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

  // modo host
  ipcMain.handle("host:start", (_e, opts) => startHost(opts || {}));
  ipcMain.handle("host:stop", () => stopHost());
  ipcMain.handle("host:status", () => hostStatus());

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
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("before-quit", () => { stopHost(); games.stop(); });
app.on("window-all-closed", () => { stopHost(); games.stop(); if (process.platform !== "darwin") app.quit(); });
