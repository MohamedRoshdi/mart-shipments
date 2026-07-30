// Mobile emulation, LIVE site, using a barcode that really exists in the catalog.
// Checks the name label on scan and the catalog barcode search. Read-only.
import { chromium, devices } from "@playwright/test";

const BASE = "https://mohamedroshdi.github.io/mart-shipments";
const CODE = process.env.CODE || "012044045374";
const log = (...a) => console.log("[known]", ...a);

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 5"], locale: "ar-EG" });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

// employee side: does the label show the catalog name for a real barcode?
await page.goto(BASE + "/", { waitUntil: "load" });
const branch = await page.evaluate(() => window.APP_CONFIG.branches[0]);
await page.fill("#employee-name", "فحص موبايل");
await page.fill("#branch-pin", branch.pin);
await page.press("#branch-pin", "Enter");
await page.waitForSelector("#screen-home:not([hidden])");
await page.tap("#btn-new");
await page.fill("#barcode-input", CODE);
await page.press("#barcode-input", "Enter");
await page.waitForSelector("#item-form:not([hidden])");
await page.waitForTimeout(2500);
log("1. label for", CODE, "→", JSON.stringify(await page.locator("#item-name").innerText()));

// manager side: does the catalog search find that same barcode?
const mgr = await ctx.newPage();
await mgr.goto(BASE + "/manager.html", { waitUntil: "load" });
await mgr.fill("#pin-input", "1994");
await mgr.press("#pin-input", "Enter");
await mgr.waitForSelector("#screen-manager:not([hidden])");
await mgr.tap("#btn-products");
await mgr.waitForSelector("#screen-products:not([hidden])");
await mgr.waitForTimeout(5000);
await mgr.fill("#product-search", CODE);
const row = mgr.locator(`input[data-barcode="${CODE}"]`);
try {
  await row.waitFor({ timeout: 9000 });
  log("2. catalog search by barcode →", JSON.stringify(await row.inputValue()));
} catch {
  log("2. catalog search by barcode → NOT FOUND");
}
log("3. count line:", await mgr.locator("#products-count").innerText());

await browser.close();
