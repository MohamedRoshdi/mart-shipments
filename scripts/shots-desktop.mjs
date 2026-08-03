/* Every screen of the three pages on the SHOP LAPTOP, not on a phone. `shots-all.mjs` is 412px
   only, so nothing had ever looked at the wide layout except the manager list — and the admin's
   «أدوات خطرة» was squeezing its own description into a one-word column at 1148px (the owner's
   own screenshot, 2026-08-03).
   It also MEASURES rather than just photographing: a card's text block must not be crushed by
   controls that fit beside it, and nothing may overflow the page sideways. Exits 1 on either.
   OUT=/tmp/shots-desktop BASE=http://localhost:8080 node scripts/shots-desktop.mjs */
import { chromium } from "playwright";
import { signIn } from "./seed.mjs";

const BASE = process.env.BASE || "http://localhost:8080";
const OUT = process.env.OUT || "/tmp/shots-desktop";
const W = Number(process.env.W || 1280);

const CATALOG = {
  "6221031250057": { name: "لبن المراعي كامل الدسم 1 لتر", unit: "كرتونة", price: 42.5, stock: { "فرع قويسنا": 12 } },
  "6223001360155": { name: "شاي ليبتون 100 فتلة", unit: "علبة", stock: { "فرع قويسنا": 4 } },
};
const now = Date.now();
const SHIPMENTS = [
  { name: "شحنة المراعي", createdBy: "أحمد", branch: "فرع قويسنا", type: "إذن استلام", createdAt: now - 60000,
    items: [{ barcode: "6221031250057", name: "لبن المراعي كامل الدسم 1 لتر", unit: "كرتونة", qty: 12 }] },
];
const COUNTS = [
  { name: "جرد تلاجة الألبان", createdBy: "أحمد", branch: "فرع قويسنا", createdAt: now - 120000,
    items: [{ barcode: "6221031250057", name: "لبن المراعي كامل الدسم 1 لتر", qty: 9, sys: 12 }] },
];
const EXPIRY = [
  { _id: "e1", barcode: "6221031250057", name: "لبن المراعي كامل الدسم 1 لتر", qty: 6, day: 14, month: 9, year: 2026,
    branch: "فرع قويسنا", createdBy: "أحمد", createdAt: now - 3000 },
];
const USERS = [{ name: "حسن الجندى", pin: "1111", branches: ["فرع قويسنا"], perms: ["emp", "mgr", "adm", "create", "count", "expiry", "label", "edit", "del", "download", "products", "import", "danger"], multi: true }];

const browser = await chromium.launch();
const problems = [];

/* A card lays its text across the card and puts its controls underneath. On a phone that happens
   by itself because nothing fits beside anything; on a laptop the chip rows fit, and the text gets
   whatever is left. 240px is about eight Arabic words on one line — below that the description is
   reading as a column, not a sentence. */
const measure = async (page, where) => {
  const bad = await page.evaluate(() => {
    const out = [];
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
      out.push({ what: "the page scrolls sideways", got: document.documentElement.scrollWidth });
    }
    for (const m of document.querySelectorAll(".card-main")) {
      const li = m.closest("li");
      if (!li || li.hidden || !li.offsetParent) continue;
      const card = li.getBoundingClientRect().width;
      const text = m.getBoundingClientRect().width;
      if (card > 500 && text < 240) {
        out.push({ what: "a card's text is crushed beside its controls", card: Math.round(card), text: Math.round(text), first: m.textContent.trim().slice(0, 30) });
      }
    }
    // a single-line field stretched across a laptop column also drags its own delete button away
    for (const i of document.querySelectorAll("li input[type=text]")) {
      if (!i.offsetParent) continue;
      const w = i.getBoundingClientRect().width;
      if (w > 620) out.push({ what: "a one-line field is stretched across the column", got: Math.round(w), id: i.dataset.bname !== undefined ? "branch" : (i.dataset.tname !== undefined ? "type" : i.className || i.id) });
    }
    return out;
  });
  bad.forEach((b) => problems.push({ where, ...b }));
  await page.screenshot({ path: `${OUT}/${where}.png`, fullPage: true });
};

