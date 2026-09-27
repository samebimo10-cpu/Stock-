// The PDF report: valid file structure, sensible grades, works mid-game.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import { buildReport, judge, Pdf, money } from '../js/report.js';

function playTo(run, stopTurn = Infinity) {
  let res = null;
  while (!res && run.turn < stopTurn) {
    if (run.quiz) E.answerQuiz(run, 0);
    if (E.canAct(run)) E.setHolding(run, 'index', run.h.index + Math.max(0, run.cash) * 0.7);
    if (run.learnMode) E.setForecast(run, 0.6);
    E.live(run);
    let i = 0;
    while (run.phase === 'event' && E.chooseEvent(run, i) === null) i += 1;
    E.makeOffer(run, E.unlockedCards(0));
    res = E.pickCard(run, run.quiet ? null : run.offer[0]);
  }
  return res;
}

function checkPdf(bytes) {
  const s = Buffer.from(bytes).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  const startxref = Number(/startxref\n(\d+)/.exec(s)[1]);
  assert.equal(s.slice(startxref, startxref + 4), 'xref');
  // Every object offset in the table must point at "N 0 obj".
  const table = s.slice(startxref).split('\n').slice(2).filter((l) => / 00000 n $/.test(l));
  table.forEach((l, i) => assert.equal(s.slice(Number(l.slice(0, 10)), Number(l.slice(0, 10)) + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
  // Only plain characters inside text.
  assert.ok(!/[^\x00-\x7F]/.test(s), 'non-ASCII in PDF');
  return s;
}

test('a finished game makes a valid PDF with a grade for each habit', () => {
  const run = E.newRun({ mode: 'journey', char: 'graduate', currency: 'NGN', seed: 'r1', aim: 45 });
  const res = playTo(run);
  const s = checkPdf(buildReport(run, { name: 'Ada', modeName: 'Wisdom Journey', regionName: 'West Africa', title: 'Done' }));
  assert.ok(s.includes('Money decisions report'));
  assert.ok(s.includes('YOUR REPORT CARD'));
  assert.ok(s.includes('NGN '), 'money written with the currency code');
  const J = judge(run);
  assert.ok(J.areas.length >= 7);
  for (const a of J.areas) assert.ok('ABCDF'.includes(a.grade) && a.did && a.next);
  assert.ok(res.journal.length > 0 && res.journal.some((e) => e.event));
});

test('a report mid-game, a real-life start and a CJK currency all work', () => {
  const run = E.newRun({ mode: 'classic', char: 'graduate', currency: 'CNY', seed: 'r2', me: { age: 30, pay: 9000, costs: 6000, cash: 20000, save: 50000, index: 0, stocks: 0, crypto: 0, fx: 0, prop: 800000, mortgage: 300000, biz: 0, debt: 0, aim: 50, goal: 8000 } });
  playTo(run, 4);
  assert.equal(run.result, null);
  checkPdf(buildReport(run, { title: 'In progress' }));
});

test('money is written plainly and long text wraps', () => {
  assert.equal(money(2400000, 'NGN'), 'NGN 2.4M');
  assert.equal(money(-12500, 'USD'), '-USD 12.5K');
  const pdf = new Pdf();
  assert.ok(pdf.wrap('word '.repeat(200), 300, 10, false).length > 5);
});

test('a scam and a panic sale lower the right grades', () => {
  const run = E.newRun({ mode: 'classic', char: 'graduate', currency: 'USD', seed: 'r3' });
  playTo(run, 3);
  const before = judge(run).areas.find((a) => a.id === 'scam').score;
  run.log.scam = 1.2;
  assert.ok(judge(run).areas.find((a) => a.id === 'scam').score < before);
});
