// The live checks each add one product to the real catalog and delete it again — except when a
// run dies half way, and then the row stays. This finds every product a live script could have
// left behind and, with DELETE=1, removes them.
//
// It reads the WHOLE catalog once (~10k reads of a 50k/day allowance), which is the only honest
// way to count them: the catalog screen stops at 50 rows and the search index is per phone.
//
// node scripts/live-junk-sweep.mjs            # count and list, changes nothing
// DELETE=1 node scripts/live-junk-sweep.mjs   # and remove them
import { chromium } from "@playwright/test";

const BASE = process.env.BASE || "https://mohamedroshdi.github.io/mart-shipments";
const DELETE = process.env.DELETE === "1";
const log = (...a) => console.log("[sweep]", ...a);

// every name the scripts in this folder write
const JUNK = ["صنف صلاحية آلي", "صنف جرد آلي", "صنف فحص آلي", "صنف جرد موبايل", "صنف فحص حقول"];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE}/manager.html`, { waitUntil: "load" });
await page.waitForTimeout(4000);

const found = await page.evaluate(async (junk) => {
  const db = await import("./db.js");
  const all = await db.listAllProducts();
  return {
    total: all.length,
    junk: all.filter((p) => junk.some((j) => (p.name || "").startsWith(j)))
      .map((p) => ({ barcode: p.barcode, name: p.name })),
  };
}, JUNK);

log(`catalog: ${found.total} products · left behind by live scripts: ${found.junk.length}`);
found.junk.forEach((p) => log(" -", p.barcode, p.name));

if (DELETE && found.junk.length) {
  const gone = await page.evaluate(async (codes) => {
    const db = await import("./db.js");
    for (const c of codes) await db.deleteProduct(c);
    return codes.length;
  }, found.junk.map((p) => p.barcode));
  await page.waitForTimeout(4000);
  log("deleted:", gone);
} else if (found.junk.length) {
  log("nothing deleted — re-run with DELETE=1");
}

await browser.close();
