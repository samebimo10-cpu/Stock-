// Google Sheets forms.
//
// A Google Sheets form lives online, so FormFill never holds the file. The
// Apps Script server reads its layout (sheets.inspect) and this module turns
// that layout into the same shape as an opened .xlsx template, so detection,
// the confirm screen, previews and value checks all work unchanged. Filling
// goes back through the server (sheets.fill), which copies the sheet and sets
// only the mapped cells' values; Sheets keeps formatting when only values are
// set. Fills made offline wait in a queue and are sent when the device is
// back online.

import { parseRange, makeRef, formatKind } from './xlsx.js';

// Sheets' "Automatic" number format; it means General, not a number format.
const AUTOMATIC = new Set(['', 'General', '0.###############']);

export function sheetModel(layout) {
  const xfs = [{ numFmtId: 0, numFmt: 'General', kind: 'general', bold: false, fill: { filled: false, rgb: null }, border: { left: false, right: false, top: false, bottom: false }, locked: true, wrap: false, shrink: false }];
  const styleIndex = new Map([['||', 0]]);
  const styleOf = (bold, bg, fmt, wrap) => {
    const code = AUTOMATIC.has(fmt || '') ? 'General' : fmt;
    const key = `${bold ? 1 : 0}|${bg || ''}|${code === 'General' ? '' : code}${wrap ? '|w' : ''}`;
    if (styleIndex.has(key)) return styleIndex.get(key);
    xfs.push({
      numFmtId: -1, numFmt: code, kind: formatKind(-1, code === 'General' ? null : code), bold: Boolean(bold),
      fill: { filled: Boolean(bg), rgb: bg || null }, border: { left: false, right: false, top: false, bottom: false },
      locked: true, wrap: Boolean(wrap), shrink: false,
    });
    styleIndex.set(key, xfs.length - 1);
    return xfs.length - 1;
  };
  const styles = { xfs };
  let hasFormulas = false;
  const sheets = layout.sheets.map((sh) => {
    const cells = new Map();
    let maxRow = 0;
    let maxCol = 0;
    for (const [row, col, shown, formula, bold, bg, fmt, numeric, wrap] of sh.cells) {
      const s = styleOf(bold, bg, fmt, wrap);
      const ref = makeRef(col, row);
      if (formula) hasFormulas = true;
      cells.set(ref, { ref, row, col, t: numeric ? 'n' : 'str', s, value: shown, formula: Boolean(formula), numeric: false, style: xfs[s] });
      if (shown !== '' || formula) { maxRow = Math.max(maxRow, row); maxCol = Math.max(maxCol, col); }
    }
    const rowsInfo = new Map();
    (sh.heights || []).forEach((h, i) => { rowsInfo.set(i + 1, { s: null, customFormat: false, ht: h ? h * 0.75 : null, hidden: h === 0 }); });
    const cols = (sh.widths || []).map((w, i) => ({ min: i + 1, max: i + 1, width: w / 7, style: null, hidden: w === 0 }));
    const merges = (sh.merges || []).map(parseRange).filter(Boolean);
    for (const m of merges) { maxRow = Math.max(maxRow, m.r2); maxCol = Math.max(maxCol, m.c2); }
    // Styled blank cells (shaded input boxes) count towards the used area.
    for (const c of cells.values()) if (c.style.fill.filled) { maxRow = Math.max(maxRow, c.row); maxCol = Math.max(maxCol, c.col); }
    return {
      name: sh.name, path: null, state: sh.hidden ? 'hidden' : 'visible', cells, rowsInfo, merges, cols,
      protected: Boolean(sh.protectedSheet),
      unlockedRanges: (sh.unprotected || []).map(parseRange).filter(Boolean),
      lockedRanges: (sh.locked || []).map(parseRange).filter(Boolean),
      maxRow, maxCol, defaultColWidth: 100 / 7, defaultRowHeight: 15.75,
    };
  });
  return { kind: 'gsheet', spreadsheetId: layout.spreadsheetId, url: layout.url, bytes: null, date1904: false, sheets, styles, hasFormulas };
}

// Changes to the form's text, merges or protection change the hash, so an
// edited form is re-checked before it is filled.
export async function layoutHash(layout) {
  const essence = layout.sheets.map((s) => [s.name, s.cells.filter((c) => c[2] !== '' || c[3]).map((c) => [c[0], c[1], c[2], c[3]]), s.merges, s.locked, s.protectedSheet]);
  const bytes = new TextEncoder().encode(JSON.stringify(essence));
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function isSheetsUrl(s) {
  return /docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]{20,}/.test(String(s || '')) || /^[a-zA-Z0-9_-]{30,}$/.test(String(s || '').trim());
}
