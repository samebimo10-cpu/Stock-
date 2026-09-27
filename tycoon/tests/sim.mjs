// Balance runs: plays many seeds with simple bot strategies and prints outcomes.
// node tycoon/tests/sim.mjs [runs]
import * as E from '../js/engine.js';

const N = Number(process.argv[2] || 400);
const unlocked = E.unlockedCards(0).filter((id) => !['ponzi', 'mlm', 'leverage'].includes(id));

const bots = {
  hoarder: () => {},
  saver: (run) => { E.setHolding(run, 'save', run.h.save + Math.max(0, run.cash)); },
  balanced: (run) => {
    const spare = Math.max(0, run.cash - 0.3 * E.costs(run));
    if (run.h.save < E.costs(run)) { const x = Math.min(spare, E.costs(run) - run.h.save); E.setHolding(run, 'save', run.h.save + x); }
    const rest = Math.max(0, run.cash - 0.3 * E.costs(run));
    E.setHolding(run, 'index', run.h.index + rest * 0.7);
    if (rest > 0) E.buyProperty(run, rest * 0.3, false);
  },
  frugalIndex: (run) => {
    E.setLife(run, 0);
    const rest = Math.max(0, run.cash);
    E.setHolding(run, 'index', run.h.index + rest);
  },
  crypto: (run) => { E.setHolding(run, 'crypto', run.h.crypto + Math.max(0, run.cash)); },
};

for (const currency of ['NGN', 'USD']) {
  for (const [name, bot] of Object.entries(bots)) {
    const out = { free: 0, clock: 0, bankrupt: 0 }; const ages = []; let score = 0; let nan = 0;
    for (let i = 0; i < N; i++) {
      const run = E.newRun({ mode: 'classic', char: 'graduate', currency, seed: `sim${i}` });
      let res = null;
      while (!res) {
        if (E.canAct(run)) bot(run);
        E.live(run);
        let ci = name === 'hoarder' ? 2 : 0; while (run.phase === 'event' && E.chooseEvent(run, ci) === null && ci < 3) ci = (ci + 1) % 3;
        E.makeOffer(run, unlocked);
        res = E.pickCard(run, run.offer[0]);
      }
      if (!Number.isFinite(res.nw)) nan++;
      out[res.reason]++; score += res.score; if (res.reason === 'free') ages.push(res.age);
    }
    ages.sort((a, b) => a - b);
    console.log(currency, name.padEnd(12), JSON.stringify(out), 'medianFreeAge', ages[ages.length >> 1] ?? '-', 'avgScore', Math.round(score / N), nan ? `NaN:${nan}` : '');
  }
}
