const TEST_MODE = new URLSearchParams(location.search).has('test');
/* Page sizes. Every one of these is a READ per row on the free plan, so a screen that opens with
   300 rows nobody scrolls to has spent 300 of the day's 50,000 for nothing. 50 fills a phone
   screen several times over, and «عرض المزيد» fetches the next 50 from a cursor — never the lot. */
export const PRODUCT_CAP = 50;     // catalog rows per page, server-side (startAfter cursor)
export const JOB_PAGE = 50;        // print jobs per page; «عرض المزيد» re-subscribes with +50
export const LOG_PAGE = 50;        // audit rows per page
/* الصلاحيات cannot be paged: the months on screen are DERIVED from every row, so a half-read
   collection shows a half-truth about which shelf has to be cleared. This is a runaway guard, not
   a page — a shop tracking more than a thousand near-expiry rows has a different problem, and the
   screen says so instead of quietly showing part of it. */
export const EXPIRY_CAP = 1000;
const HITS = 50;                   // rows one search returns

let fs = null;      // firestore module namespace
let dbRef = null;   // firestore instance

let ready = null;   // set by initDb; every call waits on it so nothing races the SDK load

export function initDb() {
  if (TEST_MODE) return Promise.resolve();
  ready = ready || (async () => {
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    fs = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const app = initializeApp(window.FIREBASE_CONFIG);
    dbRef = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache() });
  })();
  return ready;
}

// a call that lands before initDb finished (fast tapping, slow network) must wait, not crash
const live = () => (TEST_MODE ? Promise.resolve() : initDb());

/* The last thing the database refused, kept so a screen can SAY it instead of the shop guessing.
   `resource-exhausted` is the one that matters: on the free plan the day's allowance runs out and
   every write then waits behind a backoff instead of failing, which looks exactly like a hang. */
let lastError = null;
addEventListener('db-error', (e) => {
  const err = e.detail || {};
  lastError = { code: err.code || 'unknown', message: String(err.message || err), at: Date.now() };
});
export const dbError = () => lastError;

function lsArr(key) { return JSON.parse(localStorage.getItem(key) || '[]'); }
function lsObj(key) { return JSON.parse(localStorage.getItem(key) || '{}'); }

/* What THIS DEVICE spent of the day's free allowance. Firestore does not hand a client the
   project's own counters — only Cloud Monitoring does — so this counts what the app itself did
   here, and «حالة النظام» says so in as many words rather than pretending it is the whole shop.
   Reads served from the offline cache are NOT billed, so `fromCache` deliveries are not counted.
   Kept in localStorage: costs no read, no write, and nothing to clean up. The allowance resets at
   midnight Pacific, so the bucket is the Pacific day — the same clock Google bills on. */
export const QUOTA = { reads: 50000, writes: 20000 };
export const quotaDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const blank = () => ({ day: quotaDay(), reads: 0, writes: 0 });
function meter(kind, n = 1) {
  if (TEST_MODE || !n) return;
  try {
    const u = lsObj('usage');
    const cur = u.day === quotaDay() ? u : blank();
    cur[kind] = (cur[kind] || 0) + n;
    localStorage.setItem('usage', JSON.stringify(cur));
  } catch (e) { /* storage full: counting must never be the thing that fails a save */ }
}
export function usage() {
  const u = lsObj('usage');
  return u.day === quotaDay() ? { ...blank(), ...u } : blank();
}

// when the allowance comes back, read off the Pacific clock itself rather than a fixed offset —
// Egypt and California do not change to summer time on the same day
export function nextReset() {
  const [h, m, s] = new Date()
    .toLocaleTimeString('en-GB', { timeZone: 'America/Los_Angeles', hour12: false })
    .split(':').map(Number);
  return Date.now() + (86400 - (h * 3600 + m * 60 + s)) * 1000;
}

/* The shop-wide picture, not just the device you happen to be holding (the owner, 2026-08-02:
   «the admin page needs to see everything to manage the system»). Each device keeps ONE doc in
   `usage`, keyed by its own device id, and OVERWRITES it — so the collection stays as small as the
   number of phones in the shop, for ever. No per-day history to grow, and nothing to clean up.
   The ceiling is stated on purpose: at most one write per device per 10 minutes of real activity,
   plus one as the page unloads. Five devices working a whole day is under 300 writes against the
   20,000 cap. `visibilitychange` is deliberately NOT a trigger — a phone switching apps every
   minute would turn the meter into the thing that spends the allowance. */
const FLUSH_MS = 10 * 60 * 1000;
let me = null, flushedKey = '', flushedAt = 0;

export function reportUsage(id) {
  if (TEST_MODE || !id || !id.device || me) return;   // once per page life
  me = id;
  addEventListener('pagehide', () => { flushUsage(true); });
  setInterval(() => { flushUsage(); }, FLUSH_MS);
  flushUsage(true);
}

export async function flushUsage(now = false) {
  if (!me) return;
  const u = usage();
  const key = `${u.day}:${u.reads}:${u.writes}`;
  if (key === flushedKey) return;                       // nothing moved: a write here is pure waste
  if (!now && Date.now() - flushedAt < FLUSH_MS) return;
  flushedKey = key; flushedAt = Date.now();
  await live();
  setDoc(fs.doc(dbRef, 'usage', String(me.device).slice(0, 60)), {
    day: u.day, reads: u.reads, writes: u.writes,
    who: String(me.who || '—').slice(0, 60),
    branch: String(me.branch || '').slice(0, 40),
    at: Date.now(),
  }).catch((e) => dispatchEvent(new CustomEvent('db-error', { detail: e })));
}

