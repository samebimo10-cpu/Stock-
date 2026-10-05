// The maths has to be right before anything else matters. These tests check the
// engine against closed-form answers wherever one exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pmt, fv, savingFor, fmt, suggestedMix, parseMoney } from '../js/money.js';
import { analyse } from '../js/analyse.js';
import { planPdf } from '../js/pdf.js';
import { simulate, makeShocks, rng, safeSpending, extraSavingNeeded, earliestRetirement, quantile } from '../js/sim.js';
import { payoff, compare } from '../js/debt.js';
import { slimPack, seriesStats, portfolioVol, searchStocks, emptyMarket } from '../js/market.js';
import { demoState, demoMarket } from './fixtures.mjs';
import { newState, totals, buildInputs, valueOf, measuredRisk, upgrade, ageOf, spendPath, extraPath, depositRateOf, monthlyOf, feeAt } from '../js/model.js';
import { schoolTotal } from '../js/analyse.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg || ''} ${a} vs ${b}`);

// A plain input with nothing random in it.
function calm(patch = {}) {
  const cls = {};
  for (const c of ['cash', 'deposit', 'bonds', 'localEq', 'globalEq', 'usdCash', 'crypto', 'pension', 'property', 'business']) cls[c] = { mu: 0, sd: 0 };
  return {
    age: 30, years: 30, retireAge: 60, planAge: 60, pensionAge: 60,
    salary: 0, otherIncome: 0, growth: 0, spendNow: 0, spendRetire: 0, pensionIncome: 0, rent: 0, bizProfit: 0,
    start: { cash: 0, deposit: 0, bonds: 0, localEq: 0, globalEq: 0, usdCash: 0, crypto: 0, pension: 0, property: 0, business: 0 },
    debts: [], goals: [], mix: { deposit: 1 }, cls, infl: 0, inflSd: 0, depositRate: 0, usdFx: false, fxDrift: 0, fxSd: 0, swr: 0.04,
    ...patch,
  };
}

test('loan and savings formulas match the textbook', () => {
  close(pmt(100000, 0.12, 12), 8884.88, 1e-5, 'pmt');
  close(fv(1000, 100, 0.06, 120), 1000 * Math.pow(1.005, 120) + 100 * ((Math.pow(1.005, 120) - 1) / 0.005), 1e-9, 'fv');
  const m = savingFor(50000, 5000, 0.08, 60);
  close(fv(5000, m, 0.08, 60), 50000, 1e-9, 'savingFor inverts fv');
  assert.equal(savingFor(100, 200, 0.05, 12), 0);
  assert.equal(fmt(2400000, 'NGN'), '₦2.4M');
  assert.equal(fmt(-1500, 'USD'), '−$1,500');
  assert.equal(fmt(380000, 'NGN'), '₦380K', 'whole numbers keep their zeros');
  assert.equal(fmt(900000, 'NGN'), '₦900K');
  assert.equal(fmt(2000000, 'NGN'), '₦2M');
  assert.equal(fmt(10000, 'USD'), '$10K');
  assert.equal(fmt(12500000, 'NGN'), '₦12.5M');
  assert.equal(fmt(1050000000, 'NGN'), '₦1.05B');
});

test('with no randomness, a deposit grows exactly by compound interest', () => {
  const sh = makeShocks(5, 30);
  const inp = calm({ depositRate: 0.1, start: { ...calm().start, deposit: 1000 } });
  const r = simulate(inp, sh);
  close(r.bands[10].p50, 1000 * Math.pow(1.1, 10), 1e-9, 'year 10');
  close(r.bands[10].p10, r.bands[10].p90, 1e-12, 'no spread');
});

test('yearly savings compound like an annuity (saved, then a year of interest)', () => {
  const sh = makeShocks(3, 20);
  const inp = calm({ salary: 12000, spendNow: 2000, depositRate: 0.05, years: 20 });
  const r = simulate(inp, sh);
  let want = 0;
  for (let t = 0; t < 20; t++) want = (want + 10000) * 1.05;
  close(r.bands[20].p50, want, 1e-9);
});

