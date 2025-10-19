// Saladin Pharma - Service Worker
// Professional Pharmacy Management PWA
// Version 3.0.0

const CACHE_VERSION = 'saladin-pharma-v3.0.0';
const CACHE_STATIC = `${CACHE_VERSION}-static`;
const CACHE_DYNAMIC = `${CACHE_VERSION}-dynamic`;
const CACHE_CDN = `${CACHE_VERSION}-cdn`;

// Static assets to cache immediately
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// CDN resources (from CSP whitelist)
const CDN_RESOURCES = [
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/dexie@3.2.4/dist/dexie.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap'
];

// Firebase resources (don't cache, always fetch fresh)
const FIREBASE_HOSTS = [
  'firebaseapp.com',
  'googleapis.com',
  'gstatic.com',
  'firebaseio.com',
  'firestore.googleapis.com'
];

// Maximum cache sizes
const MAX_DYNAMIC_CACHE_SIZE = 50;
const MAX_CDN_CACHE_SIZE = 30;

// =====================================================
// INSTALLATION
// =====================================================
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');

  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then((cache) => {
        console.log('[SW] Caching static assets...');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] Static assets cached successfully');
        return self.skipWaiting(); // Activate immediately
      })
      .catch((error) => {
        console.error('[SW] Failed to cache static assets:', error);
      })
  );
});

// =====================================================
// ACTIVATION
// =====================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            // Delete old caches
            if (cacheName.startsWith('saladin-pharma-') &&
                cacheName !== CACHE_STATIC &&
                cacheName !== CACHE_DYNAMIC &&
                cacheName !== CACHE_CDN) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[SW] Service worker activated');
        return self.clients.claim(); // Take control immediately
      })
  );
});

// =====================================================
// FETCH HANDLER
// =====================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip Firebase and Firestore requests (always fetch fresh)
  if (FIREBASE_HOSTS.some(host => url.hostname.includes(host))) {
    return;
  }

  // Skip chrome-extension and other special schemes
  if (!url.protocol.startsWith('http')) {
    return;
  }

  event.respondWith(
    handleFetchRequest(request, url)
  );
});

// =====================================================
// FETCH STRATEGIES
// =====================================================
async function handleFetchRequest(request, url) {
  // Strategy 1: Cache First for static assets
  if (STATIC_ASSETS.some(asset => url.pathname === asset)) {
    return cacheFirst(request, CACHE_STATIC);
  }

  // Strategy 2: Stale While Revalidate for CDN resources
  if (CDN_RESOURCES.some(cdn => request.url.includes(cdn)) ||
      url.hostname.includes('cdn') ||
      url.hostname.includes('unpkg') ||
      url.hostname.includes('jsdelivr')) {
    return staleWhileRevalidate(request, CACHE_CDN);
  }

  // Strategy 3: Network First with cache fallback for app HTML
  if (request.headers.get('accept')?.includes('text/html')) {
    return networkFirst(request, CACHE_DYNAMIC);
  }

  // Strategy 4: Network First for everything else
  return networkFirst(request, CACHE_DYNAMIC);
}

// Cache First Strategy
async function cacheFirst(request, cacheName) {
  try {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
      console.log('[SW] Cache hit:', request.url);
      return cachedResponse;
    }

    console.log('[SW] Cache miss, fetching:', request.url);
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    console.error('[SW] Cache first failed:', error);
    return new Response('Offline - Resource not available', {
      status: 503,
      statusText: 'Service Unavailable'
    });
  }
}

// Network First Strategy
async function networkFirst(request, cacheName) {
  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());

      // Limit cache size
      limitCacheSize(cacheName, MAX_DYNAMIC_CACHE_SIZE);
    }

    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);

    const cachedResponse = await caches.match(request);

    if (cachedResponse) {
      return cachedResponse;
    }

    // Return offline fallback for HTML requests
    if (request.headers.get('accept')?.includes('text/html')) {
      const cache = await caches.open(CACHE_STATIC);
      const fallback = await cache.match('/');
      if (fallback) return fallback;
    }

    return new Response('Offline - No cached version available', {
      status: 503,
      statusText: 'Service Unavailable'
    });
  }
}

