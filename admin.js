import * as db from "./db.js";
import * as auth from "./auth.js";
import * as lbl from "./label.js";
import { sheetRows, requireColumns } from "./sheet.js";
import { versionLine } from "./version.js";
import * as files from "./files.js";
import { applyBrand } from "./brand.js";
import { keepFresh } from "./fresh.js";

const $ = (id) => document.getElementById(id);
const esc = (t) => { const d = document.createElement("div"); d.textContent = t; return d.innerHTML; };
const escAttr = (t) => esc(t).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const fmtWhen = (ts) => new Date(ts).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
const ALL = "الكل";

// the PIN shipped in firebase-config.js always works, even after the admin changes the
// stored one — without it a wrong save (or a stranger's) would lock the owner out for good
const CODE_ADMIN_PIN = window.APP_CONFIG.adminPin;

function toast(msg, kind) {
  const t = $("toast");
  t.textContent = msg;
  t.className = kind ? `show t-${kind}` : "show";
  setTimeout(() => { t.className = ""; }, 2200);
}

$("version-line").textContent = versionLine();

const TITLES = {
  "screen-pin": "العائلة مارت — النظام",
  "screen-admin": "إعدادات النظام",
  "screen-data": "بيانات النظام",
  "screen-label": "ليبل الرف",
  "screen-btw": "قوالب الطباعة",
  "screen-folder": "مجلد الاستيراد",
  "screen-pins": "الأرقام السرية",
  "screen-danger": "أدوات خطرة",
  "screen-status": "حالة النظام",
  "screen-logs": "آخر العمليات",
};
// screens you can go back from, and the ones that edit the working copy (they carry the save bar)
const DEEP = ["screen-data", "screen-label", "screen-btw", "screen-folder", "screen-pins", "screen-danger", "screen-status", "screen-logs"];
const EDITING = ["screen-data", "screen-label", "screen-pins"];

let cfg = null;        // working copy of the settings
let identity = "الأدمن";
let dirty = false;
let shipments = [];    // loaded once, for the bulk-delete count
let counts = [];       // الجرد is deleted from the same tool
let shipmentsLoaded = false;
let bulkKind = "shipments";
let bulkBranch = ALL;
let bulkType = ALL;

const KIND_LABEL = { shipments: "الشحنات", counts: "الجرد" };

let screen = "screen-pin";

function render(id) {
  screen = id;
  document.querySelectorAll("main > section").forEach(s => s.hidden = true);
  $(id).hidden = false;
  $("screen-title").textContent = TITLES[id] || "النظام";
  $("btn-back").hidden = !DEEP.includes(id);
  $("btn-logs").hidden = id !== "screen-admin";
  // the save bar follows the editing screens — and the menu too while a change is unsaved,
  // so backing out of a screen never puts «حفظ» out of reach
  $("cfg-savebar").hidden = !(EDITING.includes(id) || (dirty && id === "screen-admin"));
  scrollTo(0, 0);
}

addEventListener("popstate", (ev) => {
  const id = (ev.state && ev.state.screen) || "screen-admin";
  render(TITLES[id] && id !== "screen-pin" ? id : "screen-admin");
});

$("btn-back").onclick = () => history.back();

// the menu: every card is one area, opened as its own screen
document.querySelector("#screen-admin .actions").onclick = (e) => {
  const btn = e.target.closest("button[data-goto]");
  if (!btn) return;
  const id = btn.dataset.goto;
  history.pushState({ screen: id }, "");
  render(id);
  if (id === "screen-logs") loadLogs();
  if (id === "screen-btw") renderBtw().catch(console.error);
  if (id === "screen-status") renderStatus();
};

/* «حالة النظام»: what the owner would otherwise have to ask a human. Every line here is already
   in memory — the config, the version, this machine's own copy — so opening the screen costs
   NOTHING. The one number that needs the server («عدد الأصناف») is a button, because on the free
   plan a read is a thing worth spending on purpose. */
const statusRow = (label, value, cls = "") =>
  `<li class="${cls}"><div class="card-main"><div class="card-title">${esc(label)}</div>
    <div class="meta">${esc(value)}</div></div></li>`;

/* The day's allowance, as a bar. Google does not let a client read the project's own counters,
   so this is what THIS device spent — the row says so, because a number that looks shop-wide and
   is not would be worse than no number. It is still the answer to «مين صرف الحصة؟»: open it on
   the laptop that did the importing and the writes are there. */
const bar = (label, used, cap, note) => {
  const pct = Math.min(100, Math.round((used / cap) * 100));
  const cls = pct >= 90 ? "st-bad" : pct >= 60 ? "st-warn" : "st-ok";
  return `<li class="${cls}"><div class="card-main">
      <div class="card-title">${esc(label)}</div>
      <!-- «من», never «/»: a slash between two numbers inside an RTL line flips which one reads first -->
      <div class="meta">${used.toLocaleString("en-US")} من ${cap.toLocaleString("en-US")} · ${pct}٪</div>
      <div class="meta">${esc(note)}</div>
      <div class="quota-bar"><span style="inline-size:${pct}%"></span></div>
    </div></li>`;
};

let productCount = null;             // filled only when the owner asks for it, never on open

// the day's allowance, in the words the shop would use. A spent quota does not FAIL a write —
// it makes it wait, which is why «الحفظ بيتأخر» is the symptom and not an error message.
function quotaLine() {
  const err = db.dbError();
  if (!err || Date.now() - err.at > 30 * 60 * 1000) return ["شغالة", "st-ok"];
  if (err.code === "resource-exhausted")
    return [`خلصت النهارده — الحفظ هيتأخر لحد ما ترجع الساعة ١٠ صباحًا (آخر رفض ${fmtWhen(err.at)})`, "st-bad"];
  return [`فيه مشكلة اتسجلت: ${err.message}`, "st-warn"];
}

// what this machine is holding for the name search, and how old it is
function copyLine() {
  let idx = null;
  try { idx = JSON.parse(localStorage.getItem("catalogIndex") || "null"); } catch { idx = null; }
  return idx && idx.rows
    ? `${idx.rows.length} صنف · اتاخدت ${fmtWhen(idx.at)}`
    : "مفيش نسخة — هتتاخد أول مرة تدوّر باسم";
}

