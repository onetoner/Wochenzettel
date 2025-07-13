const CACHE_NAME = 'wochenzettel-cache-v3';
// Local app shell files. CDN resources will be cached on demand.
const APP_SHELL_URLS = [
  '/',
  'index.html',
  'index.css',
  'index.tsx',
  'manifest.json',
  'icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache and caching app shell');
        return cache.addAll(APP_SHELL_URLS);
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: clearing old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', event => {
  // We only want to handle GET requests
  if (event.request.method !== 'GET') {
      return;
  }
  
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Try to get the resource from the cache.
      const cachedResponse = await cache.match(event.request);
      if (cachedResponse) {
        // Return the cached resource.
        return cachedResponse;
      }

      // If the resource is not in the cache, fetch it from the network.
      try {
        const networkResponse = await fetch(event.request);
        
        // If the fetch is successful, clone the response and store it in the cache.
        // We only cache successful responses to avoid caching errors.
        if (networkResponse.ok) {
            await cache.put(event.request, networkResponse.clone());
        }
        
        // Return the network response.
        return networkResponse;
      } catch (error) {
        // If the fetch fails (e.g., user is offline), you could return a fallback page.
        console.error('Service Worker: fetch failed', error);
        throw error;
      }
    })
  );
});
