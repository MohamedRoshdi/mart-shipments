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

async function openManagerPage(page) {
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
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-products'))['111']))
    .toBe('لبن المراعي 1 لتر');

  page.on('dialog', (d) => d.accept());                       // delete
  await page.click('button[data-delproduct="222"]');
  await expect(page.locator('#products-list li')).toHaveCount(2);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-products'))['222'])).toBeUndefined();

  const dl = (await Promise.all([                             // export catalog
    page.waitForEvent('download'),
    page.click('#btn-export-products'),
  ]))[0];
  expect(dl.suggestedFilename()).toBe('products.csv');
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
  const resManager = await page.request.get('/manifest-manager.json');
  expect(resManager.ok()).toBeTruthy();
  const resAdmin = await page.request.get('/manifest-admin.json');
  expect(resAdmin.ok()).toBeTruthy();
  const resTemplate = await page.request.get('/products-template.csv');
  expect(resTemplate.ok()).toBeTruthy();
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
