# Shipment Intake PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Free installable PWA: supermarket employees scan barcodes to record incoming shipments; manager sees all shipments and copies any as plain text.

**Architecture:** Vanilla HTML/JS/CSS single-page app, no framework, no build step. Screens are `<section>` elements toggled by a tiny `show()` router. Data layer (`db.js`) has two modes: `?test=1` URL param → localStorage (used by Playwright tests), otherwise Firebase Firestore with offline persistence. Hosted on GitHub Pages.

**Tech Stack:** Vanilla JS (ES modules), Firebase Firestore v10 (ESM from gstatic CDN), html5-qrcode 2.3.8 (vendored), Playwright for tests, Python http.server for local serving.

## Global Constraints

- UI language: Arabic only, Egyptian dialect, `<html lang="ar" dir="rtl">`.
- CSS logical properties only: `margin-inline`, `inset-inline`, `border-block-end`, `ms-/me-` equivalents — never `left`/`right` physical props.
- Barcodes, quantities, PIN inputs: `dir="ltr"`.
- All user-supplied text rendered through `esc()` helper (XSS guard) — never raw innerHTML interpolation.
- No framework, no bundler, no npm runtime deps. npm is dev-only (Playwright).
- Manager PIN: `2580`, defined in `firebase-config.js` as `window.APP_CONFIG.managerPin`. Client-side gate only (accepted trade-off per spec).
- Test URL: every Playwright test navigates with `?test=1` (localStorage db mode) except the PWA task test.
- Working dir: `/home/roshdy/Work/empire/projects/projects/alaelah-mart` (repo root = web root).
- Commit after every task. Plain `git commit` (repo has no hooks/Pint — not a Laravel project).

## File Structure

| File | Responsibility |
|---|---|
| `index.html` | All screens' static markup (written once in Task 1) |
| `style.css` | Mobile-first RTL styling (written once in Task 1) |
| `app.js` | Screen logic, grows task by task |
| `db.js` | Data layer: test-mode localStorage / Firestore (Task 2) |
| `firebase-config.js` | `window.FIREBASE_CONFIG` + `window.APP_CONFIG` (Task 1 skeleton, friend pastes real config later) |
| `vendor/html5-qrcode.min.js` | Scanner lib (Task 5) |
| `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` | PWA (Task 6) |
| `firestore.rules`, `SETUP.md` | Firebase rules + owner setup guide (Task 7) |
| `tests/app.spec.js`, `playwright.config.js` | Smoke tests |

---

### Task 1: Scaffold — all markup, styling, name/home flow, Playwright

**Files:**
- Create: `index.html`, `style.css`, `app.js`, `firebase-config.js`, `.gitignore`, `playwright.config.js`, `tests/app.spec.js`

**Interfaces:**
- Produces: `show(id)` router, `$(id)` helper, `esc(text)` helper, `myName()`, `goHome()`, `toast(msg)` — all later tasks use these exact names. Section ids: `screen-name`, `screen-home`, `screen-new`, `screen-pin`, `screen-manager`, `screen-detail`.

- [ ] **Step 1: Playwright setup**

```bash
cd /home/roshdy/Work/empire/projects/projects/alaelah-mart
npm init -y
npm i -D @playwright/test
npx playwright install chromium
```

Create `.gitignore`:

```
node_modules/
test-results/
playwright-report/
```

Create `playwright.config.js`:

```js
module.exports = {
  testDir: 'tests',
  webServer: {
    command: 'python3 -m http.server 8080',
    port: 8080,
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://localhost:8080',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
};
```

- [ ] **Step 2: Write failing test**

`tests/app.spec.js`:

```js
const { test, expect } = require('@playwright/test');

test('first open asks name, saves, shows home', async ({ page }) => {
  await page.goto('/?test=1');
  await expect(page.locator('#screen-name')).toBeVisible();
  await page.fill('#employee-name', 'أحمد');
  await page.click('#save-name');
  await expect(page.locator('#screen-home')).toBeVisible();
  await page.reload();
  await expect(page.locator('#screen-home')).toBeVisible();
});
```

- [ ] **Step 3: Run test, verify fails**

Run: `npx playwright test`
Expected: FAIL (no index.html → ERR or locator timeout)

- [ ] **Step 4: Write markup, styles, initial app.js**

