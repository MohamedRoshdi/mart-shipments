import * as db from "./db.js";

const $ = (id) => document.getElementById(id);
const esc = (t) => { const d = document.createElement("div"); d.textContent = t; return d.innerHTML; };
const branches = () => window.APP_CONFIG.branches;
const branchByName = (n) => branches().find(b => b.name === n);
const myName = () => localStorage.getItem("employeeName");
const myBranch = () => localStorage.getItem("employeeBranch") || branches()[0].name;
const fmtDate = (ts) => new Date(ts).toLocaleDateString("ar-EG");

function toast(msg) {
  $("toast").textContent = msg;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2200);
}

const TITLES = {
  "screen-name": "بيانات الموظف",
  "screen-home": "شحناتي",
  "screen-new": "شحنة جديدة",
};

const types = () => window.APP_CONFIG.shipmentTypes;

const state = {
  items: [], currentBarcode: null, currentName: "", editingId: null, mine: [],
  branch: myBranch(), type: types()[0],
};

/* ---------- navigation: one screen at a time, phone back button works ---------- */

function render(id) {
  document.querySelectorAll("main > section").forEach(s => s.hidden = true);
  $(id).hidden = false;
  $("screen-title").textContent = TITLES[id] || "شحنات المحل";
  $("btn-back").hidden = id === "screen-home" || (id === "screen-name" && !myName());
  $("who").hidden = !myName() || id !== "screen-home";
  if (myName()) $("who").textContent = `${myName()} · ${myBranch()}`;
  hideSheet();
  scrollTo(0, 0);
}

function navTo(id) {
  history.pushState({ screen: id }, "");
  render(id);
}

async function goHome() {
  await stopScan();
  state.editingId = null;
  render("screen-home");
  const all = await db.listShipments().catch(() => []);
  state.mine = all.filter(s => s.createdBy === myName());
  $("my-shipments").innerHTML = state.mine.map((s, i) => `<li>
      <div class="card-main">
        <div class="card-title">${esc(s.name)}</div>
        <div class="meta">${esc(s.type || "")} · ${esc(s.branch || "")} · ${fmtDate(s.createdAt)} · ${s.items.length} صنف</div>
      </div>
      <button class="ghost" data-edit="${i}">تعديل</button>
    </li>`).join("") || `<li class="empty">لسه مفيش شحنات — ابدأ بـ «شحنة جديدة»</li>`;
}

addEventListener("popstate", (ev) => {
  const id = (ev.state && ev.state.screen) || "screen-home";
  if (id === "screen-home") goHome(); else render(id);
});

$("btn-back").onclick = () => history.back();
$("who").onclick = () => navTo("screen-name");

/* ---------- employee + branch setup ---------- */

const shortBranch = (b) => b.replace(/^فرع\s+/, ""); // chips stay one line; stored value keeps "فرع"

function renderBranchPicker() {
  $("branch-picker").innerHTML = branches().map(b =>
    `<button type="button" data-branch="${esc(b.name)}" aria-pressed="${b.name === state.branch}">${esc(shortBranch(b.name))}</button>`).join("");
}

$("branch-picker").onclick = (e) => {
  const btn = e.target.closest("button[data-branch]");
  if (!btn) return;
  state.branch = btn.dataset.branch;
  renderBranchPicker();
};

$("save-name").onclick = () => {
  const n = $("employee-name").value.trim();
  if (!n) { toast("اكتب اسمك الأول"); return; }
  const branch = branchByName(state.branch);
  if (!branch || $("branch-pin").value !== branch.pin) { toast("الرقم السري للفرع غلط"); return; }
  localStorage.setItem("employeeName", n);
  localStorage.setItem("employeeBranch", branch.name);
  $("branch-pin").value = "";
  history.replaceState({ screen: "screen-home" }, "");
  goHome();
};

/* ---------- building a shipment ---------- */

function saveDraft() {
  if (state.editingId) return; // editing a saved shipment must not overwrite the unsaved draft
  localStorage.setItem("draft", JSON.stringify({ name: $("shipment-name").value, items: state.items, type: state.type }));
}

function renderTypePicker() {
  $("new-branch").textContent = myBranch();
  $("type-picker").innerHTML = types().map(t =>
    `<button type="button" data-type="${esc(t)}" aria-pressed="${t === state.type}">${esc(t)}</button>`).join("");
}

$("type-picker").onclick = (e) => {
  const btn = e.target.closest("button[data-type]");
  if (!btn) return;
  state.type = btn.dataset.type;
  renderTypePicker();
  saveDraft();
};

