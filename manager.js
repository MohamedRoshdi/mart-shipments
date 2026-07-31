import * as db from "./db.js";
import * as auth from "./auth.js";
import * as ex from "./expiry.js";
import { zipBlob } from "./zip.js";
import { sheetRows, requireColumns, unitName, unitCode, clean as cell } from "./sheet.js";

const $ = (id) => document.getElementById(id);
const esc = (t) => { const d = document.createElement("div"); d.textContent = t; return d.innerHTML; };
// attribute context needs the quotes escaped too — catalog text is publicly writable
const escAttr = (t) => esc(t).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const fmtDate = (ts) => new Date(ts).toLocaleDateString("ar-EG");
// «تم تحميلها» has to say the hour too: two people loading the same shipment do it the same day
const fmtWhen = (ts) => `${fmtDate(ts)} ${new Date(ts).toLocaleTimeString("ar-EG",
  { hour: "2-digit", minute: "2-digit" })}`;
const ALL = "الكل";

function toast(msg) {
  $("toast").textContent = msg;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2200);
}

const TITLES = {
  "screen-pin": "شاشة المدير",
  "screen-manager": "الشحنات",
  "screen-detail": "تعديل شحنة",
  "screen-products": "الأصناف",
  "screen-expiry-month": "الصلاحيات",
};
const DEEP = ["screen-detail", "screen-products", "screen-expiry-month"];   // screens you can go back from
const PAGE = 50;                                     // rows rendered at once; search narrows the rest

let all = [];        // everything read from the database
let shown = [];      // after the branch filter — row indexes point here
let counts = [];     // stocktake sessions (الجرد), same scope rules as shipments
let shownCounts = [];
let expRows = [];    // الصلاحيات: one row per product and date, grouped into months on screen
let monthKey = "";   // the month open in the deep screen
const expEdits = new Map();   // row id -> pending { qty, day, month, year }
let tab = "ship";    // which list the screen is showing
let filter = ALL;
let typeFilter = ALL;
let scopes = [];     // branches this user may see; empty = every branch
let stockBranch = ""; // which branch's stocktake sheet is being imported or exported
let current = null;  // the shipment being edited (a copy)
let identity = "";   // who the audit rows are written as

// same safety valve as the admin page: the PIN in the code always opens the master view
const CODE_ADMIN_PIN = window.APP_CONFIG.adminPin;

let cfgReady = null; // resolves once the admin's stored settings are merged in

/* ---------- navigation ---------- */

function render(id) {
  document.querySelectorAll("main > section").forEach(s => s.hidden = true);
  $(id).hidden = false;
  $("screen-title").textContent = TITLES[id] || "شاشة المدير";
  $("btn-back").hidden = !DEEP.includes(id);
  $("btn-products").hidden = id !== "screen-manager" || !canDo("products");   // one tap from the list, no scrolling
  scrollTo(0, 0);
}

addEventListener("popstate", (ev) => {
  const id = (ev.state && ev.state.screen) || "screen-manager";
  if (DEEP.includes(id)) render(id); else openManager();
});

$("btn-back").onclick = () => history.back();

/* ---------- unlock ---------- */

$("btn-pin").onclick = async () => {
  await cfgReady;                                          // the admin's settings win over the shipped ones
  const entered = $("pin-input").value;
  const who = auth.authenticate(entered, window.APP_CONFIG, CODE_ADMIN_PIN);
  if (!who) { toast("الرقم السري غلط"); return; }
  if (who.blocked) { toast("الرقم ده مربوط بموبايل تاني — كلّم الأدمن يفكّه الأول"); return; }
  if (who.claim) db.claimDevice(entered, who.claim);
  if (!who.perms.includes("mgr")) {                        // right PIN, wrong screen → send them home
    const page = auth.landingPage(who.perms);
    if (!page) { toast("المستخدم ده مالوش صلاحيات — كلّم الأدمن"); return; }
    auth.startSession(who.name, who.branches, who.perms, who.user);
    toast("الصفحة دي مش من صلاحياتك — بنوديك لصفحتك");
    setTimeout(() => auth.goTo(page), 900);
    return;
  }
  auth.startSession(who.name, who.branches, who.perms, who.user);
  $("pin-input").value = "";
  enterManager();
};

function enterManager() {
  const s = auth.session();
  scopes = (s && s.branches) || [];                        // a scoped user never loads another branch
  identity = (s && s.name) || "مدير";
  filter = scopes.length === 1 ? scopes[0] : ALL;
  stockBranch = myBranches()[0] || "";
  applyPerms();
  history.replaceState({ screen: "screen-manager" }, "");
  openManager();
}

// no session = the old single-PIN manager, where everything was allowed
const canDo = (perm) => !auth.session() || auth.can(perm);

function applyPerms() {
  $("tool-import").hidden = !canDo("import");
  $("tool-stock").hidden = !canDo("import");
  $("tool-export").hidden = !canDo("download");
  $("counts-exports").hidden = !canDo("download");
  $("expiry-exports").hidden = !canDo("download");
  $("m-exports").hidden = !canDo("download");
  $("list-tabs").hidden = !(canDo("count") || canDo("expiry"));   // one list left = no need for tabs
  $("list-tabs").querySelector('[data-tab="count"]').hidden = !canDo("count");
  $("list-tabs").querySelector('[data-tab="expiry"]').hidden = !canDo("expiry");
  if (!canDo("count") && tab === "count") tab = "ship";
  if (!canDo("expiry") && tab === "expiry") tab = "ship";
  $("tool-admin").hidden = !canDo("adm");
  $("btn-save-edit").hidden = !canDo("edit");
  $("detail-exports").hidden = !canDo("download");
  $("detail-danger").hidden = !canDo("del");
  $("btn-export-products").hidden = !canDo("download");
  $("tool-logout").hidden = !auth.session();
  $("link-admin-page").href = auth.withQuery("admin.html");   // keep ?test=1 across pages
}

$("btn-logout").onclick = () => {
  auth.endSession();
  location.reload();
};

/* ---------- shipment list ---------- */

const shortBranch = (b) => b.replace(/^فرع\s+/, ""); // chips stay one line; stored value keeps "فرع"

