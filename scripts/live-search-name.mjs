// Proves the name-prefix search reaches products beyond the loaded page. Read-only.
import { chromium } from "@playwright/test";

const BASE = "https://mohamedroshdi.github.io/mart-shipments";
const log = (...a) => console.log("[live-search]", ...a);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await page.goto(BASE + "/manager.html", { waitUntil: "load" });
await page.fill("#pin-input", "1994");
await page.click("#btn-pin");
await page.waitForSelector("#screen-manager:not([hidden])");
await page.click("#btn-products");
await page.waitForSelector("#products-list li");
await page.waitForTimeout(4000);

const loaded = await page.locator("#products-list input[data-barcode]").count();
log("1. rows rendered on the default page:", loaded);
log("2. count line:", await page.locator("#products-count").innerText());

// pick a name from the far end of the catalog: last row of the loaded page is the
// alphabetical boundary, so search a prefix that starts after it
const lastName = await page.locator("#products-list input[data-barcode]").last().inputValue();
log("3. last loaded name:", JSON.stringify(lastName));

for (const q of [process.env.Q || "ز", "م", "ك"]) {
  await page.fill("#product-search", q);
  await page.waitForTimeout(2500);
  const n = await page.locator("#products-list input[data-barcode]").count();
  const first = n ? await page.locator("#products-list input[data-barcode]").first().inputValue() : null;
  log(`4. search "${q}" →`, await page.locator("#products-count").innerText(), "| first:", JSON.stringify(first));
}

await browser.close();
