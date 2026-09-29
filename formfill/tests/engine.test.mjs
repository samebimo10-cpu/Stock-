// FormFill template engine, detection and extraction tests.
// Run with: node --test "formfill/tests/**/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSZip, buildFixture } from './fixture.mjs';
import * as X from '../js/xlsx.js';
import { detectFields, guessType } from '../js/detect.js';
import { validateValue, parseNumber, parseDate, outputFileName } from '../js/normalize.js';
import { extractOnDevice } from '../js/extract.js';

async function parts(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const out = {};
  for (const name of Object.keys(zip.files).sort()) {
    if (zip.files[name].dir) continue;
    out[name] = Buffer.from(await zip.file(name).async('uint8array'));
  }
  return out;
}

const cellsOf = (xml) => {
  const out = {};
  for (const c of X.findElements(xml, 'c')) out[X.parseAttrs(c.attrs).r] = xml.slice(c.start, c.end);
  return out;
};

test('filling changes only the mapped <c> nodes; every other part is byte-identical', async () => {
  const src = await buildFixture();
  const tpl = await X.openTemplate(JSZip, src);
  const { bytes, skipped } = await X.fillTemplate(JSZip, tpl, [
    { sheet: 'Form', cell: 'B3', value: { kind: 'text', text: 'INV-0042' } },
    { sheet: 'Form', cell: 'F3', value: { kind: 'number', number: X.dateToSerial(2026, 9, 28) } },
    { sheet: 'Form', cell: 'C6', value: { kind: 'text', text: 'Adebayo & Sons <Ltd>' } }, // inside merge B6:D6
    { sheet: 'Form', cell: 'C10', value: { kind: 'number', number: 5 } },
    { sheet: 'Form', cell: 'F7', value: { kind: 'text', text: 'new cell in row' } },
    { sheet: 'Form', cell: 'B21', value: { kind: 'text', text: 'new row' } },
  ]);
  assert.deepEqual(skipped, []);
  const a = await parts(src);
  const b = await parts(bytes);
  assert.deepEqual(Object.keys(a), Object.keys(b));
  const changed = Object.keys(a).filter((k) => !a[k].equals(b[k]));
  // The sheet, plus workbook.xml for the recalc-on-load flag (the form has formulas).
  assert.deepEqual(changed.sort(), ['xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
  assert.match(b['xl/workbook.xml'].toString(), /<calcPr fullCalcOnLoad="1"\/><\/workbook>/);
  assert.equal(b['xl/sharedStrings.xml'].toString(), a['xl/sharedStrings.xml'].toString());

  const before = cellsOf(a['xl/worksheets/sheet1.xml'].toString());
  const after = cellsOf(b['xl/worksheets/sheet1.xml'].toString());
  const diff = Object.keys({ ...before, ...after }).filter((r) => before[r] !== after[r]).sort();
  assert.deepEqual(diff, ['B21', 'B3', 'B6', 'C10', 'F3', 'F7']);
  assert.equal(after.B3, '<c r="B3" s="2" t="inlineStr"><is><t>INV-0042</t></is></c>');
  assert.equal(after.F3, '<c r="F3" s="3"><v>46293</v></c>');
  assert.equal(after.B6, '<c r="B6" s="2" t="inlineStr"><is><t>Adebayo &amp; Sons &lt;Ltd&gt;</t></is></c>');
  assert.equal(after.C10, '<c r="C10" s="2"><v>5</v></c>');

  // Everything outside the edited cells is the same text.
  const strip = (xml) => xml.replace(/<c r="(B3|F3|B6|C10)"[^>]*?(\/>|>.*?<\/c>)/g, '').replace(/<c r="F7".*?<\/c>/, '').replace(/<row r="21">.*?<\/row>/, '');
  assert.equal(strip(b['xl/worksheets/sheet1.xml'].toString()), strip(a['xl/worksheets/sheet1.xml'].toString()));

  // Re-open the output: the values read back and the rows stay in order.
  const again = await X.openTemplate(JSZip, bytes);
  const sheet = again.sheets[0];
  assert.equal(sheet.cells.get('B3').value, 'INV-0042');
  assert.equal(sheet.cells.get('B6').value, 'Adebayo & Sons <Ltd>');
  assert.equal(sheet.cells.get('F7').value, 'new cell in row');
  assert.equal(sheet.cells.get('B21').value, 'new row');
  const xml = b['xl/worksheets/sheet1.xml'].toString();
  assert.ok(xml.indexOf('r="19"') < xml.indexOf('r="21"'));
  assert.ok(xml.indexOf('r="E7"') < 0 && xml.indexOf('<c r="B7" s="2"/><c r="F7"') > 0);
});

test('never writes into formulas; an existing calcPr gains the flag', async () => {
  const tpl = await X.openTemplate(JSZip, await buildFixture({ withCalcPr: true }));
  const { bytes, skipped, written } = await X.fillTemplate(JSZip, tpl, [
    { sheet: 'Form', cell: 'E10', value: { kind: 'number', number: 99 } },
    { sheet: 'Form', cell: 'B7', value: { kind: 'text', text: '0803 000 0000' } },
  ]);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /formula/);
  assert.equal(written.length, 1);
  const wb = await (await JSZip.loadAsync(bytes)).file('xl/workbook.xml').async('string');
  assert.match(wb, /<calcPr calcId="191029" fullCalcOnLoad="1"\/>/);
});

test('refuses macro workbooks and password-protected files', async () => {
  const zip = await JSZip.loadAsync(await buildFixture());
  zip.file('xl/vbaProject.bin', 'x');
  await assert.rejects(X.openTemplate(JSZip, await zip.generateAsync({ type: 'uint8array' })), /macros/);
  await assert.rejects(X.openTemplate(JSZip, new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0, 0])), /password/);
});

