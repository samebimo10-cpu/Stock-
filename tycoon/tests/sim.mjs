// Balance runs: plays many seeds with simple bot strategies and prints outcomes.
// node tycoon/tests/sim.mjs [runs]
//
// A "win" is a life worth showing off: free, with a Life Score of 4 stars or
// more. No single strategy should win much more than about 70% of runs.
import * as E0 from '../js/engine.js';
import { HOMES } from '../js/content.js';
const E = { ...E0, HOMES };

const N = Number(process.argv[2] || 400);
const unlocked = E.unlockedCards(0).filter((id) => !['ponzi', 'mlm', 'leverage'].includes(id));

// Event choices: most bots pick at random; the "people reader" asks questions
// and helps only those who deserve it (it reads the hidden type, standing in
// for a player who reads the clues well).
function chooseRandom(run) {
  const r = E.rngFor(run.seed, 'bot', run.turn);
  for (let tries = 0; tries < 8 && run.phase === 'event'; tries++) {
    const v = E.eventView(run);
    const ok = v.choices.map((c, i) => (c.ok && c.act !== 'ask' ? i : -1)).filter((i) => i >= 0);
    const out = E.chooseEvent(run, ok[Math.floor(r() * ok.length)]);
    if (out === null) continue;
  }
}
function chooseWise(run) {
  for (let tries = 0; tries < 8 && run.phase === 'event'; tries++) {
    const v = E.eventView(run);
    let i = 0;
    if (v.id === 'circle') {
      const t = v.v.type;
      const want = t === 'genuine' || t === 'helper' ? 0 : v.choices.length - 1;
      i = v.choices[want].ok ? want : v.choices.length - 1;
    } else if (v.id === 'wedding') {
      const good = v.v.cands.findIndex((c) => ['saver', 'balanced', 'builder'].includes(c.type));
      i = good >= 0 ? good : v.choices.length - 1;
    } else {
      i = v.choices.findIndex((c) => c.ok);
    }
    if (E.chooseEvent(run, i) === E.AGAIN) continue;
  }
}

const invest = (run, keep) => {
  const spare = Math.max(0, run.cash - keep);
  if (run.h.save < E.costs(run)) { const x = Math.min(spare, E.costs(run) - run.h.save); E.setHolding(run, 'save', run.h.save + x); }
  const rest = Math.max(0, run.cash - keep);
  E.setHolding(run, 'index', run.h.index + rest);
};

const bots = {
  hoarder: { play: () => {}, events: chooseRandom },
  saver: { play: (run) => { E.setHolding(run, 'save', run.h.save + Math.max(0, run.cash)); }, events: chooseRandom },
  frugalIndex: {
    play: (run) => {
      E.setLife(run, 0);
      if (run.home.id !== 'room' && !run.home.own) E.moveHome(run, 'room', 'inner');
      E.setHolding(run, 'index', run.h.index + Math.max(0, run.cash));
    },
    events: chooseRandom,
  },
  indexOnly: { play: (run) => { E.setHolding(run, 'index', run.h.index + Math.max(0, run.cash)); }, events: chooseRandom },
  balancedLife: {
    play: (run) => {
      E.setLife(run, 1);
      E.setPlan(run, { pyf: 0.2, mix: E.passive(run).total > 0.7 * E.bowl(run) ? 'defensive' : 'balanced', rebalance: true });
      if (run.giving < 0.05) E.setGiving(run, 0.05);
      if (run.kids.length && E.HOMES[run.home.id].beds < 2 && !run.home.own) E.moveHome(run, 'flat2', run.home.district);
      run.kids.forEach((k, i) => { const open = E.schoolsOpen(run); E.setSchool(run, i, open[Math.min(open.length - 1, 2)]); });
      invest(run, 0.3 * E.costs(run));
    },
    events: chooseWise,
  },
  familyFirst: {
    play: (run) => {
      E.setLife(run, 2);
      E.setPlan(run, { pyf: 0.15, mix: E.passive(run).total > 0.7 * E.bowl(run) ? 'defensive' : 'balanced', rebalance: true });
      if (run.giving < 0.05) E.setGiving(run, 0.05);
      if (run.partner && run.home.id !== 'flat2' && !run.home.own) E.moveHome(run, 'flat2', 'gated');
      run.kids.forEach((k, i) => { const open = E.schoolsOpen(run); E.setSchool(run, i, open[open.length - 1]); });
      invest(run, 0.3 * E.costs(run));
    },
    events: chooseWise,
  },
  crypto: { play: (run) => { E.setHolding(run, 'crypto', run.h.crypto + Math.max(0, run.cash)); }, events: chooseRandom },
};

for (const currency of ['NGN', 'USD']) {
  for (const [name, bot] of Object.entries(bots)) {
    const out = { free: 0, clock: 0, bankrupt: 0 };
    const ages = []; let score = 0; let nan = 0; let wins = 0; const starsAll = [];
    for (let i = 0; i < N; i++) {
      const run = E.newRun({ mode: 'classic', char: 'graduate', currency, seed: `sim${i}` });
      let res = null;
      while (!res) {
        if (E.canAct(run)) bot.play(run);
        E.live(run);
        if (run.phase === 'event') bot.events(run);
        E.makeOffer(run, unlocked);
        res = E.pickCard(run, run.offer[0]);
      }
      if (!Number.isFinite(res.nw)) nan++;
      out[res.reason]++; score += res.score; if (res.reason === 'free') ages.push(res.age);
      starsAll.push(res.life.stars);
      if (res.reason === 'free' && res.life.stars >= 4) wins++;
    }
    ages.sort((a, b) => a - b);
    const avgStars = starsAll.reduce((s, x) => s + x, 0) / N;
    console.log(currency, name.padEnd(13), JSON.stringify(out), 'free@', ages[ages.length >> 1] ?? '-', 'stars', avgStars.toFixed(2), 'win4★', `${Math.round((wins / N) * 100)}%`, 'score', Math.round(score / N), nan ? `NaN:${nan}` : '');
  }
}
