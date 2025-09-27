/* sw.js */
const VERSION = 'v7'; // bump on any deploy
const CACHE_NAME = `saladin-pharma-${VERSION}`;
const BASE = self.location.pathname.replace(/\/sw\.js$/, '/'); // e.g. /saladin-pharma/
const ASSETS = [
  `${BASE}`,
  `${BASE}index.html`,
  `${BASE}manifest.json`,
  // CDNs used by index.html
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/dexie@3.2.4/dist/dexie.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // clean old caches
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('saladin-pharma-') && k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
    // notify ready
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    clients.forEach(c => c.postMessage({ type: 'SW_READY', payload: { persistent: true, version: VERSION } }));
  })());
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  const { type } = event.data;
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    throw new Error('offline-no-cache');
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  const cache = await caches.open(CACHE_NAME);
  cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // only handle GET
  if (request.method !== 'GET') return;

  // Same-origin navigations: network-first with offline fallback to cached index.html
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(request);
        // update index cache
        const cache = await caches.open(CACHE_NAME);
        cache.put(`${BASE}index.html`, res.clone());
        return res;
      } catch {
        const cachedIndex = await caches.match(`${BASE}index.html`);
        if (cachedIndex) return cachedIndex;
        return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  // Firebase/CDN assets: cache-first
  if (ASSETS.includes(request.url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Same-origin static files: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // External: network-first with cache fallback
  event.respondWith(networkFirst(request).catch(async () => {
    const cached = await caches.match(request);
    return cached || new Response('', { status: 504 });
  }));
});
