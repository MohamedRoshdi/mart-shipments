// Read-only: a brand new browser context, so nothing is served from a local Firestore cache.
// Answers one question — what does the SERVER hold in the expiry collection right now.
// node scripts/live-expiry-server.mjs
import { chromium } from "./live-browser.mjs";   // blocks service workers: a fresh profile's SW install reloads the page mid-run

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
// The catalog side is NOT asked here any more. This used to type into the catalog search and count
// the rows on screen — but the search is debounced and, in a fresh context, has to pull the whole
// catalog into a local index first, so the count it read was the first PAGE of the catalog (50) on
// a catalog that had none of them. `scripts/live-junk-sweep.mjs` answers that question properly,
// by reading every product once.
log("for leftover products, run: node scripts/live-junk-sweep.mjs");

await browser.close();
