const { test, expect } = require('@playwright/test');

// with no users configured the first screen is name + branch — no branch PIN any more
async function setUp(page, name = 'أحمد', branchIndex = 0) {
  const b = (await page.evaluate(() => window.APP_CONFIG.branches))[branchIndex];
  // only catalog barcodes can be added now, so every flow needs a catalog
  await page.evaluate(() => localStorage.getItem('test-products')
    || localStorage.setItem('test-products', JSON.stringify({ '111': 'لبن', '222': 'جبنة' })));
  await page.fill('#employee-name', name);
  await page.click(`button[data-branch="${b.name}"]`);
  await page.click('#save-name');
  return b;
}

test('first open asks name and branch, and nothing else', async ({ page }) => {
  await page.goto('/?test=1');
  await expect(page.locator('#screen-name')).toBeVisible();
  await expect(page.locator('#branch-pin')).toHaveCount(0);   // the branch PIN is gone
  await page.click('#save-name');                             // no name yet
  await expect(page.locator('#screen-name')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('اكتب اسمك الأول');
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

test('search by name: the middle of the name counts, and so does a loose hamza', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => {
    localStorage.setItem('employeeName', 'أحمد');
    localStorage.setItem('test-products', JSON.stringify({
      '111': 'جهينة لبن كامل الدسم', '222': 'سكر أبيض ناعم', '333': 'شاي العروسة',
    }));
  });
  await page.reload();
  await page.click('#btn-new');                                    // the box travels with the scanner
  await expect(page.locator('#find-input')).toBeVisible();

  await page.fill('#find-input', 'لبن');                           // mid-name, not a prefix
  await expect(page.locator('#find-results li')).toHaveCount(1);
  await expect(page.locator('#find-results')).toContainText('جهينة لبن كامل الدسم');

  await page.fill('#find-input', 'ابيض');                          // typed without the hamza
  await expect(page.locator('#find-results')).toContainText('سكر أبيض ناعم');
  await page.click('#find-results button[data-pick="222"]');
  await expect(page.locator('#item-name')).toHaveText('سكر أبيض ناعم');
  await expect(page.locator('#find-input')).toHaveValue('');       // picked: the list is done
  await page.click('#btn-add-item');
  await expect(page.locator('#items-list li:not(.empty)')).toHaveCount(1);

  await page.fill('#find-input', 'مفيش');
  await expect(page.locator('#find-results li.empty')).toBeVisible();

  await page.click('#btn-back');                                   // and the same box on الصلاحيات
  await page.click('#btn-expiry');
  await expect(page.locator('#screen-expiry')).toBeVisible();
  await page.fill('#find-input', 'العروسة');
  await expect(page.locator('#find-results')).toContainText('شاي العروسة');
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
  await expect(page.locator('#all-shipments button')).toHaveCount(1);   // one card, one tap
  await page.click('button[data-act="view"]');
  await expect(page.locator('#detail-name')).toHaveValue('شحنة المراعي');
  await page.click('#btn-copy');                                        // exports live on the card screen
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toBe('6221031250057\t3');
});

test('manager page: edit name, change qty, delete item', async ({ page }) => {
  await openManagerPage(page);
  await page.click('button[data-act="view"]');
  await page.fill('#detail-name', 'شحنة معدّلة');
  await page.fill('input[data-qty="0"]', '7');
  await page.click('#btn-save-edit');
  await expect(page.locator('#all-shipments li')).toContainText('شحنة معدّلة');
  await page.click('button[data-act="view"]');
  await page.click('#btn-copy');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('6221031250057\t7');
  await page.click('button[data-delitem="0"]');           // still on the card screen
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
  await page.click('button[data-act="view"]');
  await page.click('#btn-delete-detail');
  await expect(page.locator('#screen-manager')).toBeVisible();     // the gone card is not behind back
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
  await expect(page.locator('#filters')).toBeHidden();         // chips are one tap away, not always on
  await page.click('#btn-filters');
  await page.click(`button[data-branch="${cfg[0].name}"]`);   // other branch → empty
  await expect(page.locator('#btn-filters')).toHaveText(/قويسنا/);   // the toggle says what is filtered
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
  await page.evaluate(() => localStorage.setItem('test-products', JSON.stringify({ '111': 'لبن' })));
  await page.fill('#employee-name', 'أحمد');
  await page.press('#employee-name', 'Enter');
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
  await page.click('#btn-filters');
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
  expect(csv).toContain('"الفرع","نوع الشحنة","كود المورد","الشحنة"');
  expect(csv).toContain(`"${t3}"`);
});

test('a manager scoped to one branch sees only that branch', async ({ page }) => {
  await page.goto('/manager.html?test=1');
  const cfg = await page.evaluate(() => window.APP_CONFIG.branches);
  await page.evaluate((names) => {
    localStorage.setItem('test-shipments', JSON.stringify([
      { name: 'شحنة قويسنا', createdBy: 'أحمد', branch: names[0], createdAt: 1753700000000,
        items: [{ barcode: '111', name: 'لبن', qty: 1 }] },
      { name: 'شحنة شبين', createdBy: 'سيد', branch: names[1], createdAt: 1753600000000,
        items: [{ barcode: '222', name: 'جبنة', qty: 2 }] },
    ]));
    const stored = JSON.parse(localStorage.getItem('test-config') || '{}');
    localStorage.setItem('test-config', JSON.stringify({
      ...window.APP_CONFIG, ...stored,
      users: [{ name: 'مدير شبين', pin: '8811', branches: [names[1]], perms: ['mgr', 'download'] }],
    }));
  }, cfg.map(b => b.name));
  await page.reload();                                        // APP_CONFIG merges the config at boot
  await page.fill('#pin-input', '8811');                      // شبين الكوم manager, by account
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

  await page.click('button[data-act="view"]');           // one shipment: from the card screen
  const one = await grab('#btn-download');
  expect(one.suggestedFilename()).toBe('شحنة المراعي.csv');
  const oneText = require('fs').readFileSync(await one.path(), 'utf8');
  expect(oneText.startsWith('﻿')).toBe(true);            // Excel needs the BOM for Arabic
  expect(oneText).toContain('"6221031250057","لبن","","3"');   // الوحدة column, empty here

  const oneTxt = await grab('#btn-download-txt');
  await page.click('#btn-back');
  expect(oneTxt.suggestedFilename()).toBe('شحنة المراعي.txt');
  expect(require('fs').readFileSync(await oneTxt.path(), 'utf8')).toBe('6221031250057\t3');

  const all = await grab('#btn-export-all');
  expect(all.suggestedFilename()).toBe('shipments-all.csv');
  const allText = require('fs').readFileSync(await all.path(), 'utf8');
  expect(allText).toContain('"الفرع","نوع الشحنة","كود المورد","الشحنة","الموظف","التاريخ","الباركود","اسم الصنف","الوحدة","الكمية"');
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
  await expect(page.locator('#products-list li.empty')).toContainText('جرّب أي جزء من الاسم أو الباركود');
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

// the shipment name is the supplier: the admin types the list, the employee picks from it
async function seedSuppliers(page, list) {
  await page.evaluate((s) => {
    const cfg = JSON.parse(localStorage.getItem('test-config') || '{}');
    localStorage.setItem('test-config', JSON.stringify({ ...window.APP_CONFIG, ...cfg, suppliers: s }));
  }, list);
  await page.reload();
}

test('admin: the supplier list is one line each, code optional, trimmed', async ({ page }) => {
  await openAdmin(page);
  await page.fill('#cfg-suppliers', '  1042، المراعي  \n\n1088,جهينة\nبيبسي\n   \n');
  await expect(page.locator('#suppliers-count')).toHaveText('3 مورد · 2 منهم بكود');
  await page.click('#btn-save-config');
  await expect(page.locator('#toast')).toContainText('تم حفظ الإعدادات');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-config')).suppliers))
    .toEqual([
      { code: '1042', name: 'المراعي' },
      { code: '1088', name: 'جهينة' },
      { code: '', name: 'بيبسي' },
    ]);
});

test('a 5-digit PIN reaches the manager page: the box used to cut it at 4', async ({ page }) => {
  await page.goto('/manager.html?test=1');
  await expect(page.locator('#pin-input')).toHaveAttribute('maxlength', '8');
  await seedUsers(page, [{ ...MGR, pin: '44112' }]);
  await page.fill('#pin-input', '44112');
  expect(await page.inputValue('#pin-input')).toBe('44112');     // not truncated to «4411»
  await page.click('#btn-pin');
  await expect(page.locator('#screen-manager')).toBeVisible();
});

test('admin: a supplier list bigger than 300 still saves — the shop has 425', async ({ page }) => {
  await openAdmin(page);
  const lines = Array.from({ length: 425 }, (_, i) => `${1000 + i}، مورد ${i + 1}`).join('\n');
  await page.fill('#cfg-suppliers', lines);
  await expect(page.locator('#suppliers-count')).toHaveText('425 مورد · 425 منهم بكود');
  await page.click('#btn-save-config');
  await expect(page.locator('#toast')).toContainText('تم حفظ الإعدادات');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('test-config')).suppliers);
  expect(saved).toHaveLength(425);
  expect(saved[424]).toEqual({ code: '1424', name: 'مورد 425' });
});

test('admin: the supplier list can be imported from a sheet, header row dropped', async ({ page }) => {
  await openAdmin(page);
  await page.setInputFiles('#suppliers-file', {
    name: 'suppliers.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('كود المورد,اسم المورد\n1042,المراعي\n1088,جهينة\n,بيبسي\n', 'utf8'),
  });
  await expect(page.locator('#toast')).toContainText('اتقرأ 3 مورد');
  await expect(page.locator('#cfg-suppliers')).toHaveValue('1042، المراعي\n1088، جهينة\nبيبسي');
  await page.click('#btn-save-config');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-config')).suppliers))
    .toEqual([
      { code: '1042', name: 'المراعي' },
      { code: '1088', name: 'جهينة' },
      { code: '', name: 'بيبسي' },
    ]);
});

test('supplier code: found by code, stamped on the shipment, searchable and in Excel', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => {
    localStorage.setItem('employeeName', 'أحمد');
    localStorage.setItem('test-products', JSON.stringify({ '111': 'لبن' }));
  });
  await seedSuppliers(page, [{ code: '1042', name: 'المراعي' }, { code: '1088', name: 'جهينة' }]);
  await page.click('#btn-new');
  await page.click('#shipment-name');
  await page.fill('#shipment-name', '1042');                       // typed the code, not the name
  await expect(page.locator('#supplier-results button.suggest')).toHaveCount(1);
  await expect(page.locator('#supplier-results')).toContainText('المراعي');
  await page.click('#supplier-results button[data-supplier="المراعي"]');
  await expect(page.locator('#shipment-name')).toHaveValue('المراعي');   // the name is what is typed

  await page.fill('#barcode-input', '111');
  await page.click('#btn-lookup');
  await page.click('#btn-add-item');
  await page.click('#btn-save-shipment');
  await expect(page.locator('#toast')).toContainText('تم حفظ الشحنة');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('test-shipments'))[0]);
  expect(saved.name).toBe('المراعي');
  expect(saved.supplierCode).toBe('1042');                          // looked up, never typed

  await page.goto('/manager.html?test=1');                          // keep the shipment just saved
  await page.fill('#pin-input', await page.evaluate(() => window.APP_CONFIG.managerPin));
  await page.click('#btn-pin');
  await page.fill('#list-search', '1042');                          // the manager finds it by code
  await expect(page.locator('#all-shipments li')).toHaveCount(1);
  await expect(page.locator('#all-shipments li')).toContainText('المراعي');
  const dl = (await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-export-all'),
  ]))[0];
  const csv = require('fs').readFileSync(await dl.path(), 'utf8');
  expect(csv).toContain('"كود المورد"');
  expect(csv).toContain('"1042","المراعي"');
});

