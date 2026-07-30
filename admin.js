import * as db from "./db.js";

const $ = (id) => document.getElementById(id);
const esc = (t) => { const d = document.createElement("div"); d.textContent = t; return d.innerHTML; };
const escAttr = (t) => esc(t).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const fmtWhen = (ts) => new Date(ts).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
const ALL = "الكل";

// the PIN shipped in firebase-config.js always works, even after the admin changes the
// stored one — without it a wrong save (or a stranger's) would lock the owner out for good
const CODE_ADMIN_PIN = window.APP_CONFIG.adminPin;

function toast(msg) {
  $("toast").textContent = msg;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2200);
}

const TITLES = { "screen-pin": "النظام", "screen-admin": "إعدادات النظام", "screen-logs": "آخر العمليات" };

let cfg = null;        // working copy of the settings
let dirty = false;
let shipments = [];    // loaded once, for the bulk-delete count
let shipmentsLoaded = false;
let bulkBranch = ALL;
let bulkType = ALL;

function render(id) {
  document.querySelectorAll("main > section").forEach(s => s.hidden = true);
  $(id).hidden = false;
  $("screen-title").textContent = TITLES[id] || "النظام";
  $("btn-back").hidden = id !== "screen-logs";
  $("btn-logs").hidden = id !== "screen-admin";
  scrollTo(0, 0);
}

addEventListener("popstate", (ev) => {
  const id = (ev.state && ev.state.screen) || "screen-admin";
  render(id === "screen-logs" ? "screen-logs" : "screen-admin");
});

$("btn-back").onclick = () => history.back();


let cfgReady = null;

$("btn-pin").onclick = async () => {
  await cfgReady;
  const entered = $("pin-input").value;
  if (entered !== CODE_ADMIN_PIN && entered !== cfg.adminPin) { toast("الرقم السري غلط"); return; }
  $("pin-input").value = "";
  history.replaceState({ screen: "screen-admin" }, "");
  render("screen-admin");
  renderAll();
  shipments = await db.listShipments().catch(() => []);
  shipmentsLoaded = true;
  renderBulk();
};


function markDirty() {
  dirty = true;
  $("cfg-dirty").textContent = "فيه تعديل مش محفوظ";
}

function renderAll() {
  renderBranches();
  renderTypes();
  $("cfg-manager-pin").value = cfg.managerPin;
  $("cfg-admin-pin").value = cfg.adminPin;
  renderBulk();
}

