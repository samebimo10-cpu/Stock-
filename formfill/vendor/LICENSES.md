# Bundled libraries

FormFill ships these libraries unmodified (apart from removing source-map comments) so that it works
offline. Each keeps its own licence.

| File(s) | Library | Version | Licence |
| --- | --- | --- | --- |
| `jszip.min.js` | [JSZip](https://github.com/Stuk/jszip) | 3.10.2 | MIT (dual MIT / GPL-3.0; used under MIT) |
| `pdf.min.js`, `pdf.worker.min.js` | [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist` legacy build, renamed from `.mjs`) | 4.10.38 | Apache-2.0 |
| `mammoth.browser.min.js` | [mammoth.js](https://github.com/mwilliamson/mammoth.js) | 1.13.0 | BSD-2-Clause |
| `ocr/tesseract.min.js`, `ocr/worker.min.js` | [Tesseract.js](https://github.com/naptha/tesseract.js) | 7.0.0 | Apache-2.0 |
| `ocr/tesseract-core-*.wasm.js` | [tesseract.js-core](https://github.com/naptha/tesseract.js-core) | 7.0.0 | Apache-2.0 |
| `ocr/eng.traineddata.gz` | [tessdata](https://github.com/tesseract-ocr/tessdata) English model via `@tesseract.js-data/eng` (4.0.0_best_int) | 1.0.0 | Apache-2.0 |
