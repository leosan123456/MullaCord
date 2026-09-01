"use strict";

// Ofusca o JS do renderer para o pacote. NAO toca em src/ (o dev continua
// legivel) - copia src/ -> src.dist/ e ofusca a copia; o electron-builder
// empacota src.dist/ no lugar de src/ (ver "files" no package.json).
//
// "Ofuscar" != "criptografar": o codigo ainda roda no navegador do usuario e
// pode ser revertido com esforco. O objetivo e so que inspecao casual (F12 ->
// Sources) veja nomes sem sentido e strings codificadas, nao a logica limpa.

const fs = require("fs");
const path = require("path");
const JavaScriptObfuscator = require("javascript-obfuscator");

const SRC = path.join(__dirname, "..", "src");
const OUT = path.join(__dirname, "..", "src.dist");

const OPTIONS = {
  compact: true,
  target: "browser",
  // renomeia identificadores locais (imports/exports ESM sao preservados)
  identifierNamesGenerator: "mangled-shuffled",
  renameGlobals: false,
  // strings viram um array codificado em base64, buscado por indice embaralhado
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 0.9,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayIndexShift: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersType: "function",
  splitStrings: true,
  splitStringsChunkLength: 8,
  // control-flow flattening deixado leve: pesa no rAF da onda e no render de msgs
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.35,
  deadCodeInjection: false,
  numbersToExpressions: true,
  simplify: true,
  // nada de debugProtection/selfDefending: quebra o DevTools e o proprio dev
  debugProtection: false,
  selfDefending: false,
  disableConsoleOutput: false,
  sourceMap: false,
};

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function walk(dir, cb) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, cb);
    else cb(full);
  }
}

rmrf(OUT);
fs.cpSync(SRC, OUT, { recursive: true });

let n = 0;
let bytesIn = 0;
let bytesOut = 0;
walk(OUT, (file) => {
  if (!file.endsWith(".js")) return;
  const code = fs.readFileSync(file, "utf-8");
  bytesIn += code.length;
  const res = JavaScriptObfuscator.obfuscate(code, OPTIONS).getObfuscatedCode();
  fs.writeFileSync(file, res, "utf-8");
  bytesOut += res.length;
  n++;
});

console.log(`[obfuscate] ${n} arquivos JS -> src.dist/  (${(bytesIn / 1024).toFixed(0)} KB -> ${(bytesOut / 1024).toFixed(0)} KB)`);
