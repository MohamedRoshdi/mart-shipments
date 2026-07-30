// Live check of الجرد against the real Firestore, through the UI only. Self-cleaning: the
// product it counts is a temporary one it imports itself, so no catalog row of the shop is touched.
// STAMP=$RANDOM node scripts/live-count.mjs
import { chromium } from "@playwright/test";
import { writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const BASE = process.env.BASE || "https://mohamedroshdi.github.io/mart-shipments";
const CODE = "999" + process.env.STAMP;
const NAME = "صنف جرد آلي";
const COUNT = "جرد فحص آلي " + process.env.STAMP;
const log = (...a) => console.log("[live-count]", ...a);

const sheet = join(tmpdir(), `stock-${CODE}.csv`);
writeFileSync(sheet, `﻿الباركود,اسم الصنف,الكمية\r\n${CODE},${NAME},10\r\n`);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("dialog", (d) => d.accept());

async function openManager() {
  await page.goto(BASE + "/manager.html", { waitUntil: "load" });
  if (await page.locator("#screen-pin:not([hidden])").count()) {
    await page.fill("#pin-input", "1994");
    await page.click("#btn-pin");
  }
  await page.waitForSelector("#screen-manager:not([hidden])");
  await page.waitForTimeout(3500);        // never networkidle: Firestore keeps a socket open
}

// a row that was just written needs the next read, not a fixed sleep
async function waitFor(locator, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await locator.count()) return true;
    await page.waitForTimeout(1000);
    await page.click('#list-tabs button[data-tab="count"]').catch(() => {});
  }
  return false;
}

// 1. the stocktake sheet: barcode, name, system quantity — for one branch
await openManager();
const BRANCH = await page.locator("#stock-branch button[data-stockbranch]").first().getAttribute("data-stockbranch");
await page.click(`#stock-branch button[data-stockbranch="${BRANCH}"]`);
await page.setInputFiles("#stock-file", sheet);
await page.waitForTimeout(4000);
log("1. import toast:", await page.locator("#toast").innerText(), "| branch:", BRANCH);

// 2. the catalog screen shows the quantity next to the barcode
await page.click("#btn-products");
await page.waitForTimeout(3000);
await page.fill("#product-search", CODE);
await page.waitForTimeout(4000);
const codeLine = await page.locator(`li:has(input[data-barcode="${CODE}"]) .code`).innerText().catch(() => "");
log("2. catalog row:", JSON.stringify(codeLine), "→ carries the system quantity:", codeLine.includes("10"));

// 3. the employee counts the shelf and sees what the system claims
await page.goto(BASE + "/", { waitUntil: "load" });
await page.waitForTimeout(2500);
if (await page.locator("#screen-login:not([hidden])").count()) {
  await page.fill("#login-pin", "1994");
  await page.click("#btn-login");
}
await page.waitForSelector("#screen-home:not([hidden])", { timeout: 20000 });
await page.click("#btn-count");
// the count has to be for the branch whose sheet was just imported
if (await page.locator(`#new-branch-picker button[data-newbranch="${BRANCH}"]`).count()) {
  await page.click(`#new-branch-picker button[data-newbranch="${BRANCH}"]`);
}
await page.fill("#shipment-name", COUNT);
await page.fill("#barcode-input", CODE);
await page.click("#btn-lookup");
await page.waitForSelector("#item-form:not([hidden])");
log("3. system quantity on the item sheet:", await page.locator("#item-stock-qty").innerText());
await page.fill("#item-qty", "7");
await page.click("#btn-add-item");
log("4. row verdict:", (await page.locator("#items-list li").first().innerText()).replace(/\s+/g, " ").trim());
await page.click("#btn-save-shipment");
await page.waitForTimeout(1500);
log("5. save toast:", await page.locator("#toast").innerText());

// 4. the manager sees it under الجرد with the difference
await openManager();
await page.click('#list-tabs button[data-tab="count"]');
const row = page.locator(`#all-counts li:has-text("${COUNT}")`);
log("6. count reached the manager:", await waitFor(row));
log("7. manager row:", (await row.innerText()).replace(/\s+/g, " ").trim());

// 5. Excel: in-system, counted, difference
const dl = (await Promise.all([
  page.waitForEvent("download"),
  row.locator('button[data-cact="download"]').click(),
]))[0];
const csv = readFileSync(await dl.path(), "utf8");
log("8. excel file:", dl.suggestedFilename());
log("9. excel row:", csv.split("\r\n")[1]);
log("10. excel has the difference column:", csv.includes('"في النظام","المعدود","الفرق"'));

// 6. cleanup: the count, then the temporary product
await row.locator('button[data-cact="del"]').click();
await page.waitForTimeout(3000);
log("11. delete toast:", await page.locator("#toast").innerText());
await openManager();
await page.click('#list-tabs button[data-tab="count"]');
await page.waitForTimeout(2000);
log("12. count gone:", (await page.locator(`#all-counts li:has-text("${COUNT}")`).count()) === 0);

await page.click("#btn-products");
await page.waitForTimeout(3000);
await page.fill("#product-search", CODE);
await page.waitForTimeout(4000);
if (await page.locator(`button[data-delproduct="${CODE}"]`).count()) {
  await page.click(`button[data-delproduct="${CODE}"]`);
  await page.waitForTimeout(3000);
}
await page.goto(BASE + "/manager.html", { waitUntil: "load" });
await page.waitForSelector("#screen-manager:not([hidden])");
await page.waitForTimeout(2500);
await page.click("#btn-products");
await page.waitForTimeout(3000);
await page.fill("#product-search", CODE);
await page.waitForTimeout(4000);
log("13. temp product gone (cleanup ok):", (await page.locator(`input[data-barcode="${CODE}"]`).count()) === 0);

await browser.close();
