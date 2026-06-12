/**
 * Panorama Expenses — Service Worker
 * Strategy:
 *   - App shell (HTML, icons, fonts CDN)  → Cache-first, background refresh
 *   - JSONBin API calls                   → Network-first, fall back to cache
 *   - EmailJS CDN                         → Cache-first (rarely changes)
 */

const CACHE_VERSION = 'panorama-v17';

const APP_SHELL = [
  './',
  './index.html',
  './Icon Dark.png',
  './Icon Light.png',
  './manifest.json',
];

// External resources to pre-cache
const EXTERNAL_CACHE = [
  'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js',
  'https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700;800;900&display=swap',
];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => {
      // Cache app shell first (must not fail)
      return cache.addAll(APP_SHELL).then(() =>
        // Cache external resources best-effort
        Promise.allSettled(
          EXTERNAL_CACHE.map(url =>
            cache.add(url).catch(() => console.warn('[SW] Could not pre-cache:', url))
          )
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activate — clean up old caches ──────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_VERSION)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // JSONBin API → Network-first, fall back to cache
  if (url.hostname === 'api.jsonbin.io') {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Google Fonts CSS (always try network for freshness, fall back to cache)
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Google Fonts files & other CDNs → Cache-first
  if (
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'cdn.jsdelivr.net'
  ) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // HTML documents → Network-first (always get fresh markup)
  if (url.origin === self.location.origin && (
    event.request.destination === 'document' ||
    url.pathname.endsWith('.html') ||
    url.pathname === '/panorama-expenses/' ||
    url.pathname === '/panorama-expenses'
  )) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Other same-origin assets (icons, etc.) → Cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Everything else → network only
  event.respondWith(fetch(event.request));
});

// ── Strategies ───────────────────────────────────────────────────────────────

/**
 * Cache-first: serve from cache immediately; revalidate in background.
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  const networkFetch = fetch(request)
    .then(response => {
      if (response && response.ok) {
        const clone = response.clone();
        caches.open(CACHE_VERSION).then(cache => cache.put(request, clone));
      }
      return response;
    })
    .catch(() => null);

  return cached || await networkFetch || new Response('Offline — asset unavailable', { status: 503 });
}

/**
 * Network-first: try network, fall back to cache.
 * Caches successful network responses for offline use.
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const clone = response.clone();
      caches.open(CACHE_VERSION).then(cache => cache.put(request, clone));
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ error: 'offline', message: 'No network — showing cached data' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
