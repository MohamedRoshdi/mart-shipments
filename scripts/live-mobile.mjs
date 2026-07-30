// Full flow on the LIVE site in mobile emulation (Pixel 5, touch, mobile UA). Self-cleaning.
import { chromium, devices } from "@playwright/test";

const BASE = "https://mohamedroshdi.github.io/mart-shipments";
const STAMP = "فحص-موبايل-" + process.env.STAMP;
const OUT = process.env.OUT || "/tmp/shots";
const SYNC = 4000;
const log = (...a) => console.log("[mobile]", ...a);

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
await page.fill("#barcode-input", "6221031250057");
await page.press("#barcode-input", "Enter");                 // lookup by Enter
await page.waitForSelector("#item-form:not([hidden])");
log("3. sheet label:", await page.locator("#item-name").innerText());
await shot("2-sheet");
await page.press("#item-qty", "Enter");                      // add by Enter
await page.waitForSelector("#item-form", { state: "hidden" });
await page.fill("#barcode-input", "9999999999999");
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
await mgr.fill("#product-search", "6221031250057");
await mgr.waitForTimeout(2500);
log("13. search by barcode found:", await mgr.locator("#products-list input[data-barcode]").count());
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

/* ---- PWA signals on the phone ---- */
const pwa = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  const m = await fetch("manifest.json").then(r => r.json());
  return { sw: !!reg.active, name: m.name, display: m.display };
});
log("18. PWA:", JSON.stringify(pwa));

await browser.close();
