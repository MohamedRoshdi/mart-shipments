import * as db from "./db.js";
import * as auth from "./auth.js";
import * as ex from "./expiry.js";
import * as lbl from "./label.js";

import { versionLine } from "./version.js";
import { listFiles, saveText } from "./files.js";
import { applyBrand } from "./brand.js";
import { keepFresh } from "./fresh.js";

const $ = (id) => document.getElementById(id);
const esc = (t) => { const d = document.createElement("div"); d.textContent = t; return d.innerHTML; };
const escAttr = (t) => esc(t).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const branches = () => window.APP_CONFIG.branches;
const myName = () => localStorage.getItem("employeeName");
const myBranch = () => localStorage.getItem("employeeBranch") || branches()[0].name;
const fmtDate = (ts) => new Date(ts).toLocaleDateString("ar-EG");

/* kind is optional and the default is the charcoal box every call already gets, so no existing
   toast had to be touched: only the places that know they are reporting a failure say so. */
function toast(msg, kind) {
  const t = $("toast");
  t.textContent = msg;
  t.className = kind ? `show t-${kind}` : "show";
  setTimeout(() => { t.className = ""; }, 2200);
}

$("version-line").textContent = versionLine();

const TITLES = {
  "screen-login": "العائلة مارت",
  "screen-home": "شغل النهارده",   // the home shows today only, and the title says so
  "screen-new": "شحنة جديدة",
  "screen-expiry": "الصلاحيات",
  "screen-month": "الصلاحيات",
  "screen-label": "ليبل الرف",
  "screen-jobs": "مهام الطباعة",
  "screen-job": "مهام الطباعة",
  "screen-cam": "إعدادات الكاميرا",
};

// the one scanner block lives inside whichever of these screens is open
const SLOTS = { "screen-new": "slot-new", "screen-expiry": "slot-expiry", "screen-label": "slot-label" };

const types = () => window.APP_CONFIG.shipmentTypes;

const state = {
  items: [], currentBarcode: null, currentName: "", currentSys: null, editingId: null,
  mine: [], myCounts: [],
  // "ship" = a delivery being received, "count" = a stocktake (جرد) against the system quantity,
  // "expiry" = recording an expiry date (الصلاحيات), one saved row per product and date,
  // "label" = printing a shelf label, which saves nothing at all
  mode: "ship",
  expRows: [], monthKey: "", expEdits: new Map(),
  branch: myBranch(), type: types()[0],
};

const counting = () => state.mode === "count";
const expiring = () => state.mode === "expiry";
const labeling = () => state.mode === "label";

/* ---------- navigation: one screen at a time, phone back button works ---------- */

function render(id) {
  document.querySelectorAll("main > section").forEach(s => s.hidden = true);
  $(id).hidden = false;
  const slot = SLOTS[id];
  if (slot) $(slot).append($("scan-block"));       // move, never copy: one camera, one set of controls
  $("scan-block").hidden = !slot;
  /* The home screen is a MENU, and a menu should use the screen it is on: on a tablet or a
     laptop its cards run in columns instead of stretching into banners. Every other employee
     screen keeps the phone column — the scanner, the item sheet and the camera preview are
     designed around it and get worse wide, which is why this is per screen, not per page. */
  document.body.classList.toggle("wide", id === "screen-home");
  $("screen-title").textContent = (id === "screen-new" && counting()) ? "جرد" : (TITLES[id] || "شحنات المحل");
  $("btn-back").hidden = id === "screen-home" || id === "screen-login";
  $("btn-cam").hidden = !(id === "screen-home" || id === "screen-new" || id === "screen-expiry" || id === "screen-label");
  $("who").hidden = !myName() || id !== "screen-home";
  if (myName()) $("who").textContent = `${myName()} · ${myBranch()}`;
  if (id === "screen-home") renderHomeLinks();
  hideSheet();
  scrollTo(0, 0);
}

function navTo(id) {
  if (!SLOTS[id]) stopScan();            // leaving a scanner screen must release the camera
  history.pushState({ screen: id }, "");
  render(id);
}

/* شاشة الموظف بتعرض النهارده وبس (the owner, 2026-08-01): yesterday's work leaves the screen at
   midnight and a shipment leaves it the moment the manager takes it in («تم تحميلها»). Display
   only — nothing is deleted, and the manager page still shows everything. The read is bounded to
   the current month for the same reason the manager's is: the old unbounded read grew forever. */
const dayKey = (ts) => new Date(ts).toLocaleDateString("en-CA");
const isToday = (ts) => dayKey(ts) === dayKey(Date.now());
/* The query is the DAY, not the month (2026-08-02). The screen only ever showed today, but it was
   READING a whole month to do it — on every phone, on every page load, against a 50,000-read day.
   `dayKey` is already «YYYY-MM-DD», which `db.monthRange` reads as a single day. */
const todayKey = () => dayKey(Date.now());

/* Every list on this page that another device can change is LIVE (the owner, 2026-08-02: he edits
   on the laptop and the phone keeps showing the old thing). `feed` subscribes ONCE per page life
   and hands each delivery straight to the painter — the first one resolves the await, so the
   callers read exactly as they did when this was a one-shot list. Attaching costs the same reads
   the list already cost; after that only a real change costs anything. Repainting a screen nobody
   is looking at is harmless (innerHTML on a hidden section) and is what keeps this three lines. */
const feeds = {};
const feed = (key, start, paint) => (feeds[key] ||= new Promise((resolve) => {
  start((rows) => { paint(rows); resolve(); })
    .catch((e) => { console.error(e); paint([]); resolve(); });
}));

async function goHome() {
  await stopScan();
  if (!auth.session()) {          // expired mid-use: back to the door, not a home with no buttons
    history.replaceState({ screen: "screen-login" }, "");
    render("screen-login");
    return;
  }
  state.editingId = null;
  state.mode = "ship";
  // from here on this device reports what it spends, so «حالة النظام» can name it. Once per page
  // life, and it sits after the session check because a signed-out device has nothing to report.
  db.reportUsage({ device: auth.deviceId(), who: myName(), branch: myBranch() });
  render("screen-home");
  await feed("ships", cb => db.watchShipments(todayKey(), cb), paintMyShipments);
  paintMyShipments();             // the branch/name filter may have moved since the last delivery
  if (canDo("count")) { await feed("counts", cb => db.watchCounts(todayKey(), cb), paintMyCounts); paintMyCounts(); }
  openDeepLabel();
}

let rawShips = [], rawCounts = [];

function paintMyShipments(rows) {
  if (rows) rawShips = rows;
  state.mine = rawShips.filter(s => s.createdBy === myName() && isToday(s.createdAt) && !s.loadedAt);
  $("my-shipments").innerHTML = state.mine.map((s, i) => `<li>
      <div class="card-main">
        <div class="card-title">${esc(s.name)}</div>
        <div class="meta">${esc(s.type || "")} · ${esc(s.branch || "")} · ${fmtDate(s.createdAt)} · ${s.items.length} صنف</div>
      </div>
      ${canDo("edit") ? `<button class="ghost" data-edit="${i}">تعديل</button>` : ""}
    </li>`).join("") || `<li class="empty">مفيش شحنات النهارده — ابدأ بـ «شحنة جديدة»</li>`;
}

// the difference a stocktake found: counted minus what the system says
const countDiff = (c) => c.items.reduce((n, i) => n + (Number(i.qty) || 0) - (Number(i.sys) || 0), 0);
// words, not "-3": a leading minus next to Arabic text renders on the wrong side (RTL bidi)
const diffWord = (n) => (n === 0 ? "مظبوط" : (n > 0 ? `زيادة ${n}` : `ناقص ${-n}`));

function paintMyCounts(rows) {
  if (rows) rawCounts = rows;
  state.myCounts = rawCounts.filter(c => c.createdBy === myName() && isToday(c.createdAt));
  $("my-counts").innerHTML = state.myCounts.map((c, i) => `<li>
      <div class="card-main">
        <div class="card-title">${esc(c.name)}</div>
        <div class="meta">${esc(c.branch || "")} · ${fmtDate(c.createdAt)} · ${c.items.length} صنف · الفرق ${esc(diffWord(countDiff(c)))}</div>
      </div>
      ${canDo("edit") ? `<button class="ghost" data-editcount="${i}">تعديل</button>` : ""}
    </li>`).join("") || `<li class="empty">مفيش جرد النهارده — ابدأ بـ «جرد»</li>`;
}

