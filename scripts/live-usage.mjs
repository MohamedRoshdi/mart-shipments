/* Does the deployed `usage` rule actually accept what the app writes? A rules mistake here is
   silent — flushUsage is fire-and-forget, so the admin screen would just stay empty for ever.
   Costs 1 write + 1 read + 1 delete, and cleans up after itself.
   BASE matters: the default is the DEPLOYED site, so a key added this session has to be checked
   against a local server (BASE=http://localhost:8080) until the push lands. */
import { chromium } from "playwright";

const BASE = process.env.BASE || "https://mohamedroshdi.github.io/mart-shipments";
const DEVICE = `probe-${process.env.STAMP || Date.now()}`;

const browser = await chromium.launch();

async function run(fn, arg) {
  // fresh: no local cache to answer from. Service workers blocked — a first install fires
  // `controllerchange`, and fresh.js reloads the page out from under page.evaluate.
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.goto(`${BASE}/admin.html`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.APP_CONFIG);
  const out = await page.evaluate(fn, arg);
  await page.waitForTimeout(1500);                        // let a rules refusal reach the console
  await ctx.close();
  return { out, errs };
}

const write = await run(async (device) => {
  const db = await import("./db.js");
  await db.initDb();
  db.reportUsage({ device, who: "فحص آلي", branch: "فرع قويسنا" });
  await db.flushUsage(true);
  await new Promise((r) => setTimeout(r, 2000));
  return db.quotaDay();
}, DEVICE);
console.log("[usage] wrote for day", write.out);
write.errs.forEach((e) => console.log("  console:", e));

const back = await run(async (device) => {
  const db = await import("./db.js");
  await db.initDb();
  const rows = await db.listUsage();
  return rows.find((r) => r._id === device) || null;
}, DEVICE);

console.log("[usage] read back:", JSON.stringify(back.out));
back.errs.forEach((e) => console.log("  console:", e));

const denied = [...write.errs, ...back.errs].some((e) => /permission|PERMISSION_DENIED|insufficient/i.test(e));
const exhausted = [...write.errs, ...back.errs].some((e) => /resource-exhausted|Quota exceeded/i.test(e));

await run(async (device) => {
  const db = await import("./db.js");
  await db.initDb();
  await db.deleteUsage(device);
  await new Promise((r) => setTimeout(r, 1500));
}, DEVICE);
console.log("[usage] cleaned up", DEVICE);

await browser.close();

if (exhausted) { console.log("INCONCLUSIVE — the day's allowance is spent, this run proved nothing"); process.exit(2); }
if (denied) { console.log("FAIL — the rules refused the write; `usage` is not released"); process.exit(1); }
if (!back.out || back.out.who !== "فحص آلي") { console.log("FAIL — the row did not come back from the server"); process.exit(1); }
console.log("OK — the deployed rules accept the usage report and it reads back");
