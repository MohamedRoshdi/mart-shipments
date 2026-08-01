// التحديث بيوصل لوحده — the page's half of the service-worker update dance.
//
// sw.js already does its half: skipWaiting() on install and clients.claim() on activate, so a
// new version takes control the moment it finishes installing. What was missing is the page
// REACTING: the code that is already running keeps running until a reload, which is why a phone
// could sit on an old version for days. And a parked PWA never navigates, so the browser never
// even asked the server whether sw.js changed.
export function keepFresh(toast) {
  if (!("serviceWorker" in navigator) || new URLSearchParams(location.search).has("test")) return;

  navigator.serviceWorker.register("./sw.js").then((reg) => {
    // every return to the foreground asks the server once — that is the "check on open"
    addEventListener("visibilitychange", () => {
      if (!document.hidden) reg.update().catch(() => {});
    });
    /* The shop laptop keeps the manager page open and VISIBLE all day, so visibilitychange
       never fires there — without this line that machine hears about a deploy only on a real
       navigation, which an all-day page never makes (the owner's stale screens, 2026-08-01).
       Ten minutes matches the server's max-age=600 (measured the same day), and update()
       fetches sw.js past the HTTP cache, so a deploy reaches an open page within ~10 minutes.
       The cost is one conditional GET to GitHub Pages — no Firestore, no quota. */
    setInterval(() => reg.update().catch(() => {}), 10 * 60 * 1000);
  }).catch(console.error);

  const born = Date.now();
  let done = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (done) return;                 // one reaction per page life, or a bad worker loops forever
    done = true;
    /* Freshly opened, or parked in the background: swap silently — the person never sees the
       old version at all. Mid-work a reload would eat an unfinished count (a count has no
       draft), so the reload ARMS instead: it fires the moment the page next goes hidden —
       leaving for another app, locking the screen, minimising — which is exactly the moment
       nothing on the screen can be lost. Nobody presses anything (the owner, 2026-08-01:
       updates must land with no Ctrl+F5, no cache clearing, on every device). */
    if (Date.now() - born < 20000 || document.hidden) { location.reload(); return; }
    toast("فيه تحديث جديد — هيتفعّل لوحده أول ما تسيب الشاشة");
    addEventListener("visibilitychange", function armed() {
      if (!document.hidden) return;
      removeEventListener("visibilitychange", armed);
      location.reload();
    });
  });
}
