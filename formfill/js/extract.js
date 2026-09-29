// On-device extraction: finding each field's value in a document's text with
// no connection at all.
//
// Documents arrive as lines of text (from pdf.js, mammoth or on-device OCR),
// where a tab separates cells that sat apart on the page. For each field the
// reader looks for its label (and common ways of writing it: "Invoice #",
// "Inv. No.", "Amount due") and takes the text after it on the same line, in
// the next cell, or on the next line. The value must also look right for the
// field's type; a date field never takes "Lagos" just because it followed
// "Date". Each result carries a confidence and the line it came from, the same
// shape the AI proxy returns, so the review screen treats both alike.

import { parseDate, parseNumber, parseYesNo } from './normalize.js';

// Words that mean the same thing on forms and invoices. Each group is matched
// as whole words after normalising.
const SYNONYMS = [
  ['no', 'number', 'num', '#', 'nr', 'ref', 'reference'],
  ['invoice', 'inv', 'bill'],
  ['date', 'dated', 'date of issue', 'issue date', 'issued'],
  ['total', 'grand total', 'amount due', 'total due', 'balance due', 'total amount', 'amount payable', 'total payable', 'net total'],
  ['subtotal', 'sub total', 'sub-total'],
  ['vat', 'tax', 'sales tax'],
  ['phone', 'tel', 'telephone', 'mobile', 'cell', 'phone number', 'gsm'],
  ['email', 'e-mail', 'email address', 'mail'],
  ['address', 'addr', 'location'],
  ['supplier', 'vendor', 'seller', 'from', 'company'],
  ['customer', 'client', 'buyer', 'bill to', 'billed to', 'sold to'],
  ['name', 'full name', 'names'],
  ['dob', 'date of birth', 'birth date', 'born'],
  ['qty', 'quantity', 'units', 'pcs', 'no of units'],
  ['description', 'item', 'items', 'details', 'particulars', 'product', 'service', 'item description'],
  ['unit price', 'price', 'rate', 'unit cost', 'price per unit', 'unit rate'],
  ['amount', 'line total', 'total', 'value', 'cost'],
  ['account', 'acct', 'a/c', 'account number', 'account no'],
  ['due date', 'payment due', 'due by', 'pay by'],
  ['po', 'purchase order', 'order no', 'order number', 'p.o.'],
];