test('supplier suggestions: loose Arabic, free text still allowed, none during a stocktake', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => {
    localStorage.setItem('employeeName', 'أحمد');
    localStorage.setItem('test-products', JSON.stringify({ '111': 'لبن' }));
  });
  await seedSuppliers(page, ['المراعي', 'جهينة للألبان', 'بيبسي']);

  await page.click('#btn-new');
  await expect(page.locator('#supplier-results')).toBeHidden();      // not until it is asked for
  await page.click('#shipment-name');
  await expect(page.locator('#supplier-results li')).toHaveCount(3); // focus offers the whole list
  await page.fill('#shipment-name', 'مراعى');                        // typed with ى, stored with ي
  await expect(page.locator('#supplier-results li')).toHaveCount(1);
  await page.click('#supplier-results button.suggest[data-supplier="المراعي"]');
  await expect(page.locator('#shipment-name')).toHaveValue('المراعي');
  await expect(page.locator('#supplier-results')).toBeHidden();      // an exact hit needs no list

  await page.fill('#shipment-name', 'مورد جديد مش في القايمة');       // free text is never blocked
  await expect(page.locator('#supplier-results li.empty')).toBeVisible();
  await page.fill('#barcode-input', '111');
  await page.click('#btn-lookup');
  await page.click('#btn-add-item');
  await page.click('#btn-save-shipment');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-shipments'))[0].name))
    .toBe('مورد جديد مش في القايمة');

  await page.click('#btn-count');                                     // a shelf has no supplier
  await page.click('#shipment-name');
  await expect(page.locator('#supplier-results')).toBeHidden();
  await expect(page.locator('#new-name-head')).toHaveText('اسم الجرد');
});