// signing in is mandatory now, so no session means an EXPIRED one — deny, never grant.
// (the old `!session || can` was the pre-users fallback, and it handed a dead session everything)
const canDo = (perm) => auth.can(perm);

function renderHomeLinks() {
  const s = auth.session();
  $("home-links").hidden = !s;
  $("link-manager").hidden = !(s && s.perms.includes("mgr"));
  $("link-admin").hidden = !(s && s.perms.includes("adm"));
  $("link-manager").href = auth.withQuery("manager.html");   // keep ?test=1 across pages
  $("link-admin").href = auth.withQuery("admin.html");
  $("btn-logout").hidden = !s;
  $("btn-new").hidden = !canDo("create");
  $("btn-count").hidden = !canDo("count");
  $("btn-expiry").hidden = !canDo("expiry");
  $("btn-label").hidden = !canDo("label");
  $("btn-jobs").hidden = !canDo("label");
  $("counts-block").hidden = !canDo("count");
}

$("btn-logout").onclick = () => {
  auth.endSession();
  localStorage.removeItem("employeeName");
  history.replaceState({ screen: "screen-login" }, "");
  $("login-pin").value = "";
  render("screen-login");
};

addEventListener("popstate", (ev) => {
  const id = (ev.state && ev.state.screen) || "screen-home";
  // a history entry can name a screen an older version had (screen-name died in 1.0.74) — home, not a crash
  if (id === "screen-home" || !document.getElementById(id)) goHome(); else render(id);
});

$("btn-back").onclick = () => history.back();

/* ---------- signing in ---------- */

const shortBranch = (b) => b.replace(/^فرع\s+/, ""); // chips stay one line; stored value keeps "فرع"

const CODE_ADMIN_PIN = window.APP_CONFIG.adminPin;   // captured before the stored config wins

function enterEmployee(name, branch) {
  localStorage.setItem("employeeName", name);
  if (branch) localStorage.setItem("employeeBranch", branch);
  state.branch = myBranch();
  history.replaceState({ screen: "screen-home" }, "");
  goHome();
}

// one PIN box for everybody: it sends each user to the page their permissions allow
$("btn-login").onclick = async () => {
  await cfgReady;
  const pin = $("login-pin").value.trim();
  const cfg = window.APP_CONFIG;
  const who = auth.authenticate(pin, cfg, CODE_ADMIN_PIN);
  if (!who) { toast("الرقم السري غلط"); return; }
  if (who.blocked) { toast("الرقم ده مربوط بموبايل تاني — كلّم الأدمن يفكّه الأول"); return; }
  if (!who.perms.length) { toast("المستخدم ده مالوش صلاحيات — كلّم الأدمن"); return; }
  if (who.claim) db.claimDevice(pin, who.claim);
  auth.startSession(who.name, who.branches, who.perms, who.user);
  $("login-pin").value = "";
  if (who.perms.includes("emp")) {
    // more than one branch: keep the one this phone used last if it is still allowed
    const mine = allowedBranches();
    enterEmployee(who.name, mine.includes(myBranch()) ? myBranch() : mine[0]);
    return;
  }
  const page = auth.landingPage(who.perms);
  if (!page) { toast("المستخدم ده مالوش شاشة يفتحها — كلّم الأدمن"); return; }
  auth.goTo(page);                           // manager or admin, per their permissions
};

/* ---------- building a shipment ---------- */

function saveDraft() {
  if (state.editingId || counting()) return; // editing a saved shipment, or a stocktake, must not overwrite the unsaved draft
  localStorage.setItem("draft", JSON.stringify({ name: $("shipment-name").value, items: state.items, type: state.type }));
}

// the branches this user may stamp a shipment with; no session = the shop's whole list
function allowedBranches() {
  const s = auth.session();
  const all = branches().map(b => b.name);
  if (!s || !s.branches.length) return all;
  const mine = s.branches.filter(b => all.includes(b));
  return mine.length ? mine : all;
}

// one branch → a line of text like before; more than one → the employee picks per shipment,
// and the الصلاحيات screen carries the same choice so a row lands in the right branch
function renderNewBranch() {
  const mine = allowedBranches();
  const multi = mine.length > 1 && !!auth.session();
  const html = mine.map(b =>
    `<button type="button" data-newbranch="${escAttr(b)}" aria-pressed="${b === state.branch}">${esc(shortBranch(b))}</button>`).join("");
  for (const [line, picker] of [["new-branch", "new-branch-picker"], ["exp-branch", "exp-branch-picker"]]) {
    $(line).hidden = multi;
    $(line).textContent = state.branch;
    $(picker).hidden = !multi;
    $(picker).innerHTML = html;
  }
}

for (const id of ["new-branch-picker", "exp-branch-picker"]) {
  $(id).onclick = async (e) => {
    const btn = e.target.closest("button[data-newbranch]");
    if (!btn) return;
    state.branch = btn.dataset.newbranch;
    localStorage.setItem("employeeBranch", state.branch);   // next shipment starts on the same branch
    renderNewBranch();
    if (!$("screen-expiry").hidden) await loadExpiry();      // the list is per branch
  };
}

function renderTypePicker() {
  renderNewBranch();
  $("type-picker").innerHTML = types().map(t =>
    `<button type="button" data-type="${escAttr(t)}" aria-pressed="${t === state.type}">${esc(t)}</button>`).join("");
}

$("type-picker").onclick = (e) => {
  const btn = e.target.closest("button[data-type]");
  if (!btn) return;
  state.type = btn.dataset.type;
  renderTypePicker();
  saveDraft();
};

// one screen serves both jobs; the mode decides the labels and what a row shows
function paintMode() {
  const c = counting();
  $("new-type-row").hidden = c;
  $("new-name-head").textContent = c ? "اسم الجرد" : "اسم المورد";
  $("shipment-name").placeholder = c ? "مثلاً: جرد رف اللبن" : "اسم المورد";
  $("supplier-results").hidden = true;         // suggestions open on focus, not on arrival
  $("btn-save-shipment").textContent = c
    ? "حفظ الجرد"
    : (state.editingId ? "حفظ التعديلات" : "حفظ الشحنة");
}

$("btn-new").onclick = () => {
  const draft = JSON.parse(localStorage.getItem("draft") || "null");
  state.mode = "ship";
  state.editingId = null;
  state.items = (draft && draft.items) || [];
  state.currentBarcode = null;
  state.type = (draft && draft.type) || types()[0];
  renderTypePicker();
  $("shipment-name").value = (draft && draft.name) || "";
  clearFind();
  paintMode();
  renderItems();
  navTo("screen-new");
  if (state.items.length) toast("رجّعنالك الشحنة اللي كانت مفتوحة");
};

$("btn-count").onclick = () => {
  state.mode = "count";
  state.editingId = null;
  state.items = [];
  state.currentBarcode = null;
  renderNewBranch();
  $("shipment-name").value = "";
  clearFind();
  paintMode();
  renderItems();
  navTo("screen-new");
};

$("my-shipments").onclick = (e) => {
  const btn = e.target.closest("button[data-edit]");
  if (btn) openShipment(state.mine[+btn.dataset.edit]);
};

$("my-counts").onclick = (e) => {
  const btn = e.target.closest("button[data-editcount]");
  if (btn) openCount(state.myCounts[+btn.dataset.editcount]);
};

function openShipment(s) {
  state.mode = "ship";
  state.editingId = s._id;
  state.items = s.items.map(i => ({ ...i }));
  state.currentBarcode = null;
  state.type = s.type || types()[0];
  renderTypePicker();
  $("shipment-name").value = s.name;
  clearFind();
  paintMode();
  renderItems();
  navTo("screen-new");
}

function openCount(c) {
  state.mode = "count";
  state.editingId = c._id;
  state.items = c.items.map(i => ({ ...i }));
  state.currentBarcode = null;
  renderNewBranch();
  $("shipment-name").value = c.name;
  clearFind();
  paintMode();
  renderItems();
  navTo("screen-new");
}

