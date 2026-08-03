// Live check of الجرد against the real Firestore, through the UI only. Self-cleaning: the
// product it counts is a temporary one it imports itself, so no catalog row of the shop is touched.
// STAMP=$RANDOM node scripts/live-count.mjs
import { chromium, openTools, safeDialogs, openManagerPage } from "./live-browser.mjs";   // blocks service workers: a fresh profile's SW install reloads the page mid-run
import { writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const BASE = process.env.BASE || "https://mohamedroshdi.github.io/mart-shipments";
const CODE = "999" + process.env.STAMP;
const NAME = "صنف جرد آلي";
const COUNT = "جرد فحص آلي " + process.env.STAMP;
const log = (...a) => console.log("[live-count]", ...a);

/* The stock sheet REPORTS a barcode the catalog does not know, it never creates it (2026-08-01),
   so the product has to exist before its quantity can land. Headerless on purpose: an Arabic
   header would make this a header-driven catalog import, i.e. a full 10k read plus a confirm
   offering to delete everything this one row does not carry. */
const catalog = join(tmpdir(), `cat-${CODE}.csv`);
writeFileSync(catalog, `﻿${CODE},${NAME}\r\n`);

const sheet = join(tmpdir(), `stock-${CODE}.csv`);
writeFileSync(sheet, `﻿الباركود,اسم الصنف,الكمية\r\n${CODE},${NAME},10\r\n`);
const sheet2 = join(tmpdir(), `stock2-${CODE}.csv`);      // the other branch's own sheet
writeFileSync(sheet2, `﻿الباركود,اسم الصنف,الكمية\r\n${CODE},${NAME},4\r\n`);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
safeDialogs(page);          // accepts the ordinary confirms, REFUSES anything that deletes live rows

const openManager = () => openManagerPage(page, BASE);

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
await openTools(page);            // the branch chips live inside the folded toolbox now
await page.setInputFiles("#import-file", catalog);        // the product first — see above
await page.waitForTimeout(4000);
log("0. catalog seed:", await page.locator("#toast").innerText());
const BRANCH = await page.locator("#stock-branch button[data-stockbranch]").first().getAttribute("data-stockbranch");
await page.click(`#stock-branch button[data-stockbranch="${BRANCH}"]`);
await page.setInputFiles("#stock-file", sheet);
await page.waitForTimeout(4000);
log("1. import toast:", await page.locator("#toast").innerText(), "| branch:", BRANCH);

// 1b. the second branch's sheet: a different number for the same barcode, and the first
// branch's number must survive it
const BRANCH2 = await page.locator("#stock-branch button[data-stockbranch]").nth(1).getAttribute("data-stockbranch");
await page.click(`#stock-branch button[data-stockbranch="${BRANCH2}"]`);
await page.setInputFiles("#stock-file", sheet2);
await page.waitForTimeout(4000);
log("1b. second branch imported:", await page.locator("#toast").innerText(), "| branch:", BRANCH2);

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
log("3. system quantity on the item sheet:", await page.locator("#item-stock-qty").innerText(), `(${BRANCH})`);

// 3b. the same barcode, the other branch: its own number, not the first one's
if (await page.locator(`#new-branch-picker button[data-newbranch="${BRANCH2}"]`).count()) {
  await page.click("#btn-cancel-item");
  await page.click(`#new-branch-picker button[data-newbranch="${BRANCH2}"]`);
  await page.fill("#barcode-input", CODE);
  await page.click("#btn-lookup");
  await page.waitForSelector("#item-form:not([hidden])");
  log("3b. same barcode in the other branch:", await page.locator("#item-stock-qty").innerText(), `(${BRANCH2})`);
  await page.click("#btn-cancel-item");
  await page.click(`#new-branch-picker button[data-newbranch="${BRANCH}"]`);   // back to the branch being counted
  await page.fill("#barcode-input", CODE);
  await page.click("#btn-lookup");
  await page.waitForSelector("#item-form:not([hidden])");
}
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

/* 5. Excel: in-system, counted, difference. Since 2026-07-31 a list card carries NO buttons —
   the card IS the button, and نسخ / Excel / TXT / حذف live on the screen it opens. */
await row.locator('button[data-cact="view"]').click();
await page.waitForSelector("#screen-detail:not([hidden])");
const dl = (await Promise.all([
  page.waitForEvent("download"),
  page.click("#btn-download"),
]))[0];
const csv = readFileSync(await dl.path(), "utf8");
log("8. excel file:", dl.suggestedFilename());
log("9. excel row:", csv.split("\r\n")[1]);
log("10. excel has the difference column:", csv.includes('"في النظام","المعدود","الفرق"'));

// 6. cleanup: the count, then the temporary product. The export left us on the card screen, which
// is where حذف lives now — there is no row button to click any more.
await page.click("#btn-delete-detail");
await page.waitForTimeout(3000);
// the toast may still be showing the download message, so report the row itself
log("11. row removed from the list:", (await row.count()) === 0);
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