test('manager: the list search finds a supplier, and hides on the expiry tab', async ({ page }) => {
  await page.goto('/manager.html?test=1');
  await page.evaluate(() => localStorage.setItem('test-shipments', JSON.stringify([
    { name: 'المراعي', createdBy: 'أحمد', branch: 'فرع قويسنا', type: 'إذن استلام', createdAt: 1753700000000, items: [] },
    { name: 'جهينة للألبان', createdBy: 'سيد', branch: 'فرع قويسنا', type: 'إذن استلام', createdAt: 1753600000000, items: [] },
  ])));
  await page.fill('#pin-input', await page.evaluate(() => window.APP_CONFIG.managerPin));
  await page.click('#btn-pin');
  await expect(page.locator('#all-shipments li')).toHaveCount(2);
  await page.fill('#list-search', 'البان');                          // no hamza, mid-name
  await expect(page.locator('#all-shipments li')).toHaveCount(1);
  await expect(page.locator('#all-shipments li')).toContainText('جهينة للألبان');
  await page.fill('#list-search', 'سيد');                            // the employee's name too
  await expect(page.locator('#all-shipments li')).toHaveCount(1);
  await page.fill('#list-search', '');
  await page.click('#list-tabs button[data-tab="expiry"]');
  await expect(page.locator('#list-search')).toBeHidden();
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

test("الوحدة: the third column rides from the sheet to the item sheet and into Excel", async ({ page }) => {
  await openManagerPage(page);
  await page.setInputFiles("#import-file", "tests/fixtures/catalog-units.csv");
  await expect(page.locator("#toast")).toContainText("تم استيراد 4 صنف");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("test-products")));
  expect(saved["6221031250057"]).toEqual({ name: "لبن المراعي", unit: "كرتونة" });
  expect(saved["6220000999888"]).toEqual({ name: "شاي أحمر", unit: "كيس" });   // a comma in the name survives
  expect(saved["6229000111222"]).toEqual({ name: "أرز" });                      // no unit given, none written

  await page.goto("/?test=1");
  await page.evaluate(() => localStorage.setItem("employeeName", "أحمد"));
  await page.reload();
  await page.click("#btn-new");
  await page.fill("#shipment-name", "شحنة الوحدات");
  await page.fill("#barcode-input", "6221031250057");
  await page.click("#btn-lookup");
  await expect(page.locator("#item-unit")).toBeVisible();
  await expect(page.locator("#item-unit-name")).toHaveText("كرتونة");
  await page.click("#btn-add-item");
  await page.fill("#barcode-input", "6229000111222");            // no unit → the line stays hidden
  await page.click("#btn-lookup");
  await expect(page.locator("#item-unit")).toBeHidden();
  await page.click("#btn-add-item");
  await page.click("#btn-save-shipment");
  const saveditems = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("test-shipments")).find(s => s.name === "شحنة الوحدات").items);
  expect(saveditems).toEqual([{ barcode: "6221031250057", name: "لبن المراعي", qty: 1, unit: "كرتونة" },
                              { barcode: "6229000111222", name: "أرز", qty: 1 }]);

  await signOut(page);                                           // Excel carries it, TXT never does
  await page.goto("/manager.html?test=1");
  await page.fill("#pin-input", await page.evaluate(() => window.APP_CONFIG.managerPin));
  await page.click("#btn-pin");
  const grab = async (loc) => (await Promise.all([page.waitForEvent("download"), loc.click()]))[0];
  await page.locator("button[data-act='view']").first().click();
  const csvDl = await grab(page.locator("#btn-download"));
  const csv = require("fs").readFileSync(await csvDl.path(), "utf8");
  expect(csv).toContain("الوحدة");
  expect(csv).toContain("كرتونة");
  const txtDl = await grab(page.locator("#btn-download-txt"));
  const txt = require("fs").readFileSync(await txtDl.path(), "utf8");
  expect(txt).not.toContain("كرتونة");
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
  await page.click('#btn-add-type');
  await page.fill('input[data-tname="3"]', 'إذن تحويل مخزن');
  await page.click('#btn-save-config');
  await expect(page.locator('#toast')).toContainText('تم حفظ الإعدادات');

  await page.goto('/?test=1');                                  // employee: the new branch is offered
  await expect(page.locator('button[data-branch="فرع بنها"]')).toBeVisible();
  await page.fill('#employee-name', 'سيد');
  await page.click('button[data-branch="فرع بنها"]');
  await page.click('#save-name');
  await expect(page.locator('#who')).toContainText('فرع بنها');
  await page.click('#btn-new');
  await expect(page.locator('#type-picker button[data-type="إذن تحويل مخزن"]')).toBeVisible();

  await signOut(page);                                          // the admin session would skip the PIN
  await page.goto('/manager.html?test=1');                      // manager: both appear as filters
  await page.fill('#pin-input', await page.evaluate(() => window.APP_CONFIG.managerPin));
  await page.click('#btn-pin');
  await page.click('#btn-filters');
  await expect(page.locator('#branch-filter button[data-branch="فرع بنها"]')).toBeVisible();
  await expect(page.locator('#type-filter button[data-typefilter="إذن تحويل مخزن"]')).toBeVisible();
});

test('admin: the audit trail shows what the manager did', async ({ page }) => {
  await openManagerPage(page);
  page.on('dialog', (d) => d.accept());
  await page.click('button[data-act="view"]');
  await page.click('#btn-delete-detail');
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
  await expect(page.locator('#logs-list li').first()).toContainText('حذف بالجملة');
});

test('admin: bulk delete can take one day, a range of days, or a stocktake', async ({ page }) => {
  await page.goto('/admin.html?test=1');
  await page.evaluate(() => {
    const day = (iso) => new Date(`${iso}T09:00:00`).getTime();     // local noon-ish, same day everywhere
    localStorage.setItem('test-shipments', JSON.stringify([
      { name: 'شحنة الاتنين', createdBy: 'أحمد', branch: 'فرع قويسنا', type: 'إذن استلام', createdAt: day('2026-07-20'), items: [] },
      { name: 'شحنة التلات', createdBy: 'أحمد', branch: 'فرع قويسنا', type: 'إذن استلام', createdAt: day('2026-07-21'), items: [] },
      { name: 'شحنة الأربع', createdBy: 'أحمد', branch: 'فرع قويسنا', type: 'إذن استلام', createdAt: day('2026-07-22'), items: [] },
    ]));
    localStorage.setItem('test-counts', JSON.stringify([
      { name: 'جرد الرف', createdBy: 'أحمد', branch: 'فرع قويسنا', createdAt: day('2026-07-21'), items: [] },
    ]));
  });
  await page.fill('#pin-input', await page.evaluate(() => window.APP_CONFIG.adminPin));
  await page.click('#btn-pin');
  await expect(page.locator('#btn-bulk-delete')).toHaveText('حذف المطابق (3)');

  await page.fill('#bulk-from', '2026-07-21');                     // one day: both ends the same
  await page.fill('#bulk-to', '2026-07-21');
  await expect(page.locator('#btn-bulk-delete')).toHaveText('حذف المطابق (1)');
  await page.fill('#bulk-to', '2026-07-22');                       // a range
  await expect(page.locator('#btn-bulk-delete')).toHaveText('حذف المطابق (2)');

  page.on('dialog', (d) => d.accept());
  await page.click('#btn-bulk-delete');
  await expect(page.locator('#toast')).toContainText('تم حذف 2 شحنة');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-shipments')).map(s => s.name)))
    .toEqual(['شحنة الاتنين']);

  await page.click('#bulk-kind button[data-bulkkind="counts"]');   // الجرد, same tool
  await expect(page.locator('#bulk-type-row')).toBeHidden();
  await expect(page.locator('#btn-bulk-delete')).toHaveText('حذف المطابق (1)');
  await page.click('#btn-bulk-delete');
  await expect(page.locator('#toast')).toContainText('تم حذف 1 جرد');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-counts')))).toEqual([]);
});

test('manager: ZIP export puts each shipment straight in its day folder', async ({ page }) => {
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
  const [day1, day2] = await page.evaluate(() =>
    [1753700000000, 1753600000000].map(ms => new Date(ms).toLocaleDateString('en-CA')));
  expect(raw).toContain(`${day1}/شحنة اللحمة.csv`);
  expect(raw).toContain(`${day1}/شحنة اللحمة.txt`);
  expect(raw).toContain(`${day2}/مرتجع الألبان.csv`);
  expect(raw).not.toContain('إذن استلام/');            // no folder per type any more
  expect(raw).toContain('111\t3');
});

