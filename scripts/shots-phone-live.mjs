/* The employee page at a REAL phone width, on the DEPLOYED site, under the real quota state.
   Read-only apart from what the app itself writes at boot (one `usage` doc, pinned to a known
   device id so there is at most one junk row to clean up). No shipment, no count, no expiry. */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = "/tmp/shots-phone";
const BASE = "https://mohamedroshdi.github.io/mart-shipments";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
  serviceWorkers: "block",
});
const page = await ctx.newPage();
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });

await page.goto(`${BASE}/index.html`, { waitUntil: "load" });
await page.evaluate(() => {
  localStorage.setItem("deviceId", "browsertest-phone");
  localStorage.setItem("employeeName", "فحص الفون");
  localStorage.setItem("employeeBranch", "فرع قويسنا");
  localStorage.setItem("session", JSON.stringify({
    name: "فحص الفون", branches: [], user: true, at: Date.now(),
    perms: ["emp", "create", "count", "expiry", "label", "edit", "del", "download"],
  }));
});
await page.reload({ waitUntil: "load" });
await page.waitForSelector("#screen-home:not([hidden])");
await page.waitForTimeout(1500);

const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
const state = async () => page.evaluate(() => ({
  w: innerWidth,
  col: getComputedStyle(document.body).getPropertyValue("--col").trim(),
  wide: document.body.classList.contains("wide"),
  chip: document.getElementById("sync-state").textContent,
  chipCls: document.getElementById("sync-state").className,
  footer: document.getElementById("version-line").textContent,
  scroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}));

console.log("[home  ]", JSON.stringify(await state()));
await shot("01-home");

// the chip only turns after SLOW_MS (8s) of an unacknowledged write
await page.waitForTimeout(9000);
console.log("[home+9s]", JSON.stringify(await state()));
await shot("02-home-pending");

await page.click("#btn-new");
await page.waitForTimeout(600);
console.log("[new   ]", JSON.stringify(await state()));
await shot("03-new-shipment");

await page.goBack();
await page.click("#btn-expiry");
await page.waitForTimeout(600);
console.log("[expiry]", JSON.stringify(await state()));
await shot("04-expiry");

await page.goBack();
await page.click("#btn-label");
await page.waitForTimeout(600);
console.log("[label ]", JSON.stringify(await state()));
await shot("05-label");

console.log("[console errors]", errs.filter((e) => /resource-exhausted|permission|Quota/i.test(e)).length,
  "quota/permission lines of", errs.length);
errs.slice(0, 3).forEach((e) => console.log("   ", e.slice(0, 160)));

await browser.close();
console.log("shots in", OUT);
