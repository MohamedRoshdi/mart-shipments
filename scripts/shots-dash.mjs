/* The manager's daily screen, with the counters and the three ERP states on real cards.
   A dashboard is not proved by an assertion — this is here to be looked at. */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.env.OUT || "/tmp/shots";
const BASE = process.env.BASE || "http://localhost:8080";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

for (const [tag, viewport] of [["phone", { width: 412, height: 915 }], ["wide", { width: 1440, height: 900 }]]) {
  const page = await browser.newPage({ viewport });
  await page.goto(`${BASE}/manager.html?test=1`, { waitUntil: "load" });
  await page.evaluate(() => {
    localStorage.removeItem("session");
    const day = 86400000;
    const row = (name, type, extra) => ({
      name, type, createdBy: "أحمد", branch: "فرع قويسنا",
      items: [{ barcode: "6221031250057", name: "لبن", qty: 4 }], ...extra,
    });
    // minutes, not hours: run this at 00:30 with hour-scale offsets and "today" lands yesterday,
    // which makes the counters look wrong when they are in fact right
    const min = 60000;
    localStorage.setItem("test-shipments", JSON.stringify([
      row("المراعي", "إذن استلام", { createdAt: Date.now() - 2 * min }),
      row("جهينة", "إذن استلام", { createdAt: Date.now() - 6 * min, loadedBy: "محمد يحيى", loadedAt: Date.now() - 4 * min }),
      row("بيبسي", "إذن مرتجع", { createdAt: Date.now() - 10 * min, loadedBy: "أحمد", loadedAt: Date.now() - 8 * min, erpAt: Date.now() - 5 * min }),
      row("دومتي", "تحويل فرع", { createdAt: Date.now() - 5 * day }),
    ]));
  });
  await page.reload({ waitUntil: "load" });
  await page.fill("#pin-input", await page.evaluate(() => window.APP_CONFIG.managerPin));
  await page.click("#btn-pin");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/dash-${tag}.png`, fullPage: true });
  console.log(`[dash] ${tag}:`, (await page.locator("#erp-counts li b").allTextContents()).join(" / "),
    "| cards:", await page.locator("#all-shipments li").count());
  await page.close();
}

await browser.close();
console.log("shots in", OUT);
