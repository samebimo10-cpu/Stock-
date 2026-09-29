// Client for the optional Apps Script server (apps-script/Code.gs).
//
// Everything that needs a connection goes through here: AI reading, AI field
// naming, Google Sheets forms and the Drive templates folder. The rest of
// FormFill works without it; when the call fails or the device is offline,
// the app falls back to on-device reading, or queues Google Sheets fills.

const TIMEOUT_MS = 120000;

export async function callProxy({ url, token }, action, body = {}) {
  if (!url) throw new Error('Set up the proxy in Settings first.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // text/plain keeps this a "simple" request, so the browser skips the CORS
    // preflight that Apps Script web apps cannot answer.
    const r = await fetch(url, { method: 'POST', body: JSON.stringify({ ...body, action, token }), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) throw new Error(`The proxy answered ${r.status}.`);
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The proxy took too long to answer.');
    if (e instanceof TypeError) throw new Error('The proxy could not be reached.');
    throw e;
  } finally { clearTimeout(timer); }
}

export const pingProxy = (url, token) => callProxy({ url, token }, 'ping');

function normaliseDoc(map, d) {
  const fields = {};
  for (const f of map.fields) {
    const r = d.fields && d.fields[f.name];
    const value = r && r.value != null && r.value !== '' ? String(r.value) : null;
    fields[f.name] = { value, confidence: value == null ? 0 : Math.max(0, Math.min(1, Number(r.confidence) || 0.5)), snippet: (r && r.snippet) || '', page: (r && r.page) || null };
  }
  const cols = map.table ? Object.keys(map.table.columns) : [];
  const allRows = (Array.isArray(d.rows) ? d.rows : []).map((row) => Object.fromEntries(cols.map((c) => [c, row && row[c] != null ? String(row[c]) : ''])));
  const max = map.table ? map.table.maxRows : 0;
  return { fields, rows: allRows.slice(0, max), moreRows: Math.max(0, allRows.length - max), label: d.label || '' };
}

export async function extractWithAI(proxy, map, docs, { dateOrder = 'DMY' } = {}) {
  const texts = [];
  const images = [];
  for (const d of docs) {
    if (d.lines.length) texts.push({ name: d.name, text: d.lines.map((l) => (d.pages > 1 ? `[p${l.page}] ` : '') + l.text).join('\n') });
    for (const img of d.images || []) images.push({ name: d.name, page: img.page, dataUrl: img.dataUrl });
  }
  const data = await callProxy(proxy, 'extract', {
    dateOrder,
    fields: map.fields.map((f) => ({ name: f.name, type: f.type, label: f.label, hint: f.hint })),
    table: map.table ? { columns: Object.keys(map.table.columns), maxRows: map.table.maxRows } : null,
    texts,
    images,
  });
  const list = Array.isArray(data.documents) && data.documents.length ? data.documents : [{ fields: data.fields, rows: data.rows }];
  const documents = list.map((d, i) => { const n = normaliseDoc(map, d); if (!n.label) n.label = `Document ${i + 1}`; return n; });
  return { ...documents[0], documents, source: 'ai' };
}

// Asks the AI to name and type the detected fields from the form's layout.
export async function nameFieldsWithAI(proxy, layout) {
  const data = await callProxy(proxy, 'detect', { layout });
  return Array.isArray(data.fields) ? data.fields : [];
}
