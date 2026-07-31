// The supplier list: where the admin types it and where the employee picks from it.
// OUT=/tmp/shots BASE=http://localhost:8087 node scripts/shots-supplier.mjs
import { chromium, devices } from "playwright";

const BASE = process.env.BASE || "http://localhost:8080";
const OUT = process.env.OUT || "/tmp/shots-supplier";
const SUPPLIERS = ["المراعي", "جهينة للألبان", "بيبسي", "كوكاكولا", "الدومتي", "لامار"];

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 5"] });

const a = await ctx.newPage();
await a.goto(`${BASE}/admin.html?test=1`);
await a.fill("#pin-input", await a.evaluate(() => window.APP_CONFIG.adminPin));
await a.click("#btn-pin");
await a.fill("#cfg-suppliers", SUPPLIERS.join("\n"));
await a.locator("#cfg-suppliers").scrollIntoViewIfNeeded();
await a.waitForTimeout(200);
await a.screenshot({ path: `${OUT}/admin-suppliers.png` });

const e = await browser.newContext({ ...devices["Pixel 5"] }).then(c => c.newPage());
await e.goto(`${BASE}/?test=1`);
await e.evaluate((s) => {
  localStorage.setItem("employeeName", "أحمد");
  localStorage.setItem("test-products", JSON.stringify({ "111": "لبن" }));
  localStorage.setItem("test-config", JSON.stringify({ ...window.APP_CONFIG, suppliers: s }));
}, SUPPLIERS);
await e.reload();
await e.click("#btn-new");
await e.click("#shipment-name");
await e.waitForTimeout(200);
await e.screenshot({ path: `${OUT}/employee-suppliers.png`, fullPage: true });
await e.fill("#shipment-name", "ال");
await e.waitForTimeout(200);
await e.screenshot({ path: `${OUT}/employee-suppliers-typed.png`, fullPage: true });

console.log("shots in", OUT);
await browser.close();
