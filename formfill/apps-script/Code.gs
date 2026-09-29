/**
 * FormFill server (Google Apps Script).
 *
 * FormFill works fully offline on its own. This script adds the parts that
 * need a connection, all optional:
 *
 *   extract         the AI reads a document's values (text or page images)
 *   detect          the AI names and types a form's fields from its layout
 *   sheets.inspect  reads a Google Sheets form's layout so FormFill can detect its fields
 *   sheets.fill     copies a Google Sheets form and sets only the mapped cells' values
 *   drive.save / drive.list / drive.get
 *                   keeps forms and their field maps in a "FormFill templates" Drive folder
 *
 * The AI API key stays in this script's properties and never reaches the phone.
 * The AI only returns values and names; the app decides what gets written and where.
 *
 * Setup (5 minutes):
 *  1. script.google.com -> New project -> paste this file as Code.gs.
 *  2. Project Settings -> Script properties -> add
 *       ACCESS_TOKEN       any long random phrase (the app sends it; others can't use this script)
 *       ANTHROPIC_API_KEY  your key from console.anthropic.com (only needed for AI reading/naming)
 *     optional:
 *       MODEL              defaults to claude-opus-5
 *       EFFORT             low | medium | high (defaults to low: reading values is a simple task)
 *  3. Deploy -> New deployment -> Web app. Execute as: Me. Who has access: Anyone.
 *     Approve the Sheets and Drive permissions when asked (used only for Google Sheets forms
 *     and the templates folder).
 *  4. Copy the /exec URL into FormFill -> Settings, with the same access token.
 *
 * Google Sheets forms must be ones the Google account that deployed this script can open.
 */

var API_URL = 'https://api.anthropic.com/v1/messages';
var TEMPLATES_FOLDER = 'FormFill templates';
var OUTPUT_FOLDER = 'FormFill output';