/* A device that is gone (sold phone, wiped browser) should not sit in the list for ever.
   NOT awaited on the network — measured 2026-08-02 in a real browser: with the allowance spent a
   `deleteDoc` await simply never returns, and it hung the caller for 45 seconds. Same reason every
   other write here is fire-and-forget. */
export async function deleteUsage(device) {
  if (TEST_MODE) return;
  await live();
  deleteDoc(fs.doc(dbRef, 'usage', String(device))).catch(console.error);
}

// one read per device in the shop — a handful, and the only way the admin can see past its own screen
export async function listUsage() {
  if (TEST_MODE) return lsArr('test-usage');
  await live();
  const snap = await getDocs(fs.collection(dbRef, 'usage'));
  return snap.docs.map((d) => ({ ...d.data(), _id: d.id }));
}

/* «الشغل لسه ما اتبعتش» — the one thing this app never said out loud. EVERY write here is
   fire-and-forget (deliberately: a phone on a shelf must not wait on a server), so a phone whose
   writes are stuck — offline, or behind the free plan's backoff, which does not FAIL a write but
   parks it — looked exactly like a phone that had saved. The screen said «متصل» because
   `navigator.onLine` was true, and the shipment sat in the phone's own cache while the laptop
   showed nothing. `waitForPendingWrites` is Firestore's own answer: it resolves when everything
   this device wrote has been acknowledged by the server. Only raised after SLOW_MS, or every save
   would blink a warning for the fraction of a second a healthy write takes. */
const SLOW_MS = 8000;
let pending = false, slowTimer = null;
export const hasPending = () => pending;
const setPending = (v) => {
  if (v === pending) return;
  pending = v;
  dispatchEvent(new CustomEvent('db-pending', { detail: v }));
};
/* EVERY refusal has to reach `db-error`, not just the ones a listener happens to catch. Proved in
   a real browser on the live site (2026-08-02 15:34Z): the console had `resource-exhausted`, the
   chip correctly said «لسه بيتبعت...», and «حالة النظام» still said «الحصة اليومية المجانية: شغالة»
   with two green bars — because the one-shot reads and the fire-and-forget writes each swallow
   their own rejection in a caller's `.catch()`, so nothing ever dispatched the event. Announcing it
   here, at the six doors, is the only place that cannot be forgotten by the next call site. */
const announce = (e) => { dispatchEvent(new CustomEvent('db-error', { detail: e })); return e; };
function noteWrite(p) {
  meter('writes');
  if (!slowTimer) slowTimer = setTimeout(() => setPending(true), SLOW_MS);
  p.catch(announce);                  // the caller keeps its own catch; this one only reports
  fs.waitForPendingWrites(dbRef)
    .then(() => { clearTimeout(slowTimer); slowTimer = null; setPending(false); })
    .catch(() => {});
  return p;
}

/* The only four doors to a write, and the two to a read, so the meter — and the unsent-work flag —
   live in one place instead of on thirty call sites. Same signatures as the SDK's. */
const addDoc = (c, d) => noteWrite(fs['addDoc'](c, d));
const setDoc = (r, d, o) => noteWrite(fs['setDoc'](r, d, o));
const updateDoc = (r, d) => noteWrite(fs['updateDoc'](r, d));
const deleteDoc = (r) => noteWrite(fs['deleteDoc'](r));

/* One copy of the words, because all three pages raise the same toast and the quota is the case
   that actually happens. A spent allowance does not fail a write — it parks it — so the message
   has to say the work is safe AND that it has not left the phone yet. */
export const errorText = (err) => ((err && err.code) === 'resource-exhausted'
  ? 'الحصة اليومية المجانية خلصت — شغلك محفوظ على الجهاز، وهيتبعت لوحده أول ما ترجع الساعة ١٠ الصبح'
  : 'مشكلة في مزامنة البيانات — اتأكد من الاتصال والإعدادات');
const billed = (snap) => (snap.metadata && snap.metadata.fromCache ? 0 : undefined);
// a listener delivery: the first one is the whole query, every later one only what changed
const metered = (snap) => meter('reads', billed(snap) ?? (snap.docChanges ? snap.docChanges().length : 1));
const getDocs = async (q) => { const s = await fs.getDocs(q).catch((e) => { throw announce(e); }); meter('reads', billed(s) ?? Math.max(s.size, 1)); return s; };
const getDoc = async (r) => { const s = await fs.getDoc(r).catch((e) => { throw announce(e); }); meter('reads', billed(s) ?? 1); return s; };

/* Every test-mode collection write goes through here so the listeners below hear it. Firestore's
   onSnapshot fires for THIS tab's own writes; the browser's `storage` event never does — it is
   other-tab only. Without this, a page in ?test=1 would see another tab's changes and miss its
   own, which is the opposite of how the real thing behaves. */
function lsPut(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
  dispatchEvent(new CustomEvent('ls-write', { detail: key }));
}

export async function saveShipment(shipment) {
  shipment.createdAt = Date.now();
  if (TEST_MODE) {
    const all = lsArr('test-shipments');
    all.push(shipment);
    lsPut('test-shipments', all);
    return;
  }
  await live();
  // no await on network: Firestore queues the write offline; awaiting would hang UI until server ack
  addDoc(fs.collection(dbRef, 'shipments'), shipment).catch((e) => dispatchEvent(new CustomEvent('db-error', { detail: e })));
}