test('manager: الجرد zips into a folder per day, and الصلاحيات into one per expiry day', async ({ page }) => {
  await page.goto('/manager.html?test=1');
  await page.evaluate(() => {
    localStorage.setItem('test-counts', JSON.stringify([
      { name: 'جرد رف الألبان', createdBy: 'أحمد', branch: 'فرع قويسنا', createdAt: 1753700000000,
        items: [{ barcode: '111', name: 'لبن', qty: 4, sys: 6 }] },
    ]));
    localStorage.setItem('test-expiry', JSON.stringify([
      { _id: 'e1', barcode: '111', name: 'لبن', qty: 2, day: 14, month: 9, year: 2026,
        branch: 'فرع قويسنا', createdBy: 'أحمد', createdAt: 1753700000001 },
      { _id: 'e2', barcode: '222', name: 'جبنة', qty: 5, day: 3, month: 11, year: 2026,
        branch: 'فرع قويسنا', createdBy: 'أحمد', createdAt: 1753700000002 },
    ]));
  });
  await page.fill('#pin-input', await page.evaluate(() => window.APP_CONFIG.managerPin));
  await page.click('#btn-pin');

  await page.click('#list-tabs button[data-tab="count"]');
  const counts = (await Promise.all([page.waitForEvent('download'), page.click('#btn-zip-counts')]))[0];
  expect(counts.suggestedFilename()).toMatch(/^جرد-\d{4}-\d{2}-\d{2}\.zip$/);
  const day = await page.evaluate(() => new Date(1753700000000).toLocaleDateString('en-CA'));
  const countsRaw = require('fs').readFileSync(await counts.path()).toString('utf8');
  expect(countsRaw).toContain(`${day}/جرد رف الألبان.csv`);

  await page.click('#list-tabs button[data-tab="expiry"]');
  const exp = (await Promise.all([page.waitForEvent('download'), page.click('#btn-zip-expiry')]))[0];
  expect(exp.suggestedFilename()).toMatch(/^صلاحيات-\d{4}-\d{2}-\d{2}\.zip$/);
  const expRaw = require('fs').readFileSync(await exp.path()).toString('utf8');
  expect(expRaw).toContain('2026-09-14/الصلاحيات.csv');   // the expiry date, not the day it was typed
  expect(expRaw).toContain('2026-11-03/الصلاحيات.csv');
  expect(expRaw).not.toContain('سبتمبر 2026/');
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
  await page.click('#btn-filters');
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
  await page.fill('input[data-upin="0"]', await page.evaluate(() => window.APP_CONFIG.managerPin));
  await page.click('#btn-save-config');
  await expect(page.locator('#toast')).toContainText('رقم سري متكرر');
  expect(await page.evaluate(() => localStorage.getItem('test-config'))).toBeNull();
});

test('a user account sticks to the first phone, and only the admin frees it', async ({ page }) => {
  await page.goto('/?test=1');
  await seedUsers(page, [EMP]);
  await page.fill('#login-pin', EMP.pin);
  await page.click('#btn-login');
  await expect(page.locator('#screen-home')).toBeVisible();
  const phone1 = await page.evaluate(() => localStorage.getItem('deviceId'));
  expect(phone1).toBeTruthy();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-config')).users[0].device)).toBe(phone1);

  await signOut(page);                                            // same PIN, another phone
  await page.evaluate(() => localStorage.setItem('deviceId', 'phone-2'));
  await page.goto('/?test=1');
  await page.fill('#login-pin', EMP.pin);
  await page.click('#btn-login');
  await expect(page.locator('#toast')).toContainText('مربوط بموبايل تاني');
  await expect(page.locator('#screen-login')).toBeVisible();

  await openAdmin(page);
  await page.click('#btn-save-config');                           // a plain save must not unbind anybody
  await expect(page.locator('#toast')).toContainText('تم حفظ الإعدادات');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-config')).users[0].device)).toBe(phone1);

  await page.click('button[data-unbind="0"]');
  await page.click('#btn-save-config');
  await expect(page.locator('#toast')).toContainText('تم حفظ الإعدادات');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-config')).users[0].device)).toBeUndefined();

  await signOut(page);                                            // now the second phone gets in, and claims it
  await page.goto('/?test=1');
  await page.fill('#login-pin', EMP.pin);
  await page.click('#btn-login');
  await expect(page.locator('#screen-home')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-config')).users[0].device)).toBe('phone-2');
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
  await expect(page.locator('#btn-products')).toBeHidden();                 // no catalog permission
  await expect(page.locator('#tool-import')).toBeHidden();
  await expect(page.locator('#tool-export')).toBeVisible();
  await expect(page.locator('#branch-filter-row')).toBeHidden();            // one branch → nothing to filter
  await page.click('button[data-act="view"]');
  await expect(page.locator('#btn-save-edit')).toBeVisible();               // edit is allowed
  await expect(page.locator('#detail-exports')).toBeVisible();              // download is allowed
  await expect(page.locator('#detail-danger')).toBeHidden();                // delete is not
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

  await page.click('#all-counts button[data-cact="view"]');
  await expect(page.locator('#btn-download-txt')).toBeHidden();     // a TXT of a count says nothing
  const exp = (await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-download'),
  ]))[0];
  expect(exp.suggestedFilename()).toBe('جرد التلاجة.csv');
  const csv = require('fs').readFileSync(await exp.path(), 'utf8');
  expect(csv).toContain('"الباركود","اسم الصنف","الوحدة","في النظام","المعدود","الفرق"');
  expect(csv).toContain('"111","لبن","","10","7","-3"');
  expect(csv).toContain('"222","جبنة","","غير مسجّلة","2",""');

  await expect(page.locator('#detail-type-row')).toBeHidden();       // the manager may fix a number
  await expect(page.locator('#detail-items tr').first()).toContainText('في النظام 10 · ناقص 3');
  await page.fill('#detail-items input[data-qty="0"]', '10');
  await expect(page.locator('#detail-items tr').first()).toContainText('مظبوط');
  await page.click('#btn-save-edit');
  await expect(page.locator('#toast')).toContainText('تم حفظ التعديلات');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-counts'))[0].items[0].qty)).toBe(10);

  await page.click('#list-tabs button[data-tab="count"]');
  page.on('dialog', (d) => d.accept());
  await page.click('#all-counts button[data-cact="view"]');
  await page.click('#btn-delete-detail');
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
  await expect(page.locator('#month-items li')).toContainText('أحمد');   // who recorded it
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

  await page.click('#all-months button[data-month="2026-09"]');      // Excel is inside the month
  const dl = (await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-export-month'),
  ]))[0];
  expect(dl.suggestedFilename()).toBe('صلاحيات-سبتمبر 2026.csv');
  const csv = require('fs').readFileSync(await dl.path(), 'utf8');
  expect(csv).toContain('"الفرع","الباركود","اسم الصنف","الكمية","تاريخ الصلاحية","الحالة","الموظف"');
  expect(csv).toContain('"فرع قويسنا","222","جبنة","2","2026-09-03"');

  await expect(page.locator('#m-head')).toHaveText('سبتمبر 2026');
  await expect(page.locator('#m-items li').first()).toContainText('أحمد');   // who recorded the row
  page.on('dialog', (d) => d.accept());
  await page.click('#m-items button[data-delexp="e2"]');
  await expect(page.locator('#toast')).toContainText('تم الحذف');
  await expect(page.locator('#m-items li')).toHaveCount(1);
  await page.click('#btn-back');
  await expect(page.locator('#all-months li').nth(0)).toContainText('1 صنف · 5 قطعة');
});

/* ---------- ليبل الرف ---------- */