function renderStatus() {
  const cfg = window.APP_CONFIG;
  const [quota, quotaCls] = quotaLine();
  const stamps = Object.entries(cfg.filesMeta || {});
  const u = db.usage();
  $("status-list").innerHTML = [
    statusRow("الاتصال بالإنترنت",
      navigator.onLine ? "متصل" : "مفيش اتصال — الشغل بيتحفظ على الجهاز لحد ما يرجع",
      navigator.onLine ? "st-ok" : "st-bad"),
    statusRow("الحصة اليومية المجانية", quota, quotaCls),
    bar("الحفظ النهارده (من الجهاز ده)", u.writes, db.QUOTA.writes,
      "كل صنف بيتحفظ لوحده، فاستيراد ملف الأصناف كامل بياخد حوالي ١٠ آلاف"),
    bar("القراءة النهارده (من الجهاز ده)", u.reads, db.QUOTA.reads,
      "أول مرة تدوّر باسم بتنزّل الكتالوج كله مرة واحدة على الجهاز"),
    statusRow("الحصة بترجع", "كل يوم الساعة ١٠ صباحًا بتوقيت مصر"),
    statusRow("نسخة التطبيق على الجهاز ده", versionLine()),
    statusRow("المستخدمين", `${(cfg.users || []).length} مستخدم`),
    statusRow("الفروع", (cfg.branches || []).map(b => b.name).join(" · ") || "—"),
    statusRow("الموردين", `${db.supplierList(cfg).length} مورد`),
    statusRow("أنواع الشحنات", (cfg.shipmentTypes || []).join(" · ") || "—"),
    statusRow("نسخة الأصناف المحفوظة على الجهاز ده", copyLine()),
    statusRow("عدد الأصناف في السيرفر",
      productCount === null ? "اضغط الزرار تحت عشان تعرفه" : `${productCount} صنف`),
    ...(stamps.length
      ? stamps.map(([kind, m]) => statusRow(`آخر استيراد: ${kind}`,
        `${fmtWhen(m.at)}${m.rows ? ` · ${m.rows} صف` : ""}${m.by ? ` · ${m.by}` : ""}`))
      : [statusRow("آخر استيراد", "مفيش ملفات اتستوردت لسه")]),
  ].join("");
}

$("btn-count-products").onclick = async () => {
  $("btn-count-products").disabled = true;
  $("btn-count-products").textContent = "بنعدّ...";
  try {
    productCount = await db.countProducts();
    toast(`${productCount} صنف في السيرفر`, "ok");
  } catch (err) {
    console.error(err);
    toast(err && err.code === "resource-exhausted"
      ? "الحصة اليومية خلصت — جرّب بكرة بعد الساعة ١٠"
      : "مقدرناش نعدّ الأصناف — جرّب تاني", "bad");
  }
  $("btn-count-products").disabled = false;
  $("btn-count-products").textContent = "اعرف عدد الأصناف دلوقتي";
  renderStatus();
};


let cfgReady = null;

$("btn-pin").onclick = async () => {
  await cfgReady;
  const entered = $("pin-input").value;
  const who = auth.authenticate(entered, window.APP_CONFIG, CODE_ADMIN_PIN);
  if (!who) { toast("الرقم السري غلط"); return; }
  if (who.blocked) { toast("الرقم ده مربوط بموبايل تاني — كلّم الأدمن يفكّه الأول"); return; }
  if (who.claim) db.claimDevice(entered, who.claim);
  if (!who.perms.includes("adm")) {                 // right PIN, but not for this screen
    const page = auth.landingPage(who.perms);
    if (!page) { toast("المستخدم ده مالوش صلاحيات — كلّم الأدمن"); return; }
    auth.startSession(who.name, who.branches, who.perms, who.user);
    toast("الصفحة دي مش من صلاحياتك — بنوديك لصفحتك");
    setTimeout(() => auth.goTo(page), 900);
    return;
  }
  auth.startSession(who.name, who.branches, who.perms, who.user);
  $("pin-input").value = "";
  await enterAdmin();
};

async function enterAdmin() {
  identity = (auth.session() || {}).name || "الأدمن";
  history.replaceState({ screen: "screen-admin" }, "");
  render("screen-admin");
  renderAll();
  $("danger-tools").hidden = !canDo("danger");
  // the menu card too, or a no-permission admin opens an empty screen
  document.querySelector('[data-goto="screen-danger"]').hidden = !canDo("danger");
  $("btn-logout").hidden = !auth.session();
  [shipments, counts] = await Promise.all([
    db.listShipments().catch(() => []),
    db.listCounts().catch(() => []),
  ]);
  shipmentsLoaded = true;
  renderBulk();
}

// signing in is mandatory now, so no session means an EXPIRED one — deny, never grant
const canDo = (perm) => auth.can(perm);

$("btn-logout").onclick = () => {
  auth.endSession();
  location.reload();
};


/* `saveConfig` writes the WHOLE settings doc, so two people editing at once means the second
   save silently erases the first. This page cannot merge them — it can refuse to pretend the
   problem is not there: while it is dirty it stops following the server, and says so. */
let serverAhead = false;

function paintDirty() {
  $("cfg-dirty").textContent = serverAhead
    ? "فيه تعديل مش محفوظ — وفيه تعديلات جديدة من جهاز تاني"
    : "فيه تعديل مش محفوظ";
  $("cfg-dirty").classList.toggle("warn", serverAhead);
}

function markDirty() {
  dirty = true;
  paintDirty();
  $("cfg-savebar").hidden = !(EDITING.includes(screen) || screen === "screen-admin");
}

function renderAll() {
  renderUsers();
  renderBranches();
  renderTypes();
  $("cfg-manager-pin").value = cfg.managerPin;
  $("cfg-admin-pin").value = cfg.adminPin;
  // a shop with fifty suppliers should not tap «+ إضافة» fifty times: one line each, paste and go
  $("cfg-suppliers").value = cfg.suppliers.map(supplierLine).join("\n");
  paintSuppliers();
  renderLabelCfg();
  renderBulk();
  renderFolder();       // per machine, not part of cfg — it just paints beside everything else
}