test('inflation eats cash, and fixed-rate debt shrinks in real terms', () => {
  const sh = makeShocks(3, 5);
  const r = simulate(calm({ infl: 0.1, start: { ...calm().start, cash: 1100 } }), sh);
  close(r.bands[1].p50, 1000, 1e-9, 'one year of 10% inflation');
  // A debt nobody pays grows at its rate in money, but inflation shrinks it in real terms.
  const r2 = simulate(calm({ infl: 0.1, debts: [{ bal: 1000, rate: 0.05, payment: 0 }] }), sh);
  close(r2.bands[1].p50, -1000 * 1.05 / 1.1, 1e-9, 'real debt');
});

test('deposits follow their rate after inflation', () => {
  const sh = makeShocks(3, 5);
  const r = simulate(calm({ infl: 0.2, depositRate: 0.17, start: { ...calm().start, deposit: 1000 } }), sh);
  close(r.bands[1].p50, 1000 * 1.17 / 1.2, 1e-9, 'a 17% deposit loses to 20% inflation');
});

test('random returns average out to their assumed real return', () => {
  const sh = makeShocks(4000, 1, 'avg');
  const cls = { ...calm().cls, globalEq: { mu: 0.05, sd: 0.17 } };
  const r = simulate(calm({ cls, years: 1, start: { ...calm().start, globalEq: 1 } }), sh);
  // Mean of p50 is below the mean; check the mean through the bands instead.
  const m = (r.bands[1].p10 + r.bands[1].p25 + r.bands[1].p50 + r.bands[1].p75 + r.bands[1].p90) / 5;
  assert.ok(m > 1.0 && m < 1.1, `average outcome ${m}`);
  assert.ok(r.bands[1].p10 < 0.9 && r.bands[1].p90 > 1.2, 'and swing widely');
});

test('shocks have fat tails: big falls happen more often than a bell curve says', () => {
  const r = rng('tails');
  let far = 0;
  const N = 200000;
  for (let i = 0; i < N; i++) if (Math.abs(r.t()) > 3) far += 1;
  // A normal curve gives 0.27% beyond 3 sd.
  assert.ok(far / N > 0.004, `${far / N}`);
});

test('a dollar asset for a naira saver earns its dollar return on average, with currency swings', () => {
  const sh = makeShocks(6000, 1, 'fx');
  const cls = { ...calm().cls, usdCash: { mu: 0.01, sd: 0 } };
  const base = calm({ cls, years: 1, start: { ...calm().start, usdCash: 1000 } });
  const flat = simulate({ ...base, usdFx: false }, sh);
  const fx = simulate({ ...base, usdFx: true, fxSd: 0.15 }, sh);
  close(flat.bands[1].p50, 1010, 1e-9);
  assert.ok(fx.bands[1].p90 - fx.bands[1].p10 > 300, 'currency swings widen the range');
  close(fx.bands[1].p50, 1010, 0.03, 'centred on the dollar return');
});

test('percentile bands are always in order', () => {
  const st = demoState();
  const r = simulate(buildInputs(st, demoMarket()), makeShocks(500, 70));
  for (const b of r.bands) assert.ok(b.p10 <= b.p25 && b.p25 <= b.p50 && b.p50 <= b.p75 && b.p75 <= b.p90, `age ${b.age}`);
  assert.ok(r.success >= 0 && r.success <= 1);
});

test('the same random paths make comparisons fair: saving more never makes things worse', () => {
  const st = demoState();
  const sh = makeShocks(800, 70, 'cmp');
  const a = simulate(buildInputs(st, demoMarket()), sh, { keepPaths: false });
  const b = simulate(buildInputs(st, demoMarket(), { spendNow: buildInputs(st, demoMarket()).spendNow * 0.8 }), sh, { keepPaths: false });
  assert.ok(b.success >= a.success);
  assert.ok(b.freeAge.p50 <= a.freeAge.p50);
  // And the same seed gives the same answer twice.
  assert.equal(simulate(buildInputs(st, demoMarket()), sh, { keepPaths: false }).success, a.success);
});

