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
  await expect(page.locator('#items-list li')).toHaveCount(1);
  await expect(page.locator('#items-list li')).toContainText('× 3');
  await page.click('#btn-save-shipment');
  await expect(page.locator('#screen-home')).toBeVisible();
  await expect(page.locator('#my-shipments li')).toContainText('شحنة المراعي');
});

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
  const pin = await page.evaluate(() => window.APP_CONFIG.managerPin);
  await page.fill('#pin-input', pin === '0000' ? '9999' : '0000');
  await page.click('#btn-pin');
  await expect(page.locator('#screen-pin')).toBeVisible(); // wrong PIN stays
  await page.fill('#pin-input', pin);
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

test('scanner lib loads', async ({ page }) => {
  await page.goto('/?test=1');
  const hasLib = await page.evaluate(() => typeof window.Html5Qrcode === 'function');
  expect(hasLib).toBe(true);
});

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

test("catalog CSV import autofills names", async ({ page }) => {
  await page.goto("/?test=1");
  await page.evaluate(() => localStorage.setItem("employeeName", "أحمد"));
  await page.reload();
  await page.click("#btn-manager");
  const pin = await page.evaluate(() => window.APP_CONFIG.managerPin);
  await page.fill("#pin-input", pin);
  await page.click("#btn-pin");
  await page.setInputFiles("#import-file", "tests/fixtures/catalog.csv");
  await expect(page.locator("#toast")).toContainText("تم استيراد 2 صنف");
  await page.click("#screen-manager .btn-back");
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
  await expect(page.locator("#items-list li")).toContainText("9990001112223");
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
  await expect(page.locator("#items-list li")).toHaveCount(1);
  await expect(page.locator("#shipment-name")).toHaveValue("مسودة");
});