test('label: EAN-13 when the checksum adds up, Code 128 when it does not', async ({ page }) => {
  await page.goto('/?test=1');
  const out = await page.evaluate(async () => {
    const lbl = await import('./label.js');
    return {
      check: lbl.eanCheck('622300123456'),
      ean: lbl.encode('6223001234562'),
      // same digits, wrong last one: a 13-digit code is not an EAN-13 unless it checks out
      notEan: lbl.encode('6223001234567').kind,
      short: lbl.encode('111').kind,
      arabic: lbl.encode('لبن'),
      empty: lbl.encode(''),
    };
  });
  expect(out.check).toBe(2);
  expect(out.ean.kind).toBe('EAN-13');
  expect(out.ean.bits).toHaveLength(95);                 // the whole symbology is 95 modules
  expect(out.ean.bits.startsWith('101')).toBe(true);
  expect(out.ean.bits.slice(45, 50)).toBe('01010');      // the middle guard
  expect(out.notEan).toBe('CODE128');
  expect(out.short).toBe('CODE128');
  expect(out.arabic).toBe(null);                         // no symbology here carries Arabic
  expect(out.empty).toBe(null);
});

test('label: the printed barcode decodes back to the barcode it came from', async ({ page }) => {
  await page.goto('/?test=1');
  const out = await page.evaluate(async () => {
    const lbl = await import('./label.js');
    const box = document.createElement('div');
    box.id = 'decode-box';
    box.style.inlineSize = '400px';
    document.body.append(box);
    // draw the SVG onto a white canvas and hand it to the same decoder the scanner uses
    const roundTrip = async (code) => {
      const svg = lbl.barcodeSvg(code);
      const img = await new Promise((ok, fail) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = fail;
        i.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
      });
      const c = document.createElement('canvas');
      c.width = 1000;
      c.height = 400;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 60, 60, c.width - 120, 280);
      const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
      const res = await new Html5Qrcode('decode-box')
        .scanFileV2(new File([blob], 'b.png', { type: 'image/png' }), false);
      return res.decodedText;
    };
    return { ean: await roundTrip('6223001234562'), code128: await roundTrip('AB-99') };
  });
  expect(out.ean).toBe('6223001234562');
  expect(out.code128).toBe('AB-99');
});

test('label: pick a product, preview it, print the copies asked for', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => {
    localStorage.setItem('employeeName', 'أحمد');
    localStorage.setItem('test-products', JSON.stringify({ '6223001234562': 'زيت عافية' }));
  });
  await page.reload();
  await page.evaluate(() => { window.printed = 0; window.print = () => { window.printed++; }; });

  await page.click('#btn-label');
  await expect(page.locator('#label-empty')).toBeVisible();
  await expect(page.locator('#scan-block')).toBeVisible();          // the one scanner moved here

  await page.fill('#barcode-input', '999');                         // not in the catalog
  await page.click('#btn-lookup');
  await expect(page.locator('#item-warn')).toBeVisible();
  await expect(page.locator('#item-warn-line')).toContainText('مفيش اسم نطبعه');
  await page.click('#btn-cancel-item');

  await page.fill('#barcode-input', '6223001234562');
  await page.click('#btn-lookup');
  await expect(page.locator('#item-form')).toBeHidden();             // a label needs no quantity
  await expect(page.locator('#label-preview .lbl-name')).toHaveText('زيت عافية');
  await expect(page.locator('#label-preview .lbl-code')).toHaveText('6223001234562');
  await expect(page.locator('#label-preview svg')).toHaveCount(1);

  await page.fill('#label-price', '45.95');                          // optional, never stored
  await expect(page.locator('#label-preview .lbl-price')).toContainText('45.95');

  await page.fill('#label-copies', '3');
  await page.click('#btn-print-label');
  await expect(page.locator('#print-area .lbl')).toHaveCount(3);
  expect(await page.evaluate(() => window.printed)).toBe(1);
  expect(await page.evaluate(() => document.getElementById('print-size').textContent)).toContain('66mm 35mm');

  // the count is never remembered: the box opens on 1 every time, and the owner adds from there
  await page.reload();
  await page.click('#btn-label');
  await page.fill('#barcode-input', '6223001234562');
  await page.click('#btn-lookup');
  await expect(page.locator('#label-copies')).toHaveValue('1');
  // and a product the catalog has no price for says so instead of showing a blank box
  await expect(page.locator('#label-price')).toHaveValue('');
  await expect(page.locator('#label-price-note')).toBeVisible();
});

test('import: the two templates the app itself hands out still import', async ({ page }) => {
  await page.goto('/manager.html?test=1');
  await page.fill('#pin-input', await page.evaluate(() => window.APP_CONFIG.managerPin));
  await page.click('#btn-pin');
  await page.click('#btn-products');
  await page.setInputFiles('#import-file', 'products-template.csv');   // الباركود، اسم الصنف، الوحدة
  await expect(page.locator('#toast')).toContainText('تم استيراد 3 صنف');

  await page.click('#btn-back');
  await page.click('#stock-branch button');
  // الكمية في النظام — the heading the template ships with, and the shape the catalog export writes
  await page.setInputFiles('#stock-file', 'stock-template.csv');
  await expect(page.locator('#toast')).toContainText('تم استيراد كميات 3 صنف');
  const branch = await page.evaluate(() => window.APP_CONFIG.branches[0].name);
  const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('test-products')));
  expect(rows['6221031250057'].stock[branch]).toBe(24);
  expect(rows['6224007850005'].stock[branch]).toBe(15);
});

test("import: the shop's own column order, unit codes and last selling price", async ({ page }) => {
  await page.goto('/manager.html?test=1');
  await page.fill('#pin-input', await page.evaluate(() => window.APP_CONFIG.managerPin));
  await page.click('#btn-pin');
  await page.click('#btn-products');
  // their catalog export: كود الصنف | الوحدة | اسم الصنف | معامل التحويل | اخر سعر بيع
  await page.setInputFiles('#import-file', {
    name: 'items.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'كود الصنف,الوحدة,اسم الصنف,معامل التحويل,اخر سعر بيع\n'
      + '6223001234562,4,زيت عافية,12,45.95\n'
      + '111,2,لحمة بلدي,1,320\n', 'utf8'),
  });
  await expect(page.locator('#toast')).toContainText('تم استيراد 2 صنف');
  const products = await page.evaluate(() => JSON.parse(localStorage.getItem('test-products')));
  // the word is what the shop reads, the code is what the ERP sent and what it gets back
  expect(products['6223001234562']).toEqual({ name: 'زيت عافية', unit: 'كرتونة', unitCode: 4, price: 45.95, factor: 12 });
  expect(products['111']).toEqual({ name: 'لحمة بلدي', unit: 'كيلو', unitCode: 2, price: 320 });

  // their stock export puts الرصيد first; the header is what makes the order not matter
  await page.click('#btn-back');
  await page.click('#stock-branch button');
  await page.setInputFiles('#stock-file', {
    name: 'stock.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('الرصيد,كود الصنف,الوحدة,اسم الصنف\n7,111,2,لحمة بلدي\n', 'utf8'),
  });
  await expect(page.locator('#toast')).toContainText('تم استيراد كميات 1 صنف');
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('test-products'))['111']);
  expect(after.price).toBe(320);                     // the stock sheet must not wipe the price
  expect(after.stock[await page.evaluate(() => window.APP_CONFIG.branches[0].name)]).toBe(7);

  // and the label fills its own price in
  await page.goto('/?test=1');
  await page.evaluate(() => localStorage.setItem('employeeName', 'أحمد'));
  await page.reload();
  await page.click('#btn-label');
  await page.fill('#barcode-input', '111');
  await page.click('#btn-lookup');
  await expect(page.locator('#label-price')).toHaveValue('320');
  await expect(page.locator('#label-preview .lbl-price')).toContainText('320');
});

