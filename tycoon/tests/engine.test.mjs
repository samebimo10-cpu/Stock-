// Rules tests for Tycoon Rush. Run with: node --test "tycoon/tests/**/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import { ERAS, CHALLENGES, CARDS, EVENTS } from '../js/content.js';

function play(opts, bot = () => {}) {
  const run = E.newRun(opts);
  let res = null;
  let guard = 0;
  while (!res && guard++ < 40) {
    if (E.canAct(run)) bot(run);
    assert.ok(E.live(run));
    let ci = 0;
    while (E.chooseEvent(run, ci) === null) ci += 1;
    E.makeOffer(run, E.unlockedCards(999));
    res = E.pickCard(run, run.offer[0]);
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
