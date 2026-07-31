const { test, expect } = require('@playwright/test');

// setup now needs the branch PIN; helper keeps every test honest about that
async function setUp(page, name = 'أحمد', branchIndex = 0) {
  const b = (await page.evaluate(() => window.APP_CONFIG.branches))[branchIndex];
  // only catalog barcodes can be added now, so every flow needs a catalog
  await page.evaluate(() => localStorage.getItem('test-products')
    || localStorage.setItem('test-products', JSON.stringify({ '111': 'لبن', '222': 'جبنة' })));
  await page.fill('#employee-name', name);
  await page.click(`button[data-branch="${b.name}"]`);
  await page.fill('#branch-pin', b.pin);
  await page.click('#save-name');
  return b;
}

test('first open asks name, branch and branch PIN', async ({ page }) => {
  await page.goto('/?test=1');
  await expect(page.locator('#screen-name')).toBeVisible();
  await page.fill('#employee-name', 'أحمد');
  await page.fill('#branch-pin', '0000');           // wrong branch PIN
  await page.click('#save-name');
  await expect(page.locator('#screen-name')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('الرقم السري للفرع غلط');
  await setUp(page);
  await expect(page.locator('#screen-home')).toBeVisible();
  await page.reload();
  await expect(page.locator('#screen-home')).toBeVisible();
});

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

test('create shipment: name shown from catalog as a label, duplicate merge', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => {
    localStorage.setItem('employeeName', 'أحمد');
    localStorage.setItem('test-products', JSON.stringify({ '6221031250057': 'لبن كامل الدسم' }));
  });
  await page.reload();
  await page.click('#btn-new');
  await page.fill('#shipment-name', 'شحنة المراعي');
  await page.fill('#barcode-input', '6221031250057');
  await page.click('#btn-lookup');
  await expect(page.locator('#item-name')).toHaveText('لبن كامل الدسم'); // label, not an input
  expect(await page.locator('#item-name').evaluate(el => el.tagName)).not.toBe('INPUT');
  await page.click('#qty-plus'); // qty = 2
  await page.click('#btn-add-item');
  await page.fill('#barcode-input', '6221031250057');
  await page.click('#btn-lookup');
  await page.click('#btn-add-item'); // qty 1 more → merge to 3
  await expect(page.locator('#items-list li:not(.empty)')).toHaveCount(1);
  await expect(page.locator('#items-list li:not(.empty)')).toContainText('3');
  await page.click('#btn-save-shipment');
  await expect(page.locator('#screen-home')).toBeVisible();
  await expect(page.locator('#my-shipments li')).toContainText('شحنة المراعي');
});

test('a barcode outside the catalog is refused, with the reason spelled out', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => { localStorage.setItem('employeeName', 'أحمد'); localStorage.setItem('test-products', JSON.stringify({ '111': 'لبن', '222': 'جبنة' })); });
  await page.reload();
  await page.click('#btn-new');
  await page.fill('#shipment-name', 'شحنة');
  await page.fill('#barcode-input', '9990001112223');
  await page.click('#btn-lookup');
  await expect(page.locator('#item-name')).toHaveText('صنف غير مسجّل في ملف الأصناف');
  await expect(page.locator('#item-warn')).toBeVisible();
  await expect(page.locator('#item-warn')).toContainText('مش موجود في ملف الأصناف، والصنف مش هيتسجّل في الشحنة');
  await expect(page.locator('#item-warn')).toContainText('ابعت الباركود للمدير يضيفه في ملف الأصناف');
  await expect(page.locator('#btn-add-item')).toBeHidden();      // no add button, no qty stepper
  await expect(page.locator('#qty-row')).toBeHidden();
  await page.evaluate(() => document.getElementById('btn-add-item').click());   // forced: still nothing
  await expect(page.locator('#items-list li:not(.empty)')).toHaveCount(0);
  await expect(page.locator('#btn-save-shipment')).toBeDisabled();

  await page.click('#btn-copy-barcode');                         // employee can send it to the manager
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('9990001112223');

  await page.click('#btn-cancel-item');                          // sheet owns the screen until dismissed
  await page.fill('#barcode-input', '111');                      // a catalog item still works
  await page.click('#btn-lookup');
  await expect(page.locator('#item-warn')).toBeHidden();
  await expect(page.locator('#btn-add-item')).toBeEnabled();
  await page.click('#btn-add-item');
  await expect(page.locator('#items-list li:not(.empty)')).toHaveCount(1);
});

// a session signed in on any page carries to the others, so tests that want the PIN
// screen must sign out first — and before navigating, or the redirect wins the race
async function signOut(page) {
  await page.evaluate(() => localStorage.removeItem('session')).catch(() => {});
}

async function openManagerPage(page) {
  await signOut(page);
  await page.goto('/manager.html?test=1');
  await page.evaluate(() => {
    localStorage.setItem('test-shipments', JSON.stringify([
      { name: 'شحنة المراعي', createdBy: 'أحمد', createdAt: 1753700000000,
        items: [{ barcode: '6221031250057', name: 'لبن', qty: 3 }] },
    ]));
  });
  const pin = await page.evaluate(() => window.APP_CONFIG.managerPin);
  await page.fill('#pin-input', pin);
  await page.click('#btn-pin');
}

test('manager page: PIN gate, list, copy barcode-tab-qty', async ({ page }) => {
  await page.goto('/manager.html?test=1');
  const pin = await page.evaluate(() => window.APP_CONFIG.managerPin);
  await page.fill('#pin-input', pin === '0000' ? '9999' : '0000');
  await page.click('#btn-pin');
  await expect(page.locator('#screen-pin')).toBeVisible(); // wrong PIN stays
  await openManagerPage(page);
  await expect(page.locator('#all-shipments li')).toHaveCount(1);
  await page.click('button[data-act="copy"]');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toBe('6221031250057\t3');
  await page.click('button[data-act="view"]');
  await expect(page.locator('#detail-name')).toHaveValue('شحنة المراعي');
});

test('manager page: edit name, change qty, delete item', async ({ page }) => {
  await openManagerPage(page);
  await page.click('button[data-act="view"]');
  await page.fill('#detail-name', 'شحنة معدّلة');
  await page.fill('input[data-qty="0"]', '7');
  await page.click('#btn-save-edit');
  await expect(page.locator('#all-shipments li')).toContainText('شحنة معدّلة');
  await page.click('button[data-act="copy"]');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('6221031250057\t7');
  await page.click('button[data-act="view"]');
  await page.click('button[data-delitem="0"]');
  await page.click('#btn-save-edit');
  await page.click('button[data-act="view"]');
  await expect(page.locator('#detail-items tr:has(button)')).toHaveCount(0);
});

test('employee: remove scanned item before saving', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => { localStorage.setItem('employeeName', 'أحمد'); localStorage.setItem('test-products', JSON.stringify({ '111': 'لبن', '222': 'جبنة' })); });
  await page.reload();
  await page.click('#btn-new');
  await page.fill('#shipment-name', 'شحنة');
  await page.fill('#barcode-input', '111');
  await page.click('#btn-lookup');
  await page.click('#btn-add-item');
  await expect(page.locator('#items-list li:not(.empty)')).toHaveCount(1);
  await page.click('button[data-del="0"]');
  await expect(page.locator('#items-list li:not(.empty)')).toHaveCount(0);
  await expect(page.locator('#btn-save-shipment')).toBeDisabled();
});

