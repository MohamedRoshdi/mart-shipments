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
      String(s.createdAt) === id ? { ...s, name: data.name, items: data.items, type: data.type } : s);
    localStorage.setItem('test-shipments', JSON.stringify(all));
    return;
  }
  await live();
  await fs.updateDoc(fs.doc(dbRef, 'shipments', id), { name: data.name, items: data.items, type: data.type });
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

// Searches the WHOLE catalog, not just the loaded page: name-prefix and barcode-prefix
// queries, HITS each. Prefix, not substring — a mid-word match needs a search service.
export async function searchProducts(q) {
  if (TEST_MODE) {
    const all = await listProducts();
    const s = q.toLowerCase();
    return all.filter((p) => p.name.toLowerCase().includes(s) || p.barcode.includes(q));
  }
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

export async function saveConfig(cfg) {
  if (TEST_MODE) {
    localStorage.setItem('test-config', JSON.stringify(cfg));
    return;
  }
  await live();
  await fs.setDoc(fs.doc(dbRef, 'config', 'app'), cfg);
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
    if (collection === 'shipments') {
      const keep = lsArr('test-shipments').filter((s) => !ids.includes(String(s.createdAt)));
      localStorage.setItem('test-shipments', JSON.stringify(keep));
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
export async function saveProductName(barcode, name) {
  return writeProduct(barcode, { name });
}

// One branch's sheet: barcode, name, quantity. The write is a merge on the branch key, so
// importing شبين الكوم never touches what قويسنا imported.
export async function saveProductRow(barcode, name, qty, branch) {
  if (!Number.isFinite(qty) || !branch) return writeProduct(barcode, { name });
  return writeProduct(barcode, { name, stock: { [branch]: qty } });
}

async function writeProduct(barcode, patch) {
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
