// Full flow on the LIVE site in mobile emulation (Pixel 5, touch, mobile UA). Self-cleaning.
// Three browser contexts = three phones, because the session lives in localStorage and one
// context would have the employee, the manager and the admin overwriting each other.
import { chromium, devices, openTools, safeDialogs } from "./live-browser.mjs";   // blocks service workers: a fresh profile's SW install reloads the page mid-run
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const BASE = "https://mohamedroshdi.github.io/mart-shipments";
const STAMP = "فحص-موبايل-" + process.env.STAMP;
const UPIN = "87" + String(process.env.STAMP || "01").slice(-2);
const SCODE = "999" + process.env.STAMP;                 // a product this run creates and deletes
const CSTAMP = "جرد-موبايل-" + process.env.STAMP;
const OUT = process.env.OUT || "/tmp/shots";
const SYNC = 4000;
const log = (...a) => console.log("[mobile]", ...a);

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const phone = () => browser.newContext({
  ...devices["Pixel 5"],
  permissions: ["clipboard-read", "clipboard-write"],
  locale: "ar-EG",
});

const ctxAdm = await phone();
const ctxMgr = await phone();
const ctxEmp = await phone();

const adm = await ctxAdm.newPage();
adm.on("pageerror", (e) => console.log("[pageerror:admin]", e.message));
adm.on("dialog", (d) => d.dismiss());          // never confirm a destructive tool here

const page = await ctxEmp.newPage();           // the employee's phone
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const shot = (n) => page.screenshot({ path: `${OUT}/m-${n}.png` });

log("viewport:", JSON.stringify(page.viewportSize()), "| touch + mobile UA on");

/* ---- admin phone: create a throwaway user who covers both branches ---- */
await adm.goto(BASE + "/admin.html", { waitUntil: "load" });
await adm.fill("#pin-input", "7007");
await adm.press("#pin-input", "Enter");                       // PIN by Enter
await adm.waitForSelector("#screen-admin:not([hidden])", { timeout: 20000 });
const usersBefore = await adm.locator("#users-list li.user-card").count();
const UI = usersBefore;
const branchNames = await adm.locator("#branches-list input[data-bname]").evaluateAll(els => els.map(e => e.value));
await adm.tap("#btn-add-user");
await adm.fill(`input[data-uname="${UI}"]`, "فحص موبايل");
await adm.fill(`input[data-upin="${UI}"]`, UPIN);
await adm.tap(`[data-ubranch="${UI}"] button[data-branchpick="${branchNames[1]}"]`);   // both branches
for (const p of ["mgr", "edit", "del", "download", "products", "count"]) {
  await adm.tap(`[data-uperms="${UI}"] button[data-perm="${p}"]`);
}
await adm.tap("#btn-save-config");
await adm.waitForTimeout(SYNC);
log("0. temp user created:", await adm.locator("#toast").innerText(),
  "| branches:", JSON.stringify(branchNames), "| existing users kept:", usersBefore);

/* ---- manager phone: real barcodes from the live catalog (unlisted ones are refused) ---- */
const mgr = await ctxMgr.newPage();
mgr.on("pageerror", (e) => console.log("[pageerror:mgr]", e.message));
safeDialogs(mgr);          // accepts the ordinary confirms, REFUSES anything that deletes live rows
await mgr.goto(BASE + "/manager.html", { waitUntil: "load" });
await mgr.fill("#pin-input", "1994");
await mgr.press("#pin-input", "Enter");                       // legacy master PIN still works
await mgr.waitForSelector("#screen-manager:not([hidden])");
await mgr.tap("#btn-products");
await mgr.waitForSelector("#products-list input[data-barcode]");
await mgr.waitForTimeout(SYNC);
const [C1, C2] = await mgr.locator("#products-list input[data-barcode]")
  .evaluateAll((els) => els.slice(0, 2).map((e) => e.dataset.barcode));
await mgr.goBack();
log("1. catalog barcodes used:", C1, C2);

/* ---- employee phone: one PIN box, no name typing ---- */
await page.goto(BASE + "/", { waitUntil: "load" });
await page.waitForSelector("#screen-login:not([hidden])", { timeout: 20000 });
await page.fill("#login-pin", UPIN);
await page.press("#login-pin", "Enter");                      // keyboard submit
await page.waitForSelector("#screen-home:not([hidden])", { timeout: 20000 });
log("2. login by Enter → home as:", await page.locator("#who").innerText(),
  "| manager link offered:", await page.locator("#link-manager").isVisible());
