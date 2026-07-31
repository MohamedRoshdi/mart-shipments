// The manager list after the button cull: card, card screen, and the count/expiry tabs.
import { chromium } from "@playwright/test";

const OUT = process.env.OUT || "/tmp/shots";
const BASE = process.env.BASE || "http://localhost:8080";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });

const day = (d) => new Date(`2026-07-${d}T09:00:00`).getTime();
const ships = [
  { name: "العائله", createdBy: "محمد سعيد", branch: "فرع قويسنا", type: "إذن استلام", createdAt: day(30), items: [{ barcode: "111", name: "لبن", qty: 3 }] },
  { name: "باهى", createdBy: "حسن", branch: "فرع قويسنا", type: "إذن استلام", createdAt: day(30), items: [{ barcode: "111", name: "لبن", qty: 5 }] },
  { name: "تحويل لفرع شبين", createdBy: "حسن", branch: "فرع قويسنا", type: "تحويل فرع", createdAt: day(30), items: [{ barcode: "222", name: "جبنة", qty: 2 }] },
  { name: "جهينه", createdBy: "محمد", branch: "فرع قويسنا", type: "إذن استلام", createdAt: day(29), items: [{ barcode: "111", name: "لبن", qty: 9 }] },
];

await page.goto(`${BASE}/manager.html?test=1`);
await page.evaluate((s) => {
  localStorage.setItem("test-shipments", JSON.stringify(s));
  localStorage.setItem("test-products", JSON.stringify({ 111: "لبن", 222: "جبنة" }));
  localStorage.setItem("test-counts", JSON.stringify([
    { name: "جرد رف اللبن", createdBy: "حسن", branch: "فرع قويسنا", createdAt: Date.parse("2026-07-30T10:00:00"),
      items: [{ barcode: "111", name: "لبن", qty: 7, sys: 10 }] },
  ]));
}, ships);
await page.fill("#pin-input", await page.evaluate(() => window.APP_CONFIG.managerPin));
await page.click("#btn-pin");
await page.waitForTimeout(400);
await shot("m1-list");

await page.click('button[data-act="view"]');
await page.waitForTimeout(300);
await shot("m2-card");

await page.click("#btn-back");
await page.click("#btn-filters");                       // the chips, one tap away
await page.waitForTimeout(200);
await shot("m4-filters-open");
await page.click('#type-filter button[data-typefilter="تحويل فرع"]');
await page.waitForTimeout(200);
await shot("m5-filtered");                              // the toggle now says what is filtered
console.log("toggle:", await page.locator("#btn-filters").innerText());

await page.click('#type-filter button[data-typefilter="الكل"]');
await page.click('#list-tabs button[data-tab="count"]');
await page.waitForTimeout(300);
await shot("m3-counts");

await browser.close();
