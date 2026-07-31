/* The Windows build. It is a window around the SAME files GitHub Pages serves — no fork, no
   second copy, no build step for the app itself. Everything under desktop/ is the shell, and
   nothing in it is ever loaded by the web version.

   Two decisions worth keeping:

   1. The app is served over http://127.0.0.1 on a random port rather than loaded from file://.
      ES modules, the service worker and the Firebase SDK all behave differently (or not at all)
      on file://, and the point of a single codebase is that the desktop build runs the same code
      down the same paths. A local server is a few lines and removes every one of those
      differences. It binds to the loopback address only.

   2. The renderer gets no Node. window.mart is three functions over IPC, and every path is
      resolved and checked against the root before anything is written — a folder name arrives
      from a shipment type the shop typed, so it is never trusted to stay inside D:\import. */

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const http = require("node:http");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

// where the ERP looks for its import files. MART_ROOT overrides it for a test machine.
const ROOT = process.env.MART_ROOT || "D:\\import";

const WEB = path.join(__dirname, "..");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

/* Serve the repo root. The URL is never user input — it is whatever the pages of the app link
   to — but a served directory still gets the traversal check, because "never" is a property of
   the code as it stands today and this outlives it. */
function serve() {
  return new Promise((ok) => {
    const server = http.createServer(async (req, res) => {
      const rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const file = path.resolve(WEB, "." + (rel === "/" ? "/index.html" : rel));
      /* startsWith(WEB) is not the check it looks like: a SIBLING directory sharing the prefix
         passes it, so serving from /…/alaelah-mart would also serve /…/alaelah-mart-evil. The
         separator is what makes it mean "inside". Same shape as inside() below — one idea, one
         spelling. */
      if (file !== WEB && !file.startsWith(WEB + path.sep)) { res.writeHead(403).end(); return; }
      try {
        const body = await fs.readFile(file);
        res.writeHead(200, {
          "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
          // the shell ships the files, so a cached copy must never outlive an update
          "Cache-Control": "no-store",
        });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(0, "127.0.0.1", () => ok(`http://127.0.0.1:${server.address().port}`));
  });
}

/* ---------- the bridge ---------- */

// A folder name comes from a shipment type the shop typed. Resolve it, then prove it stayed home.
function inside(folder, name) {
  const root = path.resolve(ROOT);
  const dir = path.resolve(root, folder || "");
  const file = name ? path.resolve(dir, name) : dir;
  const home = (p) => p === root || p.startsWith(root + path.sep);
  if (!home(dir) || !home(file)) throw new Error("مسار غير مسموح");
  return { dir, file };
}

ipcMain.handle("mart:saveText", async (_e, folder, name, text) => {
  const { dir, file } = inside(folder, name);
  await fs.mkdir(dir, { recursive: true });        // إنشاء المجلدات تلقائيًا, from the spec
  await fs.writeFile(file, text, "utf8");
  return file;
});

ipcMain.handle("mart:readText", async (_e, folder, name) => {
  const { file } = inside(folder, name);
  return fs.readFile(file, "utf8");               // the caller reads a rejection as "not there"
});

ipcMain.handle("mart:listFolder", async (_e, folder) => {
  const { dir } = inside(folder, "");
  return fs.readdir(dir);
});

ipcMain.handle("mart:root", () => ROOT);

/* ---------- the window ---------- */

async function open() {
  const base = await serve();
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    title: "العائلة مارت",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,       // the renderer never sees Node, only the three functions
      nodeIntegration: false,
    },
  });
  // a link to anywhere else belongs in a normal browser, not in a window holding a bridge
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  await win.loadURL(base);
  return win;
}

app.whenReady().then(async () => {
  try { fsSync.mkdirSync(ROOT, { recursive: true }); } catch (e) { console.error(e); }
  await open();
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) open(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
