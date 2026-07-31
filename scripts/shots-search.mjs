// The search box now lives inside #scan-block, so it has to look right on all three screens.
// OUT=/tmp/shots BASE=http://localhost:8087 node scripts/shots-search.mjs
import { chromium, devices } from "playwright";

const BASE = process.env.BASE || "http://localhost:8080";
const OUT = process.env.OUT || "/tmp/shots-search";

const CATALOG = {
  "6221031250057": "جهينة لبن كامل الدسم",
  "6223001234567": "سكر أبيض ناعم",
  "6224009876543": "شاي العروسة ناعم",
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 5"] });
const page = await ctx.newPage();

await page.goto(`${BASE}/?test=1`);
await page.evaluate((cat) => {
  localStorage.setItem("employeeName", "أحمد");
  localStorage.setItem("test-products", JSON.stringify(cat));
}, CATALOG);
await page.reload();

await page.click("#btn-new");
await page.fill("#find-input", "لبن");
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/new-search.png`, fullPage: true });

await page.click("#btn-back");
await page.click("#btn-count");
await page.fill("#find-input", "ابيض");
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/count-search.png`, fullPage: true });

await page.click("#btn-back");
await page.click("#btn-expiry");
await page.fill("#find-input", "العروسة");
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/expiry-search.png`, fullPage: true });

console.log("shots in", OUT);
await browser.close();
