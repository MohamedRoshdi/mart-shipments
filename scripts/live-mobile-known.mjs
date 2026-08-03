// Mobile emulation, LIVE site, using a barcode that really exists in the catalog.
// Checks the name label on scan and the catalog barcode search. Read-only.
import { chromium, devices } from "./live-browser.mjs";   // blocks service workers: a fresh profile's SW install reloads the page mid-run

const BASE = "https://mohamedroshdi.github.io/mart-shipments";
/* The barcode is taken FROM the catalog, not written here. The hard-coded «012044045374» had
   rotted out of the shop's catalog, so the run reported «صنف غير مسجّل» and «0 نتيجة» — which
   reads exactly like the feature being broken and is nothing of the sort (measured 2026-08-03).
   CODE=... still overrides it when a specific product is the point. */
const BASE_CODE = process.env.CODE || "";
const log = (...a) => console.log("[known]", ...a);

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 5"], locale: "ar-EG" });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

// a real barcode, read off the catalog page — one 50-row page, no index rebuild
async function firstCatalogCode() {
  const p = await ctx.newPage();
  await p.goto(BASE + "/manager.html", { waitUntil: "load" });
  if (await p.locator("#screen-manager").isHidden()) {
    await p.fill("#pin-input", "1994").catch(() => {});
    await p.click("#btn-pin").catch(() => {});
  }
  await p.waitForSelector("#screen-manager:not([hidden])", { timeout: 30000 });
  await p.click("#btn-products");
  await p.waitForSelector("#products-list input[data-barcode]");
  const code = await p.locator("#products-list input[data-barcode]").first().getAttribute("data-barcode");
  await p.close();
  return code;
}
const CODE = BASE_CODE || await firstCatalogCode();
log("0. barcode taken from the live catalog:", CODE);

// employee side: does the label show the catalog name for a real barcode?
await page.goto(BASE + "/", { waitUntil: "load" });
// one door since 2026-08-01: the «بيانات الموظف» name screen is deleted, the PIN is the way in
await page.waitForSelector("#screen-login:not([hidden])", { timeout: 20000 });
await page.fill("#login-pin", "1994");
await page.press("#login-pin", "Enter");
await page.waitForSelector("#screen-home:not([hidden])", { timeout: 20000 });
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
