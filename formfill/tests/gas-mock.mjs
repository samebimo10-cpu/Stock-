// Runs apps-script/Code.gs under Node with in-memory stand-ins for the Google
// services it uses (SpreadsheetApp, DriveApp, UrlFetchApp, ...), so the proxy
// is tested without a Google account. The AI is replaced by a function that
// receives the request payload and returns the reply text.

import fs from 'node:fs';
import vm from 'node:vm';

const colNum = (s) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colLetters = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
function parseA1(a1) {
  const [a, b] = a1.split(':');
  const p = (x) => { const m = /^([A-Z]+)(\d+)$/i.exec(x); return { r: Number(m[2]), c: colNum(m[1]) }; };
  const s = p(a); const e = b ? p(b) : s;
  return { r1: s.r, c1: s.c, r2: e.r, c2: e.c };
}
const a1Of = (r1, c1, r2, c2) => (r1 === r2 && c1 === c2 ? `${colLetters(c1)}${r1}` : `${colLetters(c1)}${r1}:${colLetters(c2)}${r2}`);

// sheet data: { name, cells: { A1: { v, f, bold, bg, fmt } }, merges: ['B4:C4'], widths: {}, locked: ['B9'] }
function makeSpreadsheet(id, spec, registry) {
  let n = 0;
  const ss = {
    id, name: spec.name, sheets: spec.sheets.map((s) => ({ ...s, id: ++n, cells: JSON.parse(JSON.stringify(s.cells)) })),
  };
  const sheetApi = (sh) => {
    const cell = (r, c) => sh.cells[`${colLetters(c)}${r}`] || {};
    const used = () => {
      let lr = 0; let lc = 0;
      for (const k of Object.keys(sh.cells)) { const p = parseA1(k); if (sh.cells[k].v !== '' && sh.cells[k].v != null) { lr = Math.max(lr, p.r1); lc = Math.max(lc, p.c1); } }
      return { lr, lc };
    };
    const range = (r1, c1, r2, c2) => {
      const grid = (fn) => { const out = []; for (let r = r1; r <= r2; r++) { const row = []; for (let c = c1; c <= c2; c++) row.push(fn(cell(r, c))); out.push(row); } return out; };
      const merges = () => (sh.merges || []).map(parseA1).filter((m) => m.r1 <= r2 && m.r2 >= r1 && m.c1 <= c2 && m.c2 >= c1);
      return {
        getValues: () => grid((x) => (x.v == null ? '' : x.v)),
        getDisplayValues: () => grid((x) => (x.v == null ? '' : String(x.v))),
        getFormulas: () => grid((x) => x.f || ''),
        getFontWeights: () => grid((x) => (x.bold ? 'bold' : 'normal')),
        getBackgrounds: () => grid((x) => x.bg || '#ffffff'),
        getNumberFormats: () => grid((x) => x.fmt || '0.###############'),
        getWraps: () => grid(() => false),
        getMergedRanges: () => merges().map((m) => range(m.r1, m.c1, m.r2, m.c2)),
        isPartOfMerge: () => merges().length > 0,
        getFormula: () => cell(r1, c1).f || '',
        getCell: (r, c) => range(r1 + r - 1, c1 + c - 1, r1 + r - 1, c1 + c - 1),
        getA1Notation: () => a1Of(r1, c1, r2, c2),
        getSheet: () => api,
        setValue: (v) => { const k = `${colLetters(c1)}${r1}`; sh.cells[k] = { ...(sh.cells[k] || {}), v: typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v, text: typeof v === 'string' && v.startsWith("'"), f: '' }; },
      };
    };
    const api = {
      getName: () => sh.name,
      getSheetId: () => sh.id,
      isSheetHidden: () => false,
      getLastRow: () => used().lr,
      getLastColumn: () => used().lc,
      getMaxRows: () => 1000,
      getMaxColumns: () => 26,
      getRange: (a, b, c, d) => {
        if (typeof a === 'string') { const m = parseA1(a); return range(m.r1, m.c1, m.r2, m.c2); }
        return range(a, b, a + (c || 1) - 1, b + (d || 1) - 1);
      },
      getColumnWidth: (c) => (sh.widths && sh.widths[c]) || 100,
      getRowHeight: () => 21,
      isRowHiddenByUser: () => false,
      getProtections: () => [],
    };
    return api;
  };
  const api = {
    getName: () => ss.name,
    getId: () => ss.id,
    getUrl: () => `https://docs.google.com/spreadsheets/d/${ss.id}/edit`,
    getSpreadsheetLocale: () => 'en_GB',
    getSheets: () => ss.sheets.map(sheetApi),
    getSheetByName: (name) => { const sh = ss.sheets.find((s) => s.name === name); return sh ? sheetApi(sh) : null; },
    getProtections: () => ss.sheets.flatMap((sh) => (sh.locked || []).map((a1) => ({ getRange: () => sheetApi(sh).getRange(a1) }))),
  };
  registry.set(id, { ss, api });
  return api;
}