test('label: several items queue up and print in one go', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => {
    localStorage.setItem('employeeName', 'أحمد');
    localStorage.setItem('test-products', JSON.stringify({ '111': 'لبن', '222': 'جبنة', '333': 'زيت' }));
  });
  await page.reload();
  await page.evaluate(() => { window.printed = 0; window.print = () => { window.printed++; }; });
  await page.click('#btn-label');

  const pick = async (code) => {
    await page.fill('#barcode-input', code);
    await page.click('#btn-lookup');
    await expect(page.locator('#label-preview .lbl-code')).toHaveText(code);
  };

  await pick('111');
  await page.fill('#label-copies', '2');
  await page.click('#btn-queue-label');
  await expect(page.locator('#label-queue li')).toHaveCount(1);
  await expect(page.locator('#label-box')).toBeHidden();         // ready for the next scan
  await expect(page.locator('#label-count')).toHaveText('2 ليبل');

  await pick('222');
  await page.fill('#label-price', '19.5');
  await page.fill('#label-copies', '3');
  await expect(page.locator('#label-count')).toHaveText('5 ليبل');  // the queue plus what is on screen

  await page.click('#btn-print-label');
  await expect(page.locator('#print-area .lbl')).toHaveCount(5);
  expect(await page.evaluate(() => window.printed)).toBe(1);       // one job, not one per item
  const printed = await page.locator('#print-area .lbl-code').allTextContents();
  expect(printed).toEqual(['111', '111', '222', '222', '222']);
  await expect(page.locator('#print-area .lbl-price').first()).toHaveText('');   // لبن had no price
  await expect(page.locator('#print-area .lbl-price').last()).toContainText('19.5');

  await page.click('#label-queue button[data-delqueue="0"]');      // a row can be pulled back out
  await expect(page.locator('#label-count')).toHaveText('3 ليبل');
});

test('label: a gap between products prints one job each, and stops when told', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => {
    localStorage.setItem('employeeName', 'أحمد');
    localStorage.setItem('test-products', JSON.stringify({ '111': 'لبن', '222': 'جبنة', '333': 'زيت' }));
    const cfg = JSON.parse(localStorage.getItem('test-config') || '{}');
    // one second, so the test is a test and not a nap
    localStorage.setItem('test-config', JSON.stringify({ ...cfg, label: { w: 66, h: 35, sheet: 'label', logo: '', gap: 1 } }));
  });
  await page.reload();
  await page.evaluate(() => { window.jobs = []; window.print = () => { window.jobs.push(document.querySelectorAll('#print-area .lbl').length); }; });
  await page.click('#btn-label');

  for (const code of ['111', '222']) {
    await page.fill('#barcode-input', code);
    await page.click('#btn-lookup');
    await page.click('#btn-queue-label');
  }
  await page.fill('#barcode-input', '333');
  await page.click('#btn-lookup');

  await page.click('#btn-print-label');
  await expect(page.locator('#btn-print-label')).toHaveText('إيقاف الطباعة');
  await expect(page.locator('#label-count')).toHaveText('بنطبع 1 من 3');
  await expect(page.locator('#label-count')).toHaveText('بنطبع 2 من 3');
  await page.click('#btn-print-label');                       // stop before the third
  await expect(page.locator('#btn-print-label')).toHaveText('طباعة');
  await expect(page.locator('#toast')).toContainText('وقفنا الطباعة');
  const jobs = await page.evaluate(() => window.jobs);
  expect(jobs).toEqual([1, 1]);                               // one product per job, third never sent
});

test('label: the admin sets the size, the paper and the logo, and the screen uses them', async ({ page }) => {
  await openAdmin(page);
  await page.fill('#cfg-label-w', '50');
  await page.fill('#cfg-label-h', '25');
  await page.click('#cfg-label-sheet button[data-sheet="a4"]');
  // a 500 px wide logo, picked the way the admin picks one
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 500;
    c.height = 200;
    const x = c.getContext('2d');
    x.fillStyle = '#f60';
    x.fillRect(0, 0, c.width, c.height);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'logo.png', { type: 'image/png' }));
    const input = document.getElementById('cfg-label-logo');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
  await expect(page.locator('#label-logo-preview img')).toBeVisible();
  await page.click('#btn-save-config');
  await expect(page.locator('#toast')).toContainText('تم حفظ الإعدادات');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('test-config')));
  expect(stored.label.w).toBe(50);
  expect(stored.label.h).toBe(25);
  expect(stored.label.sheet).toBe('a4');
  expect(stored.branches).toHaveLength(2);                           // the other settings survive
  // it is redrawn at printing width before it is stored: this doc is read by every phone at boot
  const logoWidth = await page.evaluate((src) => new Promise((ok) => {
    const i = new Image();
    i.onload = () => ok(i.naturalWidth);
    i.src = src;
  }), stored.label.logo);
  expect(logoWidth).toBe(360);

  await page.goto('/?test=1');
  await page.evaluate(() => {
    localStorage.setItem('employeeName', 'أحمد');
    localStorage.setItem('test-products', JSON.stringify({ '111': 'لبن' }));
  });
  await page.reload();
  await page.evaluate(() => { window.print = () => {}; });
  await page.click('#btn-label');
  await page.fill('#barcode-input', '111');
  await page.click('#btn-lookup');
  await expect(page.locator('#label-preview .lbl')).toHaveAttribute('style', /50mm/);
  await expect(page.locator('#label-preview img.lbl-logo')).toBeVisible();
  await page.click('#btn-print-label');
  expect(await page.evaluate(() => document.getElementById('print-size').textContent)).toContain('size: A4');
});

test('label: the catalog row links straight to the label of that barcode', async ({ page }) => {
  await page.goto('/manager.html?test=1');
  await page.evaluate(() => localStorage.setItem('test-products', JSON.stringify({ '111': 'لبن' })));
  await page.fill('#pin-input', await page.evaluate(() => window.APP_CONFIG.managerPin));
  await page.click('#btn-pin');
  await page.click('#btn-products');
  const href = await page.locator('#products-list a.lbl-link').first().getAttribute('href');
  expect(href).toBe('index.html?test=1#label=111');                  // ?test=1 must survive the hop
  await page.goto(href);
  await expect(page.locator('#screen-label')).toBeVisible();
  await expect(page.locator('#label-preview .lbl-name')).toHaveText('لبن');
});

test('label: a user without the permission never sees the screen', async ({ page }) => {
  await page.goto('/?test=1');
  await seedUsers(page, [EMP]);
  await page.fill('#login-pin', EMP.pin);
  await page.click('#btn-login');
  await expect(page.locator('#screen-home')).toBeVisible();
  await expect(page.locator('#btn-label')).toBeHidden();
  await page.evaluate(() => localStorage.setItem('test-products', JSON.stringify({ '111': 'لبن' })));
  await page.goto('/?test=1#label=111');
  await expect(page.locator('#screen-home')).toBeVisible();          // the deep link is refused too
  await expect(page.locator('#screen-label')).toBeHidden();
});