/* --- the shipment IS the supplier: the admin's list is offered as you type, and a name that is
   not on it is still accepted (a new supplier must not block a delivery) --- */

const suppliers = () => db.supplierList(window.APP_CONFIG);

function renderSuppliers() {
  const box = $("supplier-results");
  const q = db.norm($("shipment-name").value);
  // a count is a shelf, not a delivery — the list belongs to shipments only
  if (counting() || !suppliers().length) { box.hidden = true; return; }
  const all = suppliers();
  // the code counts as much as the name: the storekeeper knows «1042» before he knows the spelling
  const starts = (s) => db.norm(s.name).startsWith(q) || s.code.startsWith(q);
  const has = (s) => db.norm(s.name).includes(q) || s.code.includes(q);
  const hits = q ? [...all.filter(starts), ...all.filter(s => !starts(s) && has(s))] : all;
  // an exact hit means the employee already picked it; nothing left to suggest
  if (hits.length === 1 && db.norm(hits[0].name) === q) { box.hidden = true; return; }
  box.hidden = false;
  // the whole row is the target: a thumb on a phone should not have to find a small button
  box.innerHTML = hits.slice(0, 20).map(s => `<li>
      <button class="suggest" data-supplier="${escAttr(s.name)}">${esc(s.name)}${s.code ? `<span class="code">${esc(s.code)}</span>` : ""}</button>
    </li>`).join("") || `<li class="empty">مورد جديد — هيتسجّل بالاسم اللي كتبته</li>`;
}

$("shipment-name").oninput = () => { saveDraft(); renderSuppliers(); };
$("shipment-name").onfocus = renderSuppliers;

$("supplier-results").onclick = (e) => {
  const btn = e.target.closest("button[data-supplier]");
  if (!btn) return;
  $("shipment-name").value = btn.dataset.supplier;
  $("supplier-results").hidden = true;
  saveDraft();
};

$("btn-lookup").onclick = () => {
  const code = $("barcode-input").value.trim();
  if (code) onBarcode(code).catch(() => toast("حصلت مشكلة — جرّب تاني"));
};

// the refusal wording names the list the employee is actually filling
const WARN = {
  ship: "الباركود ده مش موجود في ملف الأصناف، والصنف مش هيتسجّل في الشحنة.",
  count: "الباركود ده مش موجود في ملف الأصناف، والصنف مش هيتسجّل في الجرد.",
  expiry: "الباركود ده مش موجود في ملف الأصناف، والصنف مش هيتسجّل في الصلاحيات.",
  label: "الباركود ده مش موجود في ملف الأصناف، ومفيش اسم نطبعه على الليبل.",
};

// «هذا الصنف كود فرعي، برجاء جرد الكود الأساسي» (the owner, 2026-08-01)
const SUB_CODE_MSG = "الصنف ده كود فرعي مش موجود في جرد الفرع — اجرد الكود الأساسي بتاعه.";

async function onBarcode(code) {
  const p = await db.resolveProduct(code);
  // the catalog's own spelling of the code is what the item carries — never the typed one
  state.currentBarcode = (p && p.barcode) || code;
  state.currentName = (p && p.name) || "";
  // each branch has its own sheet, so the number depends on the branch this count is for
  state.currentSys = db.stockFor(p, state.branch);
  state.currentUnit = (p && p.unit) || "";     // information only: it is never counted or summed
  const known = state.currentName !== "";
  /* A code the catalog knows but the branch's own جرد file never listed is a sub-code: it must
     be counted under its main code, so the sheet says that and refuses the row. Judged only in
     a stocktake, and only on the branch KEY itself (stockFor falls back to the old shop-wide
     qty, which would hide exactly the absence this is about) — and only after that branch's
     sheet was actually imported, or every product would look like a sub-code. */
  const jardStamp = !!((window.APP_CONFIG.filesMeta || {})[`جرد ${state.branch}`]);
  state.subCode = counting() && known && jardStamp
    && !(p && p.stock && Object.prototype.hasOwnProperty.call(p.stock, state.branch));
  // a label needs a name and nothing else: no quantity, no sheet, straight to the preview
  if (labeling() && known) { clearFind(); showLabel(state.currentBarcode, state.currentName, p && p.price); return; }
  $("item-barcode").textContent = state.currentBarcode;   // the code as the catalog spells it
  $("item-name").textContent = known ? state.currentName : "صنف غير مسجّل في ملف الأصناف";
  $("item-name").classList.toggle("unknown", !known);
  $("item-unit").hidden = !(known && state.currentUnit);
  $("item-unit-name").textContent = state.currentUnit;
  // معامل التحويل is shown beside the unit and nothing else — no quantity is ever multiplied by it
  const factor = p && Number.isFinite(p.factor) && p.factor > 1 ? p.factor : null;
  $("item-factor").hidden = !(known && factor);
  $("item-factor-val").textContent = factor || "";
  $("item-warn").hidden = known && !state.subCode; // full explanation instead of a silent add
  $("item-warn-line").textContent = state.subCode ? SUB_CODE_MSG : WARN[state.mode];
  // the whole point of a stocktake: the employee sees what the system claims before he types
  $("item-stock").hidden = !(known && counting() && !state.subCode);
  $("item-stock-qty").textContent = state.currentSys === null ? "غير مسجّلة" : state.currentSys;
  // .code is dir=ltr for numbers; Arabic words inside it come out spaced wrong
  $("item-stock-qty").classList.toggle("code", state.currentSys !== null);
  $("qty-hint").hidden = !(known && !state.subCode && (counting() || expiring()));
  $("qty-hint").textContent = expiring()
    ? "اكتب عدد القطع اللي بتنتهي في التاريخ ده."
    : "اكتب الكمية اللي لقيتها فعلاً على الرف.";
  paintExpiryFields(known);
  $("qty-row").hidden = !known || state.subCode; // nothing to count if the item cannot be added
  $("btn-add-item").hidden = !known || state.subCode;   // only catalog items can enter a shipment
  $("btn-add-item").disabled = !known || state.subCode;
  $("btn-add-item").textContent = counting() ? "تسجيل الكمية" : (expiring() ? "تسجيل الصلاحية" : "إضافة الصنف");
  $("item-qty").value = 1;
  clearFind();                                   // the item is picked; the results list is done
  showSheet(true);
}

$("btn-copy-barcode").onclick = async () => {
  try {
    await navigator.clipboard.writeText(state.currentBarcode || "");
    toast("تم نسخ الباركود");
  } catch (e) {
    console.error(e);
    toast("النسخ ما نفعش — اكتب الباركود بإيدك");
  }
};

function showSheet(open) {
  $("item-form").hidden = !open;
  $("scrim").hidden = !open;
  document.body.classList.toggle("sheet-open", open);
}

function hideSheet() {
  showSheet(false);
  state.currentBarcode = null;
  state.currentName = "";
  state.currentSys = null;
  state.subCode = false;
}

$("btn-cancel-item").onclick = hideSheet;
$("scrim").onclick = hideSheet;
$("qty-plus").onclick = () => { $("item-qty").value = +$("item-qty").value + 1; };
$("qty-minus").onclick = () => { $("item-qty").value = Math.max(1, +$("item-qty").value - 1); };

$("btn-add-item").onclick = async () => {
  const name = state.currentName;      // names come from the imported catalog only
  const qty = Math.max(1, parseInt($("item-qty").value, 10) || 1);
  const barcode = state.currentBarcode;
  if (!barcode) return;
  if (!name) { toast("الصنف مش في ملف الأصناف — مش هينفع يتسجّل"); return; }
  if (state.subCode) { toast("الصنف ده كود فرعي — اجرد الكود الأساسي بتاعه"); return; }
  if (expiring()) { await addExpiry(barcode, name, qty); return; }
  const dup = state.items.find(i => i.barcode === barcode);
  // a second scan of the same item means more of it was found, in both modes
  if (dup) dup.qty += qty;
  // sys is left out when the sheet never gave a quantity for this product — 0 would be a lie
  else {
    const item = { barcode, name, qty };
    if (state.currentUnit) item.unit = state.currentUnit;
    if (counting() && state.currentSys !== null) item.sys = state.currentSys;
    state.items.push(item);
  }
  hideSheet();
  $("barcode-input").value = "";
  renderItems();
};