export function makeGas({ spreadsheets = {}, ai = () => '{}', token = 'secret', apiKey = 'test-key' } = {}) {
  const registry = new Map();
  for (const [id, spec] of Object.entries(spreadsheets)) makeSpreadsheet(id, spec, registry);
  const folders = new Map();
  const aiCalls = [];
  let copies = 0;
  const makeFile = (name, bytes, mime) => {
    const f = { name, bytes, mime, trashed: false };
    return Object.assign(f, {
      getName: () => f.name,
      setTrashed: (t) => { f.trashed = t; },
      getBlob: () => ({ getDataAsString: () => Buffer.from(f.bytes).toString('utf8'), getBytes: () => [...f.bytes] }),
    });
  };
  const folder = (name) => {
    if (!folders.has(name)) {
      const files = [];
      const iter = (list) => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
      folders.set(name, {
        files,
        getUrl: () => `https://drive.google.com/drive/folders/${encodeURIComponent(name)}`,
        getFilesByName: (n) => iter(files.filter((f) => f.name === n && !f.trashed)),
        getFiles: () => iter(files.filter((f) => !f.trashed)),
        createFile: (a, b, mime) => {
          const file = typeof a === 'string' ? makeFile(a, Buffer.from(b, 'utf8'), mime) : makeFile(a.name, a.bytes, a.mime);
          files.push(file);
          return file;
        },
      });
    }
    return folders.get(name);
  };
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => ({ ACCESS_TOKEN: token, ANTHROPIC_API_KEY: apiKey }[k] || null) }) },
    ContentService: { createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }), MimeType: { JSON: 'json' } },
    UrlFetchApp: {
      fetch: (url, opts) => {
        const payload = JSON.parse(opts.payload);
        aiCalls.push({ url, headers: opts.headers, payload });
        const text = ai(payload);
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ model: payload.model, stop_reason: 'end_turn', content: [{ type: 'text', text }] }) };
      },
    },
    SpreadsheetApp: {
      openById: (id) => { const e = registry.get(id); if (!e) throw new Error(`No spreadsheet ${id}`); return e.api; },
      flush: () => {},
      ProtectionType: { RANGE: 'RANGE', SHEET: 'SHEET' },
    },
    DriveApp: {
      getFileById: (id) => ({
        makeCopy: (name) => {
          const src = registry.get(id).ss;
          const newId = `copy${++copies}xxxxxxxxxxxxxxxxxxxxxxxx`;
          makeSpreadsheet(newId, { name, sheets: src.sheets.map((s) => ({ name: s.name, cells: s.cells, merges: s.merges, widths: s.widths, locked: s.locked })) }, registry);
          return { getId: () => newId };
        },
      }),
      getFoldersByName: (name) => { let done = !folders.has(name); return { hasNext: () => !done, next: () => { done = true; return folders.get(name); } }; },
      createFolder: (name) => folder(name),
    },
    Utilities: {
      base64Decode: (s) => [...Buffer.from(s, 'base64')],
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
      newBlob: (bytes, mime, name) => ({ name, bytes: Buffer.from(bytes), mime }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), ctx);
  return {
    post: (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text),
    sheet: (id) => registry.get(id).ss,
    copies: () => [...registry.keys()].filter((k) => k.startsWith('copy')),
    aiCalls,
    folders,
  };
}