/* One month at a time. The manager page used to pull every shipment ever saved on every visit —
   fine at a few hundred, not at a few years. `month` is "YYYY-MM"; null still means everything,
   which is what the «الكل» option and the tests use. A range on the field the query is already
   ordered by needs no composite index. */
/* «YYYY-MM» is a month and «YYYY-MM-DD» is a single day — same function, because every caller of
   the month queries wants the day form too and a second range builder would drift from this one.
   A day range is what the employee home actually needs: it shows today, and it used to READ a
   whole month to do it. `new Date(y, m-1, d+1)` rolls over the end of the month by itself. */
export function monthRange(key) {
  if (!key) return null;
  const [y, m, d] = String(key).split('-').map(Number);
  if (d) return [new Date(y, m - 1, d).getTime(), new Date(y, m - 1, d + 1).getTime()];
  return [new Date(y, m - 1, 1).getTime(), new Date(y, m, 1).getTime()];
}

const monthly = async (name, month) => {
  await live();
  const span = monthRange(month);
  const snap = await getDocs(fs.query(fs.collection(dbRef, name),
    ...(span ? [fs.where('createdAt', '>=', span[0]), fs.where('createdAt', '<', span[1])] : []),
    fs.orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => ({ ...d.data(), _id: d.id }));
};

const lsMonth = (key, month) => {
  const span = monthRange(month);
  return lsArr(key)
    .filter((s) => !span || (s.createdAt >= span[0] && s.createdAt < span[1]))
    .map((s) => ({ ...s, _id: String(s.createdAt) }))
    .sort((a, b) => b.createdAt - a.createdAt);
};

export async function listShipments(month) {
  if (TEST_MODE) return lsMonth('test-shipments', month);
  return monthly('shipments', month);
}

/* The manager's list, live: the same month query as `monthly`, but through onSnapshot, so a
   shipment saved on a phone lands on the always-open laptop without anyone reloading («تظهر
   مباشرة على باقي الأجهزة», the owner 2026-08-02). Costs what the one-shot read already cost
   plus one read per actual change — the same arithmetic that justified watchConfig. Fires once
   immediately (cache first), errors surface as db-error AND deliver an empty list, so a caller
   awaiting the first snapshot is never left hanging. */
const watchMonthly = async (name, month, cb) => {
  await live();
  const span = monthRange(month);
  return fs.onSnapshot(fs.query(fs.collection(dbRef, name),
    ...(span ? [fs.where('createdAt', '>=', span[0]), fs.where('createdAt', '<', span[1])] : []),
    fs.orderBy('createdAt', 'desc')),
  (snap) => { metered(snap); cb(snap.docs.map((d) => ({ ...d.data(), _id: d.id }))); },
  (e) => { dispatchEvent(new CustomEvent('db-error', { detail: e })); cb([]); });
};

/* test mode mirrors watchConfig: fire once from localStorage, then relay EVERY write — this tab's
   (`ls-write`, from lsPut) and another tab's (`storage`) — because that is what onSnapshot does. */
const watchLsWith = (key, read, cb) => {
  const relay = (e) => { if ((e.key || e.detail) === key) cb(read()); };
  addEventListener('storage', relay);
  addEventListener('ls-write', relay);
  cb(read());
  return () => { removeEventListener('storage', relay); removeEventListener('ls-write', relay); };
};
const watchLs = (key, month, cb) => watchLsWith(key, () => lsMonth(key, month), cb);

/* الصلاحيات and the print queue are not filed by month, so they get the plain-collection form of
   watchMonthly. Same arithmetic as every other listener here: attaching costs exactly the read the
   one-shot list already cost, and after that only what actually changed. */
const watchAll = async (name, cb, ...q) => {
  await live();
  return fs.onSnapshot(fs.query(fs.collection(dbRef, name), ...q),
    (snap) => { metered(snap); cb(snap.docs.map((d) => ({ ...d.data(), _id: d.id }))); },
    (e) => { dispatchEvent(new CustomEvent('db-error', { detail: e })); cb([]); });
};

export async function watchShipments(month, cb) {
  if (TEST_MODE) return watchLs('test-shipments', month, cb);
  return watchMonthly('shipments', month, cb);
}

export async function watchCounts(month, cb) {
  if (TEST_MODE) return watchLs('test-counts', month, cb);
  return watchMonthly('counts', month, cb);
}

// capped, not paged — see EXPIRY_CAP. `cb` gets the rows; `atCap` tells the screen to say so.
export async function watchExpiry(cb) {
  if (TEST_MODE) return watchLsWith('test-expiry', () => lsArr('test-expiry').slice(0, EXPIRY_CAP), cb);
  await live();
  return watchAll('expiry', cb, fs.orderBy('createdAt', 'desc'), fs.limit(EXPIRY_CAP));
}

// `page` grows by JOB_PAGE per «عرض المزيد»; the caller re-subscribes, which is the only way to
// widen a live query. A wider window re-reads the window — rare, and the list is dozens of rows.
export async function watchJobs(cb, page = JOB_PAGE) {
  if (TEST_MODE) return watchLsWith('test-jobs', () => lsMonth('test-jobs', null).slice(0, page), cb);
  await live();       // the constraints below read `fs`, which only exists once the SDK is loaded
  return watchAll('print_jobs', cb, fs.orderBy('createdAt', 'desc'), fs.limit(page));
}

export async function updateShipment(id, data) {
  if (TEST_MODE) {
    const all = lsArr('test-shipments').map((s) =>
      String(s.createdAt) === id
        ? { ...s, name: data.name, items: data.items, type: data.type, supplierCode: data.supplierCode || '' }
        : s);
    lsPut('test-shipments', all);
    return;
  }
  await live();
  await updateDoc(fs.doc(dbRef, 'shipments', id), {
    name: data.name, items: data.items, type: data.type, supplierCode: data.supplierCode || '',
  });
}

/* A shipment is «تم تحميلها» once someone has taken it into the shop's own system. Two people
   doing that twice is a double stock entry, so who and when are written down and shown before a
   second one is allowed. Absent = nobody has loaded it yet. */
/* «تم الاستيراد»: the two keys erpState() reads. Written when a pulled ERP file proves the
   import (manager.js checkErpFiles); fire-and-forget like every shipment write. */
export async function markImported(id, at, file) {
  if (TEST_MODE) {
    const all = lsArr('test-shipments')
      .map((s) => (String(s.createdAt) === id ? { ...s, erpAt: at, erpFile: file } : s));
    lsPut('test-shipments', all);
    return;
  }
  await live();
  updateDoc(fs.doc(dbRef, 'shipments', id), { erpAt: at, erpFile: String(file).slice(0, 200) })
    .catch((e) => dispatchEvent(new CustomEvent('db-error', { detail: e })));
}

export async function markLoaded(id, who, at) {
  if (TEST_MODE) {
    const all = lsArr('test-shipments')
      .map((s) => (String(s.createdAt) === id ? { ...s, loadedBy: who, loadedAt: at } : s));
    lsPut('test-shipments', all);
    return;
  }
  await live();
  // no await on the network, for the same reason as saveShipment: this runs while the person is
  // waiting for a file to download, and awaiting the ack would hold that up — for ever offline
  updateDoc(fs.doc(dbRef, 'shipments', id), { loadedBy: who, loadedAt: at })
    .catch((e) => dispatchEvent(new CustomEvent('db-error', { detail: e })));
}

export async function deleteShipment(id) {
  if (TEST_MODE) {
    const all = lsArr('test-shipments').filter((s) => String(s.createdAt) !== id);
    lsPut('test-shipments', all);
    return;
  }
  await live();
  await deleteDoc(fs.doc(dbRef, 'shipments', id));
}

// A product row is { name, stock: {branch: qty}, qty? }. Each branch has its own sheet, so the
// stocktake quantity is per branch; `qty` is the older shop-wide import, kept as the fallback
// for every barcode a branch sheet has not covered yet. Test mode also still accepts the
// plain-string form so older seeds keep working.
const prodOf = (v) => (typeof v === 'string' ? { name: v } : (v || {}));
const row = (barcode, v) => ({
  barcode, name: prodOf(v).name, qty: prodOf(v).qty, stock: prodOf(v).stock || {},
  unit: prodOf(v).unit || "",
  unitCode: prodOf(v).unitCode,    // the ERP's own unit number, needed to tell "unchanged" honestly
  price: prodOf(v).price,          // the shelf label fills itself in when the catalog has one
  factor: prodOf(v).factor,        // معامل التحويل, shown on the item sheet only
});

// what the system says this branch holds; null when neither sheet mentioned the product
export function stockFor(product, branch) {
  if (!product) return null;
  const b = product.stock && product.stock[branch];
  if (Number.isFinite(b)) return b;
  return Number.isFinite(product.qty) ? product.qty : null;
}

// one read serves both the shipment name and the stocktake quantity
export async function getProduct(barcode) {
  if (TEST_MODE) {
    const v = lsObj('test-products')[barcode];
    return v === undefined ? null : row(barcode, v);
  }
  await live();
  const snap = await getDoc(fs.doc(dbRef, 'products', barcode));
  return snap.exists() ? row(barcode, snap.data()) : null;
}

export async function getProductName(barcode) {
  const p = await getProduct(barcode);
  return p ? p.name : null;
}

/* كود الصنف keeps its leading zeros in one of the ERP's exports and loses them in another — an
   Excel NUMERIC cell stores 000045 as 45, a CSV keeps the zeros — so the catalog and the person
   can spell the same code two ways. Whichever spelling comes in, the item must carry the
   CATALOG's own spelling: that is the code the ERP gets back in the TXT (the owner, 2026-08-01).
   Only short all-digit codes get the second look — an unknown EAN is a normal, frequent event
   (the refusal sheet) and must not pull the whole catalog just to be refused. */
const zeroless = (c) => String(c).replace(/^0+(?=\d)/, '');
export async function resolveProduct(code) {
  const c = String(code == null ? '' : code).trim();
  const direct = await getProduct(c);
  if (direct) return direct;                     // row() already carries the barcode
  if (!/^\d{1,8}$/.test(c)) return null;
  const rows = await catalogIndex().catch(() => []);
  const hit = rows.find((r) => zeroless(r.barcode) === zeroless(c));
  if (!hit) return null;
  /* The local copy can be up to a week old, so it is a POINTER, never the answer: it says which
     barcode to ask for, and the server says what that product is. Without this re-read a phone
     served the stale row — the old stripped-zero twin that was deleted server-side, with no
     price on it, which is exactly what «الليبل مش بيجيب السعر» looked like (2026-08-02). */
  return (await getProduct(hit.barcode)) || null;
}

/* One page of the catalog, in name order. `afterName` is the last name already on screen — the
   cursor «عرض المزيد» pushes forward with, so browsing a 10k catalog costs PRODUCT_CAP reads a
   page instead of the whole thing, and the shop is never told to search for a product it should
   simply be able to scroll to. */
export async function listProducts(afterName) {
  if (TEST_MODE) {
    const all = Object.entries(lsObj('test-products')).map(([barcode, v]) => row(barcode, v))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
    const from = afterName ? all.findIndex((p) => p.name === afterName) + 1 : 0;
    return all.slice(from, from + PRODUCT_CAP);
  }
  await live();
  const snap = await getDocs(fs.query(fs.collection(dbRef, 'products'), fs.orderBy('name'),
    ...(afterName ? [fs.startAfter(afterName)] : []), fs.limit(PRODUCT_CAP)));
  return snap.docs.map((d) => row(d.id, d.data()));
}

// every product, for the export file (one deliberate full read, never a screen load)
export async function listAllProducts() {
  // NOT listProducts(): that one is a PAGE now, and a diff run against one page would offer to
  // delete every product past the first fifty
  if (TEST_MODE) return Object.entries(lsObj('test-products')).map(([barcode, v]) => row(barcode, v));
  await live();
  const snap = await getDocs(fs.query(fs.collection(dbRef, 'products'), fs.orderBy('name')));
  return snap.docs.map((d) => row(d.id, d.data()));
}

/* ---------- catalog index: what makes a mid-word search possible ---------- */

const INDEX_KEY = 'catalogIndex';
const INDEX_TTL = 7 * 24 * 60 * 60 * 1000;   // a week; a product write on this phone drops it too
let indexRows = null;                        // parsed once per page, not once per keystroke

// Firestore only answers prefix queries, so «لبن» would never find «جهينة لبن». The whole
// catalog is pulled once per phone instead (one full read, then nothing for a week) and searched
// here. Kept in localStorage so a reload is free; a phone that cannot store it keeps the copy in
// memory for the session.
export async function catalogIndex() {
  if (TEST_MODE) return dedupeZeros(await listProducts());
  if (indexRows) return indexRows;
  try {
    const cached = JSON.parse(localStorage.getItem(INDEX_KEY) || 'null');
    if (cached && Array.isArray(cached.rows) && Date.now() - cached.at < INDEX_TTL) {
      // the copy on THIS phone may predate the sweep, so it is de-duplicated on the way out too
      indexRows = dedupeZeros(cached.rows);
      return indexRows;
    }
  } catch (e) { console.error(e); }
  indexRows = dedupeZeros(await listAllProducts());
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify({ at: Date.now(), rows: indexRows }));
  } catch (e) { console.error(e); }          // over the storage quota: the memory copy still serves
  return indexRows;
}

