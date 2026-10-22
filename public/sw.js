// Lightkone's service worker: lets the installed app open without a network.
// It sits at the site's root, so it serves the landing page and the docs as
// well as the app under app/. Everything is fetched fresh when online and falls
// back to the last copy offline, except built files (named by content), which
// are served from cache. Storage, APIs and other sites are left alone: the app
// keeps its own offline copy of the library and recent PDFs (src/core/offline.ts).

const CACHE = "lightkone-app-v4";
const SHARED = "lightkone-shared"; // read by src/core/capture.ts
const APP = new URL("./app/", self.location.href).href;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./app/", "./manifest.webmanifest", "./icon.svg"])));
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

// Sharing to the installed app (a link, PDF files or saved pages) posts a form to app/. A
// static site can't take a POST, so it is answered here: files wait in a cache
// and the app opens with the shared text in its address, as a GET share would.
async function receiveShare(req) {
  const form = await req.formData();
  const next = new URL(APP);
  const files = form.getAll("pdf").filter((f) => typeof f !== "string" && f.size);
  // With files, the text that comes along is usually just their name: the files say more.
  if (!files.length) for (const k of ["title", "text", "url"]) if (form.get(k)) next.searchParams.set(k, String(form.get(k)));
  if (files.length) {
    const cache = await caches.open(SHARED);
    const stamp = Date.now();
    await Promise.all(
      files.map((f, i) =>
        cache.put(new Request(`${APP}__shared/${stamp}-${i}`), new Response(f, { headers: { "content-type": f.type || "application/pdf", "x-name": encodeURIComponent(f.name || "shared.pdf") } })),
      ),
    );
    next.searchParams.set("shared-files", String(files.length));
  }
  return Response.redirect(next.href, 303);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === "POST" && url.origin + url.pathname === APP) {
    e.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/api/") || url.pathname.includes("/__offline/")) return;

  // Opening the app: shared links arrive as app/?url=..., so it is cached under app/ whatever its query.
  if (req.mode === "navigate" && (url.origin + url.pathname === APP || url.origin + url.pathname === APP + "index.html")) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(APP, copy));
          }
          return res;
        })
        .catch(() => caches.match(APP)),
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
  // Built files never change under the same name; anything else (the landing page, the docs) is fetched fresh when possible.
  e.respondWith(
    url.pathname.includes("/assets/")
      ? caches.match(req).then((hit) => hit || fetch(req).then(save))
      : fetch(req)
          .then(save)
          .catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate" })),
  );
});