// a stocktake row carries its own verdict: what the system said and how far off the shelf is
function itemNote(i) {
  if (!counting()) return "";
  if (!Number.isFinite(i.sys)) return `<div class="meta">مش مسجّل في النظام</div>`;
  const d = (Number(i.qty) || 0) - i.sys;
  return `<div class="meta">في النظام ${esc(i.sys)} · ${esc(diffWord(d))}</div>`;
}

function renderItems() {
  $("items-list").innerHTML = state.items.map((i, idx) => `<li>
      <div class="card-main">
        <div class="card-title">${esc(i.name || "بدون اسم")}</div>
        <div class="meta"><span class="code">${esc(i.barcode)}</span>${i.unit ? ` · ${esc(i.unit)}` : ""}</div>
        ${itemNote(i)}
      </div>
      <span class="stamp">${esc(i.qty)}</span>
      <button class="del" data-del="${idx}" aria-label="حذف الصنف">×</button>
    </li>`).join("") || `<li class="empty">امسح أول صنف</li>`;
  $("items-count").textContent = state.items.length ? `${state.items.length} صنف` : "";
  $("btn-save-shipment").disabled = state.items.length === 0;
  saveDraft();
}

$("items-list").onclick = (e) => {
  const btn = e.target.closest("button[data-del]");
  if (!btn) return;
  state.items.splice(+btn.dataset.del, 1);
  renderItems();
};

$("btn-save-shipment").onclick = async () => {
  const name = $("shipment-name").value.trim();
  if (!name) { toast(counting() ? "اكتب اسم الجرد الأول" : "اكتب اسم المورد الأول"); return; }
  const editing = state.editingId;
  const perm = counting() ? (editing ? "edit" : "count") : (editing ? "edit" : "create");
  if (!canDo(perm)) { toast("مالكش صلاحية للخطوة دي — كلّم الأدمن"); return; }
  try {
    if (counting() && editing) await db.updateCount(editing, { name, items: state.items });
    else if (counting()) await db.saveCount({ name, createdBy: myName(), branch: state.branch, items: state.items });
    else if (editing) await db.updateShipment(editing, {
      name, items: state.items, type: state.type,
      supplierCode: db.supplierCodeOf(window.APP_CONFIG, name),
    });
    else await db.saveShipment({
      name, createdBy: myName(), branch: state.branch, type: state.type, items: state.items,
      // looked up from the name, never typed: the code follows the supplier list, not the employee
      supplierCode: db.supplierCodeOf(window.APP_CONFIG, name),
    });
  } catch (e) {
    console.error(e);
    toast("الحفظ ما نفعش — حاول تاني", "bad");
    return;
  }
  if (!editing && !counting()) localStorage.removeItem("draft");
  toast(counting() ? "تم حفظ الجرد" : (editing ? "تم حفظ التعديلات" : "تم حفظ الشحنة"));
  history.replaceState({ screen: "screen-home" }, "");
  goHome();
};

/* ---------- الصلاحيات: months exist only while a row carries their date ---------- */

$("btn-expiry").onclick = async () => {
  state.mode = "expiry";
  state.editingId = null;
  state.items = [];
  state.currentBarcode = null;
  renderNewBranch();
  clearFind();
  navTo("screen-expiry");
  await loadExpiry();
};

let rawExp = [];

// live, like the home lists: a date typed on another phone lands here without anyone reloading
async function loadExpiry() {
  await feed("expiry", db.watchExpiry, paintExpiry);
  paintExpiry();                 // the branch may have changed since the last delivery
}

function paintExpiry(rows) {
  if (rows) rawExp = rows;
  // a row with no branch is from before branches were stamped; it stays visible everywhere
  state.expRows = rawExp.filter(e => !e.branch || e.branch === state.branch);
  /* «الموظف يشاهد فقط المنتجات التي أدخلها» (the owner, 2026-08-01) — a real account sees its
     own rows; the manager page sees everything. Legacy PIN flows keep the old shared view. */
  const s = auth.session();
  if (s && s.user) state.expRows = state.expRows.filter(e => e.createdBy === myName());
  renderMonths();
  if (!$("screen-month").hidden) paintMonth();   // the open month may have gained or lost a row
}

function renderMonths() {
  const ms = ex.months(state.expRows);
  $("exp-months").innerHTML = ms.map(m => `<li class="exp exp-${m.status}">
      <div class="card-main">
        <div class="card-title">${esc(m.label)}</div>
        <div class="meta">${m.count} صنف · ${m.qty} قطعة · ${esc(ex.daysWord(m.days))}</div>
      </div>
      <button class="ghost" data-month="${escAttr(m.key)}">فتح</button>
    </li>`).join("") || `<li class="empty">لسه مفيش صلاحيات — امسح أول صنف وحدّد تاريخه</li>`;
  // the months are DERIVED from the rows, so a capped read would be a half-truth — say it, never hide it
  $("exp-months").innerHTML += rawExp.length >= db.EXPIRY_CAP
    ? `<li class="empty">القايمة واقفة عند ${db.EXPIRY_CAP} صنف — امسح الشهور اللي عدّت عشان تشوف الباقي</li>` : "";
}

$("exp-months").onclick = (e) => {
  const btn = e.target.closest("button[data-month]");
  if (btn) openMonth(btn.dataset.month);
};

/* The two fields only الصلاحيات asks for. Both stay as they were between scans — a shelf sweep
   is usually one batch from one delivery — and the supplier is optional, never a constraint. */
function paintExpiryFields(known) {
  const on = known && expiring();
  $("item-date-row").hidden = !on;
  $("item-supplier-row").hidden = !on;
  if (on && !$("supplier-dl").children.length) {
    $("supplier-dl").innerHTML = db.supplierList(window.APP_CONFIG)
      .map(s => `<option value="${escAttr(s.name)}">`).join("");
  }
}

async function addExpiry(barcode, name, qty) {
  const d = ex.fromIso($("item-date").value);
  if (!d) {
    // an out-of-range year is the common slip: the date field puts the caret in the year segment
    toast($("item-date").value ? "التاريخ مش مظبوط — السنة لازم بين ٢٠٠٠ و٢١٠٠" : "حدّد تاريخ انتهاء الصلاحية الأول");
    return;
  }
  const supplier = $("item-supplier").value.trim().slice(0, 50);
  // the same product with the same date is more of the same batch, not a second row
  const dup = state.expRows.find(e => e.barcode === barcode
    && e.year === d.year && e.month === d.month && e.day === d.day);
  try {
    if (dup) await db.updateExpiry(dup._id, { ...dup, qty: (Number(dup.qty) || 0) + qty,
      supplier: supplier || dup.supplier || "" });
    else await db.saveExpiry({ barcode, name, qty, ...d, branch: state.branch, createdBy: myName(),
      ...(supplier ? { supplier } : {}) });
  } catch (err) {
    console.error(err);
    toast("الحفظ ما نفعش — حاول تاني", "bad");
    return;
  }
  hideSheet();
  $("barcode-input").value = "";
  toast(`تم تسجيل ${name} في ${ex.monthLabel(d.year, d.month)}`);   // toast writes textContent
  await loadExpiry();
}

/* --- one month: search, edit the quantity, move the date, delete --- */

const monthRows = () => state.expRows.filter(e => ex.monthKey(e) === state.monthKey);

function openMonth(key) {
  state.monthKey = key;
  state.expEdits = new Map();
  $("month-search").value = "";
  navTo("screen-month");
  paintMonth();
}

function paintMonth() {
  // `history.back()` only takes effect on the next tick, so a second paint in the same tick would
  // still see the month screen and go back twice. Clearing the key is what makes leaving happen once.
  if ($("screen-month").hidden || !state.monthKey) return;
  const m = ex.months(monthRows())[0];
  if (!m) { state.monthKey = null; history.back(); return; }   // last row gone → so is the month
  $("month-head").textContent = m.label;
  $("screen-title").textContent = m.label;
  $("month-count").textContent = `${m.count} صنف · ${m.qty} قطعة · ${ex.STATUS_LABEL[m.status]}`;
  renderMonthItems();
}