test('detection finds the label/input pairs, the line-item table and skips office use', async () => {
  const tpl = await X.openTemplate(JSZip, await buildFixture());
  const map = detectFields(tpl, { templateId: 'supplier-invoice' });
  const byName = Object.fromEntries(map.fields.map((f) => [f.name, f]));
  // "Supplier details" + "Name" -> supplier_name; "Date" under the invoice title -> invoice_date.
  assert.deepEqual(Object.keys(byName).sort(), ['invoice_date', 'invoice_no', 'supplier_name', 'supplier_phone']);
  assert.equal(byName.invoice_no.cell, 'B3');
  assert.equal(byName.invoice_no.type, 'text');
  assert.equal(byName.invoice_date.cell, 'F3');
  assert.equal(byName.invoice_date.type, 'date');
  assert.equal(byName.supplier_name.cell, 'B6');
  assert.equal(byName.supplier_phone.type, 'text');
  assert.ok(map.table);
  assert.equal(map.table.startRow, 10);
  assert.equal(map.table.maxRows, 5);
  // Line total holds formulas, so it is not mapped.
  assert.deepEqual(map.table.columns, { description: 'A', qty: 'C', unit_price: 'D' });
  assert.ok(map.skipped.some((s) => s.cell === 'B18'));
  assert.ok(map.skipped.some((s) => s.cell === 'B19'));
  assert.equal(map.outputName, '{templateId}_{supplier_name}_{invoice_date}.xlsx');
});

test('values are cleaned and checked against the field and cell type', async () => {
  assert.equal(parseNumber('₦1,250,000.50'), 1250000.5);
  assert.equal(parseNumber('N 5,000'), 5000);
  assert.equal(parseNumber('$ (1,200)'), -1200);
  assert.equal(parseNumber('1.234,56'), 1234.56);
  assert.equal(parseNumber('Lagos'), null);
  assert.deepEqual(parseDate('03/04/2026', 'DMY'), { y: 2026, m: 4, d: 3 });
  assert.deepEqual(parseDate('03/04/2026', 'MDY'), { y: 2026, m: 3, d: 4 });
  assert.deepEqual(parseDate('25/12/2026', 'MDY'), { y: 2026, m: 12, d: 25 });
  assert.deepEqual(parseDate('28th September, 2026'), { y: 2026, m: 9, d: 28 });
  assert.deepEqual(parseDate('Sep 28, 2026'), { y: 2026, m: 9, d: 28 });
  assert.equal(parseDate('31/02/2026'), null);

  const tpl = await X.openTemplate(JSZip, await buildFixture());
  const sheet = tpl.sheets[0];
  const dateCell = X.cellInfo(sheet, 'F3', tpl.styles);
  assert.equal(dateCell.style.kind, 'date');
  assert.deepEqual(validateValue({ type: 'date' }, '28/09/2026', { cell: dateCell }).write, { kind: 'number', number: 46293 });
  assert.equal(validateValue({ type: 'text' }, 'hello', { cell: X.cellInfo(sheet, 'D10', tpl.styles) }).ok, false);
  assert.equal(validateValue({ type: 'number' }, 'twelve').ok, false);
  assert.equal(validateValue({ type: 'text', required: true }, '').message, 'Required: add a value.');
  assert.deepEqual(validateValue({ type: 'text' }, '00123').write, { kind: 'text', text: '00123' });
});

