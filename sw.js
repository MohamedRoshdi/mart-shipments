const CACHE = "mart-v1";
const ASSETS = ["./", "index.html", "style.css", "app.js", "db.js", "firebase-config.js",
  "manifest.json", "vendor/html5-qrcode.min.js", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
