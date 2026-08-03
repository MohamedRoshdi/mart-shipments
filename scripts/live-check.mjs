import { chromium, safeDialogs, openManagerPage } from "./live-browser.mjs";   // blocks service workers: a fresh profile's SW install reloads the page mid-run

const BASE = "https://mohamedroshdi.github.io/mart-shipments";
const STAMP = "فحص-آلي-" + process.env.STAMP;
const log = (...a) => console.log("[live]", ...a);
const SYNC = 4000;

const browser = await chromium.launch();
const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

async function addItem(p, barcode) {
  await p.fill("#barcode-input", barcode);
  await p.click("#btn-lookup");
  await p.waitForSelector("#item-form:not([hidden])");
  await p.waitForSelector("#btn-add-item:not([disabled])");   // catalog barcodes only
  await p.click("#btn-add-item");                             // name comes from the catalog, not typed
  await p.waitForSelector("#item-form", { state: "hidden" });
}

// real barcodes from the live catalog: unlisted ones are refused by design
async function catalogBarcodes(ctx, n) {
  const p = await ctx.newPage();
  await p.goto(BASE + "/manager.html", { waitUntil: "load" });
  await p.fill("#pin-input", "1994");
  await p.click("#btn-pin");
  await p.waitForSelector("#screen-manager:not([hidden])");
  await p.click("#btn-products");
  await p.waitForSelector("#products-list input[data-barcode]");
  await p.waitForTimeout(4000);
  const codes = await p.locator("#products-list input[data-barcode]")
    .evaluateAll((els, k) => els.slice(0, k).map(e => e.dataset.barcode), n);
  await p.close();
  return codes;
}

const [C1, C2, C3] = await catalogBarcodes(ctx, 3);
log("0. barcodes taken from the live catalog:", C1, C2, C3);

// 1. employee creates a shipment against REAL Firestore, deletes one item first
await page.goto(BASE + "/", { waitUntil: "load" });
const branch = await page.evaluate(() => window.APP_CONFIG.branches[0]);
/* One door since 2026-08-01: the «بيانات الموظف» name+branch screen is DELETED, so a script signs
   in the way a person does. The legacy master PIN carries every permission except adm. */
await page.waitForSelector("#screen-login:not([hidden])", { timeout: 20000 });
await page.fill("#login-pin", "1994");
await page.click("#btn-login");
await page.waitForSelector("#screen-home:not([hidden])", { timeout: 20000 });
await page.click("#btn-new");
const type = (await page.evaluate(() => window.APP_CONFIG.shipmentTypes))[1];
await page.click(`#type-picker button[data-type="${type}"]`);
// that PIN covers every branch, so the shipment's branch is a per-shipment pick
if (await page.locator(`#new-branch-picker button[data-newbranch="${branch.name}"]`).count()) {
  await page.click(`#new-branch-picker button[data-newbranch="${branch.name}"]`);
}
await page.fill("#shipment-name", STAMP);
await addItem(page, C1);
await addItem(page, C2);
log("1. items after two scans:", await page.locator("#items-list li").count());
await page.click('button[data-del="1"]');
log("2. items after deleting one:", await page.locator("#items-list li").count());
await page.click("#btn-save-shipment");
await page.waitForSelector("#screen-home:not([hidden])");
await page.waitForTimeout(SYNC);

// 2. employee edits own saved shipment (reload = read back from Firestore)
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(SYNC);
const mine = await page.locator("#my-shipments li").allInnerTexts();
const idx = mine.findIndex((t) => t.includes(STAMP));
log("3. saved shipment read back from Firestore:", idx >= 0, "|", mine[idx]);
await page.click(`button[data-edit="${idx}"]`);
await page.waitForSelector("#screen-new:not([hidden])");
log("4. edit screen loaded name/items:",
  await page.locator("#shipment-name").inputValue(), "/", await page.locator("#items-list li").count());
await page.fill("#shipment-name", STAMP + "-معدلة");
await addItem(page, C3);
await page.click("#btn-save-shipment");
await page.waitForSelector("#screen-home:not([hidden])");
await page.waitForTimeout(SYNC);

// 3. manager page verifies the edit, changes qty, deletes an item, deletes the shipment
const mgr = await ctx.newPage();
mgr.on("pageerror", (e) => console.log("[pageerror:mgr]", e.message));
safeDialogs(mgr);          // accepts the ordinary confirms, REFUSES anything that deletes live rows
await mgr.goto(BASE + "/manager.html", { waitUntil: "load" });
await mgr.fill("#pin-input", "1994");
await mgr.click("#btn-pin");
await mgr.waitForSelector("#screen-manager:not([hidden])");
await mgr.waitForTimeout(SYNC);

async function findRow() {
  const rows = await mgr.locator("#all-shipments li").allInnerTexts();
  return rows.findIndex((t) => t.includes(STAMP));
}
let mi = await findRow();
log("5. manager sees employee's edit:", mi >= 0, "|", (await mgr.locator("#all-shipments li").allInnerTexts())[mi]);
await mgr.click("#btn-filters");                               // the chips live behind the toggle now
await mgr.click(`button[data-typefilter="${type}"]`);          // filter by the type the employee picked
await mgr.waitForTimeout(500);
log("5b. type filter keeps it:", (await findRow()) >= 0, "| type:", type);
/* Since 2026-07-31 a list card carries NO buttons — the card IS the button, and نسخ / Excel /
   TXT / حذف all live on the screen it opens. So everything below goes through the card screen. */
await mgr.click(`button[data-act="view"][data-i="${mi}"]`);
await mgr.waitForSelector("#screen-detail:not([hidden])");
await mgr.click("#btn-copy");
log("6. copy format:", JSON.stringify(await mgr.evaluate(() => navigator.clipboard.readText())));
log("7. detail rows:", await mgr.locator("#detail-items tr").count());
await mgr.fill('input[data-qty="0"]', "5");
await mgr.click('button[data-delitem="1"]');
await mgr.click("#btn-save-edit");
await mgr.waitForSelector("#screen-manager:not([hidden])");
await mgr.waitForTimeout(SYNC);
mi = await findRow();
await mgr.click(`button[data-act="view"][data-i="${mi}"]`);
await mgr.waitForSelector("#screen-detail:not([hidden])");
await mgr.click("#btn-copy");
log("8. after manager qty=5 + item delete:", JSON.stringify(await mgr.evaluate(() => navigator.clipboard.readText())));

await mgr.click("#btn-delete-detail");                         // حذف lives on the card screen too
await mgr.waitForTimeout(SYNC);
await openManagerPage(mgr, BASE, "1994", SYNC);
log("9. gone after delete (cleanup ok):", (await findRow()) === -1);
log("10. shipments left in DB:", (await mgr.locator("#all-shipments li").allInnerTexts()).length);

await browser.close();
