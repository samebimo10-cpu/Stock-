// FormFill app shell: screens, state and wiring.
//
// Flow: add a form (.xlsx) -> confirm the detected fields once -> for each fill,
// add documents -> read them (on this device, or with the AI when online) ->
// review every value -> preview -> download or share the filled form.

import * as X from './xlsx.js';
import { detectFields, manualField, guessType, suggestOutputName, layoutForAI, applyAINames } from './detect.js';
import { validateValue, displayCell, outputFileName, slugify, FIELD_TYPES, parseDate, formatDate } from './normalize.js';
import { extractOnDevice } from './extract.js';
import { extractWithAI, pingProxy, callProxy, nameFieldsWithAI } from './ai.js';
import { sheetModel, layoutHash, isSheetsUrl } from './gsheet.js';
import { readDocument, documentKind, prefetchOcr, OCR_FILES } from './readers.js';
import * as store from './store.js';

const JSZip = window.JSZip;
const $main = document.getElementById('main');
const $bar = document.getElementById('bar');
const $barInner = document.getElementById('bar-inner');

const TYPE_LABELS = { text: 'Text', number: 'Number', date: 'Date', currency: 'Money', yesno: 'Yes / No' };
const LOW_CONFIDENCE = 0.8;

const state = {
  settings: { proxyUrl: '', proxyToken: '', dateOrder: 'DMY', useAI: true, aiNaming: true },
  record: null, // stored template { hash, name, bytes, map }
  tpl: null, // opened workbook
  sheet: null, // sheet name shown in grids
  fill: null, // current fill in progress
};

// ---------------------------------------------------------------- helpers

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// Optional sections are passed as null; only real nodes are inserted.
const nodesOf = (list) => list.flat(Infinity).filter((n) => n != null && n !== false);

function screen(...nodes) {
  $main.replaceChildren(...nodesOf(nodes));
  window.scrollTo(0, 0);
}

function bar(...buttons) {
  const list = buttons.filter(Boolean);
  $bar.classList.toggle('hidden', !list.length);
  $barInner.replaceChildren(...list);
}

let toastTimer = null;
function toast(msg, ms = 3200) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}

function pickFiles({ accept, multiple = false, capture = null }) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, capture, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

function download(bytes, name, type) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

