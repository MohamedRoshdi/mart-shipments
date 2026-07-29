import * as db from "./db.js";

const $ = (id) => document.getElementById(id);

function show(id) {
  document.querySelectorAll("main > section").forEach(s => s.hidden = true);
  $(id).hidden = false;
}

function esc(t) { const d = document.createElement("div"); d.textContent = t; return d.innerHTML; }

function toast(msg) {
  $("toast").textContent = msg;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2000);
}

function fmtDate(ts) { return new Date(ts).toLocaleDateString("ar-EG"); }

let list = [];
let currentDetail = null;

$("btn-pin").onclick = () => {
  if ($("pin-input").value !== window.APP_CONFIG.managerPin) { toast("الرقم السري غلط"); return; }
  openManager();
};

async function openManager() {
  show("screen-manager");
  list = await db.listShipments().catch(() => []);
  $("all-shipments").innerHTML = list.map((s, i) =>
    `<li><div>${esc(s.name)} — ${esc(s.createdBy)} — ${fmtDate(s.createdAt)}</div>
     <div class="row-actions">
       <button data-act="view" data-i="${i}">عرض</button>
       <button data-act="copy" data-i="${i}">نسخ</button>
       <button data-act="del" data-i="${i}" class="danger">حذف</button>
     </div></li>`).join("") || "<li>لا توجد شحنات</li>";
}

function shipmentText(s) {
  return s.items.map(i => `${i.barcode}\t${i.qty}`).join("\n");
}

async function copyShipment(s) {
  try {
    await navigator.clipboard.writeText(shipmentText(s));
    toast("تم النسخ");
  } catch (e) {
    console.error(e);
    toast("النسخ ما نفعش — انسخ من الشاشة");
  }
}

$("all-shipments").onclick = async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const s = list[+btn.dataset.i];
  if (btn.dataset.act === "view") openDetail(s);
  else if (btn.dataset.act === "copy") copyShipment(s);
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

function openDetail(s) {
  currentDetail = s;
  $("detail-title").textContent = s.name;
  $("detail-meta").textContent = `${s.createdBy} — ${fmtDate(s.createdAt)}`;
  $("detail-items").innerHTML = s.items.map(i =>
    `<tr><td>${esc(i.name || i.barcode)}</td><td dir="ltr">${esc(i.barcode)}</td><td dir="ltr">${esc(i.qty)}</td></tr>`).join("");
  show("screen-detail");
}

$("btn-back-manager").onclick = openManager;

$("btn-copy").onclick = () => copyShipment(currentDetail);

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
    for (const c of rows) { await db.saveProductName(c[0].trim(), c.slice(1).join(" ").trim()); n++; }
    toast(`تم استيراد ${n} صنف`);
  } catch (err) {
    console.error(err);
    toast(`اتسجل ${n} صنف وبعدين حصلت مشكلة — جرّب تاني`);
  }
  e.target.value = "";
};

function updateSync() {
  $("sync-state").textContent = navigator.onLine ? "متصل" : "في انتظار الاتصال";
}
addEventListener("online", updateSync);
addEventListener("offline", updateSync);
updateSync();

db.initDb().catch(console.error);
