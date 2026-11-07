/* Halo PWA service worker. Bump CACHE_VERSION when the shell/cache contract changes. */
const CACHE_PREFIX = 'radarmatrix-halo-';
const CACHE_VERSION = 'v1';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const ROOT_URL = `${self.location.origin}/`;
const REQUIRED_FILES = [
  '/manifest.webmanifest',
  '/offline.html',
  '/icons/halo-180.png',
  '/icons/halo-192.png',
  '/icons/halo-512.png',
  '/icons/halo-maskable-512.png',
];
const APP_ROUTES = new Set([
  'overview', 'chat', 'agents', 'skills', 'knowledge', 'tasks',
  'connections', 'operator', 'ide', 'cloud', 'halo',
]);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const response = await fetch(ROOT_URL, { cache: 'reload' });
    if (!response.ok) throw new Error(`Unable to precache app shell: ${response.status}`);
    await cache.put(ROOT_URL, response.clone());

    const html = await response.text();
    const buildAssets = new Set();
    const assetPattern = /(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g;
    for (const match of html.matchAll(assetPattern)) {
      const asset = new URL(match[1], ROOT_URL);
      if (asset.origin === self.location.origin) buildAssets.add(asset.href);
    }

    for (const file of [...REQUIRED_FILES, ...buildAssets]) {
      const assetUrl = new URL(file, ROOT_URL).href;
      const assetResponse = await fetch(assetUrl, { cache: 'reload' });
      if (!assetResponse.ok) throw new Error(`Unable to precache ${file}: ${assetResponse.status}`);
      await cache.put(assetUrl, assetResponse);
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedPage = await cache.match(request);
      try {
        const response = await fetch(request);
        if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
          await cache.put(request, response.clone());
          return response;
        }
        const lastSegment = requestUrl.pathname.split('/').filter(Boolean).at(-1) || 'overview';
        if (!APP_ROUTES.has(lastSegment)) return response;
        return cachedPage || await cache.match(ROOT_URL) || await cache.match(new URL('/offline.html', ROOT_URL).href) || response;
      } catch {
        return cachedPage || await cache.match(ROOT_URL) || await cache.match(new URL('/offline.html', ROOT_URL).href) || Response.error();
      }
    })());
    return;
  }

  const isAppAsset = requestUrl.pathname.startsWith('/assets/')
    || requestUrl.pathname.startsWith('/icons/')
    || requestUrl.pathname === '/manifest.webmanifest'
    || requestUrl.pathname === '/offline.html';
  if (!isAppAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});