/* One product can never be two rows. The pre-2ad9ba2 imports stored codes with their leading
   zeros stripped, so a copy taken before the 2026-08-02 sweep holds «45» AND «000045» — and a
   name search shows the shop the same product twice. The padded spelling is the ERP's own and
   always wins. This runs on the copy, costs nothing, and needs no read or write: a phone fixes
   its own view the moment it loads this file, instead of waiting for a stamp to reach it. */
const dedupeZeros = (rows) => {
  const padded = new Set(rows.map((r) => String(r.barcode)).filter((b) => /^0+\d/.test(b))
    .map((b) => b.replace(/^0+(?=\d)/, '')));
  return rows.filter((r) => {
    const b = String(r.barcode);
    return /^0+\d/.test(b) || !padded.has(b);
  });
};

export function dropCatalogIndex() {
  indexRows = null;
  try { localStorage.removeItem(INDEX_KEY); } catch (e) { console.error(e); }
}

/* The cross-phone half of freshness: an import stamps the config (one write), the config
   listener every page already runs carries the stamp here in seconds, and a local copy built
   before that import is dropped — so the next search re-pulls instead of serving last week's
   names for up to the TTL. */
export function dropCatalogIndexIfOlder(at) {
  try {
    const cached = JSON.parse(localStorage.getItem(INDEX_KEY) || 'null');
    if ((cached && at > cached.at) || (!cached && indexRows)) dropCatalogIndex();
  } catch { dropCatalogIndex(); }
}

