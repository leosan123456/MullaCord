// Gera desktop/build/icon.ico a partir do icon.png. Tamanhos enxutos para o NSIS
// não reclamar ("invalid icon file size").
"use strict";

const path = require("path");
const fs = require("fs");

const root = path.join(__dirname, "..");
const pngPath = path.join(root, "build", "icon.png");
const icoPath = path.join(root, "build", "icon.ico");

require("png-to-ico")(pngPath, { sizes: [16, 24, 32, 48, 64, 128, 256] })
  .then((buf) => {
    fs.writeFileSync(icoPath, buf);
    console.log(`✓ build/icon.ico gerado (${(buf.length / 1024).toFixed(1)} KB)`);
  })
  .catch((e) => { console.error(e); process.exit(1); });
