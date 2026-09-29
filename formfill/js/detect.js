// Auto-detection: reading an Excel form and working out what it asks for.
//
// Runs entirely on the device. It lists every cell with its text and style,
// finds label cells with an empty input cell beside or below them, finds a
// line-item table (a header row with blank rows beneath), and names and types
// each field from its label, the section it sits in and the input cell's
// number format. The user confirms the result once and it is saved as the
// template's field map.

import { makeRef, numToCol, mergeAt, cellInfo, parseRef, isLocked } from './xlsx.js';
import { slugify } from './normalize.js';

const MAX_ROWS = 300;
const MAX_COLS = 40;

// Sections and labels that are never guessed: they are for the office or for
// a signature, not for values found in a document.
const SKIP_SECTION = /\b(office use|official use|for office|internal use|for use by|admin(istration)? only|do not write)\b/i;
const SKIP_LABEL = /\b(signature|signed|sign here|stamp|seal|initials?|thumbprint)\b/i;

// Labels that mean little without their section.
const GENERIC = /^(full |first |last |sur)?(name|names|address|phone|tel|telephone|mobile|e-?mail|email address|date|no\.?|number|ref|reference|city|town|state|country|contact|contact person|title|position|designation|id|code|account|account no\.?|account number|bank|signature|website|fax|postcode|zip)$/i;
const TITLE_GENERIC = /^(date|no\.?|number|ref|reference)$/i;
const DOC_NOUN = /\b(invoice|receipt|order|quote|quotation|application|certificate|claim|delivery|bill|voucher|payment|request|requisition)\b/i;
const SECTION_FILLER = /\b(details?|information|info|section|particulars|data|of the)\b|\d+[.)]?/gi;

const TYPE_RULES = [
  [/\b(yes\s*\/\s*no|y\/n|tick|agree|consent|approved\?)\b/i, 'yesno'],
  [/\b(date|dated|dob|d\.o\.b|birthday|expiry|expires|issued on|due on|valid (until|till|to|from)|period (from|to))\b/i, 'date'],
  [/\b(total|subtotal|sub-total|amount|price|cost|fee|fees|charge|balance|vat|tax|salary|pay|payment|deposit|discount|rate|value|sum|premium|paid|due)\b/i, 'currency'],
  [/\b(qty|quantity|number of|no\. of|count|units|age|hours|days|pieces|pcs|weight|kg|litres|liters|size|percentage|%)\b/i, 'number'],
];

export function guessType(label, cell) {
  const kind = cell && cell.style ? cell.style.kind : 'general';
  if (kind === 'date') return 'date';
  if (kind === 'currency') return 'currency';
  const text = String(label || '');
  // "Invoice No", "Account Number", "Phone" are identifiers, not quantities.
  if (/\b(no\.?|number|num|#|id|code|ref|reference|phone|tel|mobile|account|acct|bvn|nin|tin|rc|zip|postcode|postal)\b/i.test(text) && !/\b(number of|no\. of)\b/i.test(text)) {
    if (/\bdate\b/i.test(text)) return 'date';
    return 'text';
  }
  for (const [re, type] of TYPE_RULES) if (re.test(text)) return type;
  if (/\?\s*$/.test(text)) return 'yesno';
  if (kind === 'number') return 'number';
  return 'text';
}

export function cleanLabel(text) {
  return String(text || '').replace(/[\s:：*?.–—_-]+$/g, '').replace(/^[\s\d.)(-]*(?=[A-Za-z])/, (m) => (/^\s*\d+[.)]\s*$/.test(m) ? '' : m)).replace(/\s+/g, ' ').trim();
}

function isTextCell(c) {
  if (!c || c.formula) return false;
  const v = String(c.value || '').trim();
  if (!v || v.length > 80) return false;
  if (c.numeric) return false;
  return /[A-Za-zÀ-ɏЀ-ӿ؀-ۿ]/.test(v);
}

