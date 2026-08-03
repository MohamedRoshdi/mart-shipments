import { chromium } from "@playwright/test";
import { signIn } from "./seed.mjs";

const OUT = process.env.OUT || "/tmp/shots";
const BASE = process.env.BASE || "http://localhost:8099";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });

const rows = [
  { _id: "e1", barcode: "6221031250057", name: "لبن المراعي كامل الدسم 1 لتر", qty: 12, day: 14, month: 9, year: 2026, branch: "فرع قويسنا", createdBy: "أحمد", createdAt: 1 },
  { _id: "e2", barcode: "6223001360155", name: "عصير جهينة مانجو 1 لتر", qty: 6, day: 3, month: 9, year: 2026, branch: "فرع قويسنا", createdBy: "أحمد", createdAt: 2 },
  { _id: "e3", barcode: "6224007850005", name: "أرز الضحى 1 كيلو", qty: 4, day: 20, month: 11, year: 2026, branch: "فرع قويسنا", createdBy: "أحمد", createdAt: 3 },
  { _id: "e4", barcode: "6221048001234", name: "زيت عافية 700 مل", qty: 9, day: 2, month: 8, year: 2026, branch: "فرع قويسنا", createdBy: "أحمد", createdAt: 4 },
  { _id: "e5", barcode: "6221048009999", name: "زبادي المراعي", qty: 3, day: 10, month: 7, year: 2026, branch: "فرع قويسنا", createdBy: "أحمد", createdAt: 5 },
];

await page.goto(BASE + "/?test=1");
await signIn(page);
await page.evaluate((r) => {
  localStorage.setItem("employeeName", "أحمد");
  localStorage.setItem("employeeBranch", "فرع قويسنا");
  localStorage.setItem("test-products", JSON.stringify({ "6221031250057": "لبن المراعي كامل الدسم 1 لتر" }));
  localStorage.setItem("test-expiry", JSON.stringify(r));
  localStorage.setItem("test-shipments", JSON.stringify([
    { name: "شحنة المراعي", createdBy: "أحمد", branch: "فرع قويسنا", createdAt: 1753700000000, type: "إذن استلام",
      items: [{ barcode: "6221031250057", name: "لبن كامل الدسم 1 لتر", qty: 12 }] },
  ]));
  localStorage.setItem("test-counts", JSON.stringify([
    { name: "جرد رف اللبن", createdBy: "أحمد", branch: "فرع قويسنا", createdAt: 1753700000000,
      items: [{ barcode: "6221031250057", name: "لبن", qty: 8, sys: 10 }] },
  ]));
}, rows);
await page.reload();
await page.waitForTimeout(500);
await shot("e1-home");

await page.click("#btn-expiry");
await page.waitForTimeout(400);
await shot("e2-months");

await page.click('#exp-months button[data-month="2026-09"]');
await page.waitForTimeout(300);
await shot("e3-month");

await page.goto(BASE + "/?test=1");
await page.waitForTimeout(300);
await page.click("#btn-expiry");
await page.fill("#barcode-input", "6221031250057");
await page.click("#btn-lookup");
await page.waitForSelector("#item-form:not([hidden])");
await shot("e4-sheet");

// the employee session would route this page straight back to index.html — drop it and use the PIN
await page.evaluate(() => localStorage.removeItem("session"));
await page.goto(BASE + "/manager.html?test=1");
await page.fill("#pin-input", "1994");
await page.click("#btn-pin");
await page.waitForTimeout(500);
await page.click('#list-tabs button[data-tab="expiry"]');
await page.waitForTimeout(300);
await shot("e5-manager");

await browser.close();