/* --- ليبل الرف: the size, the paper and the logo. Everything the printing screen reads. --- */

const SHEETS = { label: "ليبل حراري", a4: "ورق A4" };
const LOGO_PX = 360;          // a shelf label is 66 mm wide; more pixels than this print the same
const LOGO_CAP = 150000;      // characters of data URL, well under the rules' ceiling

function renderLabelCfg() {
  $("cfg-label-w").value = cfg.label.w;
  $("cfg-label-h").value = cfg.label.h;
  $("cfg-label-gap").value = cfg.label.gap;
  const roll = cfg.label.sheet !== "a4";        // an A4 sheet is one piece of paper — nothing to pace
  $("cfg-gap-row").hidden = !roll;
  $("cfg-gap-note").hidden = !roll;
  $("cfg-label-sheet").innerHTML = Object.entries(SHEETS).map(([k, label]) =>
    `<button type="button" data-sheet="${k}" aria-pressed="${k === cfg.label.sheet}">${esc(label)}</button>`).join("");
  $("label-logo-preview").innerHTML = cfg.label.logo
    ? `<img src="${escAttr(cfg.label.logo)}" alt="شعار المحل">`
    : `<p class="meta">مفيش شعار — الليبل هيطلع بالاسم والباركود بس.</p>`;
}

$("cfg-label-sheet").onclick = (e) => {
  const btn = e.target.closest("button[data-sheet]");
  if (!btn) return;
  readInputs();
  cfg.label.sheet = btn.dataset.sheet;
  renderLabelCfg();
  markDirty();
};

$("btn-label-logo").onclick = () => $("cfg-label-logo").click();

// The logo travels inside the settings doc, so it has to be small: it is redrawn at printing
// width before it is stored, and a picture that is still too big is refused instead of silently
// bloating a document every phone reads at boot.
$("cfg-label-logo").onchange = async () => {
  const file = $("cfg-label-logo").files[0];
  if (!file) return;
  let data = "";
  try {
    data = await shrinkImage(file);
  } catch (err) {
    console.error(err);
    toast("مقدرناش نقرا الصورة — جرّب صورة تانية", "bad");
    return;
  }
  if (data.length > LOGO_CAP) { toast("الصورة كبيرة — استخدم صورة أصغر أو أوضح"); return; }
  readInputs();
  cfg.label.logo = data;
  $("cfg-label-logo").value = "";
  renderLabelCfg();
  markDirty();
  toast("الشعار اتحمّل — اضغط «حفظ الإعدادات»");
};

/* ---------- the import folder ----------
   Per machine, never in the settings doc: the folder is a property of the PC the manager works
   on, the same reasoning as the camera settings. It is also the one thing here that CANNOT be
   saved to Firestore — a directory handle is not data, it is a permission this browser holds. */

async function renderFolder() {
  const name = await files.folderName();
  const ok = await files.available();
  $("folder-now").hidden = !name;
  $("folder-now").textContent = name
    ? (ok ? `المجلد الحالي: ${name}` : `المجلد الحالي: ${name} — محتاج إذن تاني، دوس «اختار مجلد الاستيراد»`)
    : "";
  // in the Windows build the shell owns the folder: a button that cannot change it is a button
  // that looks broken, so both of them go and the note says where the files land
  if (files.bridge()) {
    $("btn-folder-pick").hidden = true;
    $("btn-folder-clear").hidden = true;
    $("folder-note").textContent = `ملفات TXT بتتحفظ لوحدها في ${name} — المجلد ده جزء من نسخة الويندوز.`;
    return;
  }
  $("btn-folder-clear").hidden = !name;
  $("btn-folder-pick").textContent = name ? "غيّر المجلد" : "اختار مجلد الاستيراد";
  $("btn-folder-pick").disabled = !files.supported();
  if (!files.supported()) {
    $("folder-note").textContent =
      "ده للكمبيوتر اللي بيستورد في نظام المحل، مش للموبايل: افتح الصفحة دي من كروم أو Edge على الويندوز واختار مجلد الاستيراد مرة واحدة، وساعتها ملفات TXT هتتحفظ فيه لوحدها من غير نافذة حفظ. على الموبايل الملفات بتتحمّل عادي.";
  }
}

$("btn-folder-pick").onclick = async () => {
  try {
    const name = await files.chooseFolder();
    toast(`المجلد اتحدد: ${name}`, "ok");
  } catch (err) {
    // the user closing the picker is not a failure and must not shout at them
    if (err && err.name === "AbortError") return;
    console.error(err);
    toast(err.message || "مقدرناش نحدد المجلد", "bad");
  }
  renderFolder();
};

$("btn-folder-clear").onclick = async () => {
  await files.forgetFolder();
  toast("اتشال المجلد — الملفات هترجع تتحمّل زي الأول");
  renderFolder();
};

/* ---------- BarTender templates: .btw files in «قوالب الطباعة» under the picked root.
   The folder IS the registry — nothing about a template lives in Firestore, because a .btw can
   outgrow the 1MB doc cap and only the machine with BarTender can use it anyway. ---------- */

const BT_TPL = "قوالب الطباعة";

async function renderBtw() {
  const ok = await files.available();
  $("btw-none").hidden = ok;
  $("btn-btw-add").disabled = !ok;
  const tpls = ok ? (await files.listFiles(BT_TPL)).filter((f) => /\.btw$/i.test(f.name)) : [];
  $("btw-list").innerHTML = tpls.length ? tpls.map((t) => `<li>
      <div class="card-main"><div class="card-title">${esc(t.name)}</div></div>
      <button type="button" class="ghost" data-btw-del="${escAttr(t.name)}">حذف</button>
    </li>`).join("") : `<li class="empty">مفيش قوالب لسه — ارفع ملف btw وهيظهر هنا وفي شاشة مهام الطباعة.</li>`;
}

