/* The desktop shell, checked without Electron.

   Two things in desktop/main.js carry real weight. The path guard is security-relevant: a folder
   name reaches it from a shipment type the shop typed, and the renderer is a web page. And the
   local server is what makes "one codebase" true rather than a claim — if it serves the wrong
   bytes or the wrong content type, the desktop build silently stops being the same app.

   Neither should need a 200 MB download or a display to test, so electron is stubbed out of the
   require cache: the IPC handlers are called directly, and the window stub hands back the URL
   the real one would have loaded.

   Run: node scripts/desktop-check.cjs */

const Module = require("module");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mart-desktop-"));
process.env.MART_ROOT = ROOT;

const handlers = {};
let sawUrl;
const urlReady = new Promise((done) => { sawUrl = done; });

const stub = {
  app: { whenReady: () => Promise.resolve(), on() {} },
  BrowserWindow: class {
    constructor() { this.webContents = { setWindowOpenHandler() {} }; }
    async loadURL(u) { sawUrl(u); }
    static getAllWindows() { return [1]; }
  },
  ipcMain: { handle: (k, fn) => { handlers[k] = fn; } },
  shell: { openExternal() {} },
};
const load = Module._load;
Module._load = (req, ...rest) => (req === "electron" ? stub : load(req, ...rest));

require(path.join(__dirname, "..", "desktop", "main.js"));

let bad = 0;
const ok = (name, cond) => { console.log((cond ? "ok   " : "FAIL ") + name); if (!cond) bad++; };
const rejects = async (p) => { try { await p; return false; } catch { return true; } };
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

(async () => {
  /* ---------- the bridge ---------- */
  ok("the three handlers are registered",
    !!handlers["mart:saveText"] && !!handlers["mart:readText"] && !!handlers["mart:listFolder"]);

  const file = await handlers["mart:saveText"](null, "اذن استلام", "المراعي.txt", "111\t3");
  ok("writes the file, creating the folder on the way", fs.existsSync(file));
  ok("the bytes are exactly what was handed over", fs.readFileSync(file, "utf8") === "111\t3");
  ok("it landed under the root", file.startsWith(ROOT + path.sep));

  ok("reads the same file back (this is what the ERP check needs)",
    (await handlers["mart:readText"](null, "اذن استلام", "المراعي.txt")) === "111\t3");
  ok("lists the folder",
    (await handlers["mart:listFolder"](null, "اذن استلام")).includes("المراعي.txt"));

  ok("a folder that climbs out is refused",
    await rejects(handlers["mart:saveText"](null, "../../escape", "evil.txt", "x")));
  ok("a file name that climbs out is refused",
    await rejects(handlers["mart:saveText"](null, "اذن استلام", "../../evil.txt", "x")));
  ok("an absolute folder is refused",
    await rejects(handlers["mart:saveText"](null, "/etc", "evil.txt", "x")));
  ok("a missing file rejects rather than reading as empty text",
    await rejects(handlers["mart:readText"](null, "اذن استلام", "nope.txt")));

  /* ---------- the server ---------- */
  const base = await urlReady;
  ok("binds the loopback address only", base.startsWith("http://127.0.0.1:"));

  const get = async (p) => {
    const r = await fetch(base + p);
    return { status: r.status, type: r.headers.get("content-type") || "",
             cache: r.headers.get("cache-control") || "", body: await r.text() };
  };

  const home = await get("/");
  ok("the root is index.html", home.status === 200 && home.body === read("index.html"));
  ok("served as html", home.type.startsWith("text/html"));
  ok("never cached, so a new build is never shadowed by an old one", home.cache === "no-store");

  const js = await get("/files.js");
  ok("modules are served as javascript, or nothing would import at all",
    js.status === 200 && js.type.startsWith("text/javascript"));
  ok("and it is byte for byte the SAME files.js the web build uses", js.body === read("files.js"));

  const css = await get("/style.css");
  ok("the stylesheet is css", css.status === 200 && css.type.startsWith("text/css"));
  ok("a missing file is a 404, not a crash", (await get("/nope.js")).status === 404);

  fs.rmSync(ROOT, { recursive: true, force: true });
  console.log(bad ? "FAILED: " + bad : "all good");
  process.exit(bad ? 1 : 0);
})();