// tests/fixtures/catalog.xlsx is a real deflate-compressed workbook (scripts/make-xlsx-fixture.mjs),
// so this is the only test that proves the zip walk and the inflate actually run in a browser.
test('import: a real .xlsx, with a numeric barcode and a shared-string one', async ({ page }) => {
  await openManagerPage(page);
  await page.setInputFiles('#import-file', 'tests/fixtures/catalog.xlsx');
  await expect(page.locator('#toast')).toContainText('تم استيراد 2 صنف');
  await expect(page.locator('#toast')).toContainText('اترفض 1');     // unit code 9 is not a unit
  const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('test-products')));
  // the barcode Excel stored as a number is the one that used to come back as junk
  expect(rows['6221031492105']).toEqual({ name: 'لبن جهينة كامل الدسم', unit: 'كرتونة', unitCode: 4, price: 45.5, factor: 12 });
  expect(rows['6221024150011']).toEqual({ name: 'جبنة بيضاء فيتا', unit: 'كيلو', unitCode: 2, price: 88 });
  expect(rows['6221999000019']).toBeUndefined();                     // the refused row is not saved

  // معامل التحويل rides to the item sheet, and a factor of 1 never shows up at all
  await page.goto('/?test=1');
  await page.evaluate(() => localStorage.setItem('employeeName', 'أحمد'));
  await page.reload();
  await page.click('#btn-new');
  await page.fill('#barcode-input', '6221031492105');
  await page.click('#btn-lookup');
  await expect(page.locator('#item-unit-name')).toHaveText('كرتونة');
  await expect(page.locator('#item-factor-val')).toHaveText('12');
  await page.click('#btn-cancel-item');
  await page.fill('#barcode-input', '6221024150011');
  await page.click('#btn-lookup');
  await expect(page.locator('#item-factor')).toBeHidden();
});

// The dangerous case: a header row that is REAL but incomplete used to fall through to the
// positional rules and import the wrong column under the right barcode, silently.
test('import: a header row missing a column stops the file and names the column', async ({ page }) => {
  await openManagerPage(page);
  await page.click('#btn-products');
  await page.setInputFiles('#import-file', {
    name: 'items.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('كود الصنف,الوحدة,معامل التحويل\n6223001234562,4,12\n', 'utf8'),
  });
  await expect(page.locator('#toast')).toContainText('ناقصه عمود «اسم الصنف»');
  const products = await page.evaluate(() => JSON.parse(localStorage.getItem('test-products') || '{}'));
  expect(products['6223001234562']).toBeUndefined();                 // nothing at all was written

  // the stock sheet needs its quantity column by name, and says so
  await page.click('#btn-back');
  await page.click('#stock-branch button');
  await page.setInputFiles('#stock-file', {
    name: 'stock.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('كود الصنف,اسم الصنف\n111,لحمة بلدي\n', 'utf8'),
  });
  await expect(page.locator('#toast')).toContainText('ناقصه عمود «الرصيد»');
});

// A file with no header row at all is the OLD shape and must keep importing — this is what stops
// the validation above from breaking every sheet the shop already has.
test('import: a sheet with no header row still reads positionally', async ({ page }) => {
  await openManagerPage(page);
  await page.setInputFiles('#import-file', {
    name: 'items.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('6223001234562,زيت عافية,كرتونة\n', 'utf8'),
  });
  await expect(page.locator('#toast')).toContainText('تم استيراد 1 صنف');
  const products = await page.evaluate(() => JSON.parse(localStorage.getItem('test-products')));
  expect(products['6223001234562']).toEqual({ name: 'زيت عافية', unit: 'كرتونة' });
});

// Excel quotes any cell holding the separator. Splitting on the separator alone shifted every
// column after it — invisible while the readers swallowed the middle cells, wrong once they do not.
test('import: a quoted field keeps its comma and its column', async ({ page }) => {
  await openManagerPage(page);
  await page.setInputFiles('#import-file', {
    name: 'items.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'كود الصنف,الوحدة,اسم الصنف,اخر سعر بيع\n'
      + '6223001234562,3,"شيبسي، ٣٠ جم",7.5\n', 'utf8'),
  });
  await expect(page.locator('#toast')).toContainText('تم استيراد 1 صنف');
  const products = await page.evaluate(() => JSON.parse(localStorage.getItem('test-products')));
  expect(products['6223001234562'])
    .toEqual({ name: 'شيبسي، ٣٠ جم', unit: 'علبة', unitCode: 3, price: 7.5 });
});

test('suppliers: the file is read by its headings, in whatever order they come', async ({ page }) => {
  await openAdmin(page);
  // the ERP writes كود المورد first; this file writes it second, and both have to land the same
  await page.setInputFiles('#suppliers-file', {
    name: 'suppliers.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'اسم المورد,كود المورد\nجهينة,1042\n"المراعي، مصر",1043\nجهينة الجديدة,1042\n', 'utf8'),
  });
  await expect(page.locator('#toast')).toContainText('اتقرأ 2 مورد');   // 1042 twice is one supplier
  const typed = await page.inputValue('#cfg-suppliers');
  expect(typed).toBe('1042، جهينة الجديدة\n1043، المراعي، مصر');
});

// The version line is the only way somebody on a phone can tell you which build they are on.
// A missing import or a renamed element would leave it silently blank, which is the failure
// that matters — the text itself is checked so a stale BUILD is at least visible in a diff.
test('the version line names the system and the build on all three pages', async ({ page }) => {
  for (const url of ['/?test=1', '/manager.html?test=1', '/admin.html?test=1']) {
    await page.goto(url);
    await expect(page.locator('#version-line')).toHaveText(/العائلة مارت \| Version \d+\.\d+\.\d+ \| Build \d{2}-\d{2}-\d{4}/);
  }
});

/* files.js decides where a file goes. The disk path needs a real folder pick, which no headless
   browser can do — so what is provable here is the part that has to be right anyway: the names
   it builds, and that a browser which CANNOT write to disk still falls all the way back to the
   download every phone has always got. */
test('files: the names are safe and unique, and no folder means the old download', async ({ page }) => {
  await page.goto('/?test=1');
  const r = await page.evaluate(async () => {
    const f = await import('./files.js');
    return {
      // Windows refuses these outright, so a folder built from a supplier name has to lose them
      safe: f.safeSegment('مورد/شحنة: 2026?'),
      empty: f.safeSegment('   '),
      free: f.uniqueName('المراعي', '.txt', []),
      // the second file for the same supplier takes the permit number rather than overwriting
      withExtra: f.uniqueName('المراعي', '.txt', ['المراعي.txt'], '4471'),
      // and with no permit number it still cannot overwrite
      noExtra: f.uniqueName('المراعي', '.txt', ['المراعي.txt', 'المراعي (2).txt']),
      available: await f.available(),
      listed: await f.listFolder('اذن استلام'),
      read: await f.readText('اذن استلام', 'المراعي.txt'),
    };
  });
  expect(r.safe).toBe('مورد-شحنة- 2026-');
  expect(r.empty).toBe('ملف');
  expect(r.free).toBe('المراعي.txt');
  expect(r.withExtra).toBe('المراعي - 4471.txt');
  expect(r.noExtra).toBe('المراعي (3).txt');
  // nothing was ever chosen, so there is nothing to write to and nothing to read back
  expect(r.available).toBe(false);
  expect(r.listed).toEqual([]);
  expect(r.read).toBeNull();

  // and the export still hands the person their file, exactly as before
  await page.goto('/manager.html?test=1');
  const saved = await page.evaluate(async () => {
    const f = await import('./files.js');
    return (await f.saveText('اذن استلام', 'المراعي.txt', '111\t3')).how;
  });
  expect(saved).toBe('download');
});