// the branches this manager may act on; empty scope = the whole shop
const myBranches = () => (scopes.length ? scopes : window.APP_CONFIG.branches.map(b => b.name));

// one branch choice drives both the stocktake import and the sheet it exports, so the file
// that comes out is the file that goes back in
function renderStockBranch() {
  const html = myBranches().map(b =>
    `<button type="button" data-stockbranch="${escAttr(b)}" aria-pressed="${b === stockBranch}">${esc(shortBranch(b))}</button>`).join("");
  $("stock-branch").innerHTML = html;
  $("export-branch").innerHTML = html;
}

for (const id of ["stock-branch", "export-branch"]) {
  $(id).onclick = (e) => {
    const btn = e.target.closest("button[data-stockbranch]");
    if (!btn) return;
    stockBranch = btn.dataset.stockbranch;
    renderStockBranch();
    if (!$("screen-products").hidden) renderProducts();     // the quantity column follows the chip
  };
}

function renderFilter() {
  // a branch manager sees their branch as a locked chip, not a filter
  const mine = scopes.length ? scopes : window.APP_CONFIG.branches.map(b => b.name);
  const opts = scopes.length === 1 ? scopes : [ALL, ...mine];
  const locked = scopes.length === 1;
  // one branch = nothing to filter; the title already says which one, so the row is just noise
  $("branch-filter-row").hidden = locked;
  $("branch-filter").innerHTML = opts.map(b =>
    `<button type="button" data-branch="${esc(b)}" aria-pressed="${b === filter}" ${locked ? "disabled" : ""}>${esc(shortBranch(b))}</button>`).join("");
}

$("branch-filter").onclick = (e) => {
  const btn = e.target.closest("button[data-branch]");
  if (!btn) return;
  filter = btn.dataset.branch;
  renderFilter();
  renderList();
};

function renderTypeFilter() {
  $("type-filter").innerHTML = [ALL, ...window.APP_CONFIG.shipmentTypes].map(t =>
    `<button type="button" data-typefilter="${esc(t)}" aria-pressed="${t === typeFilter}">${esc(t)}</button>`).join("");
}

$("type-filter").onclick = (e) => {
  const btn = e.target.closest("button[data-typefilter]");
  if (!btn) return;
  typeFilter = btn.dataset.typefilter;
  renderTypeFilter();
  renderList();
};

/* ---------- one month at a time ----------
   The page used to read every shipment and every stocktake ever saved, on every visit. It now
   reads the month that is picked, which is the current one to start with; «كل الشهور» is still
   there for the times somebody is looking for something old. */

const MONTH_ALL = "";
const monthOf = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
let month = monthOf(Date.now());

function renderMonthPick() {
  const now = new Date();
  const opts = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = monthOf(d.getTime());
    return `<option value="${k}"${k === month ? " selected" : ""}>${
      d.toLocaleDateString("ar-EG", { month: "long", year: "numeric" })}</option>`;
  });
  opts.push(`<option value=""${month === MONTH_ALL ? " selected" : ""}>كل الشهور</option>`);
  $("month-pick").innerHTML = opts.join("");
}

async function loadMonth() {
  all = await db.listShipments(month).catch(() => []);
  counts = canDo("count") ? await db.listCounts(month).catch(() => []) : [];
  // never hold a branch this user may not see: the filter runs before anything is painted
  if (scopes.length) {
    all = all.filter(s => scopes.includes(s.branch));
    counts = counts.filter(c => scopes.includes(c.branch));
  }
}

$("month-pick").onchange = async () => {
  month = $("month-pick").value;
  await loadMonth();
  renderList();
};

async function openManager() {
  render("screen-manager");
  if (scopes.length === 1) $("screen-title").textContent = shortBranch(scopes[0]);
  await loadMonth();
  // an empty current month on the first of the month would look like an empty app; ask for
  // everything once in that case, and let the picker say so
  if (!all.length && !counts.length && month !== MONTH_ALL) {
    month = MONTH_ALL;
    await loadMonth();
  }
  // الصلاحيات is filed by the expiry date, not by the day it was typed, so its own tab groups it
  expRows = canDo("expiry") ? await db.listExpiry().catch(() => []) : [];
  if (scopes.length) expRows = expRows.filter(e => !e.branch || scopes.includes(e.branch));
  renderMonthPick();
  renderFilter();
  renderTypeFilter();
  renderStockBranch();
  renderTabs();
  renderList();
}

function renderTabs() {
  [...$("list-tabs").children].forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.tab === tab)));
  $("type-filter-row").hidden = tab !== "ship";   // a stocktake has no shipment type
  $("month-pick").hidden = tab === "expiry";      // a صلاحيات month is an expiry date, not a filter
  $("ships-block").hidden = tab !== "ship";
  $("counts-block").hidden = tab !== "count";
  $("expiry-block").hidden = tab !== "expiry";
}

$("list-tabs").onclick = (e) => {
  const btn = e.target.closest("button[data-tab]");
  if (!btn) return;
  tab = btn.dataset.tab;
  renderTabs();
  renderList();
};

// the shipment name IS the supplier now, so this is how the manager finds one supplier's
// deliveries: the same loose Arabic matching the catalog search uses, start or middle
function matchesSearch(s) {
  const q = db.norm($("list-search").value);
  if (!q) return true;
  // the supplier code is a search term too: it is what the shop's own paperwork carries
  return db.norm(s.name).includes(q) || db.norm(s.createdBy).includes(q)
    || String(s.supplierCode || "").includes(q);
}

$("list-search").oninput = renderList;

/* Three rows of chips sat above every list — the branch, the type and the tabs — and pushed the
   first card near the fold. The chips are one button away now, and the button says what is
   filtered, so a list that is showing a subset can never look like the whole thing. */

let filtersOpen = false;

