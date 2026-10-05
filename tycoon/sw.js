// Offline cache for the Tycoon Rush planner.
//
// Your plan has to open with no signal, so every file the app needs is kept on
// the phone, along with the last market prices it saw. When there is a
// connection it asks the network first, so new versions and fresh prices show
// up; if the network is slow or gone it falls back to the saved copy.

const CACHE = 'tycoon-rush-v15-planner';

// How long to wait for the network before using the saved copy.
const NETWORK_WAIT_MS = 3000;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './js/app.js',
  './js/model.js',
  './js/money.js',
  './js/sim.js',
  './js/analyse.js',
  './js/market.js',
  './js/debt.js',
  './js/charts.js',
  './js/pdf.js',
  './js/worker.js',
  './js/venture.js',
  './js/world.js',
  './fonts/figtree-400.woff2',
  './fonts/figtree-700.woff2',
  './fonts/figtree-800.woff2',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's HTTP cache, which GitHub Pages fills
  // for ten minutes, so an update never installs yesterday's files.
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => (k.startsWith('tycoon-rush-') && k !== CACHE) || k === 'tr-state').map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // 'no-cache' asks the server whether the file changed (a cheap 304 when
    // it hasn't) instead of trusting a copy the browser kept.
    const network = fetch(request, { cache: 'no-cache' }).then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    });
    const saved = await cache.match(request);
    if (!saved) return network;
    const timeout = new Promise((resolve) => { setTimeout(() => resolve(null), NETWORK_WAIT_MS); });
    try {
      return (await Promise.race([network, timeout])) || saved;
    } catch {
      return saved;
    }
  })());
});