test('solvers: safe spending, extra saving and earliest retirement move the right way', () => {
  const st = demoState();
  const sh = makeShocks(400, 70, 'solve');
  const inp = buildInputs(st, demoMarket());
  const s1 = safeSpending(inp, sh, 0.85);
  const s2 = safeSpending({ ...inp, start: { ...inp.start, deposit: inp.start.deposit * 3 } }, sh, 0.85);
  assert.ok(s1 != null && s2 > s1, `${s1} -> ${s2}`);
  const x = extraSavingNeeded({ ...inp, spendRetire: s1 * 1.3 }, sh, 0.85);
  assert.ok(x == null || x > 0);
  const e = earliestRetirement(inp, sh, 0.85);
  assert.ok(e == null || (e > inp.age && e < inp.planAge));
});

test('debts: one loan pays off in the textbook number of months, avalanche never costs more', () => {
  const P = 500000; const r = 0.24; const pay = 25000;
  const n = Math.ceil(-Math.log(1 - (r / 12) * P / pay) / Math.log(1 + r / 12));
  assert.equal(payoff([{ id: 'a', balance: P, rate: r, payment: pay }]).months, n);
  const ds = [{ id: 'card', balance: 200000, rate: 0.36, payment: 10000 }, { id: 'car', balance: 1500000, rate: 0.2, payment: 60000 }, { id: 'phone', balance: 50000, rate: 0.1, payment: 5000 }];
  const c = compare(ds, 20000);
  assert.ok(c.avalanche.interest <= c.snowball.interest + 1e-6);
  assert.ok(c.saved > 0 && c.sooner > 0, 'extra payments save interest and time');
  assert.ok(payoff([{ id: 'x', balance: 1000, rate: 0.5, payment: 10 }]).stuck, 'a payment below the interest never ends');
});

test('market: volatility from a price series, and diversification lowers it', () => {
  const r = rng('mkt');
  const mk = () => { const xs = [100]; for (let i = 0; i < 500; i++) xs.push(xs[i] * Math.exp(0.01 * r.normal())); return xs; };
  const a = mk(); const b = mk();
  close(seriesStats(a).vol, 0.01 * Math.sqrt(252), 0.12, 'annual vol');
  const m = { ...emptyMarket(), closes: { 'X:A': a, 'X:B': b } };
  const one = portfolioVol(m, [{ key: 'X:A', value: 1 }]).vol;
  const two = portfolioVol(m, [{ key: 'X:A', value: 1 }, { key: 'X:B', value: 1 }]).vol;
  assert.ok(two < one * 0.85, `${two} vs ${one}`);
});

test('the real market data pack parses into prices and a dollar rate', { skip: !existsSync(new URL('../../web/data-pack.json', import.meta.url)) }, () => {
  const pack = JSON.parse(readFileSync(new URL('../../web/data-pack.json', import.meta.url), 'utf8'));
  const m = slimPack(pack);
  assert.ok(Object.keys(m.prices).length > 100);
  assert.ok(m.fx > 100, `USD/NGN ${m.fx}`);
  assert.ok(m.fxVol > 0 && m.fxVol < 1);
  assert.ok(searchStocks(m, 'DANGCEM').some((x) => x.sym === 'DANGCEM'));
});

test('your picture: shares at live prices, dollars at the live rate, surplus and buffer', () => {
  const st = demoState();
  const m = demoMarket();
  const stock = st.accounts.find((a) => a.type === 'stock');
  assert.equal(valueOf(stock, st, m).v, 100 * 50);
  const usd = st.accounts.find((a) => a.type === 'usd');
  assert.equal(valueOf(usd, st, m).v, 1000 * 1500);
  const T = totals(st, m);
  assert.equal(T.monthlyIncome, 500000);
  assert.equal(T.surplus, 500000 - 300000 - 40000);
  close(T.emergencyMonths, (200000 + 1000000 + 1500000) / 340000, 1e-9);
  assert.equal(T.netWorth, T.assets - 800000);
});