$("btn-new").onclick = () => {
  const draft = JSON.parse(localStorage.getItem("draft") || "null");
  state.editingId = null;
  state.items = (draft && draft.items) || [];
  state.currentBarcode = null;
  state.type = (draft && draft.type) || types()[0];
  renderTypePicker();
  $("shipment-name").value = (draft && draft.name) || "";
  $("barcode-input").value = "";
  $("btn-save-shipment").textContent = "حفظ الشحنة";
  renderItems();
  navTo("screen-new");
  if (state.items.length) toast("رجّعنالك الشحنة اللي كانت مفتوحة");
};

$("my-shipments").onclick = (e) => {
  const btn = e.target.closest("button[data-edit]");
  if (btn) openShipment(state.mine[+btn.dataset.edit]);
};

function openShipment(s) {
  state.editingId = s._id;
  state.items = s.items.map(i => ({ ...i }));
  state.currentBarcode = null;
  state.type = s.type || types()[0];
  renderTypePicker();
  $("shipment-name").value = s.name;
  $("barcode-input").value = "";
  $("btn-save-shipment").textContent = "حفظ التعديلات";
  renderItems();
  navTo("screen-new");
}

$("shipment-name").oninput = saveDraft;

$("btn-lookup").onclick = () => {
  const code = $("barcode-input").value.trim();
  if (code) onBarcode(code).catch(() => toast("حصلت مشكلة — جرّب تاني"));
};

async function onBarcode(code) {
  state.currentBarcode = code;
  state.currentName = await db.getProductName(code) || "";
  const known = state.currentName !== "";
  $("item-barcode").textContent = code;
  $("item-name").textContent = known ? state.currentName : "صنف غير مسجّل في ملف الأصناف";
  $("item-name").classList.toggle("unknown", !known);
  $("item-warn").hidden = known;                 // full explanation instead of a silent add
  $("qty-row").hidden = !known;                  // nothing to count if the item cannot be added
  $("btn-add-item").hidden = !known;             // only catalog items can enter a shipment
  $("btn-add-item").disabled = !known;
  $("item-qty").value = 1;
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
}

$("btn-cancel-item").onclick = hideSheet;
$("scrim").onclick = hideSheet;
$("qty-plus").onclick = () => { $("item-qty").value = +$("item-qty").value + 1; };
$("qty-minus").onclick = () => { $("item-qty").value = Math.max(1, +$("item-qty").value - 1); };

$("btn-add-item").onclick = () => {
  const name = state.currentName;      // names come from the imported catalog only
  const qty = Math.max(1, parseInt($("item-qty").value, 10) || 1);
  const barcode = state.currentBarcode;
  if (!barcode) return;
  if (!name) { toast("الصنف مش في ملف الأصناف — مش هينفع يتسجّل"); return; }
  const dup = state.items.find(i => i.barcode === barcode);
  if (dup) dup.qty += qty; else state.items.push({ barcode, name, qty });
  hideSheet();
  $("barcode-input").value = "";
  renderItems();
};

function renderItems() {
  $("items-list").innerHTML = state.items.map((i, idx) => `<li>
      <div class="card-main">
        <div class="card-title">${esc(i.name || "بدون اسم")}</div>
        <div class="code">${esc(i.barcode)}</div>
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
  if (!name) { toast("اكتب اسم الشحنة الأول"); return; }
  const editing = state.editingId;
  try {
    if (editing) await db.updateShipment(editing, { name, items: state.items, type: state.type });
    else await db.saveShipment({ name, createdBy: myName(), branch: myBranch(), type: state.type, items: state.items });
  } catch (e) {
    console.error(e);
    toast("الحفظ ما نفعش — حاول تاني");
    return;
  }
  if (!editing) localStorage.removeItem("draft");
  toast(editing ? "تم حفظ التعديلات" : "تم حفظ الشحنة");
  history.replaceState({ screen: "screen-home" }, "");
  goHome();
};

/* ---------- camera ---------- */

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

/* ---------- keyboard: Enter does the obvious thing for the focused field ---------- */

const ENTER = {
  "employee-name": "save-name",
  "branch-pin": "save-name",
  "barcode-input": "btn-lookup",
  "item-qty": "btn-add-item",
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

addEventListener("db-error", () => toast("مشكلة في مزامنة البيانات — اتأكد من الاتصال والإعدادات"));

let dbBroken = false;

function updateSync() {
  $("sync-state").textContent = dbBroken ? "إعدادات ناقصة" : (navigator.onLine ? "متصل" : "مستني الاتصال");
}
addEventListener("online", updateSync);
addEventListener("offline", updateSync);

(async () => {
  renderBranchPicker();
  const ok = await db.initDb().then(() => true).catch((e) => { console.error(e); return false; });
  dbBroken = !ok;
  updateSync();
  if (myName()) {
    history.replaceState({ screen: "screen-home" }, "");
    goHome();
  } else {
    history.replaceState({ screen: "screen-name" }, "");
    render("screen-name");
  }
})();

if ("serviceWorker" in navigator && !new URLSearchParams(location.search).has("test")) {
  navigator.serviceWorker.register("./sw.js");
}
