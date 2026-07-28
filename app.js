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
  const all = await db.listShipments();
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

$("btn-new").onclick = () => {
  state.items = [];
  state.currentBarcode = null;
  $("shipment-name").value = "";
  $("barcode-input").value = "";
  $("item-form").hidden = true;
  renderItems();
  show("screen-new");
};

$("btn-lookup").onclick = () => {
  const code = $("barcode-input").value.trim();
  if (code) onBarcode(code);
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
}

$("btn-save-shipment").onclick = async () => {
  const name = $("shipment-name").value.trim();
  if (!name) { toast("اكتب اسم الشحنة الأول"); return; }
  await db.saveShipment({ name, createdBy: myName(), items: state.items });
  toast("تم حفظ الشحنة");
  goHome();
};

document.querySelectorAll(".btn-back").forEach(b => b.onclick = goHome);

(async () => {
  await db.initDb().catch(console.error);
  if (myName()) goHome(); else show("screen-name");
})();
