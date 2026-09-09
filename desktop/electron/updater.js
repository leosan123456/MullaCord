"use strict";

// Atualização automática do app.
//
// Windows: electron-updater lê o latest.yml da Release do GitHub, baixa o pacote
//   (diferencial — só os blocos que mudaram) em segundo plano e instala quando o
//   app for fechado. O usuário vê um aviso discreto "reiniciar para aplicar".
// macOS: só AVISA (abre o .dmg da Release). O Squirrel.Mac exige assinatura da
//   Apple pra auto-update, que o projeto ainda não tem.
//
// Em dev (não empacotado) e com MULACORD_NO_UPDATER=1 fica desligado.

const { app, shell } = require("electron");
const https = require("https");

const REPO = "leosan123456/MullaCord";
const CHECK_EVERY_MS = 3 * 60 * 60 * 1000; // 3h

let win = null;
let timer = null;
let au = null; // autoUpdater (Windows)
let inited = false;
let onChange = null;
let state = { status: "idle", version: null, percent: 0, notes: "", url: "" };

function send() {
  try { win?.webContents.send("updater-state", state); } catch {}
  try { onChange?.(state); } catch {}
}
function set(patch) {
  const before = state.status;
  state = { ...state, ...patch };
  send();
  return before !== state.status;
}

// "1.5.2" mais novo que "1.5.1"? (3 números; sufixos ignorados)
function isNewer(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

function relNotes(info) {
  const n = info && info.releaseNotes;
  if (!n) return "";
  if (typeof n === "string") return n;
  if (Array.isArray(n)) return n.map((x) => x.note || "").join("\n");
  return "";
}

// ---------------------------------------------------------------- macOS: avisa
function macCheck() {
  const opts = {
    host: "api.github.com",
    path: `/repos/${REPO}/releases/latest`,
    headers: { "User-Agent": "MullaCord-Updater", Accept: "application/vnd.github+json" },
  };
  https.get(opts, (res) => {
    let body = "";
    res.on("data", (c) => (body += c));
    res.on("end", () => {
      try {
        const rel = JSON.parse(body);
        const latest = String(rel.tag_name || "").replace(/^v/, "");
        if (latest && isNewer(latest, app.getVersion())) {
          const arch = process.arch === "arm64" ? "arm64" : "x64";
          const asset = (rel.assets || []).find((a) => a.name === `MullaCord-${arch}.dmg`);
          set({
            status: "available-manual",
            version: latest,
            notes: rel.body || "",
            url: asset ? asset.browser_download_url : rel.html_url,
          });
        }
      } catch { /* ignora */ }
    });
  }).on("error", () => {});
}

// ---------------------------------------------------------------- init
function init(mainWindow) {
  win = mainWindow;
  send();                       // manda o estado atual pra janela (nova/recarregada)
  if (inited) return;
  inited = true;
  if (!app.isPackaged || process.env.MULACORD_NO_UPDATER === "1") {
    set({ status: "disabled" });
    return;
  }

  if (process.platform === "darwin") {
    macCheck();
    timer = setInterval(macCheck, CHECK_EVERY_MS);
    return;
  }

  try {
    ({ autoUpdater: au } = require("electron-updater"));
  } catch (e) {
    set({ status: "error", error: "electron-updater ausente: " + e.message });
    return;
  }

  au.autoDownload = true;
  au.autoInstallOnAppQuit = true;
  au.allowDowngrade = false;
  // O projeto ainda assina com um cert self-signed (ou nada, no CI sem secret).
  // A verificação de Authenticode rejeitaria o update; a integridade fica pelo
  // sha512 do latest.yml. Reative quando houver um cert de CA com publisher fixo.
  au.verifyUpdateCodeSignature = false;

  au.on("checking-for-update", () => set({ status: "checking" }));
  au.on("update-available", (info) =>
    set({ status: "downloading", version: info.version, percent: 0, notes: relNotes(info) }));
  au.on("update-not-available", () => set({ status: "idle" }));
  au.on("download-progress", (p) => set({ status: "downloading", percent: Math.round(p.percent || 0) }));
  au.on("update-downloaded", (info) =>
    set({ status: "ready", version: info.version, percent: 100, notes: relNotes(info) }));
  au.on("error", (err) => set({ status: "error", error: String((err && err.message) || err) }));

  const run = () => { try { au.checkForUpdates(); } catch {} };
  setTimeout(run, 8000);            // deixa o app assentar
  timer = setInterval(run, CHECK_EVERY_MS);
}

function check() {
  if (process.platform === "darwin") return macCheck();
  try { au?.checkForUpdates(); } catch {}
}

function install() {
  if (state.status !== "ready" || !au) return { ok: false };
  try {
    au.quitAndInstall(false, true);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function openDownload() {
  shell.openExternal(state.url || `https://github.com/${REPO}/releases/latest`);
}

function getState() { return state; }
function onStateChange(fn) { onChange = fn; }
function stop() { clearInterval(timer); timer = null; }

module.exports = { init, check, install, openDownload, getState, onStateChange, stop };
