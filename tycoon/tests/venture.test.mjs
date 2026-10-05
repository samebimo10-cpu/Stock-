// Ventures, the person profile and several people on one phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../js/venture.js';
import { simulate, makeShocks } from '../js/sim.js';
import * as M from '../js/model.js';
import { analyse } from '../js/analyse.js';
import { demoState, demoMarket } from './fixtures.mjs';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg || ''} ${a} vs ${b}`);
const neutral = { experience: 1, commitment: 'x', customers: 'some', tested: 'no', records: 'x' };

function bakery(patch = {}) {
  const v = V.newVenture('business', 'USD');
  return Object.assign(v, { name: 'Bakery', sector: 'food', capex: 80000, workingCapital: 20000, revenue: 30000, fixedCost: 7000, varCost: 0.5 }, patch);
}

test('closure rate turns five-year survival into a monthly chance, exactly', () => {
  const v = bakery({ s5: 0.5, countryRisk: 1, human: neutral });
  close(V.survival5(v), 0.5, 1e-12);
  const pro = bakery({ s5: 0.5, countryRisk: 1, human: { experience: 6, commitment: 'full', customers: 'yes', tested: 'yes', records: 'yes' } });
  const shaky = bakery({ s5: 0.5, countryRisk: 1, human: { experience: 0, commitment: 'manager', customers: 'no', tested: 'no', records: 'no' } });
  assert.ok(V.survival5(pro) > 0.7 && V.survival5(shaky) < 0.3, `${V.survival5(pro)} / ${V.survival5(shaky)}`);
  assert.ok(V.survival5(bakery({ s5: 0.5, countryRisk: 1.3, human: neutral })) < 0.5, 'a harder place to do business');
});

test('a business plays out in 2,000 scenarios, and better sales mean better odds', () => {
  const a = V.simulateVenture(bakery(), { safeReal: 0 }, { paths: 2000, keep: true });
  assert.equal(a.paths, 2000);
  for (const k of ['success', 'survive', 'profitable', 'lostHalf', 'paidBack']) assert.ok(a[k] >= 0 && a[k] <= 1, k);
  assert.ok(a.multiple.p10 <= a.multiple.p50 && a.multiple.p50 <= a.multiple.p90);
  close(a.hist.reduce((s, h) => s + h.share, 0), 1, 1e-9, 'histogram covers every scenario');
  assert.equal(a.cum.length, 61);
  const b = V.simulateVenture(bakery({ revenue: 45000 }), { safeReal: 0 }, { paths: 2000 });
  assert.ok(b.success > a.success && b.multiple.p50 > a.multiple.p50);
  const same = bakery();
  assert.equal(V.simulateVenture(same, { safeReal: 0 }, { paths: 300 }).success, V.simulateVenture(same, { safeReal: 0 }, { paths: 300 }).success, 'same answer twice');
});

test('break-even sales cover fixed costs and loan payments', () => {
  close(V.breakEven(bakery({ fixedCost: 5000, varCost: 0.6, loan: 0 })), 12500, 1e-12);
  assert.ok(V.breakEven(bakery({ fixedCost: 5000, varCost: 0.6, loan: 50000 })) > 12500);
});

test('a loan that is always repaid returns exactly its schedule', () => {
  const v = Object.assign(V.newVenture('lend', 'USD'), { amount: 10000, rate: 0.12, months: 12, defaultRisk: 0, years: 1 });
  const r = V.simulateVenture(v, { safeReal: 0 }, { paths: 50 });
  const pay = (10000 * 0.01) / (1 - Math.pow(1.01, -12));
  close(r.multiple.p50, (12 * pay) / 10000, 1e-9, 'paid back with interest (yearly rate / 12, as banks quote it)');
  assert.equal(r.success, 1);
  const risky = V.simulateVenture({ ...v, defaultRisk: 0.5, recovery: 0 }, { safeReal: 0 }, { paths: 1000 });
  assert.ok(risky.success < 0.75 && risky.success > 0.4, `${risky.success}`);
});

test('land: title disputes cut the value, holding costs add up', () => {
  const v = Object.assign(V.newVenture('land', 'NGN'), { price: 10e6, buyCosts: 0.1, titleRisk: 0, years: 10 });
  const safe = V.simulateVenture(v, { safeReal: 0 }, { paths: 1000 });
  const risky = V.simulateVenture({ ...v, titleRisk: 0.5 }, { safeReal: 0 }, { paths: 1000 });
  assert.ok(risky.multiple.p50 < safe.multiple.p50);
  close(risky.survive, 0.5, 0.1, 'about half have a dispute');
});

test('shares grow at their assumed real return on average', () => {
  const v = Object.assign(V.newVenture('shares', 'USD'), { amount: 1000, cls: 'globalEq', years: 10 });
  const r = V.simulateVenture(v, { safeReal: 0 }, { paths: 2000 });
  // The median of a lognormal sits below its mean; check the median against it.
  const want = Math.pow(Math.exp(Math.log(1.05) - 0.17 * 0.17 / 2), 10);
  close(r.multiple.p50, want, 0.12, 'median 10-year growth');
});

test('a venture shifts the plan year by year, aligned to when it starts', () => {
  const v = Object.assign(V.newVenture('lend', 'USD'), { amount: 10000, rate: 0.3, months: 36, defaultRisk: 0, years: 3, startMonth: 12 });
  const r = V.simulateVenture(v, { safeReal: 0 }, { paths: 100 });
  const pf = V.planFlows(r, 30, 100);
  assert.equal(pf.flows[0], 0, 'nothing in the first year');
  assert.ok(pf.flows[1] < 0, 'money goes in the year it starts');
  assert.ok(pf.flows[2] > 0, 'and comes back after');
  const st = demoState();
  st.income[0].amount = 900000;
  const inp = M.buildInputs(st, demoMarket());
  const sh = makeShocks(200, inp.years, 'v');
  const good = { ...V.planFlows(V.simulateVenture({ ...v, amount: 2e6 }, { safeReal: 0 }, { paths: 200 }), inp.years, 200), Y: inp.years + 1, paths: 200, cls: 'deposit' };
  const base = simulate(inp, sh, { keepPaths: true });
  const withIt = simulate({ ...inp, ventures: [good] }, sh, { keepPaths: true });
  assert.ok(withIt.bands[4].p50 > base.bands[4].p50, 'a good loan leaves you richer');
});

test('the analysis reports each venture and its effect on the plan', () => {
  const st = demoState();
  st.income[0].amount = 1000000;
  st.ventures.push(Object.assign(V.newVenture('business', 'NGN'), { name: 'Shop', sector: 'retail', capex: 3e6, workingCapital: 1e6, revenue: 1.5e6, fixedCost: 300000, varCost: 0.6 }));
  const A = analyse(st, demoMarket(), { paths: 400, quick: 200 });
  const r = A.ventures[0];
  assert.ok(r.success >= 0 && r.success <= 1 && r.levers.length > 0);
  assert.ok(Number.isFinite(r.planWith) && Number.isFinite(r.planWithout));
  assert.ok(r.breakEven > 0);
});

test('risk answers give a score, capped by how you would act in a fall', () => {
  assert.equal(M.riskScore([4, 4, 4, 4, 4]), 5);
  assert.equal(M.riskScore([0, 0, 0, 0, 0]), 1);
  assert.equal(M.riskScore([0, 4, 4, 4, 4]), 2, 'would sell in a fall: careful, whatever else');
  assert.equal(M.riskScore([2, 2, null, 2, 2]), null);
  const st = demoState();
  st.person.riskScore = 1; const careful = M.mixOf(st);
  st.person.riskScore = 5; const bold = M.mixOf(st);
  const eq = (m) => (m.localEq || 0) + (m.globalEq || 0);
  assert.ok(eq(bold) > eq(careful));
  close(Object.values(bold).reduce((a, b) => a + b, 0), 1, 1e-9);
});

test('the person shapes the advice: dependants without life cover are flagged', () => {
  const st = demoState();
  st.person.dependants = 2; st.person.lifeCover = 'no';
  const A = analyse(st, demoMarket(), { paths: 200, quick: 100 });
  assert.ok(A.steps.some((s) => s.id === 'cover'));
  st.person.lifeCover = 'yes';
  assert.ok(!analyse(st, demoMarket(), { paths: 200, quick: 100 }).steps.some((s) => s.id === 'cover'));
});

test('several people: the old single plan moves in, and each person is kept apart', () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const old = demoState(); old.name = 'Ada'; delete old.id;
  mem.set(M.KEY, JSON.stringify(old));
  const idx = M.profiles();
  assert.equal(idx.list.length, 1);
  assert.equal(mem.has(M.KEY), false, 'the old key is moved, not copied');
  const ada = M.load();
  assert.equal(ada.name, 'Ada');
  const bola = M.newState('USD'); bola.name = 'Bola';
  M.save(bola);
  assert.equal(M.profiles().list.length, 2);
  assert.equal(M.load().name, 'Bola', 'the newest saved is open');
  assert.equal(M.load(ada.id).name, 'Ada');
  const copy = M.duplicate(ada, 'Ada (copy)');
  assert.notEqual(copy.id, ada.id);
  M.remove(bola.id);
  assert.equal(M.profiles().list.length, 2);
  assert.ok(!M.profiles().list.some((p) => p.id === bola.id));
  M.saveAdviser({ on: true, name: 'Sam', firm: 'Ebims' });
  assert.equal(M.adviser().firm, 'Ebims');
  delete globalThis.localStorage;
});