function renderMonthItems() {
  const m = ex.months(monthRows())[0];
  if (!m) return;
  const rows = ex.search(m.items, $("month-search").value);
  $("month-items").innerHTML = rows.map(e => {
    const days = ex.daysLeft(e);
    return `<li class="exp exp-${ex.statusOf(days)}">
      <div class="card-main">
        <div class="card-title">${esc(e.name || "بدون اسم")}</div>
        <div class="code">${esc(e.barcode)}</div>
        <!-- who recorded it: two employees on one shelf need to know whose row this is -->
        <div class="meta">${esc(ex.daysWord(days))}${e.supplier ? ` · ${esc(e.supplier)}` : ""}${e.createdBy ? ` · ${esc(e.createdBy)}` : ""}</div>
        <input class="date-cell" type="date" dir="ltr" min="2000-01-01" max="2100-12-31" data-edate="${escAttr(e._id)}"
          value="${escAttr(ex.isoOf(e))}" ${canDo("edit") ? "" : "disabled"}>
      </div>
      <input class="qty-cell" type="number" min="1" dir="ltr" data-eqty="${escAttr(e._id)}"
        value="${Number(e.qty) || 1}" ${canDo("edit") ? "" : "readonly"}>
      ${canDo("del") ? `<button class="del" data-delexp="${escAttr(e._id)}" aria-label="حذف الصنف">×</button>` : ""}
    </li>`;
  }).join("") || `<li class="empty">مفيش نتيجة في الشهر ده</li>`;
  updateMonthDirty();
}

function updateMonthDirty() {
  $("month-dirty").textContent = state.expEdits.size ? `${state.expEdits.size} تعديل` : "";
  $("btn-save-month").disabled = state.expEdits.size === 0;
  $("btn-save-month").hidden = !canDo("edit");
}

$("month-search").oninput = renderMonthItems;

// one pending patch per row: typing a quantity must not throw away a date change on the same row
function editOf(id) {
  const row = state.expRows.find(e => e._id === id);
  return state.expEdits.get(id) || { qty: Number(row.qty) || 1, day: row.day, month: row.month, year: row.year };
}

$("month-items").oninput = (e) => {
  const qtyInput = e.target.closest("input[data-eqty]");
  if (qtyInput) {
    const id = qtyInput.dataset.eqty;
    state.expEdits.set(id, { ...editOf(id), qty: Math.max(1, parseInt(qtyInput.value, 10) || 1) });
    updateMonthDirty();
    return;
  }
  const dateInput = e.target.closest("input[data-edate]");
  if (!dateInput) return;
  const d = ex.fromIso(dateInput.value);
  if (!d) return;                          // half-typed date: wait for a whole one
  const id = dateInput.dataset.edate;
  state.expEdits.set(id, { ...editOf(id), ...d });
  updateMonthDirty();
};

$("month-items").onclick = async (e) => {
  const btn = e.target.closest("button[data-delexp]");
  if (!btn) return;
  const row = state.expRows.find(x => x._id === btn.dataset.delexp);
  if (!confirm(`حذف «${row.name}» من صلاحيات الشهر ده؟`)) return;
  try {
    await db.deleteExpiry(row._id);
    state.expEdits.delete(row._id);
    toast("تم الحذف");
  } catch (err) {
    console.error(err);
    toast("الحذف ما نفعش — جرّب تاني", "bad");
  }
  await loadExpiry();      // the listener repaints the open month, and leaves it if it emptied
};

$("btn-save-month").onclick = async () => {
  const pending = [...state.expEdits];
  let n = 0;
  try {
    for (const [id, patch] of pending) { await db.updateExpiry(id, patch); state.expEdits.delete(id); n++; }
    toast(`تم حفظ ${n} تعديل`);
  } catch (err) {
    console.error(err);
    toast(`اتحفظ ${n} تعديل وبعدين حصلت مشكلة — جرّب تاني`, "bad");
  }
  await loadExpiry();      // the listener repaints the open month, and leaves it if it emptied          // a row whose date moved is now in another month, and may empty this one
};

/* ---------- ليبل الرف: pick a product, print it. Nothing is saved. ---------- */

let labelItem = null;
let labelQueue = [];        // {barcode, name, price, copies} — printed in one go at the end

function openLabel(barcode) {
  state.mode = "label";
  state.editingId = null;
  state.items = [];
  state.currentBarcode = null;
  labelQueue = [];
  clearFind();
  clearLabel();
  renderQueue();
  navTo("screen-label");
  if (barcode) onBarcode(barcode).catch(() => toast("حصلت مشكلة — جرّب تاني"));
}

$("btn-label").onclick = () => openLabel();