// A blank cell someone is meant to type into.
function inputCandidate(sheet, row, col, styles) {
  if (row < 1 || col < 1) return null;
  const m = mergeAt(sheet, row, col);
  if (m && (m.r1 !== row || m.c1 !== col)) return null;
  const c = cellInfo(sheet, makeRef(col, row), styles);
  if (c.formula) return null;
  if (String(c.value || '').trim() !== '') return null;
  if (isLocked(sheet, row, col, c.style)) return null;
  const b = c.style.border;
  // A merged input takes its borders from the whole range, so look along it.
  let bordered = b.bottom || b.top || b.left || b.right;
  if (!bordered && m) {
    for (let cc = m.c1; cc <= m.c2 && !bordered; cc++) {
      const o = cellInfo(sheet, makeRef(cc, m.r2), styles);
      bordered = o.style.border.bottom || o.style.border.top;
    }
  }
  return { cell: c, merge: m, styled: Boolean(bordered || c.style.fill.filled), underline: b.bottom && !b.top };
}

function spanEnd(sheet, row, col) {
  const m = mergeAt(sheet, row, col);
  return m ? { r2: m.r2, c2: m.c2 } : { r2: row, c2: col };
}

// A header row with at least two headings and at least two blank rows below.
function detectTables(sheet, styles, maxRow, maxCol) {
  const found = [];
  for (let r = 1; r <= maxRow; r++) {
    const heads = [];
    for (let c = 1; c <= maxCol; c++) {
      const m = mergeAt(sheet, r, c);
      if (m && (m.r1 !== r || m.c1 !== c)) continue;
      const cell = sheet.cells.get(makeRef(c, r));
      if (isTextCell(cell) && !/[:：]\s*$/.test(cell.value)) heads.push({ col: c, cell, c2: m ? m.c2 : c });
    }
    if (heads.length < 2) continue;
    // Headings are usually bold, shaded or boxed; plain text in a row is more
    // often a sentence split across cells.
    const styledHeads = heads.filter((h) => h.cell.style.bold || h.cell.style.fill.filled || h.cell.style.border.bottom || h.cell.style.border.top);
    if (styledHeads.length < Math.ceil(heads.length / 2)) continue;

    let body = 0;
    const formulaCols = new Set();
    for (let rr = r + 1; rr <= Math.min(maxRow, r + 200); rr++) {
      let blankInputs = 0;
      let stored = 0;
      let blocked = false;
      for (const h of heads) {
        const cell = sheet.cells.get(makeRef(h.col, rr));
        if (cell) stored++;
        if (cell && cell.formula) { formulaCols.add(h.col); continue; }
        // Pre-printed row numbers (1, 2, 3 …) in a "No." column do not end the table.
        if (cell && cell.numeric && h === heads[0]) { formulaCols.add(h.col); continue; }
        if (cell && String(cell.value || '').trim() !== '') { blocked = true; break; }
        const mm = mergeAt(sheet, rr, h.col);
        if (mm && mm.r1 !== mm.r2) { blocked = true; break; }
        blankInputs++;
      }
      // Stop at a totals row, a new section, or the end of the styled grid.
      if (blocked || blankInputs === 0 || stored === 0) break;
      // A label to the left of the table (e.g. "Subtotal") also ends it.
      const left = heads[0].col > 1 ? sheet.cells.get(makeRef(heads[0].col - 1, rr)) : null;
      if (isTextCell(left)) break;
      body++;
    }
    if (body < 2) continue;
    const columns = {};
    const labels = {};
    for (const h of heads) {
      if (formulaCols.has(h.col)) continue;
      let name = slugify(cleanLabel(h.cell.value));
      while (columns[name]) name += '_2';
      columns[name] = numToCol(h.col);
      labels[name] = cleanLabel(h.cell.value);
    }
    if (Object.keys(columns).length < 1) continue;
    found.push({ headerRow: r, startRow: r + 1, maxRows: body, columns, labels, score: Object.keys(columns).length * body, cols: heads.map((h) => h.col) });
    r += body;
  }
  return found;
}

// The nearest heading above a cell: a lone text cell on its row.
function sectionAbove(sheet, row, col, headingRows) {
  let best = null;
  for (const h of headingRows) {
    if (h.row >= row) break;
    if (h.col <= col + 2) best = h;
  }
  return best;
}