test('measured risk: one stock is treated as riskier than the market', () => {
  const r = rng('one');
  const xs = [50]; for (let i = 0; i < 500; i++) xs.push(xs[i] * Math.exp(0.03 * r.normal()));
  const m = { ...demoMarket(), closes: { 'NGX:ONE': xs } };
  const st = demoState();
  st.accounts.find((a) => a.type === 'stock').key = 'NGX:ONE';
  m.prices['NGX:ONE'] = { p: 50, c: 'NGN', n: 'One' };
  const risk = measuredRisk(st, m);
  assert.ok(risk.localEq.sd > 0.26, `${risk.localEq.sd}`);
});

test('a saved plan from an older version still loads', () => {
  const st = upgrade({ currency: 'USD', accounts: [{ id: 'a', type: 'current', value: 5 }] });
  assert.equal(st.plan.planAge, 95);
  assert.equal(st.assumptions.infl, 0.025);
  assert.ok(Array.isArray(st.goals));
  assert.equal(ageOf({ born: '1990-06' }, new Date('2026-10-04')), 36);
});

test('suggested mix holds more shares when the goal is further away, and dollars in a weak currency', () => {
  const far = suggestedMix(25, true); const near = suggestedMix(2, true);
  assert.ok(far.localEq + far.globalEq > near.localEq + near.globalEq);
  assert.ok(far.globalEq > 0 && far.usdCash >= 0);
  close(Object.values(far).reduce((a, b) => a + b, 0), 1, 0.02);
});

test('money boxes understand how people type amounts', () => {
  assert.equal(parseMoney('2.5m'), 2500000);
  assert.equal(parseMoney('250k'), 250000);
  assert.equal(parseMoney('1,200,000'), 1200000);
  assert.equal(parseMoney('₦300,000'), 300000);
  assert.equal(parseMoney(''), 0);
  assert.equal(parseMoney('abc'), 0);
});

test('the analysis ranks next steps and answers "what would it take"', () => {
  const st = demoState();
  st.accounts[0].value = 2000000;
  const A = analyse(st, demoMarket(), { paths: 400, quick: 200 });
  assert.ok(A.success > 0 && A.success < 1);
  assert.ok(A.bands.length === st.plan.planAge - A.age + 1);
  const ids = A.steps.map((s) => s.id);
  assert.ok(ids.includes('debt'), 'a 25% car loan beats 17% savings, so pay it first');
  assert.ok(ids.includes('idle'), 'cash sitting in a current account is flagged');
  const lv = { urgent: 0, important: 1, good: 2 };
  for (let i = 1; i < A.steps.length; i++) assert.ok(lv[A.steps[i - 1].level] <= lv[A.steps[i].level], 'most important first');
  if (A.success < A.target) assert.ok(ids.includes('gap'));
});

test('overspending is the first thing it tells you', () => {
  const st = demoState();
  st.spending[0].amount = 600000;
  const A = analyse(st, demoMarket(), { paths: 200, quick: 100 });
  assert.equal(A.steps[0].id, 'overspend');
});

test('the plan PDF is a valid document', () => {
  const st = demoState();
  const A = analyse(st, demoMarket(), { paths: 200, quick: 100 });
  const bytes = planPdf(st, demoMarket(), A);
  const s = String.fromCharCode(...bytes.slice(0, 8));
  assert.ok(s.startsWith('%PDF-1.4'));
  const tail = String.fromCharCode(...bytes.slice(-6));
  assert.ok(tail.includes('%%EOF'));
  assert.ok(bytes.length > 3000);
});

