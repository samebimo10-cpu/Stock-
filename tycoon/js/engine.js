// Tycoon Rush rules. No DOM in here, so Node can run it for tests and balance runs.
//
// The whole market path (moods, inflation, rates, returns, headlines) is generated
// up front from the seed. The player's choices never draw from that stream, so a
// Daily Market or a Duel code gives everyone exactly the same years.

import {
  CURRENCIES, LIFESTYLES, CHARACTERS, ASSETS, COMPANIES, NEWS, SWANS, CARDS, EVENTS,
  ERAS, CHALLENGES, GLOSSARY,
} from './content.js';
import { PRINCIPLES, MOMENTS, PLANS, QUIZ } from './learn.js';

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

// Money in the currency's own number style: 1.2M, 12L (lakh), 120万, 1,2 Mio.
const FORMATTERS = {};
function compact(locale, a) {
  const key = `${locale}|${a < 1000 ? 0 : 1}`;
  if (!FORMATTERS[key]) {
    try {
      FORMATTERS[key] = new Intl.NumberFormat(locale, a < 1000 ? { maximumFractionDigits: 0 } : { notation: 'compact', maximumFractionDigits: 1, minimumFractionDigits: 0 });
    } catch {
      FORMATTERS[key] = null;
    }
  }
  return FORMATTERS[key];
}

