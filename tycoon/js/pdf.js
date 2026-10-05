// Your plan as a PDF, built here with no library so it works offline.
// PDF standard fonts only know Western characters, so money is written with
// the currency code (NGN 2.4M) rather than its symbol.

import { CURRENCIES, ASSET_CLASSES, CLASS_ORDER, pct } from './money.js';
import { ACCOUNT_TYPES, ageOf, valueOf, monthlyOf, RISK_LEVELS } from './model.js';
import { SPEND_CATS } from './money.js';

const ASCII = { '−': '-', '–': '-', '—': '-', '×': 'x', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '→': '->', '·': '-', '•': '-', '₦': 'NGN ', '£': 'GBP ', '€': 'EUR ', '₹': 'INR ' };
const clean = (s) => String(s).replace(/[^\x20-\x7E]/g, (c) => (ASCII[c] != null ? ASCII[c] : ''));
const escPdf = (s) => clean(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function charW(c, bold) {
  if (c === ' ') return 278;
  if ('il.,:;|!\'`'.includes(c)) return bold ? 278 : 222;
  if ('fjrt()[]-/'.includes(c)) return 333;
  if ('mwMW'.includes(c)) return c === 'm' ? 833 : 944;
  if (c >= 'A' && c <= 'Z') return bold ? 722 : 667;
  if (c >= '0' && c <= '9') return 556;
  return bold ? 590 : 540;
}
export const textWidth = (s, size, bold) => [...clean(s)].reduce((w, c) => w + charW(c, bold), 0) * size / 1000;
const hex = (c) => { const n = parseInt(c.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255).toFixed(3)).join(' '); };

