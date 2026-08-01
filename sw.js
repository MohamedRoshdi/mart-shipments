// bump CACHE version on every deploy - cache-first serving keeps old assets until the name changes
// bump version.js in the same edit — a footer that lags the cache is worse than no footer
const CACHE = "mart-v74";
const ASSETS = ["./", "index.html", "style.css", "app.js", "db.js", "auth.js", "expiry.js", "label.js", "erp.js", "brand.js", "fresh.js", "firebase-config.js",
  "manager.html", "manager.js", "products-template.csv", "stock-template.csv", "suppliers-template.csv",
  "admin.html", "admin.js", "zip.js", "sheet.js", "version.js", "files.js",
  "manifest.json", "vendor/html5-qrcode.min.js", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  // cache: "reload" is what makes bumping CACHE actually mean something. addAll() fetches through
  // the browser's HTTP cache, and GitHub Pages serves these files with a max-age, so a plain
  // addAll copies the file the browser already has into the new cache under the new name.
  // Measured 2026-07-31 in Chrome: cache mart-v34 held a style.css 262 bytes shorter than the
  // one on the server, and the phone showed the previous design with the new cache name.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" })))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // firebase-config.js is network-first: a phone that cached the empty placeholder must pick up the real config
  if (url.pathname.endsWith("firebase-config.js")) {
    e.respondWith(
      fetch(e.request).then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
