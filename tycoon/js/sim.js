// The projection engine: a Monte Carlo simulation of your money, year by year,
// from today to your planning age, in today's money (after inflation).
//
// What it models, and why:
// - Every asset class has a long-run real return and a yearly volatility
//   (money.js), drawn with fat tails (a mix of calm and stormy years) because
//   real markets crash more often than a bell curve says.
// - Shocks are linked through two common factors, the world economy and the
//   local economy, so in a bad local year local shares fall, property softens
//   and the local currency tends to weaken at the same time.
// - Dollar assets held by a saver in another currency earn their dollar return
//   plus the real change in the exchange rate. With no view on the currency
//   (purchasing power parity), that real change averages zero but swings a lot.
// - Inflation is random and sticky. Cash earns nothing, so it loses to it;
//   deposits and T-bills follow it partly; fixed-rate debts shrink with it.
// - Salary, spending, rent, business profit, pension income, debt payments and
//   your goals happen every year; what is left is invested in your chosen mix,
//   and shortfalls are drawn from your most liquid money first.
//
// Comparisons ("what if I save more?") reuse the same random paths (common
// random numbers), so the difference you see comes from the choice, not luck.

import { ASSET_CLASSES, CLASS_ORDER, CURRENCIES, clamp } from './money.js';

// When money runs short, it comes from the safest, most liquid places first.
const LIQUID_DRAW = ['cash', 'deposit', 'usdCash', 'bonds', 'usdBonds', 'gold', 'reit', 'localEq', 'globalEq', 'crypto'];
const MIX_SD = Math.sqrt(0.9 + 0.1 * 2.2 * 2.2);
const CALM = 1 / MIX_SD;
const STORM = 2.2 / MIX_SD;

// ------------------------------------------------------------------ random numbers

export function rng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashStr(String(seed));
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  next.normal = () => {
    if (spare != null) { const s = spare; spare = null; return s; }
    let u = 0; let v = 0;
    while (u === 0) u = next();
    while (v === 0) v = next();
    const m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  };
  // Fat tails with unit variance: most years are calm, one in ten is stormy
  // (2.2 times the swing). Markets really do switch between quiet and
  // turbulent spells, and this gives crashes about as often as history.
  next.t = () => (next() < 0.1 ? STORM : CALM) * next.normal();
  return next;
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// The random draws for every path and year, made once and reused by every
// scenario so comparisons are fair.
export function makeShocks(paths, years, seed = 'plan') {
  const r = rng(seed);
  const K = 18;
  const z = new Float64Array(paths * years * K);
  for (let i = 0; i < z.length; i++) z[i] = r.t();
  return { paths, years, K, z };
}

// Factor loadings: [world, local, own]. Each row's squares sum to about 1.
const LOAD = {
  bonds: [0.1, 0.35, 0.93],
  localEq: [0.35, 0.55, 0.76],
  globalEq: [0.95, 0, 0.31],
  usdCash: [0, 0, 1],
  crypto: [0.5, 0, 0.87],
  pension: [0.5, 0.4, 0.77],
  property: [0.2, 0.5, 0.84],
  business: [0.3, 0.5, 0.81],
  deposit: [0, 0.2, 0.98],
  reit: [0.3, 0.5, 0.81],
  usdBonds: [0.3, 0, 0.95],
  gold: [-0.15, 0, 0.99],
  land: [0.1, 0.5, 0.86],
  car: [0, 0, 1],
};
// Slots 0-3 are the world, local, inflation and currency factors; the rest are each class's own.
const OWN_SLOT = { bonds: 4, localEq: 5, globalEq: 6, usdCash: 7, crypto: 8, pension: 9, property: 10, business: 11, deposit: 12, reit: 13, usdBonds: 14, gold: 15, land: 16, car: 17 };

// All shocks at zero: the middle path, used for the year-by-year table.
export function zeroShocks(years) { return { paths: 1, years, K: 18, z: new Float64Array(years * 18) }; }

