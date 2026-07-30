// Removes anything a crashed run of live-expiry.mjs left on production: every expiry row and
// every catalog row named «صنف صلاحية آلي». Safe to run twice; touches nothing else.
// node scripts/live-expiry-cleanup.mjs
import { chromium } from "@playwright/test";

const BASE = process.env.BASE || "https://mohamedroshdi.github.io/mart-shipments";
const NAME = "صنف صلاحية آلي";
const log = (...a) => console.log("[cleanup]", ...a);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("dialog", (d) => d.accept());

async function openManager() {
  await page.goto(BASE + "/manager.html", { waitUntil: "load" });
  if (await page.locator("#screen-pin:not([hidden])").count()) {
    await page.fill("#pin-input", "1994");
    await page.click("#btn-pin");
  }
  await page.waitForSelector("#screen-manager:not([hidden])");
  await page.waitForTimeout(3500);
}

await openManager();
await page.click('#list-tabs button[data-tab="expiry"]');
await page.waitForTimeout(1500);
let removed = 0;
for (const key of await page.locator("#all-months button[data-month]").evaluateAll(
  (els) => els.map((e) => e.dataset.month))) {
  await page.click(`#all-months button[data-month="${key}"]`);
  await page.waitForTimeout(1200);
  let btn = page.locator(`#m-items li:has-text("${NAME}") button[data-delexp]`).first();
  while (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(2000);
    removed++;
    btn = page.locator(`#m-items li:has-text("${NAME}") button[data-delexp]`).first();
    if (await page.locator("#screen-expiry-month").isHidden()) break;   // month emptied itself
  }
  await openManager();
  await page.click('#list-tabs button[data-tab="expiry"]');
  await page.waitForTimeout(1200);
}
log("expiry rows removed:", removed);

await page.click("#btn-products");
await page.waitForTimeout(3000);
await page.fill("#product-search", NAME);
await page.waitForTimeout(4000);
let prods = 0;
let del = page.locator("button[data-delproduct]").first();
while (await del.count()) {
  await del.click();
  await page.waitForTimeout(2500);
  prods++;
  del = page.locator("button[data-delproduct]").first();
}
log("temp products removed:", prods);

await page.goto(BASE + "/manager.html", { waitUntil: "load" });
await page.waitForSelector("#screen-manager:not([hidden])");
await page.waitForTimeout(2500);
await page.click("#btn-products");
await page.waitForTimeout(3000);
await page.fill("#product-search", NAME);
await page.waitForTimeout(4000);
log("catalog clean:", (await page.locator("button[data-delproduct]").count()) === 0);
await page.goto(BASE + "/manager.html", { waitUntil: "load" });
await page.waitForSelector("#screen-manager:not([hidden])");
await page.waitForTimeout(2500);
await page.click('#list-tabs button[data-tab="expiry"]');
await page.waitForTimeout(2000);
log("months left on the expiry tab:", await page.locator("#all-months li:not(.empty)").count());

await browser.close();