await shot("1-home");

/* ---- new shipment: branch picker (two branches), type picker, Enter-driven entry ---- */
await page.tap("#btn-new");
await page.waitForSelector("#screen-new:not([hidden])");
const type = (await page.evaluate(() => window.APP_CONFIG.shipmentTypes))[1];
const chips = await page.locator("#new-branch-picker button").allInnerTexts();
log("3. branch chips on new-shipment:", JSON.stringify(chips),
  "| static branch line hidden:", await page.locator("#new-branch").isHidden());
await page.tap(`#new-branch-picker button[data-newbranch="${branchNames[1]}"]`);
await page.tap(`#type-picker button[data-type="${type}"]`);
await page.fill("#shipment-name", STAMP);
await page.fill("#barcode-input", C1);
await page.press("#barcode-input", "Enter");                  // lookup by Enter
await page.waitForSelector("#item-form:not([hidden])");
log("4. sheet label:", await page.locator("#item-name").innerText());
await shot("2-sheet");
await page.press("#item-qty", "Enter");                       // add by Enter
await page.waitForSelector("#item-form", { state: "hidden" });
await page.fill("#barcode-input", C2);
await page.press("#barcode-input", "Enter");
await page.waitForSelector("#item-form:not([hidden])");
await page.press("#item-qty", "Enter");
log("5. items on the list:", await page.locator("#items-list li:not(.empty)").count());
await page.tap('button[data-del="1"]');                       // delete one item
log("6. after deleting one:", await page.locator("#items-list li:not(.empty)").count());
await shot("3-shipment");
await page.tap("#btn-save-shipment");
await page.waitForSelector("#screen-home:not([hidden])");
await page.waitForTimeout(SYNC);
log("7. saved, home shows it:", (await page.locator("#my-shipments").innerText()).includes(STAMP),
  "| stamped branch:", (await page.locator("#my-shipments li").first().innerText()).includes(branchNames[1]));

/* ---- phone back button behaviour ---- */
await page.tap("#btn-new");
await page.goBack();
log("8. phone back returns home:", !(await page.locator("#screen-home").isHidden()));

/* ---- manager phone sees it ---- */
await mgr.reload({ waitUntil: "load" });
await mgr.waitForSelector("#screen-manager:not([hidden])", { timeout: 20000 });   // session, no PIN again
await mgr.waitForTimeout(SYNC);
log("9. manager reopened without a PIN:", !(await mgr.locator("#screen-manager").isHidden()));
log("10. catalog button visible without scrolling:", await mgr.locator("#btn-products").isVisible());
await mgr.screenshot({ path: `${OUT}/m-4-manager.png` });

// the employee save is queued, not server-acked, so the manager list can lag a few seconds
async function waitForRow(p, stamp, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const texts = await p.locator("#all-shipments li").allInnerTexts();
    const at = texts.findIndex((t) => t.includes(stamp));
    if (at >= 0) return { at, texts };
    await p.waitForTimeout(2000);
  }
  return { at: -1, texts: await p.locator("#all-shipments li").allInnerTexts() };
}

const { at: mi, texts: rows } = await waitForRow(mgr, STAMP);
log("11. manager sees it:", mi >= 0, "| type shown:", rows[mi]?.includes(type),
  "| branch shown:", rows[mi]?.includes(branchNames[1]), "| by:", rows[mi]?.includes("فحص موبايل"));
await mgr.tap("#btn-filters");                                 // the chips live behind the toggle now
await mgr.tap(`button[data-typefilter="${type}"]`);
await mgr.waitForTimeout(500);
log("12. type filter keeps it:", (await mgr.locator("#all-shipments li").allInnerTexts()).some(t => t.includes(STAMP)));

/* ---- catalog screen from the app bar ---- */
await mgr.tap("#btn-products");
await mgr.waitForSelector("#screen-products:not([hidden])");
await mgr.waitForTimeout(5000);
log("13. catalog count line:", await mgr.locator("#products-count").innerText());
await mgr.fill("#product-search", C1);
await mgr.waitForTimeout(2500);
log("14. search by barcode found:", await mgr.locator("#products-list input[data-barcode]").count());
await mgr.fill("#product-search", "");
await mgr.waitForTimeout(1500);
await mgr.screenshot({ path: `${OUT}/m-5-products.png` });
await mgr.goBack();
log("15. back from catalog → shipments:", !(await mgr.locator("#screen-manager").isHidden()));

