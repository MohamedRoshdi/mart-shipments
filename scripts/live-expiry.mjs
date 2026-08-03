// Live check of الصلاحيات against the real Firestore, through the UI only. Self-cleaning: it
// imports its own temporary product, records an expiry row for it, moves it to another month,
// exports it and deletes everything it made.
// STAMP=$RANDOM node scripts/live-expiry.mjs
import { chromium, safeDialogs, openManagerPage } from "./live-browser.mjs";   // blocks service workers: a fresh profile's SW install reloads the page mid-run
import { writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const BASE = process.env.BASE || "https://mohamedroshdi.github.io/mart-shipments";
const CODE = "998" + process.env.STAMP;
const NAME = "صنف صلاحية آلي";
const log = (...a) => console.log("[live-expiry]", ...a);

/* NO header row, deliberately. «الباركود» and «اسم الصنف» are both recognised headings
   (sheet.js HEADERS), so a header here makes this a HEADER-DRIVEN catalog import — which is a
   REPLACE: one full 10,061-row read, and a confirm offering to delete every barcode this one-row
   fixture does not carry. Headerless takes the positional path, which is merge-only: it adds one
   product, reads nothing else, and can delete nothing. */
const sheet = join(tmpdir(), `exp-${CODE}.csv`);
writeFileSync(sheet, `﻿${CODE},${NAME}\r\n`);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
safeDialogs(page);          // accepts the ordinary confirms, REFUSES anything that deletes live rows

const openManager = () => openManagerPage(page, BASE);

async function waitFor(locator, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await locator.count()) return true;
    await page.waitForTimeout(1000);
    await page.click('#list-tabs button[data-tab="expiry"]').catch(() => {});
  }
  return false;
}

// 1. a temporary product, so no catalog row of the shop is touched
await openManager();
await page.setInputFiles("#import-file", sheet);
await page.waitForTimeout(4000);
log("1. product import:", await page.locator("#toast").innerText());

// 2. the employee records an expiry date
await page.goto(BASE + "/", { waitUntil: "load" });
await page.waitForTimeout(2500);
if (await page.locator("#screen-login:not([hidden])").count()) {
  await page.fill("#login-pin", "1994");
  await page.click("#btn-login");
}
await page.waitForSelector("#screen-home:not([hidden])", { timeout: 20000 });
await page.click("#btn-expiry");
await page.fill("#barcode-input", CODE);
await page.click("#btn-lookup");
await page.waitForSelector("#item-form:not([hidden])");
log("2. the date row is on the sheet:", await page.locator("#item-date-row").isVisible());
await page.fill("#item-date", "2026-09-14");
await page.fill("#item-qty", "6");
await page.click("#btn-add-item");
await page.waitForTimeout(2500);
log("3. save toast:", await page.locator("#toast").innerText());
const month = page.locator('#exp-months li:has-text("سبتمبر 2026")');
log("4. month created by its first row:", (await month.count()) > 0);
log("5. month row:", (await month.innerText()).replace(/\s+/g, " ").trim());

// 3. the same barcode with the same date is more of the same batch, not a second row
await page.fill("#barcode-input", CODE);
await page.click("#btn-lookup");
await page.fill("#item-qty", "4");
await page.click("#btn-add-item");
await page.waitForTimeout(2500);
log("6. same date merged into one row:", (await month.innerText()).replace(/\s+/g, " ").trim());

// 4. a wrong date is fixed and the row walks to the right month
await page.click('#exp-months button[data-month="2026-09"]');
await page.waitForTimeout(800);
const id = await page.locator("#month-items input[data-edate]").first().getAttribute("data-edate");
await page.fill(`#month-items input[data-edate="${id}"]`, "2026-11-20");
await page.click("#btn-save-month");
await page.waitForTimeout(3000);
/* Not «the month disappeared» — that is only true on an empty database, and the shop has its own
   rows in سبتمبر (measured 2026-08-03: the month showed «2 صنف» with one of them ours). What has
   to be true is that OUR row left it. */
log("7. after the fix, our row left سبتمبر:",
  !(await page.locator('#exp-months li:has-text("سبتمبر 2026")').innerText().catch(() => "")).includes(NAME));
log("8. and نوفمبر is there:", (await page.locator('#exp-months li:has-text("نوفمبر 2026")').count()) > 0);

// 5. the manager sees the same month and exports it
await openManager();
await page.click('#list-tabs button[data-tab="expiry"]');
const mrow = page.locator('#all-months li:has-text("نوفمبر 2026")');
log("9. the month reached the manager:", await waitFor(mrow));
// the month's Excel lives inside the month now, not on its card (2026-07-31)
await mrow.locator('button[data-month="2026-11"]').click();
await page.waitForSelector("#screen-expiry-month:not([hidden])");
const dl = (await Promise.all([
  page.waitForEvent("download"),
  page.click("#btn-export-month"),
]))[0];
const csv = readFileSync(await dl.path(), "utf8");
log("10. excel file:", dl.suggestedFilename());
log("11. excel header:", csv.split("\r\n")[0]);
log("12. our row is in it:", csv.includes(`"${CODE}"`) && csv.includes('"2026-11-20"'));

// 6. cleanup: the expiry row, then the temporary product. The export left us inside the month
// already, so there is no card to click any more.
await page.waitForSelector("#screen-expiry-month:not([hidden])");
await page.waitForTimeout(1500);
const del = page.locator(`#m-items li:has-text("${NAME}") button[data-delexp]`);
await del.first().click();
await page.waitForTimeout(3000);
await openManager();
await page.click('#list-tabs button[data-tab="expiry"]');
await page.waitForTimeout(2000);
log("13. expiry row gone:", (await page.locator(`#all-months li:has-text("نوفمبر 2026")`).count()) === 0);

await page.click("#btn-products");
await page.waitForTimeout(3000);
await page.fill("#product-search", CODE);
await page.waitForTimeout(4000);
if (await page.locator(`button[data-delproduct="${CODE}"]`).count()) {
  await page.click(`button[data-delproduct="${CODE}"]`);
  await page.waitForTimeout(3000);
}
await page.reload();
await page.waitForSelector("#screen-manager:not([hidden])");
await page.waitForTimeout(2500);
await page.click("#btn-products");
await page.waitForTimeout(3000);
await page.fill("#product-search", CODE);
await page.waitForTimeout(4000);
log("14. temp product gone (cleanup ok):", (await page.locator(`input[data-barcode="${CODE}"]`).count()) === 0);

await browser.close();
