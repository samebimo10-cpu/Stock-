// One full analysis of your plan: the projection, the answers to "what would it
// take?", and your next steps ranked by how much they matter. Pure and plain
// data in and out, so it can run in a background worker and in tests.

import { simulate, makeShocks, safeSpending, extraSavingNeeded, earliestRetirement } from './sim.js';
import { totals, buildInputs, measuredRisk, ageOf, classOf, valueOf, mixOf } from './model.js';
import { compare } from './debt.js';
import { fmt, pct, CURRENCIES, savingFor } from './money.js';

let cache = { key: null, main: null, quick: null };
function shocksFor(years, paths, quick) {
  const key = `${years}|${paths}|${quick}`;
  if (cache.key !== key) cache = { key, main: makeShocks(paths, years, 'plan-main'), quick: makeShocks(quick, years, 'plan-quick') };
  return cache;
}

export function analyse(st, market, { paths = 2000, quick = 600 } = {}) {
  const T = totals(st, market);
  const inp = buildInputs(st, market);
  const S = shocksFor(inp.years, paths, quick);
  const main = simulate(inp, S.main);
  const q = (patch) => simulate({ ...inp, ...patch }, S.quick, { keepPaths: false });
  const base = q({});
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
    steps: [],
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

  const selfEmployed = !st.income.some((x) => x.kind !== 'other') || T.profit > T.monthlyIncome;
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
    const better = q({ spendNow: inp.spendNow - toTwenty * 12 });
    const yrs = Number.isFinite(base.freeAge.p50) && Number.isFinite(better.freeAge.p50) ? base.freeAge.p50 - better.freeAge.p50 : null;
    steps.push({ id: 'rate', level: 'good', title: `You save ${pct(T.savingsRate, 0)} of what comes in`, body: `Saving 20% (${f(toTwenty)} more a month) ${yrs > 0 ? `makes you financially free about ${yrs.toFixed(0)} years sooner` : `lifts your chance of success to ${pct(better.success, 0)}`}.`, go: 'money' });
  }

  for (const g of st.goals) {
    const r = out.goals.find((x) => x.id === g.id);
    if (!r || r.prob >= 0.7) continue;
    const months = Math.max(1, (g.age - age) * 12);
    const m = savingFor(g.amount, 0, Math.max(0, A.deposit - A.infl), months);
    steps.push({ id: `goal-${g.id}`, level: 'important', title: `${g.name}: ${pct(r.prob, 0)} likely as planned`, body: `Setting aside about ${f(m)} a month for it from now, in safe savings, would cover it by ${g.age}.`, go: 'plan' });
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
