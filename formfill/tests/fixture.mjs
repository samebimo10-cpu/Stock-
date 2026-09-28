// Builds a realistic supplier-invoice form as an .xlsx, the way Excel lays it
// out: shared strings, a style sheet with bold labels, bordered inputs and a
// date format, merged cells, a line-item table with a formula column, a logo
// and print setup. Tests fill it and compare the parts byte for byte.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const JSZip = require('../vendor/jszip.min.js');

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const strings = [
  'SUPPLIER INVOICE', 'Invoice No:', 'Date:', 'Supplier details', 'Name:', 'Phone:',
  'Description', 'Qty', 'Unit price', 'Line total', 'Total', 'For office use only', 'Approved by:', 'Signature:',
];
const S = (t) => strings.indexOf(t);

// Style indexes: 0 default, 1 bold label, 2 bordered input, 3 bordered date
// input, 4 bordered number input, 5 bold header with fill and border, 6 locked-free
const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function sheetXml() {
  const rows = [];
  rows.push(`<row r="1" spans="1:6"><c r="A1" s="1" t="s"><v>${S('SUPPLIER INVOICE')}</v></c></row>`);
  rows.push(`<row r="3" spans="1:6"><c r="A3" s="1" t="s"><v>${S('Invoice No:')}</v></c><c r="B3" s="2"/><c r="C3" s="2"/><c r="E3" s="1" t="s"><v>${S('Date:')}</v></c><c r="F3" s="3"/></row>`);
  rows.push(`<row r="5" spans="1:6"><c r="A5" s="1" t="s"><v>${S('Supplier details')}</v></c></row>`);
  rows.push(`<row r="6" spans="1:6"><c r="A6" s="1" t="s"><v>${S('Name:')}</v></c><c r="B6" s="2"/><c r="C6" s="2"/><c r="D6" s="2"/></row>`);
  rows.push(`<row r="7" spans="1:6"><c r="A7" s="1" t="s"><v>${S('Phone:')}</v></c><c r="B7" s="2"/></row>`);
  rows.push(`<row r="9" spans="1:6"><c r="A9" s="5" t="s"><v>${S('Description')}</v></c><c r="B9" s="5"/><c r="C9" s="5" t="s"><v>${S('Qty')}</v></c><c r="D9" s="5" t="s"><v>${S('Unit price')}</v></c><c r="E9" s="5" t="s"><v>${S('Line total')}</v></c></row>`);
  for (let r = 10; r <= 14; r++) {
    rows.push(`<row r="${r}" spans="1:6"><c r="A${r}" s="2"/><c r="B${r}" s="2"/><c r="C${r}" s="2"/><c r="D${r}" s="4"/><c r="E${r}" s="4"><f>C${r}*D${r}</f><v>0</v></c></row>`);
  }
  rows.push(`<row r="15" spans="1:6"><c r="D15" s="1" t="s"><v>${S('Total')}</v></c><c r="E15" s="4"><f>SUM(E10:E14)</f><v>0</v></c></row>`);
  rows.push(`<row r="17" spans="1:6"><c r="A17" s="1" t="s"><v>${S('For office use only')}</v></c></row>`);
  rows.push(`<row r="18" spans="1:6"><c r="A18" t="s"><v>${S('Approved by:')}</v></c><c r="B18" s="2"/></row>`);
  rows.push(`<row r="19" spans="1:6"><c r="A19" t="s"><v>${S('Signature:')}</v></c><c r="B19" s="2"/></row>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS}" xmlns:r="${R}"><dimension ref="A1:F19"/><sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="24.7109375" customWidth="1"/><col min="2" max="4" width="14" customWidth="1"/></cols><sheetData>${rows.join('')}</sheetData><mergeCells count="3"><mergeCell ref="B3:C3"/><mergeCell ref="B6:D6"/><mergeCell ref="A9:B9"/></mergeCells><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait"/><headerFooter><oddFooter>&amp;LCompany form v2</oddFooter></headerFooter><drawing r:id="rId1"/></worksheet>`;
}

export async function buildFixture({ withCalcPr = false } = {}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS}" xmlns:r="${R}"><workbookPr defaultThemeVersion="164011"/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="16384" windowHeight="8192"/></bookViews><sheets><sheet name="Form" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">Form!$A$1:$F$19</definedName></definedNames>${withCalcPr ? '<calcPr calcId="191029"/>' : ''}</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  zip.file('xl/styles.xml', styles);
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="${NS}" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`);
  zip.file('xl/worksheets/sheet1.xml', sheetXml());
  zip.file('xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
  zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>`);
  // A tiny stand-in for a logo; the bytes only need to survive unchanged.
  zip.file('xl/media/image1.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
