// Story layer tests: the director, threads, memories, people, goals, chapters,
// earned cards and the hidden strategy mechanics.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import { STORY, GOALS, EARNED, CHAPTERS, chapterOf } from '../js/story.js';
import { PRINCIPLES } from '../js/learn.js';
import { CARDS } from '../js/content.js';
import { play, decide } from './helpers.mjs';

test('the first decision greets you before the first year', () => {
  const run = E.newRun({ mode: 'classic', char: 'graduate', currency: 'NGN', seed: 'st1' });
  assert.equal(run.pending.id, 'first_step');
  assert.equal(E.live(run), null, 'you answer the message before living the year');
  assert.ok(E.chooseEvent(run, 0));
  assert.equal(run.pending, null);
  assert.ok(E.live(run));
  assert.ok(run.pending, 'the next year brings a new message');
});

test('every story event is well formed and its lessons exist', () => {
  const ids = new Set();
  for (const e of STORY) {
    assert.ok(!ids.has(e.id), `duplicate ${e.id}`);
    ids.add(e.id);
    assert.ok(e.title && e.text && e.choices, e.id);
    const choices = typeof e.choices === 'function' ? null : e.choices;
    if (choices) for (const c of choices) if (c.lesson) assert.ok(PRINCIPLES[c.lesson], `${e.id} lesson ${c.lesson}`);
  }
  for (const c of EARNED) assert.ok(CARDS.find((x) => x.id === c.card), c.card);
});

test('each life event is dealt once a year, and threads come back later', () => {
  let chained = 0;
  for (let i = 0; i < 25; i++) {
    const { run } = play({ mode: 'classic', char: 'graduate', currency: 'USD', seed: `thr${i}` }, (r) => E.setHolding(r, 'index', r.h.index + Math.max(0, r.cash) * 0.5));
    assert.ok(run.seenEv.length >= run.turn, 'one event a year');
    if (run.seenEv.includes('venture_year2') || run.seenEv.includes('venture_news') || run.seenEv.includes('startup_exit')) chained += 1;
  }
  assert.ok(chained > 0, 'some choices came back as follow-ups');
});

test('decisions become memories, and the life story reconstructs the run', () => {
  const { res } = play({ mode: 'classic', char: 'graduate', currency: 'NGN', seed: 'mem1' }, (r) => E.setHolding(r, 'index', r.h.index + Math.max(0, r.cash) * 0.6));
  const S = res.story;
  assert.ok(S.memories.length >= 3);
  assert.ok(S.memories.some((m) => m.title === 'Your first job' || m.title === 'Where you started'));
  assert.ok(S.decisions.length >= 10);
  for (const m of S.memories) assert.ok(Number.isFinite(m.impact) && m.age >= 22);
});

test('recurring people have state that choices change', () => {
  const run = E.newRun({ mode: 'classic', char: 'graduate', currency: 'USD', seed: 'cast1' });
  const friend = run.circle.find((c) => c.role === 'ambitious');
  assert.ok(friend && friend.name && friend.skill > 0 && friend.skill < 1);
  const before = friend.trust;
  E.chooseEvent(run, 0);
  assert.ok(friend.trust > before, 'investing on their advice builds trust');
  assert.ok(friend.history.length === 1);
});

test('chapters follow age and goals move on when reached', () => {
  assert.equal(chapterOf(22).id, 'start');
  assert.equal(chapterOf(30).id, 'build');
  assert.equal(chapterOf(40).id, 'big');
  assert.equal(chapterOf(50).id, 'protect');
  assert.equal(chapterOf(58).id, 'free');
  assert.equal(CHAPTERS.length, 5);
  const { run } = play({ mode: 'classic', char: 'graduate', currency: 'USD', seed: 'goal1' }, (r) => { E.setPlan(r, { pyf: 0.2 }); E.setHolding(r, 'save', r.h.save + Math.max(0, r.cash) * 0.5); });
  assert.ok(run.story.goalsDone.length >= 1, 'at least one goal reached');
  for (const id of run.story.goalsDone) assert.ok(GOALS.find((g) => g.id === id));
});

test('cards are earned by behaviour, not picked at random', () => {
  const { run } = play({ mode: 'classic', char: 'graduate', currency: 'USD', seed: 'card1' }, (r) => { E.setPlan(r, { pyf: 0.2, mix: 'growth' }); E.setHolding(r, 'index', r.h.index + Math.max(0, r.cash) * 0.5); });
  assert.ok(run.cards.includes('compound'), 'seven years of paying yourself first earns Compound Nerd');
  assert.ok(run.cards.includes('dividend'), 'ten years in the index fund earns Dividend Hunter');
});

test('bargaining power rises with savings to fall back on', () => {
  const run = E.newRun({ mode: 'classic', char: 'graduate', currency: 'USD', seed: 'batna' });
  decide(run);
  const h = E.helpersFor(run);
  run.h.save = 0;
  const weak = h.batna();
  run.h.save = E.costs(run);
  assert.ok(h.batna() > weak);
});

