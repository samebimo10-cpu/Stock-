// Planned ventures: a business, a rental property, land, a share purchase or a
// loan to someone, played out month by month in thousands of scenarios.
//
// The model, in plain terms:
// - Most new businesses close within a few years. Each sector starts from a
//   five-year survival rate (small-business studies put it near half; it is
//   lower where costs and credit are harsher), turned into a monthly chance of
//   closing. The founder's experience, time and early customers move it.
// - People planning a venture tend to expect more than they get (the planning
//   fallacy), so expected revenue is discounted by a "reality check" and then
//   drawn with wide uncertainty. Sales ramp up over the first months.
// - Set-up costs overrun, openings slip, fixed costs rise faster than prices,
//   and imported inputs follow the exchange rate.
// - When cash runs out beyond what the owner can add, the venture closes; the
//   equipment sells for part of its cost; any loan still owed falls on the owner.
// - Everything is in today's money. Success is judged against the safe
//   alternative: leaving the same money in savings or T-bills.

import { ASSET_CLASSES, CURRENCIES, clamp } from './money.js';
import { rng, quantile } from './sim.js';

// Five-year survival of new businesses by sector (typical small-business data,
// rounded; every one is editable in the venture itself).
export const SECTORS = {
  food: { name: 'Food: restaurant, bakery, catering, drinks', s5: 0.45, sigma: 0.5 },
  retail: { name: 'Shop: supermarket, pharmacy, boutique, phones', s5: 0.5, sigma: 0.45 },
  services: { name: 'Services: salon, laundry, repairs, cleaning, consulting', s5: 0.55, sigma: 0.45 },
  agric: { name: 'Farming: poultry, fish, crops, processing', s5: 0.45, sigma: 0.55 },
  trading: { name: 'Trading and import/export', s5: 0.45, sigma: 0.55 },
  transport: { name: 'Transport and logistics', s5: 0.45, sigma: 0.5 },
  manufacturing: { name: 'Manufacturing and production', s5: 0.5, sigma: 0.5 },
  tech: { name: 'Technology: app, software, online business', s5: 0.35, sigma: 0.8 },
  education: { name: 'Education: school, training, tutoring', s5: 0.6, sigma: 0.4 },
  health: { name: 'Health: clinic, lab, pharmacy services', s5: 0.6, sigma: 0.4 },
  realestate: { name: 'Real estate services: agency, short-let, facility', s5: 0.5, sigma: 0.5 },
  other: { name: 'Other', s5: 0.5, sigma: 0.55 },
};

// Where doing business is harder, more ventures close (an editable multiplier on the closure rate).
export const COUNTRY_RISK = { NGN: 1.3, GHS: 1.25, KES: 1.15, ZAR: 1.1, INR: 1.1, USD: 1, GBP: 1, EUR: 1, CAD: 1, AED: 1 };

export const KINDS = {
  business: { name: 'Start or buy a business', hint: 'A shop, farm, school, transport, online business or any trade.' },
  expand: { name: 'Expand a business you already run', hint: 'A new branch, machine, vehicle or product line.' },
  rental: { name: 'Buy or build property to rent out', hint: 'Flats, shops, short-lets or a hostel.' },
  land: { name: 'Buy land and hold it', hint: 'Land you plan to sell later.' },
  shares: { name: 'Buy shares, a fund, gold or crypto', hint: 'A lump sum into a market investment.' },
  lend: { name: 'Lend money or invest in someone else\'s business', hint: 'A loan or a stake that pays you back over time.' },
};

// How the person behind the venture moves its chance of lasting. Each is a
// multiplier on the monthly closure rate (below 1 is better).
export const HUMAN = {
  experience: { label: 'Years of experience in this line of work', options: [[0, 'None', 1.25], [1, '1–2 years', 1.0], [3, '3–5 years', 0.85], [6, '6 years or more', 0.75]] },
  commitment: { label: 'Who will run it day to day', options: [['full', 'You, full time', 0.85], ['part', 'You, part time', 1.15], ['manager', 'A manager or family member', 1.25]] },
  customers: { label: 'Customers or orders lined up before you start', options: [['yes', 'Yes, committed customers or orders', 0.85], ['some', 'Some interest, nothing firm', 1.0], ['no', 'Not yet', 1.1]] },
  tested: { label: 'Have you tested it small first?', options: [['yes', 'Yes, it already works on a small scale', 0.8], ['no', 'No, this is the first try', 1.0]] },
  records: { label: 'Will you keep proper books and a separate account?', options: [['yes', 'Yes', 0.92], ['no', 'Not really', 1.1]] },
};

