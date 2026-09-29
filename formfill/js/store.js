// On-device storage (IndexedDB). Templates, their field maps, the last 20
// fills (values only, never the documents) and settings all stay on the phone.

const DB_NAME = 'formfill';
const VERSION = 2;
const HISTORY_LIMIT = 20;

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('templates')) d.createObjectStore('templates', { keyPath: 'hash' });
        if (!d.objectStoreNames.contains('history')) d.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings');
        // Google Sheets fills made offline, sent when the device is back online.
        if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Storage is not available in this browser.'));
    });
  }
  return dbPromise;
}

function run(store, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const s = tx.objectStore(store);
    let result;
    const req = fn(s);
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage is full or unavailable.'));
  }));
}

export const listTemplates = () => run('templates', 'readonly', (s) => s.getAll()).then((a) => (a || []).sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0)));
export const getTemplate = (hash) => run('templates', 'readonly', (s) => s.get(hash));
export const putTemplate = (t) => run('templates', 'readwrite', (s) => s.put({ ...t, updatedAt: Date.now() }));
export const deleteTemplate = (hash) => run('templates', 'readwrite', (s) => s.delete(hash));

export async function listHistory() {
  const all = (await run('history', 'readonly', (s) => s.getAll())) || [];
  return all.sort((a, b) => b.at - a.at);
}

export async function addHistory(entry) {
  const id = await run('history', 'readwrite', (s) => s.add({ ...entry, at: Date.now() }));
  const all = await listHistory();
  const extra = all.slice(HISTORY_LIMIT);
  if (extra.length) await run('history', 'readwrite', (s) => { for (const e of extra) s.delete(e.id); });
  return id;
}

export const deleteHistory = (id) => run('history', 'readwrite', (s) => s.delete(id));
export const updateHistory = (entry) => run('history', 'readwrite', (s) => s.put(entry));

export const listOutbox = () => run('outbox', 'readonly', (s) => s.getAll()).then((a) => a || []);
export const addOutbox = (item) => run('outbox', 'readwrite', (s) => s.add({ ...item, queuedAt: Date.now() }));
export const putOutbox = (item) => run('outbox', 'readwrite', (s) => s.put(item));
export const deleteOutbox = (id) => run('outbox', 'readwrite', (s) => s.delete(id));

export const getSetting = (key, fallback = null) => run('settings', 'readonly', (s) => s.get(key)).then((v) => (v === undefined ? fallback : v));
export const setSetting = (key, value) => run('settings', 'readwrite', (s) => s.put(value, key));

// Asks the browser not to clear FormFill's storage when space runs low.
export async function persist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch { /* ignore */ }
  return false;
}
