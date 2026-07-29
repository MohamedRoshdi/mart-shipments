const TEST_MODE = new URLSearchParams(location.search).has('test');

let fs = null;      // firestore module namespace
let dbRef = null;   // firestore instance

export async function initDb() {
  if (TEST_MODE) return;
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
  fs = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  const app = initializeApp(window.FIREBASE_CONFIG);
  dbRef = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache() });
}

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
  // no await on network: Firestore queues the write offline; awaiting would hang UI until server ack
  fs.addDoc(fs.collection(dbRef, 'shipments'), shipment).catch((e) => dispatchEvent(new CustomEvent('db-error', { detail: e })));
}

export async function listShipments() {
  if (TEST_MODE) {
    return lsArr('test-shipments')
      .map((s) => ({ ...s, _id: String(s.createdAt) }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  const snap = await fs.getDocs(
    fs.query(fs.collection(dbRef, 'shipments'), fs.orderBy('createdAt', 'desc'))
  );
  return snap.docs.map((d) => ({ ...d.data(), _id: d.id }));
}

export async function deleteShipment(id) {
  if (TEST_MODE) {
    const all = lsArr('test-shipments').filter((s) => String(s.createdAt) !== id);
    localStorage.setItem('test-shipments', JSON.stringify(all));
    return;
  }
  await fs.deleteDoc(fs.doc(dbRef, 'shipments', id));
}

export async function getProductName(barcode) {
  if (TEST_MODE) return lsObj('test-products')[barcode] || null;
  const snap = await fs.getDoc(fs.doc(dbRef, 'products', barcode));
  return snap.exists() ? snap.data().name : null;
}

export async function saveProductName(barcode, name) {
  if (TEST_MODE) {
    const map = lsObj('test-products');
    map[barcode] = name;
    localStorage.setItem('test-products', JSON.stringify(map));
    return;
  }
  fs.setDoc(fs.doc(dbRef, 'products', barcode), { name }).catch((e) => dispatchEvent(new CustomEvent('db-error', { detail: e })));
}