test('employee: edit own saved shipment', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => {
    localStorage.setItem('employeeName', 'أحمد');
    localStorage.setItem('test-shipments', JSON.stringify([
      { name: 'شحنة قديمة', createdBy: 'أحمد', createdAt: 1753700000000,
        items: [{ barcode: '111', name: 'لبن', qty: 2 }, { barcode: '222', name: 'جبنة', qty: 1 }] },
    ]));
  });
  await page.reload();
  await page.click('button[data-edit="0"]');
  await expect(page.locator('#shipment-name')).toHaveValue('شحنة قديمة');
  await expect(page.locator('#items-list li:not(.empty)')).toHaveCount(2);
  await page.click('button[data-del="1"]');
  await page.fill('#shipment-name', 'شحنة متصلحة');
  await page.click('#btn-save-shipment');
  await expect(page.locator('#my-shipments li')).toHaveCount(1);
  await expect(page.locator('#my-shipments li')).toContainText('شحنة متصلحة');
  await expect(page.locator('#my-shipments li')).toContainText('1 صنف');
});

test('manager page: delete removes shipment', async ({ page }) => {
  await openManagerPage(page);
  await expect(page.locator('#all-shipments li')).toHaveCount(1);
  page.on('dialog', (d) => d.accept());
  await page.click('button[data-act="del"]');
  await expect(page.locator('#all-shipments li')).toContainText('مفيش شحنات');
});

test('branch: picked at setup, stamped on shipment, filters manager list', async ({ page }) => {
  await page.goto('/?test=1');
  const cfg = await page.evaluate(() => window.APP_CONFIG.branches);
  expect(cfg.map(b => b.name)).toEqual(['فرع قويسنا', 'فرع شبين الكوم']);
  const b2 = (await setUp(page, 'أحمد', 1)).name;
  await expect(page.locator('#who')).toContainText(b2);
  await page.click('#btn-new');
  await page.fill('#shipment-name', 'شحنة شبين');
  await page.fill('#barcode-input', '111');
  await page.click('#btn-lookup');
  await page.click('#btn-add-item');
  await page.click('#btn-save-shipment');
  await expect(page.locator('#my-shipments li')).toContainText(b2);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('test-shipments'))[0]);
  expect(saved.branch).toBe(b2);

  await page.goto('/manager.html?test=1');
  await page.fill('#pin-input', await page.evaluate(() => window.APP_CONFIG.managerPin));
  await page.click('#btn-pin');
  await expect(page.locator('#all-shipments li')).toHaveCount(1);
  await page.click(`button[data-branch="${cfg[0].name}"]`);   // other branch → empty
  await expect(page.locator('#all-shipments li')).toContainText('مفيش شحنات');
  await page.click(`button[data-branch="${b2}"]`);
  await expect(page.locator('#all-shipments li')).toContainText('شحنة شبين');
});

test('Enter key submits: manager PIN, employee setup, barcode lookup', async ({ page }) => {
  await page.goto('/manager.html?test=1');
  await page.fill('#pin-input', await page.evaluate(() => window.APP_CONFIG.managerPin));
  await page.press('#pin-input', 'Enter');                     // no button tap
  await expect(page.locator('#screen-manager')).toBeVisible();

  await page.goto('/?test=1');
  const b = (await page.evaluate(() => window.APP_CONFIG.branches))[0];
  await page.evaluate(() => localStorage.setItem('test-products', JSON.stringify({ '111': 'لبن' })));
  await page.fill('#employee-name', 'أحمد');
  await page.fill('#branch-pin', b.pin);
  await page.press('#branch-pin', 'Enter');
  await expect(page.locator('#screen-home')).toBeVisible();

  await page.click('#btn-new');
  await page.fill('#barcode-input', '111');
  await page.press('#barcode-input', 'Enter');                 // opens the item sheet
  await expect(page.locator('#item-form')).toBeVisible();
  await page.press('#item-qty', 'Enter');                      // adds the item
  await expect(page.locator('#items-list li:not(.empty)')).toHaveCount(1);
});

test('shipment type: picked under the branch, saved, filtered and editable', async ({ page }) => {
  await page.goto('/?test=1');
  const [t1, t2, t3] = await page.evaluate(() => window.APP_CONFIG.shipmentTypes);
  expect([t1, t2, t3]).toEqual(['إذن استلام', 'إذن مرتجع', 'تحويل فرع']);
  const branch = await setUp(page);
  await page.click('#btn-new');
  await expect(page.locator('#new-branch')).toHaveText(branch.name);       // branch shown above the type
  await expect(page.locator(`#type-picker button[data-type="${t1}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.click(`#type-picker button[data-type="${t2}"]`);              // إذن مرتجع
  await page.fill('#shipment-name', 'مرتجع المراعي');
  await page.fill('#barcode-input', '111');
  await page.click('#btn-lookup');
  await page.click('#btn-add-item');
  await page.click('#btn-save-shipment');
  await expect(page.locator('#my-shipments li')).toContainText(t2);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-shipments'))[0].type)).toBe(t2);

  await page.goto('/manager.html?test=1');
  await page.fill('#pin-input', await page.evaluate(() => window.APP_CONFIG.managerPin));
  await page.click('#btn-pin');
  await expect(page.locator('#all-shipments li')).toContainText(t2);
  await page.click(`button[data-typefilter="${t1}"]`);                     // wrong type → empty
  await expect(page.locator('#all-shipments li')).toContainText('مفيش شحنات');
  await page.click(`button[data-typefilter="${t2}"]`);
  await expect(page.locator('#all-shipments li')).toHaveCount(1);

  await page.click('button[data-act="view"]');                            // manager corrects the type
  await expect(page.locator(`#detail-type button[data-detailtype="${t2}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.click(`#detail-type button[data-detailtype="${t3}"]`);
  await page.click('#btn-save-edit');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-shipments'))[0].type)).toBe(t3);
  await expect(page.locator('#all-shipments li')).toContainText('مفيش شحنات');   // filter still on t2

  await page.click(`button[data-typefilter="${t3}"]`);
  const exp = (await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-export-all'),
  ]))[0];
  const csv = require('fs').readFileSync(await exp.path(), 'utf8');
  expect(csv).toContain('"الفرع","نوع الشحنة","الشحنة"');
  expect(csv).toContain(`"${t3}"`);
});

test('branch PIN on the manager page shows only that branch', async ({ page }) => {
  await page.goto('/manager.html?test=1');
  const cfg = await page.evaluate(() => window.APP_CONFIG.branches);
  await page.evaluate((names) => {
    localStorage.setItem('test-shipments', JSON.stringify([
      { name: 'شحنة قويسنا', createdBy: 'أحمد', branch: names[0], createdAt: 1753700000000,
        items: [{ barcode: '111', name: 'لبن', qty: 1 }] },
      { name: 'شحنة شبين', createdBy: 'سيد', branch: names[1], createdAt: 1753600000000,
        items: [{ barcode: '222', name: 'جبنة', qty: 2 }] },
    ]));
  }, cfg.map(b => b.name));
  await page.fill('#pin-input', cfg[1].pin);                  // شبين الكوم manager
  await page.click('#btn-pin');
  await expect(page.locator('#all-shipments li')).toHaveCount(1);
  await expect(page.locator('#all-shipments li')).toContainText('شحنة شبين');
  await expect(page.locator('#screen-title')).toHaveText('شبين الكوم');
  await expect(page.locator('#branch-filter button')).toHaveCount(1);   // no cross-branch filter
  await expect(page.locator('#branch-filter button')).toBeDisabled();
  const exp = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-export-all'),
  ]).then(([d]) => d);
  expect(exp.suggestedFilename()).toBe('shipments-فرع شبين الكوم.csv');
  expect(require('fs').readFileSync(await exp.path(), 'utf8')).not.toContain('قويسنا');
});

