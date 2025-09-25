// sw.js - Perfect Service Worker for Saladin Pharma
const CACHE_NAME = 'saladin-pharma-v1.0';
const DATA_CACHE_NAME = 'saladin-pharma-data-v1.0';

// Exact assets from your HTML
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  // Tailwind CSS
  'https://cdn.tailwindcss.com',
  // Dexie (your exact version)
  'https://unpkg.com/dexie@3.2.4/dist/dexie.min.js',
  // Chart.js
  'https://cdn.jsdelivr.net/npm/chart.js',
  // jsPDF (your exact version)
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  // Inter font (from your CSS)
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap',
  'https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff2',
  // Your app icons (base64 encoded)
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI3MiIgaGVpZ2h0PSI3MiIgdmlld0JveD0iMCAwIDcyIDcyIj48Y2lyY2xlIGN4PSIzNiIgY3k9IjM2IiByPSIzNCIgZmlsbD0iIzdDN0ZGRiIvPjx0ZXh0IHg9IjM2IiB5PSI0NCIgZm9udC1zaXplPSIzNiIgZmlsbD0iIzVENUNERSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LXdlaWdodD0iYm9sZCI+UzwvdGV4dD48L3N2Zz4='
];

// Firebase specific URLs (from your HTML)
const FIREBASE_URLS = [
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js',
  'https://abdo-pharma-default-rtdb.firebaseio.com'
];

// Install Event - Cache static assets
self.addEventListener('install', event => {
  console.log('[SW] Installing service worker...');
  
  event.waitUntil(
    Promise.all([
      // Cache static assets
      caches.open(CACHE_NAME).then(cache => {
        console.log('[SW] Caching static assets...');
        return cache.addAll(STATIC_ASSETS.map(url => {
          return new Request(url, {
            mode: url.startsWith('http') ? 'cors' : 'same-origin',
            credentials: 'omit'
          });
        }));
      }),
      // Pre-cache Firebase assets
      caches.open(DATA_CACHE_NAME).then(cache => {
        console.log('[SW] Pre-caching Firebase assets...');
        return cache.addAll(FIREBASE_URLS.slice(0, 2).map(url => {
          return new Request(url, { mode: 'cors', credentials: 'omit' });
        }));
      })
    ])
    .then(() => {
      console.log('[SW] Installation complete, skipping waiting...');
      return self.skipWaiting();
    })
    .catch(error => {
      console.error('[SW] Installation failed:', error);
    })
  );
});

// Activate Event - Clean up old caches
self.addEventListener('activate', event => {
  console.log('[SW] Activating service worker...');
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME && cacheName !== DATA_CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => {
      console.log('[SW] Activation complete, claiming clients...');
      return self.clients.claim();
    })
  );
});

// Fetch Event - Implement offline-first strategy
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') return;
  
  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith('http')) return;

  // Firebase Realtime Database - Network first with fallback
  if (url.hostname.includes('firebaseio.com') || url.pathname.includes('firebase')) {
    event.respondWith(handleFirebaseRequest(request));
    return;
  }

  // Firebase SDK files - Cache first
  if (url.hostname.includes('gstatic.com') && url.pathname.includes('firebasejs')) {
    event.respondWith(handleFirebaseSDK(request));
    return;
  }

  // CDN assets (Tailwind, Chart.js, etc.) - Cache first with network fallback
  if (isCDNAsset(url)) {
    event.respondWith(handleCDNAsset(request));
    return;
  }

  // App shell (HTML, CSS, JS) - Cache first
  if (isAppShell(request)) {
    event.respondWith(handleAppShell(request));
    return;
  }

  // Everything else - Network first
  event.respondWith(handleDefault(request));
});

// Handle Firebase Realtime Database requests
async function handleFirebaseRequest(request) {
  const url = new URL(request.url);
  
  try {
    console.log('[SW] Firebase request:', url.pathname);
    
    // Always try network first for real-time data
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      // Cache successful responses for offline fallback
      const cache = await caches.open(DATA_CACHE_NAME);
      const responseClone = networkResponse.clone();
      
      // Only cache GET requests for Firebase data
      if (request.method === 'GET') {
        await cache.put(request, responseClone);
      }
      
      console.log('[SW] Firebase response cached');
      return networkResponse;
    }
    
    throw new Error(`Network response not ok: ${networkResponse.status}`);
    
  } catch (error) {
    console.log('[SW] Firebase network failed, trying cache...', error.message);
    
    // Try to get from cache
    const cache = await caches.open(DATA_CACHE_NAME);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      console.log('[SW] Serving Firebase data from cache');
      return cachedResponse;
    }
    
    // Return offline indicator for your app to handle
    console.log('[SW] No cached Firebase data, returning offline response');
    return new Response(JSON.stringify({
      offline: true,
      timestamp: Date.now(),
      error: 'No network connection and no cached data available'
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'X-SW-Offline': 'true'
      }
    });
  }
}

// Handle Firebase SDK files
async function handleFirebaseSDK(request) {
  const cache = await caches.open(DATA_CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    console.log('[SW] Serving Firebase SDK from cache');
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
      console.log('[SW] Firebase SDK cached');
    }
    return networkResponse;
  } catch (error) {
    console.error('[SW] Failed to fetch Firebase SDK:', error);
    throw error;
  }
}