function renderFilterBar() {
  const parts = [];
  if (filter !== ALL && !$("branch-filter-row").hidden) parts.push(shortBranch(filter));
  if (typeFilter !== ALL && tab === "ship") parts.push(typeFilter);
  const nothingToFilter = $("branch-filter-row").hidden && tab !== "ship";
  $("btn-filters").hidden = nothingToFilter;
  $("btn-filters").textContent = parts.length ? parts.join(" · ") : "فلترة";
  $("btn-filters").classList.toggle("on", parts.length > 0);
  // an active filter is never hidden: the row stays open while it is on, whatever the toggle says
  $("filters").hidden = nothingToFilter || !(filtersOpen || parts.length);
  $("btn-filters").setAttribute("aria-expanded", String(!$("filters").hidden));
}

$("btn-filters").onclick = () => {
  filtersOpen = !filtersOpen;
  renderFilterBar();
};

function renderList() {
  renderFilterBar();
  $("list-search").hidden = tab === "expiry";      // a month card is not a name
  if (tab === "count") { renderCounts(); return; }
  if (tab === "expiry") { renderMonths(); return; }
  shown = all.filter(s => (filter === ALL || s.branch === filter)
    && (typeFilter === ALL || s.type === typeFilter)
    && matchesSearch(s));
  // One card, one tap. Five buttons on every row turned the list into a wall of controls (the
  // owner's words, 2026-07-31); copy/Excel/TXT/delete all live on the screen the card opens,
  // which is the same two taps they took before.
  $("all-shipments").innerHTML = shown.map((s, i) => `<li>
      <button class="card-open" data-act="view" data-i="${i}">
        <span class="card-title">${esc(s.name)}${s.loadedAt ? ` <span class="tag-loaded">تم تحميلها</span>` : ""}</span>
        <span class="meta">${esc(s.type || "بدون نوع")} · ${esc(s.branch || "بدون فرع")} · ${esc(s.createdBy)} · ${fmtDate(s.createdAt)} · ${s.items.length} صنف${s.loadedAt ? ` · حمّلها ${esc(s.loadedBy || "؟")} ${fmtWhen(s.loadedAt)}` : ""}</span>
      </button>
    </li>`).join("") || `<li class="empty">${filter === ALL ? "مفيش شحنات لسه" : "مفيش شحنات في الفرع ده"}</li>`;
}

$("all-shipments").onclick = (e) => {
  const btn = e.target.closest("button[data-i]");
  if (btn) openDetail(shown[+btn.dataset.i]);
};

/* ---------- stocktake list (الجرد) ---------- */

// what the count found against what the system claims; an item with no system quantity
// counts as a pure surplus, which is exactly what it is on the shelf
const countDiff = (c) => c.items.reduce((n, i) => n + (Number(i.qty) || 0) - (Number(i.sys) || 0), 0);
const withSign = (n) => (n > 0 ? `+${n}` : String(n));            // files: Excel wants the sign
// screen: a leading minus next to Arabic text renders on the wrong side, so use words
const diffWord = (n) => (n === 0 ? "مظبوط" : (n > 0 ? `زيادة ${n}` : `ناقص ${-n}`));

function renderCounts() {
  shownCounts = counts.filter(c => (filter === ALL || c.branch === filter) && matchesSearch(c));
  $("all-counts").innerHTML = shownCounts.map((c, i) => `<li>
      <button class="card-open" data-cact="view" data-i="${i}">
        <span class="card-title">${esc(c.name)}</span>
        <span class="meta">${esc(c.branch || "بدون فرع")} · ${esc(c.createdBy)} · ${fmtDate(c.createdAt)} · ${c.items.length} صنف · الفرق ${esc(diffWord(countDiff(c)))}</span>
      </button>
    </li>`).join("") || `<li class="empty">${filter === ALL ? "مفيش جرد لسه" : "مفيش جرد في الفرع ده"}</li>`;
}

$("all-counts").onclick = (e) => {
  const btn = e.target.closest("button[data-i]");
  if (btn) openDetail(shownCounts[+btn.dataset.i], "count");
};

/* ---------- الصلاحيات (expiry): months are derived from the rows, never stored ---------- */

const expInScope = () => expRows.filter(e => filter === ALL || !e.branch || e.branch === filter);

function renderMonths() {
  const ms = ex.months(expInScope());
  $("all-months").innerHTML = ms.map(m => `<li class="exp exp-${m.status}">
      <button class="card-open" data-month="${escAttr(m.key)}">
        <span class="card-title">${esc(m.label)}</span>
        <span class="meta">${m.count} صنف · ${m.qty} قطعة · ${esc(ex.daysWord(m.days))}</span>
      </button>
    </li>`).join("") || `<li class="empty">${filter === ALL ? "مفيش صلاحيات مسجّلة" : "مفيش صلاحيات في الفرع ده"}</li>`;
}

$("all-months").onclick = (e) => {
  const open = e.target.closest("button[data-month]");
  if (open) openMonth(open.dataset.month);   // Excel for the month is inside it, next to its rows
};

const monthRows = () => expInScope().filter(e => ex.monthKey(e) === monthKey);

function openMonth(key) {
  monthKey = key;
  expEdits.clear();
  $("m-search").value = "";
  history.pushState({ screen: "screen-expiry-month" }, "");
  render("screen-expiry-month");
  paintMonth();
}

function paintMonth() {
  const m = ex.months(monthRows())[0];
  if (!m) { history.back(); return; }         // the last row left → the month is gone
  $("m-head").textContent = m.label;
  $("screen-title").textContent = m.label;
  $("m-count").textContent = `${m.count} صنف · ${m.qty} قطعة · ${ex.STATUS_LABEL[m.status]}`;
  renderMonthItems();
}

