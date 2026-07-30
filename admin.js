import * as db from "./db.js";
import * as auth from "./auth.js";

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
let identity = "الأدمن";
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
  const who = auth.authenticate(entered, window.APP_CONFIG, CODE_ADMIN_PIN);
  if (!who) { toast("الرقم السري غلط"); return; }
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
  $("btn-logout").hidden = !auth.session();
  shipments = await db.listShipments().catch(() => []);
  shipmentsLoaded = true;
  renderBulk();
}

// no session = the old single-PIN admin, where everything was allowed
const canDo = (perm) => !auth.session() || auth.can(perm);

$("btn-logout").onclick = () => {
  auth.endSession();
  location.reload();
};


function markDirty() {
  dirty = true;
  $("cfg-dirty").textContent = "فيه تعديل مش محفوظ";
}

function renderAll() {
  renderUsers();
  renderBranches();
  renderTypes();
  $("cfg-manager-pin").value = cfg.managerPin;
  $("cfg-admin-pin").value = cfg.adminPin;
  renderBulk();
}

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
  document.querySelectorAll("input[data-uname]").forEach(inp => cfg.users[+inp.dataset.uname].name = inp.value.trim());
  document.querySelectorAll("input[data-upin]").forEach(inp => cfg.users[+inp.dataset.upin].pin = inp.value.trim());
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

  // a repeated PIN would silently hand one person another person's screens
  if (cfg.users.some(u => !u.name)) { toast("في مستخدم من غير اسم"); return; }
  if (cfg.users.some(u => !isPin(u.pin))) { toast("رقم المستخدم لازم يكون من 4 لـ 8 أرقام"); return; }
  if (cfg.users.some(u => !(u.perms || []).some(p => auth.SCREEN_PERMS.includes(p)))) {
    toast("كل مستخدم لازم يفتح شاشة واحدة على الأقل");
    return;
  }
  const pins = [...cfg.users.map(u => u.pin), ...cfg.branches.map(b => b.pin), cfg.managerPin, cfg.adminPin];
  if (new Set(pins).size !== pins.length) { toast("في رقم سري متكرر — كل واحد لازم يكون لوحده"); return; }

  const payload = {
    managerPin: cfg.managerPin,
    adminPin: cfg.adminPin,
    branches: cfg.branches.map(b => ({ name: b.name, pin: b.pin })),
    shipmentTypes: cfg.shipmentTypes.filter(Boolean),
    users: cfg.users.map(u => ({ name: u.name, pin: u.pin, branches: auth.branchesOf(u), perms: u.perms.slice() })),
  };
  try {
    await db.saveConfig(payload);
  } catch (err) {
    console.error(err);
    toast("الحفظ ما نفعش — جرّب تاني");
    return;
  }
  Object.assign(window.APP_CONFIG, payload);
  db.logAction(identity, "تغيير الإعدادات", `${payload.users.length} مستخدم · ${payload.branches.length} فرع · ${payload.shipmentTypes.length} نوع`);
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
  db.logAction(identity,"حذف شحنات بالجملة", `${hit.length} شحنة · ${bulkBranch} · ${bulkType}`);
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
  db.logAction(identity,"مسح ملف الأصناف", `${rows.length} صنف`);
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
    users: (window.APP_CONFIG.users || []).map(u => ({ ...u, branches: auth.branchesOf(u), perms: (u.perms || []).slice() })),
  };
  const s = auth.session();
  if (!s) return;
  if (s.perms.includes("adm")) { await enterAdmin(); return; }   // already signed in elsewhere
  const page = auth.landingPage(s.perms);
  if (page && page !== "admin.html") auth.goTo(page);
})();

if ("serviceWorker" in navigator && !new URLSearchParams(location.search).has("test")) {
  navigator.serviceWorker.register("./sw.js");
}
