// The end-of-game report: a PDF that grades the player's money decisions.
//
// It is built here, in plain JavaScript, so it works offline with no library:
// a small PDF writer (standard Helvetica fonts, text, lines, boxes) plus the
// judging logic, which reads the run's diary (run.journal) and its logs.
// PDF standard fonts only know Western characters, so money is written with
// the currency code (NGN 2.4M) rather than its symbol.

import * as E from './engine.js';
import { CURRENCIES, CHARACTERS, STATE_INFO, ASSETS, LESSONS, LIFESTYLES, HOMES, DISTRICTS } from './content.js';
import { PRINCIPLES, BOOKS } from './learn.js';

// ------------------------------------------------------------------ a tiny PDF writer

const ASCII = { '−': '-', '–': '-', '—': '-', '×': 'x', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '▲': '+', '▼': '-', '■': '=', '→': '->', '≈': '~', '·': '-', '•': '-', 'é': 'e', 'è': 'e', 'á': 'a', 'ó': 'o', 'í': 'i', 'ñ': 'n', 'ü': 'u', '✓': 'OK' };
const clean = (s) => String(s).replace(/[^\x20-\x7E]/g, (c) => (ASCII[c] != null ? ASCII[c] : ''));
const escPdf = (s) => clean(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

// Rough Helvetica glyph widths (in 1/1000 em), enough to wrap text well.
function charW(c, bold) {
  if (' '.includes(c)) return 278;
  if ('il.,:;|!\'`'.includes(c)) return bold ? 278 : 222;
  if ('fjrt()[]-/'.includes(c)) return 333;
  if ('mwMW'.includes(c)) return c === 'm' ? 833 : 944;
  if (c >= 'A' && c <= 'Z') return bold ? 722 : 667;
  if (c >= '0' && c <= '9') return 556;
  return bold ? 590 : 540;
}
export const textWidth = (s, size, bold) => [...clean(s)].reduce((w, c) => w + charW(c, bold), 0) * size / 1000;

function hex(c) {
  const n = parseInt(c.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255).toFixed(3)).join(' ');
}