test('manager page: download one shipment and all shipments, CSV and TXT', async ({ page }) => {
  await openManagerPage(page);
  const grab = async (selector) => (await Promise.all([
    page.waitForEvent('download'),
    page.click(selector),
  ]))[0];

  const one = await grab('button[data-act="download"]');
  expect(one.suggestedFilename()).toBe('شحنة المراعي.csv');
  const oneText = require('fs').readFileSync(await one.path(), 'utf8');
  expect(oneText.startsWith('﻿')).toBe(true);            // Excel needs the BOM for Arabic
  expect(oneText).toContain('"6221031250057","لبن","3"');

  const oneTxt = await grab('button[data-act="txt"]');
  expect(oneTxt.suggestedFilename()).toBe('شحنة المراعي.txt');
  expect(require('fs').readFileSync(await oneTxt.path(), 'utf8')).toBe('6221031250057\t3');

  const all = await grab('#btn-export-all');
  expect(all.suggestedFilename()).toBe('shipments-all.csv');
  const allText = require('fs').readFileSync(await all.path(), 'utf8');
  expect(allText).toContain('"الفرع","نوع الشحنة","الشحنة","الموظف","التاريخ","الباركود","اسم الصنف","الكمية"');
  expect(allText).toContain('"شحنة المراعي","أحمد"');

  const allTxt = await grab('#btn-export-all-txt');
  expect(allTxt.suggestedFilename()).toBe('shipments-all.txt');
  expect(require('fs').readFileSync(await allTxt.path(), 'utf8')).toBe('6221031250057\t3');

  await page.click('button[data-act="view"]');
  const detailTxt = await grab('#btn-download-txt');
  expect(detailTxt.suggestedFilename()).toBe('شحنة المراعي.txt');
});

test('catalog screen: list, search, rename, delete, export', async ({ page }) => {
  await page.goto('/manager.html?test=1');
  await page.evaluate(() => localStorage.setItem('test-products', JSON.stringify({
    '111': 'لبن المراعي', '222': 'جبنة بيضاء', '333': 'أرز الضحى',
  })));
  await page.fill('#pin-input', await page.evaluate(() => window.APP_CONFIG.managerPin));
  await page.click('#btn-pin');
  await expect(page.locator('#btn-products')).toBeVisible();   // reachable without scrolling
  await page.click('#btn-products');
  await expect(page.locator('#btn-products')).toBeHidden();     // not offered while already there
  await expect(page.locator('#products-list li')).toHaveCount(3);
  await expect(page.locator('#products-count')).toHaveText('3 صنف');

  await page.fill('#product-search', 'جبنة');                 // search by name
  await expect(page.locator('#products-list li')).toHaveCount(1);
  await expect(page.locator('#products-count')).toHaveText('1 نتيجة');
  await page.fill('#product-search', '333');                  // search by barcode
  await expect(page.locator('#products-list li')).toHaveCount(1);
  await expect(page.locator('input[data-barcode="333"]')).toHaveValue('أرز الضحى');
  await page.fill('#product-search', 'لا يوجد كده');           // no hit → guidance, not a dead end
  await expect(page.locator('#products-list li.empty')).toContainText('دوّر بأول الاسم أو بالباركود');
  await page.fill('#product-search', '');
  await expect(page.locator('#products-list li')).toHaveCount(3);

  await page.fill('input[data-barcode="111"]', 'لبن المراعي 1 لتر');   // rename
  await expect(page.locator('#products-dirty')).toHaveText('1 تعديل');
  await page.click('#btn-save-products');
  await expect(page.locator('#btn-save-products')).toBeDisabled();
  // a saved product row is an object now: the stocktake quantity lives next to the name
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-products'))['111']))
    .toEqual({ name: 'لبن المراعي 1 لتر' });

  page.on('dialog', (d) => d.accept());                       // delete
  await page.click('button[data-delproduct="222"]');
  await expect(page.locator('#products-list li')).toHaveCount(2);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-products'))['222'])).toBeUndefined();

  const dl = (await Promise.all([                             // export catalog
    page.waitForEvent('download'),
    page.click('#btn-export-products'),
  ]))[0];
  // the catalog export is now one branch's stocktake sheet, named after it
  expect(dl.suggestedFilename()).toMatch(/^أصناف-.+\.csv$/);
  const csv = require('fs').readFileSync(await dl.path(), 'utf8');
  expect(csv).toContain('"111","لبن المراعي 1 لتر"');
  expect(csv).not.toContain('جبنة');

  await page.goBack();                                        // back returns to shipments
  await expect(page.locator('#screen-manager')).toBeVisible();
});

test('a db call fired before initDb finishes still lands', async ({ page }) => {
  await page.goto('/?test=1');
  const saved = await page.evaluate(async () => {
    const db = await import('./db.js');
    const write = db.saveProductName('777', 'قبل التهيئة');   // no await on initDb first
    await Promise.all([write, db.initDb()]);
    return db.getProductName('777');
  });
  expect(saved).toBe('قبل التهيئة');
});

test('catalog screen: a quote in a product name cannot break the row markup', async ({ page }) => {
  await page.goto('/manager.html?test=1');
  await page.evaluate(() => localStorage.setItem('test-products', JSON.stringify({
    '444': 'صنف" onfocus="window.__xss=1" x="',
  })));
  await page.fill('#pin-input', await page.evaluate(() => window.APP_CONFIG.managerPin));
  await page.click('#btn-pin');
  await page.click('#btn-products');
  await page.locator('input[data-barcode="444"]').focus();
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await expect(page.locator('input[data-barcode="444"]')).toHaveValue('صنف" onfocus="window.__xss=1" x="');
});

test('back button and phone back return to the previous screen', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => { localStorage.setItem('employeeName', 'أحمد'); localStorage.setItem('test-products', JSON.stringify({ '111': 'لبن', '222': 'جبنة' })); });
  await page.reload();
  await expect(page.locator('#btn-back')).toBeHidden();       // nothing to go back to on home
  await page.click('#btn-new');
  await expect(page.locator('#btn-back')).toBeVisible();
  await page.click('#btn-back');                              // app bar back
  await expect(page.locator('#screen-home')).toBeVisible();
  await page.click('#btn-new');
  await page.goBack();                                        // phone/browser back
  await expect(page.locator('#screen-home')).toBeVisible();

  await openManagerPage(page);
  await expect(page.locator('#btn-back')).toBeHidden();
  await page.click('button[data-act="view"]');
  await expect(page.locator('#btn-back')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#screen-manager')).toBeVisible();
});

test('scanner lib loads', async ({ page }) => {
  await page.goto('/?test=1');
  const hasLib = await page.evaluate(() => typeof window.Html5Qrcode === 'function');
  expect(hasLib).toBe(true);
});

test('PWA: manifest served, service worker registers', async ({ page }) => {
  const res = await page.request.get('/manifest.json');
  expect(res.ok()).toBeTruthy();
  // one installable app, on the main URL: the manager and admin pages are reached from it,
  // so they carry no manifest of their own any more
  for (const page_ of ['manager.html', 'admin.html']) {
    const html = await (await page.request.get('/' + page_)).text();
    expect(html).not.toContain('rel="manifest"');
  }
  const resTemplate = await page.request.get('/products-template.csv');
  expect(resTemplate.ok()).toBeTruthy();
  const resStock = await page.request.get('/stock-template.csv');
  expect(resStock.ok()).toBeTruthy();
  await page.goto('/'); // no ?test → sw registers (initDb error is caught, app still boots)
  const active = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  expect(active).toBe(true);
});

test("catalog CSV import on manager page autofills names in employee app", async ({ page }) => {
  await openManagerPage(page);
  await page.setInputFiles("#import-file", "tests/fixtures/catalog.csv");
  await expect(page.locator("#toast")).toContainText("تم استيراد 2 صنف");
  await page.goto("/?test=1");
  await page.evaluate(() => localStorage.setItem('employeeName', 'أحمد'));   // keep the imported catalog
  await page.reload();
  await page.click("#btn-new");
  await page.fill("#barcode-input", "6221031250057");
  await page.click("#btn-lookup");
  await expect(page.locator("#item-name")).toHaveText("لبن المراعي");
  await expect(page.locator("#btn-add-item")).toBeEnabled();                 // imported → addable
});