export function fmt(n, currency = 'USD', signed = false) {
  const c = CURRENCIES[currency] || CURRENCIES.USD;
  const a = Math.abs(n);
  const nf = compact(c.locale, a);
  let body;
  if (nf) {
    body = nf.format(a >= 100 && a < 1000 ? Math.round(a) : a);
    // Indian English writes thousands as "T", which reads as trillions to most
    // people; keep lakh (L) and crore (Cr) but say K for thousands.
    if (a >= 1e3 && a < 1e5) body = body.replace(/T$/, 'K');
  }
  else {
    body = String(Math.round(a));
    for (const [v, u] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']]) if (a >= v) { body = (a / v).toFixed(1) + u; break; }
  }
  const sign = n < 0 ? '−' : signed ? '+' : '';
  return `${sign}${c.sym}${body}`;
}

export const pct = (x, digits = 0) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(digits)}%`;

// ---------------------------------------------------------------- market model

export const MOODS = ['boom', 'steady', 'over', 'crash', 'recov'];

export function transitions(state, asc) {
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

// How the first mood of a run is drawn, before any history exists.
export const INIT_MOOD = { steady: 0.5, boom: 0.25, recov: 0.25 };

// Mr. Market: the index price drifts around a fair value that grows about 4% a
// year in real terms. Returns lean back toward fair value, so buying below it
// (a margin of safety) really does pay more on average.
const TREND = 1.04;
const REVERT = 0.2;

// A mood headline is right this often. When wrong, it points to one of the four
// other moods at random, so each gets a quarter of the misses.
export const HINT_TRUE = 0.8;
export const HINT_FALSE = 0.05;

// Real (after-inflation) return over one 2-year turn: [mean, spread].
export const REAL = {
  index: { boom: [0.26, 0.1], steady: [0.1, 0.09], over: [0.16, 0.13], crash: [-0.32, 0.1], recov: [0.3, 0.12] },
  prop: { boom: [0.08, 0.05], steady: [0.03, 0.04], over: [0.15, 0.06], crash: [-0.15, 0.06], recov: [0.02, 0.05] },
  crypto: { boom: [0.6, 0.5], steady: [-0.05, 0.35], over: [0.8, 0.7], crash: [-0.6, 0.12], recov: [0.3, 0.45] },
};
const BIZ_MOOD = { boom: 1.3, steady: 1, over: 1.1, crash: 0.45, recov: 0.9 };
const INFL_MOOD = { boom: 0.006, steady: 0, over: 0.015, crash: -0.01, recov: -0.004 };

// Economy profiles. `volatile` is the original Naira market and `stable` the
// original Dollar one, number for number; `moderate` sits between them.
export const PROFILES = {
  stable: { infl: 0.03, ascInfl: 0.01, sd: 0.008, mood: 1, lo: -0.01, hi: 0.18, rent: 0.05, fx: false, volatileRates: false },
  moderate: { infl: 0.07, ascInfl: 0.015, sd: 0.015, mood: 1.5, lo: 0, hi: 0.35, rent: 0.055, fx: true, volatileRates: false, devGap: 0.025, devNoise: 0.03, jumpP: 0.06, jump: 0.2 },
  volatile: { infl: 0.17, ascInfl: 0.02, sd: 0.03, mood: 2, lo: 0.05, hi: 0.7, rent: 0.06, fx: true, volatileRates: true, devGap: 0.03, devNoise: 0.04, jumpP: 0.1, jump: 0.3 },
};
export const profileOf = (currency) => PROFILES[(CURRENCIES[currency] || CURRENCIES.USD).profile];

function policyRate(infl, state, prof) {
  if (prof.volatileRates) return clamp(infl - 0.035 + (state === 'over' ? 0.02 : 0) - (state === 'recov' ? 0.01 : 0), 0.04, 0.4);
  return clamp(infl + 0.008 + (state === 'over' ? 0.012 : 0) - (state === 'crash' ? 0.015 : 0), 0.0025, 0.2);
}

export function genMarket({ seed, turns, ypt, currency, asc = 0, era = null }) {
  const r = makeRng(hashStr(`${seed}|market`));
  const prof = profileOf(currency);
  const k = ypt / 2;
  const sk = Math.sqrt(k);
  const grow = ([m, sd]) => Math.pow(Math.max(0.05, 1 + m + sd * r.normal()), k) - 1;
  const meanInfl = prof.infl + (asc >= 1 ? prof.ascInfl : 0);
  let infl = meanInfl;
  let state = era ? era.states[0] : r.weighted(INIT_MOOD);
  let val = 0.9 + 0.2 * r();
  let rate = policyRate(infl, state, prof);
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
      const pool = SWANS.filter((s) => !s.ngn || prof.fx);
      swan = pool[Math.floor(swanPick * pool.length)];
      if (swan.state) state = swan.state;
      if (swan.id === 'mania') forceCrash = true;
    }

    infl = clamp(
      meanInfl + 0.5 * (infl - meanInfl) + r.normal() * prof.sd
        + INFL_MOOD[state] * prof.mood + ((swan && swan.infl) || 0) + (adj.infl || 0),
      prof.lo, prof.hi,
    );
    const newRate = policyRate(infl, state, prof);
    const dRate = newRate - rate;
    rate = newRate;

    const valNow = val;
    const idxReal = grow(REAL.index[state]) - 2.5 * dRate - REVERT * (val - 1) * k + ((swan && swan.index) || 0) + (adj.index || 0);
    val = clamp(val * (1 + idxReal) / Math.pow(TREND, ypt), 0.3, 3);
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
    if (prof.fx) {
      const perYear = infl - prof.devGap + prof.devNoise * devNoise;
      fxDev = Math.pow(Math.max(0.5, 1 + perYear), ypt) - 1;
      devJump = devRoll < prof.jumpP * k || !!(adj.dev) || !!(swan && swan.dev);
      if (devJump) fxDev = (1 + fxDev) * (1 + (adj.dev || (swan && swan.dev) || prof.jump)) - 1;
    }

    const toNom = (x) => Math.max(-0.99, (1 + x) * Math.pow(1 + infl, ypt) - 1);
    const m = {
      t, state, infl, rate, dRate, swan: swan && swan.id, val: valNow,
      ret: {
        save: Math.pow(1 + rate, ypt) - 1,
        index: toNom(idxReal),
        prop: toNom(propReal),
        crypto: Math.max(-0.97, toNom(cryReal)),
        stocks: stockReal.map(toNom),
        fx: prof.fx ? Math.pow(1.04, ypt) * (1 + fxDev) - 1 : 0,
      },
      fxDev, bizMult, hustle, companyNews, devJump, rug: rugRoll < 0.05 * k,
    };
    m.news = genNews(r, m, prof.fx, asc);
    out.push(m);
  }
  return out;
}

function genNews(r, m, naira, asc) {
  const items = [];
  const others = MOODS.filter((s) => s !== m.state);
  // Mood headlines each point at a mood. Each is independently right 80% of the
  // time, which keeps the maths in the probability lens exact.
  const moodItem = (avoid) => {
    const real = r() < HINT_TRUE;
    const hint = real ? m.state : r.pick(others);
    const pool = NEWS[hint].filter((x) => x !== avoid);
    return { kind: 'signal', real, hint, text: r.pick(pool) };
  };
  items.push(moodItem(null));
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
  else items.push(moodItem(items[0].text));
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// ---------------------------------------------------------------- run setup

export const MODES = {
  journey: { name: 'Wisdom Journey', ypt: 1, startAge: 22, timer: 0, learn: true },
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
  // A real-life start: the player's own age, money and goals, in their own
  // currency (actual amounts, so no scaling).
  const me = !era && opts.me ? opts.me : null;
  const startAge = era ? era.startAge : me ? clamp(Math.round(me.age), 16, 75) : ch && ch.startAge ? ch.startAge : mode.startAge;
  const ypt = mode.ypt;
  const deadline = Math.max(asc >= 12 ? 56 : 60, me ? startAge + 8 : 0);
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
    flags: { weather: c.weather || 1, skillAge: startAge },
    prices: 1, infl: profileOf(currency).infl, rate: 0,
    px: { save: [1], index: [1], stocks: [1], prop: [1], crypto: [1], biz: [1], fx: [1] },
    last: {},
    market: [],
    hist: [], seenEv: [], learned: [], reveal: {}, crystal: {},
    log: { panic: 0, panicAge: 0, scam: 0, idle: 0, conc: 0, concAge: 0, concAsset: '', creep: 0, debt: 0, best: 0, bestAge: 0, bestAsset: '', growth: 1, years: 0, efund: 0, trapTaps: 0 },
    negTurns: 0, lastResult: null, pending: null, offer: null, result: null,
    flow: { buy: {}, sell: {} },
    salaryStart: c.salary * scale,
    // The learning layer.
    learnMode: !!mode.learn,
    aim: opts.aim || null,
    plan: { pyf: 0, mix: 'balanced', rebalance: false },
    forecast: null, fc: [],
    cures: [false, false, false, false, false, false, false], cureYears: [0, 0, 0, 0, 0, 0, 0], curesLit: [],
    seenP: [], recentMoments: [], quiz: null, quizAsked: [], quizRight: 0,
    // A diary of every year and every decision, for the end-of-game report.
    journal: [],
  };
  run.market = genMarket({ seed, turns, ypt, currency, asc, era });
  run.rate = policyRate(run.infl, 'steady', profileOf(currency));
  run.h.biz.profit = bizProfit(run, 1);
  learn(run, 'freedom');
  if (me) applyMe(run, me);
  run.hist.push(snapshot(run));
  if (run.aim) seeP(run, 'h_aim');
  return run;
}

function applyMe(run, me) {
  const n = (x) => Math.max(0, Number(x) || 0);
  run.char = 'me';
  run.custom = true;
  run.salary = n(me.pay) * 12;
  run.salaryStart = run.salary;
  run.life = 1;
  run.startLife = 1;
  run.baseCosts = Math.max(1, n(me.costs) * 12);
  run.cash = n(me.cash) - n(me.debt);
  const h = run.h;
  h.save = n(me.save);
  h.index = n(me.index);
  h.stocks = COMPANIES.map(() => n(me.stocks) / COMPANIES.length);
  h.crypto = n(me.crypto);
  if (isOpen(run, 'fx')) h.fx = n(me.fx); else h.save += n(me.fx);
  h.prop = { v: n(me.prop), debt: Math.min(n(me.mortgage), n(me.prop) * 1.5), bought: -1, home: me.liveIn === false ? 0 : n(me.prop) };
  if (n(me.mortgage) > h.prop.debt) run.cash -= n(me.mortgage) - h.prop.debt;
  h.biz = { c: n(me.biz), managed: !!me.bizManaged, profit: 0 };
  h.biz.profit = bizProfit(run, 1);
  run.goal = n(me.goal) * 12;
  if (me.aim) run.aim = clamp(Math.round(me.aim), run.startAge + 1, 90);
  run.flags.skillAge = run.startAge;
}

// ---------------------------------------------------------------- read helpers

export const has = (run, id) => run.cards.includes(id);
export const era = (run) => (run.eraId ? ERAS.find((e) => e.id === run.eraId) : null);
export const challenge = (run) => (run.challengeId ? CHALLENGES.find((c) => c.id === run.challengeId) : null);
export const atSea = (run) => !!CHARACTERS[run.char].sailor && run.turn % 2 === 1;
export const lifeLocked = (run) => { const ch = challenge(run); return !!(ch && ch.lockLife != null); };

export function isOpen(run, asset) {
  if (asset === 'fx' && !profileOf(run.currency).fx) return false;
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

// The home you live in earns no rent (it saves rent, which is already in your
// living costs); only the rest of your property is let out.
export const rentable = (run) => Math.max(0, run.h.prop.v - (run.h.prop.home || 0));
export const rentYield = (run) => profileOf(run.currency).rent * (has(run, 'landlord') ? 1.25 : 1);
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
  const rent = rentable(run) * rentYield(run);
  const mort = h.prop.debt * mortRate(run);
  const debt = run.cash < 0 ? -run.cash * debtRate(run) : 0;
  const biz = bizManaged(run) ? h.biz.profit : 0;
  let total = invest + rent + biz - mort - debt;
  if (has(run, 'tax_smart') && total > 0) total *= 1.1;
  return { invest, rent, biz, mort, debt, total };
}

// The bowl passive income has to fill: today's living costs, or the income the
// player says they want when free (kept in today's money), whichever is bigger.
export const bowl = (run) => Math.max(costs(run), (run.goal || 0) * run.prices);
export const freedomNumber = (run) => 25 * bowl(run);

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
  if (p.home) p.home *= 1 - frac;
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

// ---------------------------------------------------------------- thinking tools

export const valuation = (run) => run.market[Math.min(run.turn, run.market.length - 1)].val;

export function mrMarket(run) {
  const v = valuation(run);
  const mood = v < 0.8 ? 'Terrified' : v < 0.92 ? 'Gloomy' : v <= 1.08 ? 'Calm' : v <= 1.25 ? 'Cheerful' : 'Euphoric';
  return { v, mood, gap: v - 1 };
}

// The base rate for this turn's mood: what usually follows the last mood.
export function prior(run) {
  const base = run.turn === 0 ? INIT_MOOD : transitions(run.market[run.turn - 1].state, run.asc);
  const out = {};
  for (const s of MOODS) out[s] = base[s] || 0;
  return out;
}

// Base rate × how well each mood explains the headlines, normalised (Bayes).
export function posterior(run) {
  const pr = prior(run);
  const hints = run.market[run.turn].news.filter((n) => n.hint).map((n) => n.hint);
  const post = {};
  let z = 0;
  for (const s of MOODS) {
    let p = pr[s];
    for (const hnt of hints) p *= hnt === s ? HINT_TRUE : HINT_FALSE;
    post[s] = p; z += p;
  }
  for (const s of MOODS) post[s] = z > 0 ? post[s] / z : pr[s];
  return { prior: pr, post, hints };
}

function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

// Chance the index fund beats inflation this turn (a positive real return), if
// the mood is `s`.
// It folds in what that mood does to inflation and interest rates (central
// banks cut in crashes and hike when things overheat), and Mr. Market's pull
// back toward fair value.
export function pUp(run, s) {
  const k = run.ypt / 2;
  const prof = profileOf(run.currency);
  const meanInfl = prof.infl + (run.asc >= 1 ? prof.ascInfl : 0);
  const infl = meanInfl + 0.5 * (run.infl - meanInfl) + INFL_MOOD[s] * prof.mood;
  const dRate = policyRate(infl, s, prof) - run.rate;
  const A = -REVERT * (valuation(run) - 1) * k - 2.5 * dRate;
  const need = 1 - A;
  if (need <= 0) return 1;
  const thr = Math.pow(need, 1 / k) - 1;
  const [m, sd] = REAL.index[s];
  const noise = 2.5 * prof.sd / k;
  return normCdf((m - thr) / Math.sqrt(sd * sd + noise * noise));
}

export function upOdds(run) {
  const { prior: pr, post } = posterior(run);
  let base = 0;
  let ideal = 0;
  const per = {};
  for (const s of MOODS) { per[s] = pUp(run, s); base += pr[s] * per[s]; ideal += post[s] * per[s]; }
  return { base, ideal, per };
}

export function setForecast(run, p) {
  if (run.phase !== 'alloc') return false;
  run.forecast = clamp(p, 0, 1);
  return true;
}

export function setPlan(run, patch) {
  if (!canAct(run)) return false;
  const was = run.plan.pyf;
  run.plan = { ...run.plan, ...patch };
  run.plan.pyf = clamp(run.plan.pyf, 0, 0.6);
  if (!was && run.plan.pyf > 0) seeP(run, 'h_plan');
  if (patch.rebalance || patch.mix) seeP(run, 'g_defensive');
  return true;
}

export function forecastStats(fc) {
  if (!fc.length) return null;
  const n = fc.length;
  const brier = fc.reduce((s, f) => s + Math.pow(f.p - (f.up ? 1 : 0), 2), 0) / n;
  const ideal = fc.reduce((s, f) => s + Math.pow(f.ideal - (f.up ? 1 : 0), 2), 0) / n;
  const gap = fc.reduce((s, f) => s + Math.abs(f.p - f.ideal), 0) / n;
  const buckets = [];
  for (let b = 0; b < 5; b++) {
    const lo = b * 0.2;
    const hi = lo + 0.2;
    const inB = fc.filter((f) => f.p >= lo && (f.p < hi || (b === 4 && f.p <= 1)));
    if (inB.length) buckets.push({ lo, hi, said: inB.reduce((s, f) => s + f.p, 0) / inB.length, happened: inB.filter((f) => f.up).length / inB.length, n: inB.length });
  }
  return { n, brier, ideal, gap, buckets };
}

// Kelly: the share of wealth to stake that grows wealth fastest.
// rows: [{ p, m }] where m is what the stake becomes (0 = lost).
export function kelly(rows) {
  const ev = rows.reduce((s, r) => s + r.p * r.m, 0);
  if (ev <= 1) return { ev, f: 0 };
  let best = 0;
  let bestG = -Infinity;
  for (let f = 0; f <= 0.99; f += 0.005) {
    let g = 0;
    for (const r of rows) g += r.p * Math.log(Math.max(1e-12, 1 + f * (r.m - 1)));
    if (g > bestG) { bestG = g; best = f; }
  }
  return { ev, f: best };
}

// Rich Dad's statement: where money comes from, where it goes, what you own.
export function statement(run) {
  const h = run.h;
  const p = passive(run);
  const managed = bizManaged(run);
  const invest4 = p.invest;
  const income = [
    ['Salary', run.salary, 'E'],
    [managed ? 'Business (managed)' : 'Business (you run it)', h.biz.c > 0 ? h.biz.profit : 0, managed ? 'B' : 'S'],
    ['Rent', p.rent, 'I'],
    ['Investments at 4%', invest4, 'I'],
  ].filter((r) => r[1] > 0);
  const expenses = [
    ['Living costs', costs(run)],
    ['Mortgage interest', p.mort],
    ['Debt interest', p.debt],
  ].filter((r) => r[1] > 0);
  const rentNet = p.rent - p.mort;
  const assets = [
    ['Savings', h.save], ['Index fund', h.index], ['Stocks', stocksTotal(run)], ['Dollar fund', h.fx],
    ['Business', h.biz.c], [rentNet >= 0 ? 'Property (pays you)' : 'Property (costs you)', h.prop.v],
    ['Crypto (pays nothing)', h.crypto],
  ].filter((r) => r[1] > 0);
  const liabilities = [['Mortgage', h.prop.debt], ['Borrowing', run.cash < 0 ? -run.cash : 0]].filter((r) => r[1] > 0);
  const q = { E: 0, S: 0, B: 0, I: 0 };
  for (const r of income) q[r[2]] += r[1];
  q.I = Math.max(0, q.I - p.mort);
  return { income, expenses, assets, liabilities, quadrant: q, rentNet };
}

export function seeP(run, id) {
  if (PRINCIPLES[id] && !run.seenP.includes(id)) run.seenP.push(id);
}

// ---------------------------------------------------------------- mentor quizzes

export function quizView(run) {
  if (!run.quiz) return null;
  if (run.quiz.id === 'bayes') return run.quiz.q;
  const q = QUIZ[run.quiz.id];
  return { q: q.q, opts: q.opts, p: q.p };
}

function makeQuiz(run) {
  const r = rngFor(run.seed, 'quiz', run.turn);
  if (run.quizAsked.length % 3 === 2 && !run.eraId) {
    // A live Bayes question built from this turn's real numbers.
    const pr = prior(run);
    const target = MOODS.slice().sort((a, b) => pr[b] - pr[a])[1];
    const base = pr[target];
    const post = (base * HINT_TRUE) / (base * HINT_TRUE + (1 - base) * HINT_FALSE);
    const right = `${Math.round(post * 100)}%`;
    const opts = [right, `${Math.round(base * 100)}%`, '80%', `${Math.round(Math.min(99, post * 100 + 25))}%`];
    const order = [0, 1, 2, 3].sort(() => r() - 0.5);
    const names = { boom: 'Boom', steady: 'Steady', over: 'Overheating', crash: 'Crash', recov: 'Recovery' };
    run.quiz = {
      id: 'bayes',
      a: order.indexOf(0),
      q: {
        q: `The base rate of a ${names[target]} next is ${Math.round(base * 100)}%. One headline that sounds like a ${names[target]} appears. Mood headlines are right 80% of the time, and a wrong one points at each other mood 5% of the time. What is the chance of a ${names[target]} now?`,
        opts: order.map((i) => opts[i]),
        p: 'x_bayes',
      },
      why: `Bayes: ${Math.round(base * 100)}% × 0.8 = ${(base * 0.8).toFixed(3)}, against ${Math.round((1 - base) * 100)}% × 0.05 = ${((1 - base) * 0.05).toFixed(3)}. The share is ${(base * 0.8).toFixed(3)} ÷ ${(base * 0.8 + (1 - base) * 0.05).toFixed(3)} = ${right}. One good headline moves the odds a lot, but not to 80%.`,
    };
  } else {
    const pool = QUIZ.map((_, i) => i).filter((i) => !run.quizAsked.includes(i));
    const id = pool.length ? pool[Math.floor(r() * pool.length)] : Math.floor(r() * QUIZ.length);
    run.quiz = { id, a: QUIZ[id].a, why: QUIZ[id].why };
  }
  run.quizAsked.push(run.quiz.id);
}

export function answerQuiz(run, i) {
  if (!run.quiz) return null;
  const right = i === run.quiz.a;
  const p = run.quiz.id === 'bayes' ? 'x_bayes' : QUIZ[run.quiz.id].p;
  const correct = run.quiz.id === 'bayes' ? run.quiz.q.opts[run.quiz.a] : QUIZ[run.quiz.id].opts[run.quiz.a];
  const out = { right, why: run.quiz.why, p, correct };
  if (right) { run.quizRight += 1; run.joy = clamp(run.joy + 3, 0, 100); run.cash += 0.05 * run.salary; }
  seeP(run, p);
  run.quiz = null;
  return out;
}

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
    skill: () => { run.flags.skillAge = run.age; },
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
        run.eventLesson = run.eventLesson || 'p_room';
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
      math: c.math ? mathView(run, c.math(run, v, h)) : null,
    })),
  };
}

// Turn a choice's odds into expected value (and Kelly size, for stakes).
function mathView(run, m) {
  if (m.kind === 'text') return m;
  if (m.kind === 'cost') {
    const ev = m.rows.reduce((s, r) => s + r.p * r.v, 0);
    return { ...m, ev };
  }
  const k = kelly(m.rows);
  const nw = Math.max(1, netWorth(run));
  return { ...m, ev: m.stake * (k.ev - 1), mult: k.ev, kelly: k.f, share: m.stake / nw, kellyAmt: k.f * nw };
}

function drawEvent(run) {
  const m = run.market[run.turn];
  const r = rngFor(run.seed, 'ev', run.turn);
  if (m.devJump && profileOf(run.currency).fx) return 'deval';
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
  // Snapshot what the player knew before the dice roll, for the review.
  const odds = !run.eraId ? upOdds(run) : null;
  const fc = run.forecast != null && odds ? { t, p: run.forecast, ideal: odds.ideal, base: odds.base } : null;
  const priorNow = prior(run);
  const valNow = m.val;
  const scam0 = run.log.scam;
  const lifeStart = run.lifeStart != null ? run.lifeStart : run.startLife;

  // Salary and living costs over the period.
  const drift = Math.pow(1 + m.infl, (y - 1) / 2);
  let pay = run.salary * y * drift;
  if (c.volatile) pay *= m.hustle;
  if (m.swan === 'pandemic' && !has(run, 'remote_job')) pay *= 0.7;
  const spend = costs(run) * y * drift;
  run.cash += pay - spend;
  res.flows.push({ label: 'Salary', v: pay }, { label: 'Living costs', v: -spend });

  // The plan runs by itself: pay yourself first, then rebalance to the mix.
  const mix = PLANS[run.plan.mix] || PLANS.balanced;
  const idxOpen = isOpen(run, 'index');
  let pyf = 0;
  if (run.plan.pyf > 0) {
    // Never borrow to pay yourself: if costs ate the pay, the plan gets less.
    const want = pay * run.plan.pyf;
    pyf = Math.min(want, Math.max(0, run.cash));
    if (pyf < want * 0.99) res.pyfShort = want - pyf;
    const toIdx = idxOpen ? pyf * mix.index : 0;
    run.cash -= pyf;
    h.index += toIdx;
    h.save += pyf - toIdx;
    res.pyf = pyf;
  }
  if (run.plan.rebalance && idxOpen) {
    const tot = h.save + h.index;
    const d = tot * mix.index - h.index;
    if (tot > 0 && Math.abs(d) > tot * 0.02) { h.index += d; h.save -= d; res.rebal = d; }
  }
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
  if (h.prop.home) h.prop.home *= 1 + m.ret.prop;

  if (prev === 'crash' && has(run, 'contrarian')) {
    const bonus = 0.12 * ((run.flow.buy.index || 0) + (run.flow.buy.stocks || 0));
    if (bonus > 0) { h.index += bonus; gains.index += bonus; res.notes.push(`Contrarian bonus: ${fmt(bonus, run.currency, true)} for buying after the crash.`); }
  }
  if (prev === 'crash' && ((run.flow.buy.index || 0) + (run.flow.buy.stocks || 0)) > 0) learn(run, 'dip');

  // Rent, mortgage interest, business profit, debt interest.
  if (h.prop.v > 0) {
    const rent = rentable(run) * rentYield(run) * y;
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
  if (has(run, 'remote_job') && profileOf(run.currency).fx) run.salary *= (1 + m.fxDev) * Math.pow(1 + realGrowth, y);
  else run.salary *= Math.pow((1 + realGrowth) * (1 + m.infl), y);
  let dj = LIFESTYLES[run.life].joy;
  if (has(run, 'side_hustle')) dj -= 3;
  if (run.flags.gig) dj -= 3;
  if (run.flags.married) dj += 2;
  if (run.asc >= 8) dj -= 2;
  if (c.sailor) dj -= 2;
  if (m.state === 'crash' && nw0 > 0 && netWorth(run) < nw0 * 0.8) dj -= 4;
  run.joy = clamp(run.joy + dj * Math.min(1, y / 2), has(run, 'stoic') ? 30 : 0, 100);
  run.age += y;
  if (run.lev > 0) run.lev -= 1;
  if (run.cash > 0.2 * Math.max(netWorth(run), 1)) run.flags.idle = (run.flags.idle || 0) + 1; else run.flags.idle = 0;

  res.nw1 = netWorth(run);
  res.passive = passive(run).total;
  res.costs = costs(run);
  res.bowl = bowl(run);

  // Forecast scoring.
  if (fc) {
    fc.up = (1 + m.ret.index) / Math.pow(1 + m.infl, y) > 1;
    fc.ret = m.ret.index;
    fc.real = (1 + m.ret.index) / Math.pow(1 + m.infl, y) - 1;
    fc.infl = m.infl;
    run.fc.push(fc);
    res.fc = fc;
    run.forecast = null;
  }

  // A month-by-month path for the index, ending where the year really ended.
  const pr = rngFor(run.seed, 'path', t);
  const steps = 12 * y;
  const endLog = Math.log(1 + m.ret.index);
  const vol = REAL.index[m.state][1] * Math.sqrt(y / 2) / Math.sqrt(steps) * 1.4;
  let w = 0;
  const walk = [0];
  for (let i = 1; i <= steps; i++) { w += pr.normal() * vol; walk.push(w); }
  res.path = walk.map((x, i) => Math.exp(x - (walk[steps] - endLog) * (i / steps)));

  // Arkad's seven cures, checked every year.
  const hv = holdings(run);
  const productive = hv.save + hv.index + hv.stocks + hv.fx + Math.max(0, hv.prop) + hv.biz;
  const investedAll = productive + hv.crypto;
  const biggest = Math.max(hv.save, hv.index, hv.stocks, hv.fx, Math.max(0, hv.prop), hv.biz, hv.crypto);
  const cures = [
    pay - spend >= 0.1 * pay,
    costs(run) <= 0.75 * run.salary,
    productive >= 0.6 * Math.max(1, productive + Math.max(0, run.cash) + hv.crypto),
    run.log.scam === scam0 && run.cash >= 0 && !(investedAll > run.salary && biggest > 0.6 * investedAll && biggest !== hv.save),
    h.prop.v > 0,
    passive(run).total >= 0.2 * costs(run),
    run.flags.skillAge != null && run.age - run.flags.skillAge <= 6,
  ];
  res.newCures = [];
  cures.forEach((on, i) => {
    if (on) run.cureYears[i] += y;
    if (on && !run.curesLit.includes(i)) { run.curesLit.push(i); res.newCures.push(i); }
  });
  run.cures = cures;
  if (cures.every(Boolean) && !run.flags.allCures) { run.flags.allCures = true; run.joy = clamp(run.joy + 10, 0, 100); }

  // Mentor moments: what this year teaches, tied to a principle.
  const mo = [];
  const money = (n) => fmt(n, run.currency);
  const riskyHeld = before.index + before.stocks + before.crypto > 0;
  const boughtIdx = (run.flow.buy.index || 0) + (run.flow.buy.stocks || 0);
  if (m.state === 'crash' && riskyHeld && !soldRisk) { run.flags.held = (run.flags.held || 0) + 1; mo.push(['held_crash']); if (run.flags.held === 2 || run.flags.held === 4) mo.push(['persist', run.flags.held]); }
  if ((m.state === 'crash' || prev === 'crash') && soldRisk) mo.push(['sold_panic']);
  if (boughtIdx > 0 && valNow < 0.85) mo.push(['mos_buy', `${Math.round((1 - valNow) * 100)}%`]);
  if (boughtIdx > 0 && valNow > 1.25) mo.push(['euphoric_buy', `${Math.round((valNow - 1) * 100)}%`]);
  if (res.rebal) mo.push([res.rebal < 0 ? 'rebalance' : 'rebalance_buy', money(Math.abs(res.rebal))]);
  if (pyf > 0 && !run.flags.pyfSeen) { run.flags.pyfSeen = true; mo.push(['pyf_on', money(pyf)]); }
  if (res.pyfShort) mo.push(['pyf_short', money(res.pyfShort)]);
  if (!pyf && run.learnMode && t >= 1 && !run.flags.pyfNag) { run.flags.pyfNag = true; mo.push(['pyf_off']); }
  if (run.life > lifeStart) mo.push(['life_up', money(freedomNumber(run))]);
  if (run.cash > costs(run) && m.infl > 0.02) mo.push(['idle_cash', money(run.cash), money(run.cash * (1 - 1 / Math.pow(1 + m.infl, y)))]);
  if (run.log.scam > scam0) mo.push(['scam_loss']);
  if (run.flow.buy.prop > 0 || (h.prop.v > 0 && !run.flags.propSeen)) {
    run.flags.propSeen = true;
    const net = rentable(run) * rentYield(run) - h.prop.debt * mortRate(run);
    mo.push(net >= 0 ? ['house_asset', money(net)] : ['house_liab', money(-net)]);
  }
  if (bizManaged(run) && h.biz.c > 0 && !run.flags.bSeen) { run.flags.bSeen = true; mo.push(['manager']); }
  if (res.passive >= 0.5 * res.bowl && !run.flags.halfSeen) { run.flags.halfSeen = true; mo.push(['half_free']); }
  if (res.rows.some((r) => -r.gain > 0.25 * Math.max(nw0, 1))) mo.push(['conc_loss']);
  if (fc) {
    const hit = fc.up ? fc.p : 1 - fc.p;
    const idealHit = fc.up ? fc.ideal : 1 - fc.ideal;
    if ((fc.p >= 0.85 || fc.p <= 0.15) && hit < 0.5) mo.push(['overconf', `${Math.round(Math.max(fc.p, 1 - fc.p) * 100)}%`]);
    else if (Math.abs(fc.p - fc.ideal) <= 0.1 && idealHit < 0.5) mo.push(['good_call_bad_luck']);
    else if (hit > 0.5 && idealHit < 0.4) mo.push(['lucky_call']);
    else if (Math.abs(fc.p - fc.ideal) <= 0.1) mo.push(['good_calib']);
  }
  if (m.state === 'crash' && priorNow.crash <= 0.15 && !m.swan) mo.push(['rare_crash', `${Math.round(priorNow.crash * 100)}%`]);
  const investedNow = hv.save + hv.index + hv.stocks + hv.fx;
  if (investedNow > 3 * run.salary && !run.flags.compSeen) { run.flags.compSeen = true; mo.push(['compound', '3']); }
  if (run.cash < 0) mo.push(['debt', `${Math.round(debtRate(run) * 100)}%`]);
  if (run.aim && run.age >= run.aim - 5 && run.age - y < run.aim - 5) mo.push(['aim_near', String(run.aim), `${Math.round(Math.min(1, res.passive / res.bowl) * 100)}%`]);
  if (run.learnMode && t === 0) mo.push(['base_intro']);
  if (run.learnMode && t === 1) mo.push(['bayes_intro']);
  if (run.flags.allCures && !run.flags.allCuresSeen) { run.flags.allCuresSeen = true; mo.push(['all_cures']); }

  // Show new ideas first, and never the same moment two years running.
  const recent = run.recentMoments;
  const ranked = mo.filter((x) => !recent.includes(x[0]))
    .sort((a, b) => (run.seenP.includes(MOMENTS[a[0]].p) ? 1 : 0) - (run.seenP.includes(MOMENTS[b[0]].p) ? 1 : 0));
  res.moments = ranked.slice(0, run.learnMode ? 2 : 1).map(([id, x, yy]) => {
    const M = MOMENTS[id];
    seeP(run, M.p);
    return { id, p: M.p, text: M.text.replace('{x}', x == null ? '' : x).replace('{y}', yy == null ? '' : yy) };
  });
  run.recentMoments = res.moments.map((x) => x.id);
  run.lastResult = res;

  // Diary entry for the report: what the player did this turn and how it went.
  const round = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v > 0).map(([k, v]) => [k, Math.round(v)]));
  if (!run.journal) run.journal = [];
  run.journal.push({
    t, age0: res.age0, age1: res.age1, mood: m.state, swan: m.swan || null,
    nw0: Math.round(nw0), nw1: Math.round(res.nw1), passive: Math.round(res.passive), bowl: Math.round(res.bowl),
    joy: Math.round(run.joy), life: run.life, lifeFrom: lifeStart,
    buys: round(run.flow.buy), sells: round(run.flow.sell), pyf: Math.round(pyf || 0),
    val: Math.round(valNow * 100) / 100,
    fc: fc ? { p: fc.p, ideal: Math.round(fc.ideal * 100) / 100, up: fc.up } : null,
    moments: (res.moments || []).map((x) => x.id), notes: res.notes.slice(),
    event: null, card: null,
  });

  // One-year turns keep life at the same pace as two-year ones: an event and
  // a card every other year, with a quiet year in between.
  if (y === 1 && t % 2 === 1 && !m.devJump) {
    run.pending = null;
    run.quiet = true;
    run.phase = 'cards';
    res.quiet = true;
    return res;
  }
  run.quiet = false;
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
  run.eventLesson = null;
  const text = choice.fx(run, h, run.pending.v) || '';
  const lesson = choice.lesson || run.eventLesson;
  run.eventLesson = lesson || null;
  if (lesson) seeP(run, lesson);
  if (choice.math) seeP(run, 'x_ev');
  const entry = run.journal && run.journal[run.journal.length - 1];
  if (entry) {
    const view = typeof choice.label === 'function' ? choice.label(run.pending.v, h) : choice.label;
    entry.event = { id: ev.id, title: ev.title, choice: view, note: choice.note || '', outcome: text, lesson: lesson || null };
  }
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
    const entry = run.journal && run.journal[run.journal.length - 1];
    if (entry) entry.card = { id, name: card.name, type: card.type, trap: !!card.trap };
  }
  run.offer = null;
  return endTurn(run);
}

function endTurn(run) {
  run.turn += 1;
  run.flow = { buy: {}, sell: {} };
  run.lifeStart = run.life;
  run.eventLesson = null;
  run.hist.push(snapshot(run));
  const nw = netWorth(run);
  run.negTurns = nw < 0 ? run.negTurns + 1 : 0;
  const e = era(run);
  if (passive(run).total >= bowl(run)) return finish(run, 'free');
  // Broke for four years in a row (two 2-year turns) ends the run.
  if (run.negTurns * run.ypt >= 4) return finish(run, 'bankrupt');
  if (run.turn >= run.turns) return finish(run, e ? (nw >= e.target * costs(run) ? 'target' : 'missed') : 'clock');
  run.phase = 'alloc';
  if (run.learnMode && run.turn % 4 === 0) makeQuiz(run);
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
  const ratio = clamp(p.total / bowl(run), 0, 1);
  const e = era(run);
  let score;
  if (reason === 'free') score = 1000 + (60 - run.age) * 60 + Math.round(run.joy * 3);
  else if (reason === 'target') score = 1000 + Math.round(run.joy * 3) + Math.round(200 * Math.log2(Math.max(1, nw / (e.target * C))));
  else if (reason === 'missed') score = Math.round(700 * clamp(nw / (e.target * C), 0, 1)) + Math.round(run.joy * 2);
  else if (reason === 'clock') score = Math.round(700 * ratio) + Math.round(run.joy * 2);
  else if (reason === 'bankrupt') score = Math.round(100 * ratio);
  else score = 0;
  // The learning layer adds to the score: meeting your written aim, thinking
  // clearly about odds, and passing the mentors' tests.
  const fstats = forecastStats(run.fc);
  const aimMet = !!(run.aim && reason === 'free' && run.age <= run.aim);
  let bonus = 0;
  if (aimMet) bonus += 300;
  if (fstats && fstats.n >= 3) bonus += Math.round(Math.max(0, 0.25 - fstats.brier) * 4 * 300);
  bonus += run.quizRight * 25;
  score += bonus;
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
    wisdom: Math.round(score / 40) + (reason === 'free' || reason === 'target' ? 10 : 2) + run.seenP.length,
    learnMode: run.learnMode, aim: run.aim, aimMet, bonus, forecast: fstats,
    cureYears: run.cureYears.slice(), years: run.age - run.startAge,
    seenP: run.seenP.slice(), quizRight: run.quizRight, quizAsked: run.quizAsked.length,
    journal: (run.journal || []).slice(),
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