// ------------------------------------------------------------------ the simulation

// inp is built by model.buildInputs(); see there for the fields.
export function simulate(inp, shocks, { keepPaths = true, trace = false } = {}) {
  const { paths, years } = { paths: shocks.paths, years: Math.min(shocks.years, inp.years) };
  const Y = years + 1;
  const nw = keepPaths ? new Float64Array(paths * Y) : null;
  const liquidAtRetire = new Float64Array(paths);
  const freeAge = new Float64Array(paths).fill(Infinity);
  const failAge = new Float64Array(paths).fill(Infinity);
  const goalHit = inp.goals.map(() => 0);
  const classes = CLASS_ORDER;
  const mix = inp.mix;
  const mixKeys = Object.keys(mix).filter((k) => mix[k] > 0);
  const muLog = {};
  const FLAT = { mu: 0, sd: 0 };
  const cls = Object.fromEntries(classes.map((c) => [c, inp.cls[c] || FLAT]));
  for (const c of classes) {
    const a = cls[c];
    muLog[c] = Math.log(1 + a.mu) - (a.sd * a.sd) / 2;
  }
  const fxOn = inp.usdFx;
  const rows = trace ? [] : null;
  for (let p = 0; p < paths; p++) {
    const v = {};
    for (const c of classes) v[c] = inp.start[c] || 0;
    const debts = inp.debts.map((d) => ({ ...d }));
    let price = 1;
    let infl = inp.infl;
    let rentBase = inp.rent;
    const prop0 = Math.max(1, inp.start.property || 0);
    const biz0 = Math.max(1, inp.start.business || 0);
    let failed = false;
    if (nw) nw[p * Y] = netOf(v, debts, price);
    for (let t = 0; t < years; t++) {
      const age = inp.age + t;
      const base = (p * shocks.years + t) * shocks.K;
      const zW = shocks.z[base];
      const zL = shocks.z[base + 1];
      const zI = shocks.z[base + 2];
      // Inflation: sticky around its mean, higher in bad local years.
      infl = inp.infl + 0.5 * (infl - inp.infl) + inp.inflSd * 0.87 * (-0.3 * zL + 0.95 * zI);
      infl = Math.max(-0.02, infl);
      price *= 1 + infl;
      const working = age < inp.retireAge;
      // ---- money in and out this year (today's money)
      let income = working ? inp.salary * Math.pow(1 + inp.growth, t) : 0;
      if (age >= inp.pensionAge) income += inp.pensionIncome;
      income += inp.otherIncome;
      income += rentBase * (v.property / prop0);
      income += inp.bizProfit * (inp.start.business > 0 ? Math.max(0, v.business / biz0) : 1);
      // Living costs follow your budget while you work (each category rising at
      // its own pace), then your retirement target; scheduled costs such as
      // school fees and car replacements come on top in either phase.
      const living = working ? (inp.spendPath ? inp.spendPath[Math.min(t, inp.spendPath.length - 1)] : inp.spendNow) - (inp.spendCut || 0) : inp.spendRetire;
      const extra = inp.extraPath ? inp.extraPath[t] || 0 : 0;
      let spend = living + extra;
      let debtCost = 0;
      for (const d of debts) {
        if (d.bal <= 0) continue;
        const interest = d.bal * d.rate;
        const pay = Math.min(d.payment * 12, d.bal + interest);
        d.bal = d.bal + interest - pay;
        debtCost += pay / price;
      }
      // When a debt is cleared, its payment stays in the budget as saving.
      let net = income - spend - debtCost;
      // Goals: a lump sum at the goal's age.
      for (let g = 0; g < inp.goals.length; g++) {
        const G = inp.goals[g];
        if (G.age !== age) continue;
        const have = liquidOf(v, age >= inp.pensionAge);
        if (have + Math.max(0, net) >= G.amount) goalHit[g] += 1;
        net -= G.amount;
      }
      if (net >= 0) {
        for (const k of mixKeys) v[k] += net * mix[k];
      } else {
        let need = -net;
        need = draw(v, need, LIQUID_DRAW);
        if (need > 0 && age >= inp.pensionAge) need = draw(v, need, ['pension']);
        // Last resort: sell land, then property, at a discount.
        if (need > 0 && v.land > 0) { v.cash += v.land * 0.9; v.land = 0; need = draw(v, need, ['cash']); }
        if (need > 0 && v.property > 0) { const sale = v.property * 0.94; rentBase = 0; v.property = 0; v.cash += sale; need = draw(v, need, ['cash']); }
        if (need > 0) { failed = true; if (failAge[p] === Infinity) failAge[p] = age; v.cash -= need; }
      }
      // ---- one year of returns, in real terms
      // The real exchange rate: no drift unless you set one, weaker in bad local years.
      const fxReal = fxOn ? inp.fxDrift + inp.fxSd * (-0.5 * zL + 0.87 * shocks.z[base + 3]) : 0;
      const before = rows ? { ...v } : null;
      for (const c of classes) {
        if (!v[c]) continue;
        const a = cls[c];
        let r;
        if (c === 'cash') r = 1 / (1 + infl) - 1;
        else if (c === 'deposit') {
          const nominal = inp.depositRate + 0.7 * (infl - inp.infl);
          r = (1 + nominal) / (1 + infl) - 1 + a.sd * 0.3 * shocks.z[base + OWN_SLOT.deposit];
        } else {
          const L = LOAD[c];
          const shock = L[0] * zW + L[1] * zL + L[2] * shocks.z[base + OWN_SLOT[c]];
          r = Math.exp(muLog[c] + a.sd * shock) - 1;
        }
        if (fxOn && ASSET_CLASSES[c].usd) r = (1 + r) * (1 + fxReal) - 1;
        v[c] *= 1 + r;
        if (v[c] < 0 && c !== 'cash') v[c] = 0;
      }
      const N = netOf(v, debts, price);
      if (nw) nw[p * Y + t + 1] = N;
      if (rows && p === 0) {
        rows.push({
          age: age + 1, income, living, extra, debtCost, saved: net, infl, price,
          growth: classes.reduce((s, c) => s + (v[c] - before[c]), 0),
          classes: Object.fromEntries(classes.map((c) => [c, v[c]])),
          debt: debts.reduce((s, d) => s + Math.max(0, d.bal), 0) / price,
          nw: N, liquid: liquidOf(v, age + 1 >= inp.pensionAge), short: failed,
        });
      }
      if (age + 1 === inp.retireAge) liquidAtRetire[p] = liquidOf(v, false);
      // Free: what your money can safely pay each year covers your retirement spending.
      if (freeAge[p] === Infinity && !failed) {
        const pens = age + 1 >= inp.pensionAge;
        const can = inp.swr * (liquidOf(v, pens)) + rentBase * (v.property / prop0) + inp.bizProfit * (inp.start.business > 0 ? Math.max(0, v.business / biz0) : 1) + (pens ? inp.pensionIncome : 0) + inp.otherIncome;
        const owed = debts.reduce((s, d) => s + d.bal, 0) / price;
        if (can >= inp.spendRetire && liquidOf(v, pens) > owed) freeAge[p] = age + 1;
      }
    }
    if (inp.retireAge >= inp.age + years) liquidAtRetire[p] = liquidOf(v, false);
  }
  const out = summarise(inp, { paths, Y, nw, liquidAtRetire, freeAge, failAge, goalHit });
  if (rows) out.rows = rows;
  return out;
}

