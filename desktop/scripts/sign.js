"use strict";

// Hook de assinatura do electron-builder (win.sign). Assina cada .exe/.dll do
// pacote com o certificado auto-assinado do projeto (build/MullaCord-CodeSign.pfx),
// com timestamp RFC3161 pra assinatura seguir valida apos o cert expirar.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const BUILD = path.join(__dirname, "..", "build");
const PFX = path.join(BUILD, "MullaCord-CodeSign.pfx");
const PASS_FILE = path.join(BUILD, ".cert-pass");
const TIMESTAMP_URLS = [
  "http://timestamp.digicert.com",
  "http://timestamp.sectigo.com",
  "http://time.certum.pl",
];

function findSigntool() {
  const roots = [
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    process.env.ProgramFiles || "C:\\Program Files",
  ];
  for (const root of roots) {
    const binDir = path.join(root, "Windows Kits", "10", "bin");
    if (!fs.existsSync(binDir)) continue;
    const versions = fs.readdirSync(binDir)
      .filter((d) => /^\d+\./.test(d))
      .sort()
      .reverse();
    for (const v of versions) {
      const p = path.join(binDir, v, "x64", "signtool.exe");
      if (fs.existsSync(p)) return p;
    }
    const direct = path.join(binDir, "x64", "signtool.exe");
    if (fs.existsSync(direct)) return direct;
  }
  return "signtool"; // torce pra estar no PATH
}

const SIGNTOOL = findSigntool();

module.exports = async function sign(configuration) {
  const file = configuration.path;
  if (!fs.existsSync(PFX) || !fs.existsSync(PASS_FILE)) {
    console.warn(`[sign] sem certificado (${PFX}) - pulando ${path.basename(file)}. Rode: npm run cert`);
    return;
  }
  const pass = fs.readFileSync(PASS_FILE, "utf-8").trim();

  let lastErr;
  for (const ts of TIMESTAMP_URLS) {
    try {
      execFileSync(SIGNTOOL, [
        "sign",
        "/fd", "sha256",
        "/f", PFX,
        "/p", pass,
        "/tr", ts,
        "/td", "sha256",
        "/d", "Mulla Cord",
        "/du", "https://github.com/leosan123456/MullaCord",
        file,
      ], { stdio: ["ignore", "pipe", "pipe"] });
      console.log(`[sign] ${path.basename(file)}  (timestamp ${ts})`);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  // ultimo recurso: assina sem timestamp
  try {
    execFileSync(SIGNTOOL, ["sign", "/fd", "sha256", "/f", PFX, "/p", pass, "/d", "Mulla Cord", file],
      { stdio: ["ignore", "pipe", "pipe"] });
    console.log(`[sign] ${path.basename(file)}  (SEM timestamp - servidores fora do ar)`);
  } catch (e) {
    console.error(`[sign] FALHOU em ${path.basename(file)}:`, (lastErr || e).message);
    throw e;
  }
};
