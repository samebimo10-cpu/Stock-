/**
 * FormFill AI proxy (Google Apps Script).
 *
 * The FormFill app works fully offline with its on-device reader. This proxy is
 * optional: when the phone has a connection and the proxy is set up, the app
 * sends the document text (or page images for scans and photos) plus the field
 * list here, and this script asks Claude to read the values. The API key stays
 * in this script's properties and never reaches the phone.
 *
 * Setup (5 minutes):
 *  1. script.google.com -> New project -> paste this file as Code.gs.
 *  2. Project Settings -> Script properties -> add
 *       ANTHROPIC_API_KEY  your key from console.anthropic.com
 *       ACCESS_TOKEN       any long random phrase (the app sends it; others can't use your key)
 *     optional:
 *       MODEL              defaults to claude-opus-5
 *       EFFORT             low | medium | high (defaults to low: extraction is a simple task)
 *  3. Deploy -> New deployment -> Web app. Execute as: Me. Who has access: Anyone.
 *  4. Copy the /exec URL into FormFill -> Settings -> AI proxy URL, with the same access token.
 *
 * The app, not the AI, decides what gets written and where. This script only
 * returns values; nothing is stored here.
 */

var API_URL = 'https://api.anthropic.com/v1/messages';

function doGet() {
  return json_({ ok: true, service: 'formfill-proxy' });
}

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var token = props.getProperty('ACCESS_TOKEN');
    if (token && body.token !== token) return json_({ error: 'Wrong access token. Check FormFill settings.' });
    if (body.ping) return json_({ ok: true });
    var key = props.getProperty('ANTHROPIC_API_KEY');
    if (!key) return json_({ error: 'The proxy has no ANTHROPIC_API_KEY script property yet.' });

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
    if (!content.length) return json_({ error: 'No document content was sent.' });
    content.push({ type: 'text', text: prompt_(body) });

    var payload = {
      model: props.getProperty('MODEL') || 'claude-opus-5',
      max_tokens: 16000,
      output_config: { effort: props.getProperty('EFFORT') || 'low' },
      fallbacks: 'default',
      system: 'You read business documents (invoices, letters, certificates, IDs, receipts) and return field values as JSON. ' +
        'Copy values exactly as they appear. Use null when a value is not in the document. Never guess or invent values.',
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
    if (code !== 200) return json_({ error: 'AI service error ' + code + ': ' + ((data.error && data.error.message) || 'unknown') });
    if (data.stop_reason === 'refusal') return json_({ error: 'The AI declined to read this document.' });
    var text = (data.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
    var parsed = parseJson_(text);
    if (!parsed) return json_({ error: 'The AI reply was not valid JSON.' });
    return json_({ ok: true, fields: parsed.fields || {}, rows: parsed.rows || [], documents: parsed.documents || 1, model: data.model });
  } catch (err) {
    return json_({ error: String(err && err.message || err) });
  }
}

function prompt_(body) {
  var lines = ['Fields to find:'];
  (body.fields || []).forEach(function (f) {
    lines.push('- ' + f.name + ' (' + (f.type || 'text') + ')' + (f.label ? ' label on form: "' + f.label + '"' : '') + (f.hint ? ' hint: ' + f.hint : ''));
  });
  if (body.table && body.table.columns && body.table.columns.length) {
    lines.push('', 'Line items table, up to ' + (body.table.maxRows || 20) + ' rows, columns: ' + body.table.columns.join(', '));
  }
  lines.push('',
    'Date order for ambiguous dates: ' + (body.dateOrder === 'MDY' ? 'month/day/year' : 'day/month/year') + '. Return dates as YYYY-MM-DD.',
    'Return numbers without currency symbols or thousands separators.',
    'Return JSON only, no prose, in exactly this shape:',
    '{"fields": {"<field name>": {"value": <string, number or null>, "confidence": <0-1>, "snippet": "<the text you read it from>", "page": <page number>}},',
    ' "rows": [{"<column>": <value>}], "documents": <how many separate invoices/forms the documents contain>}',
    'Use null when a value is not in the document; never guess.');
  return lines.join('\n');
}

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
