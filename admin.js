import * as db from "./db.js";
import * as auth from "./auth.js";
import * as lbl from "./label.js";
import { sheetRows, requireColumns } from "./sheet.js";
import { versionLine } from "./version.js";
import * as files from "./files.js";

const $ = (id) => document.getElementById(id);
const esc = (t) => { const d = document.createElement("div"); d.textContent = t; return d.innerHTML; };
const escAttr = (t) => esc(t).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const fmtWhen = (ts) => new Date(ts).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
const ALL = "الكل";

// the PIN shipped in firebase-config.js always works, even after the admin changes the
// stored one — without it a wrong save (or a stranger's) would lock the owner out for good
const CODE_ADMIN_PIN = window.APP_CONFIG.adminPin;

function toast(msg, kind) {
  const t = $("toast");
  t.textContent = msg;
  t.className = kind ? `show t-${kind}` : "show";
  setTimeout(() => { t.className = ""; }, 2200);
}

$("version-line").textContent = versionLine();

const TITLES = { "screen-pin": "العائلة مارت — النظام", "screen-admin": "إعدادات النظام", "screen-logs": "آخر العمليات" };

let cfg = null;        // working copy of the settings
let identity = "الأدمن";
let dirty = false;
let shipments = [];    // loaded once, for the bulk-delete count
let counts = [];       // الجرد is deleted from the same tool
let shipmentsLoaded = false;
let bulkKind = "shipments";
let bulkBranch = ALL;
let bulkType = ALL;

const KIND_LABEL = { shipments: "الشحنات", counts: "الجرد" };

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
  if (who.blocked) { toast("الرقم ده مربوط بموبايل تاني — كلّم الأدمن يفكّه الأول"); return; }
  if (who.claim) db.claimDevice(entered, who.claim);
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
  [shipments, counts] = await Promise.all([
    db.listShipments().catch(() => []),
    db.listCounts().catch(() => []),
  ]);
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
  // a shop with fifty suppliers should not tap «+ إضافة» fifty times: one line each, paste and go
  $("cfg-suppliers").value = cfg.suppliers.map(supplierLine).join("\n");
  paintSuppliers();
  renderLabelCfg();
  renderBulk();
  renderFolder();       // per machine, not part of cfg — it just paints beside everything else
}

/* --- ليبل الرف: the size, the paper and the logo. Everything the printing screen reads. --- */

const SHEETS = { label: "ليبل حراري", a4: "ورق A4" };
const LOGO_PX = 360;          // a shelf label is 66 mm wide; more pixels than this print the same
const LOGO_CAP = 150000;      // characters of data URL, well under the rules' ceiling

function renderLabelCfg() {
  $("cfg-label-w").value = cfg.label.w;
  $("cfg-label-h").value = cfg.label.h;
  $("cfg-label-gap").value = cfg.label.gap;
  const roll = cfg.label.sheet !== "a4";        // an A4 sheet is one piece of paper — nothing to pace
  $("cfg-gap-row").hidden = !roll;
  $("cfg-gap-note").hidden = !roll;
  $("cfg-label-sheet").innerHTML = Object.entries(SHEETS).map(([k, label]) =>
    `<button type="button" data-sheet="${k}" aria-pressed="${k === cfg.label.sheet}">${esc(label)}</button>`).join("");
  $("label-logo-preview").innerHTML = cfg.label.logo
    ? `<img src="${escAttr(cfg.label.logo)}" alt="شعار المحل">`
    : `<p class="meta">مفيش شعار — الليبل هيطلع بالاسم والباركود بس.</p>`;
}

$("cfg-label-sheet").onclick = (e) => {
  const btn = e.target.closest("button[data-sheet]");
  if (!btn) return;
  readInputs();
  cfg.label.sheet = btn.dataset.sheet;
  renderLabelCfg();
  markDirty();
};

$("btn-label-logo").onclick = () => $("cfg-label-logo").click();

// The logo travels inside the settings doc, so it has to be small: it is redrawn at printing
// width before it is stored, and a picture that is still too big is refused instead of silently
// bloating a document every phone reads at boot.
$("cfg-label-logo").onchange = async () => {
  const file = $("cfg-label-logo").files[0];
  if (!file) return;
  let data = "";
  try {
    data = await shrinkImage(file);
  } catch (err) {
    console.error(err);
    toast("مقدرناش نقرا الصورة — جرّب صورة تانية", "bad");
    return;
  }
  if (data.length > LOGO_CAP) { toast("الصورة كبيرة — استخدم صورة أصغر أو أوضح"); return; }
  readInputs();
  cfg.label.logo = data;
  $("cfg-label-logo").value = "";
  renderLabelCfg();
  markDirty();
  toast("الشعار اتحمّل — اضغط «حفظ الإعدادات»");
};

