// Template engine for FormFill.
//
// The one hard rule of the app lives here: the output file is the template file
// with only the mapped cells' values changed. Nothing in this module loads the
// workbook into a spreadsheet library and saves it again, because that is how
// fonts, borders, logos and print setup get lost. Instead the .xlsx package is
// opened as a zip, the few <c> nodes that receive a value are rewritten in place
// as text, and every other part is copied across untouched.
//
// Reading (for auto-detection, previews and type checks) uses small regex-based
// parsers so the module runs the same in the browser and under `node --test`.
// JSZip is passed in rather than imported, for the same reason.

// ---------------------------------------------------------------- references

export function colToNum(col) {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function numToCol(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export function parseRef(ref) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(String(ref).trim());
  if (!m) return null;
  return { col: colToNum(m[1]), row: Number(m[2]) };
}

export const makeRef = (col, row) => numToCol(col) + row;

export function parseRange(range) {
  const [a, b] = String(range).split(':');
  const s = parseRef(a);
  const e = b ? parseRef(b) : s;
  if (!s || !e) return null;
  return { r1: Math.min(s.row, e.row), c1: Math.min(s.col, e.col), r2: Math.max(s.row, e.row), c2: Math.max(s.col, e.col) };
}

// ---------------------------------------------------------------- XML helpers

export function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // Characters XML 1.0 does not allow at all; Excel would refuse the file.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
}

export function unescapeXml(s) {
  return String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e];
  });
}

export function parseAttrs(s) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s || ''))) out[m[1]] = unescapeXml(m[3] !== undefined ? m[3] : m[4]);
  return out;
}

// An element name with any namespace prefix, e.g. <x:c> as well as <c>.
const el = (name) => `(?:[A-Za-z_][\\w.-]*:)?${name}`;

// Every <name ...>...</name> or <name .../> inside xml, with its offsets.
export function findElements(xml, name, from = 0, to = xml.length) {
  const re = new RegExp(`<(${el(name)})(?=[\\s/>])([^>]*?)(/?)>`, 'g');
  re.lastIndex = from;
  const out = [];
  let m;
  while ((m = re.exec(xml)) && m.index < to) {
    const start = m.index;
    const tag = m[1];
    if (m[3] === '/') { out.push({ start, end: re.lastIndex, attrs: m[2], inner: null, openEnd: re.lastIndex, tag }); continue; }
    const close = `</${tag}>`;
    // Elements searched for here never nest inside themselves, so the first
    // matching close tag ends this one.
    const ci = xml.indexOf(close, re.lastIndex);
    if (ci < 0) break;
    out.push({ start, end: ci + close.length, attrs: m[2], inner: xml.slice(re.lastIndex, ci), openEnd: re.lastIndex, tag });
    re.lastIndex = ci + close.length;
  }
  return out;
}

const firstElement = (xml, name) => findElements(xml, name)[0] || null;

// Text of every <t> run, skipping phonetic hints (<rPh>) that Excel keeps for
// East Asian text and never shows in the cell.
function richText(inner) {
  if (!inner) return '';
  const clean = inner.replace(new RegExp(`<${el('rPh')}[\\s>][\\s\\S]*?</${el('rPh')}>`, 'g'), '');
  return findElements(clean, 't').map((t) => unescapeXml(t.inner || '')).join('');
}

// ---------------------------------------------------------------- number formats

const BUILTIN_FORMATS = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 5: '$#,##0_);($#,##0)', 6: '$#,##0_);[Red]($#,##0)',
  7: '$#,##0.00_);($#,##0.00)', 8: '$#,##0.00_);[Red]($#,##0.00)', 9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?',
  13: '# ??/??', 14: 'mm-dd-yy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM',
  20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yy h:mm', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)', 44: '_("$"* #,##0.00_)', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@',
};

