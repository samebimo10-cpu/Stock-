// Runs the plan in the background so the screen never freezes.
import { analyse, whatIf } from './analyse.js';

self.onmessage = (e) => {
  const { id, type, st, market, patch } = e.data;
  try {
    const out = type === 'whatif' ? whatIf(st, market, patch) : analyse(st, market);
    if (out.freeBy) delete out.freeBy;
    self.postMessage({ id, ok: true, out });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
