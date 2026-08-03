// Every screen of the three pages, on a phone, in one run — the reference set for any
// visual change. OUT=/tmp/shots BASE=http://localhost:8087 node scripts/shots-all.mjs
import { chromium, devices } from "playwright";

const BASE = process.env.BASE || "http://localhost:8080";
const OUT = process.env.OUT || "/tmp/shots-all";

const CATALOG = {
  "6221031250057": { name: "لبن المراعي كامل الدسم 1 لتر", unit: "كرتونة", stock: { "فرع قويسنا": 12 } },
  "6223001360155": { name: "شاي ليبتون 100 فتلة", unit: "علبة", stock: { "فرع قويسنا": 4 } },
  "6224000123456": { name: "جبنة بيضاء 1 كجم", unit: "علبة" },
};
const SHIPMENTS = [
  { name: "شحنة المراعي", createdBy: "أحمد", branch: "فرع قويسنا", type: "إذن استلام", createdAt: 1753700000000,
    items: [{ barcode: "6221031250057", name: "لبن المراعي كامل الدسم 1 لتر", unit: "كرتونة", qty: 12 },
            { barcode: "6223001360155", name: "شاي ليبتون 100 فتلة", unit: "علبة", qty: 3 }] },
  { name: "مرتجع الألبان", createdBy: "سيد", branch: "فرع شبين الكوم", type: "إذن مرتجع", createdAt: 1753600000000,
    items: [{ barcode: "6224000123456", name: "جبنة بيضاء 1 كجم", qty: 2 }] },
];
const COUNTS = [
  { name: "جرد تلاجة الألبان", createdBy: "أحمد", branch: "فرع قويسنا", createdAt: 1753700000000,
    items: [{ barcode: "6221031250057", name: "لبن المراعي كامل الدسم 1 لتر", qty: 9, sys: 12 },
            { barcode: "6224000123456", name: "جبنة بيضاء 1 كجم", qty: 2 }] },
];
const EXPIRY = [
  { _id: "e1", barcode: "6221031250057", name: "لبن المراعي كامل الدسم 1 لتر", qty: 6, day: 14, month: 9, year: 2026,
    branch: "فرع قويسنا", createdBy: "أحمد", createdAt: 1753700000001 },
  { _id: "e2", barcode: "6223001360155", name: "شاي ليبتون 100 فتلة", qty: 2, day: 3, month: 11, year: 2026,
    branch: "فرع قويسنا", createdBy: "أحمد", createdAt: 1753700000002 },
  { _id: "e3", barcode: "6224000123456", name: "جبنة بيضاء 1 كجم", qty: 4, day: 2, month: 8, year: 2026,
    branch: "فرع قويسنا", createdBy: "أحمد", createdAt: 1753700000003 },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 5"] });
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });

const seed = (page) => page.evaluate((d) => {
  localStorage.setItem("test-products", JSON.stringify(d.CATALOG));
  localStorage.setItem("test-shipments", JSON.stringify(d.SHIPMENTS));
  localStorage.setItem("test-counts", JSON.stringify(d.COUNTS));
  localStorage.setItem("test-expiry", JSON.stringify(d.EXPIRY));
}, { CATALOG, SHIPMENTS, COUNTS, EXPIRY });

// One door: since 2026-08-01 the employee page opens on the PIN screen unless a session exists,
// so a screenshot run has to sign itself in the way a person does.
const signIn = (page) => page.evaluate((d) => localStorage.setItem("session", JSON.stringify(d)),
  { name: "أحمد", branches: [], perms: ["emp", "create", "count", "expiry", "label", "edit"], user: true, at: Date.now() });

/* ---------- employee ---------- */
const page = await ctx.newPage();
await page.goto(`${BASE}/?test=1`);
await seed(page);
await page.reload();
await shot(page, "01-login");                           // the one door: the PIN screen

await signIn(page);
await page.evaluate(() => localStorage.setItem("employeeName", "أحمد"));
await page.reload();
await shot(page, "02-home");

await page.click("#btn-new");
await shot(page, "03-new-shipment");
await page.fill("#shipment-name", "شحنة المراعي");
await page.fill("#barcode-input", "6221031250057");
await page.click("#btn-lookup");
await page.waitForTimeout(400);                         // the sheet slides up; catch it settled
await shot(page, "04-item-sheet");
await page.click("#btn-add-item");
await page.fill("#find-input", "شاي");
await page.waitForTimeout(400);
await shot(page, "05-search-results");
await page.click("#btn-back");

await page.click("#btn-count");
await page.fill("#barcode-input", "6221031250057");
await page.click("#btn-lookup");
await page.waitForTimeout(400);
await shot(page, "06-stocktake-sheet");
await page.click("#btn-cancel-item");
await page.click("#btn-back");

await page.click("#btn-expiry");
await page.waitForTimeout(300);
await shot(page, "07-expiry-months");
await page.click("#exp-months li button[data-month]");
await page.waitForTimeout(200);
await shot(page, "08-expiry-month");

/* ---------- manager ---------- */
// its own context, same reason as the admin below: the employee session routes this page away
const mgrCtx = await browser.newContext({ ...devices["Pixel 5"] });
const m = await mgrCtx.newPage();
await m.goto(`${BASE}/manager.html?test=1`);
await seed(m);
await m.reload();
await shot(m, "09-manager-pin");
await m.fill("#pin-input", await m.evaluate(() => window.APP_CONFIG.managerPin));
await m.click("#btn-pin");
await m.waitForTimeout(300);
await shot(m, "10-manager-shipments");
await m.click('#list-tabs button[data-tab="count"]');
await shot(m, "11-manager-counts");
await m.click('#list-tabs button[data-tab="expiry"]');
await shot(m, "12-manager-expiry");
await m.click('#list-tabs button[data-tab="ship"]');
await m.click('#all-shipments button[data-act="view"]');
await m.waitForTimeout(200);
await shot(m, "13-manager-detail");
await m.click("#btn-back");
await m.click("#btn-products");
await m.waitForTimeout(300);
await shot(m, "14-manager-products");

/* ---------- admin ---------- */
// its own context: the manager session would be redirected away from the admin screen
const adminCtx = await browser.newContext({ ...devices["Pixel 5"] });
const a = await adminCtx.newPage();
await a.goto(`${BASE}/admin.html?test=1`);
await a.fill("#pin-input", await a.evaluate(() => window.APP_CONFIG.adminPin));
await a.click("#btn-pin");
await a.waitForSelector("#screen-admin:not([hidden])");
await shot(a, "15-admin-menu");
await a.click('[data-goto="screen-data"]');             // the users list lives behind the menu now
await a.waitForSelector("#screen-data:not([hidden])");
await a.click("#btn-add-user");
await a.fill('input[data-uname="0"]', "حسن الجندي");
await a.fill('input[data-upin="0"]', "4411");
await a.waitForTimeout(200);
await shot(a, "15-admin");
await a.click("#btn-back");
await a.waitForSelector("#screen-admin:not([hidden])");
await a.click("#btn-logs");
await a.waitForTimeout(200);
await shot(a, "16-admin-logs");

console.log("shots in", OUT);
await browser.close();
