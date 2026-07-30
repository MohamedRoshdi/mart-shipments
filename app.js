import * as db from "./db.js";
import * as auth from "./auth.js";

const $ = (id) => document.getElementById(id);
const esc = (t) => { const d = document.createElement("div"); d.textContent = t; return d.innerHTML; };
const escAttr = (t) => esc(t).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
  "screen-login": "دخول",
  "screen-name": "بيانات الموظف",
  "screen-home": "شحناتي",
  "screen-new": "شحنة جديدة",
  "screen-cam": "إعدادات الكاميرا",
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
  $("btn-back").hidden = id === "screen-home" || id === "screen-login" || (id === "screen-name" && !myName());
  $("btn-cam").hidden = !(id === "screen-home" || id === "screen-new");
  $("who").hidden = !myName() || id !== "screen-home";
  if (myName()) $("who").textContent = `${myName()} · ${myBranch()}`;
  if (id === "screen-home") renderHomeLinks();
  hideSheet();
  scrollTo(0, 0);
}

function navTo(id) {
  if (id !== "screen-new") stopScan();   // leaving the scanner screen must release the camera
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
      ${canDo("edit") ? `<button class="ghost" data-edit="${i}">تعديل</button>` : ""}
    </li>`).join("") || `<li class="empty">لسه مفيش شحنات — ابدأ بـ «شحنة جديدة»</li>`;
}

// no session at all = the old single-PIN setup, where everything was allowed
const canDo = (perm) => !auth.session() || auth.can(perm);

function renderHomeLinks() {
  const s = auth.session();
  $("home-links").hidden = !s;
  $("link-manager").hidden = !(s && s.perms.includes("mgr"));
  $("link-admin").hidden = !(s && s.perms.includes("adm"));
  $("link-manager").href = auth.withQuery("manager.html");   // keep ?test=1 across pages
  $("link-admin").href = auth.withQuery("admin.html");
  $("btn-logout").hidden = !s;
  $("btn-new").hidden = !canDo("create");
  $("who").disabled = !!s;                 // a signed-in user changes their name from the admin page
}

$("btn-logout").onclick = () => {
  auth.endSession();
  localStorage.removeItem("employeeName");
  history.replaceState({ screen: "screen-login" }, "");
  $("login-pin").value = "";
  render("screen-login");
};

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

const CODE_ADMIN_PIN = window.APP_CONFIG.adminPin;   // captured before the stored config wins

function enterEmployee(name, branch) {
  localStorage.setItem("employeeName", name);
  if (branch) localStorage.setItem("employeeBranch", branch);
  state.branch = myBranch();
  history.replaceState({ screen: "screen-home" }, "");
  goHome();
}

// one PIN box for everybody: it sends each user to the page their permissions allow
$("btn-login").onclick = async () => {
  await cfgReady;
  const pin = $("login-pin").value.trim();
  const cfg = window.APP_CONFIG;
  const who = auth.authenticate(pin, cfg, CODE_ADMIN_PIN);
  if (!who) { toast("الرقم السري غلط"); return; }
  if (who.branchPin) {                       // a branch PIN is still the old employee setup
    state.branch = who.branches[0];
    renderBranchPicker();
    $("login-pin").value = "";
    navTo("screen-name");
    toast("اكتب اسمك عشان نكمّل");
    return;
  }
  if (!who.perms.length) { toast("المستخدم ده مالوش صلاحيات — كلّم الأدمن"); return; }
  auth.startSession(who.name, who.branches, who.perms, who.user);
  $("login-pin").value = "";
  if (who.perms.includes("emp")) {
    // more than one branch: keep the one this phone used last if it is still allowed
    const mine = allowedBranches();
    enterEmployee(who.name, mine.includes(myBranch()) ? myBranch() : mine[0]);
    return;
  }
  const page = auth.landingPage(who.perms);
  if (!page) { toast("المستخدم ده مالوش شاشة يفتحها — كلّم الأدمن"); return; }
  auth.goTo(page);                           // manager or admin, per their permissions
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

// the branches this user may stamp a shipment with; no session = the shop's whole list
function allowedBranches() {
  const s = auth.session();
  const all = branches().map(b => b.name);
  if (!s || !s.branches.length) return all;
  const mine = s.branches.filter(b => all.includes(b));
  return mine.length ? mine : all;
}

// one branch → a line of text like before; more than one → the employee picks per shipment
function renderNewBranch() {
  const mine = allowedBranches();
  const multi = mine.length > 1 && !!auth.session();
  $("new-branch").hidden = multi;
  $("new-branch-picker").hidden = !multi;
  if (!multi) { $("new-branch").textContent = state.branch; return; }
  $("new-branch-picker").innerHTML = mine.map(b =>
    `<button type="button" data-newbranch="${escAttr(b)}" aria-pressed="${b === state.branch}">${esc(shortBranch(b))}</button>`).join("");
}

$("new-branch-picker").onclick = (e) => {
  const btn = e.target.closest("button[data-newbranch]");
  if (!btn) return;
  state.branch = btn.dataset.newbranch;
  localStorage.setItem("employeeBranch", state.branch);   // next shipment starts on the same branch
  renderNewBranch();
};

function renderTypePicker() {
  renderNewBranch();
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
  if (!canDo(editing ? "edit" : "create")) { toast("مالكش صلاحية للخطوة دي — كلّم الأدمن"); return; }
  try {
    if (editing) await db.updateShipment(editing, { name, items: state.items, type: state.type });
    else await db.saveShipment({ name, createdBy: myName(), branch: state.branch, type: state.type, items: state.items });
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

// per-phone camera preferences: a shop phone with three back lenses often defaults to the
// one that cannot focus close up, which reads as "the scanner is broken on this phone"
const CAM_DEFAULTS = { deviceId: "", box: "med", torch: false, zoom: 1 };
const camCfg = () => ({ ...CAM_DEFAULTS, ...JSON.parse(localStorage.getItem("camSettings") || "{}") });
const saveCam = (patch) => localStorage.setItem("camSettings", JSON.stringify({ ...camCfg(), ...patch }));

const BOXES = { small: { w: 220, h: 130 }, med: { w: 300, h: 170 }, large: { w: 340, h: 220 } };
const BOX_LABELS = { small: "صغير", med: "متوسط", large: "كبير" };

// retail barcodes + QR only: fewer formats to try per frame means a faster read
const FMT = window.Html5QrcodeSupportedFormats;
const FORMATS = FMT
  ? [FMT.EAN_13, FMT.EAN_8, FMT.UPC_A, FMT.UPC_E, FMT.UPC_EAN_EXTENSION,
     FMT.CODE_128, FMT.CODE_39, FMT.ITF, FMT.QR_CODE].filter((f) => f !== undefined)
  : undefined;

$("btn-scan").onclick = () => (scanner ? stopScan() : startScan());

async function startScan(retried = false) {
  if (scanner) return;
  const s = camCfg();
  const box = BOXES[s.box] || BOXES.med;
  $("reader").hidden = false;
  // the native detector on Android is much faster than the JS decoder when it exists
  scanner = new Html5Qrcode("reader", {
    formatsToSupport: FORMATS,
    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
  });
  try {
    await scanner.start(
      s.deviceId && !retried ? { deviceId: { exact: s.deviceId } } : { facingMode: "environment" },
      { fps: 12, qrbox: { width: Math.min(box.w, innerWidth - 48), height: box.h } },
      async (text) => { await stopScan(); beep(); onBarcode(text.trim()).catch(() => toast("حصلت مشكلة — جرّب تاني")); }
    );
  } catch (err) {
    console.error(err);
    await stopScan();
    if (s.deviceId && !retried) {          // saved camera is not on this phone any more
      saveCam({ deviceId: "" });
      toast("الكاميرا المحفوظة مش موجودة — رجّعنا التلقائي");
      return startScan(true);
    }
    toast("الكاميرا مش متاحة — اكتب الباركود بإيدك");
    return;
  }
  await applyTrack();
}

const constrain = (adv) => (scanner
  ? scanner.applyVideoConstraints({ advanced: [adv] }).catch((e) => console.error(e))
  : Promise.resolve());

// torch and zoom only exist on some phones; the controls appear only when the track has them
async function applyTrack() {
  const s = camCfg();
  let caps = {};
  try { caps = scanner.getRunningTrackCapabilities() || {}; } catch (e) { console.error(e); }
  $("btn-torch").hidden = !caps.torch;
  $("zoom-live-wrap").hidden = !caps.zoom;
  $("cam-live").hidden = !(caps.torch || caps.zoom);
  if (caps.zoom) {
    const z = Math.min(Math.max(s.zoom, caps.zoom.min), caps.zoom.max);
    Object.assign($("zoom-live"), { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.5, value: z });
    await constrain({ zoom: z });
  }
  if (caps.torch) {
    $("btn-torch").setAttribute("aria-pressed", String(!!s.torch));
    await constrain({ torch: !!s.torch });
  }
}

$("btn-torch").onclick = async () => {
  const on = $("btn-torch").getAttribute("aria-pressed") !== "true";
  $("btn-torch").setAttribute("aria-pressed", String(on));
  saveCam({ torch: on });
  await constrain({ torch: on });
};

$("zoom-live").oninput = async () => {
  const z = +$("zoom-live").value;
  saveCam({ zoom: z });
  await constrain({ zoom: z });
};

async function stopScan() {
  if (scanner) {
    try { await scanner.stop(); scanner.clear(); } catch (e) { /* already stopped */ }
    scanner = null;
  }
  $("reader").hidden = true;
  $("cam-live").hidden = true;
}


$("btn-cam").onclick = () => { navTo("screen-cam"); renderCamScreen(); };

async function renderCamScreen() {
  const s = camCfg();
  $("box-picker").innerHTML = Object.keys(BOXES).map(k =>
    `<button type="button" data-box="${k}" aria-pressed="${k === s.box}">${BOX_LABELS[k]}</button>`).join("");
  $("cam-zoom").value = s.zoom;
  $("cam-zoom-val").textContent = `×${s.zoom}`;
  $("btn-torch-default").setAttribute("aria-pressed", String(!!s.torch));

  $("cam-note").textContent = "بندوّر على الكاميرات...";
  $("cam-list").innerHTML = "";
  let cams = [];
  try { cams = await Html5Qrcode.getCameras(); } catch (e) { console.error(e); }
  if (!cams.length) {
    $("cam-note").textContent = "مفيش كاميرا متاحة، أو إذن الكاميرا مرفوض. اسمح بالكاميرا للموقع من إعدادات المتصفح وافتح الصفحة تاني.";
    return;
  }
  $("cam-note").textContent = `${cams.length} كاميرا على الموبايل ده. لو مش عارف مين مين، جرّب واحدة واحدة على باركود صغير.`;
  $("cam-list").innerHTML = [
    `<button type="button" data-cam="" aria-pressed="${!s.deviceId}">تلقائي</button>`,
    ...cams.map((c, i) => `<button type="button" data-cam="${escAttr(c.id)}" aria-pressed="${c.id === s.deviceId}">${esc(c.label || `كاميرا ${i + 1}`)}</button>`),
  ].join("");
}

$("cam-list").onclick = (e) => {
  const btn = e.target.closest("button[data-cam]");
  if (!btn) return;
  saveCam({ deviceId: btn.dataset.cam });
  renderCamScreen();
  toast("اتحفظت — جرّب المسح تاني");
};

$("box-picker").onclick = (e) => {
  const btn = e.target.closest("button[data-box]");
  if (!btn) return;
  saveCam({ box: btn.dataset.box });
  renderCamScreen();
};

$("cam-zoom").oninput = () => {
  const z = +$("cam-zoom").value;
  saveCam({ zoom: z });
  $("cam-zoom-val").textContent = `×${z}`;
};

$("btn-torch-default").onclick = () => {
  const on = $("btn-torch-default").getAttribute("aria-pressed") !== "true";
  $("btn-torch-default").setAttribute("aria-pressed", String(on));
  saveCam({ torch: on });
};

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
  "login-pin": "btn-login",
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

let cfgReady = null;

cfgReady = (async () => {
  const ok = await db.initDb().then(() => true).catch((e) => { console.error(e); return false; });
  dbBroken = !ok;
  updateSync();
  // branches, PINs, types and users the admin edited win over the ones shipped in the code
  Object.assign(window.APP_CONFIG, await db.getConfig().catch(() => ({})));
  state.branch = myBranch();
  if (!types().includes(state.type)) state.type = types()[0];
  renderBranchPicker();

  const s = auth.session();
  const usersExist = (window.APP_CONFIG.users || []).length > 0;
  if (s && s.user && s.perms.includes("emp") && !myName()) {
    // signed in on another page and sent here: don't ask for the PIN a second time
    localStorage.setItem("employeeName", s.name);
    if (s.branches.length === 1) localStorage.setItem("employeeBranch", s.branches[0]);
    state.branch = myBranch();
  }
  if (!allowedBranches().includes(state.branch)) state.branch = allowedBranches()[0];
  if (s && !s.perms.includes("emp")) {          // signed in, but this is not their screen
    const page = auth.landingPage(s.perms);
    if (page && page !== "index.html") { auth.goTo(page); return; }
  }
  if ((s || !usersExist) && myName()) {
    history.replaceState({ screen: "screen-home" }, "");
    goHome();
  } else if (usersExist) {                      // users configured → the PIN decides who you are
    history.replaceState({ screen: "screen-login" }, "");
    render("screen-login");
  } else {
    history.replaceState({ screen: "screen-name" }, "");
    render("screen-name");
  }
})();

if ("serviceWorker" in navigator && !new URLSearchParams(location.search).has("test")) {
  navigator.serviceWorker.register("./sw.js");
}
