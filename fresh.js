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
  }).catch(console.error);

  const born = Date.now();
  let done = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (done) return;                 // one reaction per page life, or a bad worker loops forever
    done = true;
    /* Freshly opened, or parked in the background: swap silently — the person never sees the
       old version at all. Mid-work a reload would eat an unfinished count (a count has no
       draft), so there it only says the update is waiting. */
    if (Date.now() - born < 20000 || document.hidden) location.reload();
    else toast("فيه تحديث جديد — اقفل الشاشة وافتحها تاني وهيتفعّل لوحده");
  });
}
