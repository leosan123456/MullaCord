"use strict";

// Roda depois do electron-builder empacotar (antes de assinar os alvos).
//  1. Electron Fuses: blinda o binario (sem RunAsNode, sem NODE_OPTIONS, sem
//     --inspect, so carrega o app do asar, valida a integridade do asar embutido).
//  2. Assina o mulacord-server.exe embutido (o hook win.sign nao mexe em extraResources).

const fs = require("fs");
const path = require("path");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");
const sign = require("./sign");

module.exports = async function afterPack(context) {
  const outDir = context.appOutDir;
  const exeName = (context.packager.appInfo.productFilename || "MullaCord") + ".exe";
  const electronExe = path.join(outDir, exeName);

  // 1. Fuses
  try {
    await flipFuses(electronExe, {
      version: FuseVersion.V1,
      resetAdHocDarwinSignature: false,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    });
    console.log(`[fuses] blindado ${exeName}`);
  } catch (e) {
    console.error("[fuses] falhou:", e.message);
    throw e;
  }

  // 2. assina o servidor embutido
  const serverExe = path.join(outDir, "resources", "server", "mulacord-server.exe");
  if (fs.existsSync(serverExe)) {
    try {
      await sign({ path: serverExe });
    } catch (e) {
      console.warn("[sign] servidor embutido nao assinado:", e.message);
    }
  }
};