// #label=<barcode> is the link the manager's catalog row points at. It is read from goHome, so
// it survives the login screen (the hash stays put while the PIN is typed), and it is consumed
// once: the hash goes before the screen opens, otherwise every later trip home would jump back
// to the label.
function openDeepLabel() {
  const deep = location.hash.match(/^#label=(.+)$/);
  if (!deep) return;
  history.replaceState(history.state, "", location.pathname + location.search);
  if (canDo("label")) openLabel(decodeURIComponent(deep[1]));
}

function clearLabel() {
  labelItem = null;
  $("label-box").hidden = true;
  $("label-empty").hidden = false;
  renderQueue();               // the bottom bar counts the queue even with nothing on screen
}

function showLabel(barcode, name, price) {
  labelItem = { barcode, name };
  $("label-empty").hidden = true;
  $("label-box").hidden = false;
  // the catalog price when the sheet carried one; still editable for this print only. An empty
  // box is not a broken screen — it means that product has no price yet, and it says so.
  const known = Number.isFinite(price);
  $("label-price").value = known ? String(price) : "";
  $("label-price-note").hidden = known;
  // always 1, never the last count used: the owner adds copies himself when he wants them
  $("label-copies").value = 1;
  paintLabel();
  renderQueue();
}

// the preview IS the label: same HTML, same millimetres, so what the printer gets is on screen
function paintLabel() {
  if (!labelItem) return;
  $("label-preview").innerHTML = lbl.labelHtml(
    { ...labelItem, price: $("label-price").value.trim() }, window.APP_CONFIG);
}

$("label-price").oninput = paintLabel;
// the bottom bar counts what will actually come out, so it follows the copies box
$("label-copies").oninput = () => renderQueue();
$("copies-plus").onclick = () => { $("label-copies").value = Math.min(200, +$("label-copies").value + 1); renderQueue(); };
$("copies-minus").onclick = () => { $("label-copies").value = Math.max(1, +$("label-copies").value - 1); renderQueue(); };

// what is on the screen right now, as a queue row
const currentRow = () => (labelItem ? {
  ...labelItem,
  price: $("label-price").value.trim(),
  copies: Math.min(200, Math.max(1, parseInt($("label-copies").value, 10) || 1)),
} : null);

// «طباعة» prints the queue plus whatever is still on the screen, so printing one label is one
// tap and printing twenty is one tap per item plus one at the end
const toPrint = () => {
  const cur = currentRow();
  return cur ? [...labelQueue, cur] : [...labelQueue];
};

$("btn-queue-label").onclick = () => {
  const row = currentRow();
  if (!row) return;
  labelQueue.push(row);
  clearLabel();
  renderQueue();
  $("find-input").focus();
  toast(`اتضاف «${row.name}» — امسح الصنف اللي بعده`);   // toast writes textContent
};

function renderQueue() {
  const rows = toPrint();
  const labels = rows.reduce((n, r) => n + r.copies, 0);
  $("label-queue-block").hidden = !labelQueue.length;
  $("label-queue").innerHTML = labelQueue.map((r, i) => `<li>
      <div class="card-main">
        <div class="card-title">${esc(r.name)}</div>
        <div class="meta"><span class="code">${esc(r.barcode)}</span>${r.price ? ` · ${esc(r.price)} ج` : ""}</div>
      </div>
      <span class="stamp">${esc(r.copies)}</span>
      <button class="del" data-delqueue="${i}" aria-label="شيل الصنف">×</button>
    </li>`).join("");
  $("label-count").textContent = labels ? `${labels} ليبل` : "";
  $("btn-print-label").disabled = !labels;
  $("btn-save-job").hidden = !labels;
}

$("label-queue").onclick = (e) => {
  const btn = e.target.closest("button[data-delqueue]");
  if (!btn) return;
  labelQueue.splice(+btn.dataset.delqueue, 1);
  renderQueue();
};

// A print job cannot pace its own pages, so a gap between products means a separate job per
// product — one printer dialog each. Off by default (gap 0 = the whole lot in one job); the shop
// turns it on from the settings when the roll printer needs a breath between labels.
let printing = null;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function printByProduct(rows, gap, ui) {
  printing = { stop: false };
  ui.btn.textContent = "إيقاف الطباعة";
  for (let i = 0; i < rows.length && !printing.stop; i++) {
    $("print-area").innerHTML = lbl.sheetHtml([rows[i]], window.APP_CONFIG);
    ui.count.textContent = `بنطبع ${i + 1} من ${rows.length}`;
    print();
    // the wait is checked in slices so «إيقاف» does not have to sit through it
    for (let left = gap * 10; left > 0 && !printing.stop; left--) await sleep(100);
  }
  printing = null;
  ui.btn.textContent = "طباعة";
  ui.after();
}

// one print path for the label screen and a saved job: the @page, the A4/roll split and the gap
function printRows(rows, ui) {
  const cfg = lbl.labelCfg(window.APP_CONFIG);
  // a roll printer wants one label per page at the label's own size; an A4 sheet wants them
  // tiled on one page, which is a different @page and a different flow
  $("print-size").textContent = cfg.sheet === "a4"
    ? "@page { size: A4; margin: 6mm; }"
    : `@page { size: ${cfg.w}mm ${cfg.h}mm; margin: 0; }`;
  document.body.classList.toggle("print-a4", cfg.sheet === "a4");
  // the gap is a roll thing: an A4 sheet is one piece of paper, there is nothing to pace
  if (cfg.sheet !== "a4" && cfg.gap > 0 && rows.length > 1) { printByProduct(rows, cfg.gap, ui); return; }
  $("print-area").innerHTML = lbl.sheetHtml(rows, window.APP_CONFIG);
  print();
}

$("btn-print-label").onclick = () => {
  if (printing) { printing.stop = true; toast("وقفنا الطباعة"); return; }
  const rows = toPrint();
  if (!rows.length) return;
  printRows(rows, { btn: $("btn-print-label"), count: $("label-count"), after: renderQueue });
};

/* ---------- مهام الطباعة: the label queue, saved so any other device can print it ---------- */

$("btn-save-job").onclick = () => {
  const rows = toPrint();
  if (!rows.length) return;
  const name = (prompt("اسم المهمة؟ (مثلاً: ليبلات رف الزيوت)") || "").trim();
  if (!name) return;
  db.saveJob({
    name: name.slice(0, 100), createdBy: myName(),
    items: rows.map((r) => ({ barcode: r.barcode, name: r.name, price: r.price || "", copies: r.copies })),
  });
  labelQueue = [];
  clearLabel();
  toast(`اتحفظت مهمة «${name}» — تلاقيها في مهام الطباعة`, "ok");
};

let jobs = [];
let job = null;

// جديدة ← جاهزة للطباعة ← تمت طباعتها: the timestamps ARE the state, the same shape as erpState()
const jobState = (j) => (j.printedAt ? "تمت طباعتها" : j.readyAt ? "جاهزة للطباعة" : "جديدة");
const jobLabels = (j) => j.items.reduce((n, r) => n + (Number(r.copies) || 1), 0);

/* The queue is read a page at a time — the newest `jobPage`, never the lot. Widening a LIVE query
   means re-subscribing, so «عرض المزيد» drops the listener and takes a bigger window; that costs
   the new window once, which is why the page is 50 and not 5. */
let jobPage = db.JOB_PAGE, jobsOff = null;

async function openJobs() {
  await feed("jobs", (cb) => db.watchJobs(cb, jobPage).then((off) => { jobsOff = off; return off; }), paintJobs);
  navTo("screen-jobs");
}

async function moreJobs() {
  jobPage += db.JOB_PAGE;
  if (jobsOff) jobsOff();
  jobsOff = await db.watchJobs(paintJobs, jobPage);
}

// live: a job stamped «تمت طباعتها» on the shop laptop stops looking new on the phone
function paintJobs(rows) {
  jobs = rows;
  if (job) job = jobs.find((j) => j._id === job._id) || job;
  renderJobs();
  if (!$("screen-job").hidden) renderJob();
}

$("btn-jobs").onclick = () => { openJobs().catch(() => toast("حصلت مشكلة — جرّب تاني")); };

function renderJobs() {
  $("jobs-list").innerHTML = (jobs.length ? jobs.map((j) => `<li>
      <button class="card-open" data-job="${escAttr(j._id)}">
        <div class="card-main">
          <div class="card-title">${esc(j.name)}</div>
          <div class="meta">${esc(j.createdBy)} · ${new Date(j.createdAt).toLocaleDateString("ar-EG")} · ${jobLabels(j)} ليبل</div>
        </div>
        <span class="stamp">${jobState(j)}</span>
      </button>
    </li>`).join("") : `<li class="empty">مفيش مهام محفوظة. جهّز الأصناف في شاشة ليبل الرف ودوس «حفظ كمهمة طباعة».</li>`)
    // a full page means the server probably has more behind it; a short one is the end of the list
    + (jobs.length >= jobPage
      ? `<li class="more"><button type="button" class="ghost" id="btn-more-jobs">عرض المزيد — ${jobs.length} مهمة</button></li>`
      : "");
}

function renderJob() {
  $("job-head").textContent = job.name;
  $("job-meta").textContent = `${jobState(job)} · ${job.createdBy} · ${new Date(job.createdAt).toLocaleDateString("ar-EG")}`;
  $("job-items").innerHTML = job.items.map((r) => `<li>
      <div class="card-main">
        <div class="card-title">${esc(r.name)}</div>
        <div class="meta"><span class="code">${esc(r.barcode)}</span>${r.price ? ` · ${esc(r.price)} ج` : ""}</div>
      </div>
      <span class="stamp">${esc(r.copies)}</span>
    </li>`).join("");
  $("job-ready").hidden = !!job.readyAt || !!job.printedAt;
  $("job-count").textContent = `${jobLabels(job)} ليبل`;
}

$("jobs-list").onclick = (e) => {
  if (e.target.closest("#btn-more-jobs")) { moreJobs().catch(console.error); return; }
  const b = e.target.closest("button[data-job]");
  if (!b) return;
  job = jobs.find((j) => j._id === b.dataset.job);
  if (!job) return;
  renderJob();
  renderBtRow().catch(console.error);
  navTo("screen-job");
};

/* --- BarTender (the owner's shape, 2026-08-01): the app never opens a .btw — it hands the DATA
   over. The templates are the .btw files in «قوالب الطباعة» under the picked root, listed at
   print time on the machine that has them (a phone lists nothing and the row stays hidden);
   the job's rows go to «مهام BarTender» as a CSV BarTender watches, template name in the file
   name AND in every row so his integration can route either way. The built-in «طباعة» above
   is untouched — that is what keeps him free to adopt any template later. --- */

const BT_TPL = "قوالب الطباعة", BT_OUT = "مهام BarTender";

async function renderBtRow() {
  $("job-bt-row").hidden = true;
  const tpls = (await listFiles(BT_TPL)).filter((f) => /\.btw$/i.test(f.name));
  if (!tpls.length) return;
  $("job-bt-tpl").innerHTML = tpls.map((t) => `<option value="${escAttr(t.name)}">${esc(t.name)}</option>`).join("");
  $("job-bt-row").hidden = false;
}

$("job-bt-print").onclick = async () => {
  const tpl = $("job-bt-tpl").value;
  const rows = [["القالب", "الباركود", "اسم الصنف", "السعر", "النسخ"],
    ...job.items.map((r) => [tpl, r.barcode, r.name, r.price || "",
      Math.min(200, Math.max(1, parseInt(r.copies, 10) || 1))])];
  const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const out = await saveText(BT_OUT, `${tpl.replace(/\.btw$/i, "")} - ${job.name} - ${Date.now()}.csv`, csv);
  if (out.how !== "disk") {
    toast("مفيش مجلد متاح دلوقتي — الملف اتحمّل، انقله لمجلد «مهام BarTender» بنفسك", "warn");
    return;
  }
  // handing BarTender the file IS the print, the same receipt idea as «تم تحميلها»
  const patch = { printedBy: myName(), printedAt: Date.now() };
  db.updateJob(job._id, patch);
  Object.assign(job, patch);
  renderJob();
  renderJobs();
  toast(`اتبعت لـ BarTender: ${out.path}`, "ok");
};

$("job-ready").onclick = () => {
  const patch = { readyBy: myName(), readyAt: Date.now() };
  db.updateJob(job._id, patch);            // fire-and-forget, like every stamp in the app
  Object.assign(job, patch);
  renderJob();
  renderJobs();                            // the list behind this screen shows the state too
  toast("اتعلّمت جاهزة للطباعة", "ok");
};

$("job-del").onclick = () => {
  if (!confirm(`نمسح مهمة «${job.name}»؟`)) return;
  db.deleteJob(job._id);
  jobs = jobs.filter((j) => j._id !== job._id);
  renderJobs();
  history.back();
  toast("اتمسحت المهمة");
};

// the tap on «طباعة» is the receipt, the same idea as «تم تحميلها»: printing writes who and
// when, and a reprint simply overwrites the pair with the newer print
$("btn-print-job").onclick = () => {
  if (printing) { printing.stop = true; toast("وقفنا الطباعة"); return; }
  const rows = job.items.map((r) => ({ ...r, copies: Math.min(200, Math.max(1, parseInt(r.copies, 10) || 1)) }));
  printRows(rows, { btn: $("btn-print-job"), count: $("job-count"), after: renderJob });
  const patch = { printedBy: myName(), printedAt: Date.now() };
  db.updateJob(job._id, patch);
  Object.assign(job, patch);
  renderJob();
  renderJobs();
};

/* --- adding by name: the barcode field stays numeric, the search is its own box. It lives
   inside #scan-block, so the same box serves a shipment, a stocktake and الصلاحيات. --- */

let findTimer = null;

function clearFind() {
  $("find-input").value = "";
  $("find-results").hidden = true;
  $("barcode-input").value = "";
}

$("find-input").oninput = () => {
  clearTimeout(findTimer);
  findTimer = setTimeout(runFind, 250);             // one search per pause, not per keystroke
};

async function runFind() {
  const q = $("find-input").value.trim();
  if (q.length < 2) { $("find-results").hidden = true; return; }
  const hits = (await db.searchProducts(q).catch(() => [])).slice(0, 8);
  if ($("find-input").value.trim() !== q) return;   // a newer search already ran
  $("find-results").hidden = false;
  $("find-results").innerHTML = hits.map(p => `<li>
      <div class="card-main">
        <div class="card-title">${esc(p.name)}</div>
        <div class="code">${esc(p.barcode)}</div>
      </div>
      <button class="ghost" data-pick="${escAttr(p.barcode)}">اختار</button>
    </li>`).join("") || `<li class="empty">مفيش نتيجة — جرّب أي جزء من الاسم أو الباركود</li>`;
}

$("find-results").onclick = (e) => {
  const btn = e.target.closest("button[data-pick]");
  if (btn) onBarcode(btn.dataset.pick).catch(() => toast("حصلت مشكلة — جرّب تاني"));
};

/* ---------- camera ---------- */

let scanner = null;

// per-phone camera preferences: a shop phone with three back lenses often defaults to the
// one that cannot focus close up, which reads as "the scanner is broken on this phone"
const CAM_DEFAULTS = { deviceId: "", box: "med", torch: false, zoom: 1, res: "hd", focus: true };
const camCfg = () => ({ ...CAM_DEFAULTS, ...JSON.parse(localStorage.getItem("camSettings") || "{}") });
const saveCam = (patch) => localStorage.setItem("camSettings", JSON.stringify({ ...camCfg(), ...patch }));

const BOXES = { small: { w: 220, h: 130 }, med: { w: 300, h: 170 }, large: { w: 340, h: 220 } };
const BOX_LABELS = { small: "صغير", med: "متوسط", large: "كبير" };

// Without a resolution the browser hands out its default stream — 640×480 on most Android
// phones, which is where "the scanner is fine on my phone, useless on the shop one" comes from.
// ideal (not exact) so a camera that cannot do it still starts instead of failing.
const RES = {
  auto: {},
  hd: { width: { ideal: 1280 }, height: { ideal: 720 } },
  fhd: { width: { ideal: 1920 }, height: { ideal: 1080 } },
};
const RES_LABELS = { auto: "عادية", hd: "عالية", fhd: "أعلى" };

// retail barcodes + QR only: fewer formats to try per frame means a faster read
const FMT = window.Html5QrcodeSupportedFormats;
const FORMATS = FMT
  ? [FMT.EAN_13, FMT.EAN_8, FMT.UPC_A, FMT.UPC_E, FMT.UPC_EAN_EXTENSION,
     FMT.CODE_128, FMT.CODE_39, FMT.ITF, FMT.QR_CODE].filter((f) => f !== undefined)
  : undefined;

$("btn-scan").onclick = () => (scanner ? stopScan() : startScan());

async function startScan(retried = false) {
  if (scanner) return;
  const s = camCfg();
  const box = BOXES[s.box] || BOXES.med;
  $("reader").hidden = false;
  // the native detector on Android is much faster than the JS decoder when it exists
  scanner = new Html5Qrcode("reader", {
    formatsToSupport: FORMATS,
    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
  });
  // html5-qrcode ignores the first argument once videoConstraints is valid, so the chosen
  // camera has to live inside the same object as the resolution
  const video = {
    ...(RES[s.res] || RES.hd),
    ...(s.deviceId && !retried ? { deviceId: { exact: s.deviceId } } : { facingMode: "environment" }),
  };
  try {
    await scanner.start(
      video,
      { fps: 12, qrbox: { width: Math.min(box.w, innerWidth - 48), height: box.h }, videoConstraints: video },
      async (text) => { await stopScan(); beep(); onBarcode(text.trim()).catch(() => toast("حصلت مشكلة — جرّب تاني")); }
    );
  } catch (err) {
    console.error(err);
    await stopScan();
    if (s.deviceId && !retried) {          // saved camera is not on this phone any more
      saveCam({ deviceId: "" });
      toast("الكاميرا المحفوظة مش موجودة — رجّعنا التلقائي");
      return startScan(true);
    }
    toast("الكاميرا مش متاحة — اكتب الباركود بإيدك");
    return;
  }
  await applyTrack();
}

const constrain = (adv) => (scanner
  ? scanner.applyVideoConstraints({ advanced: [adv] }).catch((e) => console.error(e))
  : Promise.resolve());

// torch and zoom only exist on some phones; the controls appear only when the track has them
async function applyTrack() {
  const s = camCfg();
  let caps = {};
  try { caps = scanner.getRunningTrackCapabilities() || {}; } catch (e) { console.error(e); }
  // a phone that locks focus at infinity never reads a barcode held 10 cm away
  if (s.focus && Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
    await constrain({ focusMode: "continuous" });
  }
  showCamRes();
  $("btn-torch").hidden = !caps.torch;
  $("zoom-live-wrap").hidden = !caps.zoom;
  $("cam-live").hidden = false;                 // the resolution readout is always worth showing
  if (caps.zoom) {
    const z = Math.min(Math.max(s.zoom, caps.zoom.min), caps.zoom.max);
    Object.assign($("zoom-live"), { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.5, value: z });
    await constrain({ zoom: z });
  }
  if (caps.torch) {
    $("btn-torch").setAttribute("aria-pressed", String(!!s.torch));
    await constrain({ torch: !!s.torch });
  }
}

// the real stream size, not the one we asked for: the only honest way to tell whether the
// phone accepted the resolution setting
function showCamRes() {
  let st = {};
  try { st = scanner.getRunningTrackSettings() || {}; } catch (e) { console.error(e); }
  $("cam-res").textContent = st.width ? `${st.width}×${st.height}` : "";
}

$("btn-torch").onclick = async () => {
  const on = $("btn-torch").getAttribute("aria-pressed") !== "true";
  $("btn-torch").setAttribute("aria-pressed", String(on));
  saveCam({ torch: on });
  await constrain({ torch: on });
};

$("zoom-live").oninput = async () => {
  const z = +$("zoom-live").value;
  saveCam({ zoom: z });
  await constrain({ zoom: z });
};

async function stopScan() {
  if (scanner) {
    try { await scanner.stop(); scanner.clear(); } catch (e) { /* already stopped */ }
    scanner = null;
  }
  $("reader").hidden = true;
  $("cam-live").hidden = true;
}


$("btn-cam").onclick = () => { navTo("screen-cam"); renderCamScreen(); };

async function renderCamScreen() {
  const s = camCfg();
  $("box-picker").innerHTML = Object.keys(BOXES).map(k =>
    `<button type="button" data-box="${k}" aria-pressed="${k === s.box}">${BOX_LABELS[k]}</button>`).join("");
  $("res-picker").innerHTML = Object.keys(RES).map(k =>
    `<button type="button" data-res="${k}" aria-pressed="${k === s.res}">${RES_LABELS[k]}</button>`).join("");
  $("btn-focus").setAttribute("aria-pressed", String(!!s.focus));
  $("cam-zoom").value = s.zoom;
  $("cam-zoom-val").textContent = `×${s.zoom}`;
  $("btn-torch-default").setAttribute("aria-pressed", String(!!s.torch));

  $("cam-note").textContent = "بندوّر على الكاميرات...";
  $("cam-list").innerHTML = "";
  let cams = [];
  try { cams = await Html5Qrcode.getCameras(); } catch (e) { console.error(e); }
  if (!cams.length) {
    $("cam-note").textContent = "مفيش كاميرا متاحة، أو إذن الكاميرا مرفوض. اسمح بالكاميرا للموقع من إعدادات المتصفح وافتح الصفحة تاني.";
    return;
  }
  $("cam-note").textContent = `${cams.length} كاميرا على الموبايل ده. لو مش عارف مين مين، جرّب واحدة واحدة على باركود صغير.`;
  $("cam-list").innerHTML = [
    `<button type="button" data-cam="" aria-pressed="${!s.deviceId}">تلقائي</button>`,
    ...cams.map((c, i) => `<button type="button" data-cam="${escAttr(c.id)}" aria-pressed="${c.id === s.deviceId}">${esc(c.label || `كاميرا ${i + 1}`)}</button>`),
  ].join("");
}

$("cam-list").onclick = (e) => {
  const btn = e.target.closest("button[data-cam]");
  if (!btn) return;
  saveCam({ deviceId: btn.dataset.cam });
  renderCamScreen();
  toast("اتحفظت — جرّب المسح تاني");
};

$("box-picker").onclick = (e) => {
  const btn = e.target.closest("button[data-box]");
  if (!btn) return;
  saveCam({ box: btn.dataset.box });
  renderCamScreen();
};

$("res-picker").onclick = (e) => {
  const btn = e.target.closest("button[data-res]");
  if (!btn) return;
  saveCam({ res: btn.dataset.res });
  renderCamScreen();
  toast("اتحفظت — تفتح مع المسح الجاي");
};

$("btn-focus").onclick = () => {
  const on = $("btn-focus").getAttribute("aria-pressed") !== "true";
  $("btn-focus").setAttribute("aria-pressed", String(on));
  saveCam({ focus: on });
};

$("cam-zoom").oninput = () => {
  const z = +$("cam-zoom").value;
  saveCam({ zoom: z });
  $("cam-zoom-val").textContent = `×${z}`;
};

$("btn-torch-default").onclick = () => {
  const on = $("btn-torch-default").getAttribute("aria-pressed") !== "true";
  $("btn-torch-default").setAttribute("aria-pressed", String(on));
  saveCam({ torch: on });
};

let beepCtx = null;

function beep() {
  try {
    beepCtx = beepCtx || new AudioContext();
    const o = beepCtx.createOscillator();
    o.connect(beepCtx.destination);
    o.frequency.value = 880;
    o.start();
    o.stop(beepCtx.currentTime + 0.15);
  } catch (e) { console.error(e); }
}

/* ---------- keyboard: Enter does the obvious thing for the focused field ---------- */

const ENTER = {
  "login-pin": "btn-login",
  "barcode-input": "btn-lookup",
  "item-qty": "btn-add-item",
  "item-date": "btn-add-item",
};

addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const btn = ENTER[e.target.id];
  if (!btn) return;
  e.preventDefault();
  e.target.blur();          // closes the phone keyboard before the screen changes
  $(btn).click();
});

