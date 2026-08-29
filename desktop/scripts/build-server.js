// Empacota o servidor Python com PyInstaller antes do electron-builder.
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const serverDir = path.join(__dirname, "..", "..", "server");
const venvPy = path.join(serverDir, ".venv", process.platform === "win32" ? "Scripts\\python.exe" : "bin/python");
const py = fs.existsSync(venvPy) ? venvPy : (process.platform === "win32" ? "py" : "python3");

console.log("→ PyInstaller:", py, "mulacord-server.spec");
const r = spawnSync(py, ["-m", "PyInstaller", "mulacord-server.spec", "--noconfirm", "--log-level", "WARN"], {
  cwd: serverDir,
  stdio: "inherit",
});
if (r.status !== 0) {
  console.error("PyInstaller falhou. Instale as dependências de build: pip install -r requirements-build.txt");
  process.exit(r.status || 1);
}

const out = path.join(serverDir, "dist", "mulacord-server", process.platform === "win32" ? "mulacord-server.exe" : "mulacord-server");
if (!fs.existsSync(out)) {
  console.error("Executável não encontrado em", out);
  process.exit(1);
}
console.log("✓ servidor empacotado em", out);
