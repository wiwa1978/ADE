const CACHE_NAME = "ade-pwa-v1"
const STATIC_SHELL = ["/manifest.webmanifest", "/icon.svg"]

const OFFLINE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>ADE — Host Offline</title>
<style>
  body { margin: 0; min-height: 100dvh; display: flex; align-items: center; justify-content: center; background: #121110; color: #f5f3ef; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px; }
  .card { max-width: 360px; width: 100%; background: #1b1a18; border: 1px solid #2e2c29; border-radius: 16px; padding: 24px 20px; text-align: center; }
  h1 { margin: 0 0 8px; font-size: 19px; }
  p { margin: 0 0 18px; color: #a7a29b; font-size: 14px; }
  button { width: 100%; height: 44px; border: 0; border-radius: 10px; background: #e07a5f; color: #121110; font-weight: 600; font-size: 15px; cursor: pointer; }
</style>
</head>
<body>
  <div class="card">
    <h1>ADE host is offline</h1>
    <p>Your computer may be asleep or disconnected from the network. Wake ADE on your computer and tap Retry.</p>
    <button onclick="location.reload()">Retry connection</button>
  </div>
</body>
</html>`

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== "GET" || url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/api/") || url.pathname === "/pair") return

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => new Response(OFFLINE_HTML, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } })),
    )
    return
  }

  if (STATIC_SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req)),
    )
  }
})
