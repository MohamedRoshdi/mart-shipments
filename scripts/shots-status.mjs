/* «حالة النظام» with a real day's usage on it, and «آخر العمليات» with the notes under the rows
   whose name does not say enough. Both are pure display, so a screenshot is the check that
   matters — the bar is the one thing a test can assert the colour of but not the shape of. */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.env.OUT || "/tmp/shots";
const BASE = process.env.BASE || "http://localhost:8080";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 900 } });

await page.goto(`${BASE}/admin.html?test=1`, { waitUntil: "load" });
await page.evaluate(() => {
  localStorage.removeItem("session");
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  localStorage.setItem("usage", JSON.stringify({ day, reads: 31000, writes: 10068 }));
  localStorage.setItem("test-logs", JSON.stringify([
    { who: "حسن", action: "تعديل صلاحيات", target: "3 صنف", at: Date.now() - 60000 },
    { who: "حسن", action: "تحميل شحنة", target: "المراعي · إذن استلام", at: Date.now() - 120000 },
    { who: "حسن", action: "حذف شحنة", target: "جهينة", at: Date.now() - 180000 },
    { who: "حسن", action: "استيراد أصناف", target: "10068 صنف", at: Date.now() - 240000 },
  ]));
  localStorage.setItem("test-config", JSON.stringify({
    ...(window.APP_CONFIG || {}),
    filesMeta: { "الأصناف": { at: Date.now() - 3600000, rows: 10068, by: "حسن" } },
  }));
});
await page.reload({ waitUntil: "load" });
await page.fill("#pin-input", await page.evaluate(() => window.APP_CONFIG.adminPin));
await page.click("#btn-pin");
await page.waitForTimeout(500);

await page.click('button[data-goto="screen-status"]');
await page.waitForTimeout(300);
const bars = await page.evaluate(() => [...document.querySelectorAll("#status-list .quota-bar > span")]
  .map((s) => ({ width: s.style.inlineSize, colour: getComputedStyle(s).backgroundColor })));
console.log("[status] bars:", JSON.stringify(bars));
await page.screenshot({ path: `${OUT}/status.png`, fullPage: true });

await page.click("#btn-back");
await page.click("#btn-logs");
await page.waitForTimeout(400);
const notes = await page.evaluate(() => document.querySelectorAll("#logs-list .note").length);
console.log("[logs] rows with a note:", notes, "of", await page.evaluate(() => document.querySelectorAll("#logs-list li").length));
await page.screenshot({ path: `${OUT}/logs.png`, fullPage: true });

await browser.close();
console.log("shots in", OUT);
if (bars.length !== 2) { console.log("[status] FAIL — expected two allowance bars"); process.exit(1); }
if (notes !== 3) { console.log("[logs] FAIL — expected a note on 3 of the 4 rows"); process.exit(1); }
console.log("[status] OK");