const online = () => navigator.onLine !== false;
const aiReady = () => Boolean(state.settings.proxyUrl) && online();
const proxy = () => ({ url: state.settings.proxyUrl, token: state.settings.proxyToken });
const isSheets = (rec) => rec && rec.kind === 'gsheet';

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function fmtWhen(ms) {
  const d = new Date(ms);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------- templates

async function openRecord(record) {
  state.record = record;
  state.tpl = isSheets(record) ? sheetModel(record.layout) : await X.openTemplate(JSZip, record.bytes);
  const visible = state.tpl.sheets.filter((s) => s.state === 'visible');
  state.sheet = (record.map && record.map.fields[0] && record.map.fields[0].sheet) || (visible[0] || state.tpl.sheets[0]).name;
}

async function addTemplate() {
  const [file] = await pickFiles({ accept: '.xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  if (!file) return;
  if (/\.xlsm$/i.test(file.name)) { toast('Macro workbooks (.xlsm) are not supported yet. Save a copy as .xlsx.', 5000); return; }
  if (/\.xls$/i.test(file.name)) { toast('Old .xls files are not supported. Save the form as .xlsx in Excel.', 5000); return; }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const tpl = await X.openTemplate(JSZip, bytes);
    const hash = await X.sha256Hex(bytes);
    const existing = await store.getTemplate(hash);
    if (existing) { await openRecord(existing); toast('This form is already saved.'); return renderSetup(); }
    const name = file.name.replace(/\.xlsx$/i, '');
    const templateId = slugify(name).replace(/_/g, '-');
    // The same form edited and uploaded again keeps its confirmed fields, but
    // the user is asked to re-check them against the new layout.
    const all = await store.listTemplates();
    const previous = all.find((t) => t.name === name);
    let map;
    let recheck = false;
    if (previous && previous.map) {
      map = { ...previous.map, templateHash: hash, fields: previous.map.fields.filter((f) => tpl.sheets.some((s) => s.name === f.sheet)) };
      recheck = true;
    } else {
      map = detectFields(tpl, { templateId, templateHash: hash, dateOrder: state.settings.dateOrder });
    }
    const record = { hash, name, bytes, map, confirmed: false, recheck, replaces: previous ? previous.hash : null, addedAt: Date.now() };
    await openRecord(record);
    if (!recheck) await nameWithAI(true);
    renderSetup();
  } catch (e) {
    toast(e.message || 'That file could not be opened.', 6000);
  }
}

// With a connection and the proxy set up, the AI names and types the detected
// fields from the form's layout. Offline, the on-device names stay.
async function nameWithAI(quiet) {
  const map = state.record.map;
  if (!aiReady() || (quiet && !state.settings.aiNaming) || !map.fields.length) {
    if (!quiet) toast(online() ? 'Set up the AI proxy in Settings first.' : 'You are offline; the on-device names are kept.');
    return false;
  }
  toast('Naming the fields with the AI…', 60000);
  try {
    const n = applyAINames(map, await nameFieldsWithAI(proxy(), layoutForAI(state.tpl, map)));
    toast(n ? `The AI named ${map.fields.length} fields.` : 'The AI agreed with the detected names.');
    return true;
  } catch (e) {
    toast(`AI naming was skipped (${e.message}). The detected names are kept.`, 5000);
    return false;
  }
}

// Google Sheets forms: the layout is read through the proxy, the fields are
// detected on the device exactly as for an .xlsx.
function renderAddSheet() {
  const input = h('input', { type: 'url', placeholder: 'https://docs.google.com/spreadsheets/d/…', 'aria-label': 'Google Sheets link' });
  screen(
    h('h2', {}, 'Add a Google Sheets form'),
    h('p', { class: 'muted small' }, 'Paste the link to the Google Sheet. Filling makes a copy in your "FormFill output" Drive folder and sets only the mapped cells, so the original stays blank. The Google account that runs your FormFill proxy must be able to open the sheet.'),
    !state.settings.proxyUrl ? h('div', { class: 'banner warn' }, 'Google Sheets forms go through your FormFill proxy. Set it up in Settings first.') : null,
    !online() ? h('div', { class: 'banner warn' }, 'You are offline. Adding a Google Sheet needs a connection; filling it later can be queued offline.') : null,
    h('label', { class: 'field' }, h('span', {}, 'Google Sheets link'), input),
  );
  bar(
    h('button', { class: 'btn', type: 'button', onclick: () => renderHome() }, 'Cancel'),
    h('button', { class: 'btn primary', type: 'button', onclick: () => addSheetsTemplate(input.value.trim()) }, 'Read the sheet'),
  );
}

async function inspectSheet(spreadsheet) {
  const layout = await callProxy(proxy(), 'sheets.inspect', { spreadsheet });
  return { layout, hash: await layoutHash(layout) };
}

async function addSheetsTemplate(link) {
  if (!isSheetsUrl(link)) { toast('Paste a Google Sheets link (docs.google.com/spreadsheets/d/…).'); return; }
  if (!aiReady()) { toast(online() ? 'Set up the proxy in Settings first.' : 'Adding a Google Sheet needs a connection.'); return; }
  toast('Reading the Google Sheet…', 60000);
  try {
    const { layout, hash } = await inspectSheet(link);
    const existing = await store.getTemplate(hash);
    if (existing) { await openRecord(existing); toast('This form is already saved.'); return renderSetup(); }
    const all = await store.listTemplates();
    const previous = all.find((t) => isSheets(t) && t.spreadsheetId === layout.spreadsheetId);
    const tpl = sheetModel(layout);
    const templateId = slugify(layout.name).replace(/_/g, '-');
    let map;
    if (previous) map = { ...previous.map, templateHash: hash, fields: previous.map.fields.filter((f) => tpl.sheets.some((s) => s.name === f.sheet)) };
    else map = detectFields(tpl, { templateId, templateHash: hash, dateOrder: state.settings.dateOrder });
    const record = { hash, name: layout.name, kind: 'gsheet', spreadsheetId: layout.spreadsheetId, url: layout.url, layout, map, confirmed: false, recheck: Boolean(previous), replaces: previous ? previous.hash : null, addedAt: Date.now() };
    await openRecord(record);
    if (!previous) await nameWithAI(true);
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    renderSetup();
  } catch (e) {
    toast(`Could not read the sheet: ${e.message}`, 6000);
  }
}

// ---------------------------------------------------------------- the sheet grid

const MAX_GRID_ROWS = 150;
const MAX_GRID_COLS = 30;

function renderGrid(sheetName, { marks = new Map(), overrides = new Map(), onCell = null } = {}) {
  const tpl = state.tpl;
  const sheet = X.getSheet(tpl, sheetName);
  let maxRow = sheet.maxRow;
  let maxCol = sheet.maxCol;
  for (const ref of [...marks.keys(), ...overrides.keys()]) { const p = X.parseRef(ref); if (p) { maxRow = Math.max(maxRow, p.row); maxCol = Math.max(maxCol, p.col); } }
  maxRow = Math.min(Math.max(maxRow, 10) + 1, MAX_GRID_ROWS);
  maxCol = Math.min(Math.max(maxCol, 5) + 1, MAX_GRID_COLS);
  const widthOf = (c) => {
    const col = sheet.cols.find((x) => c >= x.min && c <= x.max);
    if (col && col.hidden) return 0;
    return Math.round(((col && col.width) || 9.14) * 7 + 5);
  };
  const colgroup = h('colgroup', {}, h('col', { style: { width: '36px' } }), Array.from({ length: maxCol }, (_, i) => h('col', { style: { width: `${widthOf(i + 1)}px` } })));
  const head = h('thead', {}, h('tr', {}, h('th', {}), Array.from({ length: maxCol }, (_, i) => h('th', {}, X.numToCol(i + 1)))));
  const covered = new Set();
  const body = h('tbody');
  const opts = { date1904: tpl.date1904, dateOrder: (state.record.map && state.record.map.dateOrder) || state.settings.dateOrder };
  for (let r = 1; r <= maxRow; r++) {
    const ri = sheet.rowsInfo.get(r);
    if (ri && ri.hidden) continue;
    const tr = h('tr', {}, h('th', {}, String(r)));
    for (let c = 1; c <= maxCol; c++) {
      const ref = X.makeRef(c, r);
      if (covered.has(ref)) continue;
      const m = X.mergeAt(sheet, r, c);
      const attrs = { 'data-ref': ref };
      if (m && m.r1 === r && m.c1 === c) {
        const cs = Math.min(m.c2, maxCol) - c + 1;
        const rs = Math.min(m.r2, maxRow) - r + 1;
        if (cs > 1) attrs.colspan = cs;
        if (rs > 1) attrs.rowspan = rs;
        for (let rr = m.r1; rr <= m.r2; rr++) for (let cc = m.c1; cc <= m.c2; cc++) if (rr !== r || cc !== c) covered.add(X.makeRef(cc, rr));
      }
      const cell = X.cellInfo(sheet, ref, tpl.styles);
      const st = cell.style;
      const cls = [];
      if (st.bold) cls.push('b');
      if (st.border.left) cls.push('bl');
      if (st.border.right) cls.push('br');
      if (st.border.top) cls.push('bt');
      if (st.border.bottom) cls.push('bb');
      const mark = marks.get(ref);
      const over = overrides.get(ref);
      if (over != null) cls.push('fill');
      else if (mark) cls.push(mark.kind === 'table' ? 'tbl' : 'fld');
      attrs.class = cls.join(' ');
      if (st.fill.rgb && over == null && !mark) attrs.style = { background: `#${st.fill.rgb}` };
      let text = over != null ? over : displayCell(cell, opts);
      if (cell.formula && over == null && text === '0') text = '';
      const td = h('td', attrs, text);
      if (mark && over == null && !text) td.append(h('span', { class: 'tag' }, mark.label));
      td.title = mark ? `${ref}: ${mark.label}` : ref;
      tr.append(td);
    }
    body.append(tr);
  }
  const table = h('table', { class: 'grid' }, colgroup, head, body);
  if (onCell) table.addEventListener('click', (e) => { const td = e.target.closest('td[data-ref]'); if (td) onCell(td.dataset.ref); });
  return h('div', { class: 'gridwrap' }, table);
}

function sheetTabs(onChange) {
  const sheets = state.tpl.sheets.filter((s) => s.state === 'visible');
  if (sheets.length < 2) return null;
  return h('div', { class: 'tabs', role: 'tablist' }, sheets.map((s) => h('button', { type: 'button', 'aria-pressed': String(s.name === state.sheet), onclick: () => { state.sheet = s.name; onChange(); } }, s.name)));
}

function mapMarks(map, sheetName) {
  const marks = new Map();
  for (const f of map.fields) if (f.sheet === sheetName) marks.set(f.cell, { kind: 'field', label: f.name });
  const t = map.table;
  if (t && t.sheet === sheetName) {
    for (const [name, col] of Object.entries(t.columns)) {
      for (let i = 0; i < t.maxRows; i++) marks.set(`${col}${t.startRow + i}`, { kind: 'table', label: i === 0 ? name : '' });
    }
  }
  return marks;
}

// ---------------------------------------------------------------- home

async function renderHome() {
  state.fill = null;
  const [templates, history, outbox] = await Promise.all([store.listTemplates(), store.listHistory(), store.listOutbox()]);
  const forms = templates.length
    ? h('div', { class: 'list' }, templates.map((t) => h('div', { class: 'item' },
      h('div', { class: 'grow' },
        h('div', { class: 't' }, t.name, isSheets(t) ? h('span', { class: 'chip', style: { marginLeft: '6px' } }, 'Google Sheets') : null),
        h('div', { class: 'muted small' }, `${t.map.fields.length} fields${t.map.table ? ` · table of ${t.map.table.maxRows} rows` : ''}${t.confirmed ? '' : ' · not confirmed yet'}`)),
      h('button', { class: 'btn small', type: 'button', onclick: async () => { await openRecord(t); renderSetup(); } }, 'Fields'),
      h('button', { class: 'btn small primary', type: 'button', onclick: async () => { await openRecord(t); if (!t.confirmed) { toast('Confirm the fields once first.'); renderSetup(); } else startFill(); } }, 'Fill'))))
    : h('div', { class: 'empty' }, h('p', {}, 'No forms yet.'), h('p', { class: 'small' }, 'Add the Excel form you fill most often. FormFill finds its fields for you.'));

  const hist = history.length
    ? h('div', { class: 'list' }, history.map((e) => h('div', { class: 'item' },
      h('div', { class: 'grow' }, h('div', { class: 't' }, e.fileName), h('div', { class: 'muted small' }, `${e.templateName} · ${fmtWhen(e.at)}${e.queued ? ' · waiting to send' : ''}`)),
      e.url ? h('a', { class: 'btn small', href: e.url, target: '_blank', rel: 'noopener' }, 'Sheet') : null,
      h('button', { class: 'btn small', type: 'button', onclick: () => regenerate(e) }, 'Open'))))
    : h('p', { class: 'muted small' }, 'Your last 20 fills appear here (values only, never the documents).');

  const waiting = outbox.length
    ? h('div', { class: 'banner info' }, `${outbox.length} Google Sheets fill(s) waiting to be sent. They go out automatically when you are online.`,
      outbox.some((o) => o.error) ? h('div', {}, `Last problem: ${outbox.find((o) => o.error).error}`) : null,
      online() && state.settings.proxyUrl ? h('div', {}, h('button', { class: 'btn small', type: 'button', style: { marginTop: '6px' }, onclick: () => flushOutbox(true) }, 'Send now')) : null)
    : null;
  screen(
    h('h2', {}, 'Your forms'),
    waiting,
    forms,
    h('h3', {}, 'Recent fills'),
    hist,
    h('p', { class: 'muted small', style: { marginTop: '24px' } }, 'Everything stays on this device and works offline. Install it: browser menu → "Add to Home Screen".'),
  );
  bar(
    h('button', { class: 'btn primary', type: 'button', onclick: addTemplate }, '+ Excel form'),
    h('button', { class: 'btn', type: 'button', onclick: renderAddSheet }, '+ Google Sheet'),
  );
}

async function regenerate(entry) {
  const record = await store.getTemplate(entry.templateHash);
  if (!record) { toast('That form was removed, so this fill cannot be re-made.'); return; }
  await openRecord(record);
  state.fill = newFill();
  state.fill.values = { ...entry.values };
  state.fill.rows = (entry.rows || []).map((r) => ({ ...r }));
  state.fill.fileName = entry.fileName;
  state.fill.source = 'history';
  renderReview();
}

// ---------------------------------------------------------------- setup / confirm fields

function renderSetup() {
  const rec = state.record;
  const map = rec.map;
  const tpl = state.tpl;
  const rerender = () => renderSetup();

  const onCell = (ref) => {
    const sheet = X.getSheet(tpl, state.sheet);
    const p = X.parseRef(ref);
    const m = X.mergeAt(sheet, p.row, p.col);
    const target = m ? X.makeRef(m.c1, m.r1) : ref;
    const existing = map.fields.find((f) => f.sheet === state.sheet && f.cell === target);
    if (existing) {
      const el = document.getElementById(`f-${existing.name}`);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.querySelector('input')?.focus(); }
      return;
    }
    const blocker = X.writeBlocker(tpl, state.sheet, target);
    if (blocker) { toast(blocker); return; }
    const cell = X.cellInfo(sheet, target, tpl.styles);
    if (String(cell.value || '').trim()) { toast(`${target} already has text ("${String(cell.value).slice(0, 30)}"). Tap an empty cell to add a field.`); return; }
    const f = manualField(tpl, state.sheet, target, map.fields);
    map.fields.push(f);
    toast(`Added "${f.name}" at ${target}. Rename it below if needed.`);
    rerender();
    setTimeout(() => document.getElementById(`f-${f.name}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };

  const fieldRows = map.fields.map((f, i) => {
    const conf = f.manual ? null : f.confidence < 0.75 ? h('span', { class: 'chip warn' }, 'Check') : null;
    return h('div', { class: 'fieldrow', id: `f-${f.name}` },
      h('div', { class: 'head' }, h('span', { class: 'chip' }, `${tpl.sheets.length > 1 ? `${f.sheet}!` : ''}${f.cell}`), f.label ? h('span', { class: 'muted small grow' }, `label: ${f.label}`) : h('span', { class: 'grow' }), conf,
        h('button', { class: 'btn small danger', type: 'button', onclick: () => { map.fields.splice(i, 1); rerender(); } }, 'Remove')),
      h('div', { class: 'threecol' },
        h('label', { class: 'field' }, h('span', {}, 'Name'), h('input', { type: 'text', value: f.name, onchange: (e) => { const v = slugify(e.target.value); if (map.fields.some((o) => o !== f && o.name === v)) { toast('Another field already has that name.'); e.target.value = f.name; return; } f.name = v; e.target.value = v; } })),
        h('label', { class: 'field' }, h('span', {}, 'Type'), h('select', { onchange: (e) => { f.type = e.target.value; } }, FIELD_TYPES.map((t) => h('option', { value: t, selected: f.type === t }, TYPE_LABELS[t])))),
        h('label', { class: 'field' }, h('span', {}, 'Required'), h('select', { onchange: (e) => { f.required = e.target.value === 'yes'; } }, h('option', { value: 'no', selected: !f.required }, 'No'), h('option', { value: 'yes', selected: f.required }, 'Yes')))),
      h('label', { class: 'field' }, h('span', {}, 'Hint for reading documents (optional)'), h('input', { type: 'text', value: f.hint || '', placeholder: 'e.g. issue date, not due date', onchange: (e) => { f.hint = e.target.value.trim(); } })));
  });

  const t = map.table;
  const tableCard = t
    ? h('div', { class: 'card' },
      h('div', { class: 'row' }, h('strong', { class: 'grow' }, `Line items on ${t.sheet}: rows ${t.startRow}–${t.startRow + t.maxRows - 1}`), h('button', { class: 'btn small danger', type: 'button', onclick: () => { map.table = null; rerender(); } }, 'Remove table')),
      h('p', { class: 'muted small' }, 'Rows are filled downwards, never inserted. Columns with formulas (like line totals) are left alone and recalculate when the file opens.'),
      h('div', { class: 'twocol' },
        h('label', { class: 'field' }, h('span', {}, 'First row'), h('input', { type: 'number', min: 1, value: t.startRow, onchange: (e) => { t.startRow = Math.max(1, Number(e.target.value) || t.startRow); rerender(); } })),
        h('label', { class: 'field' }, h('span', {}, 'Maximum rows'), h('input', { type: 'number', min: 1, max: 500, value: t.maxRows, onchange: (e) => { t.maxRows = Math.max(1, Math.min(500, Number(e.target.value) || t.maxRows)); rerender(); } }))),
      h('div', { class: 'list' }, Object.entries(t.columns).map(([name, col]) => h('div', { class: 'row' },
        h('input', { type: 'text', value: name, class: 'grow', style: { flex: '2' }, 'aria-label': 'Column name', onchange: (e) => { const v = slugify(e.target.value); const next = {}; const labels = {}; for (const [k, c] of Object.entries(t.columns)) { next[k === name ? v : k] = c; labels[k === name ? v : k] = (t.labels || {})[k] || k; } t.columns = next; t.labels = labels; rerender(); } }),
        h('input', { type: 'text', value: col, style: { flex: '0 0 70px' }, 'aria-label': 'Column letter', onchange: (e) => { t.columns[name] = e.target.value.toUpperCase().replace(/[^A-Z]/g, '') || col; rerender(); } }),
        h('button', { class: 'btn small danger', type: 'button', onclick: () => { delete t.columns[name]; rerender(); } }, '×')))),
      h('button', { class: 'btn small', type: 'button', style: { marginTop: '8px' }, onclick: () => { let n = 'column'; let i = 2; while (t.columns[n]) n = `column_${i++}`; t.columns[n] = 'A'; rerender(); } }, '+ Column'))
    : h('div', { class: 'card' }, h('p', { class: 'muted small' }, 'No line-item table. If the form has one, enter its first empty row:'),
      h('div', { class: 'row' },
        h('input', { type: 'number', min: 2, placeholder: 'First empty row, e.g. 12', id: 'new-table-row', class: 'grow' }),
        h('button', { class: 'btn small', type: 'button', onclick: () => addTableAt(Number(document.getElementById('new-table-row').value)) }, 'Add table')));

  screen(
    h('h2', {}, rec.confirmed ? `Fields: ${rec.name}` : `Check the fields: ${rec.name}`),
    rec.recheck ? h('div', { class: 'banner warn' }, 'This looks like an edited version of a form you saved before. Its fields were copied over; check the cells still line up.') : null,
    h('p', { class: 'muted small' }, 'Highlighted cells will be filled. Tap an empty cell to add a field; tap a highlighted one to edit it.'),
    sheetTabs(rerender),
    renderGrid(state.sheet, { marks: mapMarks(map, state.sheet), onCell }),
    h('p', { class: 'small muted' }, h('span', { class: 'chip' }, 'blue'), ' fields  ', h('span', { class: 'chip ok' }, 'green'), ' line items'),
    map.skipped && map.skipped.length ? h('details', { class: 'card' }, h('summary', {}, `Left blank on purpose (${map.skipped.length})`), h('p', { class: 'muted small' }, 'Signatures and office-use cells are never filled. Tap one in the grid to add it anyway.'), h('ul', { class: 'small' }, map.skipped.map((s) => h('li', {}, `${s.cell} ${s.label} — ${s.reason}`)))) : null,
    h('h3', {}, `Fields (${map.fields.length})`),
    map.fields.length ? h('div', { class: 'list' }, fieldRows) : h('p', { class: 'muted' }, 'No fields found. Tap the empty cells to fill in the grid above.'),
    h('h3', {}, 'Line items'),
    tableCard,
    h('h3', {}, 'Output'),
    h('div', { class: 'card' },
      h('label', { class: 'field' }, h('span', {}, 'File name pattern'), h('input', { type: 'text', value: map.outputName || suggestOutputName(map.templateId, map.fields), onchange: (e) => { map.outputName = e.target.value.trim(); } })),
      h('p', { class: 'muted small' }, `Use {field_name}, {templateId} and {date} (today). Fields: ${map.fields.map((f) => `{${f.name}}`).join(' ')}`),
      h('label', { class: 'field' }, h('span', {}, 'Dates in documents are written'), h('select', { onchange: (e) => { map.dateOrder = e.target.value; } },
        h('option', { value: 'DMY', selected: (map.dateOrder || 'DMY') === 'DMY' }, 'Day / month / year (28/09/2026)'),
        h('option', { value: 'MDY', selected: map.dateOrder === 'MDY' }, 'Month / day / year (09/28/2026)')))),
    h('details', { class: 'card' }, h('summary', {}, 'Field map file'),
      h('p', { class: 'muted small' }, 'Share the map with the template so a colleague skips this step.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', type: 'button', onclick: exportMap }, 'Export map (.json)'),
        h('button', { class: 'btn small', type: 'button', onclick: importMap }, 'Load map'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { if (confirm('Detect fields again? Your edits on this screen are replaced.')) { rec.map = detectFields(tpl, { templateId: map.templateId, templateHash: rec.hash, dateOrder: map.dateOrder }); rerender(); } } }, 'Detect again'),
        state.settings.proxyUrl ? h('button', { class: 'btn small', type: 'button', onclick: async () => { if (await nameWithAI(false)) rerender(); } }, 'Name fields with AI') : null)),
    rec.confirmed ? h('button', { class: 'btn danger block', type: 'button', style: { marginTop: '12px' }, onclick: deleteCurrent }, 'Delete this form') : null,
  );
  bar(
    h('button', { class: 'btn', type: 'button', onclick: () => renderHome() }, rec.confirmed ? 'Back' : 'Cancel'),
    h('button', { class: 'btn primary', type: 'button', onclick: confirmMap }, rec.confirmed ? 'Save' : 'Looks right — save'),
  );
}

function addTableAt(row) {
  const sheet = X.getSheet(state.tpl, state.sheet);
  if (!row || row < 2) { toast('Enter the number of the first empty row of the table.'); return; }
  const columns = {};
  const labels = {};
  for (let c = 1; c <= sheet.maxCol; c++) {
    const head = sheet.cells.get(X.makeRef(c, row - 1));
    const below = sheet.cells.get(X.makeRef(c, row));
    if (!head || !String(head.value || '').trim() || (below && below.formula)) continue;
    let n = slugify(head.value);
    while (columns[n]) n += '_2';
    columns[n] = X.numToCol(c);
    labels[n] = String(head.value).trim();
  }
  if (!Object.keys(columns).length) { toast(`Row ${row - 1} has no column headings above row ${row}.`); return; }
  state.record.map.table = { name: 'line_items', sheet: state.sheet, startRow: row, maxRows: 10, columns, labels };
  renderSetup();
}

async function confirmMap() {
  const rec = state.record;
  const map = rec.map;
  if (!map.fields.length && !map.table) { toast('Add at least one field first.'); return; }
  for (const f of map.fields) {
    const b = X.writeBlocker(state.tpl, f.sheet, f.cell);
    if (b) { toast(`${f.name}: ${b}`, 5000); return; }
  }
  map.templateHash = rec.hash;
  if (!map.outputName) map.outputName = suggestOutputName(map.templateId, map.fields);
  const wasConfirmed = rec.confirmed;
  rec.confirmed = true;
  rec.recheck = false;
  try {
    await store.putTemplate(rec);
    if (rec.replaces && rec.replaces !== rec.hash) { await store.deleteTemplate(rec.replaces); rec.replaces = null; await store.putTemplate(rec); }
    await store.persist();
  } catch (e) { toast(`Could not save: ${e.message}`); return; }
  toast('Saved.');
  if (wasConfirmed) renderHome(); else startFill();
}

async function deleteCurrent() {
  if (!confirm(`Delete "${state.record.name}" and its field map from this device?`)) return;
  await store.deleteTemplate(state.record.hash);
  renderHome();
}

function publicMap(map) {
  const { templateId, templateHash, fields, table, outputName, dateOrder } = map;
  return {
    templateId, templateHash, dateOrder,
    fields: fields.map(({ name, sheet, cell, type, hint, required, label }) => ({ name, sheet, cell, type, ...(hint ? { hint } : {}), ...(required ? { required: true } : {}), ...(label ? { label } : {}) })),
    table: table || null,
    outputName,
  };
}

function exportMap() {
  const json = JSON.stringify(publicMap(state.record.map), null, 2);
  download(new Blob([json], { type: 'application/json' }), `${state.record.map.templateId || 'form'}.fieldmap.json`);
}

async function importMap() {
  const [file] = await pickFiles({ accept: '.json,application/json' });
  if (!file) return;
  try {
    const m = JSON.parse(await file.text());
    if (!Array.isArray(m.fields)) throw new Error('This is not a FormFill field map.');
    const bad = m.fields.find((f) => !f.name || !f.cell || !X.getSheet(state.tpl, f.sheet));
    if (bad) throw new Error(`Field "${bad.name || '?'}" points at a sheet this form does not have.`);
    if (m.templateHash && m.templateHash !== state.record.hash && !confirm('This map was made for a different version of the form. Load it anyway and check the cells?')) return;
    state.record.map = { ...state.record.map, ...m, templateHash: state.record.hash, fields: m.fields.map((f) => ({ type: 'text', hint: '', required: false, confidence: 1, ...f })) };
    renderSetup();
    toast('Map loaded. Check the highlighted cells, then save.');
  } catch (e) { toast(e.message, 5000); }
}

// ---------------------------------------------------------------- fill: documents

function newFill() {
  return { docs: [], values: {}, rows: [], results: null, notes: [], fileName: '', source: null, written: null };
}

function startFill() {
  state.fill = newFill();
  renderDocs();
}

function renderDocs() {
  const fill = state.fill;
  const rec = state.record;
  const useAI = state.settings.useAI && aiReady();

  const addFiles = (files) => {
    for (const file of files) {
      const kind = documentKind(file);
      if (!kind) { toast(`${file.name}: use PDF, Word (.docx) or a photo.`); continue; }
      fill.docs.push({ file, kind, status: 'waiting' });
    }
    renderDocs();
  };

  const drop = h('div', { class: 'drop' },
    h('p', {}, 'Add the invoice, letter or certificate the values come from.'),
    h('div', { class: 'row', style: { justifyContent: 'center' } },
      h('button', { class: 'btn', type: 'button', onclick: async () => addFiles(await pickFiles({ accept: 'image/*', capture: 'environment' })) }, 'Take photo'),
      h('button', { class: 'btn', type: 'button', onclick: async () => addFiles(await pickFiles({ accept: '.pdf,.docx,image/*,application/pdf', multiple: true })) }, 'Choose files')),
    h('p', { class: 'muted small' }, 'PDF (typed or scanned), Word .docx, JPG or PNG.'));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); });

  const modeNote = state.settings.proxyUrl
    ? (online()
      ? h('label', { class: 'row small', style: { marginTop: '8px' } }, h('input', { type: 'checkbox', checked: state.settings.useAI, onchange: async (e) => { state.settings.useAI = e.target.checked; await store.setSetting('useAI', e.target.checked); renderDocs(); } }), 'Read with the AI (sends the document to your proxy). Off: read on this device only.')
      : h('div', { class: 'banner info' }, 'Offline: documents are read on this device. The AI is used again when you are back online.'))
    : h('p', { class: 'muted small' }, 'Documents are read on this device; nothing is uploaded.');

  screen(
    h('h2', {}, `Fill: ${rec.name}`),
    drop,
    fill.docs.length ? h('div', { class: 'list', style: { marginTop: '12px' } }, fill.docs.map((d, i) => h('div', { class: 'item' },
      h('div', { class: 'grow' }, h('div', { class: 't' }, d.file.name), h('div', { class: 'muted small', id: `doc-status-${i}` }, d.error || d.status)),
      h('button', { class: 'btn small danger', type: 'button', onclick: () => { fill.docs.splice(i, 1); renderDocs(); } }, 'Remove')))) : null,
    h('div', { class: 'progress hidden', id: 'read-progress', style: { marginTop: '12px' } }, h('div')),
    modeNote,
  );
  bar(
    h('button', { class: 'btn', type: 'button', onclick: () => { fill.results = null; renderReview(); } }, 'Type values myself'),
    h('button', { class: 'btn primary', type: 'button', disabled: !fill.docs.length, onclick: () => readAll(useAI) }, useAI ? 'Read with AI' : 'Read documents'),
  );
}

async function readAll(useAI) {
  const fill = state.fill;
  const map = state.record.map;
  const dateOrder = map.dateOrder || state.settings.dateOrder;
  const buttons = $barInner.querySelectorAll('button');
  buttons.forEach((b) => { b.disabled = true; });
  const prog = document.getElementById('read-progress');
  prog.classList.remove('hidden');
  const setStatus = (i, s) => { const el = document.getElementById(`doc-status-${i}`); if (el) el.textContent = s; };
  const docs = [];
  fill.notes = [];
  try {
    for (let i = 0; i < fill.docs.length; i++) {
      const d = fill.docs[i];
      setStatus(i, 'Reading…');
      prog.firstChild.style.width = `${Math.round((i / fill.docs.length) * 100)}%`;
      try {
        d.doc = await readDocument(d.file, { wantImages: useAI, onStatus: (s) => setStatus(i, s) });
        d.status = d.doc.scanned ? (useAI ? 'Scan: the AI reads the page images' : 'Scan read on this device') : 'Text read';
        setStatus(i, d.status);
        docs.push(d.doc);
        for (const [page, q] of Object.entries(d.doc.quality || {})) {
          if (q < 0.6) fill.notes.push({ kind: 'warn', text: `${d.file.name}${d.doc.pages > 1 ? ` page ${page}` : ''} looks blurry or unclear, so its values may be wrong. Retake the photo in good light for better results.`, retake: true });
        }
      } catch (e) {
        d.error = e.message || 'Could not read this file.';
        setStatus(i, d.error);
      }
    }
    if (!docs.length) throw new Error('None of the documents could be read.');
    prog.firstChild.style.width = '100%';
    let result = null;
    if (useAI) {
      try {
        toast('Asking the AI…', 60000);
        result = await extractWithAI(proxy(), map, docs, { dateOrder });
      } catch (e) {
        fill.notes.push({ kind: 'warn', text: `The AI could not be used (${e.message}). Values were read on this device instead.` });
        // Scans were kept as images for the AI; read them here now.
        for (let i = 0; i < docs.length; i++) {
          if (docs[i].images && docs[i].images.length) {
            const d = fill.docs.find((x) => x.doc === docs[i]);
            docs[i] = await readDocument(d.file, { wantImages: false, onStatus: (s) => toast(s) });
          }
        }
      }
    }
    if (!result) result = extractOnDevice(map, docs, { dateOrder });
    fill.source = result.source;
    fill.documents = result.documents || [result];
    fill.baseNotes = fill.notes.slice();
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    if (fill.documents.length > 1) renderChooseDocument();
    else { applyDocument(0); renderReview(); }
  } catch (e) {
    toast(e.message || 'Reading failed.', 6000);
    buttons.forEach((b) => { b.disabled = false; });
    prog.classList.add('hidden');
  }
}

// Loads one document's values into the fill.
function applyDocument(index) {
  const fill = state.fill;
  const map = state.record.map;
  const dateOrder = map.dateOrder || state.settings.dateOrder;
  const doc = fill.documents[index];
  fill.docIndex = index;
  fill.results = { ...doc, source: fill.source };
  fill.values = {};
  fill.fileName = '';
  for (const f of map.fields) {
    const r = doc.fields[f.name];
    let v = r && r.value != null ? String(r.value) : '';
    // Show dates in the user's own order.
    if (f.type === 'date' && v) { const d = parseDate(v, dateOrder); if (d) v = formatDate(d, dateOrder); }
    fill.values[f.name] = v;
  }
  fill.rows = (doc.rows || []).map((r) => ({ ...r }));
  fill.notes = (fill.baseNotes || []).slice();
  if (fill.documents.length > 1) fill.notes.unshift({ kind: 'info', text: `Document ${index + 1} of ${fill.documents.length}: ${doc.label}` });
  if (doc.moreRows > 0) fill.notes.push({ kind: 'warn', text: `The document has ${doc.moreRows} more line item(s) than the form's ${map.table.maxRows} rows. Only the first ${map.table.maxRows} are filled.` });
}

// Several invoices in one upload: ask which one, or fill one file per document.
function renderChooseDocument() {
  const fill = state.fill;
  fill.queue = [];
  screen(
    h('h2', {}, `${fill.documents.length} documents found`),
    h('p', { class: 'muted small' }, 'These files hold more than one invoice or form. Pick the one to fill, or fill one file for each; you check every one before it is written.'),
    h('div', { class: 'list' }, fill.documents.map((d, i) => h('div', { class: 'item' },
      h('div', { class: 'grow' }, h('div', { class: 't' }, d.label || `Document ${i + 1}`),
        h('div', { class: 'muted small' }, `${Object.values(d.fields).filter((r) => r.value != null).length} of ${state.record.map.fields.length} fields found${d.rows && d.rows.length ? ` · ${d.rows.length} line item(s)` : ''}`)),
      h('button', { class: 'btn small primary', type: 'button', onclick: () => { applyDocument(i); renderReview(); } }, 'Fill this one')))),
  );
  bar(
    h('button', { class: 'btn', type: 'button', onclick: () => renderDocs() }, 'Back'),
    h('button', { class: 'btn primary', type: 'button', onclick: () => { fill.queue = fill.documents.map((_, i) => i).slice(1); applyDocument(0); renderReview(); } }, `One file per document (${fill.documents.length})`),
  );
}

// ---------------------------------------------------------------- review

function targetCell(sheetName, ref) {
  const sheet = X.getSheet(state.tpl, sheetName);
  const p = X.parseRef(ref);
  const m = X.mergeAt(sheet, p.row, p.col);
  return X.cellInfo(sheet, m ? X.makeRef(m.c1, m.r1) : ref, state.tpl.styles);
}

function columnType(name, label, cell) {
  return guessType(label || name.replace(/_/g, ' '), cell);
}

// Checks every value and builds the list of cell writes.
function evaluate() {
  const map = state.record.map;
  const fill = state.fill;
  const opts = { dateOrder: map.dateOrder || state.settings.dateOrder, date1904: state.tpl.date1904 };
  const checks = {};
  const writes = [];
  for (const f of map.fields) {
    const cell = targetCell(f.sheet, f.cell);
    const v = validateValue(f, fill.values[f.name], { ...opts, cell });
    checks[f.name] = v;
    if (v.write) {
      writes.push({ sheet: f.sheet, cell: f.cell, value: v.write, display: v.display });
      // Written anyway, but flagged: the cell will cut it off or spill over.
      if (X.overflows(X.getSheet(state.tpl, f.sheet), cell.ref, state.tpl.styles, v.display)) {
        const cap = X.cellCapacity(X.getSheet(state.tpl, f.sheet), cell.ref, state.tpl.styles);
        v.long = `Longer than the cell shows (about ${cap.chars * cap.lines} characters fit). It will be written; the column width is not changed, so check the printed form.`;
      }
    }
  }
  const rowChecks = [];
  const t = map.table;
  if (t) {
    fill.rows.slice(0, t.maxRows).forEach((row, i) => {
      const rc = {};
      for (const [name, col] of Object.entries(t.columns)) {
        const ref = `${col}${t.startRow + i}`;
        const cell = targetCell(t.sheet, ref);
        const field = { name, type: columnType(name, (t.labels || {})[name], cell) };
        const v = validateValue(field, row[name], { ...opts, cell });
        rc[name] = v;
        if (v.write) {
          writes.push({ sheet: t.sheet, cell: ref, value: v.write, display: v.display });
          if (X.overflows(X.getSheet(state.tpl, t.sheet), cell.ref, state.tpl.styles, v.display)) v.long = `${ref} is longer than the cell shows.`;
        }
      }
      rowChecks.push(rc);
    });
  }
  const missingRequired = map.fields.filter((f) => f.required && !String(fill.values[f.name] || '').trim());
  return { checks, rowChecks, writes, missingRequired };
}

function renderReview() {
  const map = state.record.map;
  const fill = state.fill;
  const results = fill.results;
  const dateOrder = map.dateOrder || state.settings.dateOrder;

  const writeBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => writeForm() }, isSheets(state.record) ? (aiReady() ? 'Write to Google Sheets' : 'Queue for Google Sheets') : 'Write form');
  const status = h('div', { class: 'small', id: 'review-status' });
  const refresh = () => {
    const ev = evaluate();
    writeBtn.disabled = ev.missingRequired.length > 0 || ev.writes.length === 0;
    const invalid = Object.values(ev.checks).filter((c) => !c.ok).length + ev.rowChecks.reduce((n, rc) => n + Object.values(rc).filter((c) => !c.ok).length, 0);
    const longRows = ev.rowChecks.flatMap((rc) => Object.values(rc).filter((c) => c.long).map((c) => c.long));
    status.replaceChildren(...nodesOf([
      ev.missingRequired.length ? h('div', { class: 'banner bad' }, `Required before writing: ${ev.missingRequired.map((f) => f.name).join(', ')}`) : null,
      invalid ? h('div', { class: 'banner warn' }, `${invalid} value(s) do not fit their cell and will be left blank. Fix or clear them.`) : null,
      longRows.length ? h('div', { class: 'banner warn' }, `Line items longer than their cells (written anyway): ${longRows.map((m) => m.split(' ')[0]).join(', ')}`) : null,
      h('p', { class: 'muted' }, `${ev.writes.length} cell(s) will be written.`)]));
    for (const f of map.fields) {
      const el = document.getElementById(`msg-${f.name}`);
      const c = ev.checks[f.name];
      if (el) { el.textContent = c.message || c.long || ''; el.className = 'small'; el.style.color = !c.ok ? 'var(--bad)' : c.long ? 'var(--warn)' : 'var(--muted)'; }
      const row = document.getElementById(`rv-${f.name}`);
      if (row) { row.classList.toggle('flag-bad', !c.ok || (f.required && c.empty)); row.classList.toggle('flag-warn', Boolean(c.long) || row.dataset.flagged === '1'); }
    }
    return ev;
  };

  const fieldRows = map.fields.map((f) => {
    const r = results && results.fields ? results.fields[f.name] : null;
    const chips = [];
    if (results) {
      if (!r || r.value == null) chips.push(h('span', { class: `chip ${f.required ? 'bad' : 'warn'}` }, 'Not found'));
      else if (r.confidence < LOW_CONFIDENCE) chips.push(h('span', { class: 'chip warn' }, `Check · ${Math.round(r.confidence * 100)}%`));
      else chips.push(h('span', { class: 'chip ok' }, `${Math.round(r.confidence * 100)}%`));
    }
    if (f.required) chips.push(h('span', { class: 'chip' }, 'Required'));
    let input;
    const onInput = (e) => { fill.values[f.name] = e.target.value; refresh(); };
    if (f.type === 'yesno') {
      const cur = String(fill.values[f.name] || '').toLowerCase();
      input = h('select', { onchange: onInput }, h('option', { value: '' }, '—'), h('option', { value: 'Yes', selected: /^y|true/.test(cur) }, 'Yes'), h('option', { value: 'No', selected: /^n|false/.test(cur) }, 'No'));
    } else {
      input = h('input', { type: 'text', value: fill.values[f.name] || '', inputmode: f.type === 'number' || f.type === 'currency' ? 'decimal' : null, placeholder: f.type === 'date' ? (dateOrder === 'MDY' ? 'MM/DD/YYYY' : 'DD/MM/YYYY') : TYPE_LABELS[f.type || 'text'], oninput: onInput, 'aria-label': f.name });
    }
    const flagged = results && (!r || r.value == null || r.confidence < LOW_CONFIDENCE);
    return h('div', { class: `fieldrow${flagged ? ' flag-warn' : ''}`, id: `rv-${f.name}`, 'data-flagged': flagged ? '1' : null },
      h('div', { class: 'head' }, h('span', { class: 'name grow' }, f.label || f.name), chips, h('span', { class: 'chip' }, f.cell)),
      input,
      r && r.snippet ? h('div', { class: 'snippet' }, `“${r.snippet}”${r.page ? ` · p${r.page}` : ''}`) : null,
      h('div', { id: `msg-${f.name}`, class: 'small' }));
  });

  let tableSection = null;
  const t = map.table;
  if (t) {
    const cols = Object.keys(t.columns);
    const tbody = h('tbody');
    const drawRows = () => {
      tbody.replaceChildren(...fill.rows.slice(0, t.maxRows).map((row, i) => h('tr', {},
        h('td', { class: 'muted' }, String(t.startRow + i)),
        cols.map((c) => h('td', {}, h('input', { type: 'text', value: row[c] || '', 'aria-label': `${c} row ${i + 1}`, oninput: (e) => { row[c] = e.target.value; refresh(); } }))),
        h('td', {}, h('button', { class: 'btn small danger', type: 'button', 'aria-label': 'Remove row', onclick: () => { fill.rows.splice(i, 1); drawRows(); refresh(); } }, '×')))));
    };
    drawRows();
    tableSection = h('div', { class: 'card' },
      h('strong', {}, `Line items (up to ${t.maxRows})`),
      h('div', { class: 'tablescroll' }, h('table', { class: 'linetable' }, h('thead', {}, h('tr', {}, h('th', {}, 'Row'), cols.map((c) => h('th', {}, (t.labels || {})[c] || c)), h('th', {}))), tbody)),
      h('button', { class: 'btn small', type: 'button', style: { marginTop: '8px' }, onclick: () => { if (fill.rows.length >= t.maxRows) { toast(`The form holds ${t.maxRows} rows.`); return; } fill.rows.push(Object.fromEntries(cols.map((c) => [c, '']))); drawRows(); } }, '+ Row'));
  }

  const nameValues = () => Object.fromEntries(map.fields.map((f) => [f.name, fill.values[f.name] || '']));
  const fileInput = h('input', { type: 'text', value: fill.fileName || outputFileName(map.outputName, nameValues(), { templateId: map.templateId }), onchange: (e) => { fill.fileName = e.target.value; } });

  screen(
    h('h2', {}, 'Check the values'),
    h('p', { class: 'muted small' }, results ? `Read ${results.source === 'ai' ? 'by the AI' : 'on this device'}. Nothing is written until you tap Write form.` : 'Type the values. Nothing is written until you tap Write form.'),
    fill.notes.map((n) => h('div', { class: `banner ${n.kind}` }, n.text, n.retake ? h('div', {}, h('button', { class: 'btn small', type: 'button', style: { marginTop: '6px' }, onclick: () => renderDocs() }, 'Retake / change documents')) : null)),
    h('div', { class: 'list' }, fieldRows),
    tableSection,
    h('div', { class: 'card' }, h('label', { class: 'field' }, h('span', {}, 'File name'), fileInput),
      h('button', { class: 'btn small', type: 'button', onclick: () => { fill.fileName = ''; fileInput.value = outputFileName(map.outputName, nameValues(), { templateId: map.templateId }); } }, 'Name from values')),
    status,
    h('div', { id: 'preview' }),
  );
  bar(
    h('button', { class: 'btn', type: 'button', onclick: () => showPreview() }, 'Preview'),
    writeBtn,
  );
  refresh();
}

function showPreview() {
  const ev = evaluate();
  const map = state.record.map;
  const box = document.getElementById('preview');
  const draw = () => {
    const ov = new Map();
    for (const w of ev.writes) if (w.sheet === state.sheet) ov.set(w.cell, w.display);
    box.replaceChildren(...nodesOf([h('h3', {}, 'Preview'), sheetTabs(draw), renderGrid(state.sheet, { marks: mapMarks(map, state.sheet), overrides: ov }),
      h('p', { class: 'muted small' }, 'Yellow cells get the new values. Formulas recalculate when the file is opened.')]));
  };
  draw();
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function writeForm() {
  const map = state.record.map;
  const fill = state.fill;
  const ev = evaluate();
  if (ev.missingRequired.length) { toast('Fill the required fields first.'); return; }
  let name = (fill.fileName || outputFileName(map.outputName, Object.fromEntries(map.fields.map((f) => [f.name, fill.values[f.name] || ''])), { templateId: map.templateId })).trim();
  if (!/\.xlsx$/i.test(name)) name += '.xlsx';
  const writes = ev.writes.map(({ sheet, cell, value }) => ({ sheet, cell, value }));
  const entry = { templateHash: state.record.hash, templateName: state.record.name, values: { ...fill.values }, rows: fill.rows.map((r) => ({ ...r })), fileName: name };
  try {
    if (isSheets(state.record)) return await writeSheet(name, writes, entry);
    const { bytes, skipped } = await X.fillTemplate(JSZip, state.tpl, writes);
    fill.written = { bytes, name, skipped, count: writes.length - skipped.length };
    await store.addHistory(entry);
    download(bytes, name, XLSX_TYPE);
    renderDone();
  } catch (e) {
    toast(`Could not write the form: ${e.message}`, 6000);
  }
}

// Google Sheets: a copy of the sheet gets the values. Offline, the fill waits
// in the outbox and goes out as soon as there is a connection.
async function writeSheet(name, writes, entry) {
  const fill = state.fill;
  const title = name.replace(/\.xlsx$/i, '');
  const item = { templateHash: state.record.hash, spreadsheetId: state.record.spreadsheetId, name: title, writes };
  if (!aiReady()) {
    entry.queued = true;
    item.historyId = await store.addHistory({ ...entry, fileName: title });
    await store.addOutbox(item);
    fill.written = { sheet: true, queued: true, name: title, count: writes.length, skipped: [] };
    return renderDone();
  }
  toast('Writing to Google Sheets…', 60000);
  const res = await sendSheetFill(item);
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  if (res.changed) return;
  await store.addHistory({ ...entry, fileName: title, url: res.url });
  fill.written = { sheet: true, url: res.url, name: title, count: res.written, skipped: res.skipped || [] };
  renderDone();
}

// Sends one Google Sheets fill. The sheet is read again first: if someone
// edited the form since its fields were confirmed, nothing is written and the
// user re-checks the map, as with an edited .xlsx.
async function sendSheetFill(item, { background = false } = {}) {
  const rec = await store.getTemplate(item.templateHash);
  const { layout, hash } = await inspectSheet(item.spreadsheetId);
  if (hash !== item.templateHash) {
    const msg = 'The Google Sheet was edited after its fields were confirmed. Check the fields again, then fill it.';
    if (!background && rec) {
      const tpl = sheetModel(layout);
      const map = { ...rec.map, templateHash: hash, fields: rec.map.fields.filter((f) => tpl.sheets.some((s) => s.name === f.sheet)) };
      await openRecord({ ...rec, hash, layout, map, confirmed: false, recheck: true, replaces: rec.hash });
      toast(msg, 6000);
      renderSetup();
    }
    return { changed: true, error: msg };
  }
  return callProxy(proxy(), 'sheets.fill', { spreadsheet: item.spreadsheetId, name: item.name, writes: item.writes });
}

let flushing = false;
async function flushOutbox(manual = false) {
  if (flushing || !aiReady()) return;
  flushing = true;
  try {
    const items = await store.listOutbox();
    let sent = 0;
    for (const item of items) {
      try {
        const res = await sendSheetFill(item, { background: true });
        if (res.changed) { await store.putOutbox({ ...item, error: res.error }); continue; }
        await store.deleteOutbox(item.id);
        const hist = (await store.listHistory()).find((e) => e.id === item.historyId);
        if (hist) await store.updateHistory({ ...hist, queued: false, url: res.url });
        sent++;
      } catch (e) {
        await store.putOutbox({ ...item, error: e.message });
      }
    }
    if (sent) toast(`${sent} queued Google Sheets fill(s) sent.`, 5000);
    else if (manual && items.length) toast('Nothing could be sent yet; see the note on the home screen.', 5000);
    if (sent || manual) { if (!state.fill && document.querySelector('main h2')?.textContent === 'Your forms') renderHome(); }
  } finally { flushing = false; }
}

function nextDocumentButton() {
  const fill = state.fill;
  if (!fill.queue || !fill.queue.length) return null;
  const next = fill.queue[0];
  return h('button', { class: 'btn primary block', type: 'button', onclick: () => { fill.queue.shift(); applyDocument(next); fill.written = null; renderReview(); } }, `Next document (${next + 1} of ${fill.documents.length})`);
}

function renderDone() {
  const w = state.fill.written;
  if (w.sheet) {
    const shareLink = w.url && navigator.share ? h('button', { class: 'btn block', type: 'button', onclick: async () => { try { await navigator.share({ title: w.name, url: w.url }); } catch (e) { if (e.name !== 'AbortError') toast('Sharing failed.'); } } }, 'Share link (WhatsApp, email…)') : null;
    screen(
      h('h2', {}, w.queued ? 'Queued for Google Sheets' : 'Form filled'),
      w.queued
        ? h('div', { class: 'banner info' }, `You are offline, so "${w.name}" will be written to Google Sheets as soon as you are back online. Nothing else is needed.`)
        : h('div', { class: 'banner ok' }, `${w.count} cell(s) written into a copy named "${w.name}" in your "FormFill output" Drive folder. The original form is unchanged.`),
      w.skipped.length ? h('div', { class: 'banner warn' }, 'Not written:', h('ul', {}, w.skipped.map((s) => h('li', {}, `${s.cell}: ${s.reason}`)))) : null,
      h('div', { class: 'list' },
        nextDocumentButton(),
        w.url ? h('a', { class: 'btn primary block', href: w.url, target: '_blank', rel: 'noopener', style: { textAlign: 'center', textDecoration: 'none' } }, 'Open in Google Sheets') : null,
        shareLink,
        w.url && !navigator.share ? h('a', { class: 'btn block', href: `https://wa.me/?text=${encodeURIComponent(`${w.name} ${w.url}`)}`, target: '_blank', rel: 'noopener', style: { textAlign: 'center', textDecoration: 'none' } }, 'Send on WhatsApp') : null,
        h('button', { class: 'btn block', type: 'button', onclick: () => startFill() }, 'Fill another'),
        h('button', { class: 'btn block', type: 'button', onclick: () => renderReview() }, 'Back to values')),
    );
    bar(h('button', { class: 'btn', type: 'button', onclick: () => renderHome() }, 'Home'));
    return;
  }
  const file = new File([w.bytes], w.name, { type: XLSX_TYPE });
  const canShare = Boolean(navigator.canShare && navigator.canShare({ files: [file] }));
  screen(
    h('h2', {}, 'Form filled'),
    h('div', { class: 'banner ok' }, `${w.count} cell(s) written into ${w.name}. Everything else in the form is unchanged.`),
    w.skipped.length ? h('div', { class: 'banner warn' }, 'Not written:', h('ul', {}, w.skipped.map((s) => h('li', {}, `${s.cell}: ${s.reason}`)))) : null,
    h('div', { class: 'list' },
      nextDocumentButton(),
      h('button', { class: `btn ${state.fill.queue && state.fill.queue.length ? '' : 'primary '}block`, type: 'button', onclick: () => download(w.bytes, w.name, XLSX_TYPE) }, 'Download again'),
      canShare ? h('button', { class: 'btn block', type: 'button', onclick: async () => { try { await navigator.share({ files: [file], title: w.name, text: w.name }); } catch (e) { if (e.name !== 'AbortError') toast('Sharing failed; download the file and attach it instead.'); } } }, 'Share (WhatsApp, email…)') : h('p', { class: 'muted small' }, 'To send it, attach the downloaded file in WhatsApp or your email app.'),
      h('button', { class: 'btn block', type: 'button', onclick: () => startFill() }, 'Fill another'),
      h('button', { class: 'btn block', type: 'button', onclick: () => renderReview() }, 'Back to values')),
  );
  bar(h('button', { class: 'btn', type: 'button', onclick: () => renderHome() }, 'Home'));
}

// ---------------------------------------------------------------- settings

async function ocrCached() {
  if (!('caches' in window)) return false;
  try {
    for (const url of OCR_FILES) if (!(await caches.match(url))) return false;
    return true;
  } catch { return false; }
}

async function renderSettings() {
  const s = state.settings;
  const urlIn = h('input', { type: 'url', value: s.proxyUrl, placeholder: 'https://script.google.com/macros/s/…/exec' });
  const tokIn = h('input', { type: 'password', value: s.proxyToken, placeholder: 'the ACCESS_TOKEN you set in the script' });
  const ocrStatus = h('span', { class: 'chip' }, 'checking…');
  const ocrBtn = h('button', { class: 'btn small', type: 'button', onclick: async () => {
    ocrBtn.disabled = true;
    try { await prefetchOcr((k) => { ocrStatus.textContent = `${Math.round(k * 100)}%`; }); ocrStatus.textContent = 'Ready offline'; ocrStatus.className = 'chip ok'; } catch (e) { toast(`Download failed: ${e.message}`); ocrBtn.disabled = false; }
  } }, 'Download now (≈11 MB)');
  ocrCached().then((ok) => { ocrStatus.textContent = ok ? 'Ready offline' : 'Not downloaded yet'; ocrStatus.className = `chip ${ok ? 'ok' : 'warn'}`; ocrBtn.classList.toggle('hidden', ok); });

  screen(
    h('h2', {}, 'Settings'),
    h('div', { class: 'card' },
      h('h3', { style: { marginTop: 0 } }, 'Reading scans and photos offline'),
      h('p', { class: 'small muted' }, 'Typed PDFs and Word files are read offline straight away. Scans and photos need the text-recognition pack; it downloads once and then works without a connection.'),
      h('div', { class: 'row' }, ocrStatus, ocrBtn)),
    h('div', { class: 'card' },
      h('h3', { style: { marginTop: 0 } }, 'Proxy: AI, Google Sheets and Drive (optional, needs a connection)'),
      h('p', { class: 'small muted' }, 'With the Google Apps Script proxy set up (see apps-script/Code.gs), documents are read by the AI when you are online (better at messy scans and unusual layouts), new forms get their fields named by the AI, Google Sheets forms can be filled, and forms can be kept in Drive. The API key stays in the script. With AI reading on, documents pass through the AI provider; nothing is stored.'),
      h('label', { class: 'field' }, h('span', {}, 'Proxy URL'), urlIn),
      h('label', { class: 'field' }, h('span', {}, 'Access token'), tokIn),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', type: 'button', onclick: async () => {
          s.proxyUrl = urlIn.value.trim(); s.proxyToken = tokIn.value.trim();
          await store.setSetting('proxyUrl', s.proxyUrl); await store.setSetting('proxyToken', s.proxyToken);
          toast('Saved.');
        } }, 'Save'),
        h('button', { class: 'btn small', type: 'button', onclick: async () => {
          if (!online()) { toast('You are offline.'); return; }
          try { const r = await pingProxy(urlIn.value.trim(), tokIn.value.trim()); toast(r.ai ? 'The proxy answered. AI, Google Sheets and Drive are ready.' : 'The proxy answered. Google Sheets and Drive are ready; add ANTHROPIC_API_KEY to the script for AI.', 5000); } catch (e) { toast(`Test failed: ${e.message}`, 6000); }
        } }, 'Test'))),
    h('div', { class: 'card' },
      h('h3', { style: { marginTop: 0 } }, 'New forms'),
      h('label', { class: 'field' }, h('span', {}, 'Default date order in documents'), h('select', { onchange: async (e) => { s.dateOrder = e.target.value; await store.setSetting('dateOrder', s.dateOrder); } },
        h('option', { value: 'DMY', selected: s.dateOrder === 'DMY' }, 'Day / month / year'),
        h('option', { value: 'MDY', selected: s.dateOrder === 'MDY' }, 'Month / day / year'))),
      h('label', { class: 'row small' }, h('input', { type: 'checkbox', checked: s.aiNaming, onchange: async (e) => { s.aiNaming = e.target.checked; await store.setSetting('aiNaming', s.aiNaming); } }),
        'Let the AI name and type the fields of a new form when online (only the form\'s labels are sent, never documents).')),
    h('div', { class: 'card' },
      h('h3', { style: { marginTop: 0 } }, 'Forms in Google Drive'),
      h('p', { class: 'small muted' }, 'Keep your forms and their confirmed field maps in a "FormFill templates" folder in the Drive of the account that runs your proxy, so another phone or a colleague can restore them.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', type: 'button', onclick: backupToDrive }, 'Back up all forms'),
        h('button', { class: 'btn small', type: 'button', onclick: restoreFromDrive }, 'Restore from Drive'))),
    h('div', { class: 'card' },
      h('h3', { style: { marginTop: 0 } }, 'Privacy'),
      h('p', { class: 'small muted' }, 'Forms, field maps and the last 20 fills (values only) are stored in this browser. Documents are never stored after a fill. With AI reading on, documents are sent to your proxy and the AI provider to be read.'),
      h('button', { class: 'btn small danger', type: 'button', onclick: async () => { if (!confirm('Clear the fill history?')) return; for (const e of await store.listHistory()) await store.deleteHistory(e.id); toast('History cleared.'); } }, 'Clear history')),
  );
  bar(h('button', { class: 'btn', type: 'button', onclick: () => renderHome() }, 'Done'));
}

