// One full analysis of your plan: the projection, the answers to "what would it
// take?", and your next steps ranked by how much they matter. Pure and plain
// data in and out, so it can run in a background worker and in tests.

import { simulate, makeShocks, zeroShocks, safeSpending, extraSavingNeeded, earliestRetirement } from './sim.js';
import { totals, buildInputs, measuredRisk, ageOf, classOf, valueOf, mixOf, ACCOUNT_TYPES, feeAt, kidAge } from './model.js';
import { compare } from './debt.js';
import { fmt, pct, CURRENCIES, ASSET_CLASSES, CLASS_ORDER, savingFor } from './money.js';
import { simulateVenture, ventureLevers, planFlows, breakEven, END_CLASS } from './venture.js';
import { portfolioVol } from './market.js';

let cache = { key: null, main: null, quick: null, mini: null };
function shocksFor(years, paths, quick) {
  const key = `${years}|${paths}|${quick}`;
  if (cache.key !== key) cache = { key, main: makeShocks(paths, years, 'plan-main'), quick: makeShocks(quick, years, 'plan-quick'), mini: makeShocks(Math.max(100, Math.round(quick / 2)), years, 'plan-mini') };
  return cache;
}

// The context a venture needs from the rest of the plan.
export function ventureCtx(st, market, inp, v) {
  const ctx = { safeReal: Math.max(0, (1 + inp.depositRate) / (1 + inp.infl) - 1), fxSd: inp.usdFx ? inp.fxSd : 0 };
  if (v && v.kind === 'shares' && v.key && market) {
    const pv = portfolioVol(market, [{ key: v.key, value: 1 }]);
    if (pv) { const d = (ASSET_CLASSES[v.cls] || ASSET_CLASSES.localEq).sd; ctx.measuredSd = Math.sqrt(0.5 * d * d + 0.5 * pv.vol * pv.vol); ctx.measured = pv.vol; }
  }
  return ctx;
}

// Every planned venture: its own 2,000 scenarios, what moves its odds, and
// its effect on your whole plan.
export function ventureReports(st, market, inp, { paths = 2000, levers = true } = {}) {
  return st.ventures.map((v) => {
    const ctx = ventureCtx(st, market, inp, v);
    const res = simulateVenture(v, ctx, { paths, keep: true });
    const L = levers ? ventureLevers(v, ctx, { paths: 400 }) : null;
    return { id: v.id, res, levers: L ? L.levers : [], breakEven: breakEven(v), measured: ctx.measured || null };
  });
}
const toPlan = (reports, st, inp, paths) => reports.filter((r) => (st.ventures.find((v) => v.id === r.id) || {}).include !== false).map((r) => {
  const v = st.ventures.find((x) => x.id === r.id);
  const pf = planFlows(r.res, inp.years, r.res.paths);
  return { ...pf, id: v.id, Y: inp.years + 1, paths: r.res.paths, cls: v.kind === 'shares' ? v.cls : END_CLASS[v.kind] || 'business' };
});

