import { chromium } from "@playwright/test";

const OUT = process.env.OUT || "/tmp/shots";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });

// setup
await page.goto("http://localhost:8080/?test=1");
await page.fill("#employee-name", "أحمد");
await page.fill("#branch-pin", "••••");
await shot("1-setup");

// home with shipments
await page.evaluate(() => {
  localStorage.setItem("employeeName", "أحمد");
  localStorage.setItem("employeeBranch", "فرع شبين الكوم");
  localStorage.setItem("test-shipments", JSON.stringify([
    { name: "شحنة المراعي", createdBy: "أحمد", branch: "فرع شبين الكوم", createdAt: 1753700000000,
      items: [{ barcode: "6221031250057", name: "لبن كامل الدسم 1 لتر", qty: 12 }, { barcode: "6224007850005", name: "أرز الضحى", qty: 4 }] },
    { name: "شحنة جهينة", createdBy: "أحمد", branch: "فرع شبين الكوم", createdAt: 1753600000000,
      items: [{ barcode: "6223001360155", name: "عصير جهينة مانجو", qty: 24 }] },
  ]));
});
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
await page.goto("http://localhost:8080/manager.html?test=1");
await page.fill("#pin-input", "1994");
await page.click("#btn-pin");
await page.waitForTimeout(400);
await shot("5-manager");
await page.click('button[data-act="view"]');
await page.waitForTimeout(300);
await shot("6-detail");

await browser.close();
console.log("shots in " + OUT);
