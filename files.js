/* Where a file goes when it leaves the app.

   Everything used to go through one <a download>, which means the browser's Save dialog and a
   folder the app never learns. The shop wants the TXT to land in D:\import\<نوع الإذن>\ with no
   dialog at all, and the ERP check afterwards has to READ that file back — neither is possible
   through a download.

   Three backends, tried in this order:

   1. `window.mart` — a desktop bridge (an Electron/Tauri preload). Truly silent, no prompt ever.
      Nothing in the repo provides it yet; files.js only has to prefer it, so the desktop shell
      can be added later without one line of app code changing.
   2. The File System Access API. The user picks D:\import ONCE, the handle is kept in IndexedDB,
      and every write after that is silent. Chrome and Edge on Windows, which is what the shop
      has. This is the one that makes the feature work with no build and no install.
   3. The download that has always happened. Every other browser, and every phone, keeps behaving
      exactly as it does today — that is why this module can be dropped in front of the existing
      exports without changing what anyone sees.

   A directory handle cannot be JSON, so localStorage is not an option: it has to be IndexedDB,
   which is the only reason there is any IDB code here. */

const DB = "mart-files";
const STORE = "handles";
const KEY = "root";

/* ---------- the handle store ---------- */

const idb = () => new Promise((ok, no) => {
  const req = indexedDB.open(DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  req.onsuccess = () => ok(req.result);
  req.onerror = () => no(req.error);
});

const idbDo = async (mode, fn) => {
  const db = await idb();
  return new Promise((ok, no) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => ok(req && req.result);
    tx.onerror = () => no(tx.error);
  });
};

const getHandle = () => idbDo("readonly", (s) => s.get(KEY)).catch(() => null);
const putHandle = (h) => idbDo("readwrite", (s) => s.put(h, KEY));
const dropHandle = () => idbDo("readwrite", (s) => s.delete(KEY));

/* ---------- what this browser can do ---------- */

export const bridge = () => (typeof window !== "undefined" ? window.mart : null) || null;

export const supported = () => !!bridge()
  || (typeof window !== "undefined" && typeof window.showDirectoryPicker === "function");

/* The handle survives a reload but the PERMISSION may not: Chrome re-asks once per session in
   some versions. `prompt` decides whether the user is asked now or the call just reports that it
   cannot write — an export must never pop a permission dialog the person did not ask for. */
async function usableRoot(prompt) {
  const h = await getHandle();
  if (!h) return null;
  const opts = { mode: "readwrite" };
  if ((await h.queryPermission(opts)) === "granted") return h;
  if (!prompt) return null;
  return (await h.requestPermission(opts)) === "granted" ? h : null;
}

/** True when a file can be written to disk right now, without asking anybody anything. */
export async function available() {
  if (bridge()) return true;
  if (!supported()) return false;
  return !!(await usableRoot(false));
}

/** The chosen folder's name, for the settings screen. Null when none is chosen. */
export async function folderName() {
  if (bridge()) return bridge().root().catch(() => "D:\\import");
  const h = await getHandle();
  return h ? h.name : null;
}

/** Ask for the folder. This is the ONE prompt, and only a button may cause it. */
export async function chooseFolder() {
  // the desktop build owns its folder; there is nothing to pick and nothing to ask
  if (bridge()) return folderName();
  if (!supported()) throw new Error("المتصفح ده مش بيسمح بالحفظ في مجلد — افتح البرنامج من كروم على الويندوز");
  const h = await window.showDirectoryPicker({ mode: "readwrite", startIn: "documents" });
  await putHandle(h);
  return h.name;
}

export async function forgetFolder() {
  if (!bridge()) await dropHandle();
}

/* ---------- names ---------- */

/* Windows forbids these outright, and a folder name that contains one is a write that fails.
   `.` and `..` are stripped too. The desktop bridge already proves every path stayed under its
   root (six checks in scripts/desktop-check.cjs) and the File System Access API refuses those two
   names itself — but a segment builder that can emit ".." is only safe because of what happens to
   be downstream of it today, and that is not a property worth relying on. */
export const safeSegment = (s) => {
  const t = String(s || "").replace(/[\\/:*?"<>|]/g, "-").trim().replace(/[. ]+$/, "");
  return !t || t === "." || t === ".." ? "ملف" : t;
};

/* A second file for the same supplier must not overwrite the first. The extra part is the caller's
   (a permit number when there is one), and the timestamp is the fallback — the point is only that
   two files on the same day are two files. */
export function uniqueName(base, ext, taken, extra) {
  const first = `${base}${ext}`;
  if (!taken.includes(first)) return first;
  if (extra) {
    const withExtra = `${base} - ${safeSegment(extra)}${ext}`;
    if (!taken.includes(withExtra)) return withExtra;
  }
  for (let n = 2; ; n++) {
    const next = `${base} (${n})${ext}`;
    if (!taken.includes(next)) return next;
  }
}

/* ---------- reading and writing ---------- */

// mkdir -p, one segment at a time: the API has no recursive create
async function folderHandle(root, folder, create) {
  let dir = root;
  for (const part of String(folder || "").split(/[\\/]+/).filter(Boolean)) {
    dir = await dir.getDirectoryHandle(safeSegment(part), { create });
  }
  return dir;
}

/** The names already in a folder. [] when there is no folder to look in. */
export async function listFolder(folder) {
  if (bridge()) return bridge().listFolder(folder).catch(() => []);
  const root = await usableRoot(false);
  if (!root) return [];
  try {
    const dir = await folderHandle(root, folder, false);
    const out = [];
    for await (const name of dir.keys()) out.push(name);
    return out;
  } catch { return []; }             // no such folder yet is not an error, it is "nothing there"
}

/** One file's text, or null when it is not there. This is what the ERP check reads back. */
export async function readText(folder, name) {
  if (bridge()) return bridge().readText(folder, name).catch(() => null);
  const root = await usableRoot(false);
  if (!root) return null;
  try {
    const dir = await folderHandle(root, folder, false);
    return (await (await dir.getFileHandle(name)).getFile()).text();
  } catch { return null; }
}

/* Write a text file, creating the folders on the way. Returns where it actually went, because the
   toast has to be honest: «اتحفظ في D:\import\...» and «اتحمّل» are different things and the
   person needs to know which one happened. */
export async function saveText(folder, name, text) {
  const safe = safeSegment(name);
  if (bridge()) {
    try {
      await bridge().saveText(folder, safe, text);
      return { how: "disk", path: `${folder}\\${safe}` };
    } catch (e) {
      /* Same promise the File System Access branch below makes: a full disk, an unplugged D:\
         or a refused path must still hand the person their file. Without this, the rejection
         was unhandled — no toast, no file — on a shipment ALREADY marked «تم تحميلها», which
         is the one order of events the TXT flow cannot afford. */
      console.error(e);
    }
  }
  const root = await usableRoot(false);
  if (root) {
    try {
      const dir = await folderHandle(root, folder, true);
      const file = await dir.getFileHandle(safe, { create: true });
      const w = await file.createWritable();
      await w.write(text);
      await w.close();
      return { how: "disk", path: `${root.name}\\${folder}\\${safe}` };
    } catch (e) {
      // a disk that is full or a folder that vanished must still hand the person their file
      console.error(e);
    }
  }
  downloadBlob(safe, new Blob([text], { type: "text/plain;charset=utf-8" }));
  return { how: "download", path: safe };
}

/** The download that has always happened. Kept here so there is one copy of it. */
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
