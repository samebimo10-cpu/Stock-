// Tests for the Apps Script proxy (apps-script/Code.gs), run against
// in-memory Google services. Run with: node --test "formfill/tests/**/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGas } from './gas-mock.mjs';
import { sheetModel } from '../js/gsheet.js';
import { detectFields } from '../js/detect.js';

const LEAVE = {
  name: 'Leave request',
  sheets: [{
    name: 'Form',
    cells: {
      A1: { v: 'LEAVE REQUEST', bold: true },
      A3: { v: 'Employee details', bold: true },
      A4: { v: 'Name:', bold: true }, B4: { v: '', bg: '#fff2cc' },
      A5: { v: 'Staff no:', bold: true }, B5: { v: '', bg: '#fff2cc' },
      A6: { v: 'Start date:', bold: true }, B6: { v: '', bg: '#fff2cc', fmt: 'dd/mm/yyyy' },
      A7: { v: 'Days:', bold: true }, B7: { v: '', bg: '#fff2cc' },
      A8: { v: 'Days left:', bold: true }, B8: { v: 20, f: '=20-B7' },
    },
    merges: ['B4:C4'],
    widths: { 1: 140, 2: 200 },
  }],
};
const ID = 'leaveform0000000000000000000000';

test('requests without the right access token are refused', () => {
  const gas = makeGas({ spreadsheets: { [ID]: LEAVE } });
  assert.match(gas.post({ action: 'ping', token: 'wrong' }).error, /access token/);
  assert.deepEqual(gas.post({ ping: true, token: 'secret' }), { ok: true, ai: true });
});

test('sheets.inspect returns a layout that detection understands', () => {
  const gas = makeGas({ spreadsheets: { [ID]: LEAVE } });
  const layout = gas.post({ action: 'sheets.inspect', token: 'secret', spreadsheet: `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0` });
  assert.equal(layout.ok, true);
  assert.equal(layout.spreadsheetId, ID);
  const map = detectFields(sheetModel(layout), { templateId: 'leave' });
  assert.deepEqual(map.fields.map((f) => `${f.name}@${f.cell}:${f.type}`), ['employee_name@B4:text', 'staff_no@B5:text', 'start_date@B6:date', 'days@B7:number']);
});

test('sheets.fill writes values into a copy; the original and formulas are untouched', () => {
  const gas = makeGas({ spreadsheets: { [ID]: LEAVE } });
  const res = gas.post({
    action: 'sheets.fill', token: 'secret', spreadsheet: ID, name: 'leave_Ada Obi.xlsx',
    writes: [
      { sheet: 'Form', cell: 'C4', value: { kind: 'text', text: 'Ada Obi' } }, // inside merge B4:C4
      { sheet: 'Form', cell: 'B5', value: { kind: 'text', text: '00471' } },
      { sheet: 'Form', cell: 'B6', value: { kind: 'number', number: 46300 } },
      { sheet: 'Form', cell: 'B8', value: { kind: 'number', number: 1 } },
    ],
  });
  assert.equal(res.ok, true);
  assert.equal(res.written, 3);
  assert.deepEqual(res.skipped.map((s) => s.cell), ['B8']);
  assert.equal(res.name, 'leave_Ada Obi');
  const copy = gas.sheet(gas.copies()[0]).sheets[0].cells;
  assert.equal(copy.B4.v, 'Ada Obi');
  assert.equal(copy.B4.bg, '#fff2cc'); // formatting kept
  assert.equal(copy.B5.v, '00471');
  assert.equal(copy.B5.text, true); // kept as text, not the number 471
  assert.equal(copy.B6.v, 46300);
  assert.equal(copy.B8.f, '=20-B7');
  assert.equal(gas.sheet(ID).sheets[0].cells.B4.v, ''); // original unchanged
});

test('extract and detect call the AI with the key server-side and return documents', () => {
  const gas = makeGas({
    ai: (p) => (p.messages[0].content.at(-1).text.includes('snake_case')
      ? '{"fields":[{"sheet":"Form","cell":"B4","name":"employee_full_name","type":"text","hint":"as on ID","confidence":0.95}]}'
      : '```json\n{"documents":[{"label":"INV-1","fields":{"invoice_no":{"value":"INV-1","confidence":0.97,"snippet":"Invoice No: INV-1","page":1}},"rows":[]},{"label":"INV-2","fields":{"invoice_no":{"value":"INV-2","confidence":0.9}},"rows":[]}]}\n```'),
  });
  const ex = gas.post({ action: 'extract', token: 'secret', fields: [{ name: 'invoice_no', type: 'text' }], texts: [{ name: 'a.pdf', text: 'Invoice No: INV-1' }] });
  assert.equal(ex.documents.length, 2);
  assert.equal(ex.documents[1].fields.invoice_no.value, 'INV-2');
  const call = gas.aiCalls[0];
  assert.equal(call.headers['x-api-key'], 'test-key');
  assert.equal(call.payload.model, 'claude-opus-5');
  assert.equal(call.payload.fallbacks, 'default');
  const det = gas.post({ action: 'detect', token: 'secret', layout: { sheets: [{ name: 'Form', rows: ['A4: Name:'] }], inputs: [{ sheet: 'Form', cell: 'B4', label: 'Name', section: 'Employee details', name: 'employee_name', type: 'text' }] } });
  assert.equal(det.fields[0].name, 'employee_full_name');
  assert.match(gas.aiCalls[1].payload.messages[0].content[0].text, /Form!B4 label "Name" section "Employee details"/);
});

test('drive.save / list / get keep forms in the templates folder', () => {
  const gas = makeGas();
  const bytes = Buffer.from('PK fake xlsx bytes');
  assert.equal(gas.post({ action: 'drive.save', token: 'secret', name: 'Supplier invoice', hash: 'sha256:1', map: { fields: [] }, xlsxBase64: bytes.toString('base64') }).ok, true);
  // Saving again replaces the old copy rather than piling up duplicates.
  gas.post({ action: 'drive.save', token: 'secret', name: 'Supplier invoice', hash: 'sha256:2', map: { fields: [{ name: 'a' }] }, xlsxBase64: bytes.toString('base64') });
  const list = gas.post({ action: 'drive.list', token: 'secret' });
  assert.deepEqual(list.templates.map((t) => t.hash), ['sha256:2']);
  const got = gas.post({ action: 'drive.get', token: 'secret', name: 'Supplier invoice' }).template;
  assert.equal(Buffer.from(got.xlsxBase64, 'base64').toString(), 'PK fake xlsx bytes');
  assert.equal(got.map.fields[0].name, 'a');
});