$("btn-btw-add").onclick = () => $("btw-file").click();
$("btw-file").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const out = await files.saveBytes(BT_TPL, file.name, await file.arrayBuffer());
  if (!out) {
    toast(files.bridge()
      ? "نسخة الويندوز لسه مش بتدعم رفع القوالب من هنا — انسخ ملف btw لمجلد «قوالب الطباعة» بنفسك"
      : "مفيش مجلد متاح على الجهاز ده — اختار مجلد الاستيراد الأول", "bad");
    return;
  }
  db.logAction(identity, "رفع قالب طباعة", file.name);
  toast(`القالب اترفع: ${out.path}`, "ok");
  renderBtw().catch(console.error);
};

$("btw-list").onclick = async (e) => {
  const b = e.target.closest("button[data-btw-del]");
  if (!b) return;
  const name = b.dataset.btwDel;
  if (!confirm(`نمسح قالب «${name}»؟`)) return;
  if (!(await files.removeFile(BT_TPL, name))) { toast("مقدرناش نمسح الملف", "bad"); return; }
  db.logAction(identity, "حذف قالب طباعة", name);
  toast("اتمسح القالب");
  renderBtw().catch(console.error);
};

$("btn-label-logo-clear").onclick = () => {
  readInputs();
  cfg.label.logo = "";
  renderLabelCfg();
  markDirty();
};

async function shrinkImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = fail;
      i.src = url;
    });
    const scale = Math.min(1, LOGO_PX / (img.naturalWidth || 1));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const png = c.toDataURL("image/png");            // keeps a logo's transparent background
    return png.length > LOGO_CAP ? c.toDataURL("image/jpeg", 0.85) : png;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* --- suppliers: one per line, «كود، اسم». The code is the shop's own, and it rides onto every
   shipment saved under that supplier's name. A line with no code is still a supplier. --- */

const isCode = (s) => /^[0-9A-Za-z\-_/]{1,20}$/.test(s);

// one row, already split into cells — from a typed line or from a sheet with no header row
function supplierCells(cells) {
  const parts = cells.map(c => String(c == null ? "" : c).trim()).filter(Boolean);
  if (!parts.length) return null;
  // only a leading cell that looks like a code is one: an Arabic first cell is part of the name
  if (parts.length >= 2 && isCode(parts[0])) return { code: parts[0], name: parts.slice(1).join(" ") };
  return { code: "", name: parts.join(" ") };
}

// the textarea: a person types «كود، اسم» by hand, and that shape must not change
const parseSupplier = (line) => supplierCells(line.split(/[,،;\t]/));

const supplierLine = (s) => (s.code ? `${s.code}، ${s.name}` : s.name);
const suppliersTyped = () => $("cfg-suppliers").value.split("\n").map(parseSupplier).filter(Boolean);

function paintSuppliers() {
  const list = suppliersTyped();
  const coded = list.filter(s => s.code).length;
  $("suppliers-count").textContent = list.length
    ? `${list.length} مورد · ${coded} منهم بكود`
    : "مفيش موردين — الموظف هيكتب الاسم بنفسه";
}

$("cfg-suppliers").oninput = () => { paintSuppliers(); markDirty(); };

$("btn-suppliers-file").onclick = () => $("suppliers-file").click();

// the file replaces the box, it does not append: the shop's list is the shop's list
$("suppliers-file").onchange = async () => {
  const file = $("suppliers-file").files[0];
  if (!file) return;
  let rows = [], map = null;
  try {
    rows = await sheetRows(file);
    // the ERP exports «كود المورد | اسم المورد»; the header is what makes that order stop mattering
    map = requireColumns(rows, ["supplierCode", "supplierName"]);
  } catch (err) {
    console.error(err);
    toast(err.message || "مقدرناش نقرا الملف — تأكد إنه Excel أو CSV", "bad");
    $("suppliers-file").value = "";
    return;
  }
  const read = map
    ? rows.slice(1).map(c => ({ code: String(c[map.supplierCode] || "").trim(),
                               name: String(c[map.supplierName] || "").trim() }))
    : rows.map(supplierCells);
  // the same code twice in one file is one supplier, the later row winning — «تحديث لا تكرار»
  const byCode = new Map();
  const list = [];
  for (const s of read) {
    if (!s || !s.name) continue;
    if (!s.code) { list.push(s); continue; }
    if (byCode.has(s.code)) { list[byCode.get(s.code)] = s; continue; }
    byCode.set(s.code, list.length);
    list.push(s);
  }
  $("suppliers-file").value = "";
  if (!list.length) { toast("الملف مفيهوش موردين"); return; }
  $("cfg-suppliers").value = list.map(supplierLine).join("\n");
  paintSuppliers();
  markDirty();
  toast(`اتقرأ ${list.length} مورد — اضغط «حفظ الإعدادات»`, "ok");
};

// one card per user: name, PIN, branch, and a tick for every screen and every action
function renderUsers() {
  const branchOpts = ["", ...cfg.branches.map(b => b.name)];
  $("users-list").innerHTML = cfg.users.map((u, i) => `<li class="user-card">
      <div class="card-main">
        <input type="text" maxlength="40" data-uname="${i}" value="${escAttr(u.name)}" placeholder="اسم المستخدم">
        <div class="user-row">
          <input type="text" inputmode="numeric" maxlength="8" dir="ltr" data-upin="${i}" value="${escAttr(u.pin)}" placeholder="الرقم السري">
          <button class="del" data-deluser="${i}" aria-label="حذف المستخدم">×</button>
        </div>
        <div class="user-row">
          <span class="meta">${u.multi ? "مسموح له يدخل من أي جهاز" : (u.device ? "مربوط بموبايل واحد" : "مش مربوط بموبايل — أول موبايل يدخل بيه هيتربط")}</span>
          ${!u.multi && u.device ? `<button type="button" class="ghost" data-unbind="${i}">فك الارتباط</button>` : ""}
        </div>
        <div class="user-row">
          <button type="button" class="ghost" data-umulti="${i}" aria-pressed="${!!u.multi}">${u.multi ? "رجّعه لجهاز واحد" : "اسمح له بأكتر من جهاز"}</button>
        </div>
      </div>
      <div class="seg" data-ubranch="${i}">
        ${branchOpts.map(b => `<button type="button" data-branchpick="${escAttr(b)}" aria-pressed="${b ? auth.branchesOf(u).includes(b) : auth.branchesOf(u).length === 0}">${esc(b || "كل الفروع")}</button>`).join("")}
      </div>
      <div class="perm-grid" data-uperms="${i}">
        ${auth.PERMS.map(p => `<button type="button" data-perm="${p.id}" aria-pressed="${(u.perms || []).includes(p.id)}">${esc(p.label)}</button>`).join("")}
      </div>
    </li>`).join("") || `<li class="empty">مفيش مستخدمين — التطبيق شغال بالأرقام القديمة لحد ما تضيف أول واحد</li>`;
}