// ---------------------------------------------------------------- Drive templates

async function backupToDrive() {
  if (!aiReady()) { toast(online() ? 'Set up the proxy first.' : 'Backing up needs a connection.'); return; }
  const all = (await store.listTemplates()).filter((t) => t.confirmed);
  if (!all.length) { toast('No confirmed forms to back up yet.'); return; }
  let done = 0;
  try {
    for (const t of all) {
      toast(`Backing up ${t.name}…`, 60000);
      await callProxy(proxy(), 'drive.save', {
        name: t.name, hash: t.hash, kind: t.kind || 'xlsx', spreadsheetId: t.spreadsheetId || null,
        map: publicMap(t.map), xlsxBase64: isSheets(t) ? null : toBase64(t.bytes),
      });
      done++;
    }
    toast(`${done} form(s) saved to the "FormFill templates" folder in Drive.`, 5000);
  } catch (e) { toast(`Backup stopped after ${done}: ${e.message}`, 6000); }
}

async function restoreFromDrive() {
  if (!aiReady()) { toast(online() ? 'Set up the proxy first.' : 'Restoring needs a connection.'); return; }
  try {
    toast('Looking in Drive…', 60000);
    const { templates } = await callProxy(proxy(), 'drive.list');
    const have = new Set((await store.listTemplates()).map((t) => t.hash));
    const missing = (templates || []).filter((t) => !have.has(t.hash));
    let added = 0;
    for (const t of missing) {
      toast(`Restoring ${t.name}…`, 60000);
      const { template } = await callProxy(proxy(), 'drive.get', { name: t.name });
      const map = { ...template.map, fields: (template.map.fields || []).map((f) => ({ type: 'text', hint: '', required: false, confidence: 1, ...f })) };
      if (template.kind === 'gsheet') {
        const { layout, hash } = await inspectSheet(template.spreadsheetId);
        await store.putTemplate({ hash, name: template.name, kind: 'gsheet', spreadsheetId: layout.spreadsheetId, url: layout.url, layout, map: { ...map, templateHash: hash }, confirmed: hash === template.hash, recheck: hash !== template.hash, addedAt: Date.now() });
      } else {
        const bytes = fromBase64(template.xlsxBase64 || '');
        await X.openTemplate(JSZip, bytes);
        const hash = await X.sha256Hex(bytes);
        await store.putTemplate({ hash, name: template.name, bytes, map: { ...map, templateHash: hash }, confirmed: hash === template.hash, recheck: hash !== template.hash, addedAt: Date.now() });
      }
      added++;
    }
    toast(added ? `${added} form(s) restored from Drive.` : 'Every form in Drive is already on this device.', 5000);
  } catch (e) { toast(`Restore failed: ${e.message}`, 6000); }
}

