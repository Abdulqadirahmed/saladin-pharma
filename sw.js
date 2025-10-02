// sw.js - Persistent Offline-First Service Worker
const CACHE_NAME = 'saladin-pharma-persistent-v1.0.3';
const DYNAMIC_CACHE = 'saladin-pharma-dynamic-v1';
const CRITICAL_CACHE = 'saladin-pharma-critical-v1';

// Get the correct base path for GitHub Pages
const getBasePath = () => {
  const path = self.location.pathname;
  const segments = path.split('/').filter(Boolean);
  return segments.length > 0 ? `/${segments[0]}/` : '/';
};

const BASE_PATH = getBasePath();

// CRITICAL assets that must NEVER be evicted
const CRITICAL_ASSETS = [
  `${BASE_PATH}`,
  `${BASE_PATH}index.html`
];

// Core assets needed for offline functionality
const CORE_ASSETS = [
  `${BASE_PATH}manifest.json`,
  'https://unpkg.com/dexie@3.2.4/dist/dexie.min.js', // Essential for data storage
  'https://cdn.tailwindcss.com' // Essential for UI
];

// Extended assets (nice to have but can be refetched)
const EXTENDED_ASSETS = [
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap'
];

// Install event - Cache critical assets first
self.addEventListener('install', event => {
  console.log('SW: Installing with persistent cache strategy...');
  
  event.waitUntil(
    Promise.all([
      // Cache critical assets that MUST persist
      caches.open(CRITICAL_CACHE).then(cache => {
        console.log('SW: Caching critical assets...');
        return cache.addAll(CRITICAL_ASSETS);
      }),
      
      // Cache core assets
      caches.open(CACHE_NAME).then(cache => {
        console.log('SW: Caching core assets...');
        return cache.addAll(CORE_ASSETS);
      }),
      
      // Cache extended assets (non-blocking)
      caches.open(CACHE_NAME).then(cache => {
        console.log('SW: Caching extended assets...');
        return Promise.allSettled(
          EXTENDED_ASSETS.map(url => 
            cache.add(url).catch(err => {
              console.warn('SW: Failed to cache:', url, err);
              return null;
            })
          )
        );
      })
    ]).then(() => {
      console.log('SW: All critical assets cached successfully');
      return self.skipWaiting();
    }).catch(error => {
      console.error('SW: Critical cache installation failed:', error);
      // Still skip waiting to activate, app might work with partial cache
      return self.skipWaiting();
    })
  );
});

// Activate event - Aggressive cache persistence
self.addEventListener('activate', event => {
  console.log('SW: Activating with cache persistence...');
  
  event.waitUntil(
    Promise.all([
      // Request persistent storage to prevent eviction
      requestPersistentStorage(),
      
      // Clean old caches but preserve critical ones
      cleanupOldCaches(),
      
      // Take control immediately
      self.clients.claim(),
      
      // Preload critical app shell
      preloadAppShell()
    ]).then(() => {
      console.log('SW: Activation complete with persistence');
      return notifyClientsReady();
    })
  );
});

// Request persistent storage to prevent cache eviction
async function requestPersistentStorage() {
  try {
    if ('storage' in navigator && 'persist' in navigator.storage) {
      const isPersistent = await navigator.storage.persist();
      console.log('SW: Persistent storage granted:', isPersistent);
      
      // Check storage usage
      if ('estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        console.log('SW: Storage estimate:', {
          usage: Math.round(estimate.usage / 1024 / 1024) + ' MB',
          quota: Math.round(estimate.quota / 1024 / 1024) + ' MB',
          percentage: Math.round((estimate.usage / estimate.quota) * 100) + '%'
        });
      }
      
      return isPersistent;
    }
    return false;
  } catch (error) {
    console.error('SW: Persistent storage request failed:', error);
    return false;
  }
}

// Clean old caches but preserve critical ones
async function cleanupOldCaches() {
  try {
    const cacheNames = await caches.keys();
    const keepCaches = [CACHE_NAME, DYNAMIC_CACHE, CRITICAL_CACHE];
    
    await Promise.all(
      cacheNames.map(cacheName => {
        if (!keepCaches.includes(cacheName)) {
          console.log('SW: Deleting old cache:', cacheName);
          return caches.delete(cacheName);
        }
      })
    );
  } catch (error) {
    console.error('SW: Cache cleanup failed:', error);
  }
}

