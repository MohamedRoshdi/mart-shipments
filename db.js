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
      String(s.createdAt) === id ? { ...s, name: data.name, items: data.items } : s);
    localStorage.setItem('test-shipments', JSON.stringify(all));
    return;
  }
  await live();
  await fs.updateDoc(fs.doc(dbRef, 'shipments', id), { name: data.name, items: data.items });
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

export async function getProductName(barcode) {
  if (TEST_MODE) return lsObj('test-products')[barcode] || null;
  await live();
  const snap = await fs.getDoc(fs.doc(dbRef, 'products', barcode));
  return snap.exists() ? snap.data().name : null;
}

export async function listProducts() {
  if (TEST_MODE) {
    return Object.entries(lsObj('test-products')).map(([barcode, name]) => ({ barcode, name }));
  }
  // just the first page for the default view; searching goes to the server
  await live();
  const snap = await fs.getDocs(fs.query(fs.collection(dbRef, 'products'), fs.orderBy('name'), fs.limit(PRODUCT_CAP)));
  return snap.docs.map((d) => ({ barcode: d.id, name: d.data().name }));
}

// every product, for the export file (one deliberate full read, not a screen load)
export async function listAllProducts() {
  if (TEST_MODE) return listProducts();
  await live();
  const snap = await fs.getDocs(fs.query(fs.collection(dbRef, 'products'), fs.orderBy('name')));
  return snap.docs.map((d) => ({ barcode: d.id, name: d.data().name }));
}

// Searches the WHOLE catalog, not just the loaded page: name-prefix and barcode-prefix
// queries, 50 hits each. Prefix, not substring — a mid-word match needs a search service.
export async function searchProducts(q) {
  if (TEST_MODE) {
    const all = await listProducts();
    const s = q.toLowerCase();
    return all.filter((p) => p.name.toLowerCase().includes(s) || p.barcode.includes(q));
  }
  await live();
  const found = new Map();
  const collect = (snap) => snap.docs.forEach((d) => found.set(d.id, { barcode: d.id, name: d.data().name }));
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

export async function saveProductName(barcode, name) {
  if (TEST_MODE) {
    const map = lsObj('test-products');
    map[barcode] = name;
    localStorage.setItem('test-products', JSON.stringify(map));
    return;
  }
  await live();
  fs.setDoc(fs.doc(dbRef, 'products', barcode), { name }).catch((e) => dispatchEvent(new CustomEvent('db-error', { detail: e })));
}