function draw(v, need, order) {
  for (const k of order) {
    if (need <= 0) break;
    const take = Math.min(v[k] || 0, need);
    if (take > 0) { v[k] -= take; need -= take; }
  }
  return need;
}

const liquidOf = (v, pensionOpen) => LIQUID_DRAW.reduce((s, k) => s + Math.max(0, v[k] || 0), 0) + (pensionOpen ? v.pension : 0);
const netOf = (v, debts, price) => CLASS_ORDER.reduce((s, k) => s + (v[k] || 0), 0) - debts.reduce((s, d) => s + Math.max(0, d.bal), 0) / price;

export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi || !Number.isFinite(sorted[hi])) return lo === hi ? sorted[lo] : Infinity;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function summarise(inp, R) {
  const { paths, Y, nw } = R;
  const bands = [];
  if (nw) {
    const col = new Float64Array(paths);
    for (let t = 0; t < Y; t++) {
      for (let p = 0; p < paths; p++) col[p] = nw[p * Y + t];
      const s = Array.from(col).sort((a, b) => a - b);
      bands.push({ age: inp.age + t, p10: quantile(s, 0.1), p25: quantile(s, 0.25), p50: quantile(s, 0.5), p75: quantile(s, 0.75), p90: quantile(s, 0.9) });
    }
  }
  const fa = Array.from(R.freeAge).sort((a, b) => a - b);
  const finite = fa.filter(Number.isFinite);
  const ok = Array.from(R.failAge).filter((a) => !Number.isFinite(a)).length;
  const lr = Array.from(R.liquidAtRetire).sort((a, b) => a - b);
  return {
    bands,
    success: ok / paths,
    freeBy: (age) => fa.filter((a) => a <= age).length / paths,
    freeAge: { p10: quantile(fa, 0.1), p50: quantile(fa, 0.5), p90: quantile(fa, 0.9), share: finite.length / paths },
    liquidAtRetire: { p10: quantile(lr, 0.1), p50: quantile(lr, 0.5), p90: quantile(lr, 0.9) },
    failAge: quantile(Array.from(R.failAge).filter(Number.isFinite).sort((a, b) => a - b), 0.5),
    goals: inp.goals.map((g, i) => ({ id: g.id, prob: R.goalHit[i] / paths })),
    paths,
  };
}