$("users-list").onclick = (e) => {
  const del = e.target.closest("button[data-deluser]");
  if (del) {
    readInputs();
    const gone = cfg.users.splice(+del.dataset.deluser, 1)[0];
    renderUsers();
    markDirty();
    toast(`اتشال «${gone.name || "مستخدم"}»`);
    return;
  }
  const unbind = e.target.closest("button[data-unbind]");
  if (unbind) {
    readInputs();
    const u = cfg.users[+unbind.dataset.unbind];
    delete u.device;
    renderUsers();
    markDirty();
    toast(`«${u.name || "المستخدم"}» يقدر يدخل من موبايل جديد — اضغط «حفظ الإعدادات»`);
    return;
  }
  const multi = e.target.closest("button[data-umulti]");
  if (multi) {
    readInputs();
    const u = cfg.users[+multi.dataset.umulti];
    // «ماينفعش نفس المستخدم يفتح من جهاز تاني إلا المديرين اللي أنا أحددهم» (the owner, 2026-08-01):
    // multi frees this one account from the one-phone rule; turning it back on drops any old binding
    // so the NEXT phone to sign in becomes the bound one, not a phone from before the exception.
    if (u.multi) { delete u.multi; delete u.device; } else u.multi = true;
    renderUsers();
    markDirty();
    return;
  }
  const perm = e.target.closest("button[data-perm]");
  if (perm) {
    readInputs();
    const i = +perm.closest("[data-uperms]").dataset.uperms;
    const list = cfg.users[i].perms || (cfg.users[i].perms = []);
    const at = list.indexOf(perm.dataset.perm);
    if (at >= 0) list.splice(at, 1); else list.push(perm.dataset.perm);
    renderUsers();
    markDirty();
    return;
  }
  const branch = e.target.closest("button[data-branchpick]");
  if (branch) {
    readInputs();
    const u = cfg.users[+branch.closest("[data-ubranch]").dataset.ubranch];
    const pick = branch.dataset.branchpick;
    const list = auth.branchesOf(u);
    if (!pick) u.branches = [];                       // "كل الفروع" clears the list
    else if (list.includes(pick)) u.branches = list.filter(b => b !== pick);
    else u.branches = [...list, pick];
    delete u.branch;                                  // the old single-branch field is gone
    renderUsers();
    markDirty();
  }
};

$("btn-add-user").onclick = () => {
  readInputs();
  cfg.users.push({ name: "مستخدم جديد", pin: "", branches: cfg.branches[0] ? [cfg.branches[0].name] : [], perms: ["emp", "create"] });
  renderUsers();
  markDirty();
};

// inputs are read on save, not on every keystroke: re-rendering a row would eat the focus
function renderBranches() {
  $("branches-list").innerHTML = cfg.branches.map((b, i) => `<li>
      <div class="card-main">
        <input type="text" maxlength="40" data-bname="${i}" value="${escAttr(b.name)}">
      </div>
      <button class="del" data-delbranch="${i}" aria-label="حذف الفرع">×</button>
    </li>`).join("") || `<li class="empty">مفيش فروع — ضيف فرع الأول</li>`;
}

function renderTypes() {
  $("types-list").innerHTML = cfg.shipmentTypes.map((t, i) => `<li>
      <div class="card-main">
        <input type="text" maxlength="30" data-tname="${i}" value="${escAttr(t)}">
      </div>
      <button class="del" data-deltype="${i}" aria-label="حذف النوع">×</button>
    </li>`).join("") || `<li class="empty">مفيش أنواع — ضيف نوع الأول</li>`;
}

function readInputs() {
  document.querySelectorAll("input[data-uname]").forEach(inp => cfg.users[+inp.dataset.uname].name = inp.value.trim());
  document.querySelectorAll("input[data-upin]").forEach(inp => cfg.users[+inp.dataset.upin].pin = inp.value.trim());
  document.querySelectorAll("input[data-bname]").forEach(inp => cfg.branches[+inp.dataset.bname].name = inp.value.trim());
  document.querySelectorAll("input[data-tname]").forEach(inp => cfg.shipmentTypes[+inp.dataset.tname] = inp.value.trim());
  cfg.managerPin = $("cfg-manager-pin").value.trim();
  cfg.adminPin = $("cfg-admin-pin").value.trim();
  cfg.suppliers = suppliersTyped();
  // labelCfg clamps a typed size back into range, so a half-typed number never reaches the doc
  cfg.label = lbl.labelCfg({ label: {
    ...cfg.label, w: $("cfg-label-w").value, h: $("cfg-label-h").value, gap: $("cfg-label-gap").value,
  } });
}

/* One delegate over the whole page, not just #screen-admin: the users/branches/types inputs
   live on #screen-data, and typing there never marked the page dirty — so the unload guard
   skipped, «فيه تعديل مش محفوظ» never showed, and (since 1.0.78) a live update from another
   machine would have overwritten what was being typed. Only the settings screens count: the
   PIN box and the bulk-delete tools are not edits to the config. */
document.querySelector("main").oninput = (e) => {
  if (!e.target.matches("input, textarea")) return;
  if (!EDITING.includes(screen) && screen !== "screen-admin") return;
  markDirty();
};

$("branches-list").onclick = (e) => {
  const btn = e.target.closest("button[data-delbranch]");
  if (!btn) return;
  readInputs();
  const gone = cfg.branches.splice(+btn.dataset.delbranch, 1)[0];
  renderBranches();
  renderBulk();
  markDirty();
  toast(`اتشال «${gone.name}» — الشحنات القديمة بتفضل زي ما هي`);
};