function renderMonthItems() {
  const m = ex.months(monthRows())[0];
  if (!m) return;
  $("m-items").innerHTML = ex.search(m.items, $("m-search").value).map(e => {
    const days = ex.daysLeft(e);
    return `<li class="exp exp-${ex.statusOf(days)}">
      <div class="card-main">
        <div class="card-title">${esc(e.name || "بدون اسم")}</div>
        <div class="meta"><span class="code">${esc(e.barcode)}</span>${e.branch ? ` · ${esc(shortBranch(e.branch))}` : ""}</div>
        <!-- who recorded it, on the row itself: the owner asked to know that without opening Excel -->
        <div class="meta">${esc(ex.daysWord(days))}${e.createdBy ? ` · ${esc(e.createdBy)}` : ""}</div>
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
  $("m-dirty").textContent = expEdits.size ? `${expEdits.size} تعديل` : "";
  $("btn-save-month").disabled = expEdits.size === 0;
  $("btn-save-month").hidden = !canDo("edit");
}

$("m-search").oninput = renderMonthItems;

// one pending patch per row: a quantity edit must not throw away a date edit on the same row
function editOf(id) {
  const row = expRows.find(e => e._id === id);
  return expEdits.get(id) || { qty: Number(row.qty) || 1, day: row.day, month: row.month, year: row.year };
}

$("m-items").oninput = (e) => {
  const qtyInput = e.target.closest("input[data-eqty]");
  if (qtyInput) {
    const id = qtyInput.dataset.eqty;
    expEdits.set(id, { ...editOf(id), qty: Math.max(1, parseInt(qtyInput.value, 10) || 1) });
    updateMonthDirty();
    return;
  }
  const dateInput = e.target.closest("input[data-edate]");
  if (!dateInput) return;
  const d = ex.fromIso(dateInput.value);
  if (!d) return;                            // half-typed date: wait for a whole one
  expEdits.set(dateInput.dataset.edate, { ...editOf(dateInput.dataset.edate), ...d });
  updateMonthDirty();
};

$("m-items").onclick = async (e) => {
  const btn = e.target.closest("button[data-delexp]");
  if (!btn) return;
  const row = expRows.find(x => x._id === btn.dataset.delexp);
  if (!confirm(`حذف «${row.name}» من صلاحيات الشهر ده؟`)) return;
  try {
    await db.deleteExpiry(row._id);
    db.logAction(identity, "حذف صلاحية", `${row.barcode} — ${row.name}`);
    expEdits.delete(row._id);
    toast("تم الحذف");
  } catch (err) {
    console.error(err);
    toast("الحذف ما نفعش — جرّب تاني");
  }
  await reloadExpiry();
};

$("btn-save-month").onclick = async () => {
  const pending = [...expEdits];
  let n = 0;
  try {
    for (const [id, patch] of pending) { await db.updateExpiry(id, patch); expEdits.delete(id); n++; }
    if (n) db.logAction(identity, "تعديل صلاحيات", `${n} صنف`);
    toast(`تم حفظ ${n} تعديل`);
  } catch (err) {
    console.error(err);
    toast(`اتحفظ ${n} تعديل وبعدين حصلت مشكلة — جرّب تاني`);
  }
  await reloadExpiry();      // a row whose date moved is in another month now, and may empty this one
};

async function reloadExpiry() {
  expRows = await db.listExpiry().catch(() => []);
  if (scopes.length) expRows = expRows.filter(e => !e.branch || scopes.includes(e.branch));
  paintMonth();
}

const expiryRows = (rows) => [
  ["الفرع", "الباركود", "اسم الصنف", "الكمية", "تاريخ الصلاحية", "الحالة", "الموظف"],
  ...rows.map(e => [e.branch || "", e.barcode, e.name || "", e.qty,
    ex.isoOf(e), ex.STATUS_LABEL[ex.statusOf(ex.daysLeft(e))], e.createdBy || ""]),
];

function exportMonth(key) {
  const m = ex.months(expInScope()).find(x => x.key === key);
  if (!m) { toast("مفيش أصناف في الشهر ده"); return; }
  downloadCsv(`صلاحيات-${safeName(m.label)}.csv`, expiryRows(m.items));
  toast("تم تحميل ملف Excel");
}

$("btn-export-month").onclick = () => exportMonth(monthKey);

$("btn-export-expiry").onclick = () => {
  const rows = ex.months(expInScope()).flatMap(m => m.items);   // nearest month first, like the screen
  if (!rows.length) { toast("مفيش صلاحيات تتحمّل"); return; }
  downloadCsv(`صلاحيات-${filter === ALL ? "all" : safeName(filter)}.csv`, expiryRows(rows));
  toast("تم تحميل ملف Excel");
};

/* ---------- copy + download ---------- */

const shipmentText = (s) => s.items.map(i => `${i.barcode}\t${i.qty}`).join("\n");

async function copyShipment(s) {
  try {
    await navigator.clipboard.writeText(shipmentText(s));
    toast("تم النسخ");
  } catch (e) {
    console.error(e);
    toast("النسخ ما نفعش — انسخ من الشاشة");
  }
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const download = (filename, text, type) => downloadBlob(filename, new Blob([text], { type }));

// BOM + CRLF so Excel opens the Arabic columns correctly
const csvText = (rows) => "﻿" + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");

const downloadCsv = (filename, rows) => download(filename, csvText(rows), "text/csv;charset=utf-8");

const downloadTxt = (filename, text) => download(filename, text, "text/plain;charset=utf-8");

function safeName(t) { return String(t).replace(/[\\/:*?"<>|]/g, "-").slice(0, 60); }

const shipmentRows = (s) => [
  ["الباركود", "اسم الصنف", "الوحدة", "الكمية"],
  ...s.items.map(i => [i.barcode, i.name || "", i.unit || "", i.qty]),
];

function downloadShipment(s) {
  downloadCsv(`${safeName(s.name)}.csv`, shipmentRows(s));
  toast("تم تحميل ملف Excel");
}

const sysCell = (i) => (Number.isFinite(i.sys) ? i.sys : "غير مسجّلة");
const diffCell = (i) => (Number.isFinite(i.sys) ? withSign((Number(i.qty) || 0) - i.sys) : "");

const countRows = (c) => [
  ["الباركود", "اسم الصنف", "الوحدة", "في النظام", "المعدود", "الفرق"],
  ...c.items.map(i => [i.barcode, i.name || "", i.unit || "", sysCell(i), i.qty, diffCell(i)]),
];

function downloadCount(c) {
  downloadCsv(`${safeName(c.name)}.csv`, countRows(c));
  toast("تم تحميل ملف Excel");
}

$("btn-export-counts").onclick = () => {
  if (!shownCounts.length) { toast("مفيش جرد يتحمّل"); return; }
  downloadCsv(`stocktake-${filter === ALL ? "all" : safeName(filter)}.csv`, [
    ["الفرع", "الجرد", "الموظف", "التاريخ", "الباركود", "اسم الصنف", "الوحدة", "في النظام", "المعدود", "الفرق"],
    ...shownCounts.flatMap(c => c.items.map(i =>
      [c.branch || "", c.name, c.createdBy, fmtDate(c.createdAt), i.barcode, i.name || "", i.unit || "", sysCell(i), i.qty, diffCell(i)])),
  ]);
  toast("تم تحميل ملف Excel");
};

// الجرد, same idea: a folder per day, one file per count
$("btn-zip-counts").onclick = () => {
  if (!shownCounts.length) { toast("مفيش جرد يتحمّل"); return; }
  const used = new Set();
  const files = shownCounts.map(c => ({
    path: `${uniquePath(used, `${dayOf(c.createdAt)}/${safeName(c.name)}`)}.csv`,
    text: csvText(countRows(c)),
  }));
  downloadBlob(`جرد-${today()}.zip`, zipBlob(files));
  toast(`تم تحميل ${shownCounts.length} جرد في مجلدات`);
};

// A folder per expiry DAY, like the shipments (the owner's call 2026-07-31). The day comes from
// the row's own date, never from when it was typed — that is the date the shelf has to be cleared.
$("btn-zip-expiry").onclick = () => {
  const rows = expInScope();
  if (!rows.length) { toast("مفيش صلاحيات تتحمّل"); return; }
  const byDay = new Map();
  for (const e of rows) {
    const day = ex.isoOf(e);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(e);
  }
  const used = new Set();
  const files = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, items]) => ({
    path: `${uniquePath(used, `${safeName(day)}/الصلاحيات`)}.csv`,
    text: csvText(expiryRows(items)),
  }));
  downloadBlob(`صلاحيات-${today()}.zip`, zipBlob(files));
  toast(`تم تحميل ${byDay.size} يوم في مجلدات`);
};

function downloadShipmentTxt(s) {
  downloadTxt(`${safeName(s.name)}.txt`, shipmentText(s));   // barcode TAB qty, same as the copy button
  toast("تم تحميل ملف TXT");
}

const exportName = (ext) => `shipments-${filter === ALL ? "all" : safeName(filter)}.${ext}`;

$("btn-export-all").onclick = () => {
  if (!shown.length) { toast("مفيش شحنات تتحمّل"); return; }
  downloadCsv(exportName("csv"), [
    ["الفرع", "نوع الشحنة", "كود المورد", "الشحنة", "الموظف", "التاريخ", "الباركود", "اسم الصنف", "الوحدة", "الكمية"],
    ...shown.flatMap(s => s.items.map(i =>
      [s.branch || "", s.type || "", s.supplierCode || "", s.name, s.createdBy, fmtDate(s.createdAt),
       i.barcode, i.name || "", i.unit || "", i.qty])),
  ]);
  toast("تم تحميل ملف Excel");
};

$("btn-export-all-txt").onclick = () => {
  if (!shown.length) { toast("مفيش شحنات تتحمّل"); return; }
  downloadTxt(exportName("txt"), shown.map(s => shipmentText(s)).join("\n"));
  toast("تم تحميل ملف TXT");
};

// The day a row was recorded, as YYYY-MM-DD so the folders sort themselves in any file manager
const dayOf = (ms) => new Date(ms).toLocaleDateString("en-CA");

// Two rows with the same name in the same folder would overwrite each other in the archive
const uniquePath = (used, base) => {
  let path = base;
  for (let n = 2; used.has(path); n++) path = `${base} (${n})`;
  used.add(path);
  return path;
};

const today = () => new Date().toLocaleDateString("en-CA");

// One archive: a folder per day, a folder per type inside it, both file shapes for each shipment
$("btn-export-zip").onclick = () => {
  if (!shown.length) { toast("مفيش شحنات تتحمّل"); return; }
  const used = new Set();
  const files = [];
  for (const s of shown) {
    // one folder per day, the shipments straight inside it (the owner's call 2026-07-31: the
    // extra type folder meant three clicks to reach one file). The type is still in the row.
    const path = uniquePath(used, `${dayOf(s.createdAt)}/${safeName(s.name)}`);
    files.push({ path: `${path}.csv`, text: csvText(shipmentRows(s)) });
    files.push({ path: `${path}.txt`, text: shipmentText(s) });
  }
  downloadBlob(`شحنات-${today()}.zip`, zipBlob(files));
  toast(`تم تحميل ${shown.length} شحنة في مجلدات`);
};

/* ---------- edit one shipment ---------- */

function openDetail(s, kind = "ship") {
  current = { ...s, kind, items: s.items.map(i => ({ ...i })) }; // edit a copy: back = discard
  const isCount = kind === "count";
  $("detail-name").value = s.name;
  $("detail-name-head").textContent = isCount ? "اسم الجرد" : "اسم الشحنة";
  $("detail-type-row").hidden = isCount;                  // a stocktake has no shipment type
  $("detail-meta").textContent = [s.branch || "بدون فرع", s.createdBy, fmtDate(s.createdAt),
    ...(s.supplierCode ? [`كود المورد ${s.supplierCode}`] : [])].join(" · ");
  $("btn-download-txt").hidden = isCount;                 // a TXT of a count says nothing about it
  $("detail-load").hidden = isCount || !canDo("download");   // a stocktake is never «تم تحميلها»
  paintLoaded();
  $("btn-delete-detail").textContent = isCount ? "حذف الجرد" : "حذف الشحنة";
  renderDetailType();
  renderDetailItems();
  history.pushState({ screen: "screen-detail" }, "");
  render("screen-detail");
  if (isCount) $("screen-title").textContent = "تعديل جرد";
}

function renderDetailType() {
  $("detail-type").innerHTML = window.APP_CONFIG.shipmentTypes.map(t =>
    `<button type="button" data-detailtype="${esc(t)}" aria-pressed="${t === current.type}">${esc(t)}</button>`).join("");
}

$("detail-type").onclick = (e) => {
  const btn = e.target.closest("button[data-detailtype]");
  if (!btn) return;
  current.type = btn.dataset.detailtype;
  renderDetailType();
};

const noteText = (i) => (Number.isFinite(i.sys)
  ? `في النظام ${i.sys} · ${diffWord((Number(i.qty) || 0) - i.sys)}`
  : "مش مسجّل في النظام");

function renderDetailItems() {
  const isCount = current.kind === "count";
  $("detail-items").innerHTML = current.items.map((i, idx) => `<tr>
      <td><div>${esc(i.name || "بدون اسم")}</div>
        <div class="meta"><span class="code">${esc(i.barcode)}</span>${i.unit ? ` · ${esc(i.unit)}` : ""}</div>
        ${isCount ? `<div class="meta" data-note="${idx}">${esc(noteText(i))}</div>` : ""}</td>
      <td><input class="qty-cell" type="number" min="1" dir="ltr" data-qty="${idx}" value="${Number(i.qty) || 1}" ${canDo("edit") ? "" : "readonly"}></td>
      <td>${canDo("edit") ? `<button class="del" data-delitem="${idx}" aria-label="حذف الصنف">×</button>` : ""}</td>
    </tr>`).join("") || `<tr><td>مفيش أصناف</td></tr>`;
}

$("detail-items").oninput = (e) => {
  const inp = e.target.closest("input[data-qty]");
  if (!inp) return;
  const item = current.items[+inp.dataset.qty];
  item.qty = Math.max(1, parseInt(inp.value, 10) || 1);
  // repaint just this row's note: a full re-render would drop the focus mid-typing
  const note = inp.closest("tr").querySelector("[data-note]");
  if (note) note.textContent = noteText(item);
};

$("detail-items").onclick = (e) => {
  const btn = e.target.closest("button[data-delitem]");
  if (!btn) return;
  current.items.splice(+btn.dataset.delitem, 1);
  renderDetailItems();
};

/* ---------- «تم تحميلها»: who took this shipment into the shop's system, and when ---------- */

const loadedNote = (s) => (s.loadedAt
  ? `تم تحميلها — ${s.loadedBy || "؟"} · ${fmtWhen(s.loadedAt)}` : "");

function paintLoaded() {
  const done = !!current.loadedAt;
  $("detail-loaded").hidden = current.kind === "count" || !done;
  $("detail-loaded").textContent = loadedNote(current);
  $("btn-loaded").textContent = done ? "تحميل تاني" : "تم التحميل";
  $("btn-loaded").classList.toggle("primary", !done);
}

/* The one place a shipment becomes loaded. Downloading the file IS taking the shipment into the
   shop's system, so the exports mark it too; the button covers the times no file was needed.
   Returns false only when the person backed out of a second load — the caller then does nothing. */
async function markLoaded(force) {
  if (current.kind === "count") return true;
  // the same person taking Excel and then TXT is one loading, two files — only somebody else
  // (or an explicit tap on «تحميل تاني») is a second load worth warning about and logging
  if (current.loadedAt && current.loadedBy === identity && !force) return true;
  const again = !!current.loadedAt;
  if (again && !confirm(`«${current.name}» ${loadedNote(current)}.\nتحمّلها تاني؟`)) return false;
  const at = Date.now();
  try {
    await db.markLoaded(current._id, identity, at);
  } catch (err) {
    console.error(err);
    toast("ما اتسجلش إن الشحنة اتحمّلت");
    return true;                       // the file itself is not worth blocking over
  }
  current.loadedBy = identity;
  current.loadedAt = at;
  const row = all.find(s => s._id === current._id);
  if (row) { row.loadedBy = identity; row.loadedAt = at; }   // the list is the same objects
  db.logAction(identity, again ? "إعادة تحميل شحنة" : "تحميل شحنة",
    `${current.name} · ${current.branch || ""}`);
  paintLoaded();
  if (again) toast("اتسجل تحميل تاني للشحنة");
  return true;
}

$("btn-loaded").onclick = () => markLoaded(true);   // the button always means "load it now"

$("btn-copy").onclick = async () => { if (await markLoaded()) copyShipment(current); };
const detailShipment = () => ({ ...current, name: $("detail-name").value.trim() || current.name });
$("btn-download").onclick = async () => {
  if (current.kind === "count") return downloadCount(detailShipment());
  if (await markLoaded()) downloadShipment(detailShipment());
};
$("btn-download-txt").onclick = async () => {
  if (await markLoaded()) downloadShipmentTxt(detailShipment());
};

// deleting from the card screen, not from the list: the row you are about to lose is on screen
$("btn-delete-detail").onclick = async () => {
  const isCount = current.kind === "count";
  if (!confirm(`حذف «${current.name}»؟ مش هينفع ترجّع${isCount ? "ه" : "ها"}.`)) return;
  try {
    if (isCount) await db.deleteCount(current._id);
    else await db.deleteShipment(current._id);
    db.logAction(identity, isCount ? "حذف جرد" : "حذف شحنة", `${current.name} · ${current.branch || ""}`);
    toast("تم الحذف");
  } catch (err) {
    console.error(err);
    toast("الحذف ما نفعش — جرّب تاني");
    return;
  }
  // the detail screen is gone with the row, so it must not stay behind the back button
  history.replaceState({ screen: "screen-manager" }, "");
  await openManager();
};

$("btn-save-edit").onclick = async () => {
  const name = $("detail-name").value.trim();
  const isCount = current.kind === "count";
  if (!name) { toast(isCount ? "اكتب اسم الجرد" : "اكتب اسم الشحنة"); return; }
  try {
    if (isCount) {
      await db.updateCount(current._id, { name, items: current.items });
      db.logAction(identity, "تعديل جرد", `${name} · ${current.items.length} صنف`);
    } else {
      // the code follows the name: renaming a shipment to another supplier must not keep the old code
      await db.updateShipment(current._id, {
        name, items: current.items, type: current.type,
        supplierCode: db.supplierCodeOf(window.APP_CONFIG, name),
      });
      db.logAction(identity, "تعديل شحنة", `${name} · ${current.items.length} صنف`);
    }
    toast("تم حفظ التعديلات");
    history.replaceState({ screen: "screen-manager" }, "");
    openManager();
  } catch (err) {
    console.error(err);
    toast("الحفظ ما نفعش — جرّب تاني");
  }
};

/* ---------- catalog: view, search, rename, delete, export ---------- */

let products = [];              // rows on screen: first page, or the search hits
let total = 0;                  // real catalog size, counted on the server
const edits = new Map();        // barcode -> new name, pending save

$("btn-products").onclick = async () => {
  history.pushState({ screen: "screen-products" }, "");
  render("screen-products");
  await loadProducts();
};

async function loadProducts() {
  edits.clear();
  $("products-count").textContent = "بنجيب الأصناف...";
  products = (await db.listProducts().catch(() => []))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  total = products.length;
  renderProducts();
  if (products.length >= db.PRODUCT_CAP) {        // only then is the loaded count not the truth
    total = await db.countProducts().catch(() => products.length);
    renderProducts();
  }
}

// every branch that has a number for this product, plus the older shop-wide sheet
function stockLine(p) {
  const parts = myBranches()
    .filter(b => Number.isFinite(p.stock[b]))
    .map(b => `${shortBranch(b)} ${p.stock[b]}`);
  if (!parts.length && Number.isFinite(p.qty)) parts.push(`كل الفروع ${p.qty}`);
  return parts.length ? ` · في النظام: ${esc(parts.join(" · "))}` : "";
}

// the printing screen lives in the employee app; the link keeps ?test=1 and names the product,
// and it only shows for someone who may open that screen at all
const canLabel = () => canDo("label") && (!auth.session() || auth.session().perms.includes("emp"));
const labelHref = (barcode) => `${auth.withQuery("index.html")}#label=${encodeURIComponent(barcode)}`;

function renderProducts() {
  const found = products;
  const page = found.slice(0, PAGE);
  const searching = $("product-search").value.trim() !== "";
  $("products-count").textContent = searching
    ? `${found.length} نتيجة` + (found.length > PAGE ? ` — بيظهر أول ${PAGE}` : "")
    : (total ? `${total} صنف` + (total > products.length ? ` — بيظهر أول ${products.length}، دوّر عن الباقي` : "") : "");
  $("products-list").innerHTML = page.map(p => `<li>
      <div class="card-main">
        <input class="product-name" type="text" maxlength="100" data-barcode="${escAttr(p.barcode)}" value="${escAttr(edits.get(p.barcode) ?? p.name)}">
        <div class="meta"><span class="code">${esc(p.barcode)}</span>${p.unit ? ` · ${esc(p.unit)}` : ""}${stockLine(p)}</div>
      </div>
      ${canLabel() ? `<a class="lbl-link" href="${escAttr(labelHref(p.barcode))}">ليبل</a>` : ""}
      <button class="del" data-delproduct="${escAttr(p.barcode)}" aria-label="حذف الصنف">×</button>
    </li>`).join("") || `<li class="empty">${searching ? "مفيش نتيجة — جرّب أي جزء من الاسم أو الباركود" : "مفيش أصناف — استورد ملف الأصناف الأول"}</li>`;
  updateDirty();
}

function updateDirty() {
  $("products-dirty").textContent = edits.size ? `${edits.size} تعديل` : "";
  $("btn-save-products").disabled = edits.size === 0;
}

let searchTimer = null;

$("product-search").oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 250);       // one query per pause, not per keystroke
};

async function runSearch() {
  const q = $("product-search").value.trim();
  if (!q) { await loadProducts(); return; }
  const hits = await db.searchProducts(q).catch(() => []);
  if ($("product-search").value.trim() !== q) return;   // a newer search already ran
  products = hits.sort((a, b) => a.name.localeCompare(b.name, "ar"));
  edits.clear();
  renderProducts();
}

$("products-list").oninput = (e) => {
  const inp = e.target.closest("input[data-barcode]");
  if (!inp) return;
  const p = products.find(x => x.barcode === inp.dataset.barcode);
  const val = inp.value.trim();
  if (val && val !== p.name) edits.set(p.barcode, val); else edits.delete(p.barcode);
  updateDirty();
};

$("products-list").onclick = async (e) => {
  const btn = e.target.closest("button[data-delproduct]");
  if (!btn) return;
  const barcode = btn.dataset.delproduct;
  const p = products.find(x => x.barcode === barcode);
  if (!confirm(`حذف «${p.name}» من ملف الأصناف؟`)) return;
  try {
    await db.deleteProduct(barcode);
    db.logAction(identity, "حذف صنف", `${barcode} — ${p.name}`);
    products = products.filter(x => x.barcode !== barcode);
    edits.delete(barcode);
    renderProducts();
    toast("تم حذف الصنف");
  } catch (err) {
    console.error(err);
    toast("الحذف ما نفعش — جرّب تاني");
  }
};

$("btn-save-products").onclick = async () => {
  const pending = [...edits];
  let n = 0;
  try {
    for (const [barcode, name] of pending) {
      await db.saveProductName(barcode, name);
      const p = products.find(x => x.barcode === barcode);
      if (p) p.name = name;
      edits.delete(barcode);
      n++;
    }
    if (n) db.logAction(identity, "تعديل أسماء أصناف", `${n} صنف`);
    toast(`تم حفظ ${n} اسم`);
  } catch (err) {
    console.error(err);
    toast(`اتحفظ ${n} اسم وبعدين حصلت مشكلة — جرّب تاني`);
  }
  renderProducts();
};

$("btn-export-products").onclick = async () => {
  toast("بنجهّز الملف...");
  const rows = await db.listAllProducts().catch(() => []);   // whole catalog, not the page on screen
  if (!rows.length) { toast("مفيش أصناف تتحمّل"); return; }
  // the file that comes out is the file that goes back in: same three columns, one branch
  downloadCsv(`أصناف-${safeName(stockBranch || "الكل")}.csv`, [
    ["الباركود", "اسم الصنف", `الكمية في ${stockBranch || "النظام"}`],
    ...rows.map(p => [p.barcode, p.name, db.stockFor(p, stockBranch) ?? ""]),
  ]);
  toast(`تم تحميل ${rows.length} صنف`);
};

/* ---------- catalog import ---------- */


// The catalog sheet is باركود، اسم الصنف، الوحدة. The name still swallows the middle cells, so
// a name with a comma survives the naive split; the unit is the last cell, and a numeric one is
// ignored so a stocktake sheet imported by mistake cannot turn a quantity into a unit.
const unitOf = (c) => {
  if (c.length < 3) return "";
  const last = cell(c[c.length - 1]);
  return /^[\d.,]+$/.test(last) ? "" : last;
};
const nameOf = (c) => (unitOf(c) ? c.slice(1, -1) : c.slice(1)).map(cell).join(" ").trim();

// A row, whichever shape the sheet came in: the header decides, and without one the old
// positional rules (barcode first, unit last) still hold.
const productRow = (c, map) => (map
  ? {
    barcode: cell(c[map.barcode]),
    name: cell(c[map.name]),
    unit: unitName(map.unit !== undefined ? c[map.unit] : ""),
    unitCode: map.unit !== undefined ? unitCode(c[map.unit]) : null,
    price: map.price !== undefined ? Number(cell(c[map.price])) : NaN,
    factor: map.factor !== undefined ? Number(cell(c[map.factor])) : NaN,
  }
  : { barcode: cell(c[0]), name: nameOf(c), unit: unitOf(c), unitCode: null, price: NaN, factor: NaN });

$("btn-import").onclick = () => $("import-file").click();
$("import-file").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  let all, map;
  try {
    all = await sheetRows(file);
    map = requireColumns(all, ["barcode", "name"]);
  } catch (err) { toast(err.message); e.target.value = ""; return; }
  const usable = (map ? all.slice(1) : all)
    .map(c => productRow(c, map))
    .filter(r => r.barcode && /\d/.test(r.barcode) && r.name);
  // a unit code the table does not know is a bad row: it is refused, and the person is told which
  const bad = usable.filter(r => r.unit === null);
  const rows = usable.filter(r => r.unit !== null);
  let n = 0;
  try {
    for (const r of rows) { await db.saveProductName(r.barcode, r.name, r); n++; }
    db.logAction(identity, "استيراد أصناف", `${n} صنف${bad.length ? ` · ${bad.length} مرفوض` : ""}`);
    toast(bad.length
      ? `تم استيراد ${n} صنف · اترفض ${bad.length} لكود وحدة مش معروف (${bad.slice(0, 3).map(r => r.barcode).join("، ")})`
      : `تم استيراد ${n} صنف`);
  } catch (err) {
    console.error(err);
    toast(`اتسجل ${n} صنف وبعدين حصلت مشكلة — جرّب تاني`);
  }
  e.target.value = "";
};