// Preload critical app shell to ensure offline availability
async function preloadAppShell() {
  try {
    const cache = await caches.open(CRITICAL_CACHE);
    
    // Ensure critical resources are always fresh and available
    for (const url of CRITICAL_ASSETS) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          await cache.put(url, response);
        }
      } catch (error) {
        console.warn('SW: Failed to refresh critical asset:', url);
      }
    }
  } catch (error) {
    console.error('SW: App shell preload failed:', error);
  }
}

// Notify clients that SW is ready
async function notifyClientsReady() {
  try {
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({ 
        type: 'SW_READY',
        persistent: true,
        basePath: BASE_PATH 
      });
    });
  } catch (error) {
    console.error('SW: Client notification failed:', error);
  }
}

// Enhanced fetch handler with robust offline support
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip unsupported protocols
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Route different request types
  if (isCriticalRequest(url)) {
    event.respondWith(criticalAssetStrategy(request));
  } else if (isAppRequest(url)) {
    event.respondWith(appShellStrategy(request));
  } else if (isStaticAsset(url)) {
    event.respondWith(staticAssetStrategy(request));
  } else if (isExternalCDN(url)) {
    event.respondWith(cdnStrategy(request));
  } else if (isFirebaseAPI(url)) {
    event.respondWith(apiStrategy(request));
  } else {
    event.respondWith(defaultStrategy(request));
  }
});

// Critical Asset Strategy - NEVER fail offline
async function criticalAssetStrategy(request) {
  try {
    // Always try cache first for critical assets
    let response = await caches.match(request, { cacheName: CRITICAL_CACHE });
    
    if (response) {
      console.log('SW: Serving critical asset from cache:', request.url);
      return response;
    }

    // Fallback to other caches
    response = await caches.match(request);
    if (response) {
      console.log('SW: Serving critical asset from general cache:', request.url);
      return response;
    }

    // Network as last resort
    response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CRITICAL_CACHE);
      cache.put(request, response.clone());
    }
    return response;

  } catch (error) {
    console.error('SW: Critical asset failed:', request.url, error);
    
    // Return a basic offline shell for HTML requests
    if (request.headers.get('accept')?.includes('text/html')) {
      return new Response(
        createOfflineFallbackHTML(),
        { 
          headers: { 'Content-Type': 'text/html' },
          status: 200 
        }
      );
    }
    
    throw error;
  }
}

// App Shell Strategy - Robust offline support
async function appShellStrategy(request) {
  try {
    // Check critical cache first
    let response = await caches.match(request, { cacheName: CRITICAL_CACHE });
    if (response) {
      console.log('SW: Serving app shell from critical cache');
      return response;
    }

    // Try network with short timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    try {
      response = await fetch(request, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const cache = await caches.open(CRITICAL_CACHE);
        cache.put(request, response.clone());
        return response;
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      console.log('SW: Network timeout/failure, using cache fallback');
    }

    // Fallback to any cached version
    response = await caches.match(request);
    if (response) {
      return response;
    }

    // Ultimate fallback - serve index.html for navigation requests
    if (request.mode === 'navigate') {
      const indexResponse = await caches.match(`${BASE_PATH}index.html`);
      if (indexResponse) {
        return indexResponse;
      }
    }

    throw new Error('No cached version available');

  } catch (error) {
    console.error('SW: App shell strategy failed:', error);
    return new Response(createOfflineFallbackHTML(), {
      headers: { 'Content-Type': 'text/html' },
      status: 200
    });
  }
}

// Static Asset Strategy - Cache first with network update
async function staticAssetStrategy(request) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      // Serve from cache immediately
      updateCacheInBackground(request);
      return cachedResponse;
    }

    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;

  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw error;
  }
}

// CDN Strategy - Aggressive caching
async function cdnStrategy(request) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;

  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw error;
  }
}

// API Strategy - Network first with cache fallback
async function apiStrategy(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;

  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('SW: Serving API response from cache during offline');
      return cachedResponse;
    }
    throw error;
  }
}

// Default Strategy
async function defaultStrategy(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw error;
  }
}

// Update cache in background without blocking response
function updateCacheInBackground(request) {
  fetch(request).then(response => {
    if (response.ok) {
      caches.open(CACHE_NAME).then(cache => {
        cache.put(request, response);
      });
    }
  }).catch(() => {
    // Ignore background update failures
  });
}

// Helper Functions
function isCriticalRequest(url) {
  return CRITICAL_ASSETS.some(asset => url.href.endsWith(asset.replace(BASE_PATH, '')));
}

