import { chromium } from "@playwright/test";
import { signIn } from "./seed.mjs";

const OUT = process.env.OUT || "/tmp/shots";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });

// setup
await page.goto("http://localhost:8080/?test=1");
await shot("1-login");            // the one door: the PIN screen is what an unsigned phone shows
await signIn(page);

// home with shipments
// stamped NOW on purpose: the employee home shows today's work only (2026-08-01), so a fixture
// with a fixed timestamp renders an empty home the day after it was written
await page.evaluate((now) => {
  localStorage.setItem("employeeName", "أحمد");
  localStorage.setItem("employeeBranch", "فرع شبين الكوم");
  localStorage.setItem("test-shipments", JSON.stringify([
    { name: "شحنة المراعي", createdBy: "أحمد", branch: "فرع شبين الكوم", createdAt: now - 60000,
      items: [{ barcode: "6221031250057", name: "لبن كامل الدسم 1 لتر", qty: 12 }, { barcode: "6224007850005", name: "أرز الضحى", qty: 4 }] },
    { name: "شحنة جهينة", createdBy: "أحمد", branch: "فرع شبين الكوم", createdAt: now - 120000,
      items: [{ barcode: "6223001360155", name: "عصير جهينة مانجو", qty: 24 }] },
  ]));
}, Date.now());
await page.reload();
await page.waitForTimeout(400);
await shot("2-home");

// new shipment with items
await page.click('button[data-edit="0"]');
await page.waitForTimeout(300);
await shot("3-shipment");

// item sheet
await page.fill("#barcode-input", "6223001360155");
await page.click("#btn-lookup");
await page.waitForSelector("#item-form:not([hidden])");
await shot("4-sheet");

// manager list
// the employee session would route this page back to index.html — drop it and use the PIN
await page.evaluate(() => localStorage.removeItem("session"));
await page.goto("http://localhost:8080/manager.html?test=1");
await page.fill("#pin-input", "1994");
await page.click("#btn-pin");
await page.waitForTimeout(400);
await shot("5-manager");
await page.click('button[data-act="view"]');
await page.waitForTimeout(300);
await shot("6-detail");

// catalog screen
await page.evaluate(() => localStorage.setItem("test-products", JSON.stringify({
  "6221031250057": "لبن المراعي كامل الدسم 1 لتر",
  "6223001360155": "عصير جهينة مانجو 1 لتر",
  "6224007850005": "أرز الضحى 1 كيلو",
  "6221048001234": "زيت عافية 700 مل",
})));
// the employee session would route this page back to index.html — drop it and use the PIN
await page.evaluate(() => localStorage.removeItem("session"));
await page.goto("http://localhost:8080/manager.html?test=1");
await page.fill("#pin-input", "1994");
await page.click("#btn-pin");
await page.click("#btn-products");
await page.waitForTimeout(400);
await shot("7-products");

await browser.close();
console.log("shots in " + OUT);