export function formatKind(numFmtId, code) {
  const id = Number(numFmtId) || 0;
  if ((id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58)) return 'date';
  if (id === 49) return 'text';
  if ([5, 6, 7, 8, 42, 44].includes(id)) return 'currency';
  if (id >= 1 && id <= 13) return 'number';
  if (id >= 37 && id <= 48) return 'number';
  if (!code || code === 'General') return 'general';
  if (code === '@') return 'text';
  const bare = code.replace(/"[^"]*"/g, '').replace(/\\./g, '');
  if (/\[\$[^\]-]*[^\]\d-][^\]]*\]|[$€£¥₦₹]/.test(code)) return 'currency';
  const noBrackets = bare.replace(/\[[^\]]*\]/g, '');
  if (/[dy]/i.test(noBrackets) || /(^|[^0#?])[hs]/i.test(noBrackets) || /m{3,}/i.test(noBrackets)) return 'date';
  if (/[0#?]/.test(noBrackets)) return 'number';
  return 'general';
}

// ---------------------------------------------------------------- package parts

function resolveTarget(baseDir, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (baseDir ? baseDir.split('/') : []).concat(target.split('/'));
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

function parseRels(xml, baseDir) {
  const map = {};
  for (const r of findElements(xml || '', 'Relationship')) {
    const a = parseAttrs(r.attrs);
    if (a.TargetMode === 'External') continue;
    map[a.Id] = { type: a.Type || '', path: resolveTarget(baseDir, a.Target || '') };
  }
  return map;
}

function parseStyles(xml) {
  const numFmts = {};
  const nf = firstElement(xml, 'numFmts');
  if (nf) for (const f of findElements(nf.inner || '', 'numFmt')) { const a = parseAttrs(f.attrs); numFmts[a.numFmtId] = a.formatCode; }
  const fonts = [];
  const fe = firstElement(xml, 'fonts');
  if (fe) for (const f of findElements(fe.inner || '', 'font')) fonts.push({ bold: new RegExp(`<${el('b')}(?=[\\s/>])(?![^>]*val="(0|false)")`).test(f.inner || '') });
  const fills = [];
  const fl = firstElement(xml, 'fills');
  if (fl) {
    for (const f of findElements(fl.inner || '', 'fill')) {
      const p = firstElement(f.inner || '', 'patternFill');
      const pa = p ? parseAttrs(p.attrs) : {};
      const fg = p && p.inner ? firstElement(p.inner, 'fgColor') : null;
      const rgb = fg ? parseAttrs(fg.attrs).rgb : null;
      const solid = pa.patternType && pa.patternType !== 'none' && pa.patternType !== 'gray125';
      const gradient = /<(?:\w+:)?gradientFill/.test(f.inner || '');
      fills.push({ filled: Boolean(solid || gradient), rgb: solid && rgb && rgb.length >= 6 ? rgb.slice(-6) : null });
    }
  }
  const borders = [];
  const be = firstElement(xml, 'borders');
  if (be) {
    for (const b of findElements(be.inner || '', 'border')) {
      const sides = {};
      for (const side of ['left', 'right', 'top', 'bottom']) {
        const s = findElements(b.inner || '', side)[0];
        sides[side] = Boolean(s && parseAttrs(s.attrs).style && parseAttrs(s.attrs).style !== 'none');
      }
      borders.push(sides);
    }
  }
  const xfs = [];
  const cx = firstElement(xml, 'cellXfs');
  if (cx) {
    for (const x of findElements(cx.inner || '', 'xf')) {
      const a = parseAttrs(x.attrs);
      const prot = x.inner ? firstElement(x.inner, 'protection') : null;
      const align = x.inner ? firstElement(x.inner, 'alignment') : null;
      const aa = align ? parseAttrs(align.attrs) : {};
      const pa = prot ? parseAttrs(prot.attrs) : {};
      const numFmtId = Number(a.numFmtId || 0);
      const code = numFmts[numFmtId] || BUILTIN_FORMATS[numFmtId] || 'General';
      xfs.push({
        numFmtId,
        numFmt: code,
        kind: formatKind(numFmtId, numFmts[numFmtId]),
        bold: Boolean(fonts[Number(a.fontId || 0)] && fonts[Number(a.fontId || 0)].bold),
        fill: fills[Number(a.fillId || 0)] || { filled: false, rgb: null },
        border: borders[Number(a.borderId || 0)] || { left: false, right: false, top: false, bottom: false },
        locked: !(pa.locked === '0' || pa.locked === 'false'),
        wrap: aa.wrapText === '1' || aa.wrapText === 'true',
        shrink: aa.shrinkToFit === '1' || aa.shrinkToFit === 'true',
      });
    }
  }
  return { xfs };
}

const DEFAULT_XF = { numFmtId: 0, numFmt: 'General', kind: 'general', bold: false, fill: { filled: false, rgb: null }, border: { left: false, right: false, top: false, bottom: false }, locked: true, wrap: false, shrink: false };

function parseSheet(xml, sst, styles) {
  const cells = new Map();
  const rowsInfo = new Map();
  let maxRow = 0;
  let maxCol = 0;
  const sd = firstElement(xml, 'sheetData');
  if (sd && sd.inner) {
    let rowNo = 0;
    for (const row of findElements(sd.inner, 'row')) {
      const ra = parseAttrs(row.attrs);
      rowNo = ra.r ? Number(ra.r) : rowNo + 1;
      rowsInfo.set(rowNo, { s: ra.s !== undefined ? Number(ra.s) : null, customFormat: ra.customFormat === '1' || ra.customFormat === 'true', ht: ra.ht ? Number(ra.ht) : null, hidden: ra.hidden === '1' });
      let colNo = 0;
      for (const c of findElements(row.inner || '', 'c')) {
        const a = parseAttrs(c.attrs);
        const p = a.r ? parseRef(a.r) : null;
        colNo = p ? p.col : colNo + 1;
        const inner = c.inner || '';
        const hasF = new RegExp(`<${el('f')}(?=[\\s/>])`).test(inner);
        const vEl = firstElement(inner, 'v');
        const raw = vEl ? unescapeXml(vEl.inner || '') : '';
        let value = '';
        const t = a.t || 'n';
        if (t === 's') value = sst[Number(raw)] ?? '';
        else if (t === 'inlineStr') value = richText((firstElement(inner, 'is') || {}).inner);
        else if (t === 'b') value = raw === '1' ? 'TRUE' : raw === '' ? '' : 'FALSE';
        else value = raw;
        const s = a.s !== undefined ? Number(a.s) : 0;
        cells.set(makeRef(colNo, rowNo), {
          ref: makeRef(colNo, rowNo), row: rowNo, col: colNo, t, s, value, formula: hasF, numeric: t === 'n' && raw !== '',
          style: styles.xfs[s] || DEFAULT_XF,
        });
        if (colNo > maxCol) maxCol = colNo;
      }
      if (rowNo > maxRow) maxRow = rowNo;
    }
  }
  const merges = [];
  const mc = firstElement(xml, 'mergeCells');
  if (mc) for (const m of findElements(mc.inner || '', 'mergeCell')) { const r = parseRange(parseAttrs(m.attrs).ref); if (r) merges.push(r); }
  for (const m of merges) { if (m.r2 > maxRow) maxRow = m.r2; if (m.c2 > maxCol) maxCol = m.c2; }
  const cols = [];
  const ce = firstElement(xml, 'cols');
  if (ce) {
    for (const c of findElements(ce.inner || '', 'col')) {
      const a = parseAttrs(c.attrs);
      cols.push({ min: Number(a.min), max: Number(a.max), width: a.width ? Number(a.width) : null, style: a.style !== undefined ? Number(a.style) : null, hidden: a.hidden === '1' });
    }
  }
  const prot = firstElement(xml, 'sheetProtection');
  const pa = prot ? parseAttrs(prot.attrs) : {};
  const isProtected = Boolean(prot && (pa.sheet === '1' || pa.sheet === 'true'));
  const fmt = firstElement(xml, 'sheetFormatPr');
  const fa = fmt ? parseAttrs(fmt.attrs) : {};
  const defaultColWidth = fa.defaultColWidth ? Number(fa.defaultColWidth) : (fa.baseColWidth ? Number(fa.baseColWidth) + 0.71 : 8.43);
  const defaultRowHeight = fa.defaultRowHeight ? Number(fa.defaultRowHeight) : 15;
  return { cells, rowsInfo, merges, cols, protected: isProtected, maxRow, maxCol, defaultColWidth, defaultRowHeight };
}

export class TemplateError extends Error {}

// Opens an .xlsx template for reading. `bytes` is an ArrayBuffer or Uint8Array.
export async function openTemplate(JSZip, bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0) {
    throw new TemplateError('This file is password-protected or is an old .xls file. Remove the password (or save it as .xlsx in Excel) and try again.');
  }
  if (!(u8[0] === 0x50 && u8[1] === 0x4B)) throw new TemplateError('This is not an .xlsx file. Save the form from Excel as "Excel Workbook (.xlsx)" and try again.');
  let zip;
  try { zip = await JSZip.loadAsync(u8); } catch { throw new TemplateError('The file could not be opened as an .xlsx workbook. It may be damaged.'); }
  const read = async (p) => { const f = zip.file(p); return f ? f.async('string') : null; };

  const ct = (await read('[Content_Types].xml')) || '';
  if (zip.file(/vbaProject\.bin$/i).length || /macroEnabled/i.test(ct)) {
    throw new TemplateError('This workbook contains macros (.xlsm). FormFill only fills plain .xlsx forms for now; save a copy as .xlsx without macros.');
  }
  if (!ct.includes('spreadsheetml')) throw new TemplateError('This file is not an Excel workbook.');

  const rootRels = parseRels(await read('_rels/.rels'), '');
  const officeDoc = Object.values(rootRels).find((r) => /officeDocument$/.test(r.type));
  const workbookPath = officeDoc ? officeDoc.path : 'xl/workbook.xml';
  const wbDir = workbookPath.split('/').slice(0, -1).join('/');
  const wbXml = await read(workbookPath);
  if (!wbXml) throw new TemplateError('The workbook part is missing from this file.');
  const relsPath = `${wbDir ? `${wbDir}/` : ''}_rels/${workbookPath.split('/').pop()}.rels`;
  const wbRels = parseRels(await read(relsPath), wbDir);

  const wbPr = firstElement(wbXml, 'workbookPr');
  const date1904 = Boolean(wbPr && /^(1|true)$/.test(parseAttrs(wbPr.attrs).date1904 || ''));

  const sstRel = Object.values(wbRels).find((r) => /sharedStrings$/.test(r.type));
  const sstXml = sstRel ? await read(sstRel.path) : null;
  const sst = sstXml ? findElements(sstXml, 'si').map((si) => richText(si.inner)) : [];
  const stylesRel = Object.values(wbRels).find((r) => /\/styles$/.test(r.type));
  const styles = parseStyles((stylesRel && (await read(stylesRel.path))) || '');

  const sheets = [];
  for (const s of findElements(wbXml, 'sheet')) {
    const a = parseAttrs(s.attrs);
    const rid = Object.keys(a).find((k) => k === 'id' || k.endsWith(':id'));
    const rel = rid ? wbRels[a[rid]] : null;
    if (!rel || !/\/worksheet$/.test(rel.type)) continue;
    const xml = await read(rel.path);
    if (xml == null) continue;
    sheets.push({ name: a.name, path: rel.path, state: a.state || 'visible', ...parseSheet(xml, sst, styles) });
  }
  if (!sheets.length) throw new TemplateError('No worksheets were found in this workbook.');
  const hasFormulas = sheets.some((s) => [...s.cells.values()].some((c) => c.formula));
  return { zip, bytes: u8, workbookPath, date1904, sheets, styles, hasFormulas };
}

export function getSheet(tpl, name) {
  return tpl.sheets.find((s) => s.name === name) || null;
}

export function mergeAt(sheet, row, col) {
  return sheet.merges.find((m) => row >= m.r1 && row <= m.r2 && col >= m.c1 && col <= m.c2) || null;
}

// Style of the cell as Excel would show it, including rows and columns that
// carry a default style for cells that are not stored.
export function cellInfo(sheet, ref, styles) {
  const p = parseRef(ref);
  const c = sheet.cells.get(makeRef(p.col, p.row));
  if (c) return c;
  const s = defaultStyleIndex(sheet, p.row, p.col);
  return { ref: makeRef(p.col, p.row), row: p.row, col: p.col, t: 'n', s, value: '', formula: false, numeric: false, style: (styles && styles.xfs[s]) || DEFAULT_XF, missing: true };
}

function defaultStyleIndex(sheet, row, col) {
  const ri = sheet.rowsInfo.get(row);
  if (ri && ri.customFormat && ri.s != null) return ri.s;
  const ci = sheet.cols.find((c) => col >= c.min && col <= c.max);
  if (ci && ci.style != null) return ci.style;
  return 0;
}

const inRange = (r, row, col) => row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2;

// Locked on a protected sheet, or inside a protected range (Google Sheets).
export function isLocked(sheet, row, col, style) {
  if (sheet.lockedRanges && sheet.lockedRanges.some((r) => inRange(r, row, col))) return true;
  if (!sheet.protected) return false;
  if (sheet.unlockedRanges && sheet.unlockedRanges.some((r) => inRange(r, row, col))) return false;
  return Boolean(style && style.locked);
}

// Why a value may not go into this cell, or null when it may.
export function writeBlocker(tpl, sheetName, ref) {
  const sheet = getSheet(tpl, sheetName);
  if (!sheet) return `Sheet "${sheetName}" is not in this workbook.`;
  const p = parseRef(ref);
  if (!p) return `"${ref}" is not a cell reference.`;
  const m = mergeAt(sheet, p.row, p.col);
  const target = m ? makeRef(m.c1, m.r1) : makeRef(p.col, p.row);
  const c = cellInfo(sheet, target, tpl.styles);
  if (c.formula) return `${target} holds a formula, so it is never overwritten.`;
  if (isLocked(sheet, c.row, c.col, c.style)) return `${target} is locked (protected).`;
  return null;
}

// About how many characters a cell shows before its text is cut off or spills
// out of the printed box: the width of its columns (merged ranges count as
// one box) and, for wrapped cells, its number of lines. Excel measures column
// width in widths of the digit 0; ordinary text is slightly narrower.
export function cellCapacity(sheet, ref, styles) {
  const p = parseRef(ref);
  const m = mergeAt(sheet, p.row, p.col) || { r1: p.row, r2: p.row, c1: p.col, c2: p.col };
  let width = 0;
  for (let c = m.c1; c <= m.c2; c++) {
    const col = sheet.cols.find((x) => c >= x.min && c <= x.max);
    width += col && col.hidden ? 0 : (col && col.width != null ? col.width : sheet.defaultColWidth || 8.43);
  }
  const cell = cellInfo(sheet, makeRef(m.c1, m.r1), styles);
  let lines = 1;
  if (cell.style.wrap) {
    let height = 0;
    for (let r = m.r1; r <= m.r2; r++) { const ri = sheet.rowsInfo.get(r); height += (ri && ri.ht) || sheet.defaultRowHeight || 15; }
    lines = Math.max(1, Math.floor(height / 15));
  }
  return { chars: Math.max(1, Math.floor(width * 1.15)), lines, shrink: Boolean(cell.style.shrink) };
}

// True when a value will not fit in the cell as printed.
export function overflows(sheet, ref, styles, text) {
  const cap = cellCapacity(sheet, ref, styles);
  const t = String(text || '');
  if (!t || cap.shrink) return false;
  if (cap.lines > 1) return t.length > cap.chars * cap.lines * 0.9;
  return t.length > cap.chars;
}

// ---------------------------------------------------------------- dates

export function dateToSerial(y, m, d, date1904 = false) {
  const days = (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
  return date1904 ? days - 1462 : days;
}

export function serialToDate(serial, date1904 = false) {
  const ms = Date.UTC(1899, 11, 30) + (Number(serial) + (date1904 ? 1462 : 0)) * 86400000;
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

// ---------------------------------------------------------------- writing

// Builds the XML for one cell. `attrs` are the attributes the old node had
// (minus its type and value metadata), so the style index is kept.
function cellXml(prefix, ref, attrs, value) {
  const keep = Object.entries(attrs).filter(([k]) => !['r', 't', 'vm', 'cm'].includes(k));
  const attrText = keep.map(([k, v]) => ` ${k}="${escapeXml(v)}"`).join('');
  const P = prefix;
  if (value.kind === 'number') {
    return `<${P}c r="${ref}"${attrText}><${P}v>${value.number}</${P}v></${P}c>`;
  }
  if (value.kind === 'bool') {
    return `<${P}c r="${ref}"${attrText} t="b"><${P}v>${value.bool ? 1 : 0}</${P}v></${P}c>`;
  }
  const text = String(value.text);
  const space = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
  return `<${P}c r="${ref}"${attrText} t="inlineStr"><${P}is><${P}t${space}>${escapeXml(text)}</${P}t></${P}is></${P}c>`;
}

function rowNumberOf(attrs, prev) {
  const r = parseAttrs(attrs).r;
  return r ? Number(r) : prev + 1;
}

// Replaces or inserts one cell in a worksheet's XML text and returns the new
// text. Everything outside that one <c> node (or the new <row> holding it) is
// left exactly as it was.
export function setCellInXml(xml, sheet, ref, value, styles) {
  const p = parseRef(ref);
  const sdOpen = new RegExp(`<(${el('sheetData')})(?=[\\s/>])([^>]*?)(/?)>`).exec(xml);
  if (!sdOpen) throw new TemplateError('The worksheet has no cell data section.');
  const prefix = sdOpen[1].includes(':') ? `${sdOpen[1].split(':')[0]}:` : '';
  if (sdOpen[3] === '/') {
    const open = `<${sdOpen[1]}${sdOpen[2]}>`;
    xml = xml.slice(0, sdOpen.index) + open + `</${sdOpen[1]}>` + xml.slice(sdOpen.index + sdOpen[0].length);
  }
  const sdStart = xml.search(new RegExp(`<${el('sheetData')}(?=[\\s/>])`));
  const sdInnerStart = xml.indexOf('>', sdStart) + 1;
  const sdEnd = xml.indexOf(`</${sdOpen[1]}>`, sdInnerStart);

  const rows = findElements(xml, 'row', sdInnerStart, sdEnd);
  let prev = 0;
  let target = null;
  let insertRowAt = sdEnd;
  for (const row of rows) {
    const n = rowNumberOf(row.attrs, prev);
    prev = n;
    if (n === p.row) { target = row; break; }
    if (n > p.row) { insertRowAt = row.start; break; }
  }

  const style = defaultStyleIndex(sheet, p.row, p.col);
  const newAttrs = style ? { s: String(style) } : {};

  if (!target) {
    const rowXml = `<${prefix}row r="${p.row}">${cellXml(prefix, ref, newAttrs, value)}</${prefix}row>`;
    return xml.slice(0, insertRowAt) + rowXml + xml.slice(insertRowAt);
  }

  if (target.inner === null) {
    // <row r="4" .../> has no cells yet: open it up.
    const open = xml.slice(target.start, target.end).replace(/\s*\/>$/, '>');
    const replacement = `${open}${cellXml(prefix, ref, newAttrs, value)}</${target.tag}>`;
    return xml.slice(0, target.start) + replacement + xml.slice(target.end);
  }

  const cells = findElements(xml, 'c', target.openEnd, target.end);
  let prevCol = 0;
  let insertAt = target.end - `</${target.tag}>`.length;
  for (const c of cells) {
    const a = parseAttrs(c.attrs);
    const cp = a.r ? parseRef(a.r) : null;
    if (!cp && !a.r) throw new TemplateError(`Row ${p.row} stores cells without references; FormFill cannot edit it safely.`);
    const col = cp ? cp.col : prevCol + 1;
    prevCol = col;
    if (col === p.col) {
      if (new RegExp(`<${el('f')}(?=[\\s/>])`).test(c.inner || '')) throw new TemplateError(`${ref} holds a formula, so it is never overwritten.`);
      return xml.slice(0, c.start) + cellXml(prefix, ref, a, value) + xml.slice(c.end);
    }
    if (col > p.col) { insertAt = c.start; break; }
  }
  const ri = sheet.rowsInfo.get(p.row);
  const attrs = ri && ri.customFormat && ri.s != null ? { s: String(ri.s) } : newAttrs;
  void styles;
  return xml.slice(0, insertAt) + cellXml(prefix, ref, attrs, value) + xml.slice(insertAt);
}

// Sets fullCalcOnLoad so formulas that depend on filled cells show fresh
// results as soon as the file is opened.
export function setRecalcOnLoad(wbXml) {
  const calc = new RegExp(`<(${el('calcPr')})(?=[\\s/>])([^>]*?)(/?)>`).exec(wbXml);
  if (calc) {
    const a = calc[2];
    let attrs;
    if (/\sfullCalcOnLoad\s*=/.test(a)) attrs = a.replace(/(\sfullCalcOnLoad\s*=\s*)("[^"]*"|'[^']*')/, '$1"1"');
    else attrs = `${a.replace(/\s+$/, '')} fullCalcOnLoad="1"`;
    if (attrs === a) return wbXml;
    return wbXml.slice(0, calc.index) + `<${calc[1]}${attrs}${calc[3]}>` + wbXml.slice(calc.index + calc[0].length);
  }
  const root = /<((?:[A-Za-z_][\w.-]*:)?)workbook[\s>]/.exec(wbXml);
  const prefix = root ? root[1] : '';
  // calcPr must sit before these elements in the schema's order.
  const after = ['oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes', 'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst'];
  let at = -1;
  for (const name of after) {
    const i = wbXml.search(new RegExp(`<${el(name)}(?=[\\s/>])`));
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) at = wbXml.lastIndexOf(`</${prefix}workbook>`);
  return wbXml.slice(0, at) + `<${prefix}calcPr fullCalcOnLoad="1"/>` + wbXml.slice(at);
}

// Writes values into a copy of the template and returns the new .xlsx bytes.
//
// writes: [{ sheet, cell, value }] where value is
//   { kind: 'text', text } | { kind: 'number', number } | { kind: 'bool', bool }
// Dates are written as numbers (Excel serials) into the cell's own date format.
//
// Cells that must not be written (formulas, locked cells) are reported in
// `skipped` and left alone; the rest of the fill still goes ahead.
export async function fillTemplate(JSZip, tpl, writes) {
  const out = await JSZip.loadAsync(tpl.bytes);
  const bySheet = new Map();
  const skipped = [];
  const written = [];
  for (const w of writes) {
    const sheet = getSheet(tpl, w.sheet);
    const blocker = writeBlocker(tpl, w.sheet, w.cell);
    if (blocker) { skipped.push({ ...w, reason: blocker }); continue; }
    const p = parseRef(w.cell);
    const m = mergeAt(sheet, p.row, p.col);
    const ref = m ? makeRef(m.c1, m.r1) : makeRef(p.col, p.row);
    if (!bySheet.has(sheet)) bySheet.set(sheet, new Map());
    bySheet.get(sheet).set(ref, w.value);
    written.push({ ...w, cell: ref });
  }

  for (const [sheet, cells] of bySheet) {
    let xml = await out.file(sheet.path).async('string');
    for (const [ref, value] of cells) {
      try {
        xml = setCellInXml(xml, sheet, ref, value, tpl.styles);
      } catch (e) {
        skipped.push({ sheet: sheet.name, cell: ref, value, reason: e.message });
      }
    }
    out.file(sheet.path, xml);
  }

  if (written.length && tpl.hasFormulas) {
    const wb = await out.file(tpl.workbookPath).async('string');
    const next = setRecalcOnLoad(wb);
    if (next !== wb) out.file(tpl.workbookPath, next);
  }

  const bytes = await out.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  return { bytes, skipped, written };
}

export async function sha256Hex(bytes) {
  const subtle = (globalThis.crypto && globalThis.crypto.subtle) || null;
  if (!subtle) throw new Error('Hashing is not available in this browser.');
  const h = await subtle.digest('SHA-256', bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  return `sha256:${[...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