/* «رقم إصدار أو تاريخ آخر تحديث لكل ملف» — one stamp per imported file, kept on the config doc
   because that doc already reaches every phone live. Merge, never set: a stamp must not be able
   to wipe the PINs, and two imports must not wipe each other. */
export async function stampFile(kind, meta) {
  if (TEST_MODE) {
    const cfg = lsObj('test-config');
    cfg.filesMeta = { ...(cfg.filesMeta || {}), [kind]: meta };
    localStorage.setItem('test-config', JSON.stringify(cfg));
    return;
  }
  await live();
  await setDoc(fs.doc(dbRef, 'config', 'app'), { filesMeta: { [kind]: meta } }, { merge: true });
}

// Arabic is typed loosely: أ/إ/آ for ا, ه for ة, ى for ي, plus tatweel and harakat. Search has to
// ignore all of that, otherwise half the catalog is unreachable from a phone keyboard.
export const norm = (s) => String(s || '').toLowerCase()
  .replace(/[ـً-ْ]/g, '')
  .replace(/[أإآ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .trim();

// start of the name first, then anywhere inside it — same for the barcode
function matchRows(rows, s) {
  const starts = [];
  const mids = [];
  for (const p of rows) {
    const n = norm(p.name);
    if (n.startsWith(s) || p.barcode.startsWith(s)) starts.push(p);
    else if (n.includes(s) || p.barcode.includes(s)) mids.push(p);
    if (starts.length >= HITS) break;
  }
  return [...starts, ...mids].slice(0, HITS);
}

// Searches the WHOLE catalog, start or middle of the name. Falls back to the server's prefix
// query when the local copy has nothing — a product added after this phone took its copy.
export async function searchProducts(q) {
  const s = norm(q);
  if (!s) return [];
  let hits = [];
  try { hits = matchRows(await catalogIndex(), s); } catch (e) { console.error(e); }
  if (hits.length || TEST_MODE) return hits;
  await live();
  const found = new Map();
  const collect = (snap) => snap.docs.forEach((d) => found.set(d.id, row(d.id, d.data())));
  const prefix = (field) => fs.query(
    fs.collection(dbRef, 'products'), fs.orderBy(field), fs.startAt(q), fs.endAt(q + '\uf8ff'), fs.limit(HITS)
  );
  if (/^\d{3,}$/.test(q)) collect(await getDocs(prefix(fs.documentId())));
  collect(await getDocs(prefix('name')));
  return [...found.values()];
}

// the real catalog size, even when it is bigger than PRODUCT_CAP
export async function countProducts() {
  if (TEST_MODE) return Object.keys(lsObj('test-products')).length;
  await live();
  meter('reads');                 // a count aggregation is billed as one read, not as the count
  const snap = await fs.getCountFromServer(fs.collection(dbRef, 'products'));
  return snap.data().count;
}

export async function deleteProduct(barcode) {
  dropCatalogIndex();
  if (TEST_MODE) {
    const map = lsObj('test-products');
    delete map[barcode];
    localStorage.setItem('test-products', JSON.stringify(map));
    return;
  }
  await live();
  await deleteDoc(fs.doc(dbRef, 'products', barcode));
}

// One admin-editable settings doc: branches, PINs, shipment types. What it returns is
// merged over the shipped firebase-config.js, so a missing doc changes nothing.
export async function getConfig() {
  if (TEST_MODE) return lsObj('test-config');
  await live();
  const snap = await getDoc(fs.doc(dbRef, 'config', 'app'));
  return snap.exists() ? snap.data() : {};
}

/* The settings doc, live. Firestore is already the sync layer this app was asked for — offline
   writes queue and flush on reconnect, and only changed documents come down the wire — but every
   read in the app was one-shot, so a manager's change reached another phone only when that phone
   next opened the screen. This is the one listener that closes that: permissions, branches,
   suppliers, PINs and the label settings all arrive in seconds.

   A listener is also CHEAPER than the 10–30 s poll that was asked for: it costs one read per
   actual change, where polling costs one per interval per phone against a 50k/day quota.

   Returns its own unsubscribe. Fires once immediately with what is already cached, which is what
   makes it safe to use INSTEAD of getConfig rather than after it — and all three pages used to do
   both, paying a second read of the same doc on every page load.

   The second argument is what made dropping getConfig safe: `fromCache` says this delivery came
   out of the offline cache and never reached the server. `getDoc` could not say that — it resolves
   from the cache too, quite happily, so `cfgFromServer` was set to true by a purely local read.
   That is the exact shape of the accident that emptied the users list: a stale cached copy, a save
   that replaces the whole doc, and nobody told. A cached first delivery is normal (the SDK answers
   instantly, then delivers again from the server), so the flag simply corrects itself seconds
   later — and stays false for a machine that genuinely cannot reach Firestore, which is the case
   that matters. */
export async function watchConfig(onChange) {
  if (TEST_MODE) {
    // the tests seed test-config and reload; another tab writing it is the only live case.
    // Never "from cache": in test mode localStorage IS the server.
    const relay = (e) => { if (e.key === 'test-config') onChange(lsObj('test-config'), false); };
    addEventListener('storage', relay);
    onChange(lsObj('test-config'), false);
    return () => removeEventListener('storage', relay);
  }
  await live();
  return fs.onSnapshot(fs.doc(dbRef, 'config', 'app'),
    (snap) => {
      meter('reads', billed(snap) ?? 1);
      onChange(snap.exists() ? snap.data() : {}, !!(snap.metadata && snap.metadata.fromCache));
    },
    (e) => dispatchEvent(new CustomEvent('db-error', { detail: e })));
}

// A supplier is { code, name } — the code is the one in the shop's own system, typed once in the
// admin page (or imported) and stamped on every shipment. Configs written before the code existed
// hold plain names, and those still read fine.
export const supplierList = (cfg) => ((cfg && cfg.suppliers) || [])
  .map((s) => (typeof s === 'string'
    ? { code: '', name: s }
    : { code: String((s && s.code) || ''), name: String((s && s.name) || '') }))
  .filter((s) => s.name);

// the code is never typed on the shipment screen: it is looked up from the name that was saved,
// so a shipment can never carry a code that belongs to another supplier
export const supplierCodeOf = (cfg, name) =>
  (supplierList(cfg).find((s) => norm(s.name) === norm(name)) || {}).code || '';

export async function saveConfig(cfg) {
  if (TEST_MODE) {
    localStorage.setItem('test-config', JSON.stringify(cfg));
    return;
  }
  await live();
  await setDoc(fs.doc(dbRef, 'config', 'app'), cfg);
}

// Bind a user account to the phone that just signed in with it. Writes the users list only,
// so the admin's other settings are untouched, and never claims an account that already has a
// phone. Fire-and-forget on purpose: a login must not wait on the server (see saveConfig).
export async function claimDevice(pin, device) {
  try {
    if (TEST_MODE) {
      const cfg = lsObj('test-config');
      if (!Array.isArray(cfg.users)) return;
      cfg.users = cfg.users.map((u) => (u.pin === pin && !u.device ? { ...u, device } : u));
      localStorage.setItem('test-config', JSON.stringify(cfg));
      return;
    }
    await live();
    const snap = await getDoc(fs.doc(dbRef, 'config', 'app'));
    /* THE WHOLE LIST goes back, so the copy it was built from has to be the server's. `getDoc`
       resolves out of the offline cache just as readily, and this write carries no audit row —
       a phone signing in with a week-old cached list would silently replace the real one with it,
       and nothing in «آخر العمليات» would ever say so. Binding a device can wait for a connection;
       losing the accounts cannot be undone, because the PINs are stored nowhere else. */
    if (snap.metadata && snap.metadata.fromCache) return;
    const stored = snap.exists() ? snap.data() : null;
    if (!stored || !Array.isArray(stored.users)) return;   // users only live in the code config
    const mine = stored.users.find((u) => u.pin === pin && !u.device);
    if (!mine) return;
    const users = stored.users.map((u) => (u.pin === pin && !u.device ? { ...u, device } : u));
    await updateDoc(fs.doc(dbRef, 'config', 'app'), { users });
    /* Every write that touches the users list has to be explainable. This was the ONE that was
       not: the list has been lost three times in production (2026-07-31, 08-01, 08-03) and «آخر
       العمليات» could only account for the saves. One row per account per phone — a handful, ever. */
    logAction(mine.name, 'ربط جهاز', `${mine.name} · ${users.length} مستخدم`);
  } catch (e) {
    console.error(e);
  }
}

// Audit row. Never throws and never blocks the action it records — a lost log line
// must not turn a working delete into a failed one.
export async function logAction(who, action, target) {
  const row = {
    who: String(who || '—').slice(0, 60),
    action: String(action).slice(0, 40),
    target: String(target || '').slice(0, 120),
    at: Date.now(),
  };
  try {
    if (TEST_MODE) {
      const all = lsArr('test-logs');
      all.push(row);
      localStorage.setItem('test-logs', JSON.stringify(all));
      return;
    }
    await live();
    addDoc(fs.collection(dbRef, 'logs'), row).catch(console.error);
  } catch (e) {
    console.error(e);
  }
}

export async function listLogs(max = LOG_PAGE) {
  if (TEST_MODE) return lsArr('test-logs').sort((a, b) => b.at - a.at).slice(0, max);
  await live();
  const snap = await getDocs(
    fs.query(fs.collection(dbRef, 'logs'), fs.orderBy('at', 'desc'), fs.limit(max))
  );
  return snap.docs.map((d) => d.data());
}

// admin bulk delete for either collection; 500 writes is the Firestore batch limit
export async function deleteMany(collection, ids) {
  if (TEST_MODE) {
    // shipments, counts and expiry are lists keyed by their row id; products is a map by barcode
    const listKey = { shipments: 'test-shipments', counts: 'test-counts', expiry: 'test-expiry' }[collection];
    if (listKey) {
      const keep = lsArr(listKey).filter((r) => !ids.includes(String(r._id || r.createdAt)));
      lsPut(listKey, keep);
    } else {
      const map = lsObj('test-products');
      ids.forEach((id) => delete map[id]);
      localStorage.setItem('test-products', JSON.stringify(map));
    }
    return ids.length;
  }
  await live();
  for (let i = 0; i < ids.length; i += 500) {
    const batch = fs.writeBatch(dbRef);
    const chunk = ids.slice(i, i + 500);
    chunk.forEach((id) => batch.delete(fs.doc(dbRef, collection, id)));
    meter('writes', chunk.length);      // a batch is billed per document, exactly like separate deletes
    await batch.commit();
  }
  return ids.length;
}

// merge, never replace: renaming a product must not drop the stocktake quantity next to it
// The unit is only written when the sheet gave one. Renaming from the catalog screen must not
// wipe a unit an import set, and writeProduct merges key by key.
export async function saveProductName(barcode, name, extra = {}) {
  const { unit, unitCode, price, factor } = extra;
  return writeProduct(barcode, {
    name,
    ...(unit ? { unit } : {}),
    // the ERP's own unit number, kept beside the word so what it sent can be sent back
    ...(Number.isFinite(unitCode) ? { unitCode } : {}),
    // the shop's own export carries the last selling price; a sheet without it must not wipe one
    ...(Number.isFinite(price) && price >= 0 ? { price } : {}),
    // معامل التحويل: shown next to the unit, never multiplied by anything. 1 means "no
    // conversion", which is most of a 10k catalog — not worth a key on every doc.
    ...(Number.isFinite(factor) && factor > 1 ? { factor } : {}),
  });
}

// One branch's sheet writes ONE thing: the quantity, under that branch's key. The catalog file
// is the reference for names, units and prices (the owner, 2026-08-01) — a stock sheet touches
// none of them, and the importer reports a barcode the catalog does not know instead of creating
// it. The write is a merge on the branch key, so importing شبين الكوم never touches قويسنا.
export async function saveProductRow(barcode, qty, branch) {
  return writeProduct(barcode, { stock: { [branch]: qty } });
}

async function writeProduct(barcode, patch) {
  dropCatalogIndex();               // this phone's search copy is now behind the catalog
  if (TEST_MODE) {
    const map = lsObj('test-products');
    const old = prodOf(map[barcode]);
    map[barcode] = { ...old, ...patch, ...(patch.stock ? { stock: { ...old.stock, ...patch.stock } } : {}) };
    localStorage.setItem('test-products', JSON.stringify(map));
    return;
  }
  await live();
  // Firestore merges map fields key by key, which is exactly the per-branch behaviour wanted
  setDoc(fs.doc(dbRef, 'products', barcode), patch, { merge: true })
    .catch((e) => dispatchEvent(new CustomEvent('db-error', { detail: e })));
}

/* ---------- stocktake sessions (الجرد): the same shape as a shipment, plus sys on each item ---------- */

export async function saveCount(count) {
  count.createdAt = Date.now();
  if (TEST_MODE) {
    const all = lsArr('test-counts');
    all.push(count);
    lsPut('test-counts', all);
    return;
  }
  await live();
  // same reasoning as saveShipment: awaiting the network would hang the UI while offline
  addDoc(fs.collection(dbRef, 'counts'), count).catch((e) => dispatchEvent(new CustomEvent('db-error', { detail: e })));
}

export async function listCounts(month) {
  if (TEST_MODE) return lsMonth('test-counts', month);
  return monthly('counts', month);
}

export async function updateCount(id, data) {
  if (TEST_MODE) {
    const all = lsArr('test-counts').map((c) =>
      String(c.createdAt) === id ? { ...c, name: data.name, items: data.items } : c);
    lsPut('test-counts', all);
    return;
  }
  await live();
  await updateDoc(fs.doc(dbRef, 'counts', id), { name: data.name, items: data.items });
}

export async function deleteCount(id) {
  if (TEST_MODE) {
    const keep = lsArr('test-counts').filter((c) => String(c.createdAt) !== id);
    lsPut('test-counts', keep);
    return;
  }
  await live();
  await deleteDoc(fs.doc(dbRef, 'counts', id));
}

/* ---------- print jobs (مهام الطباعة): a saved label queue. The state is derived the same way
   as «تم تحميلها» and the ERP pair — readyAt absent means جديدة, printedAt absent means not
   printed yet — so there is no status column to keep in step with the timestamps. Jobs stay
   after printing on purpose: reprint is the whole point of saving one. The list is one
   unbounded read because a shop holds dozens of jobs, not years of them. ---------- */

export async function saveJob(job) {
  job.createdAt = Date.now();
  if (TEST_MODE) {
    const all = lsArr("test-jobs");
    all.push(job);
    lsPut("test-jobs", all);
    return;
  }
  await live();
  addDoc(fs.collection(dbRef, "print_jobs"), job).catch((e) => dispatchEvent(new CustomEvent("db-error", { detail: e })));
}


// marking ready/printed is fire-and-forget, like every stamp in the app
export async function updateJob(id, patch) {
  if (TEST_MODE) {
    const all = lsArr("test-jobs").map((j) => (String(j.createdAt) === id ? { ...j, ...patch } : j));
    lsPut("test-jobs", all);
    return;
  }
  await live();
  updateDoc(fs.doc(dbRef, "print_jobs", id), patch).catch((e) => dispatchEvent(new CustomEvent("db-error", { detail: e })));
}

export async function deleteJob(id) {
  if (TEST_MODE) {
    const keep = lsArr("test-jobs").filter((j) => String(j.createdAt) !== id);
    lsPut("test-jobs", keep);
    return;
  }
  await live();
  await deleteDoc(fs.doc(dbRef, "print_jobs", id));
}

/* ---------- expiry (الصلاحيات): one row per product and date; months are derived, never stored ---------- */

// the id has to survive two rows added in the same millisecond, which counts/shipments never risk
const expiryId = (e) => `${e.createdAt}-${e.barcode}`;

export async function saveExpiry(row) {
  row.createdAt = Date.now();
  if (TEST_MODE) {
    const all = lsArr('test-expiry');
    all.push({ ...row, _id: expiryId(row) });
    lsPut('test-expiry', all);
    return;
  }
  await live();
  // same reasoning as saveShipment: awaiting the network would hang the UI while offline
  addDoc(fs.collection(dbRef, 'expiry'), row).catch((e) => dispatchEvent(new CustomEvent('db-error', { detail: e })));
}

// no orderBy: sorting by year+month+day on the server would need a composite index, and the
// screen groups the rows into months anyway
// Quantity or date only: a row moves to another month by changing its date, never by re-adding.
// Not awaited on the network, for the same reason the adds are not: a phone on the shelf may be
// offline (or behind a write backoff), and awaiting the server ack would leave the item sheet
// open with nothing happening. The local cache applies the change straight away.
export async function updateExpiry(id, data) {
  const patch = { qty: data.qty, day: data.day, month: data.month, year: data.year,
    ...(data.supplier !== undefined ? { supplier: String(data.supplier).slice(0, 50) } : {}) };
  if (TEST_MODE) {
    const all = lsArr('test-expiry').map((e) => (e._id === id ? { ...e, ...patch } : e));
    lsPut('test-expiry', all);
    return;
  }
  await live();
  updateDoc(fs.doc(dbRef, 'expiry', id), patch)
    .catch((e) => dispatchEvent(new CustomEvent('db-error', { detail: e })));
}

export async function deleteExpiry(id) {
  if (TEST_MODE) {
    const keep = lsArr('test-expiry').filter((e) => e._id !== id);
    lsPut('test-expiry', keep);
    return;
  }
  await live();
  deleteDoc(fs.doc(dbRef, 'expiry', id))
    .catch((e) => dispatchEvent(new CustomEvent('db-error', { detail: e })));
}