`index.html` (complete — later tasks only add the vendor script tag):

```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0a7d33">
  <title>شحنات المحل</title>
  <link rel="stylesheet" href="style.css">
  <link rel="manifest" href="manifest.json">
</head>
<body>
  <header>
    <h1>شحنات المحل</h1>
    <span id="sync-state"></span>
  </header>
  <main>
    <section id="screen-name" hidden>
      <h2>أهلاً بيك! اكتب اسمك</h2>
      <input id="employee-name" type="text" placeholder="الاسم">
      <button id="save-name" class="primary big">حفظ</button>
    </section>

    <section id="screen-home" hidden>
      <button id="btn-new" class="primary big">+ شحنة جديدة</button>
      <h2>شحناتي</h2>
      <ul id="my-shipments"></ul>
      <button id="btn-manager" class="link">دخول المدير</button>
    </section>

    <section id="screen-new" hidden>
      <button class="btn-back link">→ رجوع</button>
      <input id="shipment-name" type="text" placeholder="اسم الشحنة (مثلاً: شحنة المراعي)">
      <button id="btn-scan" class="primary big">📷 امسح الباركود</button>
      <div id="reader" hidden></div>
      <div class="manual">
        <input id="barcode-input" type="text" inputmode="numeric" placeholder="أو اكتب الباركود" dir="ltr">
        <button id="btn-lookup">بحث</button>
      </div>
      <div id="item-form" hidden>
        <p>الباركود: <span id="item-barcode" dir="ltr"></span></p>
        <input id="item-name" type="text" placeholder="اسم الصنف">
        <div class="qty-row">
          <button id="qty-minus">−</button>
          <input id="item-qty" type="number" value="1" min="1" dir="ltr">
          <button id="qty-plus">+</button>
        </div>
        <button id="btn-add-item" class="primary">إضافة الصنف</button>
      </div>
      <ul id="items-list"></ul>
      <button id="btn-save-shipment" class="primary big" disabled>حفظ الشحنة</button>
    </section>

    <section id="screen-pin" hidden>
      <button class="btn-back link">→ رجوع</button>
      <h2>الرقم السري للمدير</h2>
      <input id="pin-input" type="password" inputmode="numeric" maxlength="4" dir="ltr">
      <button id="btn-pin" class="primary big">دخول</button>
    </section>

    <section id="screen-manager" hidden>
      <button class="btn-back link">→ رجوع</button>
      <h2>كل الشحنات</h2>
      <ul id="all-shipments"></ul>
    </section>

    <section id="screen-detail" hidden>
      <button id="btn-back-manager" class="link">→ رجوع</button>
      <h2 id="detail-title"></h2>
      <p id="detail-meta"></p>
      <table><tbody id="detail-items"></tbody></table>
      <button id="btn-copy" class="primary big">نسخ كنص</button>
    </section>
  </main>
  <div id="toast"></div>
  <script src="firebase-config.js"></script>
  <script type="module" src="app.js"></script>
</body>
</html>
```

