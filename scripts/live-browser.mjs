/* Every live script must block service workers, and fifteen of the sixteen were not (measured
   2026-08-03, right after the mart-v93 deploy: `live-check`, `live-count` and `live-expiry` all
   timed out on a fresh profile). A fresh browser profile installs the site's service worker, the
   install fires `controllerchange`, `fresh.js` reloads the page — and the reload lands in the
   middle of whatever the script was doing, so it waits thirty seconds for a screen that went back
   to the PIN. It bites hardest in the minutes after a deploy, which is exactly when these scripts
   get run.

   Importing `chromium` from here instead of from playwright is the whole fix: every context and
   every page this browser makes blocks service workers, and no call site changes. A script that
   genuinely wants the service worker can still pass `serviceWorkers: "allow"` — the spread puts
   the caller last. */
import { chromium as real } from "playwright";

export const chromium = {
  launch: async (opts) => {
    const b = await real.launch(opts);
    const newContext = b.newContext.bind(b);
    const newPage = b.newPage.bind(b);
    b.newContext = (o = {}) => newContext({ serviceWorkers: "block", ...o });
    b.newPage = (o = {}) => newPage({ serviceWorkers: "block", ...o });
    return b;
  },
};

export { devices } from "playwright";

/* The manager's toolbox is folded away since 2026-08-03, so a script that reaches an import or an
   export button has to open it first — exactly as a person does. Safe to call anywhere: a page
   with no fold (or a user with no tool permission) leaves early. */
export async function openTools(page) {
  if (await page.locator("#btn-tools").isHidden()) return;
  if (await page.locator("#tools-list").isHidden()) await page.click("#btn-tools");
}

/* NEVER `page.on("dialog", d => d.accept())` on a page pointed at production. A header-driven
   catalog import is a REPLACE: it offers to delete every barcode the file does not carry, and a
   live script's one-row fixture does not carry 10,060 of them. `live-expiry.mjs` wrote
   «الباركود,اسم الصنف» — both recognised headings, so a real header — and accepted every dialog.
   It never reached the confirm, and the catalog was still 10,061 when it was found (2026-08-03),
   but nothing about the script prevented it.
   This accepts the ordinary confirms a script has to get past and DISMISSES anything that talks
   about removing rows, loudly. Deleting the shop's catalog is not a thing a check may do by
   accident — the wording it matches lives in `offerDeletions` in manager.js. */
/* Opening the manager page is a race, and every script had its own copy of it: the markup STARTS
   on the PIN screen (`render("screen-pin")` runs at module eval), and the boot IIFE only swaps to
   the manager screen once the settings have arrived. A script that asks «is the PIN screen up?»
   right after `load` always gets yes — then types into a box that disappears underneath it.
   Trying the PIN and not minding if it fails is the whole fix; the wait afterwards is the real
   assertion. */
export async function openManagerPage(page, base, pin = "1994", settle = 3500) {
  await page.goto(base + "/manager.html", { waitUntil: "load" });
  if (await page.locator("#screen-manager").isHidden()) {
    await page.fill("#pin-input", pin).catch(() => {});
    await page.click("#btn-pin").catch(() => {});
  }
  await page.waitForSelector("#screen-manager:not([hidden])", { timeout: 30000 });
  await page.waitForTimeout(settle);        // never networkidle: Firestore keeps a socket open
}

const DESTRUCTIVE = /هيتشال|نشيلهم|مسح كل|هيتمسح/;
export function safeDialogs(page, log = console.log) {
  page.on("dialog", (d) => {
    const msg = d.message();
    if (DESTRUCTIVE.test(msg)) {
      log("[dialog REFUSED — this would have deleted live rows]", msg.replace(/\n/g, " ").slice(0, 160));
      d.dismiss().catch(() => {});
      return;
    }
    d.accept().catch(() => {});
  });
}
