const CACHE = "happyroad-v164";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=43",
  "./app-main.js?v=146",
  "./app-events.js?v=22",
  "./app-actions.js?v=4",
  "./commute-controller.js?v=41",
  "./commute-view.js?v=8",
  "./detail-view.js?v=44",
  "./filter-data.js?v=37",
  "./filter-logic.js?v=12",
  "./map-view.js?v=58",
  "./school-data.js?v=2",
  "./request-gate.js?v=1",
  "./route-view.js?v=4",
  "./commute-routing.js?v=34",
  "./korea-boundary.js?v=3",
  "./search-view.js?v=10",
  "./ui-utils.js?v=10",
  "./manifest.webmanifest",
  "./icons/app-icon.png",
  "./vendor/leaflet.css",
  "./vendor/leaflet.js",
  "./vendor/lucide.js",
  "./data/shuttle-data.js",
  "./data/shuttle-time-estimates.js"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then(async response => {
      if (response.ok && response.headers.get("content-type")?.includes("text/html")) {
        const cache = await caches.open(CACHE);
        await cache.put("./index.html", response.clone());
      }
      return response;
    }).catch(() => caches.match("./index.html")));
    return;
  }
  const url = new URL(event.request.url);
  const freshData = url.pathname.endsWith("/prices.json") || url.pathname.endsWith("/apartments.json") || url.pathname.endsWith("/schools.json");
  if (freshData) {
    event.respondWith(fetch(event.request).then(async response => {
      if (!response.ok) throw new Error(`Data request failed: ${response.status}`);
      const cache = await caches.open(CACHE);
      await cache.put(event.request, response.clone());
      return response;
    }).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(async response => {
    if (url.origin === self.location.origin && response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(event.request, response.clone());
    }
    return response;
  })));
});
