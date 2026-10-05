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
// scenario so comparisons are fair. K is the number of draws per year; the
// plan says how many it needs (needK).
export function makeShocks(paths, years, seed = 'plan', K = 18) {
  const r = rng(`${seed}:${K}`);
  const z = new Float32Array(paths * years * K);
  for (let i = 0; i < z.length; i++) z[i] = r.t();
  return { paths, years, K, z };
}

// All draws at zero: the middle path, used for the year-by-year table.
export function zeroShocks(years, K = 96) { return { paths: 1, years, K, z: new Float32Array(years * K) }; }

// Factor loadings by asset class: [world, the position's own country].
// The rest of each class's swing is its own.
const LOAD = {
  bonds: [0.1, 0.35], localEq: [0.35, 0.55], globalEq: [0.95, 0], usdCash: [0, 0], usdBonds: [0.3, 0], gold: [-0.15, 0],
  crypto: [0.5, 0], pension: [0.5, 0.4], property: [0.2, 0.5], land: [0.1, 0.5], business: [0.3, 0.5], reit: [0.3, 0.5], deposit: [0, 0.2], car: [0, 0], cash: [0, 0],
};
// When money runs short, it comes from the safest, most liquid places first.
const RANK = { cash: 0, deposit: 1, usdCash: 2, bonds: 3, usdBonds: 4, gold: 5, reit: 6, localEq: 7, globalEq: 8, crypto: 9 };

// Normal quantile (Acklam's approximation), for turning a chance into a threshold.
export function probit(p) {
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const lo = 0.02425;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - lo) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5; const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
const phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
function erf(x) { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }

// ------------------------------------------------------------------ the plan, in one shape

// Plans come in two shapes: the full one built by model.buildInputs, with every
// holding as a position (asset class x currency x place), every income with its
// own job risk, and spending by currency; and a simple one (used by tests and
// older callers) with totals by asset class in one currency. Both become this.
const NORM = new WeakMap();
export function normalise(inp) {
  if (NORM.has(inp)) return NORM.get(inp);
  const n = inp.positions ? normaliseFull(inp) : normaliseSimple(inp);
  NORM.set(inp, n);
  return n;
}

function normaliseSimple(inp) {
  const base = 'BASE';
  const FLAT = { mu: 0, sd: 0 };
  const positions = [];
  const mix = inp.mix || {};
  for (const c of CLASS_ORDER) {
    const v0 = (inp.start && inp.start[c]) || 0;
    const income = c === 'property' ? inp.rent || 0 : c === 'business' ? inp.bizProfit || 0 : 0;
    if (!v0 && !mix[c] && !income) continue;
    const a = (inp.cls && inp.cls[c]) || FLAT;
    const cur = ASSET_CLASSES[c].usd && inp.usdFx ? 'USD' : base;
    positions.push({ cls: c, cur, country: 'HOME', mu: a.mu ?? 0, sd: a.sd ?? 0, value: v0, income, mix: mix[c] || 0 });
  }
  const Y = inp.years + 1;
  const spend = inp.spendPath ? Float64Array.from(inp.spendPath) : new Float64Array(Y).fill(inp.spendNow || 0);
  const extra = inp.extraPath ? Float64Array.from(inp.extraPath) : new Float64Array(Y);
  return finish(inp, {
    base,
    countries: ['HOME'],
    currencies: { [base]: { sd: inp.usdFx ? inp.fxSd || 0 : 0, drift: -(inp.fxDrift || 0), local: 0.5, country: 'HOME', infl: inp.infl } },
    positions,
    incomes: [
      ...(inp.salary ? [{ amount: inp.salary, cur: base, country: 'HOME', work: true, growth: inp.growth || 0, sd: 0, pLoss: 0, search: 0, next: 1 }] : []),
      ...(inp.otherIncome ? [{ amount: inp.otherIncome, cur: base, country: 'HOME', work: false, growth: 0, sd: 0, pLoss: 0 }] : []),
    ],
    spendBy: { [base]: spend },
    extraBy: { [base]: extra },
    debts: (inp.debts || []).map((d) => ({ ...d, cur: base })),
  });
}