export function newVenture(kind = 'business', currency = 'NGN') {
  const base = {
    id: Math.random().toString(36).slice(2, 10), kind, name: '', startMonth: 0, years: 5, include: true,
    reality: 0.15, successTest: 'beat',
  };
  if (kind === 'business' || kind === 'expand') {
    return {
      ...base, sector: 'food', capex: 0, workingCapital: 0, overrun: 0.2, delay: 3,
      revenue: 0, rampMonths: kind === 'expand' ? 3 : 9, growth: 0.03, varCost: 0.45, fixedCost: 0, costPrem: 0.01,
      imported: 0, passThrough: 0.6, loan: 0, loanRate: 0.25, loanMonths: 36, maxTopUp: null, salvage: 0.3, exitMultiple: 2,
      human: { experience: 1, commitment: 'full', customers: 'some', tested: kind === 'expand' ? 'yes' : 'no', records: 'yes' },
      s5: null, countryRisk: COUNTRY_RISK[currency] ?? 1,
    };
  }
  if (kind === 'rental') return { ...base, years: 10, price: 0, buyCosts: 0.1, renovation: 0, rent: 0, occupancy: 0.85, upkeep: 0.15, overrun: 0.15, delay: 6, loan: 0, loanRate: 0.22, loanMonths: 120, sellCost: 0.05 };
  if (kind === 'land') return { ...base, years: 10, price: 0, buyCosts: 0.1, holdCost: 0, titleRisk: 0.05, sellCost: 0.05 };
  if (kind === 'shares') return { ...base, years: 5, amount: 0, cls: 'localEq', key: '' };
  return { ...base, kind: 'lend', years: 3, amount: 0, rate: 0.25, months: 24, defaultRisk: 0.2, recovery: 0.2 };
}

// ------------------------------------------------------------------ the scenarios

const humanMult = (v) => {
  let m = 1;
  for (const [k, q] of Object.entries(HUMAN)) {
    const opt = q.options.find((o) => o[0] === (v.human || {})[k]);
    if (opt) m *= opt[2];
  }
  return m;
};

// The monthly chance of closing, from five-year survival, people and place.
export function closureRate(v) {
  const S = v.s5 ?? (SECTORS[v.sector] || SECTORS.other).s5;
  const base = 1 - Math.pow(S, 1 / 60);
  const mult = humanMult(v) * (v.countryRisk ?? 1) * (v.kind === 'expand' ? 0.7 : 1);
  return clamp(1 - Math.pow(1 - base, mult), 0, 0.2);
}
export const survival5 = (v) => Math.pow(1 - closureRate(v), 60);

// Monthly rate from a yearly one, for discounting. (Loans use the bank
// convention instead: the quoted yearly rate divided by twelve.)
const monthly = (annual) => Math.pow(1 + annual, 1 / 12) - 1;

