/**
 * Service Worker for CDN Analytics PWA
 * Network-first strategy for all assets, with cache fallback for offline use
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
  '/icons/icon-16.png'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        // Activate immediately without waiting
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        // Take control of all pages immediately
        return self.clients.claim();
      })
  );
});

// Fetch event - network-first for all same-origin requests
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

  // Network-first: always try to fetch fresh content, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses for offline fallback
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return response;
      })
      .catch(() => {
        // Network failed — try cache fallback
        return caches.match(event.request)
          .then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Not in cache either — return offline message for HTML pages
            if (event.request.headers.get('Accept')?.includes('text/html')) {
              return new Response(
                '<!DOCTYPE html><html><head><title>Offline</title></head>' +
                '<body style="font-family:system-ui;text-align:center;padding:50px">' +
                '<h1>You are offline</h1>' +
                '<p>CDN Analytics requires a network connection.</p>' +
                '<button onclick="location.reload()">Retry</button>' +
                '</body></html>',
                { headers: { 'Content-Type': 'text/html' } }
              );
            }
            return new Response('Offline', { status: 503 });
          });
      })
  );
});