$("types-list").onclick = (e) => {
  const btn = e.target.closest("button[data-deltype]");
  if (!btn) return;
  readInputs();
  cfg.shipmentTypes.splice(+btn.dataset.deltype, 1);
  renderTypes();
  renderBulk();
  markDirty();
};

$("btn-add-branch").onclick = () => {
  readInputs();
  cfg.branches.push({ name: "فرع جديد" });
  renderBranches();
  markDirty();
};

$("btn-add-type").onclick = () => {
  readInputs();
  cfg.shipmentTypes.push("نوع جديد");
  renderTypes();
  markDirty();
};

const isPin = (p) => /^\d{4,8}$/.test(p);
// The same ceiling firestore.rules enforces. Raised from 300 on 2026-07-31: the shop's real list
// is 425 and the save was being refused. 1000 × «كود، اسم» is ~60 KB inside a 1 MB document, and
// every page reads that document once at boot.
const SUPPLIER_CAP = 1000;

$("btn-save-config").onclick = async () => {
  // belt to the disabled-button braces: a click that races the boot must hit the same wall
  if (!cfgFromServer) { toast("الإعدادات ما اتقرتش من السيرفر — ما ينفعش نحفظ فوقها", "bad"); return; }
  readInputs();
  if (!cfg.branches.length) { toast("لازم فرع واحد على الأقل"); return; }
  if (!cfg.shipmentTypes.filter(Boolean).length) { toast("لازم نوع شحنة واحد على الأقل"); return; }
  if (cfg.branches.some(b => !b.name)) { toast("في فرع من غير اسم"); return; }
  if (!isPin(cfg.managerPin) || !isPin(cfg.adminPin)) { toast("رقم المدير ورقم الأدمن لازم من 4 لـ 8 أرقام"); return; }
  const names = cfg.branches.map(b => b.name);
  if (new Set(names).size !== names.length) { toast("في اسم فرع متكرر"); return; }

  // a repeated PIN would silently hand one person another person's screens
  if (cfg.users.some(u => !u.name)) { toast("في مستخدم من غير اسم"); return; }
  if (cfg.users.some(u => !isPin(u.pin))) { toast("رقم المستخدم لازم يكون من 4 لـ 8 أرقام"); return; }
  if (cfg.users.some(u => !(u.perms || []).some(p => auth.SCREEN_PERMS.includes(p)))) {
    toast("كل مستخدم لازم يفتح شاشة واحدة على الأقل");
    return;
  }
  const pins = [...cfg.users.map(u => u.pin), cfg.managerPin, cfg.adminPin];
  if (new Set(pins).size !== pins.length) { toast("في رقم سري متكرر — كل واحد لازم يكون لوحده"); return; }
  // 2026-08-01: the production users list was emptied by two saves that carried 0 users (the audit
  // trail shows the counts). A save that wipes every account gets one loud question first.
  if (!cfg.users.length && (window.APP_CONFIG.users || []).length
    && !confirm("الحفظ ده هيمسح كل المستخدمين، وكلهم هيدخلوا بالأرقام القديمة.\nمتأكد؟")) return;
  /* Somebody saved from another device while this page was being edited. The write below replaces
     the whole doc, so going ahead erases their change — the honest thing is to say so and let the
     human pick, because only they know which of the two edits matters. */
  if (serverAhead && !confirm(
    "فيه تعديلات اتحفظت من جهاز تاني وإنت بتعدّل هنا.\nلو كمّلت حفظ، تعديلاتهم هتتمسح."
    + "\n\nاضغط «إلغاء» وحدّث الصفحة عشان تشوف تعديلاتهم الأول، أو «موافق» لو تعديلك إنت هو الصح.")) return;
  if (cfg.suppliers.length > SUPPLIER_CAP) { toast(`الموردين أكتر من ${SUPPLIER_CAP} — شيل اللي مش شغال معاك`); return; }

  const payload = {
    managerPin: cfg.managerPin,
    adminPin: cfg.adminPin,
    branches: cfg.branches.map(b => ({ name: b.name })),   // a branch is a name, not a password
    shipmentTypes: cfg.shipmentTypes.filter(Boolean),
    suppliers: cfg.suppliers,
    label: cfg.label,                                      // size, paper and logo of the shelf label
    // device carries the phone this account is bound to — dropping it here would silently
    // unbind every user on any settings save
    users: cfg.users.map(u => ({
      name: u.name, pin: u.pin, branches: auth.branchesOf(u), perms: u.perms.slice(),
      ...(u.device ? { device: u.device } : {}),
      ...(u.multi ? { multi: true } : {}),   // the one-phone exception must survive a save, like device
    })),
    // same trap as `device`: saveConfig replaces the whole doc, so the import stamps have to be
    // carried through or every settings save silently erases «آخر تحديث» on every phone
    filesMeta: { ...(window.APP_CONFIG.filesMeta || {}) },
  };
  // a changed supplier list is a new file version — the stamp says so on every phone
  const oldSup = JSON.stringify(db.supplierList(window.APP_CONFIG));
  if (JSON.stringify(payload.suppliers) !== oldSup) {
    payload.filesMeta["الموردين"] = { at: Date.now(), rows: payload.suppliers.length, by: identity };
  }
  // The settings doc is the one write that waits for the server on purpose: a false «تم الحفظ»
  // on the PINs could lock the shop out. So the wait has to be visible — a silent dead button
  // is what a slow write (or an exhausted daily quota) used to look like.
  toast("بنحفظ الإعدادات...");
  const slow = setTimeout(() => toast("الحفظ بياخد وقت — سيب الصفحة مفتوحة لحد ما تظهر رسالة الحفظ"), 6000);
  try {
    await db.saveConfig(payload);
  } catch (err) {
    console.error(err);
    toast("الحفظ ما نفعش — جرّب تاني", "bad");
    return;
  } finally {
    clearTimeout(slow);
  }
  Object.assign(window.APP_CONFIG, payload);
  db.logAction(identity, "تغيير الإعدادات", `${payload.users.length} مستخدم · ${payload.branches.length} فرع · ${payload.shipmentTypes.length} نوع`);
  dirty = false;
  serverAhead = false;              // this save IS now the server's copy; the listener follows again
  $("cfg-dirty").textContent = "";
  $("cfg-dirty").classList.remove("warn");
  $("cfg-savebar").hidden = !EDITING.includes(screen);   // a clean menu carries no save bar
  renderAll();
  toast("تم حفظ الإعدادات — الموبايلات هتشوفها مع أول فتح");
};

addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });


function renderBulk() {
  const chips = (id, opts, active, attr) => {
    $(id).innerHTML = opts.map(o =>
      `<button type="button" data-${attr}="${escAttr(o)}" aria-pressed="${o === active}">${esc(o)}</button>`).join("");
  };
  $("bulk-kind").innerHTML = Object.entries(KIND_LABEL).map(([k, label]) =>
    `<button type="button" data-bulkkind="${k}" aria-pressed="${k === bulkKind}">${esc(label)}</button>`).join("");
  chips("bulk-branch", [ALL, ...cfg.branches.map(b => b.name)], bulkBranch, "bulkbranch");
  chips("bulk-type", [ALL, ...cfg.shipmentTypes], bulkType, "bulktype");
  $("bulk-type-row").hidden = bulkKind !== "shipments";  // a stocktake has no type
  // a count of 0 before the list arrives reads as "nothing to delete" — say what is happening
  $("btn-bulk-delete").textContent = shipmentsLoaded
    ? `حذف المطابق (${matching().length})`
    : "بنعد...";
}

// the day a row was recorded, as YYYY-MM-DD — the same shape the date inputs hand back, so the
// range check is a plain string compare
const dayOf = (ms) => new Date(ms).toLocaleDateString("en-CA");

function matching() {
  const from = $("bulk-from").value;
  const to = $("bulk-to").value;
  const rows = bulkKind === "counts" ? counts : shipments;
  return rows.filter((s) => {
    const day = dayOf(s.createdAt);
    return (bulkBranch === ALL || s.branch === bulkBranch)
      && (bulkKind === "counts" || bulkType === ALL || s.type === bulkType)
      && (!from || day >= from)
      && (!to || day <= to);
  });
}

$("bulk-kind").onclick = (e) => {
  const btn = e.target.closest("button[data-bulkkind]");
  if (!btn) return;
  bulkKind = btn.dataset.bulkkind;
  renderBulk();
};

$("bulk-from").onchange = renderBulk;
$("bulk-to").onchange = renderBulk;

$("bulk-branch").onclick = (e) => {
  const btn = e.target.closest("button[data-bulkbranch]");
  if (!btn) return;
  bulkBranch = btn.dataset.bulkbranch;
  renderBulk();
};

$("bulk-type").onclick = (e) => {
  const btn = e.target.closest("button[data-bulktype]");
  if (!btn) return;
  bulkType = btn.dataset.bulktype;
  renderBulk();
};

// what the user picked, in words, for the confirm box and the audit row
function bulkScope() {
  const from = $("bulk-from").value;
  const to = $("bulk-to").value;
  const when = from && to ? (from === to ? `يوم ${from}` : `من ${from} لـ ${to}`)
    : (from ? `من ${from}` : (to ? `لحد ${to}` : "كل الأيام"));
  return [KIND_LABEL[bulkKind], bulkBranch, ...(bulkKind === "shipments" ? [bulkType] : []), when].join(" · ");
}

$("btn-bulk-delete").onclick = async () => {
  if (!shipmentsLoaded) { toast("استنى لحد ما البيانات تحمّل"); return; }
  const hit = matching();
  const noun = bulkKind === "counts" ? "جرد" : "شحنة";
  if (!hit.length) { toast("مفيش حاجة مطابقة"); return; }
  const scope = bulkScope();
  if (!confirm(`حذف ${hit.length} ${noun} (${scope})؟ مش هينفع ترجّعها.`)) return;
  try {
    await db.deleteMany(bulkKind, hit.map(s => s._id));
  } catch (err) {
    console.error(err);
    toast("الحذف ما نفعش — جرّب تاني", "bad");
    return;
  }
  db.logAction(identity, "حذف بالجملة", `${hit.length} ${noun} · ${scope}`);
  if (bulkKind === "counts") counts = await db.listCounts().catch(() => []);
  else shipments = await db.listShipments().catch(() => []);
  renderBulk();
  toast(`تم حذف ${hit.length} ${noun}`);
};

$("btn-wipe-products").onclick = async () => {
  toast("بنعد الأصناف...");
  const rows = await db.listAllProducts().catch(() => []);
  if (!rows.length) { toast("ملف الأصناف فاضي أصلاً"); return; }
  if (!confirm(`مسح ${rows.length} صنف من ملف الأصناف؟ مفيش رجوع، ولازم تستورد الملف تاني بعد كده.`)) return;
  try {
    await db.deleteMany("products", rows.map(p => p.barcode));
  } catch (err) {
    console.error(err);
    toast("المسح ما نفعش — جرّب تاني", "bad");
    return;
  }
  db.logAction(identity,"مسح ملف الأصناف", `${rows.length} صنف`);
  toast(`تم مسح ${rows.length} صنف`);
};


/* The audit trail grows for ever, so it is read a page at a time — «عرض المزيد» asks the server
   for a bigger slice of the same descending query. A cap that silently hides the rest is what a
   trail must never do: the button says how many are on screen, and it keeps going. */
const LOG_PAGE = 100;
let logLimit = LOG_PAGE;

/* A one-line explanation under the rows whose NAME does not say enough — and only those. «حذف
   شحنة» explains itself; «تعديل صلاحيات» does not (in this app it is expiry dates, not user
   permissions — the same Arabic word), and «تحميل شحنة» reads like a download when it is the
   receipt that somebody took the shipment into the shop's own system. Anything not listed here
   gets no note on purpose: a line under every row is a wall, and the wall is what stops being read. */
