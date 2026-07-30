import * as db from "./db.js";

const $ = (id) => document.getElementById(id);
const esc = (t) => { const d = document.createElement("div"); d.textContent = t; return d.innerHTML; };
const fmtDate = (ts) => new Date(ts).toLocaleDateString("ar-EG");
const ALL = "الكل";

function toast(msg) {
  $("toast").textContent = msg;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2200);
}

const TITLES = { "screen-pin": "شاشة المدير", "screen-manager": "الشحنات", "screen-detail": "تعديل شحنة" };

let all = [];        // everything read from the database
let shown = [];      // after the branch filter — row indexes point here
let filter = ALL;
let current = null;  // the shipment being edited (a copy)

/* ---------- navigation ---------- */

function render(id) {
  document.querySelectorAll("main > section").forEach(s => s.hidden = true);
  $(id).hidden = false;
  $("screen-title").textContent = TITLES[id] || "شاشة المدير";
  $("btn-back").hidden = id !== "screen-detail";
  scrollTo(0, 0);
}

addEventListener("popstate", (ev) => {
  const id = (ev.state && ev.state.screen) || "screen-manager";
  if (id === "screen-detail") render(id); else openManager();
});

$("btn-back").onclick = () => history.back();

/* ---------- unlock ---------- */

$("btn-pin").onclick = () => {
  if ($("pin-input").value !== window.APP_CONFIG.managerPin) { toast("الرقم السري غلط"); return; }
  history.replaceState({ screen: "screen-manager" }, "");
  openManager();
};

/* ---------- shipment list ---------- */

const shortBranch = (b) => b.replace(/^فرع\s+/, ""); // chips stay one line; stored value keeps "فرع"

function renderFilter() {
  $("branch-filter").innerHTML = [ALL, ...window.APP_CONFIG.branches].map(b =>
    `<button type="button" data-branch="${esc(b)}" aria-pressed="${b === filter}">${esc(shortBranch(b))}</button>`).join("");
}

$("branch-filter").onclick = (e) => {
  const btn = e.target.closest("button[data-branch]");
  if (!btn) return;
  filter = btn.dataset.branch;
  renderFilter();
  renderList();
};

async function openManager() {
  render("screen-manager");
  all = await db.listShipments().catch(() => []);
  renderFilter();
  renderList();
}

function renderList() {
  shown = filter === ALL ? all : all.filter(s => s.branch === filter);
  $("all-shipments").innerHTML = shown.map((s, i) => `<li>
      <div class="card-main">
        <div class="card-title">${esc(s.name)}</div>
        <div class="meta">${esc(s.branch || "بدون فرع")} · ${esc(s.createdBy)} · ${fmtDate(s.createdAt)} · ${s.items.length} صنف</div>
      </div>
      <div class="row-actions">
        <button data-act="view" data-i="${i}">عرض</button>
        <button data-act="copy" data-i="${i}">نسخ</button>
        <button data-act="download" data-i="${i}">تحميل</button>
        <button data-act="del" data-i="${i}" class="danger">حذف</button>
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
  else if (btn.dataset.act === "del") {
    if (!confirm(`حذف «${s.name}»؟ مش هينفع ترجّعها.`)) return;
    try {
      await db.deleteShipment(s._id);
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

// BOM + CRLF so Excel opens the Arabic columns correctly
function downloadCsv(filename, rows) {
  const csv = "﻿" + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function safeName(t) { return String(t).replace(/[\\/:*?"<>|]/g, "-").slice(0, 60); }

function downloadShipment(s) {
  downloadCsv(`${safeName(s.name)}.csv`, [
    ["الباركود", "اسم الصنف", "الكمية"],
    ...s.items.map(i => [i.barcode, i.name || "", i.qty]),
  ]);
  toast("تم تحميل الملف");
}

$("btn-export-all").onclick = () => {
  if (!shown.length) { toast("مفيش شحنات تتحمّل"); return; }
  downloadCsv(`shipments-${filter === ALL ? "all" : safeName(filter)}.csv`, [
    ["الفرع", "الشحنة", "الموظف", "التاريخ", "الباركود", "اسم الصنف", "الكمية"],
    ...shown.flatMap(s => s.items.map(i =>
      [s.branch || "", s.name, s.createdBy, fmtDate(s.createdAt), i.barcode, i.name || "", i.qty])),
  ]);
  toast("تم تحميل الملف");
};

/* ---------- edit one shipment ---------- */

function openDetail(s) {
  current = { ...s, items: s.items.map(i => ({ ...i })) }; // edit a copy: back = discard
  $("detail-name").value = s.name;
  $("detail-meta").textContent = `${s.branch || "بدون فرع"} · ${s.createdBy} · ${fmtDate(s.createdAt)}`;
  renderDetailItems();
  history.pushState({ screen: "screen-detail" }, "");
  render("screen-detail");
}

function renderDetailItems() {
  $("detail-items").innerHTML = current.items.map((i, idx) => `<tr>
      <td><div>${esc(i.name || "بدون اسم")}</div><div class="code">${esc(i.barcode)}</div></td>
      <td><input class="qty-cell" type="number" min="1" dir="ltr" data-qty="${idx}" value="${Number(i.qty) || 1}"></td>
      <td><button class="del" data-delitem="${idx}" aria-label="حذف الصنف">×</button></td>
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
$("btn-download").onclick = () => downloadShipment({ ...current, name: $("detail-name").value.trim() || current.name });

$("btn-save-edit").onclick = async () => {
  const name = $("detail-name").value.trim();
  if (!name) { toast("اكتب اسم الشحنة"); return; }
  try {
    await db.updateShipment(current._id, { name, items: current.items });
    toast("تم حفظ التعديلات");
    history.replaceState({ screen: "screen-manager" }, "");
    openManager();
  } catch (err) {
    console.error(err);
    toast("الحفظ ما نفعش — جرّب تاني");
  }
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
    toast(`تم استيراد ${n} صنف`);
  } catch (err) {
    console.error(err);
    toast(`اتسجل ${n} صنف وبعدين حصلت مشكلة — جرّب تاني`);
  }
  e.target.value = "";
};

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

db.initDb().catch(console.error);