function normaliseFull(inp) {
  return finish(inp, {
    base: inp.base, countries: inp.countries, currencies: inp.currencies,
    positions: inp.positions.map((p) => ({ ...p })), incomes: inp.incomes, spendBy: inp.spendBy, extraBy: inp.extraBy,
    debts: (inp.debts || []).map((d) => ({ ...d })),
  });
}

function finish(inp, n) {
  // Ventures bring their own positions for what you hold at the end.
  n.ventures = (inp.ventures || []).map((V) => {
    let i = n.positions.findIndex((p) => p.cls === V.cls && p.cur === (V.cur || n.base));
    if (i < 0) { n.positions.push({ cls: V.cls, cur: V.cur || n.base, country: V.country || n.countries[0], mu: (inp.cls && inp.cls[V.cls] ? inp.cls[V.cls].mu : 0) ?? 0, sd: (inp.cls && inp.cls[V.cls] ? inp.cls[V.cls].sd : 0) ?? 0, value: 0, income: 0, mix: 0 }); i = n.positions.length - 1; }
    return { ...V, pos: i, cur: V.cur || n.base };
  });
  const curList = Object.keys(n.currencies).filter((c) => c !== 'USD');
  if (!n.currencies[n.base]) n.currencies[n.base] = { sd: 0, drift: 0, local: 0, country: n.countries[0], infl: inp.infl };
  if (!n.currencies.USD) n.currencies.USD = { sd: 0, drift: 0, local: 0, country: 'US', infl: 0.025 };
  // Slot layout per year: world, inflation, countries, currencies, positions, incomes (2 each).
  n.slot = { country: {}, cur: {} };
  let k = 2;
  for (const c of n.countries) n.slot.country[c] = k++;
  for (const c of curList) n.slot.cur[c] = k++;
  n.posSlot = k; k += n.positions.length;
  n.incSlot = k; k += 2 * n.incomes.length;
  n.K = k;
  n.order = n.positions.map((p, i) => i).filter((i) => RANK[n.positions[i].cls] != null).sort((a, b) => RANK[n.positions[a].cls] - RANK[n.positions[b].cls] || (n.positions[a].cur === n.base ? -1 : 1));
  n.mixIdx = n.positions.map((p, i) => [i, p.mix || 0]).filter(([, m]) => m > 0);
  const ms = n.mixIdx.reduce((s, [, m]) => s + m, 0) || 1;
  n.mixIdx = n.mixIdx.map(([i, m]) => [i, m / ms]);
  for (const inc of n.incomes) inc.q = inc.pLoss > 0 ? probit(inc.pLoss) : -Infinity;
  return n;
}

export const needK = (inp) => normalise(inp).K;

// ------------------------------------------------------------------ the simulation