// One scenario of a business: owner's monthly cash flows (negative = money in)
// and what the owner still holds at the end.
function runBusiness(v, r, ctx) {
  const M = v.years * 12;
  const flows = new Float64Array(M + 1);
  const h = closureRate(v);
  const sector = SECTORS[v.sector] || SECTORS.other;
  const sigma = sector.sigma * (v.human && v.human.customers === 'yes' ? 0.8 : 1) * (v.human && v.human.tested === 'yes' ? 0.8 : 1);
  const level = Math.exp(sigma * r.normal() - (sigma * sigma) / 2) * (1 - (v.reality || 0));
  const capex = (v.capex || 0) * Math.exp(Math.abs(r.normal()) * (v.overrun || 0));
  const fixedLevel = (v.fixedCost || 0) * Math.exp(Math.abs(r.normal()) * (v.overrun || 0) * 0.5);
  const open = Math.round(r() * (v.delay || 0));
  const loan = Math.min(v.loan || 0, capex + (v.workingCapital || 0));
  const pay = loan > 0 ? (loan * (v.loanRate / 12)) / (1 - Math.pow(1 + (v.loanRate / 12), -v.loanMonths)) : 0;
  let loanBal = loan;
  flows[0] = -(capex + (v.workingCapital || 0) - loan);
  let cash = v.workingCapital || 0; // the business's own till
  let topUps = 0;
  const topUpLimit = v.maxTopUp ?? 0.5 * ((v.capex || 0) + (v.workingCapital || 0));
  let alive = true; let closedAt = null; let fx = 1;
  let last12 = [];
  for (let m = 1; m <= M; m++) {
    if (m % 12 === 1 && ctx.fxSd) fx *= Math.exp(ctx.fxSd * r.normal() - (ctx.fxSd * ctx.fxSd) / 2);
    const yrs = m / 12;
    const ramp = m <= open ? 0 : Math.min(1, (m - open) / Math.max(1, v.rampMonths));
    const noise = Math.exp(0.12 * r.normal() - 0.0072);
    const priceUp = 1 + (v.passThrough || 0) * (fx - 1) * (v.imported || 0);
    const rev = (v.revenue || 0) * level * ramp * noise * Math.pow(1 + (v.growth || 0), Math.max(0, yrs - 1)) * priceUp;
    const costMult = 1 + (v.imported || 0) * (fx - 1);
    const varCost = rev * (v.varCost || 0) * costMult;
    const fixed = m <= open ? fixedLevel * 0.3 : fixedLevel * Math.pow(1 + (v.costPrem || 0), yrs);
    let loanPay = 0;
    if (loanBal > 0) { const i = loanBal * (v.loanRate / 12); loanPay = Math.min(pay, loanBal + i); loanBal = loanBal + i - loanPay; }
    const profit = rev - varCost - fixed - loanPay;
    cash += profit;
    // Owner takes out what the business can spare, keeping a month of fixed costs.
    let out = 0;
    if (cash > fixed) { out = cash - fixed; cash = fixed; }
    // Short of cash: the owner tops up, up to their limit; beyond it the venture closes.
    if (cash < 0) {
      if (topUps + -cash <= topUpLimit) { topUps += -cash; out = cash; cash = 0; } else { alive = false; }
    }
    flows[m] += out;
    last12.push(profit + loanPay); if (last12.length > 12) last12.shift();
    if (alive && r() < h) alive = false;
    if (!alive) {
      closedAt = m;
      flows[m] += capex * (v.salvage || 0) - loanBal + Math.min(0, cash);
      loanBal = 0;
      break;
    }
  }
  const yearProfit = last12.reduce((s, x) => s + x, 0);
  const terminal = alive ? Math.max(capex * (v.salvage || 0), (v.exitMultiple || 0) * yearProfit) - loanBal : 0;
  return { flows, terminal, alive, closedAt, topUps, monthlyProfit: alive ? yearProfit / 12 : 0 };
}