export function analyse(st, market, { paths = 2000, quick = 600 } = {}) {
  const T = totals(st, market);
  const inp0 = buildInputs(st, market);
  const reports = ventureReports(st, market, inp0, { paths });
  const vflows = toPlan(reports, st, inp0, paths);
  const inp = vflows.length ? { ...inp0, ventures: vflows } : inp0;
  const S = shocksFor(inp.years, paths, quick);
  const main = simulate(inp, S.main);
  const q = (patch) => simulate({ ...inp, ...patch }, S.quick, { keepPaths: false });
  const base = q({});
  // Stress tests and sensitivities compare against their own baseline on a smaller set of futures.
  const qm = (patch) => simulate({ ...inp, ...patch }, S.mini, { keepPaths: false });
  const baseMini = qm({});
  const target = st.plan.success;
  const age = ageOf(st);
  const f = (n) => fmt(n, st.currency);

  // What would it take?
  const safe = safeSpending(inp, S.quick, target);
  const earliest = earliestRetirement(inp, S.quick, target);
  const extra = base.success >= target ? 0 : extraSavingNeeded(inp, S.quick, target);

  const out = {
    asOf: new Date().toISOString(),
    age,
    totals: T,
    success: main.success,
    target,
    bands: main.bands,
    freeAge: main.freeAge,
    freeByRetire: main.freeBy(st.plan.retireAge),
    liquidAtRetire: main.liquidAtRetire,
    failAge: main.failAge,
    goals: main.goals,
    safeMonthly: safe == null ? 0 : safe / 12,
    earliestRetire: earliest,
    extraMonthly: extra == null ? null : extra / 12,
    risk: measuredRisk(st, market),
    mix: mixOf(st),
    middle: simulate(inp, zeroShocks(inp.years), { keepPaths: false, trace: true }).rows,
    infl: inp.infl,
    portfolio: portfolioStats(st, market, inp),
    stress: stressTests(inp, qm, baseMini),
    sensitivity: sensitivity(st, inp, qm, baseMini),
    steps: [],
    ventures: reports.map((r) => {
      const { yearly, terminals, cum, ...rest } = r.res;
      // The whole plan without this one venture, on the same futures.
      const others = vflows.filter((x) => x.id !== r.id);
      const w = simulate({ ...inp0, ventures: others.length ? others : undefined }, S.quick, { keepPaths: false });
      return { id: r.id, ...rest, cum, levers: r.levers, breakEven: r.breakEven, measured: r.measured, planWithout: w.success, planWith: base.success, retireWithout: w.liquidAtRetire.p50, retireWith: base.liquidAtRetire.p50, freeWithout: w.freeAge.p50, freeWith: base.freeAge.p50 };
    }),
  };

  // ------------------------------------------------------------ next steps, most important first
  const steps = out.steps;
  const spendM = T.monthlySpend + T.debtPay;
  const C = CURRENCIES[st.currency];
  const A = st.assumptions;

  if (T.allIn > 0 && T.surplus < 0) {
    const months = T.quick > 0 ? Math.floor(T.quick / -T.surplus) : 0;
    steps.push({ id: 'overspend', level: 'urgent', title: `You spend ${f(-T.surplus)} a month more than comes in`, body: months > 0 ? `At this rate your cash and savings last about ${months} months. Find the gap in your spending list, or add income.` : 'Your savings cannot cover the gap. Cut spending or add income first; everything else waits.', go: 'money' });
  }

  if (spendM > 0 && T.quick < spendM) {
    steps.push({ id: 'buffer', level: 'urgent', title: `Build a one-month buffer: ${f(spendM - T.quick)} to go`, body: 'One month of spending in cash or savings stops a surprise bill becoming new debt.', go: 'money' });
  }

  const hot = st.debts.filter((d) => d.balance > 0 && (d.rate || 0) > Math.max(A.deposit + 0.02, A.infl + 0.04));
  if (hot.length) {
    const ex = Math.max(0, T.surplus * 0.5);
    const c = compare(st.debts.filter((d) => d.balance > 0), ex);
    const worst = hot.sort((a, b) => b.rate - a.rate)[0];
    const parts = [];
    if (c.saved > 0) parts.push(`saves about ${f(c.saved)} in interest`);
    if (c.sooner > 0) parts.push(`clears your debts ${c.sooner} months sooner`);
    steps.push({ id: 'debt', level: 'important', title: `Pay down ${worst.name || 'your costliest debt'} first (${pct(worst.rate, 0)} interest)`, body: `It costs more than your savings can safely earn (${pct(A.deposit, 0)}). Putting half your spare money, ${f(ex)} a month, on the highest rate ${parts.join(' and ') || 'cuts what you pay'}.`, go: 'debts' });
  } else if (st.debts.some((d) => d.balance > 0 && d.payment > 0 && d.balance * d.rate / 12 >= d.payment)) {
    steps.push({ id: 'debtstuck', level: 'urgent', title: 'A debt payment does not cover its interest', body: 'That debt will never shrink at this payment. Raise the payment or talk to the lender.', go: 'debts' });
  }

  const selfEmployed = ['self', 'business'].includes(st.person.employment) || !st.income.some((x) => x.kind !== 'other') || T.profit > T.monthlyIncome;
  const wantMonths = selfEmployed ? 6 : 3;
  if (spendM > 0 && T.emergencyMonths != null && T.emergencyMonths >= 1 && T.emergencyMonths < wantMonths) {
    const gap = wantMonths * spendM - T.quick;
    const per = Math.max(0, T.surplus * 0.5);
    steps.push({ id: 'emergency', level: 'important', title: `Grow your emergency fund to ${wantMonths} months (${f(gap)} more)`, body: `You have about ${T.emergencyMonths.toFixed(1)} months of spending put by.${per > 0 ? ` Setting aside ${f(per)} a month gets you there in ${Math.ceil(gap / per)} months.` : ''} Keep it in a savings account or T-bills, not shares.`, go: 'money' });
  }

  const idle = T.byClass.cash - 1.5 * spendM;
  if (spendM > 0 && idle > 0.5 * spendM) {
    steps.push({ id: 'idle', level: 'good', title: `Move about ${f(idle)} out of your current account`, body: `Cash earns nothing while prices rise ${pct(A.infl, 0)} a year, so it loses about ${f(idle * A.infl / (1 + A.infl))} of buying power a year. A savings account or T-bills at ${pct(A.deposit, 0)} would earn about ${f(idle * A.deposit)} a year instead.`, go: 'money' });
  }

  const inv = T.investable;
  if (inv > 0) {
    let big = null;
    for (const a of st.accounts.filter((x) => x.type === 'stock')) {
      const v = valueOf(a, st, market).v;
      if (v / inv > 0.25 && (!big || v > big.v)) big = { a, v };
    }
    if (big) steps.push({ id: 'concentration', level: 'important', title: `${big.a.sym || big.a.name} is ${pct(big.v / inv, 0)} of your investments`, body: 'One company can fall a long way on its own news. Most planners keep any single share under 10–20%; new savings into a broad fund spread the risk without selling.', go: 'money' });
  }

  const yearsLeft = st.plan.retireAge - age;
  if (C.usdFx && inp.usdFx && yearsLeft >= 5 && inv > 0) {
    const usdShare = (T.byClass.globalEq + T.byClass.usdCash) / inv;
    if (usdShare < 0.2) {
      const slide = market && market.fxDrift != null && st.currency === 'NGN' ? ` The naira moved ${pct(Math.abs(market.fxDrift), 0)} a year against the dollar over the last two years of data.` : '';
      steps.push({ id: 'currency', level: 'important', title: `Only ${pct(usdShare, 0)} of your investments are in dollars`, body: `Long-term money held only in your own currency rises and falls with it.${slide} Holding a share in dollar funds or dollar savings protects what it can buy.`, go: 'plan' });
    }
  }

  if (out.success < target) {
    const levers = [];
    if (out.extraMonthly != null && out.extraMonthly > 0) levers.push(`save ${f(out.extraMonthly)} more a month`);
    if (earliest && earliest > st.plan.retireAge) levers.push(`stop work at ${earliest} instead of ${st.plan.retireAge}`);
    if (out.safeMonthly > 0) levers.push(`plan to spend ${f(out.safeMonthly)} a month in retirement`);
    steps.push({ id: 'gap', level: 'important', title: `Your plan works in ${pct(out.success, 0)} of futures; you want ${pct(target, 0)}`, body: levers.length ? `Any one of these closes the gap: ${levers.join('; or ')}.` : 'Add income or cut spending, then look again.', go: 'plan' });
  } else if (earliest && earliest < st.plan.retireAge) {
    steps.push({ id: 'early', level: 'good', title: `On track. You could stop work as early as ${earliest}`, body: `Your plan works in ${pct(out.success, 0)} of futures at ${st.plan.retireAge}. Keep checking in monthly to stay on course.`, go: 'plan' });
  }

  if (T.allIn > 0 && T.surplus > 0 && T.savingsRate < 0.15) {
    const toTwenty = 0.2 * T.allIn - T.surplus;
    const better = q({ spendCut: toTwenty * 12 });
    const yrs = Number.isFinite(base.freeAge.p50) && Number.isFinite(better.freeAge.p50) ? base.freeAge.p50 - better.freeAge.p50 : null;
    steps.push({ id: 'rate', level: 'good', title: `You save ${Math.floor(T.savingsRate * 100)}% of what comes in`, body: `Saving 20% (${f(toTwenty)} more a month) ${yrs > 0 ? `makes you financially free about ${yrs.toFixed(0)} years sooner` : `lifts your chance of success to ${pct(better.success, 0)}`}.`, go: 'money' });
  }

  for (const g of st.goals) {
    const r = out.goals.find((x) => x.id === g.id);
    if (!r || r.prob >= 0.7) continue;
    const months = Math.max(1, (g.age - age) * 12);
    const m = savingFor(g.amount, 0, Math.max(0, A.deposit - A.infl), months);
    steps.push({ id: `goal-${g.id}`, level: 'important', title: `${g.name}: ${pct(r.prob, 0)} likely as planned`, body: `Setting aside about ${f(m)} a month for it from now, in safe savings, would cover it by ${g.age}.`, go: 'plan' });
  }

  const losing = out.portfolio.accounts.filter((a) => a.real < -0.005 && a.value > 0.25 * spendM);
  if (losing.length) {
    const a = losing.sort((x, y) => x.real * x.value - y.real * y.value)[0];
    steps.push({ id: 'realrate', level: 'good', title: `${a.name}: earning less than inflation`, body: `It pays ${pct(a.rate, 1)} while prices rise ${pct(A.infl, 1)}, so it loses about ${pct(-a.real, 1)} of buying power a year (${f(-a.real * a.value)}). Compare T-bill, money market and fixed-deposit rates, or move long-term money to assets that beat inflation.`, go: 'money' });
  }
  if (st.household.kids.length) {
    const fees = schoolTotal(st, inp.years);
    if (fees > 0) steps.push({ id: 'school', level: 'good', title: `School fees ahead: about ${f(fees)} in today's money`, body: `That is the total for ${st.household.kids.length === 1 ? 'your child' : `your ${st.household.kids.length} children`} through university, with fees rising ${pct(st.household.eduPrem, 0)} a year faster than prices. It is already in your plan; check the fees under Money → Household.`, go: 'money' });
  }
  const deps = (st.person.dependants || 0) + st.household.kids.length;
  if (deps > 0 && st.person.lifeCover !== 'yes' && T.monthlyIncome > 0) {
    steps.push({ id: 'cover', level: 'important', title: `Protect ${deps === 1 ? 'the person' : `the ${deps} people`} who depend on you`, body: `If your income stopped for good, your family would need about ${f(10 * 12 * T.monthlySpend)} to keep going for ten years. Term life insurance and health cover are usually the cheapest way to protect them.`, go: 'home' });
  }
  for (const r of out.ventures) {
    const v = st.ventures.find((x) => x.id === r.id);
    if (!v || v.include === false) continue;
    const have = T.quick + T.investable;
    if (r.peak.p50 > have) steps.push({ id: `fund-${v.id}`, level: 'urgent', title: `${v.name || 'Your venture'} needs more money than you have`, body: `It typically needs ${f(r.peak.p50)} (up to ${f(r.peak.p90)}), but your cash, savings and investments come to ${f(have)}. Plan where the rest comes from (a loan, a partner, a smaller start) before you begin.`, go: 'plan' });
    else if (r.planWith < r.planWithout - 0.05) steps.push({ id: `venture-${v.id}`, level: 'important', title: `${v.name || 'Your venture'} lowers your plan's odds`, body: `With it your plan works in ${pct(r.planWith)} of futures; without it, ${pct(r.planWithout)}. Look at what would improve it before committing the money.`, go: 'plan' });
  }
  const order = { urgent: 0, important: 1, good: 2 };
  steps.sort((a, b) => order[a.level] - order[b.level]);
  if (!steps.length) steps.push({ id: 'fine', level: 'good', title: 'You are on track', body: 'Nothing urgent. Check in once a month with your real balances so the plan keeps learning.', go: 'track' });
  return out;
}