`style.css` (complete):

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; background: #f4f4f4; }
header { background: #0a7d33; color: #fff; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; }
header h1 { margin: 0; font-size: 1.2rem; }
#sync-state { font-size: .8rem; opacity: .9; }
main { padding: 16px; max-width: 480px; margin-inline: auto; }
section > * + * { margin-block-start: 12px; }
input, button { font: inherit; }
input[type=text], input[type=password], input[type=number] {
  width: 100%; padding: 12px; border: 1px solid #ccc; border-radius: 8px;
}
button { padding: 12px 16px; border: 0; border-radius: 8px; background: #e0e0e0; cursor: pointer; }
button.primary { background: #0a7d33; color: #fff; }
button.big { width: 100%; font-size: 1.1rem; padding: 16px; }
button:disabled { opacity: .5; }
button.link { background: none; color: #0a7d33; text-decoration: underline; padding: 8px; }
.qty-row { display: flex; gap: 8px; align-items: center; }
.qty-row input { text-align: center; }
.qty-row button { inline-size: 48px; font-size: 1.3rem; }
.manual { display: flex; gap: 8px; }
.manual input { flex: 1; }
ul { list-style: none; padding: 0; }
li { background: #fff; border-radius: 8px; padding: 12px; margin-block-end: 8px; }
li button.shipment-row { inline-size: 100%; text-align: start; background: none; padding: 0; }
table { inline-size: 100%; background: #fff; border-radius: 8px; border-collapse: collapse; }
td { padding: 10px 12px; border-block-end: 1px solid #eee; }
#reader { border-radius: 8px; overflow: hidden; }
#toast { position: fixed; inset-block-end: 24px; inset-inline: 16px; background: #333; color: #fff;
  padding: 12px; border-radius: 8px; text-align: center; opacity: 0; transition: opacity .3s; pointer-events: none; }
#toast.show { opacity: 1; }
```

`firebase-config.js`:

```js
// يُلصق صاحب المحل إعدادات Firebase هنا (راجع SETUP.md)
window.FIREBASE_CONFIG = {};
window.APP_CONFIG = { managerPin: '2580' };
```

`app.js` (initial):

```js
const $ = (id) => document.getElementById(id);

function show(id) {
  document.querySelectorAll('main > section').forEach(s => s.hidden = true);
  $(id).hidden = false;
}

function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

function myName() { return localStorage.getItem('employeeName'); }

function toast(msg) {
  $('toast').textContent = msg;
  $('toast').classList.add('show');
  setTimeout(() => $('toast').classList.remove('show'), 2000);
}

async function goHome() {
  show('screen-home');
}

$('save-name').onclick = () => {
  const n = $('employee-name').value.trim();
  if (!n) return;
  localStorage.setItem('employeeName', n);
  goHome();
};

document.querySelectorAll('.btn-back').forEach(b => b.onclick = goHome);

if (myName()) goHome(); else show('screen-name');
```

- [ ] **Step 5: Run test, verify passes**

Run: `npx playwright test`
Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: app shell, name/home screens, playwright smoke"
```

---

### Task 2: Data layer `db.js` (test mode + Firestore)

**Files:**
- Create: `db.js`
- Modify: `app.js` (add import + init)
- Test: `tests/app.spec.js` (append)

**Interfaces:**
- Produces (exact exports of `db.js`):
  - `initDb(): Promise<void>` — no-op in test mode
  - `saveShipment({name, createdBy, items}): Promise<void>` — stamps `createdAt: Date.now()`
  - `listShipments(): Promise<Array<{name, createdBy, createdAt, items}>>` — newest first
  - `getProductName(barcode): Promise<string|null>`
  - `saveProductName(barcode, name): Promise<void>`
- Items shape everywhere: `{barcode: string, name: string, qty: number}`
- Test-mode localStorage keys: `test-shipments` (JSON array), `test-products` (JSON object barcode→name)

- [ ] **Step 1: Write failing test (append to `tests/app.spec.js`)**

```js
test('db test mode roundtrip', async ({ page }) => {
  await page.goto('/?test=1');
  const result = await page.evaluate(async () => {
    const db = await import('./db.js');
    await db.saveProductName('123', 'لبن');
    const name = await db.getProductName('123');
    await db.saveShipment({ name: 'ش١', createdBy: 'أحمد', items: [{ barcode: '123', name: 'لبن', qty: 2 }] });
    const list = await db.listShipments();
    return { name, count: list.length, first: list[0].name };
  });
  expect(result).toEqual({ name: 'لبن', count: 1, first: 'ش١' });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx playwright test`
Expected: new test FAILS (db.js 404)

- [ ] **Step 3: Implement `db.js`**

```js
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
  fs.addDoc(fs.collection(dbRef, 'shipments'), shipment);
}

export async function listShipments() {
  if (TEST_MODE) return lsArr('test-shipments').sort((a, b) => b.createdAt - a.createdAt);
  const snap = await fs.getDocs(
    fs.query(fs.collection(dbRef, 'shipments'), fs.orderBy('createdAt', 'desc'))
  );
  return snap.docs.map(d => d.data());
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
  fs.setDoc(fs.doc(dbRef, 'products', barcode), { name });
}
```

Modify `app.js`: add at top:

```js
import * as db from './db.js';
```

and replace the last line block:

```js
(async () => {
  await db.initDb().catch(console.error);
  if (myName()) goHome(); else show('screen-name');
})();
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx playwright test`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: db layer with test mode and firestore offline"
```

---

### Task 3: New-shipment flow (manual barcode path)

**Files:**
- Modify: `app.js`
- Test: `tests/app.spec.js` (append)

**Interfaces:**
- Consumes: `db.*` from Task 2, helpers from Task 1.
- Produces: `onBarcode(code)` — single entry point for both manual input and camera scan (Task 5 calls it); `renderItems()`; module-level `state = { items, currentBarcode, currentShipmentList }`.

- [ ] **Step 1: Write failing test (append)**

```js
test('create shipment: catalog memory + duplicate merge', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => localStorage.setItem('employeeName', 'أحمد'));
  await page.reload();
  await page.click('#btn-new');
  await page.fill('#shipment-name', 'شحنة المراعي');
  await page.fill('#barcode-input', '6221031250057');
  await page.click('#btn-lookup');
  await page.fill('#item-name', 'لبن كامل الدسم');
  await page.click('#qty-plus'); // qty = 2
  await page.click('#btn-add-item');
  await page.fill('#barcode-input', '6221031250057');
  await page.click('#btn-lookup');
  await expect(page.locator('#item-name')).toHaveValue('لبن كامل الدسم'); // catalog remembered
  await page.click('#btn-add-item'); // qty 1 more → merge to 3
  await expect(page.locator('#items-list li')).toHaveCount(1);
  await expect(page.locator('#items-list li')).toContainText('× 3');
  await page.click('#btn-save-shipment');
  await expect(page.locator('#screen-home')).toBeVisible();
  await expect(page.locator('#my-shipments li')).toContainText('شحنة المراعي');
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx playwright test`
Expected: new test FAILS (btn-new has no handler)

- [ ] **Step 3: Implement in `app.js`**

Add after the helpers:

```js
const state = { items: [], currentBarcode: null, currentShipmentList: [] };
```

Replace `goHome` body:

```js
async function goHome() {
  show('screen-home');
  const all = await db.listShipments();
  const mine = all.filter(s => s.createdBy === myName());
  $('my-shipments').innerHTML = mine.map(s =>
    `<li>${esc(s.name)} — ${s.items.length} صنف</li>`).join('') || '<li>لا توجد شحنات</li>';
}
```

Add handlers:

```js
$('btn-new').onclick = () => {
  state.items = [];
  state.currentBarcode = null;
  $('shipment-name').value = '';
  $('barcode-input').value = '';
  $('item-form').hidden = true;
  renderItems();
  show('screen-new');
};

$('btn-lookup').onclick = () => {
  const code = $('barcode-input').value.trim();
  if (code) onBarcode(code);
};

async function onBarcode(code) {
  state.currentBarcode = code;
  $('item-barcode').textContent = code;
  const known = await db.getProductName(code);
  $('item-name').value = known || '';
  $('item-qty').value = 1;
  $('item-form').hidden = false;
  if (!known) $('item-name').focus();
}

$('qty-plus').onclick = () => { $('item-qty').value = +$('item-qty').value + 1; };
$('qty-minus').onclick = () => { $('item-qty').value = Math.max(1, +$('item-qty').value - 1); };

$('btn-add-item').onclick = async () => {
  const name = $('item-name').value.trim();
  const qty = Math.max(1, parseInt($('item-qty').value, 10) || 1);
  if (!name || !state.currentBarcode) { toast('اكتب اسم الصنف'); return; }
  const existing = await db.getProductName(state.currentBarcode);
  if (existing !== name) await db.saveProductName(state.currentBarcode, name);
  const dup = state.items.find(i => i.barcode === state.currentBarcode);
  if (dup) dup.qty += qty; else state.items.push({ barcode: state.currentBarcode, name, qty });
  $('item-form').hidden = true;
  $('barcode-input').value = '';
  renderItems();
};

function renderItems() {
  $('items-list').innerHTML = state.items.map(i => `<li>${esc(i.name)} × ${i.qty}</li>`).join('');
  $('btn-save-shipment').disabled = state.items.length === 0;
}

$('btn-save-shipment').onclick = async () => {
  const name = $('shipment-name').value.trim();
  if (!name) { toast('اكتب اسم الشحنة الأول'); return; }
  await db.saveShipment({ name, createdBy: myName(), items: state.items });
  toast('تم حفظ الشحنة');
  goHome();
};
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx playwright test`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: new shipment flow with catalog memory and qty merge"
```

---

### Task 4: Manager view — PIN, list, detail, copy as text

**Files:**
- Modify: `app.js`
- Test: `tests/app.spec.js` (append)

**Interfaces:**
- Consumes: `db.listShipments()`, `state.currentShipmentList`, helpers.
- Produces: `openManager()`, `shipmentText(s)` — copy format (exact):
  ```
  شحنة: <name>
  الموظف: <createdBy>
  التاريخ: <ar-EG date>
  <blank line>
  <item name> <qty>   (one line per item)
  ```

- [ ] **Step 1: Write failing test (append)**

```js
test('manager: PIN gate, list, copy text', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => {
    localStorage.setItem('employeeName', 'أحمد');
    localStorage.setItem('test-shipments', JSON.stringify([
      { name: 'شحنة المراعي', createdBy: 'أحمد', createdAt: 1753700000000,
        items: [{ barcode: '6221031250057', name: 'لبن', qty: 3 }] },
    ]));
  });
  await page.reload();
  await page.click('#btn-manager');
  await page.fill('#pin-input', '1111');
  await page.click('#btn-pin');
  await expect(page.locator('#screen-pin')).toBeVisible(); // wrong PIN stays
  await page.fill('#pin-input', '2580');
  await page.click('#btn-pin');
  await expect(page.locator('#all-shipments li')).toHaveCount(1);
  await page.click('.shipment-row');
  await expect(page.locator('#detail-title')).toHaveText('شحنة المراعي');
  await page.click('#btn-copy');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('شحنة: شحنة المراعي');
  expect(text).toContain('الموظف: أحمد');
  expect(text).toContain('لبن 3');
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `npx playwright test`
Expected: new test FAILS (btn-manager has no handler)

- [ ] **Step 3: Implement in `app.js`**

```js
$('btn-manager').onclick = () => { $('pin-input').value = ''; show('screen-pin'); };

$('btn-pin').onclick = () => {
  if ($('pin-input').value !== window.APP_CONFIG.managerPin) { toast('الرقم السري غلط'); return; }
  openManager();
};

async function openManager() {
  show('screen-manager');
  state.currentShipmentList = await db.listShipments();
  $('all-shipments').innerHTML = state.currentShipmentList.map((s, i) =>
    `<li><button class="shipment-row" data-i="${i}">${esc(s.name)} — ${esc(s.createdBy)} — ${fmtDate(s.createdAt)}</button></li>`
  ).join('') || '<li>لا توجد شحنات</li>';
}

$('all-shipments').onclick = (e) => {
  const btn = e.target.closest('.shipment-row');
  if (btn) openDetail(state.currentShipmentList[+btn.dataset.i]);
};

function fmtDate(ts) { return new Date(ts).toLocaleDateString('ar-EG'); }

function shipmentText(s) {
  return `شحنة: ${s.name}\nالموظف: ${s.createdBy}\nالتاريخ: ${fmtDate(s.createdAt)}\n\n`
    + s.items.map(i => `${i.name} ${i.qty}`).join('\n');
}

let currentDetail = null;

function openDetail(s) {
  currentDetail = s;
  $('detail-title').textContent = s.name;
  $('detail-meta').textContent = `${s.createdBy} — ${fmtDate(s.createdAt)}`;
  $('detail-items').innerHTML = s.items.map(i =>
    `<tr><td>${esc(i.name)}</td><td dir="ltr">${i.qty}</td></tr>`).join('');
  show('screen-detail');
}

$('btn-back-manager').onclick = openManager;

$('btn-copy').onclick = async () => {
  await navigator.clipboard.writeText(shipmentText(currentDetail));
  toast('تم النسخ');
};
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx playwright test`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: manager view with PIN gate and copy-as-text"
```

---

### Task 5: Camera scanning

**Files:**
- Create: `vendor/html5-qrcode.min.js` (downloaded)
- Modify: `index.html` (one script tag), `app.js`
- Test: `tests/app.spec.js` (append lib-loads assertion) + manual phone checklist

**Interfaces:**
- Consumes: `onBarcode(code)` from Task 3, global `Html5Qrcode` from vendored lib.

- [ ] **Step 1: Vendor the lib**

```bash
mkdir -p vendor
curl -L -o vendor/html5-qrcode.min.js https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js
```

Verify non-empty: `wc -c vendor/html5-qrcode.min.js` (expect > 100000 bytes).

- [ ] **Step 2: Write failing test (append)**

```js
test('scanner lib loads', async ({ page }) => {
  await page.goto('/?test=1');
  const hasLib = await page.evaluate(() => typeof window.Html5Qrcode === 'function');
  expect(hasLib).toBe(true);
});
```

Run: `npx playwright test`
Expected: new test FAILS (script tag missing)

- [ ] **Step 3: Implement**

`index.html` — add before the `app.js` script tag:

```html
<script src="vendor/html5-qrcode.min.js"></script>
```

`app.js` — add:

```js
let scanner = null;

$('btn-scan').onclick = async () => {
  if (scanner) { await stopScan(); return; }
  $('reader').hidden = false;
  scanner = new Html5Qrcode('reader');
  try {
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 150 } },
      async (text) => { await stopScan(); beep(); onBarcode(text.trim()); }
    );
  } catch (err) {
    console.error(err);
    await stopScan();
    toast('الكاميرا مش متاحة — اكتب الباركود بإيدك');
  }
};

async function stopScan() {
  if (scanner) {
    try { await scanner.stop(); scanner.clear(); } catch (e) { /* already stopped */ }
    scanner = null;
  }
  $('reader').hidden = true;
}

function beep() {
  const ctx = new AudioContext();
  const o = ctx.createOscillator();
  o.connect(ctx.destination);
  o.frequency.value = 880;
  o.start();
  o.stop(ctx.currentTime + 0.15);
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx playwright test`
Expected: PASS (5 tests)

Manual checklist (deferred to phone testing after deploy, record in SETUP.md):
camera opens, EAN-13 read fills form, beep sounds, denied permission shows toast + manual input still works.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: camera barcode scanning with html5-qrcode"
```

---

### Task 6: PWA — manifest, icons, service worker, sync indicator

**Files:**
- Create: `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`, `scripts/make-icons.mjs`
- Modify: `app.js`
- Test: `tests/app.spec.js` (append)

**Interfaces:**
- Consumes: nothing new. `sw.js` caches same-origin shell only (gstatic/Firestore excluded — Firestore has its own offline layer).

- [ ] **Step 1: Write failing test (append)**

```js
test('PWA: manifest served, service worker registers', async ({ page }) => {
  const res = await page.request.get('/manifest.json');
  expect(res.ok()).toBeTruthy();
  await page.goto('/'); // no ?test → sw registers (initDb error is caught, app still boots)
  const active = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  expect(active).toBe(true);
});
```

Run: `npx playwright test`
Expected: new test FAILS (manifest 404)

- [ ] **Step 2: Implement**

`manifest.json`:

```json
{
  "name": "شحنات المحل",
  "short_name": "شحنات",
  "start_url": "./",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#0a7d33",
  "dir": "rtl",
  "lang": "ar",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

`scripts/make-icons.mjs` (one-time icon render via installed Playwright chromium):

```js
import { chromium } from '@playwright/test';

const html = (s) => `<style>*{margin:0}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0a7d33"/>
  <text x="256" y="360" font-size="280" text-anchor="middle" fill="#fff" font-family="sans-serif">ش</text>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const s of [192, 512]) {
  await page.setViewportSize({ width: s, height: s });
  await page.setContent(html(s));
  await page.locator('svg').screenshot({ path: `icon-${s}.png` });
}
await browser.close();
console.log('icons written');
```

Run: `node scripts/make-icons.mjs`
Verify: `file icon-192.png icon-512.png` → both PNG image data.

`sw.js`:

```js
const CACHE = 'mart-v1';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'db.js', 'firebase-config.js',
  'manifest.json', 'vendor/html5-qrcode.min.js', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
```

`app.js` — add at the end:

```js
function updateSync() {
  $('sync-state').textContent = navigator.onLine ? 'متصل ✓' : 'في انتظار الاتصال';
}
addEventListener('online', updateSync);
addEventListener('offline', updateSync);
updateSync();

if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('test')) {
  navigator.serviceWorker.register('./sw.js');
}
```

- [ ] **Step 3: Run tests, verify pass**

Run: `npx playwright test`
Expected: PASS (6 tests)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: PWA manifest, icons, service worker, sync indicator"
```

---

### Task 7: Firestore rules, owner setup guide, deploy

**Files:**
- Create: `firestore.rules`, `SETUP.md`

**Interfaces:**
- Consumes: data shapes from Task 2 (`shipments` fields, `products` doc id = barcode).

- [ ] **Step 1: Write `firestore.rules`**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /shipments/{id} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasOnly(['name', 'createdBy', 'createdAt', 'items'])
        && request.resource.data.name is string && request.resource.data.name.size() > 0
        && request.resource.data.name.size() <= 100
        && request.resource.data.createdBy is string && request.resource.data.createdBy.size() <= 50
        && request.resource.data.createdAt is number
        && request.resource.data.items is list && request.resource.data.items.size() <= 200;
      allow update, delete: if false;
    }
    match /products/{barcode} {
      allow read: if true;
      allow write: if barcode.size() <= 32
        && request.resource.data.keys().hasOnly(['name'])
        && request.resource.data.name is string && request.resource.data.name.size() > 0
        && request.resource.data.name.size() <= 100;
    }
  }
}
```

- [ ] **Step 2: Write `SETUP.md`**

Content (exact steps for the owner / roshdy):

```markdown
# تشغيل التطبيق لأول مرة

## 1. إنشاء مشروع Firebase (مرة واحدة، ~15 دقيقة)
1. افتح https://console.firebase.google.com وسجّل دخول بحساب Google.
2. Add project → اكتب اسم (مثلاً alaelah-mart) → كمّل بدون Google Analytics.
3. من القائمة: Build → Firestore Database → Create database → Start in production mode → اختر المنطقة eur3.
4. من Project settings (الترس) → Your apps → أيقونة `</>` (Web) → سجّل التطبيق → انسخ كائن `firebaseConfig`.
5. الصق القيم في ملف `firebase-config.js` مكان `{}` في `window.FIREBASE_CONFIG`.
6. ارجع لـ Firestore → تبويب Rules → امسح الموجود والصق محتوى ملف `firestore.rules` → Publish.

## 2. النشر على GitHub Pages
1. ارفع المشروع على GitHub (repo عام).
2. Settings → Pages → Source: Deploy from a branch → Branch: main / root → Save.
3. الرابط هيبقى: https://<username>.github.io/<repo>/

## 3. تجربة على الموبايل (قائمة الفحص)
- افتح الرابط في Chrome على أندرويد.
- من قائمة المتصفح: "إضافة إلى الشاشة الرئيسية" → الأيقونة الخضراء تظهر.
- جرّب: شحنة جديدة → امسح باركود منتج حقيقي → الكاميرا تفتح وتقرأ → صوت بيب.
- ارفض إذن الكاميرا مرة → رسالة تظهر وإدخال الباركود اليدوي يشتغل.
- فعّل وضع الطيران → أنشئ شحنة → ارجع للإنترنت → افتح شاشة المدير → الشحنة موجودة.
- الرقم السري للمدير: 2580 (غيّره في firebase-config.js لو حبيت).

## ملاحظة أمان
الرابط نفسه هو الحماية الأساسية — متشاركوش علنًا. البيانات المخزنة أسماء أصناف
وكميات فقط، من غير أي بيانات حساسة.
```

- [ ] **Step 3: Full test run + commit**

```bash
npx playwright test
git add -A
git commit -m "docs: firestore rules and owner setup guide"
```

- [ ] **Step 4: Deploy (needs user's GitHub account decision)**

Ask user: deploy under whose GitHub account/repo name? Then:

```bash
gh repo create alaelah-mart --public --source . --push
```

Enable Pages: repo Settings → Pages → Deploy from branch → main / root (or `gh api repos/{owner}/alaelah-mart/pages -X POST -f 'source[branch]=main' -f 'source[path]=/'`).

Verify: `curl -sI https://<user>.github.io/alaelah-mart/ | head -1` → `HTTP/2 200`.

---

## Verification (Definition of Done)

- [ ] `npx playwright test` → 6/6 PASS
- [ ] App loaded in real desktop browser, full flow clicked through manually
- [ ] Deployed URL returns 200, opened on a real Android phone
- [ ] Camera scan of a real product EAN works on phone (friend/user confirms)
- [ ] Offline shipment creation syncs after reconnect (phone airplane-mode test)
- [ ] Firebase console shows shipment documents after real save