// Stale While Revalidate Strategy
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  // Fetch in background and update cache
  const fetchPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
        limitCacheSize(cacheName, MAX_CDN_CACHE_SIZE);
      }
      return networkResponse;
    })
    .catch((error) => {
      console.log('[SW] Background fetch failed:', error);
      return null;
    });

  // Return cached version immediately if available
  return cachedResponse || fetchPromise;
}

// =====================================================
// BACKGROUND SYNC
// =====================================================
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync triggered:', event.tag);

  if (event.tag === 'pharmacy-data-sync') {
    event.waitUntil(syncPharmacyData());
  }
});

async function syncPharmacyData() {
  try {
    console.log('[SW] Starting pharmacy data sync...');

    // Notify all clients to perform sync
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_BACKGROUND',
        payload: { success: true, timestamp: Date.now() }
      });
    });

    console.log('[SW] Pharmacy data sync completed');
  } catch (error) {
    console.error('[SW] Pharmacy data sync failed:', error);

    // Notify clients of failure
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_BACKGROUND',
        payload: { success: false, error: error.message }
      });
    });
  }
}

// =====================================================
// PUSH NOTIFICATIONS (Future Enhancement)
// =====================================================
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');

  const data = event.data?.json() || {};
  const title = data.title || 'Saladin Pharma';
  const options = {
    body: data.body || 'New notification',
    icon: '/icon-192.png',
    badge: '/icon-96.png',
    vibrate: [200, 100, 200],
    data: data.data || {},
    actions: data.actions || []
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked');
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus existing window or open new one
        for (const client of clientList) {
          if (client.url === '/' && 'focus' in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow('/');
        }
      })
  );
});

// =====================================================
// MESSAGES FROM CLIENTS
// =====================================================
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(clearAllCaches());
  }

  if (event.data && event.data.type === 'CACHE_URLS') {
    event.waitUntil(cacheUrls(event.data.urls));
  }
});

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

// Limit cache size to prevent excessive storage usage
async function limitCacheSize(cacheName, maxSize) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();

    if (keys.length > maxSize) {
      // Delete oldest entries (FIFO)
      const deleteCount = keys.length - maxSize;
      const deletePromises = keys.slice(0, deleteCount).map(key => cache.delete(key));
      await Promise.all(deletePromises);
      console.log(`[SW] Trimmed cache ${cacheName}: removed ${deleteCount} entries`);
    }
  } catch (error) {
    console.error('[SW] Failed to limit cache size:', error);
  }
}

// Clear all caches
async function clearAllCaches() {
  try {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.map(cacheName => {
        console.log('[SW] Deleting cache:', cacheName);
        return caches.delete(cacheName);
      })
    );
    console.log('[SW] All caches cleared');
  } catch (error) {
    console.error('[SW] Failed to clear caches:', error);
  }
}

// Cache specific URLs
async function cacheUrls(urls) {
  try {
    const cache = await caches.open(CACHE_DYNAMIC);
    await cache.addAll(urls);
    console.log('[SW] URLs cached:', urls);
  } catch (error) {
    console.error('[SW] Failed to cache URLs:', error);
  }
}

// =====================================================
// PERIODIC BACKGROUND SYNC (Future Enhancement)
// =====================================================
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'pharmacy-inventory-check') {
    event.waitUntil(checkInventoryExpiry());
  }
});

async function checkInventoryExpiry() {
  try {
    console.log('[SW] Checking inventory expiry dates...');

    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'CHECK_INVENTORY_EXPIRY',
        payload: { timestamp: Date.now() }
      });
    });
  } catch (error) {
    console.error('[SW] Inventory check failed:', error);
  }
}

// =====================================================
// ERROR HANDLING
// =====================================================
self.addEventListener('error', (event) => {
  console.error('[SW] Error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[SW] Unhandled promise rejection:', event.reason);
});

// =====================================================
// LOGGING
// =====================================================
console.log('[SW] Service Worker loaded - Version:', CACHE_VERSION);