function runRental(v, r, ctx) {
  const M = v.years * 12;
  const flows = new Float64Array(M + 1);
  const cost = (v.price || 0) * (1 + (v.buyCosts || 0)) + (v.renovation || 0) * Math.exp(Math.abs(r.normal()) * (v.overrun || 0));
  const loan = Math.min(v.loan || 0, cost);
  const pay = loan > 0 ? (loan * (v.loanRate / 12)) / (1 - Math.pow(1 + (v.loanRate / 12), -v.loanMonths)) : 0;
  let bal = loan;
  flows[0] = -(cost - loan);
  const open = Math.round(r() * (v.delay || 0));
  const P = ASSET_CLASSES.property;
  let value = (v.price || 0) + (v.renovation || 0);
  let occ = v.occupancy;
  const rentLevel = (v.rent || 0) * (1 - (v.reality || 0) * 0.5) * Math.exp(0.15 * r.normal() - 0.01125);
  for (let m = 1; m <= M; m++) {
    if (m % 12 === 1) {
      value *= Math.exp(Math.log(1 + P.mu) - P.sd * P.sd / 2 + P.sd * r.normal());
      occ = clamp(v.occupancy + 0.12 * r.normal(), 0, 1);
    }
    const rent = m <= open ? 0 : rentLevel * occ;
    let lp = 0;
    if (bal > 0) { const i = bal * (v.loanRate / 12); lp = Math.min(pay, bal + i); bal = bal + i - lp; }
    flows[m] = rent * (1 - (v.upkeep || 0)) - lp;
  }
  return { flows, terminal: value * (1 - (v.sellCost || 0)) - bal, alive: true, closedAt: null, monthlyProfit: rentLevel * v.occupancy * (1 - (v.upkeep || 0)) - pay };
}

function runLand(v, r) {
  const M = v.years * 12;
  const flows = new Float64Array(M + 1);
  flows[0] = -(v.price || 0) * (1 + (v.buyCosts || 0));
  const L = ASSET_CLASSES.land;
  let value = v.price || 0;
  for (let y = 0; y < v.years; y++) value *= Math.exp(Math.log(1 + L.mu) - L.sd * L.sd / 2 + L.sd * r.normal());
  for (let m = 1; m <= M; m++) flows[m] = -(v.holdCost || 0) / 12;
  // Title and ownership disputes: lose a large part of the value.
  const dispute = r() < (v.titleRisk || 0);
  if (dispute) value *= 0.2 + 0.5 * r();
  return { flows, terminal: value * (1 - (v.sellCost || 0)), alive: !dispute, closedAt: null, monthlyProfit: 0 };
}

function runShares(v, r, ctx) {
  const M = v.years * 12;
  const flows = new Float64Array(M + 1);
  flows[0] = -(v.amount || 0);
  const C = ASSET_CLASSES[v.cls] || ASSET_CLASSES.localEq;
  const sd = ctx.measuredSd || C.sd;
  let value = v.amount || 0;
  for (let y = 0; y < v.years; y++) {
    const calm = r() < 0.1 ? 2.2 : 1;
    let g = Math.exp(Math.log(1 + C.mu) - sd * sd / 2 + sd * (calm / 1.176) * r.normal());
    if (C.usd && ctx.fxSd) g *= Math.exp(ctx.fxSd * r.normal() - ctx.fxSd * ctx.fxSd / 2);
    value *= g;
  }
  return { flows, terminal: value, alive: true, closedAt: null, monthlyProfit: 0 };
}

function runLend(v, r) {
  const M = v.years * 12;
  const flows = new Float64Array(M + 1);
  flows[0] = -(v.amount || 0);
  const n = Math.min(v.months, M);
  const pay = (v.amount * (v.rate / 12)) / (1 - Math.pow(1 + (v.rate / 12), -v.months));
  const defaultAt = r() < (v.defaultRisk || 0) ? 1 + Math.floor(r() * n) : Infinity;
  let bal = v.amount || 0;
  for (let m = 1; m <= n; m++) {
    if (m >= defaultAt) { flows[m] += bal * (v.recovery || 0); bal = 0; break; }
    const i = bal * (v.rate / 12); const p = Math.min(pay, bal + i); bal = bal + i - p; flows[m] = p;
  }
  return { flows, terminal: Math.max(0, bal), alive: defaultAt === Infinity, closedAt: Number.isFinite(defaultAt) ? defaultAt : null, monthlyProfit: pay };
}

const RUN = { business: runBusiness, expand: runBusiness, rental: runRental, land: runLand, shares: runShares, lend: runLend };

// Annual internal rate of return of monthly flows plus an ending value.
export function irr(flows, terminal) {
  const n = flows.length;
  // Present value at monthly rate m, by Horner's rule in x = 1/(1+m).
  const npv = (m) => { const x = 1 / (1 + m); let s = flows[n - 1] + terminal; for (let i = n - 2; i >= 0; i--) s = s * x + flows[i]; return s; };
  let lo = -0.5; let hi = 0.5;
  let flo = npv(lo);
  if (flo * npv(hi) > 0) return null;
  for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; const fm = npv(mid); if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; } }
  return Math.pow(1 + (lo + hi) / 2, 12) - 1;
}