// Handle CDN assets (Tailwind, Chart.js, etc.)
async function handleCDNAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    console.log('[SW] Serving CDN asset from cache:', request.url);
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
      console.log('[SW] CDN asset cached:', request.url);
    }
    return networkResponse;
  } catch (error) {
    console.error('[SW] Failed to fetch CDN asset:', request.url, error);
    
    // Return a minimal fallback for CSS/JS
    if (request.url.includes('tailwindcss')) {
      return new Response('/* Tailwind CSS offline fallback */', {
        headers: { 'Content-Type': 'text/css' }
      });
    }
    
    throw error;
  }
}

// Handle app shell (your HTML file)
async function handleAppShell(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    console.log('[SW] Serving app shell from cache');
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.error('[SW] App shell network failed:', error);
    
    // Try to serve the cached index.html as fallback
    const indexResponse = await cache.match('./index.html');
    if (indexResponse) {
      return indexResponse;
    }
    
    // Ultimate fallback
    return new Response(`
      <!DOCTYPE html>
      <html><head><title>Saladin Pharma - Offline</title></head>
      <body style="font-family:Inter,Arial,sans-serif;text-align:center;padding:50px;background:#f9fafb;">
        <h1 style="color:#5D5CDE;">🔌 Saladin Pharma</h1>
        <p>You're offline and the app couldn't load from cache.</p>
        <p>Please check your connection and try again.</p>
        <button onclick="location.reload()" style="background:#5D5CDE;color:white;padding:10px 20px;border:none;border-radius:5px;cursor:pointer;">Retry</button>
      </body></html>
    `, {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

// Handle everything else with network first
async function handleDefault(request) {
  try {
    return await fetch(request);
  } catch (error) {
    console.log('[SW] Network failed for:', request.url);
    
    // Try cache as fallback
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    throw error;
  }
}

// Background Sync - Handle your pharmacy data sync
self.addEventListener('sync', event => {
  console.log('[SW] Background sync event:', event.tag);
  
  if (event.tag === 'pharmacy-data-sync') {
    event.waitUntil(handlePharmacySync());
  }
});

async function handlePharmacySync() {
  console.log('[SW] Handling pharmacy background sync...');
  
  try {
    // Notify all clients that background sync started
    const clients = await self.clients.matchAll();
    
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_BACKGROUND',
        payload: { status: 'started', timestamp: Date.now() }
      });
    });
    
    // The actual sync is handled by your main app
    // We just trigger it and wait a bit
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Notify completion
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_BACKGROUND',
        payload: { success: true, timestamp: Date.now() }
      });
    });
    
    console.log('[SW] Background sync completed');
    
  } catch (error) {
    console.error('[SW] Background sync failed:', error);
    
    // Notify failure
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_BACKGROUND',
        payload: { success: false, error: error.message, timestamp: Date.now() }
      });
    });
  }
}

// Handle messages from your main app
self.addEventListener('message', event => {
  console.log('[SW] Received message:', event.data);
  
  const { type, data } = event.data || {};
  
  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'CACHE_URLS':
      // Cache additional URLs requested by your app
      handleCacheUrls(data.urls, event);
      break;
      
    case 'CLEAR_CACHE':
      // Clear cache when requested
      handleClearCache(event);
      break;
      
    default:
      console.log('[SW] Unknown message type:', type);
  }
});

// Helper functions
function isCDNAsset(url) {
  const cdnHosts = [
    'cdn.tailwindcss.com',
    'unpkg.com',
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
  ];
  
  return cdnHosts.some(host => url.hostname.includes(host));
}

function isAppShell(request) {
  const url = new URL(request.url);
  return request.destination === 'document' || 
         url.pathname === '/' || 
         url.pathname.includes('.html');
}

async function handleCacheUrls(urls, event) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(urls);
    
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ success: true });
    }
  } catch (error) {
    console.error('[SW] Failed to cache URLs:', error);
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ success: false, error: error.message });
    }
  }
}

async function handleClearCache(event) {
  try {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map(name => caches.delete(name)));
    
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ success: true });
    }
  } catch (error) {
    console.error('[SW] Failed to clear cache:', error);
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ success: false, error: error.message });
    }
  }
}

// Push notifications (for future pharmacy alerts)
self.addEventListener('push', event => {
  console.log('[SW] Push notification received');
  
  if (event.data) {
    const data = event.data.json();
    
    const options = {
      body: data.body || 'New pharmacy notification',
      icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI5NiIgaGVpZ2h0PSI5NiIgdmlld0JveD0iMCAwIDk2IDk2Ij48Y2lyY2xlIGN4PSI0OCIgY3k9IjQ4IiByPSI0NCIgZmlsbD0iIzdDN0ZGRiIvPjx0ZXh0IHg9IjQ4IiB5PSI1OCIgZm9udC1zaXplPSI0OCIgZmlsbD0iIzVENUNERSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LXdlaWdodD0iYm9sZCI+UzwvdGV4dD48L3N2Zz4=',
      badge: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI3MiIgaGVpZ2h0PSI3MiIgdmlld0JveD0iMCAwIDcyIDcyIj48Y2lyY2xlIGN4PSIzNiIgY3k9IjM2IiByPSIzNCIgZmlsbD0iIzdDN0ZGRiIvPjx0ZXh0IHg9IjM2IiB5PSI0NCIgZm9udC1zaXplPSIzNiIgZmlsbD0iIzVENUNERSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LXdlaWdodD0iYm9sZCI+UzwvdGV4dD48L3N2Zz4=',
      data: data,
      tag: 'pharmacy-notification',
      renotify: true
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title || 'Saladin Pharma', options)
    );
  }
});

// Notification click handler
self.addEventListener('notificationclick', event => {
  console.log('[SW] Notification clicked:', event.notification.data);
  
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow('/')
  );
});

console.log('[SW] Service Worker loaded successfully for Saladin Pharma');