export function simulate(inp, shocks, { keepPaths = true, trace = false } = {}) {
  const n = normalise(inp);
  const paths = shocks.paths;
  const years = Math.min(shocks.years, inp.years);
  const Y = years + 1;
  const K = shocks.K;
  const Z = shocks.z;
  const at = (base, slot) => Z[base + (slot % K)];
  const nwArr = keepPaths ? new Float64Array(paths * Y) : null;
  const liquidAtRetire = new Float64Array(paths);
  const freeAge = new Float64Array(paths).fill(Infinity);
  const failAge = new Float64Array(paths).fill(Infinity);
  const goalHit = inp.goals.map(() => 0);
  const P = n.positions;
  const NP = P.length;
  const muLog = P.map((p) => Math.log(1 + p.mu) - (p.sd * p.sd) / 2);
  const own = P.map((p) => { const L = LOAD[p.cls] || [0, 0]; return Math.sqrt(Math.max(0, 1 - L[0] * L[0] - L[1] * L[1])); });
  const curs = Object.keys(n.currencies);
  const rows = trace ? [] : null;
  let jobLossPaths = 0; let monthsOut = 0;
  for (let p = 0; p < paths; p++) {
    const v = new Float64Array(NP);
    for (let i = 0; i < NP; i++) v[i] = P[i].value || 0;
    const v0 = Float64Array.from(v);
    const debts = n.debts.map((d) => ({ ...d }));
    const L = Object.fromEntries(curs.map((c) => [c, 0]));
    let rel = Object.fromEntries(curs.map((c) => [c, 1]));
    const inc = n.incomes.map(() => ({ level: 1, out: 0 }));
    let price = 1; let infl = inp.infl; let failed = false; let lostJob = false;
    const pensionOpen = (age) => age >= inp.pensionAge;
    const liquid = (pens) => { let s = 0; for (let i = 0; i < NP; i++) if (RANK[P[i].cls] != null || (pens && P[i].cls === 'pension')) s += Math.max(0, v[i]); return s; };
    const debtReal = (t) => debts.reduce((s, d) => s + Math.max(0, d.bal) / (d.cur === n.base ? price : Math.pow(1 + (n.currencies[d.cur] || {}).infl || 0, t + 1)) * rel[d.cur], 0);
    if (nwArr) { let s = 0; for (let i = 0; i < NP; i++) s += v[i]; nwArr[p * Y] = s - debts.reduce((a, d) => a + Math.max(0, d.bal), 0); }
    for (let t = 0; t < years; t++) {
      const age = inp.age + t;
      const base = (p * shocks.years + t) * K;
      const zW = at(base, 0);
      // Home inflation: sticky, higher in bad home years.
      const zHome = at(base, n.slot.country[n.countries[0]]);
      infl = inp.infl + 0.5 * (infl - inp.infl) + inp.inflSd * 0.87 * (-0.3 * zHome + 0.95 * at(base, 1));
      infl = Math.max(-0.02, infl);
      price *= 1 + infl;
      // Exchange rates: each currency's real value against the dollar drifts and
      // swings, and weak currencies fall in their own country's bad years.
      const prevRel = rel;
      for (const c of curs) {
        if (c === 'USD') continue;
        const C = n.currencies[c];
        const zc = n.slot.cur[c] != null ? at(base, n.slot.cur[c]) : 0;
        const zl = C.country != null && n.slot.country[C.country] != null ? at(base, n.slot.country[C.country]) : 0;
        L[c] += C.drift + C.sd * ((C.local || 0) * zl + Math.sqrt(1 - (C.local || 0) ** 2) * zc);
      }
      rel = Object.fromEntries(curs.map((c) => [c, Math.exp(L[c] - L[n.base])]));
      const working = age < inp.retireAge;
      // ---- income
      let income = 0; let jobless = 0;
      n.incomes.forEach((x, i) => {
        const s = inc[i];
        if (!x.work) { income += x.amount * rel[x.cur]; return; }
        if (!working) return;
        const zWage = at(base, n.incSlot + 2 * i + 1);
        s.level *= Math.exp((x.growth || 0) - ((x.sd || 0) ** 2) / 2 + (x.sd || 0) * zWage);
        let months = 12;
        if (s.out > 0) { const m = Math.min(12, s.out); months -= m; s.out -= m; jobless += m; }
        else {
          const zLoss = at(base, n.incSlot + 2 * i);
          if (zLoss < x.q) {
            // Lost the job this year: how long the search takes is uncertain.
            // The search length is exponential around the country's typical search;
            // the loss falls at a random point in the year.
            const u = Math.max(1e-6, Math.min(1, phi(zLoss) / x.pLoss));
            const search = Math.max(1, -Math.log(u) * (x.search || 6));
            const left = 12 * (1 - phi(zWage));
            const m = Math.min(search, left);
            s.out = search - m; months -= m; jobless += m;
            s.level *= x.next ?? 1;
            lostJob = true;
          }
        }
        income += x.amount * s.level * (months / 12) * rel[x.cur];
      });
      if (pensionOpen(age)) income += inp.pensionIncome || 0;
      for (let i = 0; i < NP; i++) if (P[i].income) income += P[i].income * (v0[i] > 0 ? Math.max(0, v[i] / v0[i]) : 1);
      // ---- spending: by currency, each converted at this year's rates
      let living = 0;
      if (working) { for (const c in n.spendBy) living += (n.spendBy[c][Math.min(t, n.spendBy[c].length - 1)] || 0) * rel[c]; living -= inp.spendCut || 0; } else living = inp.spendRetire;
      let extra = 0;
      for (const c in n.extraBy) extra += (n.extraBy[c][t] || 0) * rel[c];
      let debtCost = 0;
      for (const d of debts) {
        if (d.bal <= 0) continue;
        const interest = d.bal * d.rate;
        const pay = Math.min(d.payment * 12, d.bal + interest);
        d.bal = d.bal + interest - pay;
        const pc = d.cur === n.base ? price : Math.pow(1 + (n.currencies[d.cur] || {}).infl || 0, t + 1);
        debtCost += (pay / pc) * rel[d.cur];
      }
      let net = income - living - extra - debtCost;
      for (const V of n.ventures) {
        net += (V.flows[(p % V.paths) * V.Y + t] || 0) * rel[V.cur];
        if (t === V.endYear) v[V.pos] += Math.max(0, V.terminal[p % V.paths]) * rel[V.cur];
      }
      for (let g = 0; g < inp.goals.length; g++) {
        const G = inp.goals[g];
        if (G.age !== age) continue;
        if (liquid(pensionOpen(age)) + Math.max(0, net) >= G.amount) goalHit[g] += 1;
        net -= G.amount;
      }
      if (net >= 0) { for (const [i, m] of n.mixIdx) v[i] += net * m; } else {
        let need = -net;
        for (const i of n.order) { if (need <= 0) break; const take = Math.min(Math.max(0, v[i]), need); v[i] -= take; need -= take; }
        if (need > 0 && pensionOpen(age)) for (let i = 0; i < NP; i++) if (P[i].cls === 'pension' && need > 0) { const take = Math.min(v[i], need); v[i] -= take; need -= take; }
        // Last resort: sell land, then property, at a discount.
        for (const cls of ['land', 'property']) for (let i = 0; i < NP; i++) if (need > 0 && P[i].cls === cls && v[i] > 0) { const got = v[i] * (cls === 'land' ? 0.9 : 0.94); v[i] = 0; const take = Math.min(got, need); need -= take; const left = got - take; if (left > 0 && n.order.length) v[n.order[0]] += left; }
        if (need > 0) { failed = true; if (failAge[p] === Infinity) failAge[p] = age; if (n.order.length) v[n.order[0]] -= need; }
      }
      // ---- a year of returns, in real terms of each position's own currency,
      // then the move in its exchange rate.
      const before = rows && p === 0 ? Float64Array.from(v) : null;
      for (let i = 0; i < NP; i++) {
        if (!v[i]) continue;
        const pos = P[i];
        let r;
        if (pos.cls === 'cash' && pos.cur === n.base) r = 1 / (1 + infl) - 1;
        else if (pos.cls === 'deposit' && pos.cur === n.base) {
          const nominal = (inp.depositRate ?? 0) + 0.7 * (infl - inp.infl);
          r = (1 + nominal) / (1 + infl) - 1 + pos.sd * 0.3 * at(base, n.posSlot + i);
        } else if (pos.realFixed != null) r = pos.realFixed;
        else {
          const Ld = LOAD[pos.cls] || [0, 0];
          const zc = n.slot.country[pos.country] != null ? at(base, n.slot.country[pos.country]) : 0;
          r = Math.exp(muLog[i] + pos.sd * (Ld[0] * zW + Ld[1] * zc + own[i] * at(base, n.posSlot + i))) - 1;
        }
        if (pos.cur !== n.base) r = (1 + r) * (rel[pos.cur] / prevRel[pos.cur]) - 1;
        v[i] *= 1 + r;
        if (v[i] < 0 && pos.cls !== 'cash' && RANK[pos.cls] !== 0) v[i] = Math.max(v[i], 0);
      }
      let sum = 0; for (let i = 0; i < NP; i++) sum += v[i];
      const N = sum - debtReal(t);
      if (nwArr) nwArr[p * Y + t + 1] = N;
      if (rows && p === 0) {
        const classes = Object.fromEntries(CLASS_ORDER.map((c) => [c, 0]));
        const byCur = {};
        for (let i = 0; i < NP; i++) { classes[P[i].cls] = (classes[P[i].cls] || 0) + v[i]; byCur[P[i].cur] = (byCur[P[i].cur] || 0) + v[i]; }
        let g = 0; for (let i = 0; i < NP; i++) g += v[i] - before[i];
        rows.push({ age: age + 1, income, living, extra, debtCost, saved: net, infl, price, growth: g, classes, byCur, jobless, debt: debtReal(t), nw: N, liquid: liquid(pensionOpen(age + 1)), short: failed });
      }
      if (age + 1 === inp.retireAge) liquidAtRetire[p] = liquid(false);
      if (freeAge[p] === Infinity && !failed) {
        const pens = pensionOpen(age + 1);
        let can = inp.swr * liquid(pens) + (pens ? inp.pensionIncome || 0 : 0);
        for (const x of n.incomes) if (!x.work) can += x.amount * rel[x.cur];
        for (let i = 0; i < NP; i++) if (P[i].income) can += P[i].income * (v0[i] > 0 ? Math.max(0, v[i] / v0[i]) : 1);
        if (can >= inp.spendRetire && liquid(pens) > debtReal(t)) freeAge[p] = age + 1;
      }
    }
    if (lostJob) jobLossPaths += 1;
    if (inp.retireAge >= inp.age + years) liquidAtRetire[p] = liquid(false);
  }
  const out = summarise(inp, { paths, Y, nw: nwArr, liquidAtRetire, freeAge, failAge, goalHit });
  out.jobLoss = jobLossPaths / paths;
  if (rows) out.rows = rows;
  return out;
}

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
  const top = Math.max(inp.spendRetire * 4, (inp.salary || 0) * 2, 1);
  return bisect(0, top, (s) => simulate({ ...inp, spendRetire: s }, shocks, { keepPaths: false }).success >= target);
}

