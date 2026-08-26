const CACHE = "happyroad-v62";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=16",
  "./app-main.js?v=54",
  "./app-events.js?v=14",
  "./detail-view.js?v=18",
  "./filter-data.js?v=21",
  "./filter-logic.js?v=7",
  "./map-view.js?v=30",
  "./search-view.js?v=10",
  "./ui-utils.js?v=10",
  "./manifest.webmanifest",
  "./icons/app-icon.png",
  "./vendor/leaflet.css",
  "./vendor/leaflet.js",
  "./vendor/lucide.js",
  "./data/shuttle-data.js"
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
  const freshData = url.pathname.endsWith("/prices.json") || url.pathname.endsWith("/apartments.json");
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