/* ---------- stocktake sheet: barcode, name, system quantity ---------- */

$("btn-import-stock").onclick = () => $("stock-file").click();
$("stock-file").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  // With a header row the columns can be in any order (theirs is الرصيد first); without one the
  // quantity is the last column, so a name with a comma in it still lands whole.
  let all, map;
  try {
    all = await sheetRows(file);
    map = requireColumns(all, ["qty", "barcode", "name"]);
  } catch (err) { toast(err.message); e.target.value = ""; return; }
  const rows = (map ? all.slice(1) : all)
    .map(c => (map
      ? { barcode: cell(c[map.barcode]), name: cell(c[map.name]),
          qty: parseInt(cell(map.qty !== undefined ? c[map.qty] : ""), 10),
          // the ERP's stock export carries the unit too; writeProduct merges, so it is safe to
          // carry across — but only when the column is there, or a stock file would blank it
          unit: unitName(map.unit !== undefined ? c[map.unit] : "") || "",
          unitCode: map.unit !== undefined ? unitCode(c[map.unit]) : null }
      : { barcode: cell(c[0]), name: c.slice(1, -1).map(cell).join(" ").trim(),
          qty: parseInt(cell(c[c.length - 1]), 10), unit: "", unitCode: null }))
    .filter(r => r.barcode && /\d/.test(r.barcode) && r.name && Number.isFinite(r.qty) && r.qty >= 0);
  if (!rows.length) { toast("الملف مفيهوش صفوف صالحة — لازم: باركود، اسم، كمية"); e.target.value = ""; return; }
  if (!stockBranch) { toast("اختار الفرع الأول"); e.target.value = ""; return; }
  const branch = stockBranch;                    // a chip tapped mid-import must not move the rows
  let n = 0;
  try {
    for (const r of rows) { await db.saveProductRow(r.barcode, r.name, r.qty, branch, r); n++; }
    db.logAction(identity, "استيراد كميات الجرد", `${n} صنف · ${branch}`);
    toast(`تم استيراد كميات ${n} صنف لـ${branch}`);
  } catch (err) {
    console.error(err);
    toast(`اتسجل ${n} صنف وبعدين حصلت مشكلة — جرّب تاني`);
  }
  e.target.value = "";
};