// What changes if you do X? Same random futures, so the difference is real.
export function whatIf(st, market, patch, { quick = 600 } = {}) {
  const inp = buildInputs(st, market);
  const S = shocksFor(inp.years, 2000, quick);
  const a = simulate(inp, S.quick, { keepPaths: false });
  const b = simulate({ ...inp, ...patch }, S.quick, { keepPaths: false });
  return { before: { success: a.success, free: a.freeAge.p50 }, after: { success: b.success, free: b.freeAge.p50 } };
}

export { classOf };

// ------------------------------------------------------------------ portfolio

// Expected real return and yearly swing of everything you own, from the same
// factor model the projection uses, plus the real return of each savings account.
const FACTORS = {
  bonds: [0.1, 0.35, 0], localEq: [0.35, 0.55, 0], globalEq: [0.95, 0, 0], usdCash: [0, 0, 0], usdBonds: [0.3, 0, 0], gold: [-0.15, 0, 0],
  crypto: [0.5, 0, 0], pension: [0.5, 0.4, 0], property: [0.2, 0.5, 0], land: [0.1, 0.5, 0], business: [0.3, 0.5, 0], reit: [0.3, 0.5, 0], deposit: [0, 0.2, 0], car: [0, 0, 0], cash: [0, 0, 0],
};
export function portfolioStats(st, market, inp) {
  const T = totals(st, market);
  const infl = inp.infl;
  const total = CLASS_ORDER.filter((c) => !ASSET_CLASSES[c].consumer).reduce((s, c) => s + T.byClass[c], 0);
  const real = (c) => (c === 'cash' ? 1 / (1 + infl) - 1 : c === 'deposit' ? (1 + inp.depositRate) / (1 + infl) - 1 : inp.cls[c].mu);
  let mu = 0; const f = [0, 0, 0]; let idio = 0; let usd = 0; let liquid = 0;
  const rows = [];
  for (const c of CLASS_ORDER) {
    const v = T.byClass[c];
    if (!v || ASSET_CLASSES[c].consumer) continue;
    const w = v / total;
    const sd = c === 'deposit' ? inp.cls[c].sd * 0.3 : c === 'cash' ? 0 : inp.cls[c].sd;
    const L = FACTORS[c] || [0, 0, 0];
    const own = Math.sqrt(Math.max(0, 1 - L[0] ** 2 - L[1] ** 2));
    f[0] += w * sd * L[0]; f[1] += w * sd * L[1];
    idio += (w * sd * own) ** 2;
    if (ASSET_CLASSES[c].usd && inp.usdFx) { f[1] += -0.5 * w * inp.fxSd; f[2] += 0.87 * w * inp.fxSd; usd += w; }
    if (ASSET_CLASSES[c].liquid) liquid += w;
    mu += w * real(c);
    rows.push({ cls: c, name: ASSET_CLASSES[c].short, value: v, weight: w, real: real(c), sd });
  }
  const vol = Math.sqrt(f[0] ** 2 + f[1] ** 2 + f[2] ** 2 + idio);
  const accounts = st.accounts.filter((a) => classOf(a) === 'deposit' || classOf(a) === 'cash').map((a) => {
    const rate = classOf(a) === 'cash' ? 0 : (a.rate ?? st.assumptions.deposit);
    return { id: a.id, name: a.name || ACCOUNT_TYPES[a.type].name, rate, real: (1 + rate) / (1 + infl) - 1, value: valueOf(a, st, market).v };
  });
  const level = vol < 0.05 ? 'Low' : vol < 0.1 ? 'Moderate' : vol < 0.18 ? 'Medium-high' : 'High';
  return { total, mu, vol, level, usdShare: usd, liquidShare: liquid, rows: rows.sort((a, b) => b.value - a.value), accounts, badYear: Math.exp(Math.log(1 + mu) - vol * vol / 2 - 1.645 * vol) - 1 };
}