export function detectFields(tpl, { templateId = 'form', templateHash = '', dateOrder = 'DMY' } = {}) {
  const fields = [];
  let table = null;
  const skipped = [];
  const used = new Set();

  for (const sheet of tpl.sheets) {
    if (sheet.state !== 'visible') continue;
    const maxRow = Math.min(sheet.maxRow, MAX_ROWS);
    const maxCol = Math.min(sheet.maxCol + 1, MAX_COLS);
    const tables = detectTables(sheet, tpl.styles, maxRow, maxCol);
    const tableRows = new Set();
    for (const t of tables) for (let r = t.headerRow; r < t.startRow + t.maxRows; r++) tableRows.add(r);
    const best = tables.sort((a, b) => b.score - a.score)[0];
    if (best && !table) table = { name: 'line_items', sheet: sheet.name, startRow: best.startRow, maxRows: best.maxRows, columns: best.columns, labels: best.labels };

    // Rows that hold a single text cell are headings; they name sections.
    const headingRows = [];
    for (let r = 1; r <= maxRow; r++) {
      const texts = [];
      for (let c = 1; c <= maxCol; c++) {
        const cell = sheet.cells.get(makeRef(c, r));
        if (cell && String(cell.value || '').trim() !== '') texts.push(cell);
      }
      if (texts.length === 1 && isTextCell(texts[0]) && !/[:：?]\s*$/.test(texts[0].value)) headingRows.push({ row: r, col: texts[0].col, text: cleanLabel(texts[0].value) });
    }

    for (let r = 1; r <= maxRow; r++) {
      if (tableRows.has(r)) continue;
      for (let c = 1; c <= maxCol; c++) {
        const m = mergeAt(sheet, r, c);
        if (m && (m.r1 !== r || m.c1 !== c)) continue;
        const cell = sheet.cells.get(makeRef(c, r));
        if (!isTextCell(cell)) continue;
        const raw = String(cell.value).trim();
        const label = cleanLabel(raw);
        if (!label || label.length < 2) continue;
        const punct = /[:：?]\s*$/.test(raw) || /\*\s*[:：]?\s*$/.test(raw);
        const end = spanEnd(sheet, r, c);

        let pick = null;
        const right = inputCandidate(sheet, r, end.c2 + 1, tpl.styles);
        if (right && (punct || right.styled || (right.merge && right.merge.c2 > right.merge.c1))) pick = { ...right, where: 'right' };
        if (!pick) {
          const below = inputCandidate(sheet, end.r2 + 1, c, tpl.styles);
          const belowLabel = sheet.cells.get(makeRef(c, end.r2 + 1));
          if (below && below.styled && !tableRows.has(end.r2 + 1) && !isTextCell(belowLabel)) pick = { ...below, where: 'below' };
        }
        if (!pick) continue;
        const ref = pick.cell.ref;
        const key = `${sheet.name}!${ref}`;
        if (used.has(key)) continue;

        const section = sectionAbove(sheet, r, c, headingRows);
        if (SKIP_LABEL.test(label) || (section && SKIP_SECTION.test(section.text)) || SKIP_SECTION.test(label)) {
          skipped.push({ sheet: sheet.name, cell: ref, label, reason: SKIP_LABEL.test(label) ? 'signature or stamp' : 'office-use section' });
          continue;
        }
        used.add(key);
        fields.push({
          name: slugify(label),
          label,
          sheet: sheet.name,
          cell: ref,
          type: guessType(raw, pick.cell),
          hint: '',
          required: /\*/.test(raw),
          section: section ? section.text : '',
          sectionIsTitle: Boolean(section && section === headingRows[0] && section.row <= 2),
          confidence: Math.min(1, 0.55 + (punct ? 0.2 : 0) + (pick.styled ? 0.2 : 0) + (pick.where === 'right' ? 0.05 : 0)),
        });
      }
    }
  }

  // Generic labels take their section's name, the way a person would read the
  // form: "Name" under "Supplier details" is supplier_name. Under the form's
  // title only dates and numbers do ("Date" on an invoice is invoice_date).
  for (const f of fields) {
    const base = slugify(f.label);
    if (f.section && GENERIC.test(f.label)) {
      if (f.sectionIsTitle) {
        const noun = DOC_NOUN.exec(f.section);
        if (noun && TITLE_GENERIC.test(f.label)) f.name = `${slugify(noun[1])}_${base}`;
      } else {
        const sec = slugify(f.section.replace(SECTION_FILLER, ' '));
        if (sec && sec !== 'field' && !base.startsWith(sec)) f.name = `${sec}_${base}`;
      }
    }
  }
  // Names must be unique; a repeat gets a number.
  const taken = new Set();
  for (const f of fields) {
    let n = f.name; let i = 2;
    while (taken.has(n)) n = `${f.name}_${i++}`;
    taken.add(n);
    f.name = n;
    delete f.sectionIsTitle;
  }

  return {
    templateId,
    templateHash,
    dateOrder,
    fields,
    table,
    skipped,
    outputName: suggestOutputName(templateId, fields),
  };
}