export function norm(s) {
  return String(s || '').toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[_]/g, ' ')
    .replace(/[“”"'’`]/g, '')
    // Tabs separate cells, so they survive; other runs of space collapse.
    .replace(/[^\S\t]+/g, ' ')
    .replace(/ *\t */g, '\t')
    .replace(/^ +| +$/g, '');
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// All the phrases worth searching for a field, strongest first, each with the
// confidence a match on it starts from.
export function labelPhrases(field) {
  const out = new Map();
  const add = (p, w) => { const n = norm(p).replace(/[:：*?]+$/, '').trim(); if (n && n.length >= 2 && !(out.get(n) >= w)) out.set(n, w); };
  if (field.label) add(field.label, 1);
  add(field.name, 0.9);
  // Swap in synonyms one word-group at a time: "invoice no" -> "invoice number", "inv #".
  for (const base of [...out.keys()]) {
    for (const group of SYNONYMS) {
      for (const word of group) {
        const re = new RegExp(`(^|\\s)${escapeRe(word)}(?=\\s|$)`);
        if (!re.test(base)) continue;
        for (const alt of group) if (alt !== word) add(base.replace(re, `$1${alt}`), 0.85);
      }
    }
  }
  // Hints like "issue date, not due date" add phrases; the "not ..." part is
  // collected separately as phrases to avoid.
  for (const part of String(field.hint || '').split(/[,;]| or /)) {
    const t = part.trim();
    if (t && !/^(not|excluding|except)\b/i.test(t)) add(t.replace(/\b(incl\.?|including|in)\b.*$/i, ''), 0.8);
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
}

export function avoidPhrases(field) {
  const out = [];
  for (const m of String(field.hint || '').matchAll(/\b(?:not|excluding|except)\s+(?:the\s+)?([^,;.]+)/gi)) out.push(norm(m[1]));
  return out.filter(Boolean);
}

// Cut a value out of the rest of the line: stop at the next cell, or at a
// second label on the same line ("Date: 01/02/2026   Invoice No: 55").
function trimValue(s) {
  let v = s.split('\t')[0];
  v = v.split(/\s{3,}/)[0];
  v = v.replace(/^[\s:：#=\-–—.)]+/, '').replace(/[\s,;|]+$/, '');
  return v.trim();
}

// The part of a candidate value that fits the field's type.
function fitType(type, text, dateOrder) {
  const s = String(text || '').trim();
  if (!s) return null;
  if (type === 'date') {
    const m = s.match(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?[\s-]+[A-Za-z]{3,9}\.?,?[\s-]+\d{2,4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}/);
    if (m && parseDate(m[0], dateOrder)) return m[0];
    return null;
  }
  if (type === 'number' || type === 'currency') {
    const m = s.match(/\(?-?(?:NGN|USD|EUR|GBP|₦|\$|€|£|N(?=\s?\d))?\s?-?\d[\d,.' ]*\d?\)?%?/i);
    if (!m) return null;
    const cleaned = m[0].trim().replace(/\s(?=\d{3}\b)/g, '');
    return parseNumber(cleaned) == null ? null : cleaned;
  }
  if (type === 'yesno') {
    const w = s.split(/\s+/)[0];
    return parseYesNo(w) == null ? null : w;
  }
  // Text: drop a trailing label that crept in from the next column.
  return s.length > 200 ? s.slice(0, 200) : s;
}

function findPhrase(line, phrase) {
  const re = new RegExp(`(^|[^a-z0-9])${escapeRe(phrase)}(?![a-z0-9])`, 'i');
  const m = re.exec(line);
  if (!m) return -1;
  return m.index + m[1].length;
}

// Every line where the field's label appears with a usable value, best
// candidate per line: [{ line, value, confidence, snippet, page }].
export function findMatches(field, doc, { dateOrder = 'DMY' } = {}) {
  const phrases = labelPhrases(field);
  const avoid = avoidPhrases(field);
  const type = field.type || 'text';
  const lines = doc.lines;
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    let best = null;
    const line = lines[i];
    const n = norm(line.text);
    if (!n) continue;
    if (avoid.some((a) => n.includes(a))) continue;
    for (const [phrase, weight] of phrases) {
      const at = findPhrase(n, phrase);
      if (at < 0) continue;
      // The label should start its cell ("Due Date" is not "Date").
      const cellStart = n.lastIndexOf('\t', at) + 1;
      const before = n.slice(cellStart, at).trim();
      const startFactor = before === '' ? 1 : before.length <= 3 ? 0.85 : 0.6;
      // Map the position back onto the original (un-normalised) text: both
      // have the same cells, so walk to the same cell and offset.
      const origCells = line.text.split('\t');
      const normCells = n.split('\t');
      const cellIdx = n.slice(0, at).split('\t').length - 1;
      const inCell = normCells[cellIdx] || '';
      const offset = inCell.indexOf(phrase) + phrase.length;
      let restOfCell = (origCells[cellIdx] || '').slice(offset);
      // "Supplier" matched inside "Supplier Name: …": the real label is
      // longer than the phrase, so this match counts for less.
      let labelFactor = 1;
      const longer = /^\s*[A-Za-z][\w .\/#&-]{0,24}?\s*[:：]\s*/.exec(restOfCell);
      if (longer && !/^\s*[:：]/.test(restOfCell)) { restOfCell = restOfCell.slice(longer[0].length); labelFactor = 0.75; }
      const candidates = [];
      const sameCell = trimValue(restOfCell);
      if (sameCell) candidates.push({ text: sameCell, f: 1 });
      const nextCell = origCells.slice(cellIdx + 1).find((c) => c.trim());
      if (nextCell) candidates.push({ text: trimValue(nextCell), f: sameCell ? 0.8 : 0.95 });
      // Label alone on its line: the value is usually on the next line.
      if (!sameCell) {
        for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
          const t = lines[j].text.trim();
          if (!t) continue;
          const cells = lines[j].text.split('\t');
          const pick = cells.length === origCells.length ? cells[cellIdx] : cells[0];
          candidates.push({ text: trimValue(pick || t), f: 0.8 });
          break;
        }
      }
      for (const cand of candidates) {
        const fitted = fitType(type, cand.text, dateOrder);
        const valid = fitted != null;
        const value = valid ? fitted : cand.text;
        if (!value) continue;
        // A text value that is itself a label (ends with ":") is not a value.
        if (type === 'text' && /[:：]$/.test(value)) continue;
        const conf = weight * startFactor * labelFactor * cand.f * (valid ? 1 : 0.35);
        if (!best || conf > best.confidence) {
          best = { line: i, value, confidence: Math.round(conf * 100) / 100, snippet: line.text.replace(/\t/g, '  ').trim().slice(0, 160), page: line.page || 1 };
        }
      }
    }
    if (best) out.push(best);
  }
  return out;
}

// Looks for one field in the document. Returns
// { value, confidence, snippet, page } or { value: null, confidence: 0 }.
export function findField(field, doc, opts = {}) {
  let best = null;
  for (const m of findMatches(field, doc, opts)) if (!best || m.confidence > best.confidence) best = m;
  if (!best) return { value: null, confidence: 0, snippet: '', page: null };
  best = { value: best.value, confidence: best.confidence, snippet: best.snippet, page: best.page };
  // Blurry OCR lowers everything read from that page.
  const q = doc.quality && doc.quality[best.page] != null ? doc.quality[best.page] : 1;
  best.confidence = Math.round(best.confidence * Math.min(1, Math.max(0.4, q)) * 100) / 100;
  return best;
}

function splitCells(text) {
  const t = text.includes('\t') ? text.split('\t') : text.split(/\s{2,}/);
  return t.map((c) => c.trim()).filter((c, i, a) => c !== '' || (i > 0 && i < a.length - 1));
}

function headerMatch(cell, colName, colLabel) {
  const c = norm(cell).replace(/[:.]+$/, '');
  if (!c) return 0;
  const targets = [norm(colLabel || ''), norm(colName)].filter(Boolean);
  for (const t of targets) if (c === t) return 1;
  for (const t of targets) {
    for (const group of SYNONYMS) {
      const hasT = group.some((w) => t === w || t.split(' ').includes(w));
      if (hasT && group.some((w) => c === w || c.split(' ').includes(w))) return 0.8;
    }
    if (c.includes(t) || t.includes(c)) return 0.7;
  }
  return 0;
}

// Splits a one-cell header line at the template's column names (or their
// synonyms), in the order they appear. Null when fewer than two are found.
function splitHeader(text, table) {
  const n = norm(text);
  const found = [];
  for (const name of Object.keys(table.columns)) {
    const words = new Set([norm((table.labels || {})[name] || ''), norm(name)]);
    for (const w of [...words]) for (const g of SYNONYMS) if (g.includes(w)) g.forEach((x) => words.add(x));
    let best = null;
    for (const w of words) {
      if (!w || w.length < 2) continue;
      const at = findPhrase(n, w);
      if (at >= 0 && (!best || w.length > best.w.length)) best = { at, w };
    }
    if (best && !found.some((f) => best.at < f.at + f.w.length && f.at < best.at + best.w.length)) found.push(best);
  }
  if (found.length < 2) return null;
  // Words between the matches (a column the form does not have) stay as
  // their own cells so the positions still line up with the data rows.
  found.sort((a, b) => a.at - b.at);
  const cells = [];
  let pos = 0;
  for (const f of found) {
    const gap = n.slice(pos, f.at).trim();
    if (gap) cells.push(gap);
    cells.push(n.slice(f.at, f.at + f.w.length));
    pos = f.at + f.w.length;
  }
  const tail = n.slice(pos).trim();
  if (tail) cells.push(...tail.split(' ').filter(Boolean));
  return cells;
}

// Finds the line-item rows for the template's table.
// Returns { rows: [{col: value}], more: n, snippet } where more > 0 when the
// document has more rows than the form holds.
export function findTable(table, doc) {
  if (!table) return { rows: [], more: 0 };
  const names = Object.keys(table.columns);
  const sources = [];
  for (const t of doc.tables || []) sources.push(t);
  // Lines with several cells, grouped into runs, stand in for tables in PDFs
  // and photos. A header whose words sit close together ("Description Qty
  // Unit price") comes through as one cell; it is split on the column names.
  let run = [];
  doc.lines.forEach((line, i) => {
    let cells = splitCells(line.text);
    if (cells.length < 2 && !run.length) {
      const next = doc.lines[i + 1] ? splitCells(doc.lines[i + 1].text) : [];
      if (next.length >= 2) cells = splitHeader(line.text, table) || cells;
    }
    if (cells.length >= 2) run.push(cells);
    else { if (run.length >= 2) sources.push(run); run = []; }
  });
  if (run.length >= 2) sources.push(run);

  let best = null;
  for (const rows of sources) {
    for (let h = 0; h < Math.min(rows.length - 1, 6); h++) {
      const header = rows[h];
      const map = {};
      let score = 0;
      for (const name of names) {
        let bi = -1; let bs = 0;
        header.forEach((cell, idx) => { const s = headerMatch(cell, name, table.labels && table.labels[name]); if (s > bs && !Object.values(map).includes(idx)) { bs = s; bi = idx; } });
        if (bi >= 0) { map[name] = bi; score += bs; }
      }
      const matched = Object.keys(map).length;
      if (matched < Math.min(2, names.length)) continue;
      if (!best || score > best.score) best = { score, map, rows: rows.slice(h + 1), header };
    }
  }
  if (!best) return { rows: [], more: 0 };

  const out = [];
  for (const cells of best.rows) {
    const first = norm(cells[0] || '');
    if (/^(sub ?total|total|grand total|vat|tax|amount due|balance|discount)\b/.test(first)) break;
    if (cells.every((c) => !String(c).trim())) break;
    // A row shorter than the header has lost an empty cell. Descriptions sit
    // on the left and numbers on the right, so keep the first column in place
    // and line the rest up from the right.
    const shift = Math.max(0, best.header.length - cells.length);
    const row = {};
    for (const [name, idx] of Object.entries(best.map)) {
      const i = shift && idx > 0 ? idx - shift : idx;
      const v = i >= 0 && i < cells.length && !(shift && idx > 0 && i === 0) ? cells[i] : '';
      row[name] = v == null ? '' : String(v).trim();
    }
    if (Object.values(row).some((v) => v)) out.push(row);
  }
  const max = table.maxRows || out.length;
  return { rows: out.slice(0, max), more: Math.max(0, out.length - max), snippet: best.header.join(' | ') };
}

function mergeDocs(docs) {
  const merged = { lines: [], tables: [], quality: {}, pageStarts: [] };
  let pageBase = 0;
  for (const d of docs) {
    let lastPage = null;
    for (const l of d.lines) {
      const page = (l.page || 1) + pageBase;
      if (page !== lastPage) { merged.pageStarts.push(merged.lines.length); lastPage = page; }
      merged.lines.push({ ...l, page });
    }
    for (const t of d.tables || []) merged.tables.push(t);
    for (const [p, q] of Object.entries(d.quality || {})) merged.quality[Number(p) + pageBase] = q;
    pageBase += d.pages || 1;
  }
  return merged;
}

const IDENTITY = /\b(invoice|receipt|order|ref|reference|no|number|id|certificate|policy|account|claim|voucher|serial)\b/i;

// Several invoices in one upload (a multi-page PDF, or a few photos) show up
// as the same label repeating with different values: "Invoice No: 101" and
// later "Invoice No: 102". Returns the line where each document starts, or
// [0] for a single document.
export function documentStarts(map, merged, opts = {}) {
  let anchor = null;
  map.fields.forEach((f, order) => {
    if ((f.type || 'text') !== 'text') return;
    const ms = findMatches(f, merged, opts).filter((m) => m.confidence >= 0.6);
    const firsts = new Map();
    for (const m of ms) { const k = norm(m.value); if (k && !firsts.has(k)) firsts.set(k, m.line); }
    if (firsts.size < 2) return;
    const score = firsts.size * 10 + (IDENTITY.test(`${f.label || ''} ${f.name}`) ? 5 : 0) + (f.required ? 2 : 0) - order * 0.01;
    if (!anchor || score > anchor.score) anchor = { score, lines: [...firsts.values()].sort((a, b) => a - b) };
  });
  if (!anchor) return [0];
  // Lines above the first anchor (a letterhead, a logo's caption) belong to
  // each document too, so every boundary moves up by that much, or to the
  // start of the anchor's page when that is closer.
  const lead = anchor.lines[0];
  const starts = [0];
  for (let k = 1; k < anchor.lines.length; k++) {
    const at = anchor.lines[k];
    const prev = anchor.lines[k - 1];
    const pageStart = [...merged.pageStarts].reverse().find((p) => p <= at && p > prev);
    let b = pageStart != null ? pageStart : at - lead;
    if (b <= prev) b = prev + 1;
    if (b <= starts[starts.length - 1]) continue;
    starts.push(b);
  }
  return starts;
}

function extractOne(map, doc, dateOrder) {
  const fields = {};
  for (const f of map.fields) fields[f.name] = findField(f, doc, { dateOrder });
  const table = findTable(map.table, doc);
  return { fields, rows: table.rows, moreRows: table.more };
}

// A short description of one document for the "which one?" choice.
export function documentLabel(map, fields, index) {
  const pick = (re) => map.fields.find((f) => re.test(`${f.label || ''} ${f.name}`) && fields[f.name] && fields[f.name].value);
  const parts = [];
  for (const f of [pick(IDENTITY), pick(/name|supplier|client|customer|company/i), map.fields.find((f) => f.type === 'date' && fields[f.name] && fields[f.name].value), map.fields.find((f) => f.type === 'currency' && fields[f.name] && fields[f.name].value)]) {
    if (f && !parts.includes(fields[f.name].value)) parts.push(fields[f.name].value);
  }
  return parts.length ? parts.join(' · ') : `Document ${index + 1}`;
}

// Runs extraction for every field and the table. Returns the first document's
// values at the top level and every document found in `documents`.
export function extractOnDevice(map, docs, { dateOrder = 'DMY' } = {}) {
  const merged = mergeDocs(docs);
  let starts = documentStarts(map, merged, { dateOrder });
  const split = (st) => st.map((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : merged.lines.length;
    const part = { lines: merged.lines.slice(start, end), tables: starts.length === 1 ? merged.tables : [], quality: merged.quality };
    const r = extractOne(map, part, dateOrder);
    return { ...r, label: documentLabel(map, r.fields, k), snippet: part.lines.slice(0, 1).map((l) => l.text).join('') };
  });
  let documents = split(starts);
  // A real second document carries most of the same fields. Two names on one
  // invoice ("Bill to" and "Ship to") do not, so that stays one document.
  if (documents.length > 1) {
    const found = (d) => map.fields.filter((f) => d.fields[f.name].value != null).length;
    const whole = split([0])[0];
    const need = Math.max(2, Math.ceil(found(whole) * 0.6));
    if (documents.some((d) => found(d) < need)) { starts = [0]; documents = [whole]; }
  }
  return { ...documents[0], documents, source: 'device' };
}
