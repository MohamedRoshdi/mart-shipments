// The pre-2ad9ba2 imports stored codes with their leading zeros stripped (000045 → 45), and the
// fixed imports later wrote the catalog's own spelling beside them — so one product can sit in
// the catalog twice, and scanning «45» finds the stale doc directly (the owner caught 45/000045
// on 2026-08-02). This finds every stripped twin of a padded code and, with DELETE=1, removes
// the stripped one — the padded code is the ERP's own spelling and always wins.
//
// One full catalog read (~10k of the 50k/day allowance). Run only after the quota reset.
//
// node scripts/live-zero-dupes.mjs            # count and list, changes nothing
// DELETE=1 node scripts/live-zero-dupes.mjs   # and remove the stripped twins
import { chromium } from "./live-browser.mjs";   // blocks service workers: a fresh profile's SW install reloads the page mid-run

const BASE = process.env.BASE || "https://mohamedroshdi.github.io/mart-shipments";
const DELETE = process.env.DELETE === "1";
const log = (...a) => console.log("[zero-dupes]", ...a);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE}/manager.html`, { waitUntil: "load" });
await page.waitForTimeout(4000);

const found = await page.evaluate(async () => {
  const db = await import("./db.js");
  const all = await db.listAllProducts();
  const byId = new Map(all.map((p) => [String(p.barcode), p]));
  const dupes = [];
  for (const p of all) {
    const id = String(p.barcode);
    if (!/^0+\d/.test(id)) continue;                   // only padded codes can have a stripped twin
    const stripped = id.replace(/^0+(?=\d)/, "");
    const twin = byId.get(stripped);
    if (!twin) continue;
    dupes.push({
      keep: id, drop: stripped,
      // data sitting only on the doc about to go — reported so nothing is lost silently;
      // the next جرد import refills the padded doc anyway
      dropHadStock: !!(twin.stock && Object.keys(twin.stock).length) || Number.isFinite(twin.qty),
      names: { keep: p.name, drop: twin.name },
    });
  }
  return { total: all.length, dupes };
});

log(`catalog: ${found.total} products · stripped twins: ${found.dupes.length}`);
for (const d of found.dupes)
  log(` - keep ${d.keep} («${d.names.keep}») · drop ${d.drop}${d.dropHadStock ? " [carried stock/qty — the next جرد import refills the kept doc]" : ""}`);

if (DELETE && found.dupes.length) {
  const gone = await page.evaluate(async (codes) => {
    const db = await import("./db.js");
    for (const c of codes) await db.deleteProduct(c);
    /* Deleting here drops THIS browser's search copy and nobody else's — every real phone would
       keep serving the deleted twins (and their price-less rows) until the 7-day TTL. One stamp
       on the config doc is the cross-device invalidation the imports already use: the config
       listener carries it in seconds and every page drops its copy. Measured 2026-08-02: without
       it, the shop still saw 45 beside 000045 hours after the sweep. */
    await db.stampFile("الأصناف", { at: Date.now(), rows: 0, by: "تنظيف الأكواد" });
    return codes.length;
  }, found.dupes.map((d) => d.drop));
  await page.waitForTimeout(4000);
  log("deleted:", gone, "· stamped الأصناف so every phone drops its search copy");
} else if (found.dupes.length) {
  log("nothing deleted — re-run with DELETE=1");
}

await browser.close();
