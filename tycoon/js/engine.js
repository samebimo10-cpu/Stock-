// Tycoon Rush rules. No DOM in here, so Node can run it for tests and balance runs.
//
// The whole market path (moods, inflation, rates, returns, headlines) is generated
// up front from the seed. The player's choices never draw from that stream, so a
// Daily Market or a Duel code gives everyone exactly the same years.

import {
  CURRENCIES, LIFESTYLES, CHARACTERS, ASSETS, COMPANIES, NEWS, SWANS, CARDS, EVENTS,
  ERAS, CHALLENGES, GLOSSARY,
} from './content.js';

// ---------------------------------------------------------------- randomness

export function hashStr(s) {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export function makeRng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.normal = () => {
    const u = Math.max(1e-9, r());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  };
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.weighted = (obj) => {
    const keys = Object.keys(obj);
    let x = r() * keys.reduce((s, k) => s + obj[k], 0);
    for (const k of keys) { x -= obj[k]; if (x <= 0) return k; }
    return keys[keys.length - 1];
  };
  return r;
}

export const rngFor = (seed, tag, t) => makeRng(hashStr(`${seed}|${tag}|${t}`));

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ---------------------------------------------------------------- formatting

export function fmt(n, currency = 'USD', signed = false) {
  const sym = CURRENCIES[currency].sym;
  const a = Math.abs(n);
  const units = [[1e15, 'Qa'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']];
  let body = String(Math.round(a));
  for (const [v, u] of units) {
    if (a >= v) {
      const x = a / v;
      body = (x >= 100 ? x.toFixed(0) : x.toFixed(1)) + u;
      break;
    }
  }
  const sign = n < 0 ? '−' : signed ? '+' : '';
  return `${sign}${sym}${body}`;
}

export const pct = (x, digits = 0) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(digits)}%`;

// ---------------------------------------------------------------- market model

export const MOODS = ['boom', 'steady', 'over', 'crash', 'recov'];

function transitions(state, asc) {
  const t = {
    steady: { steady: 0.45, boom: 0.33, over: 0.1, crash: 0.12 },
    boom: { boom: 0.35, over: 0.38, steady: 0.2, crash: 0.07 },
    over: { crash: 0.55, over: 0.2, steady: 0.15, boom: 0.1 },
    crash: { recov: 0.68, crash: 0.2, steady: 0.12 },
    recov: { steady: 0.4, boom: 0.45, recov: 0.15 },
  }[state];
  if (asc >= 3 && state !== 'crash') return { ...t, crash: (t.crash || 0) + 0.06 };
  return t;
}

// Real (after-inflation) return over one 2-year turn: [mean, spread].
const REAL = {
  index: { boom: [0.26, 0.1], steady: [0.1, 0.09], over: [0.16, 0.13], crash: [-0.32, 0.1], recov: [0.3, 0.12] },
  prop: { boom: [0.08, 0.05], steady: [0.03, 0.04], over: [0.15, 0.06], crash: [-0.15, 0.06], recov: [0.02, 0.05] },
  crypto: { boom: [0.6, 0.5], steady: [-0.05, 0.35], over: [0.8, 0.7], crash: [-0.6, 0.12], recov: [0.3, 0.45] },
};
const BIZ_MOOD = { boom: 1.3, steady: 1, over: 1.1, crash: 0.45, recov: 0.9 };
const INFL_MOOD = { boom: 0.006, steady: 0, over: 0.015, crash: -0.01, recov: -0.004 };

function policyRate(infl, state, naira) {
  if (naira) return clamp(infl - 0.035 + (state === 'over' ? 0.02 : 0) - (state === 'recov' ? 0.01 : 0), 0.04, 0.4);
  return clamp(infl + 0.008 + (state === 'over' ? 0.012 : 0) - (state === 'crash' ? 0.015 : 0), 0.0025, 0.2);
}

export function genMarket({ seed, turns, ypt, currency, asc = 0, era = null }) {
  const r = makeRng(hashStr(`${seed}|market`));
  const naira = currency === 'NGN';
  const k = ypt / 2;
  const sk = Math.sqrt(k);
  const grow = ([m, sd]) => Math.pow(Math.max(0.05, 1 + m + sd * r.normal()), k) - 1;
  const meanInfl = (naira ? 0.17 : 0.03) + (asc >= 1 ? (naira ? 0.02 : 0.01) : 0);
  let infl = meanInfl;
  let state = era ? era.states[0] : r.weighted({ steady: 0.5, boom: 0.25, recov: 0.25 });
  let rate = policyRate(infl, state, naira);
  let forceCrash = false;
  const out = [];

  for (let t = 0; t < turns; t++) {
    if (t > 0) state = era ? era.states[t] : forceCrash ? 'crash' : r.weighted(transitions(state, asc));
    forceCrash = false;
    const adj = (era && era.adj && era.adj[t]) || {};

    let swan = null;
    const swanP = 0.02 * (asc >= 9 ? 2 : 1) * k;
    const swanRoll = r();
    const swanPick = r();
    if (!era && t > 1 && swanRoll < swanP) {
      const pool = SWANS.filter((s) => !s.ngn || naira);
      swan = pool[Math.floor(swanPick * pool.length)];
      if (swan.state) state = swan.state;
      if (swan.id === 'mania') forceCrash = true;
    }

    infl = clamp(
      meanInfl + 0.5 * (infl - meanInfl) + r.normal() * (naira ? 0.03 : 0.008)
        + INFL_MOOD[state] * (naira ? 2 : 1) + ((swan && swan.infl) || 0) + (adj.infl || 0),
      naira ? 0.05 : -0.01, naira ? 0.7 : 0.18,
    );
    const newRate = policyRate(infl, state, naira);
    const dRate = newRate - rate;
    rate = newRate;

    const idxReal = grow(REAL.index[state]) - 2.5 * dRate + ((swan && swan.index) || 0) + (adj.index || 0);
    const propReal = grow(REAL.prop[state]) - 2 * dRate + ((swan && swan.prop) || 0) + (adj.prop || 0);
    let cryReal = grow(REAL.crypto[state]) + ((swan && swan.crypto) || 0) + (adj.crypto || 0);
    const rugRoll = r();
    if (rugRoll < 0.05 * k) cryReal = Math.min(cryReal, -0.85);

    const coNewsRoll = r();
    const coPick = Math.floor(r() * COMPANIES.length);
    const coDir = r() < 0.5 ? 1 : -1;
    const coSize = 0.2 + r() * 0.25;
    const companyNews = coNewsRoll < 0.55 ? { co: coPick, dir: coDir, size: coSize } : null;
    const stockReal = COMPANIES.map((c, i) => {
      let x = c.beta * idxReal + (Math.pow(Math.max(0.05, 1 + c.alpha + c.idio * r.normal()), k) - 1);
      if (companyNews && companyNews.co === i) x += companyNews.dir * companyNews.size;
      if (adj.co && adj.co[i] != null) x += adj.co[i];
      return x;
    });

    const bizMult = BIZ_MOOD[state] * Math.max(0.2, 1 + 0.15 * r.normal());
    const hustle = Math.exp(r.normal() * sk * 0.5 - 0.06);

    let fxDev = 0;
    let devJump = false;
    const devRoll = r();
    const devNoise = r.normal();
    if (naira) {
      const perYear = infl - 0.03 + 0.04 * devNoise;
      fxDev = Math.pow(Math.max(0.5, 1 + perYear), ypt) - 1;
      devJump = devRoll < 0.1 * k || !!(adj.dev) || !!(swan && swan.dev);
      if (devJump) fxDev = (1 + fxDev) * (1 + (adj.dev || (swan && swan.dev) || 0.3)) - 1;
    }

    const toNom = (x) => Math.max(-0.99, (1 + x) * Math.pow(1 + infl, ypt) - 1);
    const m = {
      t, state, infl, rate, dRate, swan: swan && swan.id,
      ret: {
        save: Math.pow(1 + rate, ypt) - 1,
        index: toNom(idxReal),
        prop: toNom(propReal),
        crypto: Math.max(-0.97, toNom(cryReal)),
        stocks: stockReal.map(toNom),
        fx: naira ? Math.pow(1.04, ypt) * (1 + fxDev) - 1 : 0,
      },
      fxDev, bizMult, hustle, companyNews, devJump, rug: rugRoll < 0.05 * k,
    };
    m.news = genNews(r, m, naira, asc);
    out.push(m);
  }
  return out;
}

function genNews(r, m, naira, asc) {
  const items = [];
  const others = MOODS.filter((s) => s !== m.state);
  // Slot 1: the market mood. Usually honest.
  if (r() < 0.8) items.push({ kind: 'signal', real: true, text: r.pick(NEWS[m.state]) });
  else items.push({ kind: 'signal', real: false, text: r.pick(NEWS[r.pick(others)]) });
  // Slot 2: currency, a company, or interest rates.
  const honest = r() < 0.8;
  if (m.devJump && naira) {
    items.push({ kind: 'signal', real: true, tag: 'fx', text: r.pick(NEWS.fx) });
  } else if (m.companyNews) {
    const cn = m.companyNews;
    const dir = honest ? cn.dir : -cn.dir;
    items.push({ kind: 'signal', real: honest, tag: 'co', text: r.pick(dir > 0 ? NEWS.coUp : NEWS.coDown).replace('{co}', COMPANIES[cn.co].name) });
  } else {
    let key = m.dRate > 0.004 ? 'rateUp' : m.dRate < -0.004 ? 'rateDown' : 'rateHold';
    if (!honest) key = key === 'rateUp' ? 'rateDown' : 'rateUp';
    items.push({ kind: 'signal', real: honest, tag: 'rate', text: r.pick(NEWS[key]) });
  }
  // Slot 3: a trap, noise, or a second honest signal.
  const x = r();
  const trapP = asc >= 6 ? 0.32 : 0.2;
  if (x < trapP) items.push({ kind: 'trap', real: false, text: r.pick(NEWS.trap) });
  else if (x < trapP + 0.45) items.push({ kind: 'noise', real: false, text: r.pick(NEWS.noise) });
  else {
    const pool = NEWS[m.state].filter((s) => s !== items[0].text);
    items.push({ kind: 'signal', real: true, text: r.pick(pool) });
  }
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// ---------------------------------------------------------------- run setup

export const MODES = {
  classic: { name: 'Classic', ypt: 2, startAge: 22, timer: 0 },
  blitz: { name: 'Blitz', ypt: 4, startAge: 24, timer: 15 },
  daily: { name: 'Daily Market', ypt: 2, startAge: 22, timer: 0 },
  duel: { name: 'Duel', ypt: 2, startAge: 22, timer: 0 },
  era: { name: 'Eras', ypt: 2, startAge: 22, timer: 0 },
  weekly: { name: 'Weekly Challenge', ypt: 2, startAge: 22, timer: 0 },
};

export function newRun(opts) {
  const mode = MODES[opts.mode] || MODES.classic;
  const era = opts.eraId ? ERAS.find((e) => e.id === opts.eraId) : null;
  const ch = opts.challengeId ? CHALLENGES.find((c) => c.id === opts.challengeId) : null;
  const c = CHARACTERS[opts.char] || CHARACTERS.graduate;
  const asc = opts.asc || 0;
  const currency = era ? era.currency : opts.currency || 'NGN';
  const scale = CURRENCIES[currency].scale;
  const startAge = era ? era.startAge : ch && ch.startAge ? ch.startAge : mode.startAge;
  const ypt = mode.ypt;
  const deadline = asc >= 12 ? 56 : 60;
  const turns = era ? era.states.length : Math.max(3, Math.round((deadline - startAge) / ypt));
  const seed = String(opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9));

  const run = {
    v: 1, seed, mode: opts.mode || 'classic', char: opts.char || 'graduate', currency, asc,
    eraId: era ? era.id : null, challengeId: ch ? ch.id : null,
    ypt, turns, startAge, age: startAge, turn: 0, phase: 'alloc',
    salary: c.salary * scale * (ch && ch.salaryMult ? ch.salaryMult : 1),
    baseCosts: c.costs * scale * (asc >= 10 ? 1.1 : 1),
    costMult: 1,
    life: ch && ch.lockLife != null ? ch.lockLife : c.life,
    startLife: ch && ch.lockLife != null ? ch.lockLife : c.life,
    joy: c.joy != null ? c.joy : 60,
    cash: c.cash * scale * (asc >= 4 ? 0.5 : 1) * (ch && ch.cashMult ? ch.cashMult : 1),
    h: {
      save: 0, index: 0, stocks: COMPANIES.map(() => 0), crypto: (c.crypto || 0) * scale, fx: 0,
      prop: { v: 0, debt: 0, bought: -1 },
      biz: { c: ((c.biz || 0) + ((ch && ch.biz) || 0)) * scale, managed: false, profit: 0 },
      ponzi: null, angel: null, scam: 0,
    },
    cards: [], charges: {}, lev: 0,
    flags: { weather: c.weather || 1 },
    prices: 1, infl: currency === 'NGN' ? 0.17 : 0.03, rate: 0,
    px: { save: [1], index: [1], stocks: [1], prop: [1], crypto: [1], biz: [1], fx: [1] },
    last: {},
    market: [],
    hist: [], seenEv: [], learned: [], reveal: {}, crystal: {},
    log: { panic: 0, panicAge: 0, scam: 0, idle: 0, conc: 0, concAge: 0, concAsset: '', creep: 0, debt: 0, best: 0, bestAge: 0, bestAsset: '', growth: 1, years: 0, efund: 0, trapTaps: 0 },
    negTurns: 0, lastResult: null, pending: null, offer: null, result: null,
    flow: { buy: {}, sell: {} },
    salaryStart: c.salary * scale,
  };
  run.market = genMarket({ seed, turns, ypt, currency, asc, era });
  run.rate = policyRate(run.infl, 'steady', currency === 'NGN');
  run.h.biz.profit = bizProfit(run, 1);
  learn(run, 'freedom');
  run.hist.push(snapshot(run));
  return run;
}

// ---------------------------------------------------------------- read helpers

export const has = (run, id) => run.cards.includes(id);
export const era = (run) => (run.eraId ? ERAS.find((e) => e.id === run.eraId) : null);
export const challenge = (run) => (run.challengeId ? CHALLENGES.find((c) => c.id === run.challengeId) : null);
export const atSea = (run) => !!CHARACTERS[run.char].sailor && run.turn % 2 === 1;
export const lifeLocked = (run) => { const ch = challenge(run); return !!(ch && ch.lockLife != null); };

export function isOpen(run, asset) {
  if (asset === 'fx' && run.currency !== 'NGN') return false;
  const ch = challenge(run);
  return !(ch && ch.off && ch.off.includes(asset));
}

export function costs(run) {
  return run.baseCosts * LIFESTYLES[run.life].mult * run.costMult * (has(run, 'frugal_genius') ? 0.9 : 1);
}

export const stocksTotal = (run) => run.h.stocks.reduce((s, x) => s + x, 0);

export function holdings(run) {
  const h = run.h;
  return {
    save: h.save, index: h.index, stocks: stocksTotal(run), prop: h.prop.v - h.prop.debt,
    crypto: h.crypto, biz: h.biz.c, fx: h.fx,
  };
}

export function netWorth(run) {
  const h = run.h;
  return run.cash + h.save + h.index + stocksTotal(run) + h.crypto + h.fx + h.prop.v - h.prop.debt
    + h.biz.c + (h.ponzi ? h.ponzi.v : 0) + (h.angel ? h.angel.amt : 0) + (h.scam || 0);
}

export const rentYield = (run) => (run.currency === 'NGN' ? 0.06 : 0.05) * (has(run, 'landlord') ? 1.25 : 1);
export const mortRate = (run) => run.rate + 0.03;
export const debtRate = (run) => run.rate + 0.15;
export const bizManaged = (run) => run.h.biz.managed || has(run, 'manager_pro');

export function bizProfit(run, mood) {
  const c = run.h.biz.c;
  if (c <= 0) return 0;
  const K = 12 * 24000 * CURRENCIES[run.currency].scale * run.prices;
  let p = c * 0.18 * mood / (1 + c / K);
  if (has(run, 'franchise')) p *= 1.3;
  if (has(run, 'golden_goose')) p *= 2;
  if (run.h.biz.managed && !has(run, 'manager_pro')) p *= 0.75;
  return p;
}

// Passive income a year: 4% of investments, rent, and a managed business,
// minus what your debts cost. Crypto pays nothing, so it only counts once sold
// into something that does.
export function passive(run) {
  const h = run.h;
  const invest = 0.04 * (h.save + h.index + stocksTotal(run) + h.fx);
  const rent = h.prop.v * rentYield(run);
  const mort = h.prop.debt * mortRate(run);
  const debt = run.cash < 0 ? -run.cash * debtRate(run) : 0;
  const biz = bizManaged(run) ? h.biz.profit : 0;
  let total = invest + rent + biz - mort - debt;
  if (has(run, 'tax_smart') && total > 0) total *= 1.1;
  return { invest, rent, biz, mort, debt, total };
}

export const freedomNumber = (run) => 25 * costs(run);

function snapshot(run) {
  return { age: run.age, nw: netWorth(run), passive: passive(run).total, costs: costs(run), fn: freedomNumber(run), state: run.turn > 0 ? run.market[run.turn - 1].state : null };
}

export function learn(run, id) {
  if (GLOSSARY[id] && !run.learned.includes(id)) run.learned.push(id);
}

// ---------------------------------------------------------------- player actions

const feeFor = (run, asset) => ASSETS[asset].fee * (run.asc >= 7 ? 2 : 1);

export function canAct(run) {
  return run.phase === 'alloc' && !atSea(run);
}

// Move a liquid holding (savings, index, crypto, fx, or one company) to `target`.
export function setHolding(run, asset, target, co = null) {
  if (!canAct(run) || !isOpen(run, asset)) return 0;
  const cur = co == null ? run.h[asset] : run.h.stocks[co];
  target = Math.max(0, target);
  const diff = target - cur;
  if (Math.abs(diff) < Math.max(1e-6, cur * 0.001)) return 0;
  const fee = feeFor(run, asset);
  if (diff > 0) {
    const spend = Math.min(diff, Math.max(0, run.cash));
    if (spend <= 0) return 0;
    run.cash -= spend;
    const got = asset === 'fx' ? spend * (1 - fee) : spend;
    if (co == null) run.h[asset] += got; else run.h.stocks[co] += got;
    run.flow.buy[asset] = (run.flow.buy[asset] || 0) + spend;
    if (asset === 'index') learn(run, 'index');
    if (asset === 'crypto') learn(run, 'volatility');
    return spend;
  }
  const amt = -diff;
  if (co == null) run.h[asset] -= amt; else run.h.stocks[co] -= amt;
  run.cash += amt * (1 - fee);
  run.flow.sell[asset] = (run.flow.sell[asset] || 0) + amt;
  return -amt;
}

export function buyProperty(run, equity, mortgage) {
  if (!canAct(run) || !isOpen(run, 'prop')) return false;
  equity = Math.min(equity, Math.max(0, run.cash));
  if (equity <= 0) return false;
  const value = mortgage ? equity / 0.3 : equity;
  run.cash -= equity;
  run.h.prop.v += value * 0.97;
  run.h.prop.debt += value - equity;
  run.h.prop.bought = run.turn;
  run.flow.buy.prop = (run.flow.buy.prop || 0) + equity;
  if (mortgage) { learn(run, 'mortgage'); learn(run, 'leverage'); }
  learn(run, 'passive');
  return true;
}

export const propLocked = (run) => run.h.prop.bought === run.turn;

export function sellProperty(run, frac) {
  if (!canAct(run) || propLocked(run)) return false;
  const p = run.h.prop;
  const v = p.v * frac;
  const d = p.debt * frac;
  p.v -= v; p.debt -= d;
  run.cash += v * (1 - feeFor(run, 'prop')) - d;
  run.flow.sell.prop = (run.flow.sell.prop || 0) + v;
  learn(run, 'liquidity');
  return true;
}

export function repayMortgage(run, amt) {
  if (!canAct(run)) return false;
  amt = Math.min(amt, Math.max(0, run.cash), run.h.prop.debt);
  if (amt <= 0) return false;
  run.cash -= amt; run.h.prop.debt -= amt;
  return true;
}

export function investBiz(run, amt) {
  if (!canAct(run) || !isOpen(run, 'biz')) return false;
  amt = Math.min(amt, Math.max(0, run.cash));
  if (amt <= 0) return false;
  run.cash -= amt; run.h.biz.c += amt;
  run.h.biz.profit = bizProfit(run, 1);
  run.flow.buy.biz = (run.flow.buy.biz || 0) + amt;
  return true;
}

export const managerCost = (run) => 0.5 * run.salary;

export function hireManager(run) {
  if (!canAct(run) || run.h.biz.managed || run.h.biz.c <= 0) return false;
  const cost = managerCost(run);
  if (run.cash < cost) return false;
  run.cash -= cost;
  run.h.biz.managed = true;
  run.h.biz.profit = bizProfit(run, 1);
  learn(run, 'passive');
  return true;
}

export function sellBiz(run) {
  if (!canAct(run) || run.h.biz.c <= 0) return false;
  run.cash += run.h.biz.c * 0.6;
  run.flow.sell.biz = run.h.biz.c;
  run.h.biz = { c: 0, managed: false, profit: 0 };
  learn(run, 'liquidity');
  return true;
}

export function exitPonzi(run) {
  if (!canAct(run) || !run.h.ponzi) return false;
  // Early members can get out, minus "exit fees". That is how the scheme recruits.
  run.cash += run.h.ponzi.v * 0.7;
  run.h.ponzi = null;
  learn(run, 'ponzi');
  return true;
}

export function setLife(run, lv) {
  if (!canAct(run) || lifeLocked(run)) return false;
  run.life = clamp(lv, 0, LIFESTYLES.length - 1);
  if (run.life > run.startLife) learn(run, 'creep');
  return true;
}

export function takeTrap(run, i) {
  if (run.phase !== 'alloc') return 0;
  const n = run.market[run.turn].news[i];
  if (!n || n.kind !== 'trap' || n.taken) return 0;
  const amt = Math.max(0, run.cash) * 0.25;
  if (amt <= 0) return 0;
  run.cash -= amt;
  run.h.scam = (run.h.scam || 0) + amt;
  n.taken = true;
  run.log.trapTaps += 1;
  return amt;
}

export function useTool(run, tool) {
  if (run.phase !== 'alloc' || !(run.charges[tool] > 0)) return false;
  if (tool === 'insider' && run.reveal[run.turn]) return false;
  if (tool === 'crystal' && run.crystal[run.turn]) return false;
  run.charges[tool] -= 1;
  if (tool === 'insider') run.reveal[run.turn] = true;
  if (tool === 'crystal') run.crystal[run.turn] = true;
  return true;
}

export const newsRevealed = (run, item) => {
  if (has(run, 'oracle') || run.reveal[run.turn]) return true;
  if (item.tag === 'rate' && has(run, 'rate_watcher')) return true;
  if (item.tag === 'co' && has(run, 'analyst')) return true;
  return false;
};

// ---------------------------------------------------------------- event helpers

function helpers(run, r) {
  const h = {
    r, f: (n) => fmt(n, run.currency),
    has: (id) => has(run, id),
    cash: (n) => { run.cash += n; },
    joy: (n) => { run.joy = clamp(run.joy + n, has(run, 'stoic') ? 30 : 0, 100); },
    salary: (k) => { run.salary *= k; },
    life: (d) => { if (!lifeLocked(run)) run.life = clamp(run.life + d, 0, LIFESTYLES.length - 1); },
    costMult: (k) => { run.costMult *= k; },
    flag: (k, v = true) => { run.flags[k] = v; },
    marry: () => { run.flags.married = true; run.salary *= 1.35; run.costMult *= 1.3; },
    kid: () => { run.flags.kids = (run.flags.kids || 0) + 1; },
    term: (id) => learn(run, id),
    scam: (n) => { run.log.scam += n / run.salary; run.flags.scammed = true; learn(run, 'ponzi'); },
    add: (asset, n) => {
      if (asset === 'biz') { run.h.biz.c += n; run.h.biz.profit = bizProfit(run, 1); } else run.h[asset] += n;
    },
    scale: (asset, k) => {
      if (asset === 'biz') { run.h.biz.c *= k; run.h.biz.profit = bizProfit(run, 1); } else run.h[asset] *= k;
    },
    buyProp: (worth) => { run.h.prop.v += worth; run.h.prop.bought = run.turn; learn(run, 'passive'); },
    angel: (amt) => { run.cash -= amt; run.h.angel = { amt, t0: run.turn }; },
    // A bill. With a year of costs in savings the fund absorbs it at a discount;
    // without one, the cash may go negative, which is high-interest debt.
    expense: (n, raw = false) => {
      let amt = n * (run.asc >= 2 && !raw ? 1.15 : 1);
      const c = costs(run);
      if (!raw && run.h.save >= c) {
        const cut = has(run, 'efund_pro') ? 0.4 : 0.2;
        const saved = amt * cut;
        amt -= saved;
        const fromSave = Math.min(run.h.save, amt);
        run.h.save -= fromSave;
        run.cash -= amt - fromSave;
        run.log.efund += saved;
        learn(run, 'efund');
        return `Your emergency fund covered it and saved you ${h.f(saved)}.`;
      }
      run.cash -= amt;
      if (run.cash < 0) { learn(run, 'debt'); learn(run, 'efund'); return 'You had to borrow at a high interest rate to pay.'; }
      return '';
    },
  };
  return h;
}

export function eventView(run) {
  if (!run.pending) return null;
  const ev = EVENTS.find((e) => e.id === run.pending.id);
  const h = helpers(run, () => 0.5);
  const v = run.pending.v;
  return {
    id: ev.id, cat: ev.cat, title: ev.title,
    text: ev.text(v, h, run),
    choices: ev.choices.map((c) => ({
      label: typeof c.label === 'function' ? c.label(v, h) : c.label,
      note: c.note || '',
      ok: !c.need || c.need(run, v),
    })),
  };
}

function drawEvent(run) {
  const m = run.market[run.turn];
  const r = rngFor(run.seed, 'ev', run.turn);
  if (m.devJump && run.currency === 'NGN') return 'deval';
  if (run.joy < 20 && r() < 0.65) return 'burnout';
  const recent = run.seenEv.slice(-5);
  const pool = {};
  for (const e of EVENTS) {
    if (e.forced || recent.includes(e.id)) continue;
    if (e.once && run.seenEv.includes(e.id)) continue;
    if (e.cond && !e.cond(run)) continue;
    pool[e.id] = e.w * (e.id === 'promo' && has(run, 'networker') ? 2 : 1);
  }
  return r.weighted(pool);
}

// ---------------------------------------------------------------- the turn

const RISKY = ['index', 'stocks', 'crypto'];

// Two (or four) years pass. Returns what happened for the play-out screen.
export function live(run) {
  if (run.phase !== 'alloc') return null;
  const t = run.turn;
  const m = run.market[t];
  const y = run.ypt;
  const h = run.h;
  const c = CHARACTERS[run.char];
  const prev = t > 0 ? run.market[t - 1].state : null;
  const before = holdings(run);
  const nw0 = netWorth(run);
  const res = { t, age0: run.age, age1: run.age + y, state: m.state, swan: m.swan, rows: [], flows: [], notes: [], nw0 };

  // Salary and living costs over the period.
  const drift = Math.pow(1 + m.infl, (y - 1) / 2);
  let pay = run.salary * y * drift;
  if (c.volatile) pay *= m.hustle;
  if (m.swan === 'pandemic' && !has(run, 'remote_job')) pay *= 0.7;
  const spend = costs(run) * y * drift;
  run.cash += pay - spend;
  res.flows.push({ label: 'Salary', v: pay }, { label: 'Living costs', v: -spend });
  run.log.creep += Math.max(0, costs(run) - costs({ ...run, life: run.startLife })) * y / run.salary;

  // Market returns, bent by cards.
  const soldRisk = RISKY.some((a) => (run.flow.sell[a] || 0) > 0);
  const adj = (x, asset) => {
    if (RISKY.includes(asset)) {
      if (run.lev > 0) x *= 2;
      if (asset === 'crypto' && has(run, 'degen')) x *= 1.5;
      if (asset !== 'crypto' && has(run, 'dividend')) x = (1 + x) * Math.pow(1.01, y) - 1;
      if (asset === 'index' && m.state === 'crash' && has(run, 'bs_hedge')) x = 0.15;
      if (x < 0 && m.state === 'crash' && has(run, 'diamond_hands') && !soldRisk) x /= 2;
    }
    return Math.max(-0.99, x);
  };
  const saveRet = has(run, 'compound') ? Math.pow(1 + m.rate + 0.02, y) - 1 : m.ret.save;
  const gains = {};
  gains.save = h.save * saveRet; h.save += gains.save;
  gains.index = h.index * adj(m.ret.index, 'index'); h.index += gains.index;
  gains.stocks = 0;
  h.stocks = h.stocks.map((v, i) => { const g = v * adj(m.ret.stocks[i], 'stocks'); gains.stocks += g; return v + g; });
  gains.crypto = h.crypto * adj(m.ret.crypto, 'crypto'); h.crypto += gains.crypto;
  gains.fx = h.fx * m.ret.fx; h.fx += gains.fx;
  gains.prop = h.prop.v * m.ret.prop; h.prop.v += gains.prop;

  if (prev === 'crash' && has(run, 'contrarian')) {
    const bonus = 0.12 * ((run.flow.buy.index || 0) + (run.flow.buy.stocks || 0));
    if (bonus > 0) { h.index += bonus; gains.index += bonus; res.notes.push(`Contrarian bonus: ${fmt(bonus, run.currency, true)} for buying after the crash.`); }
  }
  if (prev === 'crash' && ((run.flow.buy.index || 0) + (run.flow.buy.stocks || 0)) > 0) learn(run, 'dip');

  // Rent, mortgage interest, business profit, debt interest.
  if (h.prop.v > 0) {
    const rent = h.prop.v * rentYield(run) * y;
    const mort = h.prop.debt * mortRate(run) * y;
    run.cash += rent - mort;
    res.flows.push({ label: 'Rent', v: rent });
    if (mort > 0) res.flows.push({ label: 'Mortgage interest', v: -mort });
  }
  if (h.biz.c > 0) {
    const prof = bizProfit(run, m.bizMult);
    h.biz.profit = prof;
    run.cash += prof * y;
    res.flows.push({ label: bizManaged(run) ? 'Business profit' : 'Business profit (your time)', v: prof * y });
    const before$ = h.biz.c;
    h.biz.c *= Math.pow((1 - 0.07) * (1 + m.infl), y);
    gains.biz = h.biz.c - before$;
    if (!bizManaged(run)) run.joy -= 3;
  }
  if (run.cash < 0) {
    const interest = -run.cash * (Math.pow(1 + debtRate(run), y) - 1);
    run.cash -= interest;
    run.log.debt += interest / run.salary;
    res.flows.push({ label: 'Debt interest', v: -interest });
    learn(run, 'debt');
  }

  // Scams and side bets resolve.
  if (h.scam > 0) {
    res.notes.push(`The "investment" website is gone. ${fmt(h.scam, run.currency)} lost to a scam.`);
    run.log.scam += h.scam / run.salary;
    run.flags.scammed = true;
    learn(run, 'ponzi');
    h.scam = 0;
  }
  if (h.ponzi) {
    if (h.ponzi.age < 2) {
      h.ponzi.v *= 1.3; h.ponzi.age += 1;
      res.notes.push(`Golden Circle Club paid 30% again. Your balance: ${fmt(h.ponzi.v, run.currency)}.`);
    } else {
      res.notes.push(`Golden Circle Club collapsed. New members stopped joining, and ${fmt(h.ponzi.v, run.currency)} vanished.`);
      run.log.scam += h.ponzi.paid / run.salary;
      run.flags.scammed = true;
      learn(run, 'ponzi');
      h.ponzi = null;
    }
  }
  if (h.angel && t - h.angel.t0 >= 3) {
    const r = rngFor(run.seed, 'angel', t)();
    const mult = r < 0.15 ? 12 : r < 0.4 ? 1.5 : 0;
    run.cash += h.angel.amt * mult;
    res.notes.push(mult === 12 ? `The startup was bought by a giant. Your stake pays ${fmt(h.angel.amt * mult, run.currency)}!`
      : mult ? `The startup was sold for a modest profit: ${fmt(h.angel.amt * mult, run.currency)}.` : 'The startup ran out of money and shut down. Your stake is worth nothing.');
    h.angel = null;
  }
  if (m.rug && h.crypto > 0) res.notes.push('A major coin turned out to be a fraud and crypto prices collapsed.');

  // Rows for the play-out screen, and the log behind "biggest win" and "worst mistake".
  const after = holdings(run);
  for (const a of Object.keys(ASSETS)) {
    const b = a === 'prop' ? h.prop.v - gains.prop : before[a];
    if (!(b > 0) || gains[a] == null) continue;
    const g = gains[a];
    res.rows.push({ id: a, before: before[a], after: after[a], pct: g / b, gain: g });
    const inSal = g / run.salary;
    if (inSal > run.log.best) { run.log.best = inSal; run.log.bestAge = run.age; run.log.bestAsset = a; }
    if (-g > 0.25 * Math.max(nw0, 1) && -inSal > run.log.conc) { run.log.conc = -inSal; run.log.concAge = run.age; run.log.concAsset = a; learn(run, 'diversify'); }
  }
  if (run.cash > 0) run.log.idle += run.cash * (1 - 1 / Math.pow(1 + m.infl, y)) / run.salary;
  if (prev === 'crash' && soldRisk && m.ret.index > 0) {
    const sold = RISKY.reduce((s, a) => s + (run.flow.sell[a] || 0), 0);
    const missed = sold * m.ret.index / run.salary;
    if (missed > run.log.panic) { run.log.panic = missed; run.log.panicAge = run.age; }
  }
  const invested = before.save + before.index + before.stocks + before.crypto + before.fx;
  if (invested > 0) {
    const g = (gains.save + gains.index + gains.stocks + gains.crypto + gains.fx) / invested;
    run.log.growth *= 1 + g; run.log.years += y;
  }

  // Price series for the sparklines (the market, not your holdings).
  const push = (k, r) => { const s = run.px[k]; s.push(s[s.length - 1] * (1 + r)); if (s.length > 12) s.shift(); };
  push('save', m.ret.save); push('index', m.ret.index); push('prop', m.ret.prop); push('crypto', m.ret.crypto);
  push('stocks', m.ret.stocks.reduce((s, x) => s + x, 0) / m.ret.stocks.length);
  push('biz', m.bizMult - 1); push('fx', m.ret.fx);
  run.last = { save: m.ret.save, index: m.ret.index, prop: m.ret.prop, crypto: m.ret.crypto, fx: m.ret.fx, stocks: m.ret.stocks.slice(), biz: m.bizMult - 1 };

  // The world moves on: prices, pay, joy, age.
  if (m.state === 'crash') learn(run, 'bear');
  if (m.infl > 0.1 || run.cash > costs(run)) learn(run, 'inflation');
  if (m.rate < m.infl) learn(run, 'realreturn');
  if (Math.abs(m.dRate) > 0.01) learn(run, 'rates');
  run.infl = m.infl; run.rate = m.rate;
  run.prices *= Math.pow(1 + m.infl, y);
  run.baseCosts *= Math.pow(1 + m.infl, y);
  const realGrowth = Math.max(0, 0.026 - 0.0009 * (run.age - 22)) - (run.asc >= 5 ? 0.01 : 0);
  if (has(run, 'remote_job') && run.currency === 'NGN') run.salary *= (1 + m.fxDev) * Math.pow(1 + realGrowth, y);
  else run.salary *= Math.pow((1 + realGrowth) * (1 + m.infl), y);
  let dj = LIFESTYLES[run.life].joy;
  if (has(run, 'side_hustle')) dj -= 3;
  if (run.flags.gig) dj -= 3;
  if (run.flags.married) dj += 2;
  if (run.asc >= 8) dj -= 2;
  if (c.sailor) dj -= 2;
  if (m.state === 'crash' && nw0 > 0 && netWorth(run) < nw0 * 0.8) dj -= 4;
  run.joy = clamp(run.joy + dj, has(run, 'stoic') ? 30 : 0, 100);
  run.age += y;
  if (run.lev > 0) run.lev -= 1;
  if (run.cash > 0.2 * Math.max(netWorth(run), 1)) run.flags.idle = (run.flags.idle || 0) + 1; else run.flags.idle = 0;

  res.nw1 = netWorth(run);
  res.passive = passive(run).total;
  res.costs = costs(run);
  run.lastResult = res;

  const evId = drawEvent(run);
  const ev = EVENTS.find((e) => e.id === evId);
  run.pending = { id: evId, v: ev.setup ? ev.setup(run) : {} };
  run.seenEv.push(evId);
  run.phase = 'event';
  return res;
}

export function chooseEvent(run, i) {
  if (run.phase !== 'event' || !run.pending) return null;
  const ev = EVENTS.find((e) => e.id === run.pending.id);
  const choice = ev.choices[i];
  if (!choice || (choice.need && !choice.need(run, run.pending.v))) return null;
  const h = helpers(run, rngFor(run.seed, 'evo', run.turn));
  const text = choice.fx(run, h, run.pending.v) || '';
  run.pending = null;
  run.phase = 'cards';
  return text;
}

// ---------------------------------------------------------------- cards

export const unlockedCards = (wisdom) => CARDS.filter((c) => c.unlock <= wisdom).map((c) => c.id);
export const cardById = (id) => CARDS.find((c) => c.id === id);

export function makeOffer(run, unlocked) {
  const r = rngFor(run.seed, 'card', run.turn);
  const n = has(run, 'coach') ? 4 : run.asc >= 11 ? 2 : 3;
  const eligible = (c) => (c.stack || !has(run, c.id)) && (!c.cond || c.cond(run));
  const pool = CARDS.filter((c) => !c.legendary && unlocked.includes(c.id) && eligible(c));
  const legends = CARDS.filter((c) => c.legendary && eligible(c));
  const offer = [];
  for (let i = 0; i < n; i++) {
    if (legends.length && r() < 0.02) {
      const l = legends[Math.floor(r() * legends.length)];
      if (!offer.includes(l.id)) { offer.push(l.id); continue; }
    }
    const w = {};
    for (const c of pool) if (!offer.includes(c.id)) w[c.id] = c.trap ? 0.6 : 1;
    if (!Object.keys(w).length) break;
    offer.push(r.weighted(w));
  }
  run.offer = offer;
  return offer;
}

// Returns the outcome of the turn: null to keep playing, or the finished result.
export function pickCard(run, id) {
  if (run.phase !== 'cards') return null;
  if (id && run.offer && run.offer.includes(id)) {
    const card = cardById(id);
    if (!card.stack || !has(run, id)) run.cards.push(id);
    if (card.take) card.take(run, helpers(run, rngFor(run.seed, 'take', run.turn)));
    if (card.trap) run.flags.scammed = true;
  }
  run.offer = null;
  return endTurn(run);
}

function endTurn(run) {
  run.turn += 1;
  run.flow = { buy: {}, sell: {} };
  run.hist.push(snapshot(run));
  const nw = netWorth(run);
  run.negTurns = nw < 0 ? run.negTurns + 1 : 0;
  const e = era(run);
  if (passive(run).total >= costs(run)) return finish(run, 'free');
  if (run.negTurns >= 2) return finish(run, 'bankrupt');
  if (run.turn >= run.turns) return finish(run, e ? (nw >= e.target * costs(run) ? 'target' : 'missed') : 'clock');
  run.phase = 'alloc';
  return null;
}

export function abandon(run) {
  return finish(run, 'quit');
}

// ---------------------------------------------------------------- scoring

export function finish(run, reason) {
  const p = passive(run);
  const C = costs(run);
  const nw = netWorth(run);
  const ratio = clamp(p.total / C, 0, 1);
  const e = era(run);
  let score;
  if (reason === 'free') score = 1000 + (60 - run.age) * 60 + Math.round(run.joy * 3);
  else if (reason === 'target') score = 1000 + Math.round(run.joy * 3) + Math.round(200 * Math.log2(Math.max(1, nw / (e.target * C))));
  else if (reason === 'missed') score = Math.round(700 * clamp(nw / (e.target * C), 0, 1)) + Math.round(run.joy * 2);
  else if (reason === 'clock') score = Math.round(700 * ratio) + Math.round(run.joy * 2);
  else if (reason === 'bankrupt') score = Math.round(100 * ratio);
  else score = 0;
  score = Math.round(score * (1 + 0.15 * run.asc));

  // The worst mistake, measured in years of salary.
  const L = run.log;
  const cands = [
    ['panic', L.panic, `Selling after the crash at ${L.panicAge} cost you about ${yrs(L.panic)} of salary in missed recovery.`],
    ['scam', L.scam, `Scams took about ${yrs(L.scam)} of salary from you.`],
    ['conc', L.conc * 0.8, `Too much in ${ASSETS[L.concAsset] ? ASSETS[L.concAsset].name.toLowerCase() : 'one asset'} cost you ${yrs(L.conc)} of salary at ${L.concAge}.`],
    ['idle', L.idle * 0.6, `Idle cash lost about ${yrs(L.idle)} of salary to inflation.`],
    ['creep', L.creep * 0.5, `Lifestyle upgrades cost about ${yrs(L.creep)} of salary.`],
    ['debt', L.debt, `Debt interest cost you ${yrs(L.debt)} of salary.`],
  ].filter((c) => c[1] > 0.25).sort((a, b) => b[1] - a[1]);
  const worst = cands[0] ? { key: cands[0][0], text: cands[0][2] } : null;
  const best = L.best > 0.1 ? `${ASSETS[L.bestAsset].name} made you ${yrs(L.best)} of salary in one turn at ${L.bestAge}.` : null;

  const investedNow = run.h.save + run.h.index + stocksTotal(run) + run.h.crypto + run.h.fx;
  const annual = L.years > 0 ? Math.pow(Math.max(0.01, L.growth), 1 / L.years) - 1 : 0;
  const earlier = investedNow > 0 && annual > 0 ? investedNow * (Math.pow(1 + annual, 4) - 1) : 0;

  run.result = {
    reason, score, age: run.age, nw, passive: p.total, costs: C, ratio, joy: run.joy,
    worst, best, lesson: worst ? worst.key : 'none', earlier, annual,
    hist: run.hist.slice(), learned: run.learned.slice(), scammed: !!run.flags.scammed,
    wisdom: Math.round(score / 40) + (reason === 'free' || reason === 'target' ? 10 : 2),
  };
  run.phase = 'done';
  return run.result;
}

function yrs(x) {
  return x >= 1.95 ? `${Math.round(x)} years` : x >= 0.95 ? `${x.toFixed(1)} years` : `${Math.round(x * 12)} months`;
}

// A row of squares, one per turn, for sharing a result.
export function emojiGrid(run) {
  const cells = [];
  for (let i = 1; i < run.hist.length; i++) {
    const a = run.hist[i - 1].nw;
    const b = run.hist[i].nw;
    const ch = a > 0 ? b / a - 1 : b > a ? 1 : -1;
    cells.push(ch > 0.15 ? '🟩' : ch < -0.05 ? '🟥' : '🟨');
  }
  const r = run.result && run.result.reason;
  if (r === 'free' || r === 'target') cells.push('⭐');
  if (r === 'bankrupt') cells.push('💀');
  return cells.join('');
}
