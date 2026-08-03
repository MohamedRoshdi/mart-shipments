/* The check that would have caught the «مقدرناش نقرا الإعدادات» bug, and that no test in
   `?test=1` can: there, `watchConfig` is a localStorage relay that always reports
   `fromCache: false`. Only a real Firestore listener with a real IndexedDB cache behind it can
   show the difference — and the difference is the whole bug.

   A FRESH profile takes its first snapshot from the server, so everything looks right. Load the
   same profile a second time and the cache answers first; if the listener is not asking for
   metadata changes, the server delivery that follows is suppressed (the document did not change,
   only `metadata.fromCache` did), `cfgFromServer` stays false for ever, «حفظ الإعدادات» is locked
   and the manager's auto-import never runs. Measured on the deployed site 2026-08-03.

   Exits 1 if any load leaves the save button disabled.
   BASE=http://localhost:8080 node scripts/warm-cache.mjs      (or omit BASE for the live site)  */
import { chromium } from "playwright";

const BASE = process.env.BASE || "https://mohamedroshdi.github.io/mart-shipments";
const browser = await chromium.launch();
const ctx = await browser.newContext({ serviceWorkers: "block" });
const page = await ctx.newPage();
let bad = 0;

const look = async (label) => {
  await page.waitForTimeout(10000);          // past the 6s «الحفظ متقفل» timer
  const s = await page.evaluate(() => ({
    saveDisabled: document.getElementById("btn-save-config")?.disabled,
    toast: (document.getElementById("toast")?.textContent || "").slice(0, 50),
  }));
  if (s.saveDisabled) bad++;
  console.log(`[warm] ${label}: save ${s.saveDisabled ? "LOCKED" : "open"}${s.toast ? ` | ${s.toast}` : ""}`);
};

await page.goto(`${BASE}/admin.html`, { waitUntil: "domcontentloaded" });
await look("cold profile ");
for (const n of ["2nd load    ", "3rd load    "]) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await look(n);
}

await browser.close();
console.log(bad ? "[warm] FAIL — a warm cache locks the settings save" : "[warm] OK");
process.exit(bad ? 1 : 0);
