"use strict";

// Assina os artefatos finais (MullaCord-Setup-*.exe, MullaCord-portable-*.exe)
// com o certificado do projeto. Feito aqui (e nao pelo electron-builder) pra
// nao acionar o download do winCodeSign, que quebra neste Windows (symlinks).

const sign = require("./sign");

module.exports = async function afterAllArtifactBuild(buildResult) {
  const exes = (buildResult.artifactPaths || []).filter((p) => p.toLowerCase().endsWith(".exe"));
  for (const exe of exes) {
    try {
      await sign({ path: exe });
    } catch (e) {
      console.warn(`[sign] artefato nao assinado: ${exe} - ${e.message}`);
    }
  }
  return [];
};
