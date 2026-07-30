import { chromium } from "@playwright/test";

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
  await p.click("#btn-add-item");                 // name comes from the imported catalog, not typed
  await p.waitForSelector("#item-form", { state: "hidden" });
}

// 1. employee creates a shipment against REAL Firestore, deletes one item first
await page.goto(BASE + "/", { waitUntil: "load" });
const branch = await page.evaluate(() => window.APP_CONFIG.branches[0]);
await page.fill("#employee-name", "فحص آلي");
await page.click(`button[data-branch="${branch.name}"]`);
await page.fill("#branch-pin", branch.pin);
await page.click("#save-name");
await page.waitForSelector("#screen-home:not([hidden])");
await page.click("#btn-new");
const type = (await page.evaluate(() => window.APP_CONFIG.shipmentTypes))[1];
await page.click(`#type-picker button[data-type="${type}"]`);
await page.fill("#shipment-name", STAMP);
await addItem(page, "1111111111111");
await addItem(page, "2222222222222");
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
await addItem(page, "3333333333333");
await page.click("#btn-save-shipment");
await page.waitForSelector("#screen-home:not([hidden])");
await page.waitForTimeout(SYNC);

// 3. manager page verifies the edit, changes qty, deletes an item, deletes the shipment
const mgr = await ctx.newPage();
mgr.on("pageerror", (e) => console.log("[pageerror:mgr]", e.message));
mgr.on("dialog", (d) => d.accept());
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
await mgr.click(`button[data-typefilter="${type}"]`);          // filter by the type the employee picked
await mgr.waitForTimeout(500);
log("5b. type filter keeps it:", (await findRow()) >= 0, "| type:", type);
await mgr.click(`button[data-act="copy"][data-i="${mi}"]`);
log("6. copy format:", JSON.stringify(await mgr.evaluate(() => navigator.clipboard.readText())));

await mgr.click(`button[data-act="view"][data-i="${mi}"]`);
await mgr.waitForSelector("#screen-detail:not([hidden])");
log("7. detail rows:", await mgr.locator("#detail-items tr").count());
await mgr.fill('input[data-qty="0"]', "5");
await mgr.click('button[data-delitem="1"]');
await mgr.click("#btn-save-edit");
await mgr.waitForSelector("#screen-manager:not([hidden])");
await mgr.waitForTimeout(SYNC);
mi = await findRow();
await mgr.click(`button[data-act="copy"][data-i="${mi}"]`);
log("8. after manager qty=5 + item delete:", JSON.stringify(await mgr.evaluate(() => navigator.clipboard.readText())));

await mgr.click(`button[data-act="del"][data-i="${mi}"]`);
await mgr.waitForTimeout(SYNC);
await mgr.reload({ waitUntil: "load" });
await mgr.fill("#pin-input", "1994");
await mgr.click("#btn-pin");
await mgr.waitForSelector("#screen-manager:not([hidden])");
await mgr.waitForTimeout(SYNC);
log("9. gone after delete (cleanup ok):", (await findRow()) === -1);
log("10. shipments left in DB:", (await mgr.locator("#all-shipments li").allInnerTexts()).length);

await browser.close();
