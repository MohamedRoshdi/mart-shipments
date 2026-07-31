// The three screens this batch changed, on a phone: the month bar over the list, a shipment card
// marked «تم تحميلها», and the item sheet carrying معامل التحويل.
// OUT=/tmp/shots BASE=http://localhost:8080 node scripts/shots-loaded.mjs
import { chromium, devices } from "@playwright/test";
import { mkdirSync } from "fs";

const BASE = process.env.BASE || "http://localhost:8080";
const OUT = process.env.OUT || "/tmp/shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 5"] });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("shot:", name);
};

// 1. the manager list: a loaded shipment and one that is not, under the month bar
await page.goto(`${BASE}/manager.html?test=1`, { waitUntil: "load" });
await page.evaluate(() => {
  const items = [{ barcode: "6221031250057", name: "لبن المراعي", qty: 3, unit: "كرتونة" }];
  localStorage.setItem("test-shipments", JSON.stringify([
    { name: "شركة جهينة للألبان", createdBy: "محمد يحيى", createdAt: Date.now() - 3600e3,
      branch: "فرع قويسنا", type: "بضاعة", items,
      loadedBy: "محمد الجندى", loadedAt: Date.now() - 1800e3 },
    { name: "المراعي مصر", createdBy: "محمد سعيد", createdAt: Date.now() - 7200e3,
      branch: "فرع قويسنا", type: "بضاعة", items },
  ]));
});
await page.fill("#pin-input", await page.evaluate(() => window.APP_CONFIG.managerPin));
await page.click("#btn-pin");
await page.waitForSelector("#screen-manager:not([hidden])");
await shot("loaded-list");

await page.click('#all-shipments button[data-act="view"]');
await page.waitForSelector("#screen-detail:not([hidden])");
await shot("loaded-detail");

// 2. the employee item sheet with الوحدة and معامل التحويل on it
await page.goto(`${BASE}/?test=1`, { waitUntil: "load" });
await page.evaluate(() => {
  localStorage.setItem("employeeName", "أحمد");
  localStorage.setItem("test-products", JSON.stringify({
    6221031250057: { name: "لبن المراعي كامل الدسم 1 لتر", unit: "كرتونة", factor: 12, price: 45.5 },
  }));
});
await page.reload();
await page.waitForSelector("#screen-home:not([hidden])");
await page.click("#btn-new");
await page.fill("#barcode-input", "6221031250057");
await page.click("#btn-lookup");
await page.waitForSelector("#item-form:not([hidden])");
await shot("item-factor");

await browser.close();