async function openAdmin(page) {
  await signOut(page);                                             // else the session skips the PIN screen
  await page.goto('/admin.html?test=1');
  await page.fill('#pin-input', await page.evaluate(() => window.APP_CONFIG.adminPin));
  await page.click('#btn-pin');
  await expect(page.locator('#screen-admin')).toBeVisible();
}

test('admin page: PIN gate, then every setting on one screen', async ({ page }) => {
  await page.goto('/admin.html?test=1');
  await page.fill('#pin-input', '0000');
  await page.click('#btn-pin');
  await expect(page.locator('#screen-admin')).toBeHidden();
  await expect(page.locator('#toast')).toContainText('الرقم السري غلط');
  await openAdmin(page);
  await expect(page.locator('#branches-list li')).toHaveCount(2);
  await expect(page.locator('#types-list li')).toHaveCount(3);
  await expect(page.locator('#cfg-manager-pin')).toHaveValue(
    await page.evaluate(() => window.APP_CONFIG.managerPin));
});

test('admin: a saved branch and type reach the employee app and the manager', async ({ page }) => {
  await openAdmin(page);
  await page.click('#btn-add-branch');
  await page.fill('input[data-bname="2"]', 'فرع بنها');
  await page.fill('input[data-bpin="2"]', '3030');
  await page.click('#btn-add-type');
  await page.fill('input[data-tname="3"]', 'إذن تحويل مخزن');
  await page.click('#btn-save-config');
  await expect(page.locator('#toast')).toContainText('تم حفظ الإعدادات');

  await page.goto('/?test=1');                                  // employee: new branch, its own PIN
  await expect(page.locator('button[data-branch="فرع بنها"]')).toBeVisible();
  await page.fill('#employee-name', 'سيد');
  await page.click('button[data-branch="فرع بنها"]');
  await page.fill('#branch-pin', '3030');
  await page.click('#save-name');
  await expect(page.locator('#who')).toContainText('فرع بنها');
  await page.click('#btn-new');
  await expect(page.locator('#type-picker button[data-type="إذن تحويل مخزن"]')).toBeVisible();

  await signOut(page);                                          // the admin session would skip the PIN
  await page.goto('/manager.html?test=1');                      // manager: both appear as filters
  await page.fill('#pin-input', await page.evaluate(() => window.APP_CONFIG.managerPin));
  await page.click('#btn-pin');
  await expect(page.locator('#branch-filter button[data-branch="فرع بنها"]')).toBeVisible();
  await expect(page.locator('#type-filter button[data-typefilter="إذن تحويل مخزن"]')).toBeVisible();
});

test('admin: the audit trail shows what the manager did', async ({ page }) => {
  await openManagerPage(page);
  page.on('dialog', (d) => d.accept());
  await page.click('button[data-act="del"]');
  await expect(page.locator('#all-shipments li')).toContainText('مفيش شحنات');

  await openAdmin(page);
  await page.click('#btn-logs');
  const row = page.locator('#logs-list li').first();
  await expect(row).toContainText('حذف شحنة');
  await expect(row).toContainText('شحنة المراعي');
  await expect(row).toContainText('المدير العام');
  await page.goBack();
  await expect(page.locator('#screen-admin')).toBeVisible();
});

test('admin: bulk delete by type, and it is logged', async ({ page }) => {
  await page.goto('/admin.html?test=1');
  await page.evaluate(() => localStorage.setItem('test-shipments', JSON.stringify([
    { name: 'استلام 1', createdBy: 'أحمد', branch: 'فرع قويسنا', type: 'إذن استلام', createdAt: 1753700000000, items: [] },
    { name: 'مرتجع 1', createdBy: 'أحمد', branch: 'فرع قويسنا', type: 'إذن مرتجع', createdAt: 1753600000000, items: [] },
  ])));
  await page.fill('#pin-input', await page.evaluate(() => window.APP_CONFIG.adminPin));
  await page.click('#btn-pin');
  await expect(page.locator('#btn-bulk-delete')).toHaveText('حذف المطابق (2)');
  await page.click('#bulk-type button[data-bulktype="إذن مرتجع"]');
  await expect(page.locator('#btn-bulk-delete')).toHaveText('حذف المطابق (1)');

  page.on('dialog', (d) => d.accept());
  await page.click('#btn-bulk-delete');
  await expect(page.locator('#toast')).toContainText('تم حذف 1 شحنة');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-shipments')).map(s => s.name)))
    .toEqual(['استلام 1']);
  await page.click('#btn-logs');
  await expect(page.locator('#logs-list li').first()).toContainText('حذف شحنات بالجملة');
});

test('manager: ZIP export puts each shipment in a folder named after its type', async ({ page }) => {
  await page.goto('/manager.html?test=1');
  await page.evaluate(() => localStorage.setItem('test-shipments', JSON.stringify([
    { name: 'شحنة اللحمة', createdBy: 'أحمد', branch: 'فرع قويسنا', type: 'إذن استلام',
      createdAt: 1753700000000, items: [{ barcode: '111', name: 'لبن', qty: 3 }] },
    { name: 'مرتجع الألبان', createdBy: 'أحمد', branch: 'فرع قويسنا', type: 'إذن مرتجع',
      createdAt: 1753600000000, items: [{ barcode: '222', name: 'جبنة', qty: 1 }] },
  ])));
  await page.fill('#pin-input', await page.evaluate(() => window.APP_CONFIG.managerPin));
  await page.click('#btn-pin');
  const dl = (await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-export-zip'),
  ]))[0];
  expect(dl.suggestedFilename()).toMatch(/^شحنات-\d{4}-\d{2}-\d{2}\.zip$/);
  const buf = require('fs').readFileSync(await dl.path());
  expect([...buf.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);   // local file header signature
  const raw = buf.toString('utf8');           // stored, not compressed: names and rows are literal
  expect(raw).toContain('إذن استلام/شحنة اللحمة.csv');
  expect(raw).toContain('إذن استلام/شحنة اللحمة.txt');
  expect(raw).toContain('إذن مرتجع/مرتجع الألبان.csv');
  expect(raw).toContain('111\t3');
});

test('camera settings: reachable from the app bar and the choices stick', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => localStorage.setItem('employeeName', 'أحمد'));
  await page.reload();
  await expect(page.locator('#btn-cam')).toBeVisible();          // in the app bar, not buried
  await page.click('#btn-cam');
  await expect(page.locator('#screen-cam')).toBeVisible();
  await expect(page.locator('#cam-note')).not.toBeEmpty();       // headless has no camera: a message, not a crash

  await page.click('button[data-box="large"]');
  await page.fill('#cam-zoom', '2.5');
  await page.click('#btn-torch-default');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('camSettings'))))
    .toEqual({ deviceId: '', box: 'large', torch: true, zoom: 2.5, res: 'hd', focus: true });
  await expect(page.locator('#cam-zoom-val')).toHaveText('×2.5');

  await page.goBack();                                           // phone back leaves the settings
  await expect(page.locator('#screen-home')).toBeVisible();
  await page.click('#btn-cam');                                  // and they survive the trip
  await expect(page.locator('button[data-box="large"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#btn-torch-default')).toHaveAttribute('aria-pressed', 'true');
});

test('camera settings: the scanner screen keeps its controls hidden until a camera runs', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => { localStorage.setItem('employeeName', 'أحمد'); localStorage.setItem('test-products', JSON.stringify({ '111': 'لبن' })); });
  await page.reload();
  await page.click('#btn-new');
  await expect(page.locator('#cam-live')).toBeHidden();          // no torch/zoom bar without a track
  await expect(page.locator('#reader')).toBeHidden();
  await page.click('#btn-scan');                                 // headless: camera fails, app stays usable
  await expect(page.locator('#toast')).toContainText('الكاميرا مش متاحة');
  await expect(page.locator('#cam-live')).toBeHidden();
  await page.fill('#barcode-input', '111');                      // manual entry still works after that
  await page.click('#btn-lookup');
  await page.click('#btn-add-item');
  await expect(page.locator('#items-list li:not(.empty)')).toHaveCount(1);
});