export class Pdf {
  constructor() { this.W = 595; this.H = 842; this.M = 44; this.pages = []; this.newPage(); }
  newPage() { this.ops = []; this.pages.push(this.ops); this.y = this.H - this.M; }
  ensure(h) { if (this.y - h < this.M + 20) this.newPage(); }
  text(x, y, s, { size = 10, bold = false, color = '#14213d', align = 'left' } = {}) {
    let tx = x;
    if (align === 'right') tx = x - textWidth(s, size, bold);
    if (align === 'center') tx = x - textWidth(s, size, bold) / 2;
    this.ops.push(`BT ${hex(color)} rg /${bold ? 'F2' : 'F1'} ${size} Tf ${tx.toFixed(1)} ${y.toFixed(1)} Td (${escPdf(s)}) Tj ET`);
  }
  rect(x, y, w, h, fill) { this.ops.push(`${hex(fill)} rg ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`); }
  poly(pts, fill) { this.ops.push(`${hex(fill)} rg ${pts.map(([x, y], i) => `${x.toFixed(1)} ${y.toFixed(1)} ${i ? 'l' : 'm'}`).join(' ')} h f`); }
  line(pts, color = '#14213d', lw = 1) { this.ops.push(`${hex(color)} RG ${lw} w ${pts.map(([x, y], i) => `${x.toFixed(1)} ${y.toFixed(1)} ${i ? 'l' : 'm'}`).join(' ')} S`); }
  wrap(s, width, size, bold) {
    const lines = []; let cur = '';
    for (const w of clean(s).split(/\s+/).filter(Boolean)) { const t = cur ? `${cur} ${w}` : w; if (textWidth(t, size, bold) > width && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    return lines;
  }
  para(s, { x = this.M, width = this.W - 2 * this.M, size = 10, bold = false, color = '#14213d', gap = 4 } = {}) {
    const lh = size * 1.35;
    for (const ln of this.wrap(s, width, size, bold)) { this.ensure(lh); this.text(x, this.y - size, ln, { size, bold, color }); this.y -= lh; }
    this.y -= gap;
  }
  heading(s) {
    this.ensure(44); this.y -= 10;
    this.text(this.M, this.y - 14, s, { size: 13, bold: true, color: '#0f5e4c' });
    this.line([[this.M, this.y - 20], [this.W - this.M, this.y - 20]], '#d5ddd9', 1);
    this.y -= 32;
  }
  row(k, v, { bold = false } = {}) {
    this.ensure(16);
    this.text(this.M, this.y - 11, k, { size: 10, bold });
    this.text(this.W - this.M, this.y - 11, v, { size: 10, bold, align: 'right' });
    this.y -= 16;
  }
  build(footer) {
    const objs = []; const add = (s) => { objs.push(s); return objs.length; };
    const catalog = add(''); const pagesObj = add('');
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    this.pages.forEach((ops, i) => {
      const extra = [`BT ${hex('#6b7a74')} rg /F1 8 Tf ${this.M} 24 Td (${escPdf(footer)}) Tj ET`, `BT ${hex('#6b7a74')} rg /F1 8 Tf ${this.W - this.M - 60} 24 Td (${escPdf(`Page ${i + 1} of ${this.pages.length}`)}) Tj ET`];
      const stream = [...ops, ...extra].join('\n');
      const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n'; const offsets = [];
    objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return bytes;
  }
}

// Money for the PDF: currency code, short form.
export function money(n, cur) {
  if (n == null || !Number.isFinite(n)) return '-';
  const a = Math.abs(n);
  const b = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `${(a / 1e3).toFixed(1)}K` : Math.round(a).toLocaleString('en-US');
  return `${n < 0 ? '-' : ''}${cur} ${b.replace(/\.0+([KMB])$/, '$1')}`;
}

export function planPdf(st, market, A, { date = new Date(), adviser = null } = {}) {
  const cur = st.currency;
  const M = (n) => money(n, cur);
  const pdf = new Pdf();
  const X = pdf.M; const W = pdf.W - 2 * pdf.M;
  const T = A.totals;
  pdf.text(X, pdf.y - 20, 'Your financial plan', { size: 22, bold: true, color: '#0f5e4c' });
  pdf.text(X, pdf.y - 38, `${st.name ? `${st.name} - ` : ''}age ${ageOf(st)} - ${CURRENCIES[cur].name} - ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, { size: 10, color: '#4a5a54' });
  pdf.y -= 56;
  if (adviser && adviser.on && adviser.name) { pdf.text(X, pdf.y + 4, `Prepared by ${adviser.name}${adviser.firm ? `, ${adviser.firm}` : ''}${adviser.contact ? ` - ${adviser.contact}` : ''}`, { size: 9, color: '#4a5a54' }); pdf.y -= 12; }

  // Headline boxes.
  const boxes = [
    ['Net worth', M(T.netWorth)],
    ['Plan works in', `${pct(A.success)} of futures`],
    ['Free around', Number.isFinite(A.freeAge.p50) ? `age ${A.freeAge.p50}` : 'not yet'],
    ['Safe retirement spending', `${M(A.safeMonthly)}/month`],
  ];
  const bw = (W - 18) / 4;
  boxes.forEach(([k, v], i) => {
    const bx = X + i * (bw + 6);
    pdf.rect(bx, pdf.y - 46, bw, 46, '#eef4f1');
    pdf.text(bx + 8, pdf.y - 16, k, { size: 8, color: '#4a5a54' });
    pdf.text(bx + 8, pdf.y - 34, v, { size: textWidth(v, 11, true) > bw - 14 ? 8.5 : 11, bold: true });
  });
  pdf.y -= 62;

  // The fan chart.
  const B = A.bands;
  if (B.length > 1) {
    const ch = 170; pdf.ensure(ch + 40);
    const top = pdf.y; const x0 = X + 60; const x1 = X + W; const y0 = top - ch;
    const lo = Math.min(0, ...B.map((b) => b.p10)); const hi = Math.max(Math.min(Math.max(...B.map((b) => b.p90)), Math.max(...B.map((b) => b.p75)) * 1.35), 1);
    const cl = (v) => Math.min(hi, v);
    const PX = (i) => x0 + (i / (B.length - 1)) * (x1 - x0);
    const PY = (v) => y0 + ((v - lo) / (hi - lo)) * ch;
    pdf.rect(x0, y0, x1 - x0, ch, '#fafcfb');
    for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4; pdf.line([[x0, PY(v)], [x1, PY(v)]], '#e3e9e6', 0.5); pdf.text(x0 - 4, PY(v) - 3, money(v, cur), { size: 7, color: '#4a5a54', align: 'right' }); }
    pdf.poly([...B.map((b, i) => [PX(i), PY(cl(b.p90))]), ...B.map((b, i) => [PX(i), PY(b.p10)]).reverse()], '#d9e7f8');
    pdf.poly([...B.map((b, i) => [PX(i), PY(cl(b.p75))]), ...B.map((b, i) => [PX(i), PY(b.p25)]).reverse()], '#b9d3f2');
    pdf.line(B.map((b, i) => [PX(i), PY(b.p50)]), '#2a78d6', 2);
    B.forEach((b, i) => { if (b.age % 10 === 0) pdf.text(PX(i), y0 - 11, String(b.age), { size: 7, color: '#4a5a54', align: 'center' }); });
    pdf.text(x0 + 6, top - 12, 'Net worth in today\'s money: middle outcome (line) and the range 8 in 10 futures fall in (shaded)', { size: 7.5, color: '#4a5a54' });
    pdf.y = y0 - 26;
  }

  const Pn = st.person || {};
  const facts = [Pn.occupation, Pn.marital, Pn.dependants ? `${Pn.dependants} other dependants` : '', st.household && st.household.kids.length ? `${st.household.kids.length} children` : '', Pn.health && Pn.health !== 'good' ? `health ${Pn.health}` : '', Pn.riskScore ? `risk profile: ${RISK_LEVELS[Pn.riskScore].name.toLowerCase()}` : ''].filter(Boolean);
  if (facts.length || Pn.goals || Pn.notes) {
    pdf.heading('About this person');
    if (facts.length) pdf.para(facts.join(' - '), { size: 10 });
    if (Pn.goals) pdf.para(`Goals: ${Pn.goals}`, { size: 10 });
    if (Pn.notes) pdf.para(`Notes: ${Pn.notes}`, { size: 9.5, color: '#33433d' });
  }
  pdf.heading('Your next steps');
  A.steps.slice(0, 6).forEach((s, i) => { pdf.para(`${i + 1}. ${s.title}`, { bold: true, size: 10, gap: 1 }); pdf.para(s.body, { size: 9.5, color: '#33433d', gap: 6 }); });

  pdf.heading('Where you stand');
  pdf.row('Money coming in each month', M(T.allIn));
  pdf.row('Spending each month', M(T.monthlySpend));
  pdf.row('Debt payments each month', M(T.debtPay));
  pdf.row('Left over each month', M(T.surplus), { bold: true });
  pdf.row('Savings rate', pct(T.savingsRate));
  pdf.row('Emergency fund', T.emergencyMonths == null ? '-' : `${T.emergencyMonths.toFixed(1)} months of spending`);
  pdf.y -= 6;
  for (const c of CLASS_ORDER) if (T.byClass[c] > 0) pdf.row(ASSET_CLASSES[c].name, M(T.byClass[c]));
  if (T.debt > 0) pdf.row('Debts', `-${M(T.debt)}`);
  pdf.row('Net worth', M(T.netWorth), { bold: true });

  pdf.heading('Your plan');
  pdf.row('Stop work at', `${st.plan.retireAge}`);
  pdf.row('Spending in retirement (today\'s money)', `${M((st.plan.spendRetire ?? T.monthlySpend))}/month`);
  pdf.row('Chance the plan lasts to age ' + st.plan.planAge, pct(A.success));
  pdf.row('Financially free (middle, and 8-in-10 range)', Number.isFinite(A.freeAge.p50) ? `${A.freeAge.p50} (${A.freeAge.p10} to ${Number.isFinite(A.freeAge.p90) ? A.freeAge.p90 : 'not by ' + st.plan.planAge})` : 'not within the plan');
  pdf.row('Invested money when you stop work (middle)', M(A.liquidAtRetire.p50));
  if (A.earliestRetire) pdf.row(`Earliest you could stop work (${pct(A.target)} success)`, `${A.earliestRetire}`);
  if (A.extraMonthly > 0) pdf.row(`Extra saving for ${pct(A.target)} success`, `${M(A.extraMonthly)}/month`);
  for (const g of st.goals) { const r = A.goals.find((x) => x.id === g.id); pdf.row(`Goal: ${g.name} (${M(g.amount)} at ${g.age})`, r ? `${pct(r.prob)} likely` : '-'); }

  pdf.heading('Household spending (monthly)');
  for (const x of st.spending) pdf.row(`${x.name || (SPEND_CATS[x.cat] || SPEND_CATS.other).name}${x.freq === 'year' ? ` (${M(x.amount)} a year)` : ''}`, M(monthlyOf(x)));
  if (T.school) pdf.row(`School fees (${st.household.kids.length} ${st.household.kids.length === 1 ? 'child' : 'children'})`, M(T.school));
  if (T.giving) pdf.row('Giving', M(T.giving));
  pdf.row('Total', M(T.monthlySpend), { bold: true });

  if (A.portfolio) {
    pdf.heading('Your investments');
    const P = A.portfolio;
    pdf.para(`Expected return after inflation ${pct(P.mu, 1)} a year, typical yearly swing ${pct(P.vol, 0)} (${P.level.toLowerCase()} risk). In a bad year (1 in 20) the whole mix could move about ${pct(P.badYear, 0)}. ${pct(P.usdShare, 0)} is in dollars, gold or crypto; ${pct(P.liquidShare, 0)} can be sold quickly.`, { size: 9.5 });
    for (const r of P.rows) pdf.row(`${r.name} (${pct(r.weight, 0)})`, `${M(r.value)}  -  real ${pct(r.real, 1)}`);
  }
  if (A.stress && A.stress.length) {
    pdf.heading('What could go wrong');
    for (const x of A.stress) pdf.row(x.name, `${pct(x.success)} success (${x.delta >= 0 ? '+' : '-'}${Math.abs(Math.round(x.delta * 100))} pts)`);
  }
  if (A.sensitivity && A.sensitivity.length) {
    pdf.heading('What matters most');
    for (const x of A.sensitivity) pdf.row(x.label, `${x.delta >= 0 ? '+' : '-'}${Math.abs(Math.round(x.delta * 100))} pts`);
  }

  if (A.ventures && A.ventures.length) {
    pdf.heading('Business and investment plans (2,000 scenarios each)');
    for (const r of A.ventures) {
      const v = st.ventures.find((x) => x.id === r.id); if (!v) continue;
      pdf.para(`${v.name || v.kind}: ${pct(r.success)} chance it ${v.successTest === 'survive' ? `is still running after ${v.years} years` : v.successTest === 'payback' ? 'pays back' : 'beats safe savings'}`, { bold: true, size: 10, gap: 1 });
      pdf.para(`Makes more than it costs in ${pct(r.profitable)} of scenarios; loses half or more in ${pct(r.lostHalf)}. Typical result ${r.multiple.p50.toFixed(2)}x the money (8 in 10 between ${r.multiple.p10.toFixed(1)}x and ${r.multiple.p90.toFixed(1)}x). Money needed up to ${M(r.peak.p90)}.${r.s5 != null ? ` Five-year survival used: ${pct(r.s5)}.` : ''}${v.include !== false ? ` Whole plan works in ${pct(r.planWith)} of futures with it, ${pct(r.planWithout)} without.` : ''}`, { size: 9.5, color: '#33433d', gap: 6 });
    }
  }
  pdf.heading('Your accounts');
  for (const a of st.accounts) pdf.row(`${a.name || ACCOUNT_TYPES[a.type].name}${a.type === 'stock' ? ` (${a.shares} x ${a.sym})` : ''}`, M(valueOf(a, st, market).v));
  for (const d of st.debts) pdf.row(`${d.name} at ${pct(d.rate, 1)} (${M(d.payment)}/month)`, `-${M(d.balance)}`);

  pdf.heading('Assumptions');
  const As = st.assumptions;
  pdf.para(`Inflation ${pct(As.infl, 1)} a year (varies by about ${pct(As.inflSd, 0)}). Savings and T-bills earn ${pct(As.deposit, 1)}. Long-run real returns after inflation: global shares ${pct(ASSET_CLASSES.globalEq.mu, 1)}, local shares ${pct(ASSET_CLASSES.localEq.mu, 1)}, bonds ${pct(ASSET_CLASSES.bonds.mu, 1)}, property ${pct(ASSET_CLASSES.property.mu, 1)} plus rent. ${A.risk.localEq ? `Your own local shares swung ${pct(A.risk.localEq.measured, 0)} a year over ${A.risk.localEq.days} trading days; the plan uses ${pct(A.risk.localEq.sd, 0)}. ` : ''}${market && market.asOf ? `Prices as of ${String(market.asOf).slice(0, 10)}${market.fx && cur === 'NGN' ? `, USD/NGN ${Math.round(market.fx)}` : ''}. ` : ''}2,000 simulated futures with fat-tailed returns, random inflation and currency moves. Withdrawals in retirement are taken from your most liquid money first; a ${pct(st.plan.swr, 1)} withdrawal rate defines "free".`, { size: 9, color: '#33433d' });
  pdf.para('This plan is an educational projection from the numbers you entered, not financial advice. Markets, inflation and exchange rates can do things history has not seen. Check your numbers every month and speak to a licensed adviser before large decisions.', { size: 8.5, color: '#6b7a74' });
  return pdf.build('Tycoon Rush plan - Produced by Ebims');
}