/* ---- an unlisted barcode is still refused, on the employee phone ---- */
await page.tap("#btn-new");
await page.fill("#barcode-input", "9990001112223");
await page.press("#barcode-input", "Enter");
await page.waitForSelector("#item-warn:not([hidden])");
log("16. unlisted barcode refused:", await page.locator("#btn-add-item").isDisabled(),
  "| message:", (await page.locator("#item-warn").innerText()).replace(/\n/g, " "));
await shot("6-refused");
await page.tap("#btn-cancel-item");

/* ---- copy + downloads, then clean the shipment up ---- */
await mgr.waitForTimeout(SYNC);
const { at: mi2 } = await waitForRow(mgr, STAMP);
if (mi2 < 0) throw new Error("the shipment vanished from the list before the copy/download step");
await mgr.tap(`button[data-act="copy"][data-i="${mi2}"]`);
log("17. copied:", JSON.stringify(await mgr.evaluate(() => navigator.clipboard.readText())));
const dl = (await Promise.all([mgr.waitForEvent("download"), mgr.tap(`button[data-act="txt"][data-i="${mi2}"]`)]))[0];
log("18. txt file:", dl.suggestedFilename());
const { at: mi3 } = await waitForRow(mgr, STAMP);             // row index after the two downloads
await mgr.tap(`button[data-act="del"][data-i="${mi3}"]`);
await mgr.waitForTimeout(SYNC);
log("19. delete toast:", await mgr.locator("#toast").innerText());
await mgr.reload({ waitUntil: "load" });
await mgr.waitForSelector("#screen-manager:not([hidden])", { timeout: 20000 });
await mgr.waitForTimeout(SYNC);
log("20. shipment deleted (cleanup ok):",
  !(await mgr.locator("#all-shipments li").allInnerTexts()).some(t => t.includes(STAMP)));

/* ---- الجرد on the phone: the manager loads the quantities, the employee counts a shelf ---- */
const sheet = join(tmpdir(), `stock-${SCODE}.csv`);
writeFileSync(sheet, `﻿الباركود,اسم الصنف,الكمية\r\n${SCODE},صنف جرد موبايل,10\r\n`);
// the employee counts in branchNames[1], so that branch's sheet is the one to load
await openTools(mgr);             // the import tools are behind the fold now
await mgr.tap(`#stock-branch button[data-stockbranch="${branchNames[1]}"]`);
await mgr.setInputFiles("#stock-file", sheet);
await mgr.waitForTimeout(SYNC);
log("21. stock sheet imported:", await mgr.locator("#toast").innerText());

await page.reload({ waitUntil: "load" });
await page.waitForSelector("#screen-home:not([hidden])", { timeout: 20000 });
log("22. جرد button on the employee phone:", await page.locator("#btn-count").isVisible());
await page.tap("#btn-count");
await page.waitForSelector("#screen-new:not([hidden])");
await page.fill("#shipment-name", CSTAMP);
await page.fill("#barcode-input", SCODE);
await page.press("#barcode-input", "Enter");
await page.waitForSelector("#item-form:not([hidden])");
log("23. system quantity shown before counting:", await page.locator("#item-stock-qty").innerText(),
  "| type picker hidden:", await page.locator("#new-type-row").isHidden());
await shot("9-count-sheet");
await page.fill("#item-qty", "7");
await page.tap("#btn-add-item");
log("24. row verdict:", (await page.locator("#items-list li").first().innerText()).replace(/\s+/g, " ").trim());
await shot("10-count");
await page.tap("#btn-save-shipment");
await page.waitForSelector("#screen-home:not([hidden])");
await page.waitForTimeout(SYNC);
log("25. saved:", await page.locator("#toast").innerText().catch(() => ""),
  "| home list shows the difference:", (await page.locator("#my-counts").innerText()).includes("الفرق ناقص 3"));

await mgr.reload({ waitUntil: "load" });
await mgr.waitForSelector("#screen-manager:not([hidden])", { timeout: 20000 });
await mgr.waitForTimeout(SYNC);
await mgr.tap('#list-tabs button[data-tab="count"]');
async function waitForCount(p, stamp, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const texts = await p.locator("#all-counts li").allInnerTexts();
    const at = texts.findIndex((t) => t.includes(stamp));
    if (at >= 0) return { at, texts };
    await p.waitForTimeout(2000);
    await p.tap('#list-tabs button[data-tab="count"]').catch(() => {});
  }
  return { at: -1, texts: await p.locator("#all-counts li").allInnerTexts() };
}
const { at: ci, texts: crows } = await waitForCount(mgr, CSTAMP);
log("26. manager الجرد tab has it:", ci >= 0, "|", (crows[ci] || "").replace(/\s+/g, " ").trim());
await mgr.screenshot({ path: `${OUT}/m-11-counts.png` });

