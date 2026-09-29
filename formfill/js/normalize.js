// Turning extracted text into values a cell can hold, and saying when it can't.
//
// The AI (or the on-device reader) only proposes text. This module decides
// whether that text is a valid number, date or yes/no for the field, cleans it
// up (commas, ₦ and $ signs, day/month order) and produces the exact value the
// template engine writes.

import { dateToSerial, serialToDate } from './xlsx.js';

export const FIELD_TYPES = ['text', 'number', 'date', 'currency', 'yesno'];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function parseNumber(input) {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  let s = String(input).trim();
  if (!s) return null;
  let negative = false;
  // Currency words and signs, including the Naira written as N before a number.
  s = s.replace(/\b(NGN|USD|EUR|GBP|GHS|KES|ZAR|CAD|AUD|INR|naira|dollars?|kobo)\b\.?/gi, '')
    .replace(/[₦$€£¥₹¢]/g, '')
    .replace(/^\s*N(?=\s?[\d.,])/, '')
    .replace(/\s+/g, '');
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/^-/.test(s)) { negative = !negative; s = s.slice(1); }
  if (/-$/.test(s)) { negative = !negative; s = s.slice(0, -1); }
  if (/^\+/.test(s)) s = s.slice(1);
  const pct = /%$/.test(s);
  if (pct) s = s.slice(0, -1);
  if (!/^[\d.,']+$/.test(s) || !/\d/.test(s)) return null;
  s = s.replace(/'/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Whichever comes last is the decimal mark: 1,234.56 or 1.234,56.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // 1,234 and 12,345,678 are thousands; 12,5 is a decimal comma.
    const groups = s.split(',');
    const thousands = groups.length > 1 && groups.slice(1).every((g) => g.length === 3);
    s = thousands ? s.replace(/,/g, '') : (groups.length === 2 ? s.replace(',', '.') : null);
    if (s === null) return null;
  } else if (lastDot >= 0 && (s.match(/\./g) || []).length > 1) {
    const groups = s.split('.');
    if (!groups.slice(1).every((g) => g.length === 3)) return null;
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const v = negative ? -n : n;
  return pct ? v / 100 : v;
}

function validYmd(y, m, d) {
  if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1)) return null;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim ? { y, m, d } : null;
}

const year4 = (y) => {
  const n = Number(y);
  if (String(y).length <= 2) return n < 70 ? 2000 + n : 1900 + n;
  return n;
};

// order: 'DMY' (Nigeria, UK, most of the world) or 'MDY' (US). ISO dates
// (2026-09-28) are read the same way whatever the order.
export function parseDate(input, order = 'DMY') {
  if (input == null) return null;
  if (typeof input === 'object' && input.y) return validYmd(input.y, input.m, input.d);
  const s = String(input).trim().replace(/(\d)(st|nd|rd|th)\b/gi, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!s) return null;
  let m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/.exec(s);
  if (m) {
    const a = +m[1]; const b = +m[2]; const y = year4(m[3]);
    // An impossible day/month pair tells us the order regardless of the setting.
    if (a > 12 && b <= 12) return validYmd(y, b, a);
    if (b > 12 && a <= 12) return validYmd(y, a, b);
    return order === 'MDY' ? validYmd(y, a, b) : validYmd(y, b, a);
  }
  const monthIndex = (w) => MONTHS.indexOf(w.slice(0, 3).toLowerCase()) + 1;
  m = /(\d{1,2})[\s-]*([A-Za-z]{3,9})\.?[\s-]*(\d{2,4})\b/.exec(s);
  if (m && monthIndex(m[2]) > 0) return validYmd(year4(m[3]), monthIndex(m[2]), +m[1]);
  m = /([A-Za-z]{3,9})\.?[\s-]*(\d{1,2})[\s-]+(\d{4})\b/.exec(s);
  if (m && monthIndex(m[1]) > 0) return validYmd(+m[3], monthIndex(m[1]), +m[2]);
  return null;
}

export function formatDate(d, order = 'DMY') {
  if (!d) return '';
  const dd = String(d.d).padStart(2, '0');
  const mm = String(d.m).padStart(2, '0');
  return order === 'MDY' ? `${mm}/${dd}/${d.y}` : `${dd}/${mm}/${d.y}`;
}

export function parseYesNo(input) {
  const s = String(input ?? '').trim().toLowerCase();
  if (['yes', 'y', 'true', '1', '✓', '✔', 'x', 'checked', 'ticked'].includes(s)) return true;
  if (['no', 'n', 'false', '0', '✗', 'unchecked', 'none', 'nil'].includes(s)) return false;
  return null;
}