// users the admin creates, with a permission tick per screen and per action
async function seedUsers(page, users) {
  await page.evaluate((u) => {
    const cfg = JSON.parse(localStorage.getItem('test-config') || '{}');
    localStorage.setItem('test-config', JSON.stringify({ ...window.APP_CONFIG, ...cfg, users: u }));
  }, users);
  await page.reload();                                             // APP_CONFIG merges the config at boot
}

const EMP = { name: 'سيد', pin: '2233', branches: ['فرع قويسنا'], perms: ['emp', 'create'] };
const MGR = { name: 'حسن', pin: '4411', branches: ['فرع قويسنا'], perms: ['mgr', 'edit', 'download'] };
const ADM = { name: 'الأدمن الجديد', pin: '5511', branches: [], perms: ['adm', 'danger'] };
const BOTH = { name: 'محمود', pin: '6622', branches: ['فرع قويسنا', 'فرع شبين الكوم'], perms: ['emp', 'create', 'mgr', 'download'] };

test('admin: creating a user with a PIN and permissions', async ({ page }) => {
  await openAdmin(page);
  await page.click('#btn-add-user');
  await page.fill('input[data-uname="0"]', 'حسن');
  await page.fill('input[data-upin="0"]', '4411');
  await page.click('[data-uperms="0"] button[data-perm="mgr"]');       // add manager screen
  await page.click('[data-uperms="0"] button[data-perm="emp"]');       // drop the employee screen
  await page.click('[data-uperms="0"] button[data-perm="create"]');    // and the create action
  await page.click('[data-uperms="0"] button[data-perm="download"]');
  await page.click('#btn-save-config');
  await expect(page.locator('#toast')).toContainText('تم حفظ الإعدادات');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('test-config')).users);
  expect(saved).toHaveLength(1);
  expect(saved[0].name).toBe('حسن');
  expect(saved[0].pin).toBe('4411');
  expect(saved[0].perms.sort()).toEqual(['download', 'mgr']);
  expect(saved[0].branches).toEqual([await page.evaluate(() => window.APP_CONFIG.branches[0].name)]);
});

test('admin: a user can cover both branches, or all of them', async ({ page }) => {
  await openAdmin(page);
  const names = await page.evaluate(() => window.APP_CONFIG.branches.map(b => b.name));
  await page.click('#btn-add-user');
  await page.fill('input[data-uname="0"]', 'محمود');
  await page.fill('input[data-upin="0"]', '6622');
  await page.click(`[data-ubranch="0"] button[data-branchpick="${names[1]}"]`);   // add the second branch
  await expect(page.locator(`[data-ubranch="0"] button[data-branchpick="${names[0]}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(`[data-ubranch="0"] button[data-branchpick="${names[1]}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.click('#btn-save-config');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-config')).users[0].branches)).toEqual(names);

  await page.click('[data-ubranch="0"] button[data-branchpick=""]');             // «كل الفروع» clears it
  await expect(page.locator(`[data-ubranch="0"] button[data-branchpick="${names[0]}"]`)).toHaveAttribute('aria-pressed', 'false');
  await page.click('#btn-save-config');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-config')).users[0].branches)).toEqual([]);
});

test('a two-branch user picks the branch per shipment, and the manager view spans both', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => localStorage.setItem('test-products', JSON.stringify({ '111': 'لبن' })));
  await seedUsers(page, [BOTH]);
  const names = await page.evaluate(() => window.APP_CONFIG.branches.map(b => b.name));
  await page.fill('#login-pin', BOTH.pin);
  await page.click('#btn-login');
  await expect(page.locator('#screen-home')).toBeVisible();

  await page.click('#btn-new');
  await expect(page.locator('#new-branch-picker button')).toHaveCount(2);   // both branches offered
  await expect(page.locator('#new-branch')).toBeHidden();
  await page.click(`#new-branch-picker button[data-newbranch="${names[1]}"]`);
  await page.fill('#shipment-name', 'شحنة شبين');
  await page.fill('#barcode-input', '111');
  await page.click('#btn-lookup');
  await page.click('#btn-add-item');
  await page.click('#btn-save-shipment');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-shipments'))[0].branch)).toBe(names[1]);

  await page.click('#link-manager');                                       // manager side, same session
  await expect(page.locator('#screen-manager')).toBeVisible();
  await expect(page.locator('#branch-filter button')).toHaveCount(3);       // الكل + the two branches
  await expect(page.locator('#branch-filter button').first()).toBeEnabled();
  await expect(page.locator('#all-shipments li')).toHaveCount(1);
  await page.click(`#branch-filter button[data-branch="${names[0]}"]`);     // the other branch is empty
  await expect(page.locator('#all-shipments li')).toContainText('مفيش شحنات');
});

test('admin: a repeated PIN is refused before it can hand over someone else\'s access', async ({ page }) => {
  await openAdmin(page);
  await page.click('#btn-add-user');
  await page.fill('input[data-uname="0"]', 'حسن');
  await page.fill('input[data-upin="0"]', await page.evaluate(() => window.APP_CONFIG.branches[0].pin));
  await page.click('#btn-save-config');
  await expect(page.locator('#toast')).toContainText('رقم سري متكرر');
  expect(await page.evaluate(() => localStorage.getItem('test-config'))).toBeNull();
});

test('login: one PIN box sends each user to the screen they are allowed', async ({ page }) => {
  await page.goto('/?test=1');
  await seedUsers(page, [EMP, MGR, ADM]);
  await expect(page.locator('#screen-login')).toBeVisible();

  await page.fill('#login-pin', '9999');                     // unknown PIN
  await page.click('#btn-login');
  await expect(page.locator('#toast')).toContainText('الرقم السري غلط');

  await page.fill('#login-pin', EMP.pin);                    // employee stays on this page
  await page.press('#login-pin', 'Enter');
  await expect(page.locator('#screen-home')).toBeVisible();
  await expect(page.locator('#who')).toContainText('سيد');
  await expect(page.locator('#who')).toContainText('فرع قويسنا');
  await expect(page.locator('#link-manager')).toBeHidden();  // no manager permission, no link
  await expect(page.locator('#btn-new')).toBeVisible();      // create permission → the button is there

  await page.click('#btn-logout');
  await expect(page.locator('#screen-login')).toBeVisible();
  await page.fill('#login-pin', MGR.pin);                    // manager PIN → routed to the manager page
  await page.click('#btn-login');
  await page.waitForURL(/manager\.html/);
  await expect(page.locator('#screen-manager')).toBeVisible();   // session carries over, no second PIN
  await expect(page.locator('#screen-title')).toHaveText('قويسنا');
});

test('permissions actually hide the actions on the manager page', async ({ page }) => {
  await page.goto('/manager.html?test=1');
  await page.evaluate(() => localStorage.setItem('test-shipments', JSON.stringify([
    { name: 'شحنة المراعي', createdBy: 'أحمد', branch: 'فرع قويسنا', type: 'إذن استلام',
      createdAt: 1753700000000, items: [{ barcode: '111', name: 'لبن', qty: 3 }] },
  ])));
  await seedUsers(page, [MGR]);
  await page.fill('#pin-input', MGR.pin);
  await page.click('#btn-pin');
  await expect(page.locator('#all-shipments li')).toHaveCount(1);
  await expect(page.locator('button[data-act="del"]')).toHaveCount(0);      // no delete permission
  await expect(page.locator('button[data-act="download"]')).toHaveCount(1); // download is allowed
  await expect(page.locator('#btn-products')).toBeHidden();                 // no catalog permission
  await expect(page.locator('#tool-import')).toBeHidden();
  await expect(page.locator('#tool-export')).toBeVisible();
  await expect(page.locator('#branch-filter button')).toHaveCount(1);       // one branch → locked chip
  await expect(page.locator('#branch-filter button')).toBeDisabled();
  await page.click('button[data-act="view"]');
  await expect(page.locator('#btn-save-edit')).toBeVisible();               // edit is allowed
});

test('a PIN typed on the wrong page is redirected to the right one', async ({ page }) => {
  await page.goto('/manager.html?test=1');
  await seedUsers(page, [EMP, ADM]);
  await page.fill('#pin-input', ADM.pin);                    // admin PIN on the manager page
  await page.click('#btn-pin');
  await expect(page.locator('#toast')).toContainText('مش من صلاحياتك');
  await page.waitForURL(/admin\.html/);
  await expect(page.locator('#screen-admin')).toBeVisible();
  await expect(page.locator('#danger-tools')).toBeVisible();  // danger permission granted

  await page.click('#btn-logout');
  await page.goto('/admin.html?test=1');
  await page.fill('#pin-input', EMP.pin);                     // employee PIN on the admin page
  await page.click('#btn-pin');
  await page.waitForURL(/index\.html|\/\?test=1/);
  await expect(page.locator('#screen-home')).toBeVisible();
  await expect(page.locator('#who')).toContainText('سيد');
});

test('the old PINs keep working after users exist', async ({ page }) => {
  await page.goto('/manager.html?test=1');
  await seedUsers(page, [EMP]);
  await page.fill('#pin-input', await page.evaluate(() => window.APP_CONFIG.managerPin));
  await page.click('#btn-pin');
  await expect(page.locator('#screen-manager')).toBeVisible();
  await expect(page.locator('#btn-products')).toBeVisible();   // legacy master PIN keeps every action
  await expect(page.locator('#tool-import')).toBeVisible();
});

test("draft survives reload", async ({ page }) => {
  await page.goto("/?test=1");
  await page.evaluate(() => { localStorage.setItem('employeeName', 'أحمد'); localStorage.setItem('test-products', JSON.stringify({ '111': 'لبن', '222': 'جبنة' })); });
  await page.reload();
  await page.click("#btn-new");
  await page.fill("#shipment-name", "مسودة");
  await page.fill("#barcode-input", "111");
  await page.click("#btn-lookup");
  await page.click("#btn-add-item");
  await page.reload();
  await page.click("#btn-new");
  await expect(page.locator('#items-list li:not(.empty)')).toHaveCount(1);
  await expect(page.locator("#shipment-name")).toHaveValue("مسودة");
});

/* ---------- الجرد: counting the shelf against the quantity the shop's system says ---------- */

const COUNTER = { name: 'سعيد', pin: '7733', branches: ['فرع قويسنا'], perms: ['emp', 'create', 'count', 'edit'] };
const NO_COUNT = { name: 'سيد', pin: '2233', branches: ['فرع قويسنا'], perms: ['emp', 'create'] };

test('stocktake sheet import writes the quantity under the branch it was imported for', async ({ page }) => {
  await openManagerPage(page);
  const names = await page.evaluate(() => window.APP_CONFIG.branches.map(b => b.name));
  await page.click(`#stock-branch button[data-stockbranch="${names[0]}"]`);
  await page.setInputFiles('#stock-file', 'tests/fixtures/stock.csv');
  await expect(page.locator('#toast')).toContainText(`تم استيراد كميات 2 صنف لـ${names[0]}`);
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('test-products')));
  expect(saved['6221031250057']).toEqual({ name: 'لبن المراعي', stock: { [names[0]]: 24 } });
  expect(saved['6224000123456']).toEqual({ name: 'جبنة بيضاء', stock: { [names[0]]: 8 } });

  // the other branch has its own sheet, and importing it must not touch the first one
  await page.click(`#stock-branch button[data-stockbranch="${names[1]}"]`);
  await page.setInputFiles('#stock-file', 'tests/fixtures/stock-b.csv');
  await expect(page.locator('#toast')).toContainText(`تم استيراد كميات 1 صنف لـ${names[1]}`);
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('test-products')));
  expect(saved['6221031250057']).toEqual({ name: 'لبن المراعي', stock: { [names[0]]: 24, [names[1]]: 3 } });
  expect(saved['6224000123456']).toEqual({ name: 'جبنة بيضاء', stock: { [names[0]]: 8 } });

  // renaming from the catalog screen must not drop the quantities sitting next to the name
  await page.click('#btn-products');
  await page.fill('input[data-barcode="6221031250057"]', 'لبن المراعي 1 لتر');
  await page.click('#btn-save-products');
  await expect(page.locator('#toast')).toContainText('تم حفظ 1 اسم');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-products'))['6221031250057']))
    .toEqual({ name: 'لبن المراعي 1 لتر', stock: { [names[0]]: 24, [names[1]]: 3 } });

  // and the exported sheet carries the chosen branch's column, ready to be filled in again
  const exp = (await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-export-products'),
  ]))[0];
  const csv = require('fs').readFileSync(await exp.path(), 'utf8');
  expect(csv).toContain(`"الكمية في ${names[1]}"`);
  expect(csv).toContain('"6221031250057","لبن المراعي 1 لتر","3"');
});

