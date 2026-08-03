// Live check of the catalog screen against the real Firestore, through the UI only. Self-cleaning.
import { chromium, safeDialogs } from "./live-browser.mjs";   // blocks service workers: a fresh profile's SW install reloads the page mid-run
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const BASE = "https://mohamedroshdi.github.io/mart-shipments";
const CODE = "999" + process.env.STAMP;
const log = (...a) => console.log("[live-products]", ...a);

const csv = join(tmpdir(), `catalog-${CODE}.csv`);
writeFileSync(csv, `﻿barcode,name\r\n${CODE},صنف فحص آلي\r\n`);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
safeDialogs(page);          // accepts the ordinary confirms, REFUSES anything that deletes live rows

async function openCatalog() {
  await page.goto(BASE + "/manager.html", { waitUntil: "load" });
  await page.fill("#pin-input", "1994");
  await page.click("#btn-pin");
  await page.waitForSelector("#screen-manager:not([hidden])");
  await page.waitForTimeout(3000);
  await page.click("#btn-products");
  await page.waitForTimeout(4000);
}

async function find(code) {
  await page.fill("#product-search", code);
  const row = page.locator(`input[data-barcode="${code}"]`);
  try {
    /* 30s, not 9. Any product write drops this phone's local search copy, so the first search
       after an import REBUILDS it — one full read of 10,061 rows (measured 2026-08-03), which is
       nowhere near instant. Nine seconds reported «not found» for a row that was there, in both
       this script and live-count. */
    await row.waitFor({ timeout: 30000 });
    return await row.inputValue();
  } catch {
    return null;
  }
}

// 1. seed through the app's real import path
await page.goto(BASE + "/manager.html", { waitUntil: "load" });
await page.fill("#pin-input", "1994");
await page.click("#btn-pin");
await page.waitForSelector("#screen-manager:not([hidden])");
await page.setInputFiles("#import-file", csv);
await page.waitForTimeout(4000);
log("1. import toast:", await page.locator("#toast").innerText());

// 2. the catalog screen lists it
await page.click("#btn-products");
await page.waitForTimeout(4000);
log("2. catalog count:", await page.locator("#products-count").innerText());
log("3. found by barcode:", JSON.stringify(await find(CODE)));

// 3. rename, then reload from Firestore to prove it stuck
await page.fill(`input[data-barcode="${CODE}"]`, "صنف فحص آلي - معدل");
await page.click("#btn-save-products");
await page.waitForTimeout(4000);
await openCatalog();
log("4. rename persisted:", JSON.stringify(await find(CODE)));

// 4. delete, then reload to prove it is gone
await page.click(`button[data-delproduct="${CODE}"]`);
await page.waitForTimeout(4000);
await openCatalog();
log("5. deleted (cleanup ok):", (await find(CODE)) === null);
log("6. catalog count after cleanup:", await page.locator("#products-count").innerText());

await browser.close();
