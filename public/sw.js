// Lightkone's service worker: lets the installed app open without a network.
// Everything is fetched fresh when online and falls back to the last copy
// offline, except built files (named by content), which are served from cache.
// Storage, APIs and other sites are left alone: the app keeps its own offline
// copy of the library and recent PDFs (src/core/offline.ts).

const CACHE = "lightkone-app-v2";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./manifest.webmanifest", "./icon.svg"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("lightkone-app-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/api/") || url.pathname.includes("/__offline/")) return;

  // The documentation pages (docs/) are ordinary pages, cached under their own address below.
  if (req.mode === "navigate" && !url.pathname.includes("/docs/")) {
    // Shared links arrive as ./?url=..., so the page is cached under "./" whatever its query.
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("./", copy));
          }
          return res;
        })
        .catch(() => caches.match("./")),
    );
    return;
  }

  const save = (res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  };
  // Built files never change under the same name; anything else is fetched fresh when possible.
  e.respondWith(
    url.pathname.includes("/assets/")
      ? caches.match(req).then((hit) => hit || fetch(req).then(save))
      : fetch(req)
          .then(save)
          .catch(() => caches.match(req)),
  );
});