/* ---------- employee ---------- */
const ctx = await browser.newContext({ viewport: { width: W, height: 900 } });
const p = await ctx.newPage();
await p.goto(`${BASE}/?test=1`);
await p.evaluate((d) => {
  localStorage.setItem("test-products", JSON.stringify(d.CATALOG));
  localStorage.setItem("test-shipments", JSON.stringify(d.SHIPMENTS));
  localStorage.setItem("test-counts", JSON.stringify(d.COUNTS));
  localStorage.setItem("test-expiry", JSON.stringify(d.EXPIRY));
}, { CATALOG, SHIPMENTS, COUNTS, EXPIRY });
await signIn(p);
await p.evaluate(() => localStorage.setItem("employeeName", "أحمد"));
await p.reload();
await measure(p, "emp-1-home");
await p.click("#btn-new");
await measure(p, "emp-2-new");
await p.click("#btn-back");
await p.click("#btn-expiry");
await p.waitForTimeout(300);
await measure(p, "emp-3-expiry");
await p.click("#btn-back");
await p.click("#btn-label");
await p.waitForTimeout(200);
await measure(p, "emp-4-label");

/* ---------- manager ---------- */
const mctx = await browser.newContext({ viewport: { width: W, height: 900 } });
const m = await mctx.newPage();
await m.goto(`${BASE}/manager.html?test=1`);
await m.evaluate((d) => {
  localStorage.setItem("test-products", JSON.stringify(d.CATALOG));
  localStorage.setItem("test-shipments", JSON.stringify(d.SHIPMENTS));
  localStorage.setItem("test-counts", JSON.stringify(d.COUNTS));
  localStorage.setItem("test-expiry", JSON.stringify(d.EXPIRY));
}, { CATALOG, SHIPMENTS, COUNTS, EXPIRY });
await m.reload();
await m.fill("#pin-input", await m.evaluate(() => window.APP_CONFIG.managerPin));
await m.click("#btn-pin");
await m.waitForTimeout(400);
await measure(m, "mgr-1-list");
await m.click("#btn-tools");
await measure(m, "mgr-2-tools");
await m.click('#all-shipments button[data-act="view"]');
await m.waitForTimeout(200);
await measure(m, "mgr-3-card");
await m.click("#btn-back");
await m.click("#btn-products");
await m.waitForTimeout(300);
await measure(m, "mgr-4-products");

/* ---------- admin ---------- */
const actx = await browser.newContext({ viewport: { width: W, height: 900 } });
const a = await actx.newPage();
await a.goto(`${BASE}/admin.html?test=1`);
await a.evaluate((u) => localStorage.setItem("test-config", JSON.stringify({ ...window.APP_CONFIG, users: u })), USERS);
await a.reload();
await a.fill("#pin-input", await a.evaluate(() => window.APP_CONFIG.adminPin));
await a.click("#btn-pin");
await a.waitForSelector("#screen-admin:not([hidden])");
await measure(a, "adm-1-menu");
for (const [id, name] of [["screen-data", "adm-2-data"], ["screen-label", "adm-3-label"],
  ["screen-folder", "adm-4-folder"], ["screen-pins", "adm-5-pins"], ["screen-danger", "adm-6-danger"],
  ["screen-status", "adm-7-status"], ["screen-logs", "adm-8-logs"]]) {
  await a.click(`#screen-admin [data-goto="${id}"]`);
  await a.waitForSelector(`#${id}:not([hidden])`);
  await a.waitForTimeout(250);
  await measure(a, name);
  await a.click("#btn-back");
  await a.waitForSelector("#screen-admin:not([hidden])");
}

await browser.close();
console.log(`[desktop ${W}px] shots in ${OUT}`);
if (!problems.length) { console.log("[desktop] OK"); process.exit(0); }
for (const b of problems) console.log("[desktop] PROBLEM", JSON.stringify(b));
process.exit(1);