const ACTION_NOTE = {
  "تحميل شحنة": "المدير نزّل ملف الشحنة — يعني اتاخدت على نظام المحل، والشحنة بتختفي من شاشة الموظف",
  "إعادة تحميل شحنة": "شحنة كان حد تاني حمّلها قبل كده واتحمّلت تاني",
  "تم الاستيراد في النظام": "نظام المحل فعلاً قرأ الملف — دي آخر مرحلة للشحنة",
  "تعديل صلاحيات": "تواريخ صلاحية أصناف على الرف — مالهاش أي علاقة بصلاحيات المستخدمين",
  "حذف صلاحية": "صنف اتشال من قايمة تواريخ الصلاحية",
  "استيراد أصناف": "ملف الأصناف — المرجع الأساسي للأسماء والوحدات والأسعار. بيتحفظ صنف صنف",
  "استيراد كميات الجرد": "ملف جرد فرع — بيحدّث الكمية اللي النظام شايفها في الفرع ده وبس",
  "تغيير الإعدادات": "أي حفظ من صفحة النظام: المستخدمين والفروع والموردين والأرقام السرية",
  "حذف بالجملة": "مسح مجموعة شحنات أو جرد مرة واحدة بالفرع والتاريخ",
  "مسح ملف الأصناف": "مسح الكتالوج كله من السيرفر — أخطر عملية في البرنامج",
  "رفع قالب طباعة": "ملف قالب من برنامج الطباعة اتحط في مجلد القوالب",
  "حذف قالب طباعة": "قالب اتشال من مجلد القوالب",
};

async function loadLogs() {
  $("logs-count").textContent = "بنجيب آخر العمليات...";
  $("logs-list").innerHTML = "";
  const rows = await db.listLogs(logLimit).catch(() => []);
  $("logs-count").textContent = rows.length ? `آخر ${rows.length} عملية` : "";
  $("logs-list").innerHTML = rows.map(r => `<li>
      <div class="card-main">
        <div class="card-title">${esc(r.action)}</div>
        <div class="meta">${esc(r.target)}</div>
        <div class="meta">${esc(r.who)} · ${esc(fmtWhen(r.at))}</div>
        ${ACTION_NOTE[r.action] ? `<div class="note">${esc(ACTION_NOTE[r.action])}</div>` : ""}
      </div>
    </li>`).join("")
    // a full page means there is probably more behind it; a short one is the end of the trail
    + (rows.length >= logLimit
      ? `<li class="more"><button type="button" class="ghost" id="btn-more-logs">عرض المزيد — ${rows.length} عملية</button></li>`
      : "")
    || `<li class="empty">مفيش عمليات مسجّلة لحد الآن</li>`;
}

$("logs-list").onclick = (e) => {
  if (!e.target.closest("#btn-more-logs")) return;
  logLimit += LOG_PAGE;
  loadLogs().catch(console.error);
};

$("btn-logs").onclick = () => {
  history.pushState({ screen: "screen-logs" }, "");
  render("screen-logs");
  logLimit = LOG_PAGE;              // every visit starts on the first page, not where it was left
  loadLogs();
};


const ENTER = { "pin-input": "btn-pin" };

addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const btn = ENTER[e.target.id];
  if (!btn) return;
  e.preventDefault();
  e.target.blur();
  $(btn).click();
});


function updateSync() {
  $("sync-state").textContent = navigator.onLine ? "متصل" : "مستني الاتصال";
  $("sync-state").classList.toggle("off", !navigator.onLine);
}
addEventListener("online", updateSync);
addEventListener("offline", updateSync);
updateSync();

history.replaceState({ screen: "screen-pin" }, "");
render("screen-pin");

/* Whether the boot read of config/app actually ANSWERED. A swallowed failure here is how the
   shop's supplier list got wiped (found 2026-08-01, quota exhaustion): the page showed the code
   defaults as if they were the saved settings, and «حفظ» wrote those defaults over the real doc.
   A page that could not read must not be allowed to write. */
let cfgFromServer = false;

// the working copy the screens edit, rebuilt from whatever APP_CONFIG holds right now
const workingCopy = () => ({
  managerPin: window.APP_CONFIG.managerPin,
  adminPin: window.APP_CONFIG.adminPin,
  branches: window.APP_CONFIG.branches.map(b => ({ ...b })),
  shipmentTypes: [...window.APP_CONFIG.shipmentTypes],
  suppliers: db.supplierList(window.APP_CONFIG),      // older configs held plain names
  label: lbl.labelCfg(window.APP_CONFIG),
  users: (window.APP_CONFIG.users || []).map(u => ({ ...u, branches: auth.branchesOf(u), perms: (u.perms || []).slice() })),
});

// a failed write or listener must say so, same as the other two pages
addEventListener("db-error", () => toast("مشكلة في مزامنة البيانات — اتأكد من الاتصال والإعدادات", "bad"));

cfgReady = (async () => {
  await db.initDb().catch(console.error);
  const stored = await db.getConfig().then((c) => { cfgFromServer = true; return c; })
    .catch((e) => { console.error(e); return null; });
  if (!stored) {
    toast("مقدرناش نقرا الإعدادات من السيرفر — الحفظ متقفل عشان الإعدادات المحفوظة ما تتمسحش. اقفل الصفحة وجرّب تاني بعد شوية.", "bad");
  }
  $("btn-save-config").disabled = !cfgFromServer;
  Object.assign(window.APP_CONFIG, stored || {});
  applyBrand(window.APP_CONFIG);
  cfg = workingCopy();
  /* The admin is the WRITER, so a live update must never overwrite what somebody is typing —
     that rule stays. But a page nobody has touched (dirty === false) showing yesterday's users
     is how «المزامنة باظت» read on 2026-08-02: two open admin screens each held a stale copy.
     Clean page → take the server's word and repaint. Dirty page → the human's edits win until
     they save or leave. */
  db.watchConfig((server) => {
    Object.assign(window.APP_CONFIG, server);
    applyBrand(window.APP_CONFIG);
    if (dirty) { serverAhead = true; paintDirty(); return; }
    cfg = workingCopy();
    renderAll();
  }).catch(console.error);
  const s = auth.session();
  if (!s) return;
  if (s.perms.includes("adm")) { await enterAdmin(); return; }   // already signed in elsewhere
  const page = auth.landingPage(s.perms);
  if (page && page !== "admin.html") auth.goTo(page);
})();

keepFresh(toast);
