// Rules tests for Tycoon Rush. Run with: node --test "tycoon/tests/**/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import { ERAS, CHALLENGES, CARDS, EVENTS } from '../js/content.js';

function play(opts, bot = () => {}) {
  const run = E.newRun(opts);
  let res = null;
  let guard = 0;
  while (!res && guard++ < 60) {
    if (run.quiz) E.answerQuiz(run, 0);
    if (E.canAct(run)) bot(run);
    if (run.learnMode) E.setForecast(run, E.upOdds(run).ideal);
    assert.ok(E.live(run));
    let ci = 0;
    for (let g = 0; run.phase === 'event' && g < 20; g++) { const out = E.chooseEvent(run, ci); ci = out === E.AGAIN ? 0 : ci + 1; }
    E.makeOffer(run, E.unlockedCards(999));
    res = E.pickCard(run, run.quiet ? null : run.offer[0]);
  }
  return { run, res };
}

const investAll = (run) => E.setHolding(run, 'index', run.h.index + Math.max(0, run.cash));

test('the same seed gives the same market and the same result', () => {
  const a = play({ mode: 'daily', char: 'graduate', currency: 'NGN', seed: 'daily-2026-09-27' }, investAll);
  const b = play({ mode: 'daily', char: 'graduate', currency: 'NGN', seed: 'daily-2026-09-27' }, investAll);
  assert.deepEqual(a.run.market.map((m) => m.state), b.run.market.map((m) => m.state));
  assert.equal(a.res.score, b.res.score);
});

test('player choices never change the market path', () => {
  const a = play({ mode: 'duel', char: 'graduate', currency: 'USD', seed: 'duel-DABCDE' });
  const b = play({ mode: 'duel', char: 'graduate', currency: 'USD', seed: 'duel-DABCDE' }, investAll);
  const n = Math.min(a.run.turn, b.run.turn);
  for (let t = 0; t < n; t++) assert.equal(a.run.market[t].ret.index, b.run.market[t].ret.index);
});

test('every mode, character, era and challenge finishes with finite numbers', () => {
  const setups = [
    ...['graduate', 'heir', 'farmer', 'hustler', 'sailor'].map((char) => ({ mode: 'classic', char, currency: 'NGN' })),
    { mode: 'journey', char: 'graduate', currency: 'NGN', aim: 45 },
    { mode: 'journey', char: 'sailor', currency: 'USD', aim: 40 },
    { mode: 'blitz', char: 'graduate', currency: 'USD' },
    { mode: 'classic', char: 'graduate', currency: 'NGN', asc: 12 },
    ...ERAS.map((e) => ({ mode: 'era', char: 'graduate', eraId: e.id })),
    ...CHALLENGES.map((c) => ({ mode: 'weekly', char: 'graduate', currency: 'NGN', challengeId: c.id })),
  ];
  for (const s of setups) {
    for (let i = 0; i < 20; i++) {
      const { res } = play({ ...s, seed: `t${i}` }, investAll);
      assert.ok(Number.isFinite(res.score) && Number.isFinite(res.nw), JSON.stringify(s));
      assert.ok(['free', 'clock', 'bankrupt', 'target', 'missed'].includes(res.reason));
    }
  }
});

test('investing beats hoarding cash', () => {
  let invested = 0;
  let hoarded = 0;
  for (let i = 0; i < 60; i++) {
    invested += play({ mode: 'classic', char: 'graduate', currency: 'NGN', seed: `h${i}` }, investAll).res.score;
    hoarded += play({ mode: 'classic', char: 'graduate', currency: 'NGN', seed: `h${i}` }).res.score;
  }
  assert.ok(invested > hoarded * 1.5, `${invested} vs ${hoarded}`);
});

test('property bought this turn cannot be sold until next turn', () => {
  const run = E.newRun({ mode: 'classic', char: 'heir', currency: 'USD', seed: 'p1' });
  assert.ok(E.buyProperty(run, 50000, true));
  assert.ok(Math.abs(run.h.prop.v - (50000 / 0.3) * 0.97) < 1);
  assert.equal(E.sellProperty(run, 1), false);
});

test('passive income ignores crypto and counts debts against you', () => {
  const run = E.newRun({ mode: 'classic', char: 'hustler', currency: 'USD', seed: 'c1' });
  assert.equal(E.passive(run).total, 0);
  run.cash = -10000;
  assert.ok(E.passive(run).total < 0);
});

test('sailors cannot trade while at sea', () => {
  const run = E.newRun({ mode: 'classic', char: 'sailor', currency: 'USD', seed: 's1' });
  assert.ok(E.canAct(run));
  run.turn = 1;
  assert.equal(E.canAct(run), false);
  assert.equal(E.setHolding(run, 'index', 1000), 0);
});

test('content ids are unique', () => {
  assert.equal(new Set(CARDS.map((c) => c.id)).size, CARDS.length);
  assert.equal(new Set(EVENTS.map((e) => e.id)).size, EVENTS.length);
});

// ---------------------------------------------------------------- learning layer

test('Kelly matches the textbook even-money answer', () => {
  const k = E.kelly([{ p: 0.6, m: 2 }, { p: 0.4, m: 0 }]);
  assert.ok(Math.abs(k.f - 0.2) < 0.011, String(k.f));
  assert.equal(E.kelly([{ p: 0.5, m: 2 }, { p: 0.5, m: 0 }]).f, 0);
});

