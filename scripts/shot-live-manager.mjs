// Screenshots the live manager screen so we can see where «عرض الأصناف» sits. Read-only.
import { chromium } from "@playwright/test";

const OUT = process.env.OUT || "/tmp/shots";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

await page.goto("https://mohamedroshdi.github.io/mart-shipments/manager.html", { waitUntil: "load" });
await page.fill("#pin-input", "1994");
await page.click("#btn-pin");
await page.waitForSelector("#screen-manager:not([hidden])");
await page.waitForTimeout(5000);
await page.screenshot({ path: `${OUT}/live-manager-top.png` });
await page.locator("#btn-products").scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/live-manager-tools.png` });
console.log("shipment rows:", await page.locator("#all-shipments li").count());
await browser.close();