test('household: yearly rent, category inflation, giving and school fees by stage', () => {
  const st = demoState();
  st.spending = [{ id: 'r', cat: 'rent', name: 'Rent', amount: 2400000, freq: 'year' }, { id: 'f', cat: 'food', name: 'Food', amount: 150000, freq: 'month' }];
  assert.equal(monthlyOf(st.spending[0]), 200000);
  const p = spendPath(st, 10, () => 0);
  close(p[0], 2400000 + 1800000, 1e-12);
  close(p[10], 2400000 * 1.01 ** 10 + 1800000 * 1.02 ** 10, 1e-9, 'rent +1%, food +2% a year above inflation');
  st.household.givingPct = 0.1;
  close(spendPath(st, 1, () => 6000000)[0], 4200000 + 600000, 1e-12, 'giving follows pay');
  const y = new Date().getFullYear();
  st.household.kids = [{ id: 'k', name: 'Ada', born: y - 5 }];
  st.household.eduPrem = 0;
  assert.equal(feeAt(st, 5), st.household.fees.nursery);
  assert.equal(feeAt(st, 6), st.household.fees.primary);
  assert.equal(feeAt(st, 22), 0);
  const e = extraPath(st, 20);
  assert.equal(e[0], st.household.fees.nursery, 'age 5 now: nursery');
  assert.equal(e[1], st.household.fees.primary, 'age 6 next year: primary');
  assert.equal(e[17], 0, 'finished university at 22');
  const total = 1 * st.household.fees.nursery + 6 * st.household.fees.primary + 6 * st.household.fees.secondary + 4 * st.household.fees.university;
  close(schoolTotal(st, 30), total, 1e-12, 'school total through university');
  assert.equal(totals(st, demoMarket()).school, st.household.fees.nursery / 12);
});

test('household: the car is replaced on schedule, and savings earn their own rates', () => {
  const st = demoState();
  st.household.car = { every: 5, cost: 1000000 };
  const e = extraPath(st, 12);
  assert.equal(e[5], 1000000); assert.equal(e[10], 1000000); assert.equal(e[4], 0); assert.equal(e[0], 0);
  st.accounts = [{ id: 'a', type: 'tbill', value: 3000000, rate: 0.2 }, { id: 'b', type: 'coop', value: 1000000, rate: 0 }];
  close(depositRateOf(st, demoMarket()), 0.15, 1e-12, 'value-weighted rate');
});

test('version 1 plans gain categories and a household', () => {
  const st = upgrade({ v: 1, currency: 'NGN', spending: [{ id: 's', name: 'Food and groceries', amount: 100 }] });
  assert.equal(st.spending[0].cat, 'food');
  assert.equal(st.spending[0].freq, 'month');
  assert.ok(Array.isArray(st.household.kids) && st.household.fees.university > 0);
});

test('every kind of asset is valued and modelled, including land, gold, Eurobonds and the car', () => {
  const st = demoState();
  st.accounts.push({ id: 'l', type: 'land', value: 5000000 }, { id: 'g', type: 'gold', value: 400000 }, { id: 'e', type: 'eurobond', value: 2000 }, { id: 'c', type: 'car', value: 3000000 }, { id: 'r', type: 'reit', value: 100000 }, { id: 'f', type: 'farm', value: 800000, profit: 50000 });
  const T = totals(st, demoMarket());
  assert.equal(T.byClass.land, 5000000);
  assert.equal(T.byClass.usdBonds, 2000 * 1500);
  assert.equal(T.byClass.car, 3000000);
  assert.equal(T.byClass.business, 800000);
  assert.equal(T.profit, 50000);
  const sh = makeShocks(200, 70, 'all');
  const r = simulate(buildInputs(st, demoMarket()), sh, { trace: true });
  assert.ok(r.rows.length > 10 && r.rows[0].classes.land > 0);
  assert.ok(r.rows[5].classes.car < 3000000 * 0.7, 'cars lose value');
});

test('insights: portfolio, middle path, stress tests and sensitivities', () => {
  const st = demoState();
  st.income[0].amount = 1300000;
  const A = analyse(st, demoMarket(), { paths: 300, quick: 200 });
  assert.ok(A.portfolio.vol > 0 && A.portfolio.vol < 0.5);
  assert.ok(A.portfolio.accounts.some((a) => a.real < 0), 'a current account loses to inflation');
  assert.equal(A.middle[0].age, A.age + 1);
  assert.ok(A.stress.some((x) => x.id === 'deval') && A.stress.some((x) => x.id === 'crash'));
  const job = A.stress.find((x) => x.id === 'job');
  assert.ok(job.delta <= 0.001, 'losing a year of income never helps');
  const more = A.sensitivity.find((x) => x.label.startsWith('Save 20% more'));
  const less = A.sensitivity.find((x) => x.label.startsWith('Save 20% less'));
  assert.ok(more.delta >= less.delta);
});

export { demoState, demoMarket } from './fixtures.mjs';
