// App-shell cache only. API responses are never cached.
const CACHE = "sr-shell-v3";
const SHELL = ["/manifest.webmanifest", "/icon.svg", "/icon-maskable.svg", "/favicon-32.png", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/") || url.pathname === "/") return;
  if (!url.pathname.startsWith("/assets/") && !SHELL.includes(url.pathname)) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    })),
  );
});