test('the probability lens is calibrated against the real market', () => {
  const buckets = Array.from({ length: 5 }, () => ({ said: 0, hit: 0, n: 0 }));
  for (let i = 0; i < 150; i++) {
    const run = E.newRun({ mode: 'journey', char: 'graduate', currency: i % 2 ? 'USD' : 'NGN', seed: `cal${i}` });
    for (let t = 0; t < run.turns; t++) {
      run.turn = t;
      const { post } = E.posterior(run);
      for (const s of E.MOODS) {
        const b = buckets[Math.min(4, Math.floor(post[s] * 5))];
        b.said += post[s]; b.hit += run.market[t].state === s ? 1 : 0; b.n += 1;
      }
    }
  }
  for (const b of buckets) if (b.n > 300) assert.ok(Math.abs(b.said / b.n - b.hit / b.n) < 0.05, JSON.stringify(b));
});

test('buying below fair value really does pay more (margin of safety)', () => {
  const cheap = [];
  const dear = [];
  for (let i = 0; i < 200; i++) {
    for (const m of E.genMarket({ seed: `v${i}`, turns: 38, ypt: 1, currency: 'USD' })) {
      const real = (1 + m.ret.index) / (1 + m.infl) - 1;
      if (m.val < 0.85) cheap.push(real);
      if (m.val > 1.2) dear.push(real);
    }
  }
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  assert.ok(avg(cheap) > avg(dear) + 0.04, `${avg(cheap)} vs ${avg(dear)}`);
});

test('paying yourself first never borrows', () => {
  // Pay covers living costs but not a 50% plan on top: the plan gets what is left.
  const run = E.newRun({ mode: 'journey', char: 'graduate', currency: 'USD', seed: 'pyf', aim: 45 });
  run.cash = 0;
  E.setLife(run, 1);
  E.setPlan(run, { pyf: 0.5 });
  E.setForecast(run, 0.5);
  const before = run.cash;
  const res = E.live(run);
  assert.ok(res.pyfShort > 0);
  assert.ok(res.pyf > 0);
  // The plan only invests what pay left over after living costs.
  const left = before + res.flows.filter((x) => ['Salary', 'Living costs', 'Giving', 'Car loan repaid'].includes(x.label) || x.label.endsWith('\'s pay')).reduce((s, x) => s + x.v, 0);
  assert.ok(res.pyf <= left + 1e-6, `${res.pyf} vs ${left}`);
});

test('journey years alternate between events and quiet years, with forecasts scored', () => {
  const { run, res } = play({ mode: 'journey', char: 'graduate', currency: 'NGN', seed: 'j1', aim: 45 }, (r) => {
    E.setPlan(r, { pyf: 0.2, mix: 'growth', rebalance: true });
  });
  assert.ok(run.seenEv.length <= Math.ceil(run.fc.length / 2) + 2);
  assert.ok(res.seenP.length > 5);
  assert.equal(res.learnMode, true);
});

// ---------------------------------------------------------------- starting from real life

const ME = { age: 31, pay: 350000, costs: 250000, cash: 400000, save: 1200000, index: 800000, stocks: 500000, crypto: 100000, fx: 300000, prop: 15000000, liveIn: true, mortgage: 6000000, biz: 2000000, bizManaged: false, debt: 150000, aim: 50, goal: 400000 };

test('a real-life start uses the player\'s own age, money and goals', () => {
  const run = E.newRun({ mode: 'journey', char: 'graduate', currency: 'NGN', seed: 'me1', me: ME });
  assert.equal(run.age, 31);
  assert.equal(run.char, 'me');
  assert.equal(run.salary, 350000 * 12);
  assert.equal(E.costs(run), 250000 * 12);
  const expected = 400000 + 1200000 + 800000 + 500000 + 100000 + 300000 + 15000000 - 6000000 + 2000000 - 150000;
  assert.ok(Math.abs(E.netWorth(run) - expected) < 1, `${E.netWorth(run)} vs ${expected}`);
  assert.equal(run.aim, 50);
  assert.equal(E.bowl(run), 400000 * 12, 'the goal income sets the bowl');
  assert.equal(run.turns, 60 - 31);
  assert.equal(run.hist[0].nw, E.netWorth(run));
});

test('a real-life start plays to the end, and older players still get years to play', () => {
  const { res } = play({ mode: 'classic', char: 'graduate', currency: 'USD', seed: 'me2', me: { ...ME, age: 58, pay: 4000, costs: 3000, cash: 20000, save: 0, index: 50000, stocks: 0, crypto: 0, fx: 0, prop: 0, mortgage: 0, biz: 0, debt: 0, goal: 0 } }, investAll);
  assert.ok(Number.isFinite(res.score));
  assert.ok(res.years >= 8 || res.reason === 'free' || res.reason === 'bankrupt');
});

test('someone already free by the 4% rule is free after the first year', () => {
  const rich = { age: 40, pay: 5000, costs: 2000, cash: 0, save: 2000000, index: 0, stocks: 0, crypto: 0, fx: 0, prop: 0, mortgage: 0, biz: 0, debt: 0, goal: 0 };
  const { res } = play({ mode: 'classic', char: 'graduate', currency: 'USD', seed: 'me3', me: rich });
  assert.equal(res.reason, 'free');
  assert.equal(res.age, 42);
});

test('the home you live in earns no rent, but a second property does', () => {
  const home = E.newRun({ mode: 'classic', char: 'graduate', currency: 'USD', seed: 'h1', me: { ...ME, liveIn: true } });
  assert.equal(E.passive(home).rent, 0);
  const let_ = E.newRun({ mode: 'classic', char: 'graduate', currency: 'USD', seed: 'h1', me: { ...ME, liveIn: false } });
  assert.ok(E.passive(let_).rent > 0);
  home.cash = 1e7;
  E.buyProperty(home, 1e6, false);
  assert.ok(E.passive(home).rent > 0, 'a property bought in the game is let out');
});
