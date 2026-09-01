"use strict";

// Gera a arte do instalador (BMP 24-bit) num unico render do Edge headless
// (3 blocos empilhados numa pagina so, recortados via Pillow). Saida em build/:
//   installerSidebar.bmp   164x314  painel da esquerda (welcome / finish)
//   installerHeader.bmp    150x57   cabecalho das paginas internas
//   splash.bmp             480x320  splash com fade na abertura (AdvSplash)

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const BUILD = path.join(__dirname, "..", "build");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mc-art-"));

const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => fs.existsSync(p));
const PY = [
  path.join(__dirname, "..", "..", "server", ".venv", "Scripts", "python.exe"),
].find((p) => fs.existsSync(p)) || "py";

const INK = "#09090B", SIGNAL = "#FACC15", SUSTAIN = "#EAB306";
const TEXT = "#FFFFFF", MUTE = "#A1A1AA";

const LOGO = (w) => `<svg viewBox="0 0 32 32" width="${w}" height="${w}">
  <rect width="32" height="32" rx="9" fill="${SIGNAL}"/>
  <path d="M11.5 9 15 13.5M20.5 9 17 13.5" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>
  <ellipse cx="16" cy="18.5" rx="7" ry="6.2" fill="${INK}"/>
  <circle cx="13.7" cy="18" r="1.5" fill="${SIGNAL}"/><circle cx="18.3" cy="18" r="1.5" fill="${SIGNAL}"/>
</svg>`;

function wave(w, h, opacity) {
  const mid = h / 2;
  let d = `M0 ${mid}`;
  for (let x = 0; x <= w; x += 6) {
    const y = mid + Math.sin((x / w) * 7) * h * 0.22 + Math.sin((x / w) * 19 + 1) * h * 0.07;
    d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return `<svg width="${w}" height="${h}" style="opacity:${opacity}"><path d="${d}" fill="none" stroke="${SIGNAL}" stroke-width="2" stroke-linecap="round"/></svg>`;
}

const SIDEBAR = `<div style="width:164px;height:314px;position:relative;overflow:hidden;background:${INK}">
  <div style="position:absolute;width:200px;height:200px;border-radius:50%;filter:blur(60px);background:${SUSTAIN};opacity:.28;left:-70px;top:-40px"></div>
  <div style="position:absolute;right:0;top:0;bottom:0;width:2px;background:linear-gradient(180deg,transparent,${SIGNAL},transparent)"></div>
  <div style="position:absolute;left:0;right:0;top:46%;transform:translateY(-50%);opacity:.5">${wave(164, 120, 0.7)}</div>
  <div style="position:absolute;left:22px;top:34px">${LOGO(44)}</div>
  <div style="position:absolute;left:22px;top:96px;line-height:1.05;font-weight:800;letter-spacing:-.03em">
    <div style="font-size:26px">Mulla</div><div style="font-size:26px;color:${SIGNAL}">Cord</div>
  </div>
  <div style="position:absolute;left:22px;bottom:26px">
    <div style="color:${SUSTAIN};font-size:9px;letter-spacing:.22em;text-transform:uppercase;font-weight:600">Your community</div>
    <div style="color:${MUTE};font-size:11px;margin-top:3px">in tune.</div>
  </div>
</div>`;

const HEADER = `<div style="width:150px;height:57px;position:relative;overflow:hidden;background:${INK}">
  <div style="position:absolute;left:0;right:0;bottom:0;opacity:.4">${wave(150, 28, 0.6)}</div>
  <div style="display:flex;align-items:center;gap:8px;padding:11px 12px">${LOGO(24)}
    <span style="font-weight:800;letter-spacing:-.03em;font-size:15px">Mulla<span style="color:${SIGNAL}"> Cord</span></span>
  </div>
</div>`;

const SPLASH = `<div style="width:480px;height:320px;position:relative;overflow:hidden;background:${INK}">
  <div style="position:absolute;width:340px;height:340px;border-radius:50%;filter:blur(60px);background:${SUSTAIN};opacity:.22;left:70px;top:-90px"></div>
  <div style="position:absolute;width:260px;height:260px;border-radius:50%;filter:blur(60px);background:${SIGNAL};opacity:.12;right:-60px;bottom:-90px"></div>
  <div style="position:absolute;left:0;right:0;top:58%;transform:translateY(-50%);opacity:.55">${wave(480, 150, 0.75)}</div>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px">
    ${LOGO(60)}
    <div style="font-weight:800;letter-spacing:-.03em;font-size:38px">Mulla<span style="color:${SIGNAL}"> Cord</span></div>
    <div style="color:${SUSTAIN};font-size:10px;letter-spacing:.22em;text-transform:uppercase;font-weight:600">Your community, in tune</div>
  </div>
  <div style="position:absolute;left:0;right:0;bottom:0;height:3px;background:${SIGNAL}"></div>
</div>`;

const W = 480, H = 314 + 8 + 57 + 8 + 320;
const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;box-sizing:border-box}
html,body{width:${W}px;background:#000;overflow:hidden}
body{font-family:"Segoe UI Variable","Segoe UI",system-ui,sans-serif;color:${TEXT}}
.row{display:block}
</style></head><body>
<div class="row" id="sb">${SIDEBAR}</div><div style="height:8px"></div>
<div class="row" id="hd">${HEADER}</div><div style="height:8px"></div>
<div class="row" id="sp">${SPLASH}</div>
</body></html>`;

function fail(msg) {
  console.warn(`[art] ${msg} - mantendo os BMP que ja estao em build/`);
  process.exit(0);
}

if (!EDGE) fail("msedge.exe nao encontrado");

const htmlPath = path.join(TMP, "art.html");
const pngPath = path.join(TMP, "art.png");
fs.writeFileSync(htmlPath, HTML, "utf-8");

try {
  execFileSync(EDGE, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-sandbox",
    "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    "--virtual-time-budget=2500",
    `--window-size=${W},${H}`,
    `--screenshot=${pngPath}`,
    "file:///" + htmlPath.replace(/\\/g, "/"),
  ], { stdio: "ignore", timeout: 90000 });
} catch { /* headless as vezes nao encerra limpo; segue se o PNG saiu */ }

if (!fs.existsSync(pngPath)) fail("Edge nao gerou o PNG");

const crops = [
  ["installerSidebar", 0, 0, 164, 314],
  ["installerHeader", 0, 314 + 8, 150, 57],
  ["splash", 0, 314 + 8 + 57 + 8, 480, 320],
];
const pyCode = crops.map(([name, x, y, w, h]) =>
  `Image.open(r'${pngPath}').convert('RGB').crop((${x},${y},${x + w},${y + h})).save(r'${path.join(BUILD, name + ".bmp")}','BMP')`
).join("; ");
try {
  execFileSync(PY, ["-c", `from PIL import Image; ${pyCode}`], { stdio: "ignore", timeout: 30000 });
} catch (e) { fail("Pillow falhou ao recortar (" + e.message + ")"); }

for (const [name, , , w, h] of crops) {
  const kb = (fs.statSync(path.join(BUILD, name + ".bmp")).size / 1024).toFixed(0);
  console.log(`[art] ${name}.bmp  ${w}x${h}  ${kb} KB`);
}
fs.rmSync(TMP, { recursive: true, force: true });
