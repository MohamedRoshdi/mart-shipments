// Full flow on the LIVE site in mobile emulation (Pixel 5, touch, mobile UA). Self-cleaning.
import { chromium, devices } from "@playwright/test";
import { readFileSync, mkdirSync } from "fs";

const BASE = "https://mohamedroshdi.github.io/mart-shipments";
const STAMP = "فحص-موبايل-" + process.env.STAMP;
const OUT = process.env.OUT || "/tmp/shots";
const SYNC = 4000;
const log = (...a) => console.log("[mobile]", ...a);

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["Pixel 5"],
  permissions: ["clipboard-read", "clipboard-write"],
  locale: "ar-EG",
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const shot = (n) => page.screenshot({ path: `${OUT}/m-${n}.png` });

log("viewport:", JSON.stringify(page.viewportSize()), "| touch + mobile UA on");

// real barcodes from the live catalog — unlisted ones are refused by design
const helper = await ctx.newPage();
await helper.goto(BASE + "/manager.html", { waitUntil: "load" });
await helper.fill("#pin-input", "1994");
await helper.click("#btn-pin");
await helper.waitForSelector("#screen-manager:not([hidden])");
await helper.click("#btn-products");
await helper.waitForSelector("#products-list input[data-barcode]");
await helper.waitForTimeout(4000);
const [C1, C2] = await helper.locator("#products-list input[data-barcode]")
  .evaluateAll((els) => els.slice(0, 2).map((e) => e.dataset.barcode));
await helper.close();
log("0. catalog barcodes used:", C1, C2);

/* ---- employee: setup with Enter only ---- */
await page.goto(BASE + "/", { waitUntil: "load" });
const branch = await page.evaluate(() => window.APP_CONFIG.branches[0]);
await page.fill("#employee-name", "فحص موبايل");
await page.fill("#branch-pin", branch.pin);
await page.press("#branch-pin", "Enter");                    // keyboard submit
await page.waitForSelector("#screen-home:not([hidden])");
log("1. setup by Enter → home:", !(await page.locator("#screen-home").isHidden()));
await shot("1-home");

/* ---- new shipment: branch line, type picker, Enter-driven item entry ---- */
await page.tap("#btn-new");
await page.waitForSelector("#screen-new:not([hidden])");
const type = (await page.evaluate(() => window.APP_CONFIG.shipmentTypes))[1];
log("2. branch line on new-shipment:", await page.locator("#new-branch").innerText());
await page.tap(`#type-picker button[data-type="${type}"]`);
await page.fill("#shipment-name", STAMP);
await page.fill("#barcode-input", C1);
await page.press("#barcode-input", "Enter");                 // lookup by Enter
await page.waitForSelector("#item-form:not([hidden])");
log("3. sheet label:", await page.locator("#item-name").innerText());
await shot("2-sheet");
await page.press("#item-qty", "Enter");                      // add by Enter
await page.waitForSelector("#item-form", { state: "hidden" });
await page.fill("#barcode-input", C2);
await page.press("#barcode-input", "Enter");
await page.waitForSelector("#item-form:not([hidden])");
await page.press("#item-qty", "Enter");
log("4. items on the list:", await page.locator("#items-list li:not(.empty)").count());
await page.tap('button[data-del="1"]');                      // delete one item
log("5. after deleting one:", await page.locator("#items-list li:not(.empty)").count());
await shot("3-shipment");
await page.tap("#btn-save-shipment");
await page.waitForSelector("#screen-home:not([hidden])");
await page.waitForTimeout(SYNC);
log("6. saved, home shows it:", (await page.locator("#my-shipments").innerText()).includes(STAMP));

/* ---- phone back button behaviour ---- */
await page.tap("#btn-new");
await page.goBack();
log("7. phone back returns home:", !(await page.locator("#screen-home").isHidden()));

/* ---- manager page on the phone ---- */
const mgr = await ctx.newPage();
mgr.on("pageerror", (e) => console.log("[pageerror:mgr]", e.message));
mgr.on("dialog", (d) => d.accept());
await mgr.goto(BASE + "/manager.html", { waitUntil: "load" });
await mgr.fill("#pin-input", "1994");
await mgr.press("#pin-input", "Enter");                      // PIN by Enter
await mgr.waitForSelector("#screen-manager:not([hidden])");
await mgr.waitForTimeout(SYNC);
log("8. PIN by Enter → manager:", !(await mgr.locator("#screen-manager").isHidden()));
log("9. catalog button visible without scrolling:", await mgr.locator("#btn-products").isVisible());
await mgr.screenshot({ path: `${OUT}/m-4-manager.png` });

const rows = await mgr.locator("#all-shipments li").allInnerTexts();
const mi = rows.findIndex((t) => t.includes(STAMP));
log("10. manager sees it:", mi >= 0, "| type shown:", rows[mi]?.includes(type));
await mgr.tap(`button[data-typefilter="${type}"]`);
await mgr.waitForTimeout(500);
log("11. type filter keeps it:", (await mgr.locator("#all-shipments li").allInnerTexts()).some(t => t.includes(STAMP)));

