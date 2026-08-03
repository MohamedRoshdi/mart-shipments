// The live checks each add one product to the real catalog and delete it again — except when a
// run dies half way, and then the row stays. This finds every product a live script could have
// left behind and, with DELETE=1, removes them.
//
// It reads the WHOLE catalog once (~10k reads of a 50k/day allowance), which is the only honest
// way to count them: the catalog screen stops at 50 rows and the search index is per phone.
//
// node scripts/live-junk-sweep.mjs            # count and list, changes nothing
// DELETE=1 node scripts/live-junk-sweep.mjs   # and remove them
import { chromium } from "./live-browser.mjs";   // blocks service workers: a fresh profile's SW install reloads the page mid-run

const BASE = process.env.BASE || "https://mohamedroshdi.github.io/mart-shipments";
const DELETE = process.env.DELETE === "1";
const log = (...a) => console.log("[sweep]", ...a);

// every name the scripts in this folder write
const JUNK = ["صنف صلاحية آلي", "صنف جرد آلي", "صنف فحص آلي", "صنف جرد موبايل", "صنف فحص حقول"];
// and the shipments they save. A dead run leaving a fake delivery in the shop's own list is worse
// than leaving a catalog row, so this is swept too — measured 2026-07-31, when it did.
const JUNK_SHIP = ["مورد فحص", "شحنة فحص آلي", "شحنة فحص موبايل"];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE}/manager.html`, { waitUntil: "load" });
await page.waitForTimeout(4000);

const found = await page.evaluate(async ({ junk, junkShip }) => {
  const db = await import("./db.js");
  const all = await db.listAllProducts();
  const ships = await db.listShipments();            // no month: every one of them
  return {
    total: all.length,
    ships: ships.length,
    junk: all.filter((p) => junk.some((j) => (p.name || "").startsWith(j)))
      .map((p) => ({ barcode: p.barcode, name: p.name })),
    junkShips: ships.filter((s) => junkShip.some((j) => (s.name || "").startsWith(j)))
      .map((s) => ({ id: s._id, name: s.name })),
  };
}, { junk: JUNK, junkShip: JUNK_SHIP });

log(`catalog: ${found.total} products · left behind: ${found.junk.length}`);
found.junk.forEach((p) => log(" -", p.barcode, p.name));
log(`shipments: ${found.ships} · left behind: ${found.junkShips.length}`);
found.junkShips.forEach((s) => log(" -", s.id, s.name));

const total = found.junk.length + found.junkShips.length;
if (DELETE && total) {
  const gone = await page.evaluate(async ({ codes, ids }) => {
    const db = await import("./db.js");
    for (const c of codes) await db.deleteProduct(c);
    for (const i of ids) await db.deleteShipment(i);
    return codes.length + ids.length;
  }, { codes: found.junk.map((p) => p.barcode), ids: found.junkShips.map((s) => s.id) });
  await page.waitForTimeout(4000);
  log("deleted:", gone);
} else if (total) {
  log("nothing deleted — re-run with DELETE=1");
}

await browser.close();