// ---------------------------------------------------------------- start

function updateNet() {
  const el = document.getElementById('net');
  el.textContent = online() ? 'Online' : 'Offline';
}

async function init() {
  document.getElementById('home-link').addEventListener('click', () => renderHome());
  document.getElementById('settings-btn').addEventListener('click', () => renderSettings());
  window.addEventListener('online', () => { updateNet(); flushOutbox(); });
  window.addEventListener('offline', updateNet);
  updateNet();
  if (!JSZip) { screen(h('div', { class: 'banner bad' }, 'FormFill could not load its files. Reload the page once while online.')); return; }
  try {
    state.settings.proxyUrl = await store.getSetting('proxyUrl', '');
    state.settings.proxyToken = await store.getSetting('proxyToken', '');
    state.settings.dateOrder = await store.getSetting('dateOrder', 'DMY');
    state.settings.useAI = await store.getSetting('useAI', true);
    state.settings.aiNaming = await store.getSetting('aiNaming', true);
  } catch (e) {
    screen(h('div', { class: 'banner bad' }, `Storage is not available (${e.message}). Private browsing can block it.`));
    return;
  }
  renderHome();
  flushOutbox();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw && nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('FormFill was updated. It will use the new version next time you open it.', 5000); });
      });
    } catch { /* offline support unavailable; the app still works online */ }
  }
}

init();
