"use strict";

// Roda depois do electron-builder empacotar (antes de assinar os alvos).
//  1. Enxuga: remove os locales do Chromium que não usamos (~40 arquivos .pak).
//  2. Electron Fuses: blinda o binário (sem RunAsNode, sem NODE_OPTIONS, sem
//     --inspect, só carrega o app do asar, valida a integridade do asar embutido).
//  3. Windows: assina o mulacord-server.exe embutido (o hook win.sign não mexe
//     em extraResources). No macOS o electron-builder assina o .app inteiro depois.

const fs = require("fs");
const path = require("path");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");
const sign = require("./sign");

// Locales do Chromium a manter (o resto é peso morto: ~40 × ~50 KB + ar/fa/…).
const KEEP_LOCALES = new Set(["en-US", "pt-BR", "pt-PT"]);

function pruneLocales(localesDir) {
  if (!fs.existsSync(localesDir)) return 0;
  let removed = 0;
  for (const f of fs.readdirSync(localesDir)) {
    if (!f.endsWith(".pak")) continue;
    if (KEEP_LOCALES.has(f.slice(0, -4))) continue;
    fs.rmSync(path.join(localesDir, f));
    removed++;
  }
  return removed;
}

module.exports = async function afterPack(context) {
  const outDir = context.appOutDir;
  const platform = context.electronPlatformName; // win32 | darwin | linux
  const productFilename = context.packager.appInfo.productFilename || "Mulla Cord";

  // 1. locales
  const localesDir = platform === "darwin"
    ? path.join(outDir, `${productFilename}.app`, "Contents", "Frameworks", "Electron Framework.framework", "Resources")
    : path.join(outDir, "locales");
  try {
    const n = pruneLocales(localesDir);
    if (n) console.log(`[prune] ${n} locales do Chromium removidos`);
  } catch (e) {
    console.warn("[prune] falhou:", e.message);
  }

  // 2. Fuses — caminho do binário do Electron por plataforma
  const electronBin = platform === "darwin"
    ? path.join(outDir, `${productFilename}.app`, "Contents", "MacOS", productFilename)
    : path.join(outDir, `${productFilename}.exe`);

  try {
    await flipFuses(electronBin, {
      version: FuseVersion.V1,
      // no macOS a assinatura ad-hoc quebra ao mexer nos fuses; deixa o
      // electron-builder re-assinar o .app no passo seguinte.
      resetAdHocDarwinSignature: platform === "darwin",
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    });
    console.log(`[fuses] blindado ${path.basename(electronBin)}`);
  } catch (e) {
    console.error("[fuses] falhou:", e.message);
    throw e;
  }

  // 3. servidor embutido — só assinamos no Windows (signtool + cert do projeto)
  if (platform === "win32") {
    const serverExe = path.join(outDir, "resources", "server", "mulacord-server.exe");
    if (fs.existsSync(serverExe)) {
      try {
        await sign({ path: serverExe });
      } catch (e) {
        console.warn("[sign] servidor embutido não assinado:", e.message);
      }
    }
  }
};
