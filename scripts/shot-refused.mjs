// One settled screenshot of the refusal sheet on the live site. Read-only.
import { chromium, devices } from "@playwright/test";

const BASE = "https://mohamedroshdi.github.io/mart-shipments";
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 5"], locale: "ar-EG" });
const page = await ctx.newPage();

await page.goto(BASE + "/", { waitUntil: "load" });
const b = await page.evaluate(() => window.APP_CONFIG.branches[0]);
await page.waitForSelector("#screen-name:not([hidden]), #screen-home:not([hidden])");  // wait for boot
if (await page.locator("#screen-name").isVisible()) {
  await page.fill("#employee-name", "فحص موبايل");
  await page.fill("#branch-pin", b.pin);
  await page.press("#branch-pin", "Enter");
}
await page.waitForSelector("#screen-home:not([hidden])");
await page.tap("#btn-new");
await page.fill("#barcode-input", "9990001112223");
await page.press("#barcode-input", "Enter");
await page.waitForSelector("#item-warn:not([hidden])");
await page.waitForTimeout(1200);                     // let the sheet animation finish
await page.screenshot({ path: (process.env.OUT || "/tmp/shots") + "/refused-settled.png" });
console.log("add button disabled:", await page.locator("#btn-add-item").isDisabled());
await browser.close();