/* ---------- keyboard: Enter does the obvious thing for the focused field ---------- */

const ENTER = { "pin-input": "btn-pin", "detail-name": "btn-save-edit" };

addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const btn = ENTER[e.target.id];
  if (!btn) return;
  e.preventDefault();
  e.target.blur();          // closes the phone keyboard before the screen changes
  $(btn).click();
});

/* ---------- boot ---------- */

function updateSync() {
  $("sync-state").textContent = navigator.onLine ? "متصل" : "مستني الاتصال";
  $("sync-state").classList.toggle("off", !navigator.onLine);
}
addEventListener("online", updateSync);
addEventListener("offline", updateSync);
updateSync();

history.replaceState({ screen: "screen-pin" }, "");
render("screen-pin");

if ("serviceWorker" in navigator && !new URLSearchParams(location.search).has("test")) {
  navigator.serviceWorker.register("./sw.js");
}

// PIN screen paints straight away; the PIN check waits for this instead
cfgReady = (async () => {
  await db.initDb().catch(console.error);
  Object.assign(window.APP_CONFIG, await db.getConfig().catch(() => ({})));
  const s = auth.session();
  if (!s) return;
  if (s.perms.includes("mgr")) { enterManager(); return; }   // already signed in on another page
  const page = auth.landingPage(s.perms);
  if (page && page !== "manager.html") auth.goTo(page);
})();