/* ---- catalog screen from the app bar ---- */
await mgr.tap("#btn-products");
await mgr.waitForSelector("#screen-products:not([hidden])");
await mgr.waitForTimeout(5000);
log("12. catalog count line:", await mgr.locator("#products-count").innerText());
await mgr.fill("#product-search", C1);
await mgr.waitForTimeout(2500);
log("13. search by barcode found:", await mgr.locator("#products-list input[data-barcode]").count());

await mgr.fill("#product-search", "");                       // and an unlisted barcode is refused
await mgr.waitForTimeout(1500);
const emp = await ctx.newPage();
await emp.goto(BASE + "/", { waitUntil: "load" });
await emp.tap("#btn-new");
await emp.fill("#barcode-input", "9990001112223");
await emp.press("#barcode-input", "Enter");
await emp.waitForSelector("#item-warn:not([hidden])");
log("13b. unlisted barcode refused:", await emp.locator("#btn-add-item").isDisabled(),
  "| message:", (await emp.locator("#item-warn").innerText()).replace(/\n/g, " "));
await emp.screenshot({ path: `${OUT}/m-6-refused.png` });
await emp.close();
await mgr.screenshot({ path: `${OUT}/m-5-products.png` });
await mgr.goBack();
log("14. back from catalog → shipments:", !(await mgr.locator("#screen-manager").isHidden()));

/* ---- copy + downloads, then clean up ---- */
await mgr.waitForTimeout(SYNC);
const rows2 = await mgr.locator("#all-shipments li").allInnerTexts();
const mi2 = rows2.findIndex((t) => t.includes(STAMP));
await mgr.tap(`button[data-act="copy"][data-i="${mi2}"]`);
log("15. copied:", JSON.stringify(await mgr.evaluate(() => navigator.clipboard.readText())));
const dl = (await Promise.all([mgr.waitForEvent("download"), mgr.tap(`button[data-act="txt"][data-i="${mi2}"]`)]))[0];
log("16. txt file:", dl.suggestedFilename());
await mgr.tap(`button[data-act="del"][data-i="${mi2}"]`);
await mgr.waitForTimeout(SYNC);
await mgr.reload({ waitUntil: "load" });
await mgr.fill("#pin-input", "1994");
await mgr.press("#pin-input", "Enter");
await mgr.waitForSelector("#screen-manager:not([hidden])");
await mgr.waitForTimeout(SYNC);
log("17. deleted (cleanup ok):",
  !(await mgr.locator("#all-shipments li").allInnerTexts()).some(t => t.includes(STAMP)));

/* ---- ZIP export on the phone: one folder per shipment type ---- */
const zip = (await Promise.all([mgr.waitForEvent("download"), mgr.tap("#btn-export-zip")]))[0];
const zipPath = `${OUT}/m-shipments.zip`;
await zip.saveAs(zipPath);
const zipBytes = readFileSync(zipPath);
log("18. zip:", zip.suggestedFilename(), zipBytes.length, "bytes | signature ok:",
  zipBytes[0] === 0x50 && zipBytes[1] === 0x4b);

/* ---- admin page on the phone ---- */
const adm = await ctx.newPage();
adm.on("pageerror", (e) => console.log("[pageerror:admin]", e.message));
adm.on("dialog", (d) => d.dismiss());                        // never confirm a destructive tool here
await adm.goto(BASE + "/admin.html", { waitUntil: "load" });
await adm.fill("#pin-input", "7007");
await adm.press("#pin-input", "Enter");                       // PIN by Enter
await adm.waitForSelector("#screen-admin:not([hidden])", { timeout: 20000 });
log("19. admin PIN by Enter → settings:", !(await adm.locator("#screen-admin").isHidden()));
log("20. branches:", await adm.locator("#branches-list li").count(),
  "| types:", await adm.locator("#types-list li").count(),
  "| bulk button:", await adm.locator("#btn-bulk-delete").innerText());
await adm.screenshot({ path: `${OUT}/m-7-admin.png` });

await adm.tap("#btn-logs");
await adm.waitForTimeout(5000);
const logRows = await adm.locator("#logs-list li").allInnerTexts();
log("21. audit trail rows:", logRows.length,
  "| this run's delete is in it:", logRows.some(t => t.includes(STAMP)));
log("    newest:", (logRows[0] || "").replace(/\n/g, " | "));
await adm.screenshot({ path: `${OUT}/m-8-logs.png` });
await adm.goBack();
log("22. back from logs → settings:", !(await adm.locator("#screen-admin").isHidden()));

/* ---- PWA signals on the phone ---- */
const pwa = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  const m = await fetch("manifest.json").then(r => r.json());
  const a = await fetch("manifest-admin.json").then(r => r.json());
  return { sw: !!reg.active, name: m.name, display: m.display, admin: a.short_name, adminStart: a.start_url };
});
log("23. PWA:", JSON.stringify(pwa));

await browser.close();