test('the same barcode shows each branch its own quantity', async ({ page }) => {
  await page.goto('/?test=1');
  const names = await page.evaluate(() => window.APP_CONFIG.branches.map(b => b.name));
  await page.evaluate((b) => {
    localStorage.setItem('employeeName', 'أحمد');
    localStorage.setItem('test-products', JSON.stringify({
      '111': { name: 'لبن', stock: { [b[0]]: 10, [b[1]]: 4 } },
      '222': { name: 'جبنة', qty: 7 },                 // only the old shop-wide sheet
    }));
  }, names);
  await seedUsers(page, [{ name: 'محمود', pin: '6622', branches: names, perms: ['emp', 'count'] }]);
  await page.fill('#login-pin', '6622');
  await page.click('#btn-login');
  await page.click('#btn-count');
  await page.click(`#new-branch-picker button[data-newbranch="${names[1]}"]`);
  await page.fill('#barcode-input', '111');
  await page.click('#btn-lookup');
  await expect(page.locator('#item-stock-qty')).toHaveText('4');      // شبين's own sheet
  await page.click('#btn-cancel-item');
  await page.click(`#new-branch-picker button[data-newbranch="${names[0]}"]`);
  await page.fill('#barcode-input', '111');
  await page.click('#btn-lookup');
  await expect(page.locator('#item-stock-qty')).toHaveText('10');     // قويسنا's own sheet
  await page.click('#btn-cancel-item');
  await page.fill('#barcode-input', '222');                           // no branch sheet yet
  await page.click('#btn-lookup');
  await expect(page.locator('#item-stock-qty')).toHaveText('7');      // falls back to the old one
});

test('employee stocktake: the sheet shows what the system says, the save keeps both numbers', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => {
    localStorage.setItem('employeeName', 'أحمد');
    localStorage.setItem('test-products', JSON.stringify({ '111': { name: 'لبن', qty: 10 }, '222': 'جبنة' }));
  });
  await page.reload();
  await page.click('#btn-count');
  await expect(page.locator('#new-type-row')).toBeHidden();         // a stocktake has no shipment type
  await expect(page.locator('#new-name-head')).toHaveText('اسم الجرد');
  await page.fill('#shipment-name', 'جرد رف اللبن');
  await page.fill('#barcode-input', '111');
  await page.click('#btn-lookup');
  await expect(page.locator('#item-stock')).toBeVisible();
  await expect(page.locator('#item-stock-qty')).toHaveText('10');   // the whole point of the screen
  await page.fill('#item-qty', '3');
  await page.click('#btn-add-item');
  await expect(page.locator('#items-list li:not(.empty)')).toContainText('في النظام 10 · ناقص 7');

  await page.fill('#barcode-input', '222');                         // never given a quantity
  await page.click('#btn-lookup');
  await expect(page.locator('#item-stock-qty')).toHaveText('غير مسجّلة');
  await page.click('#btn-add-item');
  await expect(page.locator('#items-list li:not(.empty)').nth(1)).toContainText('مش مسجّل في النظام');

  await page.click('#btn-save-shipment');
  await expect(page.locator('#toast')).toContainText('تم حفظ الجرد');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('test-counts')));
  expect(saved).toHaveLength(1);
  expect(saved[0].name).toBe('جرد رف اللبن');
  expect(saved[0].items[0]).toEqual({ barcode: '111', name: 'لبن', qty: 3, sys: 10 });
  expect(saved[0].items[1]).toEqual({ barcode: '222', name: 'جبنة', qty: 1 });   // no sys invented
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-shipments') || '[]'))).toHaveLength(0);
  // −7 short on the milk, +1 of a cheese the system never listed
  await expect(page.locator('#my-counts li')).toContainText('الفرق ناقص 6');
});