// ------------------------------------------------------------------ the whole picture

// ctx: { safeReal: real yearly return of savings, fxSd, measuredSd }
export function simulateVenture(v, ctx = {}, { paths = 2000, seed = 'venture', keep = false } = {}) {
  const M = v.years * 12;
  const d = 1 / (1 + monthly(ctx.safeReal ?? 0));
  const df = new Float64Array(M + 1); df[0] = 1; for (let m = 1; m <= M; m++) df[m] = df[m - 1] * d;
  const out = { npv: [], multiple: [], payback: [], peak: [], alive: 0, beat: 0, profitable: 0, lostHalf: 0, paidBack: 0, irr: [], monthlyProfit: [], topUps: [] };
  const cum = keep ? Array.from({ length: M + 1 }, () => new Float64Array(paths)) : null;
  const yearly = new Float64Array(paths * (v.years + 1));
  const terminals = new Float64Array(paths);
  const runner = RUN[v.kind] || runBusiness;
  for (let p = 0; p < paths; p++) {
    const r = rng(`${seed}:${v.id}:${p}`);
    const s = runner(v, r, ctx);
    let c = 0; let peak = 0; let pv = 0; let pb = null; let inSum = 0; let outSum = 0;
    for (let m = 0; m <= M; m++) {
      const x = s.flows[m];
      c += x; if (c < peak) peak = c;
      if (pb == null && m > 0 && c >= 0) pb = m;
      pv += x * df[m];
      if (x < 0) inSum += -x; else outSum += x;
      if (cum) cum[m][p] = c;
      yearly[p * (v.years + 1) + Math.floor(m / 12)] += x;
    }
    terminals[p] = s.terminal;
    if (pb == null && c + s.terminal >= 0) pb = M;
    pv += s.terminal * df[M];
    const mult = inSum > 0 ? (outSum + s.terminal) / inSum : 0;
    out.npv.push(pv); out.multiple.push(mult); out.peak.push(-peak); out.payback.push(pb ?? Infinity);
    if (s.alive) out.monthlyProfit.push(s.monthlyProfit); out.topUps.push(s.topUps || 0);
    const ir = irr(s.flows, s.terminal); if (ir != null) out.irr.push(ir);
    if (s.alive) out.alive += 1;
    if (pv > 0) out.beat += 1;
    if (mult > 1) out.profitable += 1;
    if (mult < 0.5) out.lostHalf += 1;
    if (pb != null && pb <= M) out.paidBack += 1;
  }
  const q = (arr, x) => quantile(arr.slice().sort((a, b) => a - b), x);
  const success = v.successTest === 'survive' ? out.alive : v.successTest === 'payback' ? out.paidBack : out.beat;
  const res = {
    paths,
    success: success / paths,
    survive: out.alive / paths,
    beat: out.beat / paths,
    profitable: out.profitable / paths,
    lostHalf: out.lostHalf / paths,
    paidBack: out.paidBack / paths,
    npv: { p10: q(out.npv, 0.1), p50: q(out.npv, 0.5), p90: q(out.npv, 0.9) },
    multiple: { p10: q(out.multiple, 0.1), p50: q(out.multiple, 0.5), p90: q(out.multiple, 0.9) },
    irr: out.irr.length ? q(out.irr, 0.5) : null,
    peak: { p50: q(out.peak, 0.5), p90: q(out.peak, 0.9) },
    payback: q(out.payback, 0.5),
    monthlyProfit: out.monthlyProfit.length ? q(out.monthlyProfit, 0.5) : null,
    hist: histogram(out.multiple),
    yearly, terminals, years: v.years, startMonth: v.startMonth || 0,
    s5: v.kind === 'business' || v.kind === 'expand' ? survival5(v) : null,
  };
  if (cum) res.cum = cum.map((col) => { const s = Array.from(col).sort((a, b) => a - b); return { p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9) }; });
  return res;
}

