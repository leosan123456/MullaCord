"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mula", {
  listScreenSources: () => ipcRenderer.invoke("screen:list-sources"),
  setScreenSource: (id) => ipcRenderer.invoke("screen:set-source", id),

  win: {
    minimize: () => ipcRenderer.invoke("win:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("win:toggle-maximize"),
    close: () => ipcRenderer.invoke("win:close"),
    onState: (cb) => ipcRenderer.on("win:state", (_e, m) => cb(m)),
  },

  net: {
    discover: (port) => ipcRenderer.invoke("net:discover", port),
    lan: () => ipcRenderer.invoke("net:lan"),
  },

  host: {
    start: (opts) => ipcRenderer.invoke("host:start", opts),
    stop: () => ipcRenderer.invoke("host:stop"),
    status: () => ipcRenderer.invoke("host:status"),
    onLog: (cb) => ipcRenderer.on("host-log", (_e, line) => cb(line)),
    onState: (cb) => ipcRenderer.on("host-state", (_e, s) => cb(s)),
  },

  onDeepLink: (cb) => ipcRenderer.on("deep-link", (_e, url) => cb(url)),
});