test('on-device extraction reads labels, types, hints and line items', async () => {
  const doc = {
    pages: 1,
    lines: [
      'ACME SUPPLIES LTD',
      'Invoice #:\tINV-2026-0917\t\tIssue Date: 17/09/2026',
      'Due Date: 30/09/2026',
      'Supplier Name: Acme Supplies Ltd',
      'Tel: +234 803 123 4567',
      'Description\tQty\tRate\tAmount',
      'Cement 50kg\t10\t9,500.00\t95,000.00',
      'Sharp sand (tonne)\t2\t18,000.00\t36,000.00',
      'Sub Total\t\t\t131,000.00',
      'Amount Due: ₦140,825.00',
    ].map((text) => ({ text, page: 1 })),
  };
  const map = {
    fields: [
      { name: 'invoice_no', label: 'Invoice No', type: 'text' },
      { name: 'invoice_date', label: 'Date', type: 'date', hint: 'issue date, not due date' },
      { name: 'supplier', label: 'Name', type: 'text', hint: 'supplier name' },
      { name: 'phone', label: 'Phone', type: 'text' },
      { name: 'total', label: 'Total', type: 'currency' },
      { name: 'po_number', label: 'PO Number', type: 'text' },
    ],
    table: { columns: { description: 'A', qty: 'C', unit_price: 'D' }, labels: { description: 'Description', qty: 'Qty', unit_price: 'Unit price' }, maxRows: 5 },
  };
  const r = extractOnDevice(map, [doc]);
  assert.equal(r.fields.invoice_no.value, 'INV-2026-0917');
  assert.equal(r.fields.invoice_date.value, '17/09/2026');
  assert.equal(r.fields.supplier.value, 'Acme Supplies Ltd');
  assert.equal(r.fields.phone.value, '+234 803 123 4567');
  assert.equal(parseNumber(r.fields.total.value), 140825);
  assert.equal(r.fields.po_number.value, null);
  assert.ok(r.fields.invoice_no.confidence >= 0.8);
  assert.deepEqual(r.rows, [
    { description: 'Cement 50kg', qty: '10', unit_price: '9,500.00' },
    { description: 'Sharp sand (tonne)', qty: '2', unit_price: '18,000.00' },
  ]);
});

test('output file names come from the pattern', () => {
  const today = new Date(2026, 8, 28);
  assert.equal(outputFileName('{templateId}_{supplier}_{invoice_date}.xlsx', { supplier: 'Acme Ltd', invoice_date: '17/09/2026' }, { templateId: 'inv', today }), 'inv_Acme Ltd_17-09-2026.xlsx');
  assert.equal(outputFileName('{templateId}_{missing}_{date}.xlsx', {}, { templateId: 'inv', today }), 'inv_2026-09-28.xlsx');
});

test('field types come from the label and the input cell format', () => {
  assert.equal(guessType('Existing loan?'), 'yesno');
  assert.equal(guessType('Invoice No.'), 'text');
  assert.equal(guessType('Account Number'), 'text');
  assert.equal(guessType('Number of staff'), 'number');
  assert.equal(guessType('Amount requested'), 'currency');
  assert.equal(guessType('Date of birth'), 'date');
  assert.equal(guessType('Start', { style: { kind: 'date' } }), 'date');
});

test('several invoices in one upload are split into separate documents', () => {
  const inv = (no, date, name, item) => [
    'ACME SUPPLIES LTD', `Invoice No: ${no}\tDate: ${date}`, `Name: ${name}`,
    'Description\tQty\tUnit price', `${item}\t1\t500.00`, 'Total: 500.00',
  ];
  const lines = [...inv('INV-101', '01/09/2026', 'Acme Ltd', 'Nails'), ...inv('INV-102', '02/09/2026', 'Bolt Ltd', 'Screws')]
    .map((text, i) => ({ text, page: i < 6 ? 1 : 2 }));
  const map = {
    fields: [
      { name: 'invoice_no', label: 'Invoice No', type: 'text' },
      { name: 'invoice_date', label: 'Date', type: 'date' },
      { name: 'supplier_name', label: 'Name', type: 'text' },
    ],
    table: { columns: { description: 'A', qty: 'C', unit_price: 'D' }, labels: { description: 'Description', qty: 'Qty', unit_price: 'Unit price' }, maxRows: 5 },
  };
  const r = extractOnDevice(map, [{ pages: 2, lines }]);
  assert.equal(r.documents.length, 2);
  assert.equal(r.documents[0].fields.invoice_no.value, 'INV-101');
  assert.equal(r.documents[1].fields.invoice_no.value, 'INV-102');
  assert.equal(r.documents[1].fields.supplier_name.value, 'Bolt Ltd');
  assert.deepEqual(r.documents[1].rows, [{ description: 'Screws', qty: '1', unit_price: '500.00' }]);
  assert.match(r.documents[1].label, /INV-102 · Bolt Ltd · 02\/09\/2026/);
  // One invoice stays one document, even with two different names on it.
  assert.equal(extractOnDevice(map, [{ pages: 1, lines: lines.slice(0, 6) }]).documents.length, 1);
  const shipTo = ['Invoice No: INV-7\tDate: 03/09/2026', 'Bill To Name: Ada Obi', 'Ship To Name: Warehouse 4'].map((text) => ({ text, page: 1 }));
  assert.equal(extractOnDevice(map, [{ pages: 1, lines: shipTo }]).documents.length, 1);
});