// ------------------------------------------------------------------ stress tests

function scaleStart(inp, k) {
  const start = { ...inp.start };
  for (const [c, x] of Object.entries(k)) start[c] = (start[c] || 0) * x;
  return start;
}
export function stressTests(inp, q, base) {
  const tests = [];
  const add = (id, name, what, patch) => {
    const r = q(patch);
    tests.push({ id, name, what, success: r.success, delta: r.success - base.success, free: r.freeAge.p50 });
  };
  if (inp.usdFx) {
    add('deval', 'Your currency halves against the dollar', 'Prices jump 25%, dollar assets double in your currency, pay lags behind.', {
      start: scaleStart(inp, { cash: 0.8, deposit: 0.8, bonds: 0.8, localEq: 0.8, reit: 0.8, pension: 0.85, globalEq: 1.6, usdCash: 1.6, usdBonds: 1.6, gold: 1.6, crypto: 1.6 }),
      debts: inp.debts.map((d) => ({ ...d, bal: d.bal * 0.8 })), salary: inp.salary * 0.85,
    });
  }
  add('crash', 'A market crash like 2008', 'Shares fall 40%, crypto 70%, property 15%, then markets carry on.', {
    start: scaleStart(inp, { localEq: 0.6, globalEq: 0.6, reit: 0.65, crypto: 0.3, property: 0.85, land: 0.9, business: 0.8, pension: 0.82, usdBonds: 0.95, gold: 1.1 }),
  });
  const ex = Float64Array.from(inp.extraPath || new Float64Array(inp.years + 1));
  ex[0] += inp.salary;
  add('job', 'You lose your income for a year', 'No pay for twelve months; spending carries on.', { extraPath: ex });
  add('infl', 'Inflation stays 10 points higher', 'Prices rise much faster for good; pay and savings rates only partly keep up.', { infl: inp.infl + 0.1, depositRate: inp.depositRate + 0.07, salary: inp.salary * 0.9, growth: inp.growth - 0.01 });
  const ex2 = Float64Array.from(inp.extraPath || new Float64Array(inp.years + 1));
  ex2[1] += inp.spendNow * 0.5;
  add('emergency', 'A family emergency next year', 'A one-off cost of six months of spending.', { extraPath: ex2 });
  return tests;
}

