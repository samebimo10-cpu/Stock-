// Document readers: turning a PDF, Word file or photo into lines of text (for
// the on-device reader) and page images (for the AI, when it is used).
//
// Every library here is bundled with the app under vendor/, so reading works
// with no connection. The OCR engine is large, so it loads only the first time
// a scan or photo needs it; the service worker keeps it after that.

const here = (p) => new URL(p, import.meta.url).href;
const MAX_SIDE = 1600;

let pdfjsPromise = null;
function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(here('../vendor/pdf.min.js')).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = here('../vendor/pdf.worker.min.js');
      return lib;
    });
  }
  return pdfjsPromise;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src.split('/').pop()}`));
    document.head.appendChild(s);
  });
}

let mammothPromise = null;
function mammoth() {
  if (!mammothPromise) mammothPromise = (window.mammoth ? Promise.resolve() : loadScript(here('../vendor/mammoth.browser.min.js'))).then(() => window.mammoth);
  return mammothPromise;
}

// ---------------------------------------------------------------- images

function scaleCanvasTo(source, w, h, side) {
  const k = side / Math.max(w, h);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

// Text recognition reads small print badly, so small images are enlarged for
// it (up to 2400 px); images sent to the AI stay within 1600 px.
const OCR_SIDE = 2400;

async function imageToCanvas(file, max = MAX_SIDE) {
  const fit = (w, hgt) => (max === MAX_SIDE ? Math.min(MAX_SIDE, Math.max(w, hgt)) : Math.min(OCR_SIDE, Math.max(w, hgt) * 2.5));
  if (window.createImageBitmap) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const c = scaleCanvasTo(bmp, bmp.width, bmp.height, fit(bmp.width, bmp.height));
      bmp.close && bmp.close();
      return c;
    } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('This image could not be opened.')); i.src = url; });
    return scaleCanvasTo(img, img.naturalWidth, img.naturalHeight, fit(img.naturalWidth, img.naturalHeight));
  } finally { URL.revokeObjectURL(url); }
}

const canvasToJpeg = (c) => c.toDataURL('image/jpeg', 0.85);

// ---------------------------------------------------------------- OCR

// SIMD test module from wasm-feature-detect; picks the faster OCR build.
const SIMD_TEST = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

export const OCR_FILES = [
  '../vendor/ocr/tesseract.min.js',
  '../vendor/ocr/worker.min.js',
  '../vendor/ocr/eng.traineddata.gz',
  '../vendor/ocr/tesseract-core-simd-lstm.wasm.js',
  '../vendor/ocr/tesseract-core-lstm.wasm.js',
].map(here);

let ocrWorker = null;
async function ocr(onProgress) {
  if (ocrWorker) return ocrWorker;
  if (!window.Tesseract) await loadScript(here('../vendor/ocr/tesseract.min.js'));
  let simd = false;
  try { simd = WebAssembly.validate(SIMD_TEST); } catch { simd = false; }
  ocrWorker = await window.Tesseract.createWorker('eng', 1, {
    workerPath: here('../vendor/ocr/worker.min.js'),
    corePath: here(`../vendor/ocr/tesseract-core-${simd ? 'simd-' : ''}lstm.wasm.js`),
    langPath: here('../vendor/ocr/'),
    gzip: true,
    workerBlobURL: false,
    logger: (m) => { if (onProgress && m.status === 'recognizing text') onProgress(m.progress); },
  });
  return ocrWorker;
}

// Table borders confuse text recognition: it reads a ruled row of an invoice
// as noise. Long straight dark runs are ruling lines, never letters, so they
// are painted white before the page is read.
function removeRuling(canvas) {
  const w = canvas.width;
  const hgt = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, hgt);
  const d = img.data;
  const dark = new Uint8Array(w * hgt);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) dark[p] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 < 140 ? 1 : 0;
  const clear = new Uint8Array(w * hgt);
  const minH = Math.max(80, Math.round(w * 0.12));
  for (let y = 0; y < hgt; y++) {
    let run = 0;
    for (let x = 0; x <= w; x++) {
      if (x < w && dark[y * w + x]) { run++; continue; }
      if (run >= minH) for (let k = x - run; k < x; k++) clear[y * w + k] = 1;
      run = 0;
    }
  }
  const minV = Math.max(80, Math.round(hgt * 0.05));
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y <= hgt; y++) {
      if (y < hgt && dark[y * w + x]) { run++; continue; }
      if (run >= minV) for (let k = y - run; k < y; k++) clear[k * w + x] = 1;
      run = 0;
    }
  }
  // Enlarged photos blur each line into a grey fringe; take that too.
  let any = false;
  const R = 3;
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      if (!clear[y * w + x]) continue;
      any = true;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const yy = y + dy; const xx = x + dx;
          if (yy < 0 || yy >= hgt || xx < 0 || xx >= w) continue;
          const i = (yy * w + xx) * 4;
          if (dx === 0 && dy === 0 || (d[i] + d[i + 1] + d[i + 2]) / 3 < 235) { d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; }
        }
      }
    }
  }
  if (any) ctx.putImageData(img, 0, 0);
  return canvas;
}

// Reads text from an image. Returns { lines, quality } where quality is the
// OCR engine's own confidence (0-1); a low one usually means a blurry photo.
async function ocrCanvas(canvas, page, onProgress) {
  const worker = await ocr(onProgress);
  removeRuling(canvas);
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
  const lines = [];
  const blocks = data.blocks || [];
  for (const b of blocks) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        // Gaps much wider than a character become cell breaks (tabs).
        const words = l.words || [];
        let text = '';
        for (let i = 0; i < words.length; i++) {
          const w = words[i];
          if (i > 0) {
            const prev = words[i - 1];
            const gap = w.bbox.x0 - prev.bbox.x1;
            const charW = (prev.bbox.x1 - prev.bbox.x0) / Math.max(1, prev.text.length);
            text += gap > charW * 2.5 ? '\t' : ' ';
          }
          text += w.text;
        }
        if (text.trim()) lines.push({ text, page });
      }
    }
  }
  if (!lines.length && data.text) for (const t of data.text.split('\n')) if (t.trim()) lines.push({ text: t, page });
  return { lines, quality: (data.confidence || 0) / 100 };
}

// ---------------------------------------------------------------- PDF

function pdfLines(items, page) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const h = Math.abs(it.transform[3]) || it.height || 10;
    let row = rows.find((r) => Math.abs(r.y - y) < h * 0.5);
    if (!row) { row = { y, h, items: [] }; rows.push(row); }
    row.items.push({ x, w: it.width, str: it.str, h });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => {
    r.items.sort((a, b) => a.x - b.x);
    let text = '';
    let end = null;
    for (const it of r.items) {
      if (end != null) {
        const gap = it.x - end;
        const charW = it.w / Math.max(1, it.str.length) || it.h * 0.5;
        text += gap > Math.max(charW * 2.5, it.h * 1.2) ? '\t' : gap > charW * 0.2 ? ' ' : '';
      }
      text += it.str;
      end = it.x + it.w;
    }
    return { text: text.replace(/ +/g, ' '), page };
  });
}

async function readPdf(file, { wantImages, onStatus }) {
  const lib = await pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  let doc;
  try {
    doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
  } catch (e) {
    if (e && e.name === 'PasswordException') throw new Error(`${file.name} is password-protected. Remove the password and try again.`);
    throw new Error(`${file.name} could not be read as a PDF.`);
  }
  const out = { name: file.name, kind: 'pdf', pages: doc.numPages, lines: [], tables: [], images: [], quality: {}, scanned: false, text: '' };
  const pages = Math.min(doc.numPages, 20);
  for (let p = 1; p <= pages; p++) {
    onStatus && onStatus(`Reading page ${p} of ${pages}`);
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const lines = pdfLines(tc.items, p);
    const chars = lines.reduce((n, l) => n + l.text.replace(/\s/g, '').length, 0);
    if (chars >= 20) {
      out.lines.push(...lines);
      continue;
    }
    // A scanned page: render it and read the picture.
    out.scanned = true;
    const vp1 = page.getViewport({ scale: 1 });
    const scale = Math.min(4, (wantImages ? MAX_SIDE : OCR_SIDE) / Math.max(vp1.width, vp1.height));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    if (wantImages) out.images.push({ page: p, dataUrl: canvasToJpeg(canvas) });
    else {
      onStatus && onStatus(`Reading scanned page ${p} of ${pages} on this device`);
      const r = await ocrCanvas(canvas, p, (k) => onStatus && onStatus(`Reading scanned page ${p}: ${Math.round(k * 100)}%`));
      out.lines.push(...r.lines);
      out.quality[p] = r.quality;
    }
  }
  out.text = out.lines.map((l) => l.text).join('\n');
  return out;
}

// ---------------------------------------------------------------- Word

async function readDocx(file) {
  const m = await mammoth();
  const { value: html } = await m.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  const dom = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const lines = [];
  const tables = [];
  const walk = (node) => {
    for (const el of node.children) {
      if (el.tagName === 'TABLE') {
        const rows = [...el.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => td.textContent.replace(/\s+/g, ' ').trim()));
        tables.push(rows);
        for (const r of rows) lines.push({ text: r.join('\t'), page: 1 });
      } else if (/^(P|H\d|LI)$/.test(el.tagName)) {
        const t = el.textContent.replace(/\s+/g, ' ').trim();
        if (t) lines.push({ text: t, page: 1 });
      } else walk(el);
    }
  };
  walk(dom.body.firstElementChild);
  return { name: file.name, kind: 'docx', pages: 1, lines, tables, images: [], quality: {}, text: lines.map((l) => l.text).join('\n') };
}

// ---------------------------------------------------------------- entry point

export function documentKind(file) {
  const n = (file.name || '').toLowerCase();
  if (file.type === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (/^image\//.test(file.type) || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/.test(n)) return 'image';
  if (n.endsWith('.doc')) return 'doc';
  return null;
}

// Reads one document.
//   wantImages: true when the AI will read scans and photos itself, so they
//               are kept as images instead of being run through OCR here.
export async function readDocument(file, { wantImages = false, onStatus } = {}) {
  const kind = documentKind(file);
  if (kind === 'pdf') return readPdf(file, { wantImages, onStatus });
  if (kind === 'docx') return readDocx(file);
  if (kind === 'doc') throw new Error(`${file.name} is an old Word (.doc) file. Save it as .docx and try again.`);
  if (kind === 'image') {
    const canvas = await imageToCanvas(file, wantImages ? MAX_SIDE : OCR_SIDE);
    const out = { name: file.name, kind: 'image', pages: 1, lines: [], tables: [], images: [], quality: {}, scanned: true, text: '' };
    if (wantImages) {
      out.images.push({ page: 1, dataUrl: canvasToJpeg(canvas) });
    } else {
      onStatus && onStatus(`Reading ${file.name} on this device`);
      const r = await ocrCanvas(canvas, 1, (k) => onStatus && onStatus(`Reading ${file.name}: ${Math.round(k * 100)}%`));
      out.lines = r.lines;
      out.quality[1] = r.quality;
      out.text = r.lines.map((l) => l.text).join('\n');
    }
    return out;
  }
  throw new Error(`${file.name}: FormFill reads PDF, Word (.docx) and photos (JPG, PNG).`);
}

// Fetches the OCR files once so scans and photos can be read offline later.
// The service worker stores whatever passes through it.
export async function prefetchOcr(onProgress) {
  let done = 0;
  for (const url of OCR_FILES) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Download failed (${r.status})`);
    await r.arrayBuffer();
    done++;
    onProgress && onProgress(done / OCR_FILES.length);
  }
}
