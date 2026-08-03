// Do the SERVER's rules actually accept the keys the app writes — products.price, products.factor,
// shipments.supplierCode and the «تم تحميلها» pair (loadedBy/loadedAt)? Compiling and releasing a
// rules file proves neither: a write that the rules reject still looks fine on the phone, because
// the local cache applies it and the rejection only ever lands in the console.
//
// So: write one product and one shipment carrying all of them through the real SDK, mark the
// shipment loaded, then read it all back in a SECOND, empty browser context — no cache to lie to
// us — and delete both.
// STAMP=$RANDOM node scripts/live-newfields.mjs
import { chromium } from "./live-browser.mjs";   // blocks service workers: a fresh profile's SW install reloads the page mid-run

const BASE = process.env.BASE || "https://mohamedroshdi.github.io/mart-shipments";
const STAMP = process.env.STAMP || String(Date.now()).slice(-6);
const BARCODE = `9999${STAMP}`.slice(0, 13);
const NAME = `صنف فحص حقول ${STAMP}`;
const log = (...a) => console.log("[fields]", ...a);

const browser = await chromium.launch();

// --- write, and listen for a rules rejection while we do it ---
const w = await browser.newContext();
const page = await w.newPage();
/* Two failures that look identical on screen and mean opposite things. A rules rejection means
   the key is wrong and the code has to change; an exhausted quota means the write is sitting in a
   backoff and NOTHING has been proved either way. Lumping them together is how a check script
   reports "REJECTED BY RULES" for a run that never tested the rules at all. */
const denied = [], starved = [];
page.on("console", (m) => {
  const t = m.text();
  if (/resource-exhausted|Quota exceeded|maximum backoff/i.test(t)) starved.push(t);
  else if (/permission|insufficient|PERMISSION_DENIED/i.test(t)) denied.push(t);
});
await page.goto(`${BASE}/manager.html`, { waitUntil: "load" });
await page.waitForTimeout(4000);              // let the SDK connect before anything is written

const written = await page.evaluate(async ({ barcode, name }) => {
  const db = await import("./db.js");
  await db.saveProductName(barcode, name, { unit: "كرتونة", unitCode: 4, price: 45.95, factor: 12 });
  await db.saveShipment({
    name: `مورد فحص ${name}`, createdBy: "فحص آلي", branch: "فرع قويسنا",
    type: "إذن استلام", supplierCode: "9042",
    items: [{ barcode, name, qty: 1 }],
  });
  return true;
}, { barcode: BARCODE, name: NAME });
log("write issued:", written, "| barcode:", BARCODE);
await page.waitForTimeout(8000);              // both writes are fire-and-forget by design

// «تم تحميلها» is an update on a doc that has to exist first, so it is a second step
const marked = await page.evaluate(async ({ name }) => {
  const db = await import("./db.js");
  const ship = (await db.listShipments()).find((s) => s.name === `مورد فحص ${name}`);
  if (!ship) return false;
  await db.markLoaded(ship._id, "فحص آلي", Date.now());
  return true;
}, { name: NAME });
log("marked loaded:", marked);
await page.waitForTimeout(4000);
if (denied.length) log("REJECTED BY RULES:", denied.slice(0, 3));
if (starved.length) log("WRITE QUOTA EXHAUSTED — this run proves nothing:", starved.slice(0, 2));

// --- read back from a context that has never seen this data ---
const r = await browser.newContext();
const fresh = await r.newPage();
await fresh.goto(`${BASE}/manager.html`, { waitUntil: "load" });
await fresh.waitForTimeout(4000);
const server = await fresh.evaluate(async ({ barcode, name }) => {
  const db = await import("./db.js");
  const product = await db.getProduct(barcode);
  const ships = await db.listShipments();
  const ship = ships.find((s) => s.name === `مورد فحص ${name}`);
  return {
    price: product && product.price,
    unit: product && product.unit,
    unitCode: product && product.unitCode,
    factor: product && product.factor,
    supplierCode: ship && ship.supplierCode,
    loadedBy: ship && ship.loadedBy,
    loadedAt: ship && ship.loadedAt,
    shipId: ship && ship._id,
  };
}, { barcode: BARCODE, name: NAME });

const ok = server.price === 45.95 && server.unit === "كرتونة" && server.unitCode === 4
  && server.factor === 12
  && server.supplierCode === "9042" && server.loadedBy === "فحص آلي" && server.loadedAt > 0;
log("server holds:", JSON.stringify(server));
log(ok ? "OK — price, unitCode, factor, supplierCode and «تم تحميلها» all reached the server"
  // a starved run failed to test anything; saying FAIL would read as "the rules reject this"
  : starved.length ? "INCONCLUSIVE — the quota was exhausted, nothing was proved. Re-run after the reset."
    : "FAIL — a key never reached the server");

// --- clean up whatever landed ---
await fresh.evaluate(async ({ barcode, shipId }) => {
  const db = await import("./db.js");
  await db.deleteProduct(barcode);
  if (shipId) await db.deleteShipment(shipId);
}, { barcode: BARCODE, shipId: server.shipId });
await fresh.waitForTimeout(4000);
log("cleaned up:", BARCODE, server.shipId || "(no shipment)");

await browser.close();
process.exit(ok ? 0 : 1);
