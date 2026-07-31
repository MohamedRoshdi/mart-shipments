/* The whole contract between the desktop shell and the app: three functions and a name.

   files.js looks for exactly this shape and prefers it over everything else, so the web build
   needs no knowledge that a desktop build exists — and this file is the only place that would
   change if the shell were ever swapped for Tauri or anything else. */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mart", {
  /* Shown on the settings screen so the manager can see where the files are going. It is asked
     for over IPC rather than read from process.env here: what a preload sees of `process` depends
     on whether the renderer is sandboxed, and main.js is the side that owns ROOT anyway. */
  root: () => ipcRenderer.invoke("mart:root"),
  saveText: (folder, name, text) => ipcRenderer.invoke("mart:saveText", folder, name, text),
  readText: (folder, name) => ipcRenderer.invoke("mart:readText", folder, name),
  listFolder: (folder) => ipcRenderer.invoke("mart:listFolder", folder),
});
