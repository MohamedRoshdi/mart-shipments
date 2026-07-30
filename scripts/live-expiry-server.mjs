// Read-only: a brand new browser context, so nothing is served from a local Firestore cache.
// Answers one question — what does the SERVER hold in the expiry collection right now.
// node scripts/live-expiry-server.mjs
import { chromium } from "@playwright/test";

const BASE = process.env.BASE || "https://mohamedroshdi.github.io/mart-shipments";
const log = (...a) => console.log("[server]", ...a);

const browser = await chromium.launch();
const ctx = await browser.newContext();          // empty storage: every read has to go to Firestore
const page = await ctx.newPage();
page.on("console", (m) => (/Quota|exhausted/.test(m.text()) ? console.log("[console]", m.text()) : null));

await page.goto(BASE + "/manager.html", { waitUntil: "load" });
await page.fill("#pin-input", "1994");
await page.click("#btn-pin");
await page.waitForSelector("#screen-manager:not([hidden])");
await page.waitForTimeout(6000);
await page.click('#list-tabs button[data-tab="expiry"]');
await page.waitForTimeout(2000);
const months = await page.locator("#all-months li:not(.empty)").count();
log("months the server knows about:", months);
if (months) log("rows:", (await page.locator("#all-months li:not(.empty)").allInnerTexts()).map(t => t.replace(/\s+/g, " ").trim()));
log("catalog rows named صنف صلاحية آلي:", await (async () => {
  await page.click("#btn-products");
  await page.waitForTimeout(3000);
  await page.fill("#product-search", "صنف صلاحية آلي");
  await page.waitForTimeout(4000);
  return page.locator("button[data-delproduct]").count();
})());

await browser.close();