export class Pdf {
  constructor() {
    this.W = 595; this.H = 842; this.M = 44;
    this.pages = [];
    this.newPage();
  }
  newPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = this.H - this.M;
    if (this.onPage) this.onPage(this);
  }
  ensure(h) { if (this.y - h < this.M + 20) this.newPage(); }
  text(x, y, s, { size = 10, bold = false, color = '#1b1336', align = 'left' } = {}) {
    let tx = x;
    if (align === 'right') tx = x - textWidth(s, size, bold);
    if (align === 'center') tx = x - textWidth(s, size, bold) / 2;
    this.ops.push(`BT ${hex(color)} rg /${bold ? 'F2' : 'F1'} ${size} Tf ${tx.toFixed(1)} ${y.toFixed(1)} Td (${escPdf(s)}) Tj ET`);
  }
  rect(x, y, w, h, fill, stroke = null, lw = 1) {
    const parts = [];
    if (fill) parts.push(`${hex(fill)} rg`);
    if (stroke) parts.push(`${hex(stroke)} RG ${lw} w`);
    parts.push(`${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    this.ops.push(parts.join(' '));
  }
  line(pts, color = '#1b1336', lw = 1, dash = null) {
    const d = pts.map(([x, y], i) => `${x.toFixed(1)} ${y.toFixed(1)} ${i ? 'l' : 'm'}`).join(' ');
    this.ops.push(`${hex(color)} RG ${lw} w ${dash ? `[${dash.join(' ')}] 0 d` : '[] 0 d'} ${d} S [] 0 d`);
  }
  circle(cx, cy, r, fill) {
    const k = 0.5523 * r;
    this.ops.push(`${hex(fill)} rg ${cx + r} ${cy} m ${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} c ${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} c ${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} c ${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} c f`);
  }
  wrap(s, width, size, bold) {
    const words = clean(s).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (textWidth(t, size, bold) > width && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  // Wrapped paragraph at the current position; moves y down.
  para(s, { x = this.M, width = this.W - 2 * this.M, size = 10, bold = false, color = '#1b1336', gap = 4 } = {}) {
    const lh = size * 1.35;
    for (const ln of this.wrap(s, width, size, bold)) {
      this.ensure(lh);
      this.text(x, this.y - size, ln, { size, bold, color });
      this.y -= lh;
    }
    this.y -= gap;
  }
  heading(s, color = '#6a4ab0') {
    this.ensure(44);
    this.y -= 10;
    this.text(this.M, this.y - 14, s.toUpperCase(), { size: 12, bold: true, color });
    this.line([[this.M, this.y - 19], [this.W - this.M, this.y - 19]], '#d8d0f0', 1);
    this.y -= 30;
  }
  build(footer) {
    const objs = [];
    const add = (s) => { objs.push(s); return objs.length; };
    const catalog = add('');
    const pagesObj = add('');
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    this.pages.forEach((ops, i) => {
      const extra = footer ? [`BT ${hex('#8a80b0')} rg /F1 8 Tf ${this.M} 24 Td (${escPdf(footer)}) Tj ET`, `BT ${hex('#8a80b0')} rg /F1 8 Tf ${this.W - this.M - 60} 24 Td (${escPdf(`Page ${i + 1} of ${this.pages.length}`)}) Tj ET`] : [];
      const stream = [...ops, ...extra].join('\n');
      const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n';
    const offsets = [];
    objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return bytes;
  }
}

// ------------------------------------------------------------------ judging the choices

const letter = (x) => (x >= 0.85 ? 'A' : x >= 0.7 ? 'B' : x >= 0.55 ? 'C' : x >= 0.4 ? 'D' : 'F');
const GRADE_COLOR = { A: '#1f9e6a', B: '#3a8fd0', C: '#d9a400', D: '#e07a2a', F: '#d23a55' };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function money(n, currency) {
  const code = CURRENCIES[currency] ? currency : 'USD';
  const a = Math.abs(n);
  let body = String(Math.round(a));
  for (const [v, u] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) if (a >= v) { body = (a / v).toFixed(a / v >= 100 ? 0 : 1) + u; break; }
  return `${n < 0 ? '-' : ''}${code} ${body}`;
}

// Grades each area of money behaviour from 0 to 1. Areas the player never met
// (no crashes, no forecasts) are left out rather than scored.
export function judge(run) {
  const L = run.log;
  if (!run.cureYears) run.cureYears = [0, 0, 0, 0, 0, 0, 0];
  const years = Math.max(1, run.age - run.startAge);
  const j = run.journal || [];
  const crashes = j.filter((e) => e.mood === 'crash').length;
  const held = run.flags.held || 0;
  const fs = E.forecastStats(run.fc || []);
  const prog = clamp(E.passive(run).total / E.bowl(run), 0, 1);
  const areas = [];
  const add = (id, name, score, did, next, principle) => areas.push({ id, name, score: clamp(score, 0, 1), grade: letter(clamp(score, 0, 1)), did, next, principle });

  const saved = run.cureYears[0] / years;
  add('save', 'Paying yourself first', saved,
    `Saved at least 10% of pay in ${run.cureYears[0]} of ${years} years.`,
    saved >= 0.85 ? 'Keep it up, and raise the share as your pay rises.' : 'Set "Pay yourself first" to 10-20% so saving happens before spending.', 'b_purse');

  const ctrl = run.cureYears[1] / years;
  const creep = run.life > (run.startLife ?? 1);
  add('spend', 'Controlling spending', ctrl - (creep ? 0.1 : 0),
    `Living costs stayed under 75% of pay in ${run.cureYears[1]} of ${years} years. Lifestyle ended at ${LIFESTYLES[run.life].name}${creep ? ', higher than you started' : ''}.`,
    ctrl >= 0.85 ? 'Good control. Every raise you do not spend shortens the road to freedom.' : 'When pay rises, keep living the same for a while and invest the difference.', 'b_control');

  const idleYears = L.idle;
  const multiply = run.cureYears[2] / years - Math.min(0.4, idleYears * 0.05);
  add('invest', 'Putting money to work', multiply,
    `At least 60% of your wealth was in things that earn in ${run.cureYears[2]} of ${years} years. Idle cash lost about ${idleYears.toFixed(1)} years of pay to inflation.`,
    multiply >= 0.85 ? 'Well done. Your money worked as hard as you did.' : 'Move spare cash into savings or the index fund each year instead of leaving it idle.', 'b_multiply');

  if (crashes > 0) {
    const calm = held / crashes - (L.panic > 0.25 ? 0.4 : 0);
    add('calm', 'Staying calm in crashes', calm,
      `Lived through ${crashes} crash year${crashes > 1 ? 's' : ''}, held on through ${held}${L.panic > 0.25 ? `, and sold near a crash at ${L.panicAge}, missing about ${L.panic.toFixed(1)} years of pay in the recovery` : ''}.`,
      calm >= 0.85 ? 'Excellent patience. Crashes are when patient investors are paid.' : 'Decide in advance not to sell in a crash; recoveries usually follow.', 'g_mrmarket');
  }

  add('spread', 'Spreading risk', 1 - Math.min(1, L.conc / 1.5) - (run.cards.includes('leverage') ? 0.1 : 0),
    L.conc > 0.25 ? `One asset lost about ${L.conc.toFixed(1)} years of pay in a single turn at ${L.concAge}.` : 'No single asset caused a big loss.',
    L.conc > 0.25 ? 'Keep any one risky asset to a slice of your money, not most of it.' : 'Your mix protected you. Keep it balanced.', 'p_room');

  const scams = L.scam + (L.trapTaps || 0) * 0.2;
  add('scam', 'Avoiding scams', 1 - Math.min(1, scams),
    L.scam > 0 || L.trapTaps ? `Lost about ${L.scam.toFixed(1)} years of pay to scams${L.trapTaps ? `, and clicked "get in" on ${L.trapTaps} scam headline${L.trapTaps > 1 ? 's' : ''}` : ''}.` : 'Never fell for a scam.',
    L.scam > 0 || L.trapTaps ? 'Guaranteed high returns plus pressure to act now is the signature of a scam. Walk away.' : 'Keep trusting that instinct.', 'b_guard');

  add('debt', 'Avoiding expensive debt', 1 - Math.min(1, L.debt / 1),
    L.debt > 0.05 ? `Paid about ${L.debt.toFixed(1)} years of pay in high-interest debt.` : 'Stayed clear of expensive debt.',
    L.debt > 0.05 ? 'Keep a year of costs in savings so surprises never go on a loan.' : 'Your emergency buffer did its job.', 'p_room');

  if (fs && fs.n >= 3) {
    const f = 1 - clamp((fs.brier - fs.ideal) / Math.max(0.01, 0.25 - fs.ideal), 0, 1) * 0.7;
    add('odds', 'Thinking in probabilities', fs.brier > 0.25 ? 0.2 : f,
      `${fs.n} forecasts with a Brier score of ${fs.brier.toFixed(3)} (a coin flip scores 0.250; the careful answer ${fs.ideal.toFixed(3)}).`,
      fs.brier <= fs.ideal + 0.02 ? 'Superb calibration. You read base rates and evidence like a pro.' : 'Start from the base rate, then move a little for each reliable headline.', 'x_calib');
  }

  const aimScore = run.aim ? (run.result && run.result.aimMet ? 1 : run.result && run.result.reason === 'free' ? 0.7 : prog * 0.8) : prog;
  add('goal', run.aim ? `Your goal: free by ${run.aim}` : 'Reaching freedom', aimScore,
    `Passive income covers ${Math.round(prog * 100)}% of your bowl${run.result && run.result.reason === 'free' ? `, free at ${run.result.age}` : ''}.`,
    aimScore >= 0.85 ? 'Goal reached. Consider what "enough" means to you now.' : 'Write a date on the goal and check it each year; adjust the plan, not the goal.', 'h_aim');

  if (run.partner || (run.kids && run.kids.length) || (run.flags && run.flags.separated)) {
    const P = run.partner;
    const kids = run.kids || [];
    const trust = P ? P.trust / 100 : 0.2;
    const school = kids.length ? kids.reduce((s, k) => s + (k.schoolYrs ? k.upSum / k.schoolYrs / 0.2 : 0.3), 0) / kids.length : 0.6;
    const fam = 0.6 * trust + 0.4 * clamp(school, 0, 1) - (run.flags.separated ? 0.3 : 0);
    add('family', 'Family and home', fam,
      `${P ? `Married to ${P.name}, trust ${Math.round(P.trust)}/100${P.revealed ? ` (a ${P.type})` : ''}` : run.flags.separated ? 'Separated along the way' : 'Single'}${kids.length ? `; ${kids.length} child${kids.length > 1 ? 'ren' : ''}` : ''}. Home: ${(HOMES[run.home.id] || {}).name || ''} in a ${((DISTRICTS[run.home.district] || {}).name || '').toLowerCase()}.`,
      fam >= 0.85 ? 'A strong household. Keep budgeting together.' : 'Frugal living, a cramped home and money secrets all cost trust. Budget together and give children the best school you can afford.', 'p_reasonable');
  }
  if (run.circle && run.circle.length) {
    const given = run.circle.reduce((s, c) => s + c.given, 0);
    const back = run.circle.reduce((s, c) => s + c.returned, 0);
    const lost = run.circle.filter((c) => ['taker', 'schemer'].includes(c.type)).reduce((s, c) => s + c.given - c.returned, 0);
    const ppl = 0.7 * (run.rep / 100) + 0.3 * Math.min(1, (run.giving || 0) / 0.05) - Math.min(0.3, lost / Math.max(1, run.salary));
    add('people', 'Your Circle and giving', ppl,
      `Reputation ${Math.round(run.rep)}/100. Gave ${money(given, run.currency)} to people you know, got ${money(back, run.currency)} back${lost > 0 ? `; ${money(lost, run.currency)} went to takers and schemers` : ''}.${run.giving ? ` Giving jar: ${Math.round(run.giving * 100)}% of income.` : ''}`,
      ppl >= 0.85 ? 'Generous and wise. Your name will help you when trouble comes.' : 'Ask questions before sending money. Help the genuine, set limits with takers.', 'b_lend');
  }

  if (run.quizAsked && run.quizAsked.length) {
    add('learn', 'Learning the ideas', run.quizRight / run.quizAsked.length,
      `Answered ${run.quizRight} of ${run.quizAsked.length} mentor questions correctly.`,
      'Read the principles you missed in the Library.', 'h_mastermind');
  }
  const overall = areas.reduce((s, a) => s + a.score, 0) / areas.length;
  return { areas, overall, grade: letter(overall), prog };
}

// ------------------------------------------------------------------ the report

const MOVES = (o) => Object.entries(o).map(([k, v]) => `${ASSETS[k] ? ASSETS[k].name : k} ${v}`);

export function buildReport(run, { name = '', date = new Date(), modeName = '', regionName = '', title = '' } = {}) {
  const cur = run.currency;
  const M = (n) => money(n, cur);
  // Game text carries the currency symbol, which PDF fonts can't draw.
  const sym = CURRENCIES[cur].sym.trim();
  const T = (s) => (/[^\x20-\x7E]/.test(sym) ? String(s).split(sym).join(`${cur} `) : String(s));
  const pdf = new Pdf();
  const W = pdf.W;
  const X = pdf.M;
  const inner = W - 2 * X;
  const res = run.result;
  const J = judge(run);
  const nw = E.netWorth(run);
  const p = E.passive(run);
  const bowl = E.bowl(run);
  const start = run.hist[0];

  // Title band.
  pdf.rect(0, pdf.H - 118, W, 118, '#1b1336');
  pdf.text(X, pdf.H - 52, 'TYCOON RUSH', { size: 26, bold: true, color: '#ffc53d' });
  pdf.text(X, pdf.H - 76, 'Money decisions report', { size: 14, bold: true, color: '#ffffff' });
  const who = [name || null, run.custom ? 'Real-life start' : (CHARACTERS[run.char] || {}).name, modeName, regionName, CURRENCIES[cur].name].filter(Boolean).join('  -  ');
  pdf.text(X, pdf.H - 98, who, { size: 10, color: '#c9c0ee' });
  pdf.text(W - X, pdf.H - 52, date.toISOString().slice(0, 10), { size: 10, color: '#c9c0ee', align: 'right' });
  pdf.y = pdf.H - 140;

  // Overall grade and outcome.
  pdf.circle(X + 34, pdf.y - 34, 30, GRADE_COLOR[J.grade]);
  pdf.text(X + 34, pdf.y - 44, J.grade, { size: 30, bold: true, color: '#ffffff', align: 'center' });
  pdf.text(X + 80, pdf.y - 20, title || (res ? '' : 'Game in progress'), { size: 18, bold: true });
  pdf.text(X + 80, pdf.y - 38, res ? `Score ${res.score.toLocaleString('en-US')}  -  Overall grade ${J.grade} (${Math.round(J.overall * 100)}/100)` : `Overall grade so far ${J.grade} (${Math.round(J.overall * 100)}/100)`, { size: 11 });
  pdf.text(X + 80, pdf.y - 54, `Age ${run.startAge} to ${run.age}  -  ${Math.round(J.prog * 100)}% of the way to freedom`, { size: 10, color: '#5a5078' });
  pdf.y -= 82;

  // Key numbers.
  const boxes = [
    ['Net worth', `${M(start.nw)} -> ${M(nw)}`],
    ['Passive income a year', M(p.total)],
    ['Bowl to fill a year', M(bowl)],
    ['Joy', `${Math.round(run.joy)} / 100`],
  ];
  const bw = (inner - 18) / 4;
  boxes.forEach(([k, v], i) => {
    const bx = X + i * (bw + 6);
    pdf.rect(bx, pdf.y - 46, bw, 46, '#f3effd');
    pdf.text(bx + 8, pdf.y - 16, k, { size: 8, color: '#6a5f94' });
    pdf.text(bx + 8, pdf.y - 34, v, { size: textWidth(v, 11, true) > bw - 14 ? 8.5 : 11, bold: true });
  });
  pdf.y -= 62;

  // Life Score: freedom, joy, family and people.
  const LS = res && res.life ? res.life : E.lifeScore(run, 'clock');
  if (run.stats) {
    pdf.ensure(70);
    pdf.text(X, pdf.y - 12, `Life Score: ${LS.stars} of 5 stars`, { size: 13, bold: true, color: '#8a6200' });
    const parts = [['Freedom', LS.parts.freedom, 2], ['Joy', LS.parts.joy, 1], ['Family', LS.parts.family, 1], ['People', LS.parts.people, 1]];
    const pw = (inner - 18) / 4;
    parts.forEach(([k, v, max], i) => {
      const px = X + i * (pw + 6);
      pdf.text(px, pdf.y - 30, `${k} ${v.toFixed(1)}/${max}`, { size: 8.5, color: '#5a5078' });
      pdf.rect(px, pdf.y - 44, pw, 7, '#ece6fb');
      pdf.rect(px, pdf.y - 44, pw * clamp(v / max, 0, 1), 7, '#e0a100');
    });
    pdf.y -= 60;
  }

  // Net worth against the Freedom Number.
  const hist = run.hist;
  if (hist.length > 1) {
    const ch = 150;
    pdf.ensure(ch + 30);
    const top = pdf.y;
    const x0 = X + 50;
    const x1 = W - X;
    const y0 = top - ch;
    const vals = hist.flatMap((h) => [Math.max(1, h.nw), Math.max(1, h.fn)]);
    const lo = Math.floor(Math.log10(Math.min(...vals)));
    const hi = Math.ceil(Math.log10(Math.max(...vals)));
    const span = Math.max(1, hi - lo);
    const PX = (i) => x0 + (i / (hist.length - 1)) * (x1 - x0);
    const PY = (v) => y0 + ((Math.log10(Math.max(1, v)) - lo) / span) * ch;
    pdf.rect(x0, y0, x1 - x0, ch, '#faf8ff', '#e2dcf5');
    for (let e = lo; e <= hi; e += span > 4 ? 2 : 1) {
      pdf.line([[x0, PY(10 ** e)], [x1, PY(10 ** e)]], '#e2dcf5', 0.5);
      pdf.text(x0 - 4, PY(10 ** e) - 3, money(10 ** e, cur).replace(`${cur} `, ''), { size: 7, color: '#6a5f94', align: 'right' });
    }
    const every = Math.ceil(hist.length / 8);
    hist.forEach((h, i) => { if (i % every === 0 || i === hist.length - 1) pdf.text(PX(i), y0 - 11, String(h.age), { size: 7, color: '#6a5f94', align: 'center' }); });
    pdf.line(hist.map((h, i) => [PX(i), PY(h.fn)]), '#e0a100', 1.4, [4, 3]);
    pdf.line(hist.map((h, i) => [PX(i), PY(h.nw)]), '#1f9e6a', 2);
    pdf.text(x0 + 6, top - 12, 'Net worth', { size: 8, bold: true, color: '#1f9e6a' });
    pdf.text(x0 + 60, top - 12, 'Freedom Number (25 x the bowl)', { size: 8, bold: true, color: '#b08000' });
    pdf.y = y0 - 24;
  }

  // The life story: the moments that shaped this run, and what might have been.
  const S = res && res.story;
  if (S && S.memories.length) {
    pdf.heading('Your life story');
    if (res.freeAge) pdf.para(`Financially free at ${res.freeAge}.`, { size: 10, bold: true });
    if (S.success) pdf.para(`Biggest success: ${S.success.title} (age ${S.success.age}).`, { size: 10 });
    if (S.mistake) pdf.para(`Biggest mistake: ${S.mistake.title} (age ${S.mistake.age}).`, { size: 10 });
    if (S.decision) pdf.para(`Best decision: ${S.decision.title} (age ${S.decision.age}).`, { size: 10 });
    pdf.para(`${S.businesses} businesses started, ${S.properties} properties, ${S.people} people helped, ${S.goals} goals reached.`, { size: 10, gap: 6 });
    const key = S.memories.filter((m) => !m.tags.includes('card')).slice(-14);
    for (const m of key) pdf.para(`Age ${m.age}  -  ${m.title}${m.impact ? ` (${m.impact > 0 ? '+' : '-'}${M(Math.abs(m.impact))})` : ''}`, { size: 9, gap: 1 });
    if (S.whatIf.length) {
      pdf.para('What if?', { size: 10, bold: true, gap: 2 });
      for (const w of S.whatIf) pdf.para(`${w.text}: about ${M(w.v)} more.`, { size: 9, gap: 2 });
    }
  }

  // Report card.
  pdf.heading('Your report card');
  for (const a of J.areas) {
    const did = pdf.wrap(a.did, inner - 80, 9, false);
    const next = pdf.wrap(`Next: ${a.next}`, inner - 80, 9, false);
    const h = 18 + (did.length + next.length) * 12 + 8;
    pdf.ensure(h);
    pdf.rect(X, pdf.y - h + 4, inner, h, '#faf8ff');
    pdf.circle(X + 22, pdf.y - h / 2 + 4, 14, GRADE_COLOR[a.grade]);
    pdf.text(X + 22, pdf.y - h / 2 - 1, a.grade, { size: 14, bold: true, color: '#ffffff', align: 'center' });
    pdf.text(X + 48, pdf.y - 12, a.name, { size: 11, bold: true });
    const pr = PRINCIPLES[a.principle];
    if (pr) pdf.text(W - X - 8, pdf.y - 12, clean(`${pr.title} (${BOOKS[pr.book].title})`).slice(0, 70), { size: 7, color: '#8a80b0', align: 'right' });
    let yy = pdf.y - 26;
    for (const ln of did) { pdf.text(X + 48, yy, ln, { size: 9 }); yy -= 12; }
    for (const ln of next) { pdf.text(X + 48, yy, ln, { size: 9, color: '#6a4ab0' }); yy -= 12; }
    pdf.y -= h + 4;
  }

  // Biggest lessons.
  pdf.heading('What mattered most');
  if (res && res.best) pdf.para(`Best move: ${res.best}`, { size: 10 });
  if (res && res.worst) pdf.para(`Costliest mistake: ${res.worst.text}`, { size: 10 });
  pdf.para(`Lesson: ${LESSONS[res ? res.lesson : 'none']}`, { size: 10, bold: true });
  if (res && res.earlier > 0) pdf.para(`Compound growth: starting 4 years earlier would have added about ${M(res.earlier)} to your investments.`, { size: 10 });
  const weak = J.areas.filter((a) => a.score < 0.7 && PRINCIPLES[a.principle]);
  if (weak.length) {
    pdf.para('To read next:', { size: 10, bold: true, gap: 2 });
    const seen = new Set();
    for (const a of weak) {
      const pr = PRINCIPLES[a.principle];
      if (seen.has(pr.book)) continue;
      seen.add(pr.book);
      pdf.para(`- ${BOOKS[pr.book].title}${BOOKS[pr.book].year ? ` (${BOOKS[pr.book].author})` : ''}: ${pr.title}. ${pr.idea}`, { size: 9, x: X + 10, width: inner - 10, gap: 2 });
    }
    pdf.y -= 4;
  }

  // Key decisions: every life event and card.
  const decisions = (run.journal || []).filter((e) => e.event || e.card);
  if (decisions.length) {
    pdf.heading('Key decisions');
    for (const e of decisions) {
      if (e.event) {
        pdf.para(T(`Age ${e.age1} - ${e.event.title}: you chose "${e.event.choice}". ${e.event.outcome}`), { size: 9, gap: 3 });
      }
      if (e.card) {
        pdf.para(`Age ${e.age1} - Took the card "${e.card.name}" (${e.card.type})${e.card.trap ? ': it was a scam.' : '.'}`, { size: 9, color: e.card.trap ? '#d23a55' : '#1b1336', gap: 3 });
      }
    }
  }

  // Year by year.
  const J2 = run.journal || [];
  if (J2.length) {
    pdf.heading('Year by year');
    const cols = [X, X + 58, X + 136, X + 380];
    const headRow = () => {
      pdf.ensure(30);
      pdf.rect(X, pdf.y - 16, inner, 16, '#ece6fb');
      ['Age', 'Market', 'What you did', 'Net worth'].forEach((h, i) => pdf.text(cols[i] + 4, pdf.y - 12, h, { size: 8, bold: true }));
      pdf.y -= 20;
    };
    headRow();
    for (const e of J2) {
      const did = [];
      if (e.pyf) did.push(`paid self first ${M(e.pyf)}`);
      const b = MOVES(e.buys).map((s) => s.replace(/ (\d+)$/, (m0, v) => ` +${M(Number(v))}`));
      const sl = MOVES(e.sells).map((s) => s.replace(/ (\d+)$/, (m0, v) => ` -${M(Number(v))}`));
      if (b.length) did.push(`bought ${b.join(', ')}`);
      if (sl.length) did.push(`sold ${sl.join(', ')}`);
      if (e.life !== e.lifeFrom) did.push(`lifestyle to ${LIFESTYLES[e.life].name}`);
      if (e.fc) did.push(`forecast ${Math.round(e.fc.p * 100)}% (careful ${Math.round(e.fc.ideal * 100)}%, ${e.fc.up ? 'beat' : 'missed'} inflation)`);
      if (!did.length) did.push('no changes');
      const lines = pdf.wrap(did.join('; '), cols[3] - cols[2] - 8, 8, false);
      const h = Math.max(1, lines.length) * 10 + 6;
      if (pdf.y - h < pdf.M + 20) { pdf.newPage(); headRow(); }
      pdf.text(cols[0] + 4, pdf.y - 9, `${e.age0}-${e.age1}`, { size: 8 });
      pdf.text(cols[1] + 4, pdf.y - 9, `${STATE_INFO[e.mood].name}${e.swan ? '!' : ''}`, { size: 8, color: e.mood === 'crash' ? '#d23a55' : e.mood === 'boom' ? '#1f9e6a' : '#1b1336' });
      lines.forEach((ln, i) => pdf.text(cols[2] + 4, pdf.y - 9 - i * 10, ln, { size: 8 }));
      const ch = e.nw1 - e.nw0;
      pdf.text(W - X - 4, pdf.y - 9, `${M(e.nw1)} (${ch >= 0 ? '+' : ''}${M(ch).replace(`${cur} `, '')})`, { size: 8, align: 'right', color: ch >= 0 ? '#1f9e6a' : '#d23a55' });
      pdf.line([[X, pdf.y - h + 2], [W - X, pdf.y - h + 2]], '#eeeaf8', 0.5);
      pdf.y -= h;
    }
  }

  pdf.y -= 10;
  pdf.para('This report comes from a game with a fictional market. It is for learning, not financial advice. The ideas it cites are paraphrased from the books named.', { size: 8, color: '#8a80b0' });
  return pdf.build(`Tycoon Rush report${name ? ` for ${name}` : ''}  -  samebimo10-cpu.github.io/Stock-/tycoon`);
}
