// Every piece of content has a picture, and every picture draws.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../js/art.js';
import { EVENTS, CARDS, ASSETS, CURRENCIES, REGIONS, CHARACTERS, STATE_INFO } from '../js/content.js';
import * as E from '../js/engine.js';

const isSvg = (s) => typeof s === 'string' && s.startsWith('<svg') && s.endsWith('</svg>');

test('every event has a cast member and a scene', () => {
  for (const e of EVENTS) {
    const art = A.EVENT_ART[e.id];
    assert.ok(art, `event ${e.id} has no art`);
    assert.ok(art[0] === 'guide' || A.CAST[art[0]], `event ${e.id}: unknown cast ${art[0]}`);
    assert.ok(A.hasIcon(art[1]), `event ${e.id}: unknown scene ${art[1]}`);
  }
});

test('every scam event is brought by the Hype Guy', () => {
  for (const id of ['forex', 'coinhype', 'offplan']) assert.equal(A.EVENT_ART[id][0], 'hype');
  for (const c of CARDS.filter((x) => x.trap)) assert.equal(A.CARD_ART[c.id], 'hype');
});

test('every card, asset and mood has a picture and a plain name', () => {
  for (const c of CARDS) { assert.ok(A.CARD_ART[c.id], `card ${c.id}`); assert.ok(isSvg(A.cardPic(c.id))); assert.ok(A.TYPE_ICON[c.type]); }
  for (const id of Object.keys(ASSETS)) { assert.ok(A.PLAIN[id] && A.PLAIN[id].label, id); assert.ok(A.hasIcon(A.PLAIN[id].icon), id); }
  for (const s of Object.keys(STATE_INFO)) assert.ok(A.hasIcon(A.WEATHER[s].icon), s);
});

test('people, scenes and money pictures render for every combination', () => {
  for (const ch of Object.keys(CHARACTERS)) {
    for (const hair of A.HAIRS) {
      for (const age of [22, 35, 50, 60]) assert.ok(isSvg(A.avatar({ skin: 2, hair, outfit: 1 }, ch, { age })));
    }
  }
  for (const id of [...Object.keys(A.CAST), ...Object.keys(A.GUIDES)]) assert.ok(isSvg(A.castFace(id)));
  for (let stage = 0; stage <= 4; stage++) {
    for (const mood of Object.keys(STATE_INFO)) assert.ok(isSvg(A.homeScene({ stage, life: stage, mood, look: {}, char: 'farmer', age: 40, prop: true, biz: true, kids: true, car: true })));
  }
  assert.ok(isSvg(A.townScene(Object.keys(ASSETS), 'crash')));
  assert.ok(isSvg(A.coinJar(0.5, { debt: true })));
  for (let l = 0; l < 5; l++) assert.ok(isSvg(A.room(l)));
});

test('every region has a guide and real currencies, and every currency formats', () => {
  for (const [id, r] of Object.entries(REGIONS)) {
    assert.ok(A.GUIDES[r.guide], `${id} guide`);
    for (const c of r.currencies) assert.ok(CURRENCIES[c], `${id} currency ${c}`);
  }
  const duel = new Set();
  for (const [code, c] of Object.entries(CURRENCIES)) {
    assert.ok(E.PROFILES[c.profile], code);
    assert.ok(!duel.has(c.duel), `duel letter ${c.duel} reused`); duel.add(c.duel);
    for (const n of [0, 950, 12500, 2.4e6, 3.1e9]) assert.ok(E.fmt(n, code).startsWith(c.sym), `${code} ${n}`);
  }
});

test('a run in every currency finishes with finite numbers', () => {
  for (const currency of Object.keys(CURRENCIES)) {
    const run = E.newRun({ mode: 'classic', char: 'graduate', currency, seed: `c-${currency}` });
    let res = null;
    while (!res) {
      if (E.canAct(run)) E.setHolding(run, 'index', run.h.index + Math.max(0, run.cash) * 0.8);
      E.live(run);
      let i = 0;
      while (run.phase === 'event' && E.chooseEvent(run, i) === null) i += 1;
      E.makeOffer(run, E.unlockedCards(0));
      res = E.pickCard(run, null);
    }
    assert.ok(Number.isFinite(res.score) && Number.isFinite(res.nw), currency);
  }
});