test('admin: the folder section says what this browser can do', async ({ page }) => {
  await openAdmin(page);
  const supported = await page.evaluate(async () => (await import('./files.js')).supported());
  // whichever way this browser goes, the screen must not lie about it: the button is live only
  // where a folder can actually be picked, and the note explains itself where it cannot
  if (supported) {
    await expect(page.locator('#btn-folder-pick')).toBeEnabled();
    await expect(page.locator('#folder-note')).toContainText('اختار المجلد مرة واحدة');
  } else {
    await expect(page.locator('#btn-folder-pick')).toBeDisabled();
    await expect(page.locator('#folder-note')).toContainText('المتصفح ده مش بيسمح');
  }
  await expect(page.locator('#folder-now')).toBeHidden();       // nothing chosen yet
  await expect(page.locator('#btn-folder-clear')).toBeHidden();
});

/* The whole of the sync request that was actually missing: every read in this app was one-shot,
   so a change made on another machine arrived only at the next reload. In test mode watchConfig
   listens for the storage event, which is what a second tab raises — dispatched by hand here. */
/* A second permit for the same supplier, branch, type and quantities is a double stock entry once
   it reaches the ERP. The app cannot know whether it is a mistake, so it asks — and asks BEFORE
   «تم تحميلها» is written, or backing out would leave the shipment marked as loaded. */
test('a shipment identical to another one asks before it makes a TXT', async ({ page }) => {
  await signOut(page);
  await page.goto('/manager.html?test=1');
  await page.evaluate(() => {
    // in test mode _id is String(createdAt), so the two must not share a millisecond or each
    // would look like the other one's own row and neither would be seen as a twin
    const twin = (ago) => ({
      name: 'المراعي', createdBy: 'أحمد', createdAt: Date.now() - ago,
      branch: 'فرع قويسنا', type: 'إذن استلام',
      items: [{ barcode: '111', name: 'لبن', qty: 3 }],
    });
    localStorage.setItem('test-shipments', JSON.stringify([twin(0), twin(60000)]));
  });
  await page.fill('#pin-input', await page.evaluate(() => window.APP_CONFIG.managerPin));
  await page.click('#btn-pin');
  await page.click('.card-open');

  page.once('dialog', d => d.dismiss());                    // «إلغاء»
  await page.click('#btn-download-txt');
  await expect(page.locator('#detail-loaded')).toBeHidden();  // backing out marks nothing

  page.once('dialog', d => d.accept());                     // «إنشاء الإذن رغم ذلك»
  await Promise.all([page.waitForEvent('download'), page.click('#btn-download-txt')]);
  await expect(page.locator('#detail-loaded')).toContainText('تم تحميلها');
});

test('settings arrive live, with no reload', async ({ page }) => {
  await openManagerPage(page);
  await page.click('#btn-filters');
  const before = await page.locator('#type-filter button').count();
  await page.evaluate(() => {
    const cfg = JSON.parse(localStorage.getItem('test-config') || '{}');
    cfg.shipmentTypes = [...window.APP_CONFIG.shipmentTypes, 'إذن تحويل مخزن'];
    localStorage.setItem('test-config', JSON.stringify(cfg));
    dispatchEvent(new StorageEvent('storage', { key: 'test-config' }));
  });
  await expect(page.locator('#type-filter button')).toHaveCount(before + 1);
  await expect(page.locator('#type-filter')).toContainText('إذن تحويل مخزن');
});

test('تم تحميلها: the export marks it, and somebody else has to confirm a second load', async ({ page }) => {
  await openManagerPage(page);
  await page.click('button[data-act="view"]');
  await expect(page.locator('#detail-loaded')).toBeHidden();          // nobody has loaded it yet
  await expect(page.locator('#btn-loaded')).toHaveText('تم التحميل');

  // downloading the file IS taking the shipment into the shop's system
  await Promise.all([page.waitForEvent('download'), page.click('#btn-download-txt')]);
  await expect(page.locator('#detail-loaded')).toContainText('تم تحميلها');
  await expect(page.locator('#btn-loaded')).toHaveText('تحميل تاني');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('test-shipments'))[0]);
  expect(saved.loadedBy).toBeTruthy();
  expect(saved.loadedAt).toBeGreaterThan(0);
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem('test-logs')).some(l => l.action === 'تحميل شحنة'))).toBe(true);

  // the same person taking a second file is not a second loading: no dialog, no second log row
  await Promise.all([page.waitForEvent('download'), page.click('#btn-download')]);
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem('test-logs')).filter(l => l.action === 'تحميل شحنة').length)).toBe(1);

  await page.click('#btn-back');
  await expect(page.locator('#all-shipments .tag-loaded')).toHaveText('تم تحميلها');
  await expect(page.locator('#all-shipments li')).toContainText('حمّلها');

  // somebody else opens it: the warning names who loaded it, and cancelling loads nothing
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('test-shipments'));
    s[0].loadedBy = 'محمد يحيى';
    localStorage.setItem('test-shipments', JSON.stringify(s));
  });
  await page.reload();                                 // the session survives, so no PIN screen
  await page.click('button[data-act="view"]');
  let asked = '';
  page.once('dialog', d => { asked = d.message(); d.dismiss(); });
  await page.click('#btn-loaded');
  expect(asked).toContain('محمد يحيى');
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem('test-shipments'))[0].loadedBy)).toBe('محمد يحيى');

  page.once('dialog', d => d.accept());
  await page.click('#btn-loaded');
  await expect(page.locator('#toast')).toContainText('تحميل تاني');
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem('test-logs')).some(l => l.action === 'إعادة تحميل شحنة'))).toBe(true);
});

test('the list reads one month, and the picker reaches the older ones', async ({ page }) => {
  await signOut(page);
  await page.goto('/manager.html?test=1');
  await page.evaluate(() => {
    const item = [{ barcode: '111', name: 'لبن', qty: 1 }];
    localStorage.setItem('test-shipments', JSON.stringify([
      { name: 'شحنة الشهر ده', createdBy: 'أحمد', createdAt: Date.now(), items: item },
      // 100 days back is always a different month, whatever today is
      { name: 'شحنة قديمة', createdBy: 'أحمد', createdAt: Date.now() - 100 * 864e5, items: item },
    ]));
  });
  await page.fill('#pin-input', await page.evaluate(() => window.APP_CONFIG.managerPin));
  await page.click('#btn-pin');
  await expect(page.locator('#all-shipments li')).toHaveCount(1);
  await expect(page.locator('#all-shipments li')).toContainText('شحنة الشهر ده');

  await page.selectOption('#month-pick', '');                      // كل الشهور
  await expect(page.locator('#all-shipments li')).toHaveCount(2);

  await page.click('#list-tabs button[data-tab="expiry"]');
  await expect(page.locator('#month-pick')).toBeHidden();          // an expiry month is a date
});

test('import: an old .xls says so instead of importing nothing', async ({ page }) => {
  await openManagerPage(page);
  await page.setInputFiles('#import-file', {
    name: 'items.xls',
    mimeType: 'application/vnd.ms-excel',
    // the compound-file magic every real .xls starts with
    buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]),
  });
  await expect(page.locator('#toast')).toContainText('xls القديمة مش مدعومة');
  expect(await page.evaluate(() => localStorage.getItem('test-products'))).toBeNull();
});

