import * as db from "./db.js";
import * as auth from "./auth.js";
import { zipBlob } from "./zip.js";

const $ = (id) => document.getElementById(id);
const esc = (t) => { const d = document.createElement("div"); d.textContent = t; return d.innerHTML; };
// attribute context needs the quotes escaped too — catalog text is publicly writable
const escAttr = (t) => esc(t).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const fmtDate = (ts) => new Date(ts).toLocaleDateString("ar-EG");
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
};
const DEEP = ["screen-detail", "screen-products"];   // screens you can go back from
const PAGE = 50;                                     // rows rendered at once; search narrows the rest

let all = [];        // everything read from the database
let shown = [];      // after the branch filter — row indexes point here
let filter = ALL;
let typeFilter = ALL;
let scopes = [];     // branches this user may see; empty = every branch
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
  applyPerms();
  history.replaceState({ screen: "screen-manager" }, "");
  openManager();
}

// no session = the old single-PIN manager, where everything was allowed
const canDo = (perm) => !auth.session() || auth.can(perm);

function applyPerms() {
  $("tool-import").hidden = !canDo("import");
  $("tool-export").hidden = !canDo("download");
  $("tool-admin").hidden = !canDo("adm");
  $("btn-save-edit").hidden = !canDo("edit");
  $("detail-exports").hidden = !canDo("download");
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

function renderFilter() {
  // a branch manager sees their branch as a locked chip, not a filter
  const mine = scopes.length ? scopes : window.APP_CONFIG.branches.map(b => b.name);
  const opts = scopes.length === 1 ? scopes : [ALL, ...mine];
  const locked = scopes.length === 1;
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

async function openManager() {
  render("screen-manager");
  if (scopes.length === 1) $("screen-title").textContent = shortBranch(scopes[0]);
  all = await db.listShipments().catch(() => []);
  if (scopes.length) all = all.filter(s => scopes.includes(s.branch));   // never load another branch
  renderFilter();
  renderTypeFilter();
  renderList();
}

function renderList() {
  shown = all.filter(s => (filter === ALL || s.branch === filter)
    && (typeFilter === ALL || s.type === typeFilter));
  $("all-shipments").innerHTML = shown.map((s, i) => `<li>
      <div class="card-main">
        <div class="card-title">${esc(s.name)}</div>
        <div class="meta">${esc(s.type || "بدون نوع")} · ${esc(s.branch || "بدون فرع")} · ${esc(s.createdBy)} · ${fmtDate(s.createdAt)} · ${s.items.length} صنف</div>
      </div>
      <div class="row-actions">
        <button data-act="view" data-i="${i}">عرض</button>
        ${canDo("download") ? `<button data-act="copy" data-i="${i}">نسخ</button>
        <button data-act="download" data-i="${i}">Excel</button>
        <button data-act="txt" data-i="${i}">TXT</button>` : ""}
        ${canDo("del") ? `<button data-act="del" data-i="${i}" class="danger">حذف</button>` : ""}
      </div>
    </li>`).join("") || `<li class="empty">مفيش شحنات في الفرع ده</li>`;
}

$("all-shipments").onclick = async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const s = shown[+btn.dataset.i];
  if (btn.dataset.act === "view") openDetail(s);
  else if (btn.dataset.act === "copy") copyShipment(s);
  else if (btn.dataset.act === "download") downloadShipment(s);
  else if (btn.dataset.act === "txt") downloadShipmentTxt(s);
  else if (btn.dataset.act === "del") {
    if (!confirm(`حذف «${s.name}»؟ مش هينفع ترجّعها.`)) return;
    try {
      await db.deleteShipment(s._id);
      db.logAction(identity, "حذف شحنة", `${s.name} · ${s.branch || ""}`);
      toast("تم الحذف");
    } catch (err) {
      console.error(err);
      toast("الحذف ما نفعش — جرّب تاني");
    }
    openManager();
  }
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
  ["الباركود", "اسم الصنف", "الكمية"],
  ...s.items.map(i => [i.barcode, i.name || "", i.qty]),
];

function downloadShipment(s) {
  downloadCsv(`${safeName(s.name)}.csv`, shipmentRows(s));
  toast("تم تحميل ملف Excel");
}

function downloadShipmentTxt(s) {
  downloadTxt(`${safeName(s.name)}.txt`, shipmentText(s));   // barcode TAB qty, same as the copy button
  toast("تم تحميل ملف TXT");
}

const exportName = (ext) => `shipments-${filter === ALL ? "all" : safeName(filter)}.${ext}`;

$("btn-export-all").onclick = () => {
  if (!shown.length) { toast("مفيش شحنات تتحمّل"); return; }
  downloadCsv(exportName("csv"), [
    ["الفرع", "نوع الشحنة", "الشحنة", "الموظف", "التاريخ", "الباركود", "اسم الصنف", "الكمية"],
    ...shown.flatMap(s => s.items.map(i =>
      [s.branch || "", s.type || "", s.name, s.createdBy, fmtDate(s.createdAt), i.barcode, i.name || "", i.qty])),
  ]);
  toast("تم تحميل ملف Excel");
};

$("btn-export-all-txt").onclick = () => {
  if (!shown.length) { toast("مفيش شحنات تتحمّل"); return; }
  downloadTxt(exportName("txt"), shown.map(s => shipmentText(s)).join("\n"));
  toast("تم تحميل ملف TXT");
};

// One archive, a folder per shipment type, both file shapes inside. Two shipments with
// the same name in the same type folder would overwrite each other, so the second gets (2).
$("btn-export-zip").onclick = () => {
  if (!shown.length) { toast("مفيش شحنات تتحمّل"); return; }
  const used = new Set();
  const files = [];
  for (const s of shown) {
    const base = `${safeName(s.type || "بدون نوع")}/${safeName(s.name)}`;
    let path = base;
    for (let n = 2; used.has(path); n++) path = `${base} (${n})`;
    used.add(path);
    files.push({ path: `${path}.csv`, text: csvText(shipmentRows(s)) });
    files.push({ path: `${path}.txt`, text: shipmentText(s) });
  }
  downloadBlob(`شحنات-${new Date().toLocaleDateString("en-CA")}.zip`, zipBlob(files));
  toast(`تم تحميل ${shown.length} شحنة في مجلدات`);
};

/* ---------- edit one shipment ---------- */

function openDetail(s) {
  current = { ...s, items: s.items.map(i => ({ ...i })) }; // edit a copy: back = discard
  $("detail-name").value = s.name;
  $("detail-meta").textContent = `${s.branch || "بدون فرع"} · ${s.createdBy} · ${fmtDate(s.createdAt)}`;
  renderDetailType();
  renderDetailItems();
  history.pushState({ screen: "screen-detail" }, "");
  render("screen-detail");
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

function renderDetailItems() {
  $("detail-items").innerHTML = current.items.map((i, idx) => `<tr>
      <td><div>${esc(i.name || "بدون اسم")}</div><div class="code">${esc(i.barcode)}</div></td>
      <td><input class="qty-cell" type="number" min="1" dir="ltr" data-qty="${idx}" value="${Number(i.qty) || 1}" ${canDo("edit") ? "" : "readonly"}></td>
      <td>${canDo("edit") ? `<button class="del" data-delitem="${idx}" aria-label="حذف الصنف">×</button>` : ""}</td>
    </tr>`).join("") || `<tr><td>مفيش أصناف</td></tr>`;
}

$("detail-items").oninput = (e) => {
  const inp = e.target.closest("input[data-qty]");
  if (inp) current.items[+inp.dataset.qty].qty = Math.max(1, parseInt(inp.value, 10) || 1);
};

$("detail-items").onclick = (e) => {
  const btn = e.target.closest("button[data-delitem]");
  if (!btn) return;
  current.items.splice(+btn.dataset.delitem, 1);
  renderDetailItems();
};

$("btn-copy").onclick = () => copyShipment(current);
const detailShipment = () => ({ ...current, name: $("detail-name").value.trim() || current.name });
$("btn-download").onclick = () => downloadShipment(detailShipment());
$("btn-download-txt").onclick = () => downloadShipmentTxt(detailShipment());

$("btn-save-edit").onclick = async () => {
  const name = $("detail-name").value.trim();
  if (!name) { toast("اكتب اسم الشحنة"); return; }
  try {
    await db.updateShipment(current._id, { name, items: current.items, type: current.type });
    db.logAction(identity, "تعديل شحنة", `${name} · ${current.items.length} صنف`);
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
        <div class="code">${esc(p.barcode)}</div>
      </div>
      <button class="del" data-delproduct="${escAttr(p.barcode)}" aria-label="حذف الصنف">×</button>
    </li>`).join("") || `<li class="empty">${searching ? "مفيش نتيجة — دوّر بأول الاسم أو بالباركود" : "مفيش أصناف — استورد ملف الأصناف الأول"}</li>`;
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
  downloadCsv("products.csv", [
    ["الباركود", "اسم الصنف"],
    ...rows.map(p => [p.barcode, p.name]),
  ]);
  toast(`تم تحميل ${rows.length} صنف`);
};

/* ---------- catalog import ---------- */

$("btn-import").onclick = () => $("import-file").click();
$("import-file").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const buf = await file.arrayBuffer();
  let text = new TextDecoder("utf-8").decode(buf);
  // Excel on Arabic Windows exports windows-1256; UTF-8 decode of that yields replacement chars
  if (text.includes("�")) text = new TextDecoder("windows-1256").decode(buf);
  const rows = text.split(/\r?\n/).map(l => l.split(/[,;\t]/))
    .filter(c => c.length >= 2 && /\d/.test(c[0]) && c[1].trim());
  let n = 0;
  try {
    for (const c of rows) { await db.saveProductName(c[0].trim().replace(/^﻿/, ""), c.slice(1).join(" ").trim()); n++; }
    db.logAction(identity, "استيراد أصناف", `${n} صنف`);
    toast(`تم استيراد ${n} صنف`);
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
