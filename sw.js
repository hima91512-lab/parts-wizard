// Parts Wizard service worker: app shell offline, data always fresh when online
const V = "pw-v1";
const SHELL = ["./", "index.html", "app.js", "manifest.json", "lib/react.production.min.js", "lib/react-dom.production.min.js",
  "lib/lucide-react.min.js", "lib/zxing.min.js", "lib/jsQR.js", "lib/tesseract.min.js", "icons/icon-192.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  const fresh = /\/(data\/|app\.js$|index\.html$|$)/.test(u.pathname);
  if (fresh) {   // network first: new parts and app updates show up right away
    e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
  } else {       // cache first for heavy libraries
    e.respondWith(caches.match(e.request).then(m => m || fetch(e.request).then(r => { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); return r; })));
  }
});