// The extra saving a year needed to reach the success target.
export function extraSavingNeeded(inp, shocks, target) {
  const top = Math.max(inp.salary || 0, inp.spendNow || 0, 1) * 2;
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

// ------------------------------------------------------------------ changing a plan for a what-if

// Each helper returns a patch that works on either shape of plan.
const RISKY_EXCLUDE = ['cash', 'deposit', 'usdCash', 'car'];
export function scalePositions(inp, f) {
  if (inp.positions) return { positions: inp.positions.map((p) => ({ ...p, value: p.value * f(p) })) };
  return { start: Object.fromEntries(Object.entries(inp.start || {}).map(([c, v]) => [c, v * f({ cls: c, cur: ASSET_CLASSES[c] && ASSET_CLASSES[c].usd && inp.usdFx ? 'USD' : 'BASE' })])) };
}
export function scaleIncomes(inp, f) {
  if (inp.incomes) return { incomes: inp.incomes.map((x) => ({ ...x, amount: x.amount * f(x) })) };
  return { salary: (inp.salary || 0) * f({ work: true, cur: 'BASE' }) };
}
export function shiftReturns(inp, d) {
  if (inp.positions) return { positions: inp.positions.map((p) => (RISKY_EXCLUDE.includes(p.cls) || p.realFixed != null ? p : { ...p, mu: p.mu + d })) };
  return { cls: Object.fromEntries(Object.entries(inp.cls).map(([c, a]) => [c, RISKY_EXCLUDE.includes(c) ? a : { ...a, mu: a.mu + d }])) };
}
export function addCost(inp, t, amount) {
  if (inp.extraBy) {
    const b = Float64Array.from(inp.extraBy[inp.base] || new Float64Array(inp.years + 1));
    b[t] += amount;
    return { extraBy: { ...inp.extraBy, [inp.base]: b } };
  }
  const ex = Float64Array.from(inp.extraPath || new Float64Array(inp.years + 1));
  ex[t] += amount;
  return { extraPath: ex };
}
export function scaleJobRisk(inp, k) {
  if (!inp.incomes) return {};
  return { incomes: inp.incomes.map((x) => (x.work ? { ...x, pLoss: Math.min(0.9, x.pLoss * k) } : x)) };
}
// Spending, school fees and debts held in other currencies, scaled (for a devaluation).
export function scaleForeign(inp, k) {
  if (!inp.spendBy) return {};
  const sc = (by) => Object.fromEntries(Object.entries(by).map(([c, arr]) => [c, c === inp.base ? arr : arr.map((x) => x * k)]));
  return { spendBy: sc(inp.spendBy), extraBy: sc(inp.extraBy), debts: inp.debts.map((d) => ({ ...d, bal: d.bal * (d.cur === inp.base ? 0.8 : k), payment: d.payment * (d.cur === inp.base ? 1 : k) })) };
}
