// Several currencies, places with their own risk, and job loss.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import * as W from '../js/world.js';
import { simulate, makeShocks, zeroShocks, needK } from '../js/sim.js';
import { analyse } from '../js/analyse.js';
import { demoState, demoMarket } from './fixtures.mjs';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg || ''} ${a} vs ${b}`);
const mkt = () => ({ ...demoMarket(), fx: 1500 });

test('money in any currency is converted at today\'s rate', () => {
  const st = demoState();
  st.income.push({ id: 'u', name: 'Consulting', amount: 1000, cur: 'USD', kind: 'work' });
  st.spending.push({ id: 'g', cat: 'other', name: 'UK fees', amount: 100, cur: 'GBP', freq: 'month' });
  st.debts.push({ id: 'd', name: 'Dollar loan', balance: 2000, rate: 0.08, payment: 100, cur: 'USD' });
  st.assumptions.rates = { GBP: 0.75 };
  const T = M.totals(st, mkt());
  assert.equal(T.monthlyIncome, 500000 + 1000 * 1500);
  close(T.monthlyLiving, 300000 + (100 / 0.75) * 1500, 1e-12);
  assert.equal(T.debt, 800000 + 2000 * 1500);
  assert.equal(W.convert(st, mkt(), 3, 'GBP', 'USD'), 4);
});

test('land in Manhattan and in Port Harcourt carry different growth and risk', () => {
  const st = demoState();
  st.accounts = [{ id: 'a', type: 'land', value: 1e7, loc: 'NG-PHC' }, { id: 'b', type: 'land', value: 1e7, loc: 'US-NYC', cur: 'USD' }];
  const inp = M.buildInputs(st, mkt());
  const phc = inp.positions.find((p) => p.cls === 'land' && p.loc === 'NG-PHC');
  const nyc = inp.positions.find((p) => p.cls === 'land' && p.loc === 'US-NYC');
  assert.ok(phc && nyc);
  assert.equal(phc.country, 'NG'); assert.equal(nyc.country, 'US');
  assert.equal(nyc.cur, 'USD');
  assert.ok(phc.sd > nyc.sd, 'Port Harcourt land swings more');
  assert.ok(W.place(st, 'NG-PHC').title > W.place(st, 'US-NYC').title * 10, 'and title disputes are far likelier');
  st.assumptions.places = { 'NG-PHC': { land: { mu: 0.05 } } };
  assert.equal(M.buildInputs(st, mkt()).positions.find((p) => p.loc === 'NG-PHC').mu, 0.05, 'your own estimate wins');
});

test('school fees in pounds grow in naira when the naira keeps weakening', () => {
  const st = demoState();
  st.spending = [{ id: 'g', cat: 'other', name: 'UK fees', amount: 1000, cur: 'GBP', freq: 'month' }];
  st.assumptions.rates = { GBP: 0.75 };
  const inp = M.buildInputs(st, mkt());
  const steady = simulate(inp, zeroShocks(inp.years), { keepPaths: false, trace: true }).rows;
  const weak = { ...inp, currencies: { ...inp.currencies, NGN: { ...inp.currencies.NGN, drift: -0.05 } } };
  const rows = simulate(weak, zeroShocks(inp.years), { keepPaths: false, trace: true }).rows;
  close(steady[9].living, steady[0].living, 1e-9, 'no drift: the same in real naira');
  close(rows[9].living / rows[0].living, Math.exp(0.05 * 9), 1e-6, 'a 5% a year slide raises the naira cost of pound fees');
});

test('savings held abroad earn that currency\'s rate after that country\'s inflation', () => {
  const st = demoState();
  st.accounts = [{ id: 'u', type: 'usd', name: 'Dom account', value: 1000, rate: 0.05 }];
  st.assumptions.fxSd = 0;
  const inp = M.buildInputs(st, mkt());
  const p = inp.positions.find((x) => x.cur === 'USD' && x.cls === 'usdCash');
  assert.ok(p);
  // usdCash keeps its own class return; a foreign deposit uses the fixed real rate.
  st.accounts = [{ id: 'g', type: 'savings', name: 'UK savings', value: 1000, cur: 'GBP', rate: 0.045 }];
  st.assumptions.rates = { GBP: 0.75 };
  const inp2 = M.buildInputs(st, mkt());
  const g = inp2.positions.find((x) => x.cur === 'GBP');
  close(g.realFixed, 1.045 / 1.025 - 1, 1e-4);
});

test('job loss: a riskier job is lost more often and costs the plan', () => {
  const st = demoState();
  st.income = [{ id: 'i', name: 'Salary', amount: 900000, kind: 'work', employer: 'public' }];
  const safe = M.buildInputs(st, mkt());
  st.income[0].employer = 'contract';
  const risky = M.buildInputs(st, mkt());
  assert.ok(risky.incomes[0].pLoss > safe.incomes[0].pLoss * 5);
  const K = Math.max(needK(safe), needK(risky));
  const sh = makeShocks(600, safe.years, 'job', K);
  const a = simulate(safe, sh, { keepPaths: true });
  const b = simulate(risky, sh, { keepPaths: true });
  assert.ok(b.jobLoss > a.jobLoss, `${b.jobLoss} vs ${a.jobLoss}`);
  assert.ok(b.bands[10].p50 < a.bands[10].p50, 'less money after ten years');
  assert.equal(W.country(st, 'NG').job.search, 8);
});

test('a devaluation stress hurts someone who owes and pays in dollars', () => {
  const st = demoState();
  st.income[0].amount = 2500000;
  st.debts = [{ id: 'd', name: 'Dollar loan', balance: 8000, rate: 0.08, payment: 250, cur: 'USD' }];
  st.spending.push({ id: 'f', cat: 'other', name: 'Fees abroad', amount: 300, cur: 'USD', freq: 'month' });
  const A = analyse(st, mkt(), { paths: 300, quick: 200 });
  const dv = A.stress.find((x) => x.id === 'deval');
  assert.ok(A.success > 0.2 && A.success < 0.98, `a plan that can move: ${A.success}`);
  assert.ok(dv && dv.delta < 0, `${dv && dv.delta}`);
  assert.ok(A.steps.some((s) => s.id === 'fx-USD'), 'paying in dollars without dollar savings is flagged');
  assert.ok(A.exposures.byCur.some((x) => x.cur === 'USD' && x.spend > 0 && x.debt > 0));
});

test('a business abroad uses that country\'s closure rate; land uses its place', async () => {
  const V = await import('../js/venture.js');
  const v = V.newVenture('land', 'NGN');
  assert.equal(v.cur, 'NGN');
  const { ventureCtx } = await import('../js/analyse.js');
  const st = demoState();
  const inp = M.buildInputs(st, mkt());
  const ctx = ventureCtx(st, mkt(), inp, { ...v, loc: 'US-NYC' });
  assert.equal(ctx.place.land.mu, W.LOCATIONS['US-NYC'].land.mu);
});

test('land abroad counts as money held outside your currency', () => {
  const st = demoState();
  st.accounts.push({ id: 'n', type: 'land', value: 20000, cur: 'USD', loc: 'US-NYC' });
  const A = analyse(st, mkt(), { paths: 200, quick: 100 });
  assert.ok(!A.steps.some((s) => s.id === 'currency'), 'no "only x% in dollars" step when most of the wealth is a dollar asset');
  assert.ok(A.exposures.byPlace.some((x) => x.loc === 'US-NYC'));
});
