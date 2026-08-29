// Detecção de jogos rodando (Windows): compara os processos com uma lista de
// executáveis conhecidos + jogos que o usuário adicionou manualmente.
"use strict";

const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

let BUNDLED = {};
try {
  BUNDLED = JSON.parse(fs.readFileSync(path.join(__dirname, "games.json"), "utf-8"));
} catch { /* segue com lista vazia */ }

// processos que nunca contam como jogo (launchers, navegadores, o próprio app…)
const IGNORE = new Set([
  "steam.exe", "steamwebhelper.exe", "epicgameslauncher.exe", "battle.net.exe",
  "riotclientservices.exe", "eadesktop.exe", "origin.exe", "galaxyclient.exe",
  "ubisoftconnect.exe", "upc.exe", "playnite.desktopapp.exe", "discord.exe",
  "mullacord.exe", "electron.exe", "chrome.exe", "msedge.exe", "firefox.exe",
  "explorer.exe", "code.exe", "obs64.exe", "spotify.exe",
]);

let config = { enabled: true, custom: {} };   // custom: { "exe.exe": "Nome" }
let current = null;                            // { exe, name, since }  (since em segundos epoch)
let timer = null;
let onChange = () => {};
let lastProcesses = [];

function gamesMap() {
  const m = {};
  for (const [k, v] of Object.entries(BUNDLED)) m[k.toLowerCase()] = v;
  for (const [k, v] of Object.entries(config.custom || {})) m[k.toLowerCase()] = v;
  return m;
}

function listProcesses() {
  return new Promise((resolve) => {
    exec("tasklist /fo csv /nh", { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve([]);
      const names = [];
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/^"([^"]+\.exe)"/i);
        if (m) names.push(m[1].toLowerCase());
      }
      resolve([...new Set(names)]);
    });
  });
}

async function poll() {
  const procs = await listProcesses();
  lastProcesses = procs;
  if (!config.enabled) {
    if (current) { current = null; onChange(null); }
    return;
  }
  const map = gamesMap();
  const running = new Set(procs);
  let hit = null;
  for (const exe of Object.keys(map)) {
    if (running.has(exe)) { hit = { exe, name: map[exe] }; break; }
  }
  if ((hit && hit.exe) !== (current && current.exe)) {
    current = hit ? { exe: hit.exe, name: hit.name, since: Math.floor(Date.now() / 1000) } : null;
    onChange(current);
  }
}

function start(cb) {
  onChange = cb || (() => {});
  clearInterval(timer);
  poll();
  timer = setInterval(poll, 18000);
}

function stop() {
  clearInterval(timer);
  timer = null;
}

function configure(next) {
  config = { enabled: next.enabled !== false, custom: next.custom || {} };
  poll();
  return current;
}

// candidatos para o usuário marcar como jogo: processos que não são jogo/ignore
function candidateProcesses() {
  const known = new Set(Object.keys(gamesMap()));
  return lastProcesses
    .filter((p) => !IGNORE.has(p) && !known.has(p) && !p.startsWith("svchost") && !p.startsWith("runtime"))
    .sort();
}

module.exports = { start, stop, configure, candidateProcesses, get current() { return current; } };