/* ---------- the import folder ----------
   Per machine, never in the settings doc: the folder is a property of the PC the manager works
   on, the same reasoning as the camera settings. It is also the one thing here that CANNOT be
   saved to Firestore — a directory handle is not data, it is a permission this browser holds. */

async function renderFolder() {
  const name = await files.folderName();
  const ok = await files.available();
  $("folder-now").hidden = !name;
  $("folder-now").textContent = name
    ? (ok ? `المجلد الحالي: ${name}` : `المجلد الحالي: ${name} — محتاج إذن تاني، دوس «اختار مجلد الاستيراد»`)
    : "";
  // in the Windows build the shell owns the folder: a button that cannot change it is a button
  // that looks broken, so both of them go and the note says where the files land
  if (files.bridge()) {
    $("btn-folder-pick").hidden = true;
    $("btn-folder-clear").hidden = true;
    $("folder-note").textContent = `ملفات TXT بتتحفظ لوحدها في ${name} — المجلد ده جزء من نسخة الويندوز.`;
    return;
  }
  $("btn-folder-clear").hidden = !name;
  $("btn-folder-pick").textContent = name ? "غيّر المجلد" : "اختار مجلد الاستيراد";
  $("btn-folder-pick").disabled = !files.supported();
  if (!files.supported()) {
    $("folder-note").textContent =
      "المتصفح ده مش بيسمح بالحفظ في مجلد. افتح الصفحة من كروم أو Edge على الويندوز، وساعتها الملفات هتتحفظ لوحدها من غير نافذة حفظ.";
  }
}

$("btn-folder-pick").onclick = async () => {
  try {
    const name = await files.chooseFolder();
    toast(`المجلد اتحدد: ${name}`, "ok");
  } catch (err) {
    // the user closing the picker is not a failure and must not shout at them
    if (err && err.name === "AbortError") return;
    console.error(err);
    toast(err.message || "مقدرناش نحدد المجلد", "bad");
  }
  renderFolder();
};

$("btn-folder-clear").onclick = async () => {
  await files.forgetFolder();
  toast("اتشال المجلد — الملفات هترجع تتحمّل زي الأول");
  renderFolder();
};

$("btn-label-logo-clear").onclick = () => {
  readInputs();
  cfg.label.logo = "";
  renderLabelCfg();
  markDirty();
};

async function shrinkImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = fail;
      i.src = url;
    });
    const scale = Math.min(1, LOGO_PX / (img.naturalWidth || 1));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const png = c.toDataURL("image/png");            // keeps a logo's transparent background
    return png.length > LOGO_CAP ? c.toDataURL("image/jpeg", 0.85) : png;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* --- suppliers: one per line, «كود، اسم». The code is the shop's own, and it rides onto every
   shipment saved under that supplier's name. A line with no code is still a supplier. --- */

const isCode = (s) => /^[0-9A-Za-z\-_/]{1,20}$/.test(s);

// one row, already split into cells — from a typed line or from a sheet with no header row
function supplierCells(cells) {
  const parts = cells.map(c => String(c == null ? "" : c).trim()).filter(Boolean);
  if (!parts.length) return null;
  // only a leading cell that looks like a code is one: an Arabic first cell is part of the name
  if (parts.length >= 2 && isCode(parts[0])) return { code: parts[0], name: parts.slice(1).join(" ") };
  return { code: "", name: parts.join(" ") };
}

// the textarea: a person types «كود، اسم» by hand, and that shape must not change
const parseSupplier = (line) => supplierCells(line.split(/[,،;\t]/));

const supplierLine = (s) => (s.code ? `${s.code}، ${s.name}` : s.name);
const suppliersTyped = () => $("cfg-suppliers").value.split("\n").map(parseSupplier).filter(Boolean);

function paintSuppliers() {
  const list = suppliersTyped();
  const coded = list.filter(s => s.code).length;
  $("suppliers-count").textContent = list.length
    ? `${list.length} مورد · ${coded} منهم بكود`
    : "مفيش موردين — الموظف هيكتب الاسم بنفسه";
}

$("cfg-suppliers").oninput = () => { paintSuppliers(); markDirty(); };

$("btn-suppliers-file").onclick = () => $("suppliers-file").click();

