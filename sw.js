/**
 * Service Worker for CDN Analytics PWA
 * Cache-first strategy for static assets, network-only for API calls
 */

const CACHE_NAME = 'cdn-analytics-v1';

// Static assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/dashboard.css',
  '/manifest.json',
  // Core JS modules
  '/js/main.js',
  '/js/api.js',
  '/js/auth.js',
  '/js/chart.js',
  '/js/config.js',
  '/js/filters.js',
  '/js/format.js',
  '/js/logs.js',
  '/js/modal.js',
  '/js/state.js',
  '/js/time.js',
  '/js/timer.js',
  '/js/url-state.js',
  '/js/utils.js',
  '/js/autocomplete.js',
  // Breakdown modules
  '/js/breakdowns/index.js',
  '/js/breakdowns/definitions.js',
  '/js/breakdowns/render.js',
  '/js/breakdowns/links.js',
  // Color modules
  '/js/colors/index.js',
  '/js/colors/definitions.js',
  // Icons
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-180.png',
  '/icons/icon-32.png',
  '/icons/icon-16.png',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        // Activate immediately without waiting
        return self.skipWaiting();
      }),
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            }),
        );
      })
      .then(() => {
        // Take control of all pages immediately
        return self.clients.claim();
      }),
  );
});

// Fetch event - cache-first for static, network-only for API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip external requests and API calls (ClickHouse queries)
  if (url.origin !== self.location.origin) {
    return;
  }

  // In development (localhost), use network-first to see changes immediately
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Update cache in background
          if (response && response.status === 200 && response.type === 'basic') {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          }
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  // For same-origin requests, use cache-first strategy
  event.respondWith(
    caches
      .match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // Return cached version, but also update cache in background
          fetchAndCache(event.request);
          return cachedResponse;
        }

        // Not in cache, fetch from network
        return fetchAndCache(event.request);
      })
      .catch(() => {
        // Network failed and not in cache
        // Return a simple offline message for HTML pages
        if (event.request.headers.get('Accept')?.includes('text/html')) {
          return new Response(
            '<!DOCTYPE html><html><head><title>Offline</title></head>' +
              '<body style="font-family:system-ui;text-align:center;padding:50px">' +
              '<h1>You are offline</h1>' +
              '<p>CDN Analytics requires a network connection.</p>' +
              '<button onclick="location.reload()">Retry</button>' +
              '</body></html>',
            { headers: { 'Content-Type': 'text/html' } },
          );
        }
        return new Response('Offline', { status: 503 });
      }),
  );
});

// Helper: Fetch and update cache
function fetchAndCache(request) {
  return fetch(request).then((response) => {
    // Only cache successful responses
    if (!response || response.status !== 200 || response.type !== 'basic') {
      return response;
    }

    // Clone the response since it can only be consumed once
    const responseToCache = response.clone();

    caches.open(CACHE_NAME).then((cache) => {
      cache.put(request, responseToCache);
    });

    return response;
  });
}
