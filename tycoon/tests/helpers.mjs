// Shared test helpers: play a whole life with a simple bot.
import * as E from '../js/engine.js';

// Answer the pending message: try choices in order, skipping any that need
// cash you don't have, and re-read the event after "Ask questions".
export function decide(run, start = 0) {
  // start can be a function of the run, to answer some messages differently.
  let ci = typeof start === 'function' ? start(run) : start;
  for (let g = 0; run.pending && g < 24; g++) {
    const out = E.chooseEvent(run, ci);
    ci = out === E.AGAIN ? 0 : (ci + 1) % 8;
  }
}

export function play(opts, bot = () => {}, pick = 0) {
  const run = E.newRun(opts);
  let res = null;
  decide(run, pick);
  for (let guard = 0; !res && guard < 90; guard++) {
    if (E.canAct(run)) bot(run);
    if (run.learnMode && run.think) E.setForecast(run, E.upOdds(run).ideal);
    const y = E.live(run);
    if (!y) throw new Error(`live() refused at turn ${run.turn}, pending ${run.pending && run.pending.id}`);
    res = y.result || null;
    if (!res) decide(run, pick);
  }
  return { run, res };
}