export function suggestOutputName(templateId, fields) {
  const who = fields.find((f) => f.type === 'text' && /\b(client|customer|supplier|vendor|company|name|payee|applicant|patient|student)\b/i.test(f.label || f.name));
  const when = fields.find((f) => f.type === 'date');
  return `{templateId}${who ? `_{${who.name}}` : ''}_{${when ? when.name : 'date'}}.xlsx`;
}

// A field added by hand when the user taps a cell detection missed.
export function manualField(tpl, sheetName, ref, existing = []) {
  const sheet = tpl.sheets.find((s) => s.name === sheetName);
  const p = parseRef(ref);
  let label = '';
  // Borrow the nearest text to the left or above as the label.
  for (let c = p.col - 1; c >= Math.max(1, p.col - 4) && !label; c--) { const cell = sheet.cells.get(makeRef(c, p.row)); if (isTextCell(cell)) label = cleanLabel(cell.value); }
  for (let r = p.row - 1; r >= Math.max(1, p.row - 2) && !label; r--) { const cell = sheet.cells.get(makeRef(p.col, r)); if (isTextCell(cell)) label = cleanLabel(cell.value); }
  let name = slugify(label || `field_${ref}`);
  const names = new Set(existing.map((f) => f.name));
  let n = name; let i = 2;
  while (names.has(n)) n = `${name}_${i++}`;
  name = n;
  return { name, label: label || name.replace(/_/g, ' '), sheet: sheetName, cell: ref, type: guessType(label, cellInfo(sheet, ref, tpl.styles)), hint: '', required: false, section: '', confidence: 1, manual: true };
}

// ---------------------------------------------------------------- AI naming

// The compact layout the AI names fields from: the form's text cells row by
// row plus the input cells found above. The workbook itself never leaves the
// device.
export function layoutForAI(tpl, map) {
  const sheets = [];
  for (const sheet of tpl.sheets) {
    if (sheet.state !== 'visible') continue;
    const rows = [];
    let count = 0;
    for (let r = 1; r <= Math.min(sheet.maxRow, MAX_ROWS) && count < 400; r++) {
      const parts = [];
      for (let c = 1; c <= Math.min(sheet.maxCol, MAX_COLS); c++) {
        const cell = sheet.cells.get(makeRef(c, r));
        if (!cell || cell.formula || String(cell.value || '').trim() === '') continue;
        parts.push(`${cell.ref}: ${String(cell.value).trim().slice(0, 60)}`);
        count++;
      }
      if (parts.length) rows.push(parts.join(' | '));
    }
    sheets.push({ name: sheet.name, rows });
  }
  return {
    sheets,
    inputs: map.fields.map((f) => ({ sheet: f.sheet, cell: f.cell, label: f.label, section: f.section || '', name: f.name, type: f.type })),
    table: map.table ? { sheet: map.table.sheet, startRow: map.table.startRow, columns: map.table.columns } : null,
  };
}

// Applies the AI's names, types and hints to the detected fields. The cells
// themselves never change here: the app, not the AI, decides where values go.
export function applyAINames(map, suggestions) {
  const byCell = new Map((suggestions || []).map((s) => [`${s.sheet || ''}!${String(s.cell || '').toUpperCase()}`, s]));
  const taken = new Set();
  let changed = 0;
  for (const f of map.fields) {
    const s = byCell.get(`${f.sheet}!${f.cell}`) || byCell.get(`!${f.cell}`);
    if (!s || f.manual) { taken.add(f.name); continue; }
    let name = s.name ? slugify(s.name) : f.name;
    let n = name; let i = 2;
    while (taken.has(n)) n = `${name}_${i++}`;
    name = n;
    if (name !== f.name) changed++;
    f.name = name;
    if (['text', 'number', 'date', 'currency', 'yesno'].includes(s.type) && !(f.type === 'date' && s.type === 'text')) f.type = s.type;
    if (s.hint && !f.hint) f.hint = String(s.hint).slice(0, 120);
    if (typeof s.confidence === 'number') f.confidence = Math.max(0, Math.min(1, s.confidence));
    f.aiNamed = true;
    taken.add(name);
  }
  map.outputName = suggestOutputName(map.templateId, map.fields);
  return changed;
}
