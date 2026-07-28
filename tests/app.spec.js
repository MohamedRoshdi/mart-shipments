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