// Where outcomes land, as multiples of the money put in.
function histogram(mult) {
  const edges = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, Infinity];
  const labels = ['Under 0.25×', '0.25–0.5×', '0.5–0.75×', '0.75–1×', '1–1.25×', '1.25–1.5×', '1.5–2×', '2–3×', '3× or more'];
  const n = labels.map(() => 0);
  for (const m of mult) for (let i = 0; i < labels.length; i++) if (m >= edges[i] && m < edges[i + 1]) { n[i] += 1; break; }
  return labels.map((label, i) => ({ label, share: n[i] / mult.length, loss: edges[i + 1] <= 1 }));
}

// What would move the odds most: each change on its own, same scenarios.
export function ventureLevers(v, ctx, { paths = 600 } = {}) {
  const tests = [];
  const b = simulateVenture(v, ctx, { paths });
  const add = (label, patch) => { const r = simulateVenture({ ...v, ...patch }, ctx, { paths }); tests.push({ label, delta: r.success - b.success, success: r.success }); };
  if (v.kind === 'business' || v.kind === 'expand') {
    add('Sales 20% higher than planned', { revenue: v.revenue * 1.2 });
    add('Sales 20% lower than planned', { revenue: v.revenue * 0.8 });
    add('Fixed costs 20% lower', { fixedCost: v.fixedCost * 0.8 });
    add('Opening 6 months later', { delay: (v.delay || 0) + 6 });
    add('Test it small first', { human: { ...v.human, tested: 'yes' } });
    add('Run it yourself full time', { human: { ...v.human, commitment: 'full' } });
    add('No loan', { loan: 0 });
  } else if (v.kind === 'rental') {
    add('Rent 20% lower', { rent: v.rent * 0.8 });
    add('Occupancy 10 points lower', { occupancy: Math.max(0, v.occupancy - 0.1) });
    add('No loan', { loan: 0 });
  } else if (v.kind === 'land') {
    add('Proper title checked (half the dispute risk)', { titleRisk: v.titleRisk / 2 });
    add('Hold 5 years longer', { years: v.years + 5 });
  } else if (v.kind === 'lend') {
    add('Half the chance of default', { defaultRisk: v.defaultRisk / 2 });
    add('Interest 5 points higher', { rate: v.rate + 0.05 });
  } else {
    add('Hold 5 years longer', { years: v.years + 5 });
  }
  return { base: b.success, levers: tests.filter((t) => Math.abs(t.delta) > 0.004).sort((a, c) => Math.abs(c.delta) - Math.abs(a.delta)) };
}

// Break-even sales a month for a business: fixed costs and loan payments
// covered once variable costs are paid.
export function breakEven(v) {
  if (!(v.kind === 'business' || v.kind === 'expand')) return null;
  const loan = v.loan || 0;
  const pay = loan > 0 ? (loan * (v.loanRate / 12)) / (1 - Math.pow(1 + (v.loanRate / 12), -v.loanMonths)) : 0;
  const margin = 1 - (v.varCost || 0);
  return margin > 0 ? ((v.fixedCost || 0) + pay) / margin : Infinity;
}

// Where a venture's ending value sits in your life plan.
export const END_CLASS = { business: 'business', expand: 'business', rental: 'property', land: 'land', lend: 'deposit' };

// Yearly owner flows per scenario for the life plan, aligned to plan years.
export function planFlows(res, planYears, paths) {
  const Y = planYears + 1;
  const flows = new Float64Array(paths * Y);
  const terminal = new Float64Array(paths);
  const off = Math.floor(res.startMonth / 12);
  const VY = res.years + 1;
  for (let p = 0; p < paths; p++) {
    const src = p % res.paths;
    for (let y = 0; y < VY; y++) if (off + y < Y) flows[p * Y + off + y] = res.yearly[src * VY + y];
    terminal[p] = res.terminals[src];
  }
  return { flows, terminal, endYear: Math.min(planYears, off + res.years) };
}

export { CURRENCIES };
