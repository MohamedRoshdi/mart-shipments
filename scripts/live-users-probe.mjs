// Read-only look at the live settings doc: who is in the users list right now, and how long a
// save actually takes. Writes nothing unless CLEAN=1, and then only to remove a «فحص موبايل»
// row a crashed live-mobile run left behind.
// node scripts/live-users-probe.mjs        |  CLEAN=1 node scripts/live-users-probe.mjs
import { chromium, devices } from "@playwright/test";

const BASE = process.env.BASE || "https://mohamedroshdi.github.io/mart-shipments";
const log = (...a) => console.log("[users]", ...a);

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["Pixel 5"], locale: "ar-EG" });
const adm = await ctx.newPage();
adm.on("pageerror", (e) => console.log("[pageerror]", e.message));
adm.on("console", (m) => (m.type() === "error" ? console.log("[console]", m.text()) : null));
adm.on("dialog", (d) => d.dismiss());

await adm.goto(BASE + "/admin.html", { waitUntil: "load" });
await adm.fill("#pin-input", "7007");
await adm.click("#btn-pin");
await adm.waitForSelector("#screen-admin:not([hidden])", { timeout: 20000 });
await adm.waitForTimeout(4000);

const users = await adm.evaluate(() => (window.APP_CONFIG.users || [])
  .map((u) => ({ name: u.name, pin: u.pin, branches: u.branches, perms: u.perms })));
log("users on production:", JSON.stringify(users, null, 1));

const temp = users.findIndex((u) => u.name === "فحص موبايل");
log("leftover temp user:", temp >= 0 ? `yes, at index ${temp}` : "none");

// TIME=1 presses save without changing anything: the doc is rewritten with the same values,
// which is harmless and is the only honest way to measure how long an ack takes right now
if (process.env.TIME === "1") {
  const t0 = Date.now();
  await adm.click("#btn-save-config");
  await adm.waitForFunction(() => document.getElementById("toast").textContent.length > 0, null, { timeout: 90000 })
    .catch(() => log("no toast within 90s — the write never got its server ack"));
  log("idempotent save ack ms:", Date.now() - t0, "| toast:", await adm.locator("#toast").innerText());
}

if (process.env.CLEAN === "1" && temp >= 0) {
  await adm.click(`button[data-deluser="${temp}"]`);
  const t0 = Date.now();
  await adm.click("#btn-save-config");
  await adm.waitForFunction(() => document.getElementById("toast").textContent.length > 0, null, { timeout: 60000 })
    .catch(() => log("no toast within 60s — the save is still waiting on the server"));
  log("save took ms:", Date.now() - t0, "| toast:", await adm.locator("#toast").innerText());
  await adm.reload();
  await adm.waitForTimeout(5000);
  const after = await adm.evaluate(() => (window.APP_CONFIG.users || []).map((u) => u.name));
  log("users after cleanup:", JSON.stringify(after));
}

await browser.close();
