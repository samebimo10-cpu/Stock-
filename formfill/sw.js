// Offline cache for FormFill.
//
// Everything the app needs is kept on the device: the app itself, the
// spreadsheet engine, the PDF and Word readers and, downloaded in the
// background after install, the text-recognition pack for scans and photos.
// The only thing that ever needs a connection is the optional AI proxy, which
// is on another origin and never passes through here.

const CACHE = 'formfill-v1';
const OCR_CACHE = 'formfill-ocr-v1';
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
  './js/xlsx.js',
  './js/detect.js',
  './js/normalize.js',
  './js/extract.js',
  './js/readers.js',
  './js/ai.js',
  './js/store.js',
  './vendor/jszip.min.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './vendor/mammoth.browser.min.js',
];

// Large and versioned by file name, so they are served from the cache first.
const OCR = [
  './vendor/ocr/tesseract.min.js',
  './vendor/ocr/worker.min.js',
  './vendor/ocr/eng.traineddata.gz',
  './vendor/ocr/tesseract-core-simd-lstm.wasm.js',
  './vendor/ocr/tesseract-core-lstm.wasm.js',
];

const abs = (p) => new URL(p, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

async function cacheOcr() {
  const cache = await caches.open(OCR_CACHE);
  for (const p of OCR) {
    const url = abs(p);
    if (await cache.match(url)) continue;
    try {
      const r = await fetch(url, { cache: 'reload' });
      if (r.ok) await cache.put(url, r);
    } catch { /* offline now; the app retries on first use or from Settings */ }
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('formfill-') && k !== CACHE && k !== OCR_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => { cacheOcr(); }),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/vendor/ocr/')) {
    event.respondWith((async () => {
      const cache = await caches.open(OCR_CACHE);
      const key = url.origin + url.pathname;
      const saved = await cache.match(key);
      if (saved) return saved;
      const r = await fetch(request);
      if (r.ok) await cache.put(key, r.clone());
      return r;
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const network = fetch(request, { cache: 'no-cache' }).then((response) => {
      if (response && response.ok && url.search === '') cache.put(request, response.clone());
      return response;
    });
    const saved = await cache.match(request, { ignoreSearch: true });
    if (!saved) return network;
    const timeout = new Promise((resolve) => { setTimeout(() => resolve(null), NETWORK_WAIT_MS); });
    try {
      return (await Promise.race([network, timeout])) || saved;
    } catch {
      return saved;
    }
  })());
});