// inputs are read on save, not on every keystroke: re-rendering a row would eat the focus
function renderBranches() {
  $("branches-list").innerHTML = cfg.branches.map((b, i) => `<li>
      <div class="card-main">
        <input type="text" maxlength="40" data-bname="${i}" value="${escAttr(b.name)}">
        <div class="meta">الرقم السري للفرع</div>
      </div>
      <input type="text" inputmode="numeric" maxlength="8" dir="ltr" data-bpin="${i}" value="${escAttr(b.pin)}">
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
  document.querySelectorAll("input[data-bname]").forEach(inp => cfg.branches[+inp.dataset.bname].name = inp.value.trim());
  document.querySelectorAll("input[data-bpin]").forEach(inp => cfg.branches[+inp.dataset.bpin].pin = inp.value.trim());
  document.querySelectorAll("input[data-tname]").forEach(inp => cfg.shipmentTypes[+inp.dataset.tname] = inp.value.trim());
  cfg.managerPin = $("cfg-manager-pin").value.trim();
  cfg.adminPin = $("cfg-admin-pin").value.trim();
}

$("screen-admin").oninput = (e) => {
  if (e.target.matches("input")) markDirty();
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
  cfg.branches.push({ name: "فرع جديد", pin: "" });
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

$("btn-save-config").onclick = async () => {
  readInputs();
  if (!cfg.branches.length) { toast("لازم فرع واحد على الأقل"); return; }
  if (!cfg.shipmentTypes.filter(Boolean).length) { toast("لازم نوع شحنة واحد على الأقل"); return; }
  if (cfg.branches.some(b => !b.name)) { toast("في فرع من غير اسم"); return; }
  if (cfg.branches.some(b => !isPin(b.pin))) { toast("رقم الفرع لازم يكون من 4 لـ 8 أرقام"); return; }
  if (!isPin(cfg.managerPin) || !isPin(cfg.adminPin)) { toast("رقم المدير ورقم الأدمن لازم من 4 لـ 8 أرقام"); return; }
  const names = cfg.branches.map(b => b.name);
  if (new Set(names).size !== names.length) { toast("في اسم فرع متكرر"); return; }

  const payload = {
    managerPin: cfg.managerPin,
    adminPin: cfg.adminPin,
    branches: cfg.branches.map(b => ({ name: b.name, pin: b.pin })),
    shipmentTypes: cfg.shipmentTypes.filter(Boolean),
  };
  try {
    await db.saveConfig(payload);
  } catch (err) {
    console.error(err);
    toast("الحفظ ما نفعش — جرّب تاني");
    return;
  }
  Object.assign(window.APP_CONFIG, payload);
  db.logAction("الأدمن", "تغيير الإعدادات", `${payload.branches.length} فرع · ${payload.shipmentTypes.length} نوع`);
  dirty = false;
  $("cfg-dirty").textContent = "";
  renderAll();
  toast("تم حفظ الإعدادات — الموبايلات هتشوفها مع أول فتح");
};

addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });


function renderBulk() {
  const chips = (id, opts, active, attr) => {
    $(id).innerHTML = opts.map(o =>
      `<button type="button" data-${attr}="${escAttr(o)}" aria-pressed="${o === active}">${esc(o)}</button>`).join("");
  };
  chips("bulk-branch", [ALL, ...cfg.branches.map(b => b.name)], bulkBranch, "bulkbranch");
  chips("bulk-type", [ALL, ...cfg.shipmentTypes], bulkType, "bulktype");
  // a count of 0 before the list arrives reads as "nothing to delete" — say what is happening
  $("btn-bulk-delete").textContent = shipmentsLoaded
    ? `حذف المطابق (${matching().length})`
    : "بنعد الشحنات...";
}

function matching() {
  return shipments.filter(s => (bulkBranch === ALL || s.branch === bulkBranch)
    && (bulkType === ALL || s.type === bulkType));
}

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

$("btn-bulk-delete").onclick = async () => {
  if (!shipmentsLoaded) { toast("استنى لحد ما الشحنات تحمّل"); return; }
  const hit = matching();
  if (!hit.length) { toast("مفيش شحنات مطابقة"); return; }
  if (!confirm(`حذف ${hit.length} شحنة (${bulkBranch} · ${bulkType})؟ مش هينفع ترجّعها.`)) return;
  try {
    await db.deleteMany("shipments", hit.map(s => s._id));
  } catch (err) {
    console.error(err);
    toast("الحذف ما نفعش — جرّب تاني");
    return;
  }
  db.logAction("الأدمن", "حذف شحنات بالجملة", `${hit.length} شحنة · ${bulkBranch} · ${bulkType}`);
  shipments = await db.listShipments().catch(() => []);
  renderBulk();
  toast(`تم حذف ${hit.length} شحنة`);
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
    toast("المسح ما نفعش — جرّب تاني");
    return;
  }
  db.logAction("الأدمن", "مسح ملف الأصناف", `${rows.length} صنف`);
  toast(`تم مسح ${rows.length} صنف`);
};


$("btn-logs").onclick = async () => {
  history.pushState({ screen: "screen-logs" }, "");
  render("screen-logs");
  $("logs-count").textContent = "بنجيب آخر العمليات...";
  $("logs-list").innerHTML = "";
  const rows = await db.listLogs().catch(() => []);
  $("logs-count").textContent = rows.length ? `آخر ${rows.length} عملية` : "";
  $("logs-list").innerHTML = rows.map(r => `<li>
      <div class="card-main">
        <div class="card-title">${esc(r.action)}</div>
        <div class="meta">${esc(r.target)}</div>
        <div class="meta">${esc(r.who)} · ${esc(fmtWhen(r.at))}</div>
      </div>
    </li>`).join("") || `<li class="empty">مفيش عمليات مسجّلة لحد الآن</li>`;
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
}
addEventListener("online", updateSync);
addEventListener("offline", updateSync);
updateSync();

history.replaceState({ screen: "screen-pin" }, "");
render("screen-pin");

cfgReady = (async () => {
  await db.initDb().catch(console.error);
  const stored = await db.getConfig().catch(() => ({}));
  Object.assign(window.APP_CONFIG, stored);
  cfg = {
    managerPin: window.APP_CONFIG.managerPin,
    adminPin: window.APP_CONFIG.adminPin,
    branches: window.APP_CONFIG.branches.map(b => ({ ...b })),
    shipmentTypes: [...window.APP_CONFIG.shipmentTypes],
  };
})();

if ("serviceWorker" in navigator && !new URLSearchParams(location.search).has("test")) {
  navigator.serviceWorker.register("./sw.js");
}
