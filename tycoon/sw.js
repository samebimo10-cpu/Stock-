// Offline cache for Tycoon Rush.
//
// Bored on a bus with no signal is the whole point, so every file the game
// needs is cached on first visit and served from the cache first. The network
// is only used in the background to pick up a newer copy.

const CACHE = 'tycoon-rush-v3';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './js/app.js',
  './js/engine.js',
  './js/content.js',
  './js/learn.js',
  './js/art.js',
  './fonts/bungee.woff2',
  './fonts/figtree-400.woff2',
  './fonts/figtree-700.woff2',
  './fonts/figtree-800.woff2',
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

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((hit) => {
      const fromNetwork = fetch(request)
        .then((response) => {
          if (response && response.ok) {
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
