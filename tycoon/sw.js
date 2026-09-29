// Offline cache for Tycoon Rush.
//
// Bored on a bus with no signal is the whole point, so every file the game
// needs is kept on the phone. When there is a connection the game asks the
// network first, so a new version shows up the next time it is opened; if the
// network is slow or gone it falls back to the saved copy within a few seconds.

const CACHE = 'tycoon-rush-v10';

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
  './js/engine.js',
  './js/content.js',
  './js/learn.js',
  './js/story.js',
  './js/art.js',
  './js/report.js',
  './fonts/bungee.woff2',
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
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tycoon-rush-') && k !== CACHE).map((k) => caches.delete(k))))
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

// 16+ reminders (opt-in). The game keeps a one-line teaser in a small cache;
// periodic background sync, where the browser supports it, shows it at most
// about once a day.
self.addEventListener('periodicsync', (event) => {
  if (event.tag !== 'tr-remind') return;
  event.waitUntil((async () => {
    const c = await caches.open('tr-state');
    const r = await c.match('./state/teaser.json');
    const t = r ? await r.json() : null;
    if (!t || Date.now() - t.at < 18 * 60 * 60 * 1000) return;
    await self.registration.showNotification('Tycoon Rush', { body: t.text, icon: './icon.svg', tag: 'tr-remind' });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => (list.length ? list[0].focus() : self.clients.openWindow('./'))));
});