const cdl = (await Promise.all([
  mgr.waitForEvent("download"),
  mgr.tap(`#all-counts button[data-cact="download"][data-i="${ci}"]`),
]))[0];
const ccsv = readFileSync(await cdl.path(), "utf8");
log("27. excel:", cdl.suggestedFilename(), "| row:", ccsv.split("\r\n")[1]);

await mgr.tap(`#all-counts button[data-cact="del"][data-i="${ci}"]`);
await mgr.waitForTimeout(SYNC);
await mgr.reload({ waitUntil: "load" });
await mgr.waitForSelector("#screen-manager:not([hidden])", { timeout: 20000 });
await mgr.waitForTimeout(SYNC);
await mgr.tap('#list-tabs button[data-tab="count"]');
log("28. count deleted (cleanup ok):",
  !(await mgr.locator("#all-counts li").allInnerTexts()).some(t => t.includes(CSTAMP)));
await mgr.tap("#btn-products");
await mgr.waitForTimeout(SYNC);
await mgr.fill("#product-search", SCODE);
await mgr.waitForTimeout(SYNC);
if (await mgr.locator(`button[data-delproduct="${SCODE}"]`).count()) {
  await mgr.tap(`button[data-delproduct="${SCODE}"]`);
  await mgr.waitForTimeout(SYNC);
}
await mgr.fill("#product-search", SCODE);
await mgr.waitForTimeout(SYNC);
log("29. temp product deleted (cleanup ok):",
  (await mgr.locator(`input[data-barcode="${SCODE}"]`).count()) === 0);
await mgr.goBack();

/* ---- camera settings screen on the phone ---- */
await page.tap("#btn-cam");
await page.waitForSelector("#screen-cam:not([hidden])");
await page.waitForTimeout(2500);
log("30. camera screen:", (await page.locator("#res-picker button").allInnerTexts()).join("/"),
  "| focus toggle:", await page.locator("#btn-focus").getAttribute("aria-pressed"),
  "| cameras listed:", await page.locator("#cam-list button[data-cam]").count());
await shot("12-camera");
await page.goBack();

/* ---- ZIP export on the phone: one folder per shipment type ---- */
const zip = (await Promise.all([mgr.waitForEvent("download"), mgr.tap("#btn-export-zip")]))[0];
const zipPath = `${OUT}/m-shipments.zip`;
await zip.saveAs(zipPath);
const zipBytes = readFileSync(zipPath);
log("31. zip:", zip.suggestedFilename(), zipBytes.length, "bytes | signature ok:",
  zipBytes[0] === 0x50 && zipBytes[1] === 0x4b);

/* ---- admin phone: audit trail, then remove the throwaway user ---- */
await adm.tap("#btn-logs");
await adm.waitForTimeout(5000);
const logRows = await adm.locator("#logs-list li").allInnerTexts();
log("32. audit trail rows:", logRows.length,
  "| this run's delete is in it:", logRows.some(t => t.includes(STAMP)));
log("    newest:", (logRows[0] || "").replace(/\n/g, " | "));
await adm.screenshot({ path: `${OUT}/m-8-logs.png` });
await adm.goBack();
log("33. back from logs → settings:", !(await adm.locator("#screen-admin").isHidden()));
await adm.screenshot({ path: `${OUT}/m-7-admin.png` });

await adm.tap(`button[data-deluser="${UI}"]`);
await adm.tap("#btn-save-config");
await adm.waitForTimeout(SYNC);
log("34. temp user removed:", (await adm.locator("#users-list li.user-card").count()) === usersBefore,
  "| users left:", await adm.locator("#users-list li.user-card").count());

/* ---- PWA signals on the phone ---- */
// one installable app only: the manager and admin pages must NOT offer their own icon
const pwa = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  const m = await fetch("manifest.json").then(r => r.json());
  const mgrHtml = await fetch("manager.html").then(r => r.text());
  const admHtml = await fetch("admin.html").then(r => r.text());
  return { sw: !!reg.active, name: m.name, display: m.display,
    extraManifests: /rel="manifest"/.test(mgrHtml) || /rel="manifest"/.test(admHtml) };
});
log("35. PWA:", JSON.stringify(pwa));

await browser.close();