function doGet() {
  return json_({ ok: true, service: 'formfill-proxy' });
}

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var token = props.getProperty('ACCESS_TOKEN');
    if (!token) return json_({ error: 'Set an ACCESS_TOKEN script property first.' });
    if (body.token !== token) return json_({ error: 'Wrong access token. Check FormFill settings.' });
    var action = body.ping ? 'ping' : (body.action || 'extract');
    switch (action) {
      case 'ping': return json_({ ok: true, ai: Boolean(props.getProperty('ANTHROPIC_API_KEY')) });
      case 'extract': return json_(extract_(body, props));
      case 'detect': return json_(detect_(body, props));
      case 'sheets.inspect': return json_(sheetsInspect_(body));
      case 'sheets.fill': return json_(sheetsFill_(body));
      case 'drive.save': return json_(driveSave_(body));
      case 'drive.list': return json_(driveList_());
      case 'drive.get': return json_(driveGet_(body));
      default: return json_({ error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return json_({ error: String((err && err.message) || err) });
  }
}

// ------------------------------------------------------------------ AI

function claude_(props, system, content) {
  var key = props.getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('The proxy has no ANTHROPIC_API_KEY script property yet.');
  var payload = {
    model: props.getProperty('MODEL') || 'claude-opus-5',
    max_tokens: 16000,
    output_config: { effort: props.getProperty('EFFORT') || 'low' },
    fallbacks: 'default',
    system: system,
    messages: [{ role: 'user', content: content }]
  };
  var res = UrlFetchApp.fetch(API_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var data = JSON.parse(res.getContentText() || '{}');
  if (code !== 200) throw new Error('AI service error ' + code + ': ' + ((data.error && data.error.message) || 'unknown'));
  if (data.stop_reason === 'refusal') throw new Error('The AI declined this request.');
  var text = (data.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  var parsed = parseJson_(text);
  if (!parsed) throw new Error('The AI reply was not valid JSON.');
  parsed.model = data.model;
  return parsed;
}

function extract_(body, props) {
  var content = [];
  (body.images || []).slice(0, 20).forEach(function (img) {
    var m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(img.dataUrl || '');
    if (m) {
      content.push({ type: 'text', text: 'Page image: ' + (img.name || '') + ' page ' + (img.page || 1) });
      content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
    }
  });
  (body.texts || []).forEach(function (t) {
    content.push({ type: 'text', text: '<document name="' + String(t.name || '').replace(/"/g, '') + '">\n' + t.text + '\n</document>' });
  });
  if (!content.length) return { error: 'No document content was sent.' };
  content.push({ type: 'text', text: extractPrompt_(body) });
  var out = claude_(props,
    'You read business documents (invoices, letters, certificates, IDs, receipts) and return field values as JSON. ' +
    'Copy values exactly as they appear. Use null when a value is not in the document. Never guess or invent values.',
    content);
  // Older replies had one set of fields at the top level.
  var docs = out.documents && out.documents.length ? out.documents : [{ label: '', fields: out.fields || {}, rows: out.rows || [] }];
  return { ok: true, documents: docs, model: out.model };
}

function extractPrompt_(body) {
  var lines = ['Fields to find:'];
  (body.fields || []).forEach(function (f) {
    lines.push('- ' + f.name + ' (' + (f.type || 'text') + ')' + (f.label ? ' label on form: "' + f.label + '"' : '') + (f.hint ? ' hint: ' + f.hint : ''));
  });
  if (body.table && body.table.columns && body.table.columns.length) {
    lines.push('', 'Line items table, columns: ' + body.table.columns.join(', ') + '. Return every line item you see.');
  }
  lines.push('',
    'The files may hold several separate documents (for example two invoices). Return one entry per separate document, in order.',
    'Date order for ambiguous dates: ' + (body.dateOrder === 'MDY' ? 'month/day/year' : 'day/month/year') + '. Return dates as YYYY-MM-DD.',
    'Return numbers without currency symbols or thousands separators.',
    'Return JSON only, no prose, in exactly this shape:',
    '{"documents": [{"label": "<short description, e.g. invoice number and supplier>",',
    '  "fields": {"<field name>": {"value": <string, number or null>, "confidence": <0-1>, "snippet": "<the text you read it from>", "page": <page number>}},',
    '  "rows": [{"<column>": <value>}]}]}',
    'Use null when a value is not in the document; never guess.');
  return lines.join('\n');
}

function detect_(body, props) {
  var layout = body.layout || {};
  var lines = ['This is the layout of a spreadsheet form, cell by cell (sheet, then "cell: text" for each non-empty cell per row):'];
  (layout.sheets || []).forEach(function (s) {
    lines.push('', 'Sheet "' + s.name + '":');
    (s.rows || []).forEach(function (r) { lines.push(r); });
  });
  lines.push('', 'These empty cells are where values are typed in (sheet, cell, nearest label, section, current guess):');
  (layout.inputs || []).forEach(function (i) {
    lines.push('- ' + i.sheet + '!' + i.cell + ' label "' + (i.label || '') + '" section "' + (i.section || '') + '" guess ' + i.name + ' (' + i.type + ')');
  });
  lines.push('',
    'For every input cell listed, give a field name in snake_case that says what goes there, using the section headings',
    '(e.g. "Supplier details" + "Name" -> supplier_name), a type (text, number, date, currency or yesno),',
    'a short hint for someone reading source documents (e.g. "issue date, not due date"), and your confidence 0-1.',
    'Keep exactly the listed cells; do not add or move cells.',
    'Return JSON only: {"fields": [{"sheet": "...", "cell": "B4", "name": "...", "type": "...", "hint": "...", "confidence": 0.9}]}');
  var out = claude_(props, 'You name the fields of business forms precisely and consistently. Return JSON only.', [{ type: 'text', text: lines.join('\n') }]);
  return { ok: true, fields: out.fields || [], model: out.model };
}

// ------------------------------------------------------------------ Google Sheets

function spreadsheetId_(v) {
  var m = /\/d\/([a-zA-Z0-9_-]{20,})/.exec(String(v || ''));
  return m ? m[1] : String(v || '').trim();
}

function sheetsInspect_(body) {
  var id = spreadsheetId_(body.spreadsheet);
  var ss = SpreadsheetApp.openById(id);
  var rangeProtections = ss.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  var sheets = ss.getSheets().map(function (sh) {
    var nr = Math.min(Math.max(sh.getLastRow(), 1) + 3, 300);
    var nc = Math.min(Math.max(sh.getLastColumn(), 1) + 2, 40);
    nr = Math.min(nr, sh.getMaxRows());
    nc = Math.min(nc, sh.getMaxColumns());
    var r = sh.getRange(1, 1, nr, nc);
    var values = r.getValues();
    var shown = r.getDisplayValues();
    var formulas = r.getFormulas();
    var weights = r.getFontWeights();
    var bgs = r.getBackgrounds();
    var fmts = r.getNumberFormats();
    var wraps = r.getWraps();
    var cells = [];
    for (var i = 0; i < nr; i++) {
      for (var j = 0; j < nc; j++) {
        var bg = (bgs[i][j] || '#ffffff').toLowerCase();
        var bold = weights[i][j] === 'bold';
        var fmt = fmts[i][j] || '';
        var has = shown[i][j] !== '' || formulas[i][j] !== '' || bold || bg !== '#ffffff' || (fmt && fmt !== '0.###############' && fmt !== 'General');
        if (!has) continue;
        cells.push([i + 1, j + 1, shown[i][j], formulas[i][j] !== '', bold, bg === '#ffffff' ? '' : bg.replace('#', ''), fmt, typeof values[i][j] === 'number' || values[i][j] instanceof Date, wraps[i][j]]);
      }
    }
    var widths = [];
    for (var c = 1; c <= nc; c++) widths.push(sh.getColumnWidth(c));
    var heights = [];
    for (var rr = 1; rr <= nr; rr++) heights.push(sh.isRowHiddenByUser(rr) ? 0 : sh.getRowHeight(rr));
    var sheetProt = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    var unprotected = [];
    if (sheetProt.length) sheetProt[0].getUnprotectedRanges().forEach(function (u) { unprotected.push(u.getA1Notation()); });
    var locked = rangeProtections.filter(function (p) { return p.getRange().getSheet().getSheetId() === sh.getSheetId(); })
      .map(function (p) { return p.getRange().getA1Notation(); });
    return {
      name: sh.getName(), sheetId: sh.getSheetId(), hidden: sh.isSheetHidden(),
      rows: nr, cols: nc, cells: cells, widths: widths, heights: heights,
      merges: r.getMergedRanges().map(function (m) { return m.getA1Notation(); }),
      protectedSheet: sheetProt.length > 0, unprotected: unprotected, locked: locked
    };
  });
  return { ok: true, spreadsheetId: id, name: ss.getName(), url: ss.getUrl(), locale: ss.getSpreadsheetLocale(), sheets: sheets };
}

function folder_(name) {
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

// Text that Sheets would read as a number, date or formula is written as text.
function sheetValue_(v) {
  if (!v) return '';
  if (v.kind === 'number') return v.number;
  if (v.kind === 'bool') return v.bool;
  var t = String(v.text);
  if (/^[=+\-@']/.test(t) || /^[\d\s.,/:%$₦€£-]+$/.test(t) || /^(true|false)$/i.test(t)) return "'" + t;
  return t;
}

function sheetsFill_(body) {
  var id = spreadsheetId_(body.spreadsheet);
  var name = String(body.name || 'FormFill').replace(/\.xlsx$/i, '');
  var copy = DriveApp.getFileById(id).makeCopy(name, folder_(OUTPUT_FOLDER));
  var ss = SpreadsheetApp.openById(copy.getId());
  var skipped = [];
  var written = 0;
  (body.writes || []).forEach(function (w) {
    var sh = ss.getSheetByName(w.sheet);
    if (!sh) { skipped.push({ sheet: w.sheet, cell: w.cell, reason: 'Sheet not found' }); return; }
    var range = sh.getRange(w.cell);
    if (range.isPartOfMerge()) range = range.getMergedRanges()[0].getCell(1, 1);
    if (range.getFormula()) { skipped.push({ sheet: w.sheet, cell: w.cell, reason: 'Holds a formula' }); return; }
    // Only the value changes; formats, borders and validation stay as they are.
    range.setValue(sheetValue_(w.value));
    written++;
  });
  SpreadsheetApp.flush();
  return { ok: true, url: ss.getUrl(), id: ss.getId(), name: name, written: written, skipped: skipped };
}

// ------------------------------------------------------------------ Drive templates

function driveSave_(body) {
  var folder = folder_(TEMPLATES_FOLDER);
  var base = String(body.name || 'form').replace(/[\\\/:*?"<>|]/g, '-');
  ['.xlsx', '.fieldmap.json'].forEach(function (ext) {
    var it = folder.getFilesByName(base + ext);
    while (it.hasNext()) it.next().setTrashed(true);
  });
  if (body.xlsxBase64) {
    folder.createFile(Utilities.newBlob(Utilities.base64Decode(body.xlsxBase64), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base + '.xlsx'));
  }
  var record = { name: body.name, hash: body.hash, kind: body.kind || 'xlsx', spreadsheetId: body.spreadsheetId || null, map: body.map, savedAt: new Date().toISOString() };
  folder.createFile(base + '.fieldmap.json', JSON.stringify(record, null, 2), 'application/json');
  return { ok: true, folderUrl: folder.getUrl() };
}

function driveList_() {
  var folder = folder_(TEMPLATES_FOLDER);
  var out = [];
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (!/\.fieldmap\.json$/.test(f.getName())) continue;
    try {
      var rec = JSON.parse(f.getBlob().getDataAsString());
      out.push({ name: rec.name, hash: rec.hash, kind: rec.kind, savedAt: rec.savedAt });
    } catch (e) { /* skip unreadable files */ }
  }
  return { ok: true, templates: out, folderUrl: folder.getUrl() };
}

function driveGet_(body) {
  var folder = folder_(TEMPLATES_FOLDER);
  var base = String(body.name || '').replace(/[\\\/:*?"<>|]/g, '-');
  var it = folder.getFilesByName(base + '.fieldmap.json');
  if (!it.hasNext()) return { error: 'Not found in Drive: ' + body.name };
  var rec = JSON.parse(it.next().getBlob().getDataAsString());
  var x = folder.getFilesByName(base + '.xlsx');
  if (x.hasNext()) rec.xlsxBase64 = Utilities.base64Encode(x.next().getBlob().getBytes());
  return { ok: true, template: rec };
}

// ------------------------------------------------------------------ helpers

function parseJson_(text) {
  var s = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(s); } catch (e) { /* fall through */ }
  var a = s.indexOf('{');
  var b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) { return null; } }
  return null;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