// ------------------------------------------------------------------ solving for a number

// Find the largest (or smallest) x in [lo, hi] for which test(x) holds, given test is monotone.
export function bisect(lo, hi, test, { iters = 13, want = 'max' } = {}) {
  let a = lo; let b = hi;
  if (want === 'max') {
    if (!test(a)) return null;
    if (test(b)) return b;
    for (let i = 0; i < iters; i++) { const m = (a + b) / 2; if (test(m)) a = m; else b = m; }
    return a;
  }
  if (test(a)) return a;
  if (!test(b)) return null;
  for (let i = 0; i < iters; i++) { const m = (a + b) / 2; if (test(m)) b = m; else a = m; }
  return b;
}

// The most you can spend each year in retirement and still succeed often enough.
export function safeSpending(inp, shocks, target) {
  const top = Math.max(inp.spendRetire * 4, inp.salary * 2, 1);
  return bisect(0, top, (s) => simulate({ ...inp, spendRetire: s }, shocks, { keepPaths: false }).success >= target);
}

// The extra saving a year needed to reach the success target.
export function extraSavingNeeded(inp, shocks, target) {
  const top = Math.max(inp.salary, inp.spendNow, 1) * 2;
  return bisect(0, top, (x) => simulate({ ...inp, spendCut: (inp.spendCut || 0) + x }, shocks, { keepPaths: false }).success >= target, { want: 'min' });
}

// The earliest whole age you could stop work and still succeed often enough.
// Success only rises as you work longer, so a binary search over ages is enough.
export function earliestRetirement(inp, shocks, target) {
  let lo = Math.max(inp.age + 1, 30); let hi = Math.min(inp.planAge - 5, 80);
  const ok = (a) => simulate({ ...inp, retireAge: a }, shocks, { keepPaths: false }).success >= target;
  if (lo > hi || !ok(hi)) return null;
  while (lo < hi) { const m = Math.floor((lo + hi) / 2); if (ok(m)) hi = m; else lo = m + 1; }
  return lo;
}

export const DEFAULTS = { paths: 2000, quickPaths: 600 };
export { CURRENCIES, clamp };
