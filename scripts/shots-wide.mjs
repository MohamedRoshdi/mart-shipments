/* The manager and admin pages on a desktop screen, plus the three toast colours.
   Everything else is shot at phone width by shots-all.mjs; this is the only check that the
   wide breakpoint and the toast kinds actually render. */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.env.OUT || "/tmp/shots";
const BASE = process.env.BASE || "http://localhost:8080";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

async function signIn(url, pinKey) {
  await page.goto(`${BASE}/${url}?test=1`, { waitUntil: "load" });
  await page.evaluate(() => localStorage.removeItem("session"));
  await page.evaluate(() => localStorage.setItem("test-shipments", JSON.stringify(
    Array.from({ length: 6 }, (_, i) => ({
      name: `مورد ${i + 1}`, createdBy: "أحمد", createdAt: Date.now() - i * 3600000,
      branch: "فرع قويسنا", type: "إذن استلام",
      items: [{ barcode: "6221031250057", name: "لبن", qty: i + 1 }],
    })))));
  await page.reload({ waitUntil: "load" });
  await page.fill("#pin-input", await page.evaluate((k) => window.APP_CONFIG[k], pinKey));
  await page.click("#btn-pin");
  await page.waitForTimeout(800);
}

await signIn("manager.html", "managerPin");
const cols = await page.evaluate(() =>
  getComputedStyle(document.getElementById("all-shipments")).gridTemplateColumns.split(" ").length);
console.log("[wide] manager card columns at 1440px:", cols);
await page.screenshot({ path: `${OUT}/wide-manager.png`, fullPage: true });

// the three toast colours, on the page that raises them
for (const [kind, label] of [["ok", "ok"], ["warn", "warn"], ["bad", "bad"]]) {
  await page.evaluate((k) => {
    const t = document.getElementById("toast");
    t.textContent = `رسالة ${k}`;
    t.className = `show t-${k}`;
  }, kind);
  const bg = await page.evaluate(() => getComputedStyle(document.getElementById("toast")).backgroundColor);
  console.log(`[wide] toast t-${kind}:`, bg);
  await page.screenshot({ path: `${OUT}/toast-${label}.png` });
}

await browser.close();
console.log("shots in", OUT);
if (cols < 2) { console.log("[wide] FAIL — the list is still one column at 1440px"); process.exit(1); }
console.log("[wide] OK");