/* ---------- boot ---------- */

addEventListener("db-error", () => toast("مشكلة في مزامنة البيانات — اتأكد من الاتصال والإعدادات", "bad"));

let dbBroken = false;

function updateSync() {
  $("sync-state").textContent = dbBroken ? "إعدادات ناقصة" : (navigator.onLine ? "متصل" : "مستني الاتصال");
  $("sync-state").classList.toggle("off", dbBroken || !navigator.onLine);   // the dot follows the word
}
addEventListener("online", updateSync);
addEventListener("offline", updateSync);

let cfgReady = null;

cfgReady = (async () => {
  const ok = await db.initDb().then(() => true).catch((e) => { console.error(e); return false; });
  dbBroken = !ok;
  updateSync();
  // branches, PINs, types and users the admin edited win over the ones shipped in the code
  Object.assign(window.APP_CONFIG, await db.getConfig().catch(() => ({})));
  applyBrand(window.APP_CONFIG);
  state.branch = myBranch();
  if (!types().includes(state.type)) state.type = types()[0];

  /* From here the settings are live: a permission, a branch or a supplier the admin changes on
     another machine reaches this phone in seconds instead of at the next reload. Only what is
     derived from the config is repainted — the branch the employee is standing in is left alone
     unless it stopped being one they are allowed to use, because moving it mid-shipment would
     stamp the delivery with the wrong branch. */
  db.watchConfig((cfg) => {
    Object.assign(window.APP_CONFIG, cfg);
    applyBrand(window.APP_CONFIG);
    // a catalog imported on any machine reaches this phone's name search in seconds, not in 7 days
    const cat = (cfg.filesMeta || {})["الأصناف"];
    if (cat && cat.at) db.dropCatalogIndexIfOlder(cat.at);
    if (!allowedBranches().includes(state.branch)) state.branch = allowedBranches()[0];
    renderNewBranch();
    renderSuppliers();
    $("supplier-dl").innerHTML = "";     // the expiry datalist refills from the fresh list next open
  }).catch(console.error);

  const s = auth.session();
  if (s && s.user && s.perms.includes("emp") && !myName()) {
    // signed in on another page and sent here: don't ask for the PIN a second time
    localStorage.setItem("employeeName", s.name);
    if (s.branches.length === 1) localStorage.setItem("employeeBranch", s.branches[0]);
    state.branch = myBranch();
  }
  if (!allowedBranches().includes(state.branch)) state.branch = allowedBranches()[0];
  if (s && !s.perms.includes("emp")) {          // signed in, but this is not their screen
    const page = auth.landingPage(s.perms);
    if (page && page !== "index.html") { auth.goTo(page); return; }
  }
  /* One door (the owner, 2026-08-01: «اللينك الرئيسي يفتح دائمًا على صفحة تسجيل الدخول»):
     the PIN screen, always. The old «بيانات الموظف» name screen is gone — it resurfaced every
     time the users list was lost (measured twice in production), because «no users» used to
     mean «no PIN». A shop with no users signs in with the admin PIN and creates them. */
  if (s && myName()) {
    history.replaceState({ screen: "screen-home" }, "");
    await goHome();
  } else {
    history.replaceState({ screen: "screen-login" }, "");
    render("screen-login");
  }
})();

keepFresh(toast);
