const TEST_MODE = new URLSearchParams(location.search).has('test');
export const PRODUCT_CAP = 300;    // catalog rows the screen pulls before searching
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

function lsArr(key) { return JSON.parse(localStorage.getItem(key) || '[]'); }
function lsObj(key) { return JSON.parse(localStorage.getItem(key) || '{}'); }

export async function saveShipment(shipment) {
  shipment.createdAt = Date.now();
  if (TEST_MODE) {
    const all = lsArr('test-shipments');
    all.push(shipment);
    localStorage.setItem('test-shipments', JSON.stringify(all));
    return;
  }
  await live();
  // no await on network: Firestore queues the write offline; awaiting would hang UI until server ack
  fs.addDoc(fs.collection(dbRef, 'shipments'), shipment).catch((e) => dispatchEvent(new CustomEvent('db-error', { detail: e })));
}

export async function listShipments() {
  if (TEST_MODE) {
    return lsArr('test-shipments')
      .map((s) => ({ ...s, _id: String(s.createdAt) }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  await live();
  const snap = await fs.getDocs(
    fs.query(fs.collection(dbRef, 'shipments'), fs.orderBy('createdAt', 'desc'))
  );
  return snap.docs.map((d) => ({ ...d.data(), _id: d.id }));
}

export async function updateShipment(id, data) {
  if (TEST_MODE) {
    const all = lsArr('test-shipments').map((s) =>
      String(s.createdAt) === id
        ? { ...s, name: data.name, items: data.items, type: data.type, supplierCode: data.supplierCode || '' }
        : s);
    localStorage.setItem('test-shipments', JSON.stringify(all));
    return;
  }
  await live();
  await fs.updateDoc(fs.doc(dbRef, 'shipments', id), {
    name: data.name, items: data.items, type: data.type, supplierCode: data.supplierCode || '',
  });
}

export async function deleteShipment(id) {
  if (TEST_MODE) {
    const all = lsArr('test-shipments').filter((s) => String(s.createdAt) !== id);
    localStorage.setItem('test-shipments', JSON.stringify(all));
    return;
  }
  await live();
  await fs.deleteDoc(fs.doc(dbRef, 'shipments', id));
}

// A product row is { name, stock: {branch: qty}, qty? }. Each branch has its own sheet, so the
// stocktake quantity is per branch; `qty` is the older shop-wide import, kept as the fallback
// for every barcode a branch sheet has not covered yet. Test mode also still accepts the
// plain-string form so older seeds keep working.
const prodOf = (v) => (typeof v === 'string' ? { name: v } : (v || {}));
const row = (barcode, v) => ({
  barcode, name: prodOf(v).name, qty: prodOf(v).qty, stock: prodOf(v).stock || {},
  unit: prodOf(v).unit || "",
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
  const snap = await fs.getDoc(fs.doc(dbRef, 'products', barcode));
  return snap.exists() ? row(barcode, snap.data()) : null;
}

export async function getProductName(barcode) {
  const p = await getProduct(barcode);
  return p ? p.name : null;
}

// first page only for the default view; searching goes to the server
export async function listProducts() {
  if (TEST_MODE) {
    return Object.entries(lsObj('test-products')).map(([barcode, v]) => row(barcode, v));
  }
  await live();
  const snap = await fs.getDocs(fs.query(fs.collection(dbRef, 'products'), fs.orderBy('name'), fs.limit(PRODUCT_CAP)));
  return snap.docs.map((d) => row(d.id, d.data()));
}

// every product, for the export file (one deliberate full read, never a screen load)
export async function listAllProducts() {
  if (TEST_MODE) return listProducts();
  await live();
  const snap = await fs.getDocs(fs.query(fs.collection(dbRef, 'products'), fs.orderBy('name')));
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
  if (TEST_MODE) return listProducts();
  if (indexRows) return indexRows;
  try {
    const cached = JSON.parse(localStorage.getItem(INDEX_KEY) || 'null');
    if (cached && Array.isArray(cached.rows) && Date.now() - cached.at < INDEX_TTL) {
      indexRows = cached.rows;
      return indexRows;
    }
  } catch (e) { console.error(e); }
  indexRows = await listAllProducts();
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify({ at: Date.now(), rows: indexRows }));
  } catch (e) { console.error(e); }          // over the storage quota: the memory copy still serves
  return indexRows;
}

export function dropCatalogIndex() {
  indexRows = null;
  try { localStorage.removeItem(INDEX_KEY); } catch (e) { console.error(e); }
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
  if (/^\d{3,}$/.test(q)) collect(await fs.getDocs(prefix(fs.documentId())));
  collect(await fs.getDocs(prefix('name')));
  return [...found.values()];
}

// the real catalog size, even when it is bigger than PRODUCT_CAP
export async function countProducts() {
  if (TEST_MODE) return Object.keys(lsObj('test-products')).length;
  await live();
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
  await fs.deleteDoc(fs.doc(dbRef, 'products', barcode));
}

// One admin-editable settings doc: branches, PINs, shipment types. What it returns is
// merged over the shipped firebase-config.js, so a missing doc changes nothing.
export async function getConfig() {
  if (TEST_MODE) return lsObj('test-config');
  await live();
  const snap = await fs.getDoc(fs.doc(dbRef, 'config', 'app'));
  return snap.exists() ? snap.data() : {};
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
  await fs.setDoc(fs.doc(dbRef, 'config', 'app'), cfg);
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
    const snap = await fs.getDoc(fs.doc(dbRef, 'config', 'app'));
    const stored = snap.exists() ? snap.data() : null;
    if (!stored || !Array.isArray(stored.users)) return;   // users only live in the code config
    if (!stored.users.some((u) => u.pin === pin && !u.device)) return;
    const users = stored.users.map((u) => (u.pin === pin && !u.device ? { ...u, device } : u));
    await fs.updateDoc(fs.doc(dbRef, 'config', 'app'), { users });
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
    fs.addDoc(fs.collection(dbRef, 'logs'), row).catch(console.error);
  } catch (e) {
    console.error(e);
  }
}

export async function listLogs(max = 100) {
  if (TEST_MODE) return lsArr('test-logs').sort((a, b) => b.at - a.at).slice(0, max);
  await live();
  const snap = await fs.getDocs(
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
      localStorage.setItem(listKey, JSON.stringify(keep));
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
    ids.slice(i, i + 500).forEach((id) => batch.delete(fs.doc(dbRef, collection, id)));
    await batch.commit();
  }
  return ids.length;
}

// merge, never replace: renaming a product must not drop the stocktake quantity next to it
// The unit is only written when the sheet gave one. Renaming from the catalog screen must not
// wipe a unit an import set, and writeProduct merges key by key.
export async function saveProductName(barcode, name, unit) {
  return writeProduct(barcode, unit ? { name, unit } : { name });
}

// One branch's sheet: barcode, name, quantity. The write is a merge on the branch key, so
// importing شبين الكوم never touches what قويسنا imported.
export async function saveProductRow(barcode, name, qty, branch) {
  if (!Number.isFinite(qty) || !branch) return writeProduct(barcode, { name });
  return writeProduct(barcode, { name, stock: { [branch]: qty } });
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
  fs.setDoc(fs.doc(dbRef, 'products', barcode), patch, { merge: true })
    .catch((e) => dispatchEvent(new CustomEvent('db-error', { detail: e })));
}

/* ---------- stocktake sessions (الجرد): the same shape as a shipment, plus sys on each item ---------- */

export async function saveCount(count) {
  count.createdAt = Date.now();
  if (TEST_MODE) {
    const all = lsArr('test-counts');
    all.push(count);
    localStorage.setItem('test-counts', JSON.stringify(all));
    return;
  }
  await live();
  // same reasoning as saveShipment: awaiting the network would hang the UI while offline
  fs.addDoc(fs.collection(dbRef, 'counts'), count).catch((e) => dispatchEvent(new CustomEvent('db-error', { detail: e })));
}

export async function listCounts() {
  if (TEST_MODE) {
    return lsArr('test-counts')
      .map((c) => ({ ...c, _id: String(c.createdAt) }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  await live();
  const snap = await fs.getDocs(fs.query(fs.collection(dbRef, 'counts'), fs.orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => ({ ...d.data(), _id: d.id }));
}

export async function updateCount(id, data) {
  if (TEST_MODE) {
    const all = lsArr('test-counts').map((c) =>
      String(c.createdAt) === id ? { ...c, name: data.name, items: data.items } : c);
    localStorage.setItem('test-counts', JSON.stringify(all));
    return;
  }
  await live();
  await fs.updateDoc(fs.doc(dbRef, 'counts', id), { name: data.name, items: data.items });
}

export async function deleteCount(id) {
  if (TEST_MODE) {
    const keep = lsArr('test-counts').filter((c) => String(c.createdAt) !== id);
    localStorage.setItem('test-counts', JSON.stringify(keep));
    return;
  }
  await live();
  await fs.deleteDoc(fs.doc(dbRef, 'counts', id));
}

/* ---------- expiry (الصلاحيات): one row per product and date; months are derived, never stored ---------- */

// the id has to survive two rows added in the same millisecond, which counts/shipments never risk
const expiryId = (e) => `${e.createdAt}-${e.barcode}`;

export async function saveExpiry(row) {
  row.createdAt = Date.now();
  if (TEST_MODE) {
    const all = lsArr('test-expiry');
    all.push({ ...row, _id: expiryId(row) });
    localStorage.setItem('test-expiry', JSON.stringify(all));
    return;
  }
  await live();
  // same reasoning as saveShipment: awaiting the network would hang the UI while offline
  fs.addDoc(fs.collection(dbRef, 'expiry'), row).catch((e) => dispatchEvent(new CustomEvent('db-error', { detail: e })));
}

// no orderBy: sorting by year+month+day on the server would need a composite index, and the
// screen groups the rows into months anyway
export async function listExpiry() {
  if (TEST_MODE) return lsArr('test-expiry');
  await live();
  const snap = await fs.getDocs(fs.collection(dbRef, 'expiry'));
  return snap.docs.map((d) => ({ ...d.data(), _id: d.id }));
}

// Quantity or date only: a row moves to another month by changing its date, never by re-adding.
// Not awaited on the network, for the same reason the adds are not: a phone on the shelf may be
// offline (or behind a write backoff), and awaiting the server ack would leave the item sheet
// open with nothing happening. The local cache applies the change straight away.
export async function updateExpiry(id, data) {
  const patch = { qty: data.qty, day: data.day, month: data.month, year: data.year };
  if (TEST_MODE) {
    const all = lsArr('test-expiry').map((e) => (e._id === id ? { ...e, ...patch } : e));
    localStorage.setItem('test-expiry', JSON.stringify(all));
    return;
  }
  await live();
  fs.updateDoc(fs.doc(dbRef, 'expiry', id), patch)
    .catch((e) => dispatchEvent(new CustomEvent('db-error', { detail: e })));
}

export async function deleteExpiry(id) {
  if (TEST_MODE) {
    const keep = lsArr('test-expiry').filter((e) => e._id !== id);
    localStorage.setItem('test-expiry', JSON.stringify(keep));
    return;
  }
  await live();
  fs.deleteDoc(fs.doc(dbRef, 'expiry', id))
    .catch((e) => dispatchEvent(new CustomEvent('db-error', { detail: e })));
}
