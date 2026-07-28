import * as db from "./db.js";

const $ = (id) => document.getElementById(id);

function show(id) {
  document.querySelectorAll("main > section").forEach(s => s.hidden = true);
  $(id).hidden = false;
}

function esc(t) { const d = document.createElement("div"); d.textContent = t; return d.innerHTML; }

function myName() { return localStorage.getItem("employeeName"); }

function toast(msg) {
  $("toast").textContent = msg;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2000);
}

const state = { items: [], currentBarcode: null, currentShipmentList: [] };

async function goHome() {
  show("screen-home");
  const all = await db.listShipments().catch(() => []);
  const mine = all.filter(s => s.createdBy === myName());
  $("my-shipments").innerHTML = mine.map(s =>
    `<li>${esc(s.name)} — ${s.items.length} صنف</li>`).join("") || "<li>لا توجد شحنات</li>";
}

$("save-name").onclick = () => {
  const n = $("employee-name").value.trim();
  if (!n) return;
  localStorage.setItem("employeeName", n);
  goHome();
};

function saveDraft() {
  localStorage.setItem("draft", JSON.stringify({ name: $("shipment-name").value, items: state.items }));
}

$("btn-new").onclick = () => {
  const draft = JSON.parse(localStorage.getItem("draft") || "null");
  state.items = (draft && draft.items) || [];
  state.currentBarcode = null;
  $("shipment-name").value = (draft && draft.name) || "";
  $("barcode-input").value = "";
  $("item-form").hidden = true;
  renderItems();
  show("screen-new");
  if (state.items.length) toast("رجّعنالك الشحنة اللي كانت مفتوحة");
};

$("shipment-name").oninput = saveDraft;

$("btn-lookup").onclick = () => {
  const code = $("barcode-input").value.trim();
  if (code) onBarcode(code).catch(() => toast("حصلت مشكلة — جرّب تاني"));
};

async function onBarcode(code) {
  state.currentBarcode = code;
  $("item-barcode").textContent = code;
  const known = await db.getProductName(code);
  $("item-name").value = known || "";
  $("item-qty").value = 1;
  $("item-form").hidden = false;
  if (!known) $("item-name").focus();
}

$("qty-plus").onclick = () => { $("item-qty").value = +$("item-qty").value + 1; };
$("qty-minus").onclick = () => { $("item-qty").value = Math.max(1, +$("item-qty").value - 1); };

$("btn-add-item").onclick = async () => {
  const name = $("item-name").value.trim();
  const qty = Math.max(1, parseInt($("item-qty").value, 10) || 1);
  if (!name || !state.currentBarcode) { toast("اكتب اسم الصنف"); return; }
  const existing = await db.getProductName(state.currentBarcode);
  if (existing !== name) await db.saveProductName(state.currentBarcode, name);
  const dup = state.items.find(i => i.barcode === state.currentBarcode);
  if (dup) dup.qty += qty; else state.items.push({ barcode: state.currentBarcode, name, qty });
  $("item-form").hidden = true;
  $("barcode-input").value = "";
  renderItems();
};

function renderItems() {
  $("items-list").innerHTML = state.items.map(i => `<li>${esc(i.name)} × ${i.qty}</li>`).join("");
  $("btn-save-shipment").disabled = state.items.length === 0;
  saveDraft();
}

$("btn-save-shipment").onclick = async () => {
  const name = $("shipment-name").value.trim();
  if (!name) { toast("اكتب اسم الشحنة الأول"); return; }
  try {
    await db.saveShipment({ name, createdBy: myName(), items: state.items });
  } catch (e) {
    console.error(e);
    toast("الحفظ ما نفعش — حاول تاني");
    return;
  }
  localStorage.removeItem("draft");
  toast("تم حفظ الشحنة");
  goHome();
};

document.querySelectorAll(".btn-back").forEach(b => b.onclick = async () => { await stopScan(); goHome(); });

addEventListener("db-error", () => toast("مشكلة في مزامنة البيانات — اتأكد من الاتصال والإعدادات"));

let dbBroken = false;

(async () => {
  const ok = await db.initDb().then(() => true).catch((e) => { console.error(e); return false; });
  dbBroken = !ok;
  updateSync();
  if (myName()) goHome(); else show("screen-name");
})();

$("btn-manager").onclick = () => { $("pin-input").value = ""; show("screen-pin"); };

$("btn-pin").onclick = () => {
  if ($("pin-input").value !== window.APP_CONFIG.managerPin) { toast("الرقم السري غلط"); return; }
  openManager();
};

async function openManager() {
  show("screen-manager");
  state.currentShipmentList = await db.listShipments().catch(() => []);
  $("all-shipments").innerHTML = state.currentShipmentList.map((s, i) =>
    `<li><button class="shipment-row" data-i="${i}">${esc(s.name)} — ${esc(s.createdBy)} — ${fmtDate(s.createdAt)}</button></li>`
  ).join("") || "<li>لا توجد شحنات</li>";
}

$("all-shipments").onclick = (e) => {
  const btn = e.target.closest(".shipment-row");
  if (btn) openDetail(state.currentShipmentList[+btn.dataset.i]);
};

function fmtDate(ts) { return new Date(ts).toLocaleDateString("ar-EG"); }

function shipmentText(s) {
  return `شحنة: ${s.name}\nالموظف: ${s.createdBy}\nالتاريخ: ${fmtDate(s.createdAt)}\n\n`
    + s.items.map(i => `${i.name} ${i.qty}`).join("\n");
}

let currentDetail = null;

function openDetail(s) {
  currentDetail = s;
  $("detail-title").textContent = s.name;
  $("detail-meta").textContent = `${s.createdBy} — ${fmtDate(s.createdAt)}`;
  $("detail-items").innerHTML = s.items.map(i =>
    `<tr><td>${esc(i.name)}</td><td dir="ltr">${esc(i.qty)}</td></tr>`).join("");
  show("screen-detail");
}

$("btn-back-manager").onclick = openManager;

$("btn-copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(shipmentText(currentDetail));
    toast("تم النسخ");
  } catch (e) {
    console.error(e);
    toast("النسخ ما نفعش — انسخ من الشاشة");
  }
};

let scanner = null;

$("btn-scan").onclick = async () => {
  if (scanner) { await stopScan(); return; }
  $("reader").hidden = false;
  scanner = new Html5Qrcode("reader");
  try {
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 150 } },
      async (text) => { await stopScan(); beep(); onBarcode(text.trim()).catch(() => toast("حصلت مشكلة — جرّب تاني")); }
    );
  } catch (err) {
    console.error(err);
    await stopScan();
    toast("الكاميرا مش متاحة — اكتب الباركود بإيدك");
  }
};

async function stopScan() {
  if (scanner) {
    try { await scanner.stop(); scanner.clear(); } catch (e) { /* already stopped */ }
    scanner = null;
  }
  $("reader").hidden = true;
}

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

function updateSync() {
  $("sync-state").textContent = dbBroken ? "إعدادات التطبيق ناقصة" : (navigator.onLine ? "متصل" : "في انتظار الاتصال");
}
addEventListener("online", updateSync);
addEventListener("offline", updateSync);
updateSync();

if ("serviceWorker" in navigator && !new URLSearchParams(location.search).has("test")) {
  navigator.serviceWorker.register("./sw.js");
}