test('values longer than the cell shows are detected', async () => {
  const tpl = await X.openTemplate(JSZip, await buildFixture());
  const sheet = tpl.sheets[0];
  // B6:D6 is merged, 3 x 14 wide.
  assert.equal(X.overflows(sheet, 'B6', tpl.styles, 'Acme Supplies Ltd'), false);
  assert.equal(X.overflows(sheet, 'B6', tpl.styles, 'A'.repeat(60)), true);
  assert.equal(X.overflows(sheet, 'B7', tpl.styles, '0803 123 4567'), false);
  assert.equal(X.overflows(sheet, 'B7', tpl.styles, '+234 803 123 4567 ext 22'), true);
});

test('Google Sheets forms: layout becomes a template, protected ranges are never written', async () => {
  const { sheetModel, layoutHash } = await import('../js/gsheet.js');
  const layout = {
    spreadsheetId: 'abc', name: 'Leave request', url: 'https://docs.google.com/spreadsheets/d/abc',
    sheets: [{
      name: 'Form', hidden: false, rows: 12, cols: 4,
      // [row, col, shown, formula, bold, bg, format, numeric, wrap]
      cells: [
        [1, 1, 'LEAVE REQUEST', false, true, '', '', false, false],
        [3, 1, 'Employee details', false, true, '', '', false, false],
        [4, 1, 'Name:', false, true, '', '', false, false], [4, 2, '', false, false, 'fff2cc', '', false, false],
        [5, 1, 'Start date:', false, true, '', '', false, false], [5, 2, '', false, false, 'fff2cc', 'dd/mm/yyyy', false, false],
        [6, 1, 'Days:', false, true, '', '', false, false], [6, 2, '', false, false, 'fff2cc', '0.###############', false, false],
        [7, 1, 'Days left:', false, true, '', '', false, false], [7, 2, '10', true, false, '', '', true, false],
        [9, 1, 'Manager:', false, true, '', '', false, false], [9, 2, '', false, false, 'fff2cc', '', false, false],
      ],
      widths: [140, 200, 100, 100], heights: [], merges: ['B4:C4'], protectedSheet: false, unprotected: [], locked: ['B9'],
    }],
  };
  const tpl = sheetModel(layout);
  const map = detectFields(tpl, { templateId: 'leave' });
  const byName = Object.fromEntries(map.fields.map((f) => [f.name, f]));
  assert.deepEqual(Object.keys(byName).sort(), ['days', 'employee_name', 'start_date']);
  assert.equal(byName.start_date.type, 'date');
  assert.equal(byName.days.type, 'number');
  assert.match(X.writeBlocker(tpl, 'Form', 'B9'), /locked/);
  assert.match(X.writeBlocker(tpl, 'Form', 'B7'), /formula/);
  assert.equal(X.writeBlocker(tpl, 'Form', 'C4'), null);
  // Automatic format means General: a date into it goes in as text, not a serial.
  const auto = X.cellInfo(tpl.sheets[0], 'B6', tpl.styles);
  assert.deepEqual(validateValue({ type: 'date' }, '05/10/2026', { cell: auto }).write, { kind: 'text', text: '05/10/2026' });
  const dateCell = X.cellInfo(tpl.sheets[0], 'B5', tpl.styles);
  assert.equal(validateValue({ type: 'date' }, '05/10/2026', { cell: dateCell }).write.kind, 'number');
  // Editing the form changes its hash.
  const edited = JSON.parse(JSON.stringify(layout));
  edited.sheets[0].cells[2][2] = 'Full name:';
  assert.notEqual(await layoutHash(layout), await layoutHash(edited));
});

test('a table header printed without gaps is split on the column names', () => {
  const lines = ['Invoice No: 5', 'Description Qty Unit price Amount', 'Paint\t3\t1,500.00\t4,500.00', 'Total: 4,500.00'].map((text) => ({ text, page: 1 }));
  const map = { fields: [], table: { columns: { description: 'A', qty: 'C', unit_price: 'D' }, labels: { description: 'Description', qty: 'Qty', unit_price: 'Unit price' }, maxRows: 5 } };
  assert.deepEqual(extractOnDevice(map, [{ pages: 1, lines }]).rows, [{ description: 'Paint', qty: '3', unit_price: '1,500.00' }]);
});
