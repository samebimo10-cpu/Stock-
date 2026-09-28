// Tests for the life layer, the Circle, land, world rules and the Life Score.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import * as A from '../js/art.js';
import { buildReport } from '../js/report.js';
import { HOMES, CARS, WORLD_RULES, COUNTRIES, CURRENCIES, ZONE_ORDER } from '../js/content.js';

function play(opts, bot = () => {}, pick = 0) {
  const run = E.newRun(opts);
  let res = null;
  let guard = 0;
  while (!res && guard++ < 60) {
    if (run.quiz) E.answerQuiz(run, 0);
    if (E.canAct(run)) bot(run);
    if (run.learnMode && run.think) E.setForecast(run, 0.5);
    E.live(run);
    let ci = pick;
    for (let g = 0; run.phase === 'event' && g < 20; g++) { const out = E.chooseEvent(run, ci); ci = out === E.AGAIN ? 0 : (ci + 1) % 6; }
    E.makeOffer(run, E.unlockedCards(0));
    res = E.pickCard(run, run.quiet ? null : run.offer[0]);
  }
  return { run, res };
}

test('every currency has a country with six land zones', () => {
  for (const c of Object.keys(CURRENCIES)) {
    assert.ok(COUNTRIES[c], c);
    for (const z of ZONE_ORDER) assert.ok(COUNTRIES[c].zones[z], `${c} ${z}`);
  }
});

test('the starting home is already inside living costs', () => {
  const run = E.newRun({ mode: 'classic', char: 'graduate', currency: 'USD', seed: 'l1' });
  const total = E.costs(run);
  assert.ok(Math.abs(total - 16800) / 16800 < 0.05, String(total));
  assert.ok(E.lifeCosts(run).rent > 0);
});

test('moving to a bigger home costs more; buying swaps rent for a mortgage', () => {
  const run = E.newRun({ mode: 'classic', char: 'heir', currency: 'USD', seed: 'l2' });
  const before = E.costs(run);
  assert.ok(E.moveHome(run, 'house', 'upscale'));
  assert.ok(E.costs(run) > before);
  run.cash = 1e7;
  assert.ok(E.moveHome(run, 'house', 'upscale', { buy: true, mortgage: true }));
  assert.equal(E.lifeCosts(run).rent, 0);
  assert.ok(run.h.prop.home > 0 && run.h.prop.debt > 0);
  assert.equal(E.rentable(run), 0);
});

test('cars lose value every year and count in net worth', () => {
  const run = E.newRun({ mode: 'classic', char: 'heir', currency: 'USD', seed: 'l3' });
  assert.ok(E.buyCar(run, 'suv', false));
  const v0 = run.car.v;
  E.live(run);
  assert.ok(run.car.v < v0 || run.car.id === 'none');
});

test('frugal living caps schools and brings burnout after two years', () => {
  const run = E.newRun({ mode: 'classic', char: 'graduate', currency: 'USD', seed: 'l4' });
  E.setLife(run, 0);
  assert.deepEqual(E.schoolsOpen(run), ['public', 'budget']);
  run.frugalYears = 2;
  E.live(run);
  if (run.phase === 'event') assert.equal(run.pending.id, run.market[0].devJump ? 'deval' : 'burnout');
});

test('land: checking the papers shows the truth, and a plot can be bought and sold', () => {
  const run = E.newRun({ mode: 'classic', char: 'heir', currency: 'NGN', seed: 'l5' });
  const z = 'farm';
  const o = E.landOffer(run, z);
  assert.equal(o.truth, null);
  assert.ok(E.checkLand(run, z));
  assert.ok(E.landOffer(run, z).truth);
  assert.ok(E.buyLand(run, z));
  assert.equal(run.land.length, 1);
  assert.equal(E.sellLand(run, 0), false, 'not in the year it was bought');
  assert.ok(E.setLandUse(run, 0, 'farm'));
  assert.ok(E.passive(run).farm > 0);
});

test('the Circle: asking questions reveals a clue and the same request stays open', () => {
  for (let i = 0; i < 400; i++) {
    const run = E.newRun({ mode: 'classic', char: 'graduate', currency: 'USD', seed: `c${i}` });
    run.forceEvent = 'circle';
    E.live(run);
    if (run.phase !== 'event' || run.pending.id !== 'circle') continue;
    const v = E.eventView(run);
    const ask = v.choices.findIndex((c) => c.act === 'ask');
    assert.equal(E.chooseEvent(run, ask), E.AGAIN);
    const v2 = E.eventView(run);
    assert.ok(v2.v.asked);
    assert.ok(!v2.choices.some((c) => c.act === 'ask'));
    return;
  }
  assert.fail('no Circle event found');
});

