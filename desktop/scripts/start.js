// Lançador do app. Alguns ambientes (ex.: terminal integrado do VS Code)
// definem ELECTRON_RUN_AS_NODE=1, o que faz o Electron rodar como Node puro
// e quebrar (`app` fica undefined). Removemos a variável antes de subir.
"use strict";

const { spawn } = require("child_process");
const electron = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = ["."].concat(process.argv.slice(2));
const child = spawn(electron, args, { stdio: "inherit", env });

child.on("close", (code) => process.exit(code ?? 0));