function isAppRequest(url) {
  return (url.origin === self.location.origin && 
          (url.pathname === BASE_PATH || 
           url.pathname === `${BASE_PATH}index.html` ||
           url.pathname.startsWith(BASE_PATH) && url.pathname.endsWith('.html')));
}

function isStaticAsset(url) {
  const extensions = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.woff', '.woff2', '.ttf', '.json'];
  return extensions.some(ext => url.pathname.toLowerCase().endsWith(ext));
}

function isExternalCDN(url) {
  const cdnDomains = [
    'cdn.tailwindcss.com',
    'unpkg.com',
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'www.gstatic.com'
  ];
  return cdnDomains.some(domain => url.hostname.includes(domain));
}

function isFirebaseAPI(url) {
  return url.hostname.includes('firebase') || url.hostname.includes('firebaseio.com');
}

// Create offline fallback HTML
function createOfflineFallbackHTML() {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Saladin Pharma - Offline</title>
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          margin: 0; padding: 40px 20px; text-align: center; 
          background: linear-gradient(135deg, #5D5CDE 0%, #4F46E5 100%);
          color: white; min-height: 100vh; display: flex;
          flex-direction: column; justify-content: center; align-items: center;
        }
        .logo { font-size: 48px; margin-bottom: 20px; }
        h1 { font-size: 24px; margin-bottom: 10px; }
        p { font-size: 16px; opacity: 0.9; margin-bottom: 30px; }
        button { 
          background: rgba(255,255,255,0.2); color: white; 
          border: 1px solid rgba(255,255,255,0.3); padding: 12px 24px; 
          border-radius: 8px; font-size: 16px; cursor: pointer;
          backdrop-filter: blur(10px);
        }
        button:hover { background: rgba(255,255,255,0.3); }
        .status { margin-top: 20px; font-size: 14px; opacity: 0.8; }
      </style>
    </head>
    <body>
      <div class="logo">⚕️</div>
      <h1>Saladin Pharma</h1>
      <p>You're currently offline, but the app is cached and ready to use!</p>
      <button onclick="window.location.reload()">Try Again</button>
      <div class="status">App is running in offline mode</div>
      <script>
        // Auto-retry when back online
        window.addEventListener('online', () => {
          window.location.reload();
        });
      </script>
    </body>
    </html>
  `;
}

// Periodic cache refresh to maintain freshness
setInterval(async () => {
  try {
    // Only refresh if we have clients (app is being used)
    const clients = await self.clients.matchAll();
    if (clients.length > 0 && navigator.onLine) {
      console.log('SW: Performing periodic cache refresh...');
      
      for (const asset of CRITICAL_ASSETS) {
        try {
          const response = await fetch(asset);
          if (response.ok) {
            const cache = await caches.open(CRITICAL_CACHE);
            await cache.put(asset, response);
          }
        } catch (error) {
          console.warn('SW: Periodic refresh failed for:', asset);
        }
      }
    }
  } catch (error) {
    console.error('SW: Periodic cache refresh failed:', error);
  }
}, 300000); // Every 5 minutes

// Enhanced message handling
self.addEventListener('message', event => {
  const { type, payload } = event.data || {};
  
  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'CLAIM_CLIENTS':
      self.clients.claim();
      break;
      
    case 'REFRESH_CACHE':
      refreshCriticalCache();
      break;
      
    case 'GET_CACHE_STATUS':
      getCacheStatus().then(status => {
        event.ports[0]?.postMessage(status);
      });
      break;
  }
});

// Refresh critical cache on demand
async function refreshCriticalCache() {
  try {
    await preloadAppShell();
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({ type: 'CACHE_REFRESHED' });
    });
  } catch (error) {
    console.error('SW: Cache refresh failed:', error);
  }
}

// Get cache status for debugging
async function getCacheStatus() {
  try {
    const cacheNames = await caches.keys();
    const status = {
      caches: cacheNames,
      persistent: false,
      storage: null
    };

    if ('storage' in navigator) {
      try {
        status.persistent = await navigator.storage.persisted();
        if ('estimate' in navigator.storage) {
          status.storage = await navigator.storage.estimate();
        }
      } catch (error) {
        console.warn('SW: Could not get storage status:', error);
      }
    }

    return status;
  } catch (error) {
    console.error('SW: Cache status check failed:', error);
    return { error: error.message };
  }
}