test('world rules come from the seed, so a Daily shares them', () => {
  const a = E.newRun({ mode: 'daily', char: 'graduate', currency: 'NGN', seed: 'daily-2026-10-01' });
  const b = E.newRun({ mode: 'daily', char: 'graduate', currency: 'NGN', seed: 'daily-2026-10-01' });
  assert.deepEqual(a.rules, b.rules);
  assert.equal(a.rules.length, 2);
  for (const r of a.rules) assert.ok(WORLD_RULES[r]);
  assert.deepEqual(a.circle.map((c) => c.type), b.circle.map((c) => c.type));
});

test('life choices never change the market path', () => {
  const a = play({ mode: 'duel', char: 'graduate', currency: 'NGN', seed: 'duel-NLIFE1' }, () => {}, 0);
  const b = play({ mode: 'duel', char: 'graduate', currency: 'NGN', seed: 'duel-NLIFE1' }, (r) => { E.setLife(r, 3); E.moveHome(r, 'flat2', 'gated'); E.setGiving(r, 0.1); }, 1);
  const n = Math.min(a.run.turn, b.run.turn);
  for (let t = 0; t < n; t++) {
    assert.equal(a.run.market[t].ret.index, b.run.market[t].ret.index);
    assert.deepEqual(a.run.market[t].land, b.run.market[t].land);
  }
});

test('the Sprint lasts ten years and gives a Life Score', () => {
  const { run, res } = play({ mode: 'sprint', char: 'graduate', currency: 'USD', seed: 's1' });
  assert.equal(run.turns, 5);
  assert.ok(res.life && res.life.stars >= 0 && res.life.stars <= 5);
  assert.equal(res.sprint, true);
  assert.deepEqual(run.rules, []);
});

test('the Life Score stays between 0 and 5 in every kind of run', () => {
  for (let i = 0; i < 40; i++) {
    const { res } = play({ mode: 'classic', char: ['graduate', 'heir', 'farmer', 'hustler'][i % 4], currency: ['NGN', 'USD', 'KES', 'INR'][i % 4], seed: `ls${i}` }, (r) => E.setHolding(r, 'index', r.h.index + Math.max(0, r.cash)), i % 4);
    assert.ok(res.life.stars >= 0 && res.life.stars <= 5, JSON.stringify(res.life));
    assert.ok(Number.isFinite(res.score) && Number.isFinite(res.nw));
  }
});

test('an old saved game upgrades to the life layer without breaking', () => {
  const run = E.newRun({ mode: 'classic', char: 'graduate', currency: 'USD', seed: 'old' });
  // A version-1 run kept all living costs in baseCosts.
  run.baseCosts = 16800;
  const costs0 = 16800;
  for (const k of ['home', 'car', 'partner', 'kids', 'circle', 'land', 'zonePx', 'rules', 'stats', 'got', 'milestones']) delete run[k];
  run.v = 1;
  run.flags.married = true;
  run.flags.kids = 1;
  E.upgradeRun(run);
  assert.equal(run.v, 2);
  assert.ok(Math.abs(E.costs(run) - costs0) / costs0 < 0.1);
  assert.ok(E.live(run));
});

test('the new art draws for every home, car, look and zone', () => {
  const isSvg = (s) => typeof s === 'string' && s.startsWith('<svg') && s.endsWith('</svg>');
  for (const id of Object.keys(HOMES)) assert.ok(isSvg(A.homePic(id)) && isSvg(A.homeScene({ home: id, district: 'gated', car: 'suv', mood: 'boom', family: [{ look: {}, age: 30 }, { look: {}, age: 6 }] })));
  for (const id of Object.keys(CARS)) assert.ok(isSvg(A.carPic(id)));
  for (const wear of A.WEARS) for (const b of A.BUILDS) for (const age of [8, 30, 48, 58]) assert.ok(isSvg(A.person({ wear, build: b, age, style: age % 5 })));
  assert.ok(isSvg(A.countryMap(ZONE_ORDER.map((id) => ({ id, name: COUNTRIES.KES.zones[id], plots: 1, news: id === 'farm' })), { country: 'Kenya' })));
});

test('the PDF report includes the Life Score and the family and Circle grades', () => {
  const { run } = play({ mode: 'classic', char: 'graduate', currency: 'NGN', seed: 'rep1' }, (r) => E.setGiving(r, 0.05));
  const pdf = new TextDecoder('latin1').decode(buildReport(run, { name: 'Test' }));
  assert.ok(pdf.includes('Life Score'));
  assert.ok(pdf.includes('Your Circle and giving'));
});