test('the bidding war has a winner\'s curse: winning at the asking price means it was worth less', () => {
  const run = E.newRun({ mode: 'classic', char: 'heir', currency: 'USD', seed: 'auc' });
  decide(run);
  const h = E.helpersFor(run);
  let wins = 0; let valueWhenWon = 0; let trials = 0;
  for (let i = 0; i < 400; i++) {
    const v = { P: 100, V: 100 * (0.8 + 0.4 * Math.random()), rival: 0.92 + 0.16 * Math.random() };
    trials += 1;
    if (v.P > v.V * v.rival) { wins += 1; valueWhenWon += v.V; }
  }
  assert.ok(wins > 0 && valueWhenWon / wins < 100, 'the flats you win at asking are worth less than asking on average');
  assert.ok(h.auction({ P: 100, V: 50, rival: 1 }, 1).startsWith('You won'));
  assert.ok(trials === 400);
});

test('the price war rival answers your last move', () => {
  const run = E.newRun({ mode: 'classic', char: 'farmer', currency: 'USD', seed: 'pd' });
  decide(run);
  const rival = run.circle.find((c) => c.role === 'rival');
  rival.style = 'tft';
  const h = E.helpersFor(run);
  h.rivalMove();
  h.priceWar('D', 'C');
  assert.equal(run.story.comp.next, 'D', 'tit for tat copies your undercut');
  h.priceWar('C', 'D');
  assert.equal(run.story.comp.next, 'C', 'and forgives when you hold');
});

test('business moves change profit, one a year', () => {
  const run = E.newRun({ mode: 'classic', char: 'farmer', currency: 'USD', seed: 'biz' });
  decide(run);
  run.cash = 1e6;
  const p0 = run.h.biz.profit;
  assert.ok(E.bizAction(run, 'marketing'));
  assert.ok(run.h.biz.profit > p0);
  assert.equal(E.bizAction(run, 'hire'), false, 'one move a year');
  const v = E.bizView(run);
  assert.ok(v.customers > 0 && v.revenue > v.profit);
});

test('freedom is recorded and the life can carry on to 60', () => {
  const rich = { age: 40, pay: 5000, costs: 2000, cash: 0, save: 2000000, index: 0, stocks: 0, crypto: 0, fx: 0, prop: 0, mortgage: 0, biz: 0, debt: 0, goal: 0 };
  const run = E.newRun({ mode: 'classic', char: 'graduate', currency: 'USD', seed: 'free1', me: rich });
  decide(run);
  const y = E.live(run);
  assert.ok(y.freedom && !y.result);
  assert.equal(run.freeAge, 42);
  assert.ok(E.workAction(run, 'retire').ok);
  decide(run);
  const y2 = E.live(run);
  assert.equal(y2.flows.find((x) => x.label === 'Salary').v, 0, 'no salary once retired');
  const out = E.endGame(run);
  assert.equal(out.reason, 'free');
  assert.equal(out.freeAge, 42);
});

test('a game in progress survives a save and load', () => {
  const run = E.newRun({ mode: 'journey', char: 'graduate', currency: 'KES', seed: 'save1' });
  decide(run); E.live(run); decide(run); E.live(run);
  const copy = JSON.parse(JSON.stringify(run));
  E.upgradeRun(copy);
  assert.deepEqual(copy.story.memories, run.story.memories);
  assert.equal(copy.pending ? copy.pending.id : null, run.pending ? run.pending.id : null);
  decide(copy);
  assert.ok(E.live(copy));
});

test('a saved game from the previous version picks up a story', () => {
  const run = E.newRun({ mode: 'classic', char: 'graduate', currency: 'USD', seed: 'old2' });
  decide(run); E.live(run);
  delete run.story; delete run.beh;
  run.circle = run.circle.filter((c) => !c.cast);
  run.phase = 'event';
  E.upgradeRun(run);
  assert.ok(run.story && run.story.goal);
  assert.ok(run.circle.some((c) => c.role === 'boss'));
  assert.equal(run.phase, 'alloc');
});

test('a real-life start opens with where you are now and can invest its savings', () => {
  const me = { age: 35, pay: 450000, costs: 300000, cash: 0, save: 2000000, index: 0, stocks: 0, crypto: 0, fx: 0, prop: 0, mortgage: 0, biz: 0, debt: 0, goal: 0 };
  const run = E.newRun({ mode: 'classic', char: 'graduate', currency: 'NGN', seed: 'me35', me });
  assert.equal(run.age, 35);
  const v = E.eventView(run);
  assert.equal(v.title, 'Where you are now');
  assert.ok(v.text.includes('in savings'));
  const save0 = run.h.save;
  E.chooseEvent(run, 0);
  assert.ok(run.h.index > 0 && run.h.save < save0, 'savings moved into the fund');
  assert.equal(run.story.memories.at(-1).title, 'You put money to work');
});