// ------------------------------------------------------------------ what matters most

export function sensitivity(st, inp, q, base) {
  const T = Math.max(0, inp.salary + inp.otherIncome + inp.rent + inp.bizProfit - inp.spendNow);
  const risky = (d) => Object.fromEntries(Object.entries(inp.cls).map(([c, a]) => [c, ['cash', 'deposit', 'usdCash', 'car'].includes(c) ? a : { ...a, mu: a.mu + d }]));
  const list = [
    ['Save 20% more each month', { spendCut: 0.2 * T }],
    ['Save 20% less each month', { spendCut: -0.2 * T }],
    ['Stop work 3 years later', { retireAge: inp.retireAge + 3 }],
    ['Stop work 3 years sooner', { retireAge: inp.retireAge - 3 }],
    ['Spend 20% less once you stop', { spendRetire: inp.spendRetire * 0.8 }],
    ['Returns 1.5% a year lower', { cls: risky(-0.015) }],
    ['Inflation 5 points higher', { infl: inp.infl + 0.05, depositRate: inp.depositRate + 0.035, salary: inp.salary * 0.95, growth: inp.growth - 0.005 }],
  ];
  return list.map(([label, patch]) => { const r = q(patch); return { label, success: r.success, delta: r.success - base.success }; })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

// School fees still to pay for all children, in today's money, with fees rising faster than prices.
export function schoolTotal(st, years) {
  const y0 = new Date().getFullYear();
  let sum = 0;
  for (let t = 0; t <= years; t++) for (const k of st.household.kids) sum += feeAt(st, kidAge(k, y0 + t)) * Math.pow(1 + (st.household.eduPrem || 0), t);
  return sum;
}
