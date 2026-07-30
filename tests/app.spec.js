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
  await expect(page.locator('#items-list li:not(.empty)')).toHaveCount(1);
  await expect(page.locator('#items-list li:not(.empty)')).toContainText('3');
  await page.click('#btn-save-shipment');
  await expect(page.locator('#screen-home')).toBeVisible();
  await expect(page.locator('#my-shipments li')).toContainText('شحنة المراعي');
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
  await page.evaluate(() => localStorage.setItem('employeeName', 'أحمد'));
  await page.reload();
  await page.click('#btn-new');
  await page.fill('#shipment-name', 'شحنة');
  await page.fill('#barcode-input', '111');
  await page.click('#btn-lookup');
  await page.fill('#item-name', 'صنف غلط');
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
  const [b1, b2] = await page.evaluate(() => window.APP_CONFIG.branches);
  expect([b1, b2]).toEqual(['فرع قويسنا', 'فرع شبين الكوم']);
  await page.fill('#employee-name', 'أحمد');
  await page.click(`button[data-branch="${b2}"]`);
  await page.click('#save-name');
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
  await page.click(`button[data-branch="${b1}"]`);          // other branch → empty
  await expect(page.locator('#all-shipments li')).toContainText('مفيش شحنات');
  await page.click(`button[data-branch="${b2}"]`);
  await expect(page.locator('#all-shipments li')).toContainText('شحنة شبين');
});

test('manager page: download one shipment and all shipments as CSV', async ({ page }) => {
  await openManagerPage(page);
  const one = await Promise.all([
    page.waitForEvent('download'),
    page.click('button[data-act="download"]'),
  ]).then(([d]) => d);
  expect(one.suggestedFilename()).toBe('شحنة المراعي.csv');
  const oneText = require('fs').readFileSync(await one.path(), 'utf8');
  expect(oneText.startsWith('﻿')).toBe(true);            // Excel needs the BOM for Arabic
  expect(oneText).toContain('"6221031250057","لبن","3"');

  const all = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-export-all'),
  ]).then(([d]) => d);
  expect(all.suggestedFilename()).toBe('shipments-all.csv');
  const allText = require('fs').readFileSync(await all.path(), 'utf8');
  expect(allText).toContain('"الفرع","الشحنة","الموظف","التاريخ","الباركود","اسم الصنف","الكمية"');
  expect(allText).toContain('"شحنة المراعي","أحمد"');
});

test('back button and phone back return to the previous screen', async ({ page }) => {
  await page.goto('/?test=1');
  await page.evaluate(() => localStorage.setItem('employeeName', 'أحمد'));
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
  await page.evaluate(() => localStorage.setItem("employeeName", "أحمد"));
  await page.reload();
  await page.click("#btn-new");
  await page.fill("#barcode-input", "6221031250057");
  await page.click("#btn-lookup");
  await expect(page.locator("#item-name")).toHaveValue("لبن المراعي");
});

test("item without name saves showing barcode", async ({ page }) => {
  await page.goto("/?test=1");
  await page.evaluate(() => localStorage.setItem("employeeName", "أحمد"));
  await page.reload();
  await page.click("#btn-new");
  await page.fill("#shipment-name", "شحنة بدون أسماء");
  await page.fill("#barcode-input", "9990001112223");
  await page.click("#btn-lookup");
  await page.click("#btn-add-item");
  await expect(page.locator('#items-list li:not(.empty)')).toContainText("9990001112223");
});

test("draft survives reload", async ({ page }) => {
  await page.goto("/?test=1");
  await page.evaluate(() => localStorage.setItem("employeeName", "أحمد"));
  await page.reload();
  await page.click("#btn-new");
  await page.fill("#shipment-name", "مسودة");
  await page.fill("#barcode-input", "111");
  await page.click("#btn-lookup");
  await page.fill("#item-name", "صنف");
  await page.click("#btn-add-item");
  await page.reload();
  await page.click("#btn-new");
  await expect(page.locator('#items-list li:not(.empty)')).toHaveCount(1);
  await expect(page.locator("#shipment-name")).toHaveValue("مسودة");
});