test('a stocktake reopens for editing and the difference follows the new quantity', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => {
    localStorage.setItem('employeeName', 'أحمد');
    localStorage.setItem('test-products', JSON.stringify({ '111': { name: 'لبن', qty: 10 } }));
    localStorage.setItem('test-counts', JSON.stringify([
      { name: 'جرد قديم', createdBy: 'أحمد', createdAt: 1753700000000, branch: 'فرع قويسنا',
        items: [{ barcode: '111', name: 'لبن', qty: 4, sys: 10 }] },
    ]));
  });
  await page.reload();
  await expect(page.locator('#my-counts li')).toContainText('الفرق ناقص 6');
  await page.click('button[data-editcount="0"]');
  await expect(page.locator('#shipment-name')).toHaveValue('جرد قديم');
  await page.fill('#barcode-input', '111');
  await page.click('#btn-lookup');
  await page.click('#btn-add-item');                                 // one more found on the shelf
  await page.click('#btn-save-shipment');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('test-counts')));
  expect(saved).toHaveLength(1);                                     // edited, not duplicated
  expect(saved[0].items[0].qty).toBe(5);
  await expect(page.locator('#my-counts li')).toContainText('الفرق ناقص 5');
});

test('the stocktake permission gates the button and the list', async ({ page }) => {
  await page.goto('/?test=1');
  await seedUsers(page, [NO_COUNT, COUNTER]);
  await page.fill('#login-pin', NO_COUNT.pin);
  await page.click('#btn-login');
  await expect(page.locator('#screen-home')).toBeVisible();
  await expect(page.locator('#btn-count')).toBeHidden();
  await expect(page.locator('#counts-block')).toBeHidden();

  await signOut(page);
  await page.goto('/?test=1');
  await page.fill('#login-pin', COUNTER.pin);
  await page.click('#btn-login');
  await expect(page.locator('#btn-count')).toBeVisible();
  await expect(page.locator('#counts-block')).toBeVisible();
});

test('manager: the stocktake tab lists a count with its difference, exports it and deletes it', async ({ page }) => {
  await openManagerPage(page);
  await page.evaluate(() => localStorage.setItem('test-counts', JSON.stringify([
    { name: 'جرد التلاجة', createdBy: 'سعيد', createdAt: 1753700000000, branch: 'فرع قويسنا',
      items: [{ barcode: '111', name: 'لبن', qty: 7, sys: 10 }, { barcode: '222', name: 'جبنة', qty: 2 }] },
  ])));
  await page.reload();                                              // the session survives, no second PIN
  await expect(page.locator('#screen-manager')).toBeVisible();
  await expect(page.locator('#counts-block')).toBeHidden();          // the shipments tab opens first
  await page.click('#list-tabs button[data-tab="count"]');
  await expect(page.locator('#ships-block')).toBeHidden();
  await expect(page.locator('#type-filter-row')).toBeHidden();       // no shipment type on a count
  await expect(page.locator('#all-counts li')).toContainText('جرد التلاجة');
  await expect(page.locator('#all-counts li')).toContainText('الفرق ناقص 1');   // 3 short, 2 not in the system

  const exp = (await Promise.all([
    page.waitForEvent('download'),
    page.click('#all-counts button[data-cact="download"]'),
  ]))[0];
  expect(exp.suggestedFilename()).toBe('جرد التلاجة.csv');
  const csv = require('fs').readFileSync(await exp.path(), 'utf8');
  expect(csv).toContain('"الباركود","اسم الصنف","في النظام","المعدود","الفرق"');
  expect(csv).toContain('"111","لبن","10","7","-3"');
  expect(csv).toContain('"222","جبنة","غير مسجّلة","2",""');

  await page.click('#all-counts button[data-cact="view"]');          // the manager may fix a number
  await expect(page.locator('#detail-type-row')).toBeHidden();
  await expect(page.locator('#detail-items tr').first()).toContainText('في النظام 10 · ناقص 3');
  await page.fill('#detail-items input[data-qty="0"]', '10');
  await expect(page.locator('#detail-items tr').first()).toContainText('مظبوط');
  await page.click('#btn-save-edit');
  await expect(page.locator('#toast')).toContainText('تم حفظ التعديلات');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-counts'))[0].items[0].qty)).toBe(10);

  await page.click('#list-tabs button[data-tab="count"]');
  page.on('dialog', (d) => d.accept());
  await page.click('#all-counts button[data-cact="del"]');
  await expect(page.locator('#toast')).toContainText('تم الحذف');
  await page.click('#list-tabs button[data-tab="count"]');
  await expect(page.locator('#all-counts li')).toContainText('مفيش جرد');
});

test('camera settings: resolution and continuous focus stick per phone', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => localStorage.setItem('employeeName', 'أحمد'));
  await page.reload();
  await page.click('#btn-cam');
  await expect(page.locator('#res-picker button[data-res="hd"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#btn-focus')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#res-picker button[data-res="fhd"]');
  await page.click('#btn-focus');
  const cam = await page.evaluate(() => JSON.parse(localStorage.getItem('camSettings')));
  expect(cam.res).toBe('fhd');
  expect(cam.focus).toBe(false);
  await page.reload();
  await page.click('#btn-cam');
  await expect(page.locator('#res-picker button[data-res="fhd"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#btn-focus')).toHaveAttribute('aria-pressed', 'false');
});

/* ---------- الصلاحيات ---------- */

// fixed dates on purpose: the month a row belongs to must not depend on the day the tests run
const EXP_ROWS = [
  { _id: 'e1', barcode: '111', name: 'لبن', qty: 5, day: 14, month: 9, year: 2026,
    branch: 'فرع قويسنا', createdBy: 'أحمد', createdAt: 1753700000000 },
  { _id: 'e2', barcode: '222', name: 'جبنة', qty: 2, day: 3, month: 9, year: 2026,
    branch: 'فرع قويسنا', createdBy: 'أحمد', createdAt: 1753700000001 },
  { _id: 'e3', barcode: '111', name: 'لبن', qty: 4, day: 20, month: 10, year: 2026,
    branch: 'فرع قويسنا', createdBy: 'أحمد', createdAt: 1753700000002 },
];

async function openExpiry(page, rows = []) {
  await page.goto('/?test=1');
  await page.evaluate((r) => {
    localStorage.setItem('employeeName', 'أحمد');
    localStorage.setItem('test-products', JSON.stringify({ '111': 'لبن', '222': 'جبنة' }));
    localStorage.setItem('test-expiry', JSON.stringify(r));
  }, rows);
  await page.reload();
  await page.click('#btn-expiry');
}

