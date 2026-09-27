// Offline cache for Tycoon Rush.
//
// Bored on a bus with no signal is the whole point, so every file the game
// needs is cached on first visit and served from the cache first. The network
// is only used in the background to pick up a newer copy.

const CACHE = 'tycoon-rush-v2';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './js/app.js',
  './js/engine.js',
  './js/content.js',
  './js/learn.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tycoon-rush-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Fonts come from Google. Keep a copy so the game looks right offline too;
  // without one it falls back to system fonts, which is fine.
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== self.location.origin && !isFont) return;

  event.respondWith(
    caches.match(request).then((hit) => {
      const fromNetwork = fetch(request)
        .then((response) => {
          if (response && (response.ok || response.type === 'opaque')) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => hit);
      return hit || fromNetwork;
    }),
  );
});