// Checks one field's value and turns it into what gets written.
// Returns { ok, empty, write, display, message }.
//   write   - the value for the template engine, or null when nothing is written
//   message - why the value will not be written (shown in review)
// cell is the target cell's info from the template (its number format kind).
export function validateValue(field, raw, { dateOrder = 'DMY', date1904 = false, cell = null } = {}) {
  const text = raw == null ? '' : String(raw).trim();
  if (!text) return { ok: true, empty: true, write: null, display: '', message: field.required ? 'Required: add a value.' : '' };
  const cellKind = cell && cell.style ? cell.style.kind : 'general';
  const type = field.type || 'text';

  if (type === 'number' || type === 'currency') {
    const n = parseNumber(text);
    if (n == null) return { ok: false, write: null, display: text, message: `"${text}" is not a number, so it will not be written.` };
    return { ok: true, write: { kind: 'number', number: n }, display: text };
  }
  if (type === 'date') {
    const d = parseDate(text, dateOrder);
    if (!d) return { ok: false, write: null, display: text, message: `"${text}" is not a date FormFill can read, so it will not be written.` };
    // A date serial only shows as a date in a date-formatted cell; anywhere
    // else the date goes in as text so it reads the same as on the document.
    if (cellKind !== 'date') return { ok: true, write: { kind: 'text', text: formatDate(d, dateOrder) }, display: formatDate(d, dateOrder), date: d };
    return { ok: true, write: { kind: 'number', number: dateToSerial(d.y, d.m, d.d, date1904) }, display: formatDate(d, dateOrder), date: d };
  }
  if (type === 'yesno') {
    const b = parseYesNo(text);
    if (b == null) return { ok: false, write: null, display: text, message: `Use Yes or No for this field.` };
    return { ok: true, write: { kind: 'text', text: b ? 'Yes' : 'No' }, display: b ? 'Yes' : 'No' };
  }
  // Text into a cell that is formatted as a number or date would show as text
  // in a cell meant for sums; flag it rather than write it.
  if ((cellKind === 'number' || cellKind === 'currency') && parseNumber(text) == null) {
    return { ok: false, write: null, display: text, message: `The form's cell expects a number; "${text}" will not be written.` };
  }
  if (cellKind === 'date' && !parseDate(text, dateOrder)) {
    return { ok: false, write: null, display: text, message: `The form's cell expects a date; "${text}" will not be written.` };
  }
  if (cellKind === 'date') {
    const d = parseDate(text, dateOrder);
    return { ok: true, write: { kind: 'number', number: dateToSerial(d.y, d.m, d.d, date1904) }, display: formatDate(d, dateOrder) };
  }
  if (cellKind === 'number' || cellKind === 'currency') return { ok: true, write: { kind: 'number', number: parseNumber(text) }, display: text };
  return { ok: true, write: { kind: 'text', text }, display: text };
}

// The text a cell shows in previews (dates as dates, not serial numbers).
export function displayCell(cell, { date1904 = false, dateOrder = 'DMY' } = {}) {
  if (!cell || cell.value === '' || cell.value == null) return '';
  if (cell.numeric && cell.style && cell.style.kind === 'date') {
    const n = Number(cell.value);
    if (Number.isFinite(n) && n > 0 && n < 2958466) return formatDate(serialToDate(Math.floor(n), date1904), dateOrder);
  }
  if (cell.numeric) {
    const n = Number(cell.value);
    if (Number.isFinite(n) && cell.style && (cell.style.kind === 'currency' || /0\.00/.test(cell.style.numFmt))) return n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (Number.isFinite(n) && !Number.isInteger(n)) return String(Math.round(n * 1e6) / 1e6);
  }
  return String(cell.value);
}

export function slugify(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/#/g, ' no ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'field';
}

// Output file name from a pattern such as {templateId}_{supplier}_{invoice_date}.xlsx.
// {date} is today's date; unknown or empty placeholders drop out cleanly.
export function outputFileName(pattern, values, { templateId = 'form', today = new Date() } = {}) {
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const lookup = { templateId, date: iso, ...values };
  let name = String(pattern || '{templateId}_{date}.xlsx').replace(/\{([\w.-]+)\}/g, (_, k) => {
    const v = lookup[k];
    return v == null ? '' : String(v).replace(/\//g, '-');
  });
  name = name.replace(/\.xlsx$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[_\s-]{2,}/g, (m) => (m.includes('_') ? '_' : m[0]))
    .replace(/^[_\s.-]+|[_\s.-]+$/g, '')
    .slice(0, 120);
  return `${name || templateId || 'form'}.xlsx`;
}
