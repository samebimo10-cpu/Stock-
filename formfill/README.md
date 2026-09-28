# FormFill: document-to-spreadsheet autofill

FormFill reads a source document (PDF, Word, or a photo or scan), finds the values a form needs, and
writes them into your own Excel template cell by cell. It leaves every other byte of the template
untouched.

Open it at **https://samebimo10-cpu.github.io/Stock-/formfill/**, then use "Add to Home Screen". After
the first visit **the whole app works offline**, including reading scans and photos. The only part that
needs a connection is the optional AI reader.

## How to use it

1. **Add a form.** Pick your `.xlsx` template. FormFill finds the label cells, the empty input cells
   next to or below them, and any line-item table (a header row with blank rows under it). It names
   and types each field (text, number, date, money, yes/no). Signatures and "office use only"
   sections are left alone.
2. **Confirm once.** The form is shown with the detected cells highlighted. Rename, retype or remove
   fields, or tap a cell the detector missed to add it. The map is saved against the template's
   SHA-256 hash. If you upload an edited version of the same form, the map is copied over and you
   are asked to check it again.
3. **Fill.** Take a photo or choose files, then tap **Read documents**. Each value comes back with a
   confidence score and the line it was read from.
4. **Review.** Missing, low-confidence (<80%) and wrong-type values are flagged. **Write form** stays
   disabled until every required field has a value. **Preview** shows the filled sheet.
5. **Download or share.** The file is named from a pattern such as
   `{templateId}_{supplier}_{invoice_date}.xlsx`. On phones, **Share** opens WhatsApp, email and so on.
6. **History.** The last 20 fills are kept (values only, never the documents), so you can make a form
   again from them.

## What "works offline" means here

| Part | Offline? | How |
| --- | --- | --- |
| App, forms, field maps, history | Yes | Service worker cache and IndexedDB |
| Editing the .xlsx | Yes | JSZip plus direct edits to the cell XML (`js/xlsx.js`) |
| Typed PDFs | Yes | pdf.js, bundled |
| Word .docx | Yes | mammoth.js, bundled |
| Scans and photos | Yes | Tesseract OCR (≈11 MB), downloaded in the background after the first visit. Its status is under Settings |
| Finding values | Yes | On-device reader (`js/extract.js`): label matching with synonyms, hints ("issue date, not due date"), type checks and table parsing |
| AI reading | Needs a connection | Optional Apps Script proxy. If you go offline, or the proxy fails, the on-device reader is used |

## The format-preservation rule

The output is the template with only the mapped cells' values changed:

* The workbook is never loaded into a library and saved again. The `.xlsx` package is opened as a zip,
  each target `<c>` node is rewritten in place, and every other part is copied across unchanged.
* A written cell keeps its style index, so it keeps the template's font, border and number format. A
  date goes in as a date serial, so a date cell still shows a date.
* Text is written as an inline string, so the shared-strings table is never touched.
* Formula cells, locked cells on protected sheets, and anything outside the map are never written. A
  value that doesn't fit its cell (text in a number cell) is flagged and left blank.
* In a merged range, only the top-left cell is written. Table rows are filled downward up to their
  maximum; rows are never inserted.
* If the workbook has formulas, `fullCalcOnLoad` is set in `workbook.xml` so totals recalculate when
  the file opens. That is the only other part that can change.
* Macro workbooks (`.xlsm`), old `.xls` files and password-protected files are refused with a clear
  message.

`tests/engine.test.mjs` checks all of this. It unzips the template and the output, compares every
part byte for byte, and confirms that only the mapped `<c>` nodes differ inside the edited sheet.

## Optional AI reader (Google Apps Script)

With a connection, a vision-capable model reads messy scans and unusual layouts better than on-device
OCR. The API key stays on the server:

1. Go to script.google.com, create a new project, and paste in [`apps-script/Code.gs`](apps-script/Code.gs).
2. Under Project Settings, then Script properties, add `ANTHROPIC_API_KEY` and `ACCESS_TOKEN` (any long
   random phrase). You can also add `MODEL` and `EFFORT`.
3. Choose Deploy, then New deployment, then Web app. Set "Execute as" to Me and "Who has access" to
   Anyone.
4. In FormFill, open **Settings** and paste the `/exec` URL and the access token. Tap **Test**.

The AI only returns values. The app still decides what gets written and where, and runs the same
validation and review.

## Files

```
formfill/
  index.html            app shell and styles
  sw.js                 offline cache (app shell and libraries; OCR pack in its own cache)
  js/xlsx.js            template engine: read the workbook, write cells, recalc flag
  js/detect.js          auto-detection of fields and line-item tables
  js/extract.js         on-device value finder
  js/normalize.js       number, date and yes/no parsing, validation, file names
  js/readers.js         PDF, Word, image and OCR readers
  js/ai.js              optional AI proxy client
  js/store.js           IndexedDB storage
  js/app.js             screens and flow
  apps-script/Code.gs   optional AI proxy
  vendor/               bundled libraries (see vendor/LICENSES.md)
  tests/                node --test suite
```

Run the tests with `node --test "formfill/tests/**/*.test.mjs"`. Run the app locally with
`python3 -m http.server -d formfill 8000` and open http://localhost:8000.

## Not in v1

Google Sheets as a target, `.xls`/`.xlsm`/`.ods`, nested tables, handwriting, unattended batch
runs. When the AI finds several invoices in one set of files, it says so and fills from the first;
read them one at a time to get one form per document.