// the file replaces the box, it does not append: the shop's list is the shop's list
$("suppliers-file").onchange = async () => {
  const file = $("suppliers-file").files[0];
  if (!file) return;
  let rows = [], map = null;
  try {
    rows = await sheetRows(file);
    // the ERP exports «كود المورد | اسم المورد»; the header is what makes that order stop mattering
    map = requireColumns(rows, ["supplierCode", "supplierName"]);
  } catch (err) {
    console.error(err);
    toast(err.message || "مقدرناش نقرا الملف — تأكد إنه Excel أو CSV", "bad");
    $("suppliers-file").value = "";
    return;
  }
  const read = map
    ? rows.slice(1).map(c => ({ code: String(c[map.supplierCode] || "").trim(),
                               name: String(c[map.supplierName] || "").trim() }))
    : rows.map(supplierCells);
  // the same code twice in one file is one supplier, the later row winning — «تحديث لا تكرار»
  const byCode = new Map();
  const list = [];
  for (const s of read) {
    if (!s || !s.name) continue;
    if (!s.code) { list.push(s); continue; }
    if (byCode.has(s.code)) { list[byCode.get(s.code)] = s; continue; }
    byCode.set(s.code, list.length);
    list.push(s);
  }
  $("suppliers-file").value = "";
  if (!list.length) { toast("الملف مفيهوش موردين"); return; }
  $("cfg-suppliers").value = list.map(supplierLine).join("\n");
  paintSuppliers();
  markDirty();
  toast(`اتقرأ ${list.length} مورد — اضغط «حفظ الإعدادات»`, "ok");
};

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
        <div class="user-row">
          <span class="meta">${u.device ? "مربوط بموبايل واحد" : "مش مربوط بموبايل — أول موبايل يدخل بيه هيتربط"}</span>
          ${u.device ? `<button type="button" class="ghost" data-unbind="${i}">فك الارتباط</button>` : ""}
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
  const unbind = e.target.closest("button[data-unbind]");
  if (unbind) {
    readInputs();
    const u = cfg.users[+unbind.dataset.unbind];
    delete u.device;
    renderUsers();
    markDirty();
    toast(`«${u.name || "المستخدم"}» يقدر يدخل من موبايل جديد — اضغط «حفظ الإعدادات»`);
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
      </div>
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
  document.querySelectorAll("input[data-tname]").forEach(inp => cfg.shipmentTypes[+inp.dataset.tname] = inp.value.trim());
  cfg.managerPin = $("cfg-manager-pin").value.trim();
  cfg.adminPin = $("cfg-admin-pin").value.trim();
  cfg.suppliers = suppliersTyped();
  // labelCfg clamps a typed size back into range, so a half-typed number never reaches the doc
  cfg.label = lbl.labelCfg({ label: {
    ...cfg.label, w: $("cfg-label-w").value, h: $("cfg-label-h").value, gap: $("cfg-label-gap").value,
  } });
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
  cfg.branches.push({ name: "فرع جديد" });
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
// The same ceiling firestore.rules enforces. Raised from 300 on 2026-07-31: the shop's real list
// is 425 and the save was being refused. 1000 × «كود، اسم» is ~60 KB inside a 1 MB document, and
// every page reads that document once at boot.
const SUPPLIER_CAP = 1000;

$("btn-save-config").onclick = async () => {
  readInputs();
  if (!cfg.branches.length) { toast("لازم فرع واحد على الأقل"); return; }
  if (!cfg.shipmentTypes.filter(Boolean).length) { toast("لازم نوع شحنة واحد على الأقل"); return; }
  if (cfg.branches.some(b => !b.name)) { toast("في فرع من غير اسم"); return; }
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
  const pins = [...cfg.users.map(u => u.pin), cfg.managerPin, cfg.adminPin];
  if (new Set(pins).size !== pins.length) { toast("في رقم سري متكرر — كل واحد لازم يكون لوحده"); return; }
  if (cfg.suppliers.length > SUPPLIER_CAP) { toast(`الموردين أكتر من ${SUPPLIER_CAP} — شيل اللي مش شغال معاك`); return; }

  const payload = {
    managerPin: cfg.managerPin,
    adminPin: cfg.adminPin,
    branches: cfg.branches.map(b => ({ name: b.name })),   // a branch is a name, not a password
    shipmentTypes: cfg.shipmentTypes.filter(Boolean),
    suppliers: cfg.suppliers,
    label: cfg.label,                                      // size, paper and logo of the shelf label
    // device carries the phone this account is bound to — dropping it here would silently
    // unbind every user on any settings save
    users: cfg.users.map(u => ({
      name: u.name, pin: u.pin, branches: auth.branchesOf(u), perms: u.perms.slice(),
      ...(u.device ? { device: u.device } : {}),
    })),
  };
  // The settings doc is the one write that waits for the server on purpose: a false «تم الحفظ»
  // on the PINs could lock the shop out. So the wait has to be visible — a silent dead button
  // is what a slow write (or an exhausted daily quota) used to look like.
  toast("بنحفظ الإعدادات...");
  const slow = setTimeout(() => toast("الحفظ بياخد وقت — سيب الصفحة مفتوحة لحد ما تظهر رسالة الحفظ"), 6000);
  try {
    await db.saveConfig(payload);
  } catch (err) {
    console.error(err);
    toast("الحفظ ما نفعش — جرّب تاني", "bad");
    return;
  } finally {
    clearTimeout(slow);
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
  $("bulk-kind").innerHTML = Object.entries(KIND_LABEL).map(([k, label]) =>
    `<button type="button" data-bulkkind="${k}" aria-pressed="${k === bulkKind}">${esc(label)}</button>`).join("");
  chips("bulk-branch", [ALL, ...cfg.branches.map(b => b.name)], bulkBranch, "bulkbranch");
  chips("bulk-type", [ALL, ...cfg.shipmentTypes], bulkType, "bulktype");
  $("bulk-type-row").hidden = bulkKind !== "shipments";  // a stocktake has no type
  // a count of 0 before the list arrives reads as "nothing to delete" — say what is happening
  $("btn-bulk-delete").textContent = shipmentsLoaded
    ? `حذف المطابق (${matching().length})`
    : "بنعد...";
}

// the day a row was recorded, as YYYY-MM-DD — the same shape the date inputs hand back, so the
// range check is a plain string compare
const dayOf = (ms) => new Date(ms).toLocaleDateString("en-CA");

function matching() {
  const from = $("bulk-from").value;
  const to = $("bulk-to").value;
  const rows = bulkKind === "counts" ? counts : shipments;
  return rows.filter((s) => {
    const day = dayOf(s.createdAt);
    return (bulkBranch === ALL || s.branch === bulkBranch)
      && (bulkKind === "counts" || bulkType === ALL || s.type === bulkType)
      && (!from || day >= from)
      && (!to || day <= to);
  });
}

$("bulk-kind").onclick = (e) => {
  const btn = e.target.closest("button[data-bulkkind]");
  if (!btn) return;
  bulkKind = btn.dataset.bulkkind;
  renderBulk();
};

$("bulk-from").onchange = renderBulk;
$("bulk-to").onchange = renderBulk;

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

// what the user picked, in words, for the confirm box and the audit row
function bulkScope() {
  const from = $("bulk-from").value;
  const to = $("bulk-to").value;
  const when = from && to ? (from === to ? `يوم ${from}` : `من ${from} لـ ${to}`)
    : (from ? `من ${from}` : (to ? `لحد ${to}` : "كل الأيام"));
  return [KIND_LABEL[bulkKind], bulkBranch, ...(bulkKind === "shipments" ? [bulkType] : []), when].join(" · ");
}

$("btn-bulk-delete").onclick = async () => {
  if (!shipmentsLoaded) { toast("استنى لحد ما البيانات تحمّل"); return; }
  const hit = matching();
  const noun = bulkKind === "counts" ? "جرد" : "شحنة";
  if (!hit.length) { toast("مفيش حاجة مطابقة"); return; }
  const scope = bulkScope();
  if (!confirm(`حذف ${hit.length} ${noun} (${scope})؟ مش هينفع ترجّعها.`)) return;
  try {
    await db.deleteMany(bulkKind, hit.map(s => s._id));
  } catch (err) {
    console.error(err);
    toast("الحذف ما نفعش — جرّب تاني", "bad");
    return;
  }
  db.logAction(identity, "حذف بالجملة", `${hit.length} ${noun} · ${scope}`);
  if (bulkKind === "counts") counts = await db.listCounts().catch(() => []);
  else shipments = await db.listShipments().catch(() => []);
  renderBulk();
  toast(`تم حذف ${hit.length} ${noun}`);
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
    toast("المسح ما نفعش — جرّب تاني", "bad");
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
  $("sync-state").classList.toggle("off", !navigator.onLine);
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
    suppliers: db.supplierList(window.APP_CONFIG),      // older configs held plain names
    label: lbl.labelCfg(window.APP_CONFIG),
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