test('الصلاحيات: a scan opens the month, a second scan of the same date grows the same row', async ({ page }) => {
  await openExpiry(page);
  await expect(page.locator('#exp-months li')).toContainText('لسه مفيش صلاحيات');

  await page.fill('#barcode-input', '999');                        // not in the catalog
  await page.click('#btn-lookup');
  await expect(page.locator('#item-warn-line')).toContainText('مش هيتسجّل في الصلاحيات');
  await expect(page.locator('#btn-add-item')).toBeHidden();
  await page.click('#btn-cancel-item');

  await page.fill('#barcode-input', '111');
  await page.click('#btn-lookup');
  await expect(page.locator('#item-date-row')).toBeVisible();
  await page.click('#btn-add-item');                               // no date yet
  await expect(page.locator('#toast')).toContainText('حدّد تاريخ انتهاء الصلاحية');
  await page.fill('#item-date', '2026-09-14');
  await page.fill('#item-qty', '5');
  await page.click('#btn-add-item');
  await expect(page.locator('#toast')).toContainText('سبتمبر 2026');
  await expect(page.locator('#exp-months li')).toContainText('سبتمبر 2026');
  await expect(page.locator('#exp-months li')).toContainText('1 صنف · 5 قطعة');

  await page.fill('#barcode-input', '111');                        // same product, same date
  await page.click('#btn-lookup');
  await page.fill('#item-qty', '3');
  await page.click('#btn-add-item');
  await expect(page.locator('#exp-months li')).toHaveCount(1);     // one month, one row, more pieces
  await expect(page.locator('#exp-months li')).toContainText('1 صنف · 8 قطعة');
  const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('test-expiry')));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ barcode: '111', name: 'لبن', qty: 8, day: 14, month: 9, year: 2026, branch: 'فرع قويسنا' });
});

test('الصلاحيات: a year outside what the rules allow is refused before it is saved', async ({ page }) => {
  await openExpiry(page);
  const parsed = await page.evaluate(async () => {
    const ex = await import('./expiry.js');
    return { wild: ex.fromIso('202026-09-14'), far: ex.fromIso('9999-09-14'),
      early: ex.fromIso('1999-09-14'), ok: ex.fromIso('2026-09-14') };
  });
  expect(parsed).toEqual({ wild: null, far: null, early: null, ok: { year: 2026, month: 9, day: 14 } });

  await page.fill('#barcode-input', '111');
  await page.click('#btn-lookup');
  await page.fill('#item-date', '9999-09-14');          // the year segment eats a stray keystroke
  await page.click('#btn-add-item');
  await expect(page.locator('#toast')).toContainText('السنة لازم بين');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-expiry')))).toHaveLength(0);
  // the browser marks it too, so the field looks wrong before the button is even pressed
  await expect(page.locator('#item-date')).toHaveAttribute('max', '2100-12-31');
});

test('الصلاحيات: months are sorted nearest first and carry both counters', async ({ page }) => {
  await openExpiry(page, EXP_ROWS);
  await expect(page.locator('#exp-months li')).toHaveCount(2);      // a month exists only while it has rows
  await expect(page.locator('#exp-months li').nth(0)).toContainText('سبتمبر 2026');
  await expect(page.locator('#exp-months li').nth(0)).toContainText('2 صنف · 7 قطعة');
  await expect(page.locator('#exp-months li').nth(1)).toContainText('أكتوبر 2026');
  await expect(page.locator('#exp-months li').nth(1)).toContainText('1 صنف · 4 قطعة');
});

test('الصلاحيات: the month screen searches, fixes a quantity and moves a wrong date', async ({ page }) => {
  await openExpiry(page, EXP_ROWS);
  await page.click('#exp-months button[data-month="2026-09"]');
  await expect(page.locator('#month-head')).toHaveText('سبتمبر 2026');
  await expect(page.locator('#month-items li')).toHaveCount(2);

  await page.fill('#month-search', 'جبن');                          // search inside the month
  await expect(page.locator('#month-items li')).toHaveCount(1);
  await expect(page.locator('#month-items li')).toContainText('جبنة');
  await page.fill('#month-search', '');

  await page.fill('#month-items input[data-eqty="e1"]', '9');
  await expect(page.locator('#month-dirty')).toHaveText('1 تعديل');
  await page.fill('#month-items input[data-edate="e2"]', '2026-11-03');   // wrong month, fixed
  await expect(page.locator('#month-dirty')).toHaveText('2 تعديل');
  await page.click('#btn-save-month');
  await expect(page.locator('#toast')).toContainText('تم حفظ 2 تعديل');
  await expect(page.locator('#month-items li')).toHaveCount(1);           // the cheese left this month
  await expect(page.locator('#month-count')).toContainText('1 صنف · 9 قطعة');

  await page.click('#btn-back');
  await expect(page.locator('#exp-months li')).toHaveCount(3);
  await expect(page.locator('#exp-months li').nth(2)).toContainText('نوفمبر 2026');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('test-expiry')));
  expect(saved.find(e => e._id === 'e1').qty).toBe(9);
  expect(saved.find(e => e._id === 'e2')).toMatchObject({ day: 3, month: 11, year: 2026, name: 'جبنة' });
});

test('الصلاحيات: deleting the last row of a month takes the month off the screen', async ({ page }) => {
  await openExpiry(page, [EXP_ROWS[2]]);
  page.on('dialog', (d) => d.accept());
  await page.click('#exp-months button[data-month="2026-10"]');
  await page.click('#month-items button[data-delexp="e3"]');
  await expect(page.locator('#screen-expiry')).toBeVisible();       // back on the months list
  await expect(page.locator('#exp-months li')).toContainText('لسه مفيش صلاحيات');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-expiry')))).toHaveLength(0);
});

test('الصلاحيات: the permission gates the card', async ({ page }) => {
  await page.goto('/?test=1');
  await seedUsers(page, [
    { name: 'سيد', pin: '2233', branches: ['فرع قويسنا'], perms: ['emp', 'create'] },
    { name: 'هدى', pin: '3344', branches: ['فرع قويسنا'], perms: ['emp', 'expiry', 'edit', 'del'] },
  ]);
  await page.fill('#login-pin', '2233');
  await page.click('#btn-login');
  await expect(page.locator('#btn-expiry')).toBeHidden();
  await signOut(page);
  await page.goto('/?test=1');
  await page.fill('#login-pin', '3344');
  await page.click('#btn-login');
  await expect(page.locator('#btn-expiry')).toBeVisible();
});

test('manager: the expiry tab groups by month, exports Excel and deletes a row', async ({ page }) => {
  await openManagerPage(page);
  await page.evaluate((r) => localStorage.setItem('test-expiry', JSON.stringify(r)), EXP_ROWS);
  await page.reload();
  await expect(page.locator('#expiry-block')).toBeHidden();          // the shipments tab opens first
  await page.click('#list-tabs button[data-tab="expiry"]');
  await expect(page.locator('#all-months li')).toHaveCount(2);
  await expect(page.locator('#all-months li').nth(0)).toContainText('سبتمبر 2026');
  await expect(page.locator('#all-months li').nth(0)).toContainText('2 صنف · 7 قطعة');

  const dl = (await Promise.all([
    page.waitForEvent('download'),
    page.click('#all-months button[data-monthcsv="2026-09"]'),
  ]))[0];
  expect(dl.suggestedFilename()).toBe('صلاحيات-سبتمبر 2026.csv');
  const csv = require('fs').readFileSync(await dl.path(), 'utf8');
  expect(csv).toContain('"الفرع","الباركود","اسم الصنف","الكمية","تاريخ الصلاحية","الحالة","الموظف"');
  expect(csv).toContain('"فرع قويسنا","222","جبنة","2","2026-09-03"');

  await page.click('#all-months button[data-month="2026-09"]');
  await expect(page.locator('#m-head')).toHaveText('سبتمبر 2026');
  page.on('dialog', (d) => d.accept());
  await page.click('#m-items button[data-delexp="e2"]');
  await expect(page.locator('#toast')).toContainText('تم الحذف');
  await expect(page.locator('#m-items li')).toHaveCount(1);
  await page.click('#btn-back');
  await expect(page.locator('#all-months li').nth(0)).toContainText('1 صنف · 5 قطعة');
});
