/*
 * OpsDesk technician app service worker (scope: /tech/).
 *
 * Division of labour:
 *  - This worker makes the APP load without a network (HTML shell + hashed JS/CSS).
 *  - The app itself keeps DATA available offline (TanStack Query cache in IndexedDB)
 *    and queues CHANGES (the outbox in IndexedDB). API calls are never cached here:
 *    caching authenticated JSON in a service worker is how stale or leaked data happens.
 */
const BASE = "/tech";
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const SHELL_CACHE = `opsdesk-tech-shell-${VERSION}`;
const STATIC_CACHE = "opsdesk-tech-static"; // content-hashed files: safe to keep across versions
const SHELL_URLS = [`${BASE}/`, `${BASE}/job`, `${BASE}/login`, `${BASE}/offline.html`];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Individually, so one failing URL doesn't abort the whole install.
      .then((cache) => Promise.all(SHELL_URLS.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("opsdesk-tech-shell-") && k !== SHELL_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io")) return; // data: never cached here

  if (url.pathname.startsWith(`${BASE}/_next/static/`)) {
    event.respondWith(cacheFirst(req));
  } else if (req.mode === "navigate" && url.pathname.startsWith(BASE)) {
    event.respondWith(networkFirstPage(req, url));
  } else if (url.pathname.startsWith(BASE)) {
    event.respondWith(staleWhileRevalidate(req));
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

/** Pages: fresh when online; offline, the last copy of this page, else the app home, else a notice. */
async function networkFirstPage(req, url) {
  const cache = await caches.open(SHELL_CACHE);
  const key = `${url.origin}${url.pathname}`; // ignore ?id=…: the page reads it client-side
  try {
    const res = await fetch(req);
    if (res.ok && !res.redirected) cache.put(key, res.clone());
    return res;
  } catch {
    return (
      (await cache.match(key)) ||
      (await cache.match(`${BASE}/`)) ||
      (await cache.match(`${BASE}/offline.html`)) ||
      Response.error()
    );
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit || Response.error());
  return hit || network;
}
