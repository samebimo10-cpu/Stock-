// Optional AI extraction through the Apps Script proxy (apps-script/Code.gs).
//
// Used only when a proxy is set up and the device is online. Everything else
// in FormFill works without it; when it fails or the connection drops, the app
// falls back to the on-device reader.

const TIMEOUT_MS = 120000;

async function post(url, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // text/plain keeps this a "simple" request, so the browser skips the CORS
    // preflight that Apps Script web apps cannot answer.
    const r = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) throw new Error(`The AI proxy answered ${r.status}.`);
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The AI took too long to answer.');
    throw e;
  } finally { clearTimeout(timer); }
}

export async function pingProxy(url, token) {
  return post(url, { ping: true, token });
}

export async function extractWithAI({ url, token }, map, docs, { dateOrder = 'DMY' } = {}) {
  const texts = [];
  const images = [];
  for (const d of docs) {
    if (d.lines.length) texts.push({ name: d.name, text: d.lines.map((l) => (d.pages > 1 ? `[p${l.page}] ` : '') + l.text).join('\n') });
    for (const img of d.images || []) images.push({ name: d.name, page: img.page, dataUrl: img.dataUrl });
  }
  const body = {
    token,
    dateOrder,
    fields: map.fields.map((f) => ({ name: f.name, type: f.type, label: f.label, hint: f.hint })),
    table: map.table ? { columns: Object.keys(map.table.columns), maxRows: map.table.maxRows } : null,
    texts,
    images,
  };
  const data = await post(url, body);
  const fields = {};
  for (const f of map.fields) {
    const r = data.fields && data.fields[f.name];
    const value = r && r.value != null && r.value !== '' ? String(r.value) : null;
    fields[f.name] = { value, confidence: value == null ? 0 : Math.max(0, Math.min(1, Number(r.confidence) || 0.5)), snippet: (r && r.snippet) || '', page: (r && r.page) || null };
  }
  const cols = map.table ? Object.keys(map.table.columns) : [];
  const allRows = (Array.isArray(data.rows) ? data.rows : []).map((row) => Object.fromEntries(cols.map((c) => [c, row && row[c] != null ? String(row[c]) : ''])));
  const max = map.table ? map.table.maxRows : 0;
  return { fields, rows: allRows.slice(0, max), moreRows: Math.max(0, allRows.length - max), documents: Number(data.documents) || 1, source: 'ai' };
}
