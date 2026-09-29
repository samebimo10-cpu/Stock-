// Tycoon Rush rules. No DOM in here, so Node can run it for tests and balance runs.
//
// The whole market path (moods, inflation, rates, returns, headlines) is generated
// up front from the seed. The player's choices never draw from that stream, so a
// Daily Market or a Duel code gives everyone exactly the same years.

import {
  CURRENCIES, LIFESTYLES, CHARACTERS, ASSETS, COMPANIES, NEWS, SWANS, CARDS, EVENTS,
  ERAS, CHALLENGES, GLOSSARY, HOMES, HOME_ORDER, DISTRICTS, DISTRICT_ORDER, SECURITY, CARS,
  PARTNERS, PARTNER_TYPES, SCHOOLS, SCHOOL_ORDER, UNI_ABROAD, KID_OUTCOMES, WORLD_RULES,
  CIRCLE_TYPES, CIRCLE_ASKS, NAMES, ZONE_TYPES, ZONE_ORDER, COUNTRIES, TITLES, ZONE_NEWS, GOLDEN,
} from './content.js';
import { PRINCIPLES, MOMENTS, PLANS, QUIZ } from './learn.js';
import { STORY, CAST as STORY_CAST, GOALS, EARNED, chapterOf } from './story.js';

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
  let carry = {};
  const country = COUNTRIES[currency] || COUNTRIES.USD;
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
    // Region news: land, oil, banks and the currency. Some of it is only rumour.
    const znRoll = r();
    const znPick = r();
    const znTrue = r();
    let Z = null;
    let zReal = false;
    if (!era && znRoll < 0.4) {
      const pool = ZONE_NEWS.filter((z) => !z.fxOnly || prof.fx);
      Z = pool[Math.floor(znPick * pool.length)];
      zReal = znTrue < Z.real;
    }
    const land = {};
    const tilt = { boom: 0.02, steady: 0, over: 0.03, crash: -0.05, recov: 0.01 }[state];
    for (const z of ZONE_ORDER) land[z] = Math.pow(Math.max(0.3, 1 + ZONE_TYPES[z].growth + tilt + 0.06 * r.normal()), ypt) * (carry[z] || 1);
    carry = {};
    if (Z && zReal && Z.land) {
      land[Z.zone] *= Z.land;
      if (Z.also) land[Z.also] *= Z.land;
      if (Z.next) carry[Z.zone] = Z.next;
    }
    const seqRoll = r();

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
      if (Z && zReal && Z.oil && c.id === 'NXO') x += Z.oil;
      if (Z && zReal && Z.banks && c.id === 'ZNK') x += Z.banks;
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
      const zDev = Z && zReal && Z.dev ? Z.dev : 0;
      devJump = devRoll < prof.jumpP * k || !!(adj.dev) || !!(swan && swan.dev) || !!zDev;
      if (devJump) fxDev = (1 + fxDev) * (1 + (adj.dev || (swan && swan.dev) || zDev || prof.jump)) - 1;
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
      land: Object.fromEntries(ZONE_ORDER.map((z) => [z, land[z] * Math.pow(1 + infl, ypt) - 1])),
      seq: seqRoll,
      zone: Z ? {
        id: Z.id, real: zReal, zone: Z.zone,
        text: Z.text.replace('{zone}', Z.zone ? country.zones[Z.zone] : ''),
        acquire: zReal && !!Z.acquire, grab: zReal && !!Z.grab, flood: zReal && !!Z.flood,
        costs: zReal && Z.costs ? Z.costs : 1, farmYield: zReal && Z.farmYield ? Z.farmYield : Z.flood && zReal ? 0.6 : 1,
      } : null,
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
  if (m.devJump && naira && !(m.zone && m.zone.id === 'float')) {
    items.push({ kind: 'signal', real: true, tag: 'fx', text: r.pick(NEWS.fx) });
  } else if (m.zone) {
    items.push({ kind: 'signal', real: m.zone.real, tag: 'zone', zone: m.zone.zone, id: m.zone.id, text: m.zone.text });
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
  sprint: { name: '10-Year Sprint', ypt: 2, startAge: 22, timer: 0, years: 10 },
  journey: { name: 'Wisdom Journey', ypt: 1, startAge: 22, timer: 0, learn: true },
  classic: { name: 'Classic', ypt: 2, startAge: 22, timer: 0 },
  blitz: { name: 'Blitz', ypt: 4, startAge: 24, timer: 15 },
  daily: { name: 'Daily Market', ypt: 2, startAge: 22, timer: 0 },
  duel: { name: 'Duel', ypt: 2, startAge: 22, timer: 0 },
  era: { name: 'Eras', ypt: 2, startAge: 22, timer: 0 },
  weekly: { name: 'Weekly Challenge', ypt: 2, startAge: 22, timer: 0 },
};

// Two world rules per run, drawn from the seed so a Daily or a Duel shares them.
export function drawRules(seed) {
  const r = rngFor(seed, 'rules', 0);
  const keys = Object.keys(WORLD_RULES);
  const a = keys.splice(Math.floor(r() * keys.length), 1)[0];
  return [a, keys[Math.floor(r() * keys.length)]];
}

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
  const startAge = era ? era.startAge : me ? clamp(Math.round(me.age), 16, 75) : opts.startAge ? clamp(Math.round(opts.startAge), 16, 50) : ch && ch.startAge ? ch.startAge : c.startAge && mode.startAge === 22 ? c.startAge : mode.startAge;
  const ypt = mode.ypt;
  const deadline = mode.years ? startAge + mode.years : Math.max(asc >= 12 ? 56 : 60, me ? startAge + 8 : 0);
  const turns = era ? era.states.length : Math.max(3, Math.round((deadline - startAge) / ypt));
  const seed = String(opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9));

  const run = {
    v: 2, seed, mode: opts.mode || 'classic', char: opts.char || 'graduate', currency, asc,
    eraId: era ? era.id : null, challengeId: ch ? ch.id : null,
    ypt, turns, startAge, age: startAge, turn: 0, phase: 'alloc', deadline,
    salary: c.salary * scale * (ch && ch.salaryMult ? ch.salaryMult : 1),
    baseCosts: c.costs * scale * (asc >= 10 ? 1.1 : 1),
    costMult: 1,
    life: ch && ch.lockLife != null ? ch.lockLife : c.life,
    startLife: ch && ch.lockLife != null ? ch.lockLife : c.life,
    joy: c.joy != null ? c.joy : 60,
    cash: c.cash * scale * (asc >= 4 ? 0.5 : 1) * (ch && ch.cashMult ? ch.cashMult : 1) * (1 + clamp(opts.cashBoost || 0, 0, 0.3)) + (opts.inherit || 0),
    h: {
      save: 0, index: 0, stocks: COMPANIES.map(() => 0), crypto: (c.crypto || 0) * scale, fx: 0,
      prop: { v: 0, debt: 0, bought: -1 },
      biz: { c: ((c.biz || 0) + ((ch && ch.biz) || 0)) * scale, managed: false, profit: 0 },
      ponzi: null, angel: null, scam: 0,
    },
    cards: [], charges: {}, lev: 0,
    flags: { weather: c.weather || 1, skillAge: startAge, riskyJob: !!c.riskyJob },
    prices: 1, infl: profileOf(currency).infl, rate: 0,
    px: { save: [1], index: [1], stocks: [1], prop: [1], crypto: [1], biz: [1], fx: [1] },
    last: {},
    market: [],
    hist: [], seenEv: [], learned: [], reveal: {}, crystal: {},
    log: { panic: 0, panicAge: 0, scam: 0, idle: 0, conc: 0, concAge: 0, concAsset: '', creep: 0, debt: 0, best: 0, bestAge: 0, bestAsset: '', growth: 1, years: 0, efund: 0, trapTaps: 0 },
    negTurns: 0, lastResult: null, pending: null, offer: null, result: null,
    flow: { buy: {}, sell: {} },
    salaryStart: c.salary * scale,
    // The learning layer. Probability tools unlock after a player's first runs.
    learnMode: !!mode.learn,
    think: opts.think !== false,
    aim: opts.aim || null,
    plan: { pyf: 0, mix: 'balanced', rebalance: false },
    forecast: null, fc: [],
    cures: [false, false, false, false, false, false, false], cureYears: [0, 0, 0, 0, 0, 0, 0], curesLit: [],
    seenP: [], recentMoments: [], quiz: null, quizAsked: [], quizRight: 0,
    // A diary of every year and every decision, for the end-of-game report.
    journal: [],
    // The life layer: where you live, what you drive, who you live with.
    sex: opts.sex === 'f' ? 'f' : 'm',
    region: opts.region || 'westafrica',
    home: { id: c.home || 'studio', district: c.district || 'suburb', own: false, levy: false, guard: false, cctv: false, rentMult: 1 },
    car: { id: c.car || 'none', v: 0, loan: 0, loan0: 0 },
    partner: null, kids: [], nanny: 0,
    circle: [], rep: 50, giving: 0,
    land: [], zonePx: Object.fromEntries(ZONE_ORDER.map((z) => [z, 1])), deals: {},
    rules: era || mode.years || opts.rules === false ? [] : drawRules(seed),
    feeIdx: 1, frugalYears: 0, milestones: [], got: { homes: [], cars: [], districts: [], zones: [], golden: [] },
    stats: { joySum: 0, years: 0, trustSum: 0, trustYears: 0, givingSum: 0 },
    envelopes: !!opts.envelopes, weekend: !!opts.weekend, bonusWisdom: 0, gen: opts.gen || 1,
    forceEvent: null, teaser: null,
    // The story layer: chapters, goals, memories and threads left open.
    story: { chapter: chapterOf(startAge).id, goal: null, goalsDone: [], memories: [], threads: [], decisions: [], comp: null, debtPeak: 0, propsBought: 0, bizStarted: 0 },
    beh: {}, side: false, freeAge: null,
    stopAtFree: opts.stopAtFree ?? ['daily', 'duel', 'era', 'weekly', 'sprint'].includes(opts.mode),
  };
  run.car.v = CARS[run.car.id].price * run.salaryStart;
  run.market = genMarket({ seed, turns, ypt, currency, asc, era });
  run.rate = policyRate(run.infl, 'steady', profileOf(currency));
  run.h.biz.profit = bizProfit(run, 1);
  learn(run, 'freedom');
  if (me) applyMe(run, me);
  initLife(run);
  run.circle = makeCircle(run);
  run.circle.push(...makeCast(run));
  run.story.goal = pickGoal(run, goalContext(run));
  if (run.h.biz.c > 0) run.story.bizStarted = 1;
  run.hist.push(snapshot(run));
  if (run.aim) seeP(run, 'h_aim');
  addMemory(run, { type: 'milestone', title: run.custom ? 'Where you started' : 'Your first job', text: `Age ${startAge}, earning ${fmt(run.salary / 12, currency)} a month.`, tags: ['start'] });
  // The first decision comes before the first year, so play starts at once.
  if (!era) { const ev = evById('first_step'); run.pending = { id: 'first_step', v: ev.setup(run, helpers(run, rngFor(seed, 'setup', 0)), {}) }; run.seenEv.push('first_step'); }
  return run;
}

function applyMe(run, me) {
  const n = (x) => Math.max(0, Number(x) || 0);
  run.char = 'me';
  run.custom = true;
  run.salary = n(me.pay) * 12;
  run.salaryStart = Math.max(1, run.salary);
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
  run.home.id = HOMES[me.home] ? me.home : 'studio';
  run.home.district = DISTRICTS[me.district] ? me.district : 'suburb';
  run.home.own = h.prop.home > 0;
  run.car.id = CARS[me.car] ? me.car : 'none';
  // A car you already own counts at about 60% of the new price.
  run.car.v = 0.6 * CARS[run.car.id].price * run.salaryStart;
}

// The starting home, car and district are already inside a character's living
// costs, so split those costs into "everyday" spending plus the life layer.
function initLife(run) {
  const lc = lifeCosts(run).total;
  run.baseCosts = Math.max(0.4 * run.baseCosts, run.baseCosts - lc);
  run.refJoy = lifeJoy(run);
  gotIt(run, 'homes', run.home.id);
  gotIt(run, 'districts', run.home.district);
  if (run.car.id !== 'none') gotIt(run, 'cars', run.car.id);
}

// Saved games from before the life layer carry on with sensible defaults.
export function upgradeRun(run) {
  if (!run) return run;
  if (run.v >= 2) return upgradeStory(run);
  const c = CHARACTERS[run.char] || CHARACTERS.graduate;
  run.v = 2;
  run.deadline = run.startAge + run.turns * run.ypt;
  run.think = true;
  run.sex = 'm';
  run.region = run.region || 'westafrica';
  run.home = { id: c.home || 'studio', district: c.district || 'suburb', own: (run.h.prop.home || 0) > 0, levy: false, guard: false, cctv: false, rentMult: 1 };
  run.car = { id: 'none', v: 0, loan: 0, loan0: 0 };
  run.partner = run.flags.married ? { name: 'Your partner', sex: 'f', type: 'balanced', trust: 60, revealed: true, since: run.age, pay: 0, legacy: true, look: {} } : null;
  run.kids = Array.from({ length: run.flags.kids || 0 }, (_, i) => ({ name: `Child ${i + 1}`, sex: i % 2 ? 'f' : 'm', born: run.age - 2 - i * 2, school: 'public', legacy: true, upSum: 0, schoolYrs: 0 }));
  run.nanny = 0;
  run.circle = []; run.rep = 50; run.giving = 0;
  run.land = []; run.zonePx = Object.fromEntries(ZONE_ORDER.map((z) => [z, 1])); run.deals = {};
  run.rules = [];
  run.feeIdx = run.prices; run.frugalYears = 0; run.milestones = [];
  run.got = { homes: [], cars: [], districts: [], zones: [], golden: [] };
  run.stats = { joySum: 0, years: 0, trustSum: 0, trustYears: 0, givingSum: 0 };
  run.envelopes = false; run.bonusWisdom = 0; run.gen = 1; run.forceEvent = null; run.teaser = null;
  initLife(run);
  run.circle = makeCircle(run);
  return upgradeStory(run);
}

// Saved games from before the story layer get an empty story to grow into.
export function upgradeStory(run) {
  if (!run || run.story) return run;
  run.story = { chapter: chapterOf(run.age).id, goal: null, goalsDone: [], memories: [], threads: [], decisions: [], comp: null, debtPeak: 0, propsBought: 0, bizStarted: run.h.biz.c > 0 ? 1 : 0 };
  run.beh = run.beh || {}; run.side = !!run.side; run.freeAge = run.freeAge || null;
  run.stopAtFree = ['daily', 'duel', 'era', 'weekly', 'sprint'].includes(run.mode);
  if (!run.circle.some((c) => c.cast)) run.circle.push(...makeCast(run));
  run.story.goal = pickGoal(run, goalContext(run));
  if (run.phase === 'event') run.phase = 'alloc';
  if (run.phase === 'cards') { run.phase = 'alloc'; run.pending = null; if (!endTurn(run)) dealNext(run); }
  return run;
}

// ---------------------------------------------------------------- read helpers

export const has = (run, id) => run.cards.includes(id);
export const era = (run) => (run.eraId ? ERAS.find((e) => e.id === run.eraId) : null);
export const challenge = (run) => (run.challengeId ? CHALLENGES.find((c) => c.id === run.challengeId) : null);
export const atSea = (run) => !!CHARACTERS[run.char].sailor && run.turn % 2 === 1;
export const lifeLocked = (run) => { const ch = challenge(run); return !!(ch && ch.lockLife != null); };

export function isOpen(run, asset) {
  if (asset === 'fx' && !profileOf(run.currency).fx) return false;
  if (asset === 'crypto' && rule(run, 'cryptoBan')) return false;
  const ch = challenge(run);
  return !(ch && ch.off && ch.off.includes(asset));
}

// Living costs a year: everyday spending (food, clothes, outings) scaled by
// lifestyle and household, plus the life layer: home, car, security, children.
export function everyday(run) {
  const P = run.partner;
  const household = P && !P.legacy ? 1.4 * PARTNERS[P.type].costs : 1;
  return run.baseCosts * LIFESTYLES[run.life].mult * run.costMult * (has(run, 'frugal_genius') ? 0.9 : 1) * household;
}

export function costs(run) {
  return everyday(run) + (run.home ? lifeCosts(run).total : 0);
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
    + h.biz.c + (h.ponzi ? h.ponzi.v : 0) + (h.angel ? h.angel.amt : 0) + (h.scam || 0)
    + (run.car ? run.car.v - run.car.loan : 0) + (run.land ? landValue(run) : 0);
}

// The home you live in earns no rent (it saves rent, which is already in your
// living costs); only the rest of your property is let out.
export const rentable = (run) => Math.max(0, run.h.prop.v - (run.h.prop.home || 0));
export const rentYield = (run) => profileOf(run.currency).rent * (has(run, 'landlord') ? 1.25 : 1) * (rule(run, 'rentControl') ? 0.8 : 1);
export const mortRate = (run) => (run.mortFix && run.turn < run.mortFix.until ? run.mortFix.rate : run.rate + 0.03 + (rule(run, 'tightMoney') ? 0.02 : 0) - (rule(run, 'cheapMort') ? 0.02 : 0));
export const debtRate = (run) => run.rate + 0.15 + (rule(run, 'tightMoney') ? 0.02 : 0);
export const bizManaged = (run) => run.h.biz.managed || has(run, 'manager_pro');

export function bizProfit(run, mood) {
  const c = run.h.biz.c;
  if (c <= 0) return 0;
  const K = 12 * 24000 * CURRENCIES[run.currency].scale * run.prices;
  let p = c * 0.18 * mood / (1 + c / K);
  if (has(run, 'franchise')) p *= 1.3;
  if (has(run, 'golden_goose')) p *= 2;
  if (rule(run, 'bizHoliday')) p *= 1.2;
  if (run.h.biz.managed && !has(run, 'manager_pro')) p *= run.h.biz.share ? 0.65 : 0.75;
  return p * bizBoost(run);
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
  const farm = run.land ? farmIncome(run) : 0;
  let total = invest + rent + biz + farm - mort - debt;
  if (has(run, 'tax_smart') && total > 0) total *= 1.1;
  return { invest, rent, biz, farm, mort, debt, total };
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

// ---------------------------------------------------------------- the life layer

export const rule = (run, id) => !!(run.rules && run.rules.includes(id));
// Today's price of one starting salary: the unit every life price is quoted in.
export const unit = (run) => run.salaryStart * run.prices;
const gotIt = (run, kind, id) => { if (run.got && !run.got[kind].includes(id)) run.got[kind].push(id); };

export const lifeJoy = (run) => HOMES[run.home.id].joy + CARS[run.car.id].joy + DISTRICTS[run.home.district].commute;
export const carLoanRate = (run) => run.rate + 0.08 + (rule(run, 'tightMoney') ? 0.02 : 0);
export const ltv = (run) => (rule(run, 'strictBanks') ? 0.5 : 0.7);
export const homePrice = (run, id, d) => (HOMES[id].buy || 0) * unit(run) * DISTRICTS[d].price;
export const homeRent = (run, id, d) => HOMES[id].rent * unit(run) * DISTRICTS[d].price * (rule(run, 'rentControl') ? 0.8 : 1);
export const carPrice = (run, id) => CARS[id].price * unit(run) * (rule(run, 'carBan') ? 2 : 1);
export const kidAge = (run, k) => run.age - k.born;
const feeUnit = (run) => run.salaryStart * (run.feeIdx || run.prices) * (rule(run, 'feeBoom') ? 1.5 : 1);

export function stars(run) {
  const h = run.home;
  return Math.min(5, DISTRICTS[h.district].security + (h.levy ? 1 : 0) + (h.guard ? 1 : 0) + (h.cctv ? 1 : 0));
}

export function kidCost(run, k) {
  if (k.legacy) return 0;
  const a = kidAge(run, k);
  let c = 0;
  if (a < 18) c += 0.06 * unit(run);
  if (a >= 5 && a < 18) c += SCHOOLS[k.school].fee * feeUnit(run);
  if (a >= 18 && a < 22 && k.uni === 'abroad') c += UNI_ABROAD.fee * feeUnit(run);
  if (a >= 22 && k.outcome === 'support') c += 0.1 * unit(run);
  return c;
}

export function lifeCosts(run) {
  const o = { rent: 0, upkeep: 0, tax: 0, car: 0, loan: 0, security: 0, kids: 0, nanny: 0 };
  const H = HOMES[run.home.id];
  if (run.home.own) o.upkeep = (run.h.prop.home || 0) * H.upkeep;
  else o.rent = homeRent(run, run.home.id, run.home.district) * (run.home.rentMult || 1);
  if (rule(run, 'propTax')) o.tax = 0.01 * run.h.prop.v;
  o.car = CARS[run.car.id].run * unit(run);
  o.loan = run.car.loan > 0 ? run.car.loan * carLoanRate(run) : 0;
  o.security = ((run.home.levy ? SECURITY.levy.cost : 0) + (run.home.guard ? SECURITY.guard.cost : 0)) * run.salary;
  for (const k of run.kids) o.kids += kidCost(run, k);
  if (run.nanny && run.kids.some((k) => kidAge(run, k) < 6)) o.nanny = run.nanny * unit(run);
  o.total = o.rent + o.upkeep + o.tax + o.car + o.loan + o.security + o.kids + o.nanny;
  return o;
}

// Schools you can reach from where you live. Frugal living caps it at budget.
export function schoolsOpen(run) {
  const max = Math.min(DISTRICTS[run.home.district].school, run.life === 0 ? 1 : 3);
  return SCHOOL_ORDER.filter((id) => SCHOOLS[id].rank <= Math.max(0, max));
}

export const mapOpen = (run) => run.age - run.startAge >= 3 || (run.land && run.land.length > 0);
export const plotPrice = (run, z) => ZONE_TYPES[z].price * run.salaryStart * ((run.zonePx && run.zonePx[z]) || 1);
export const landValue = (run) => run.land.reduce((s, l) => s + (l.lost ? 0 : l.plots * plotPrice(run, l.zone)), 0);
export const farmRate = (run, z) => 0.09 * ZONE_TYPES[z].farm * (run.char === 'farmer' ? 1.5 : 1);
export function farmIncome(run) {
  return run.land.reduce((s, l) => s + (l.use === 'farm' && !l.lost ? l.plots * plotPrice(run, l.zone) * farmRate(run, l.zone) : 0), 0);
}

function offerRaw(run, z) {
  const r = rngFor(run.seed, `plot|${z}`, run.turn);
  const claimed = r.weighted({ full: 0.5, progress: 0.3, receipt: 0.2 });
  const u = r();
  const truth = claimed === 'full' ? (u < 0.7 ? 'full' : u < 0.88 ? 'progress' : 'receipt') : claimed === 'progress' ? (u < 0.7 ? 'progress' : 'receipt') : 'receipt';
  const price = plotPrice(run, z) * (1 - TITLES[claimed].discount) * (0.9 + 0.2 * r());
  return { claimed, truth, price };
}

// This year's plot for sale in a zone. The true paperwork shows only after a check.
export function landOffer(run, z) {
  const o = offerRaw(run, z);
  const st = run.deals[`${run.turn}|${z}`] || {};
  return { zone: z, claimed: o.claimed, truth: st.checked ? o.truth : null, price: o.price, checkCost: 0.03 * o.price, checked: !!st.checked, sold: !!st.sold };
}

export function checkLand(run, z) {
  if (!canAct(run)) return false;
  const key = `${run.turn}|${z}`;
  const st = run.deals[key] || {};
  const o = offerRaw(run, z);
  if (st.checked || st.sold || run.cash < 0.03 * o.price) return false;
  run.cash -= 0.03 * o.price;
  run.deals[key] = { ...st, checked: true };
  return true;
}

export function buyLand(run, z) {
  if (!canAct(run) || !ZONE_TYPES[z]) return false;
  const key = `${run.turn}|${z}`;
  const st = run.deals[key] || {};
  const o = offerRaw(run, z);
  if (st.sold || run.cash < o.price) return false;
  run.cash -= o.price;
  run.land.push({ zone: z, plots: 1, paid: o.price, title: o.truth, checked: !!st.checked, use: 'hold', bt: run.turn, built: false });
  run.deals[key] = { ...st, sold: true };
  run.flow.buy.land = (run.flow.buy.land || 0) + o.price;
  gotIt(run, 'zones', z);
  return true;
}

// A plot from someone you trust: full title, below the market price.
function giftPlot(run, z, discount) {
  const price = plotPrice(run, z) * (1 - discount);
  run.cash -= price;
  run.land.push({ zone: z, plots: 1, paid: price, title: 'full', checked: true, use: 'hold', bt: run.turn, built: false });
  gotIt(run, 'zones', z);
  return price;
}

export function setLandUse(run, i, use) {
  const l = run.land[i];
  if (!canAct(run) || !l || l.lost || l.built) return false;
  if (use === 'farm' && ZONE_TYPES[l.zone].farm <= 0) return false;
  if (use === 'build') {
    const cost = 2 * l.plots * plotPrice(run, l.zone);
    if (run.cash < cost) return false;
    run.cash -= cost;
    run.h.prop.v += cost * 0.97;
    run.h.prop.bought = run.turn;
    l.built = true; l.use = 'built';
    learn(run, 'passive');
    return true;
  }
  l.use = use === 'farm' ? 'farm' : 'hold';
  return true;
}

export function sellLand(run, i) {
  const l = run.land[i];
  if (!canAct(run) || !l || l.lost || l.bt === run.turn) return false;
  const v = l.plots * plotPrice(run, l.zone);
  run.cash += v * 0.94;
  run.flow.sell.land = (run.flow.sell.land || 0) + v;
  run.land.splice(i, 1);
  learn(run, 'liquidity');
  return true;
}

// Move house. Buying uses the property engine; the home you live in saves
// rent but earns none. The old home is sold, or kept and let out.
export function moveHome(run, id, d, { buy = false, mortgage = false, keepOld = false } = {}) {
  if (!canAct(run) || !HOMES[id] || !DISTRICTS[d]) return false;
  if (id === run.home.id && d === run.home.district && buy === run.home.own) return false;
  if (buy && !HOMES[id].buy) return false;
  const p = run.h.prop;
  const homeV = run.home.own ? p.home || 0 : 0;
  const share = p.v > 0 ? homeV / p.v : 0;
  const debtOut = p.debt * share;
  const cashIn = homeV > 0 && !keepOld ? homeV * (1 - feeFor(run, 'prop')) - debtOut : 0;
  const moving = 0.02 * unit(run);
  const price = buy ? homePrice(run, id, d) : 0;
  const equity = buy ? (mortgage ? price * (1 - ltv(run)) : price) : 0;
  if (run.cash + cashIn - moving < equity) return false;
  if (homeV > 0) {
    if (keepOld) p.home = 0;
    else { p.v -= homeV; p.debt -= debtOut; p.home = 0; run.cash += cashIn; run.flow.sell.prop = (run.flow.sell.prop || 0) + homeV; }
  }
  run.cash -= moving + equity;
  if (buy) {
    p.v += price * 0.97; p.debt += price - equity; p.home = price * 0.97; p.bought = run.turn;
    run.flow.buy.prop = (run.flow.buy.prop || 0) + equity;
    if (mortgage) { learn(run, 'mortgage'); learn(run, 'leverage'); }
    learn(run, 'passive');
  }
  run.home = { id, district: d, own: buy, levy: false, guard: false, cctv: false, rentMult: 1 };
  gotIt(run, 'homes', id);
  gotIt(run, 'districts', d);
  return true;
}

export function setSecurity(run, key, on) {
  if (!canAct(run) || !SECURITY[key]) return false;
  if (key === 'cctv') {
    const c = SECURITY.cctv.cost * run.salary;
    if (run.home.cctv || !on || run.cash < c) return false;
    run.cash -= c;
    run.home.cctv = true;
    return true;
  }
  run.home[key] = !!on;
  return true;
}

function carSwap(run, id, loan) {
  const trade = run.car.v * 0.9 - run.car.loan;
  if (id === 'none') { run.cash += trade; run.car = { id: 'none', v: 0, loan: 0, loan0: 0 }; return true; }
  const price = carPrice(run, id);
  const need = loan ? Math.max(0, 0.1 * price - Math.max(0, trade)) : price - trade;
  if (run.cash < need) return false;
  run.cash -= need;
  const borrowed = loan ? price - Math.max(0, trade) - need : 0;
  run.car = { id, v: price, loan: borrowed, loan0: borrowed };
  gotIt(run, 'cars', id);
  learn(run, 'creep');
  return true;
}

export function buyCar(run, id, loan = false) {
  if (!canAct(run) || !CARS[id] || id === run.car.id) return false;
  return carSwap(run, id, loan);
}

export function setSchool(run, i, id) {
  const k = run.kids[i];
  if (!canAct(run) || !k || !schoolsOpen(run).includes(id)) return false;
  k.school = id;
  return true;
}

export function setUni(run, i, abroad) {
  const k = run.kids[i];
  if (!canAct(run) || !k) return false;
  const a = kidAge(run, k);
  if (a < 16 || a >= 22) return false;
  k.uni = abroad ? 'abroad' : 'home';
  return true;
}

export function setGiving(run, g) {
  if (!canAct(run)) return false;
  run.giving = clamp(Math.round(g * 100) / 100, 0, 0.15);
  return true;
}

// ---------------------------------------------------------------- people

function pickName(run, r, sex, avoid = []) {
  const pool = (NAMES[run.region] || NAMES.westafrica)[sex].filter((n) => !avoid.includes(n));
  return pool.length ? r.pick(pool) : r.pick((NAMES[run.region] || NAMES.westafrica)[sex]);
}
const usedNames = (run) => [...run.circle.map((c) => c.name), ...(run.partner ? [run.partner.name] : []), ...run.kids.map((k) => k.name)];

function randomLook(r, age, sex = null) {
  const hairs = sex === 'm' ? ['short', 'afro', 'curly', 'bald', 'short'] : sex === 'f' ? ['long', 'bun', 'braids', 'curly', 'wrap', 'afro'] : ['short', 'afro', 'long', 'bun', 'braids', 'curly', 'wrap', 'bald'];
  return { sex, skin: Math.floor(r() * 6), hair: r.pick(hairs), beard: sex === 'm' && r() < 0.25, hairColor: Math.floor(r() * 4), outfit: Math.floor(r() * 6), build: r.pick(['slim', 'average', 'heavy']), age };
}

function makeCircle(run) {
  const r = rngFor(run.seed, 'circle', 'init');
  const rels = [['Uncle', 'm', 30], ['Auntie', 'f', 28], ['Cousin', null, 3], ['Friend', null, 1], ['Old classmate', null, 0], ['Colleague', null, 8]];
  rels.splice(Math.floor(r() * rels.length), 1);
  const out = [];
  rels.forEach(([rel, sx, older], i) => {
    const sex = sx || (r() < 0.5 ? 'm' : 'f');
    const name = pickName(run, r, sex, out.map((c) => c.name));
    const type = r.weighted({ genuine: 0.35, taker: 0.25, schemer: 0.15, helper: 0.25 });
    out.push({ id: `c${i}`, rel, name, sex, type, ageGap: older, look: randomLook(r, run.startAge + older, sex), given: 0, returned: 0, asks: 0, clues: [], known: false });
  });
  return out;
}

function addInLaw(run, P, r) {
  const sex = r() < 0.5 ? 'm' : 'f';
  const type = P.type === 'taker' ? 'taker' : r.weighted({ genuine: 0.4, taker: 0.3, schemer: 0.1, helper: 0.2 });
  run.circle.push({ id: `c${run.circle.length}`, rel: sex === 'm' ? 'Brother-in-law' : 'Sister-in-law', name: pickName(run, r, sex, usedNames(run)), sex, type, ageGap: 2, inlaw: true, look: randomLook(r, run.age + 2, sex), given: 0, returned: 0, asks: 0, clues: [], known: false });
}

// Three people you might marry. Each card shows one clue, right about 70% of the time.
function partnerCandidates(run) {
  const r = rngFor(run.seed, 'partner', run.turn);
  const sex = run.sex === 'f' ? 'm' : 'f';
  const out = [];
  for (let i = 0; i < 3; i++) {
    const type = r.weighted({ saver: 0.22, balanced: 0.26, spender: 0.22, builder: 0.16, taker: 0.14 });
    const honest = r() < 0.7;
    const clueType = honest ? type : r.pick(PARTNER_TYPES.filter((t) => t !== type));
    out.push({ name: pickName(run, r, sex, [...usedNames(run), ...out.map((c) => c.name)]), sex, type, clue: PARTNERS[clueType].clue, look: randomLook(r, run.age + Math.floor(r() * 5) - 2, sex) });
  }
  return out;
}

function marry(run, cand) {
  const r = rngFor(run.seed, 'marry', run.turn);
  const T = PARTNERS[cand.type];
  run.partner = { name: cand.name, sex: cand.sex, type: cand.type, look: cand.look, trust: 60, zero: 0, revealed: false, revealAt: 2 + Math.floor(r() * 3), since: run.age, pay: T.income * run.salary, biz: 0 };
  run.flags.married = true;
  addInLaw(run, run.partner, r);
}

function newKid(run, nanny) {
  const r = rngFor(run.seed, 'kid', run.turn);
  const sex = r() < 0.5 ? 'm' : 'f';
  const P = run.partner;
  const look = randomLook(r, 0, sex);
  if (P && P.look) look.skin = Math.round(((P.look.skin ?? 2) + (run.lookSkin ?? (P.look.skin ?? 2))) / 2);
  run.kids.push({ name: pickName(run, r, sex, usedNames(run)), sex, born: run.age, school: 'public', uni: null, outcome: null, upSum: 0, schoolYrs: 0, look });
  run.nanny = nanny;
  run.flags.kids = run.kids.length;
}

const trust = (run, d) => { if (run.partner) run.partner.trust = clamp(run.partner.trust + d, 0, 100); };
const rep = (run, d) => { run.rep = clamp(run.rep + d, 0, 100); };

export const circleOpen = (run) => run.circle.some((c) => c.asks > 0) || run.rep !== 50 || run.giving > 0;

// ---------------------------------------------------------------- the story layer
//
// Persistent people, memories, goals, chapters and earned cards sit on top of
// the simulation. The story references the simulation state; it never copies
// money around on its own.

export const person = (run, role) => run.circle.find((c) => c.role === role) || null;

function makeCast(run) {
  const r = rngFor(run.seed, 'cast', 'init');
  const used = run.circle.map((c) => c.name);
  return Object.keys(STORY_CAST).map((role) => {
    const sex = r() < 0.5 ? 'm' : 'f';
    const older = { mentor: 30, boss: 12, banker: 8, agent: 6, rival: 4, parent: 27, cautious: 1, ambitious: 0 }[role] || 0;
    const name = pickName(run, r, sex, used);
    used.push(name);
    return {
      id: `k_${role}`, role, cast: true, rel: STORY_CAST[role].rel, name, sex, ageGap: older,
      type: role === 'parent' ? r.weighted({ genuine: 0.65, taker: 0.35 }) : role === 'rival' ? 'schemer' : 'helper',
      look: randomLook(r, run.startAge + older, sex), given: 0, returned: 0, asks: 0, clues: [], known: role !== 'parent',
      trust: 50, closeness: role === 'parent' ? 70 : 40, conflict: 0, support: 0, history: [],
      skill: 0.2 + 0.7 * r(), style: r.pick(['tft', 'generous', 'grim', 'aggressive']),
    };
  });
}

function addMemory(run, m) {
  if (!run.story) return;
  run.story.memories.push({ age: run.age, type: m.type, title: m.title, text: m.text || '', impact: Math.round(m.impact || 0), tags: m.tags || [] });
  if (run.story.memories.length > 120) run.story.memories.shift();
}

const niceNum = (n) => { if (n <= 0) return 0; const p = Math.pow(10, Math.floor(Math.log10(n)) - 1); return Math.round(n / p) * p; };

export function goalContext(run) {
  const P_ = passive(run);
  const debt = run.h.prop.debt + run.car.loan + Math.max(0, -run.cash);
  if (run.story) run.story.debtPeak = Math.max(run.story.debtPeak || 0, debt);
  return {
    money: (n) => fmt(n, run.currency), nice: niceNum, unit: unit(run), costs: costs(run), save: run.h.save,
    invested: run.h.index + stocksTotal(run) + run.h.crypto + run.h.fx, nw: netWorth(run), ownHome: !!run.home.own,
    homeDeposit: homePrice(run, 'flat2', run.home.district) * (1 - ltv(run)), biz: run.h.biz.c, cash: Math.max(0, run.cash),
    passive: P_.total, bowl: bowl(run), kidsInSchool: run.kids.filter((k) => { const a = run.age - k.born; return a >= 3 && a < 18; }).length,
    fees: run.kids.reduce((s, k) => s + SCHOOLS[k.school].fee * run.salaryStart * (run.feeIdx || 1), 0) || 0.1 * unit(run),
    debt, debtPeak: (run.story && run.story.debtPeak) || debt, aim: run.aim,
  };
}

function pickGoal(run, x) {
  const ch = chapterOf(run.age).id;
  const done = run.story.goalsDone;
  const g = GOALS.find((q) => q.id !== 'freedom' && q.chapters.includes(ch) && !done.includes(q.id) && (!q.need || q.need(x)) && !q.done(x));
  return g ? g.id : 'freedom';
}

export function goalView(run) {
  if (!run.story || !run.story.goal) return null;
  const g = GOALS.find((q) => q.id === run.story.goal);
  if (!g) return null;
  const x = goalContext(run);
  return { id: g.id, title: g.title(x), prog: clamp(g.prog(x), 0, 1), tags: g.tags };
}

// Once a year: behaviour counters, earned cards, goals and chapters.
function storyYear(run, res, ctx) {
  const S = run.story;
  const b = run.beh;
  const y = run.ypt;
  const add = (k, on) => { if (on) b[k] = (b[k] || 0) + y; };
  add('pyfYears', run.plan.pyf >= 0.1 && (ctx.pyf || 0) > 0);
  add('efundYears', run.h.save >= costs(run));
  add('leanYears', run.life >= 1 && costs(run) <= 0.6 * run.salary);
  add('indexYears', run.h.index > 0);
  add('managedYears', run.h.biz.c > 0 && bizManaged(run));
  add('rentYears', rentable(run) > 0);
  add('sideYears', !!run.side);
  b.bigBiz = b.bigBiz || run.h.biz.c >= 3 * run.salary;
  b.companies = Math.max(b.companies || 0, run.h.stocks.filter((x) => x > 0).length);
  b.halfFree = b.halfFree || res.passive >= 0.5 * res.bowl;
  if (run.joy < 30) b.low = true;
  if (b.low && run.joy > 65) b.comeback = true;
  if (res.fc && Math.abs(res.fc.p - res.fc.ideal) <= 0.1) b.goodCalls = (b.goodCalls || 0) + 1;
  b.held = (run.flags.held || 0) + (b.heldEv || 0);
  b.goals = S.goalsDone.length;
  res.cardsEarned = [];
  for (const e of EARNED) {
    if (has(run, e.card) || !e.test(b)) continue;
    const card = cardById(e.card);
    if (!card) continue;
    run.cards.push(e.card);
    if (card.take) card.take(run, helpers(run, rngFor(run.seed, 'take', run.turn)));
    res.cardsEarned.push({ id: e.card, name: card.name, why: e.why, text: card.text });
    addMemory(run, { type: 'milestone', title: `You became: ${card.name}`, text: e.why, tags: ['card'] });
  }
  const x = goalContext(run);
  if (S.goal) {
    const g = GOALS.find((q) => q.id === S.goal);
    if (g && g.done(x) && g.id !== 'freedom') {
      S.goalsDone.push(g.id);
      res.goalDone = { id: g.id, title: g.title(x), reward: g.reward };
      run.joy = clamp(run.joy + 5, 0, 100);
      run.bonusWisdom = (run.bonusWisdom || 0) + 5;
      addMemory(run, { type: 'milestone', title: g.title(x), text: g.reward, tags: ['goal'] });
      S.goal = null;
    }
  }
  if (!S.goal || S.goal === 'freedom') S.goal = pickGoal(run, x);
  const ch = chapterOf(run.age).id;
  if (ch !== S.chapter) { S.chapter = ch; res.chapter = ch; }
}

// The story director: one event a year, chosen from what is going on in your
// life, the economy, your goal and the threads left open by earlier choices.
function drawNext(run) {
  const S = run.story;
  const last = run.market[run.turn - 1];
  const r = rngFor(run.seed, 'ev', run.turn);
  const recent = (id) => run.seenEv.slice(-6).includes(id);
  if (last && last.devJump && profileOf(run.currency).fx) return { id: 'deval' };
  if (run.partner && run.partner.zero >= 2) return { id: 'separation' };
  if (run.frugalYears >= 2) { run.frugalYears = 0; run.flags.frugalBurn = true; return { id: 'burnout' }; }
  if (run.joy < 20 && r() < 0.65) return { id: 'burnout' };
  const due = S.threads.findIndex((t) => t.due <= run.age);
  if (due >= 0) {
    const t = S.threads.splice(due, 1)[0];
    const ev = evById(t.id);
    if (ev && (!ev.cond || ev.cond(run))) return { id: t.id, v: t.v };
  }
  if (run.forceEvent) {
    const f = evById(run.forceEvent);
    run.forceEvent = null;
    run.teaser = null;
    if (f && (!f.cond || f.cond(run))) return { id: f.id };
  }
  // The economy reaches into your life.
  const riskyNow = run.h.index + stocksTotal(run) + run.h.crypto;
  if (last && !run.eraId) {
    if (last.state === 'crash' && riskyNow > 0.15 * Math.max(1, netWorth(run)) && !recent('crash_advice') && r() < 0.85) return { id: 'crash_advice' };
    if (last.dRate > 0.008 && run.h.prop.debt > 0 && !(run.mortFix && run.turn < run.mortFix.until) && r() < 0.7) return { id: 'rate_hike' };
    if ((run.market[run.turn] || last).val > 1.2 && ['boom', 'over'].includes(last.state) && !recent('boom_fomo') && r() < 0.35) return { id: 'boom_fomo' };
    if (last.infl > profileOf(run.currency).infl + 0.04 && !recent('infl_squeeze') && r() < 0.35) return { id: 'infl_squeeze' };
  }
  if (run.h.biz.c > 0 && !recent('price_war') && ((!S.comp && r() < 0.2) || (S.comp && S.comp.next === 'D' && r() < 0.6))) return { id: 'price_war' };
  // Otherwise a weighted pick, tilted by chapter and goal.
  const ch = chapterOf(run.age).id;
  const goal = S.goal && GOALS.find((q) => q.id === S.goal);
  const pool = {};
  for (const e of ALL_EVENTS) {
    if (e.forced || e.thread || recent(e.id)) continue;
    if (e.once && run.seenEv.includes(e.id)) continue;
    if (e.chapter && !e.chapter.includes(ch)) continue;
    if (e.cond && !e.cond(run)) continue;
    let w = typeof e.w === 'function' ? e.w(run) : e.w;
    if (e.id === 'promo' && has(run, 'networker')) w *= 2;
    if (run.life === 0 && e.id === 'medical') w *= 1.8;
    if (run.life === 0 && e.id === 'car') w *= 2;
    if (e.id === 'medical' && rule(run, 'hospitalFees')) w *= 1.3;
    if (e.id === 'circle' && rule(run, 'bigFamily')) w *= 2;
    if (e.chapter) w *= 1.6;
    if (goal && e.tags && e.tags.some((t) => goal.tags.includes(t))) w *= 2.2;
    if (run.flags.retired && ['promo', 'layoff', 'gig', 'course', 'raise', 'bonus', 'pension'].includes(e.id)) w = 0;
    if (w > 0) pool[e.id] = w;
  }
  return { id: r.weighted(pool) };
}

function dealNext(run, res) {
  const nx = drawNext(run);
  const ev = evById(nx.id);
  const v0 = nx.v || {};
  const h = helpers(run, rngFor(run.seed, 'setup', run.turn));
  run.pending = { id: nx.id, v: ev.setup ? { ...v0, ...(ev.setup(run, h, v0) || {}) } : v0 };
  run.seenEv.push(nx.id);
  if (res) res.next = nx.id;
}

// Helpers the story events use; they call into the simulation.
function storyHelpers(run, h) {
  const P = (role) => person(run, role);
  const lastState = () => (run.turn > 0 ? run.market[run.turn - 1].state : 'steady');
  const x = {
    name: (role) => (P(role) || {}).name || 'Someone',
    rel: (role, patch) => {
      const p = P(role);
      if (!p) return { trust: 50, closeness: 40, conflict: 0, support: 0 };
      if (patch) {
        for (const [k, d] of Object.entries(patch)) p[k] = clamp((p[k] || 0) + d, 0, 100);
        p.history = p.history || [];
      }
      return p;
    },
    skill: (role) => (P(role) || { skill: 0.5 }).skill,
    // A costly signal: skilled people put their own money in more often. The
    // clue is honest 70% of the time.
    signal: (role) => { const good = x.skill(role) > 0.55; return h.r() < 0.7 ? good : !good; },
    follow: (id, years, v = {}) => { run.story.threads.push({ id, due: run.age + Math.max(1, years), v }); },
    memory: (type, title, text, impact, tags) => addMemory(run, { type, title, text, impact, tags }),
    unit: () => unit(run),
    costs: () => costs(run),
    fee: () => run.salaryStart * (run.feeIdx || 1) * (rule(run, 'feeBoom') ? 1.5 : 1),
    risky: () => run.h.index + stocksTotal(run) + run.h.crypto,
    invest: (asset, amt) => {
      const a = Math.max(0, Math.min(amt, Math.max(0, run.cash)));
      run.cash -= a; run.h[asset] += a;
      run.flow.buy[asset] = (run.flow.buy[asset] || 0) + a;
      if (asset === 'index') learn(run, 'index');
      return a;
    },
    sellRisky: (frac, to = 'cash') => {
      let got = 0;
      for (const a of ['index', 'crypto']) { const s = run.h[a] * frac; run.h[a] -= s; got += s * (1 - feeFor(run, a)); run.flow.sell[a] = (run.flow.sell[a] || 0) + s; }
      run.h.stocks = run.h.stocks.map((v) => { const s = v * frac; got += s * (1 - feeFor(run, 'stocks')); run.flow.sell.stocks = (run.flow.sell.stocks || 0) + s; return v - s; });
      if (to === 'save') run.h.save += got; else run.cash += got;
      return got;
    },
    beh: (k) => { run.beh[k === 'held' ? 'heldEv' : k] = (run.beh[k === 'held' ? 'heldEv' : k] || 0) + 1; },
    // Bargaining power: savings to fall back on, fresh skills, a good year and
    // a boss who trusts you all raise your odds.
    batna: () => {
      const months = run.h.save / Math.max(1, costs(run) / 12);
      const fresh = run.age - (run.flags.skillAge ?? run.startAge) <= 3;
      const mood = { boom: 0.1, over: 0.05, steady: 0, recov: 0, crash: -0.15 }[lastState()];
      const boss = P('boss');
      return clamp(0.25 + Math.min(0.3, months * 0.025) + (fresh ? 0.12 : 0) + mood + ((boss ? boss.trust : 50) - 50) / 250, 0.05, 0.85);
    },
    mortRate: () => mortRate(run),
    fixRate: () => { run.cash -= 0.01 * run.h.prop.debt; run.mortFix = { rate: mortRate(run), until: run.turn + Math.max(1, Math.round(5 / run.ypt)) }; },
    repay: (amt) => { const a = Math.max(0, Math.min(amt, Math.max(0, run.cash), run.h.prop.debt)); run.cash -= a; run.h.prop.debt -= a; return a; },
    side: (on) => { run.side = !!on; },
    // A common-value auction: the rival bids around the true value, so you
    // tend to win exactly when you have overestimated it.
    auction: (v, k) => {
      const bid = v.P * k;
      if (bid <= v.V * v.rival) return 'Someone else bid more. The flat is gone.';
      return `You won the bidding! ${x.buyRental(bid, v.V)}`;
    },
    buyRental: (price, value) => {
      const dep = (1 - ltv(run)) * price;
      run.cash -= dep;
      run.h.prop.v += value * 0.97;
      run.h.prop.debt += price - dep;
      run.h.prop.bought = run.turn;
      run.flow.buy.prop = (run.flow.buy.prop || 0) + dep;
      run.story.propsBought = (run.story.propsBought || 0) + 1;
      learn(run, 'mortgage');
      const over = price > value * 1.02;
      addMemory(run, { type: 'property', title: 'You bought a rental flat', text: `Paid ${fmt(price, run.currency)}; the survey later put it at ${fmt(value, run.currency)}.`, impact: value - price, tags: ['property', 'decision', over ? 'loss' : 'win'] });
      return `Keys in hand for ${fmt(price, run.currency)}. The survey puts it at about ${fmt(value, run.currency)}${over ? ': you paid over the odds' : ': a fair deal'}.`;
    },
    // The price war is a repeated prisoner's dilemma. The rival plays a hidden
    // strategy against your last move.
    rivalMove: () => {
      const rv = P('rival');
      const c = run.story.comp || (run.story.comp = { style: rv ? rv.style : 'tft', you: null, everD: false, next: null });
      if (c.next) return c.next;
      return c.style === 'aggressive' || h.r() < 0.6 ? 'D' : 'C';
    },
    priceWar: (you, them) => {
      const c = run.story.comp;
      const k = { CC: 1, CD: 0.72, DC: 1.25, DD: 0.85 }[you + them];
      run.h.biz.warK = k; run.h.biz.warT = run.turn;
      c.you = you; c.everD = c.everD || you === 'D';
      const rr = h.r();
      c.next = c.style === 'tft' ? you : c.style === 'grim' ? (c.everD ? 'D' : 'C') : c.style === 'generous' ? (you === 'D' && rr > 0.4 ? 'D' : 'C') : (rr < 0.7 ? 'D' : you);
      if (c.next === 'D') x.follow('price_war', 1, {});
      x.rel('rival', { conflict: you === 'D' ? 10 : -5, trust: you === 'C' ? 6 : -6 });
      const txt = { CC: 'Both of you hold prices. Business as usual, and good margins.', CD: 'You held steady while they cut. You lose customers this year.', DC: 'You undercut them and win a flood of customers this year.', DD: 'Both of you slash prices. Everyone is busy and nobody makes much.' }[you + them];
      return `${txt} ${c.next === 'D' ? 'They look ready for another round.' : 'Things look calmer across the street.'}`;
    },
    // The principal-agent problem: a profit share lines the manager's interest up with yours.
    hire: (kind) => {
      const b = run.h.biz;
      if (kind === 'salary') {
        if (run.cash < managerCost(run)) return 'You can\'t afford their salary yet.';
        run.cash -= managerCost(run); b.managed = true; b.share = false;
      } else { b.managed = true; b.share = true; }
      b.profit = bizProfit(run, 1);
      learn(run, 'passive');
      addMemory(run, { type: 'business', title: 'You hired a manager', text: kind === 'share' ? 'On a share of the profit.' : 'On a fixed salary.', tags: ['business', 'decision'] });
      return kind === 'share' ? 'They take a share of the profit, and treat the place like their own.' : 'They start on Monday. The business runs without you now.';
    },
    sellBiz: (price) => { run.cash += price; run.flow.sell.biz = run.h.biz.c; run.h.biz = { c: 0, managed: false, profit: 0 }; learn(run, 'liquidity'); },
    addBiz: (amt) => {
      const a = Math.max(0, Math.min(amt, Math.max(0, run.cash)));
      if (run.h.biz.c <= 0 && a > 0) run.story.bizStarted = (run.story.bizStarted || 0) + 1;
      run.cash -= a; run.h.biz.c += a; run.h.biz.profit = bizProfit(run, 1);
      return a;
    },
    bizOps: () => { run.h.biz.opsUntil = run.turn + Math.max(1, Math.round(3 / run.ypt)); },
  };
  return x;
}

// ---------------------------------------------------------------- work and business actions

// Work: a course, a raise, a side hustle, or retiring once you are free.
export function workAction(run, kind) {
  if (!canAct(run)) return null;
  const r = rngFor(run.seed, `work|${kind}`, run.turn);
  const h = helpers(run, r);
  if (kind === 'course') {
    const cost = 0.3 * run.salary;
    if (run.cash < cost || run.age - (run.flags.courseAge ?? -99) < 3) return null;
    run.cash -= cost; run.salary *= 1.12; run.flags.skillAge = run.age; run.flags.courseAge = run.age;
    seeP(run, 'b_earn');
    addMemory(run, { type: 'career', title: 'You went back to school', text: `A course at ${run.age} lifted your pay 12%.`, impact: 0.12 * run.salary * 5, tags: ['career'] });
    return { ok: true, text: 'Certified. Your pay rises 12%.' };
  }
  if (kind === 'raise') {
    if (run.turn - (run.flags.raiseT ?? -9) < Math.max(1, Math.round(2 / run.ypt))) return null;
    run.flags.raiseT = run.turn;
    const p = h.batna();
    seeP(run, 's_batna');
    if (r() < p) { run.salary *= 1.1; h.rel('boss', { trust: 2 }); return { ok: true, win: true, text: 'Your boss agrees: +10%.', p }; }
    h.rel('boss', { trust: -5, conflict: 5 });
    if (r() < 0.3) h.follow('boss_tension', 1, {});
    return { ok: true, win: false, text: '"Not this year." It stings.', p };
  }
  if (kind === 'side') { run.side = !run.side; return { ok: true, text: run.side ? 'Side hustle on: +15% income, a little less rest.' : 'Side hustle off. Your evenings are yours again.' }; }
  if (kind === 'retire') {
    if (!run.freeAge || run.flags.retired) return null;
    run.flags.retired = true;
    addMemory(run, { type: 'milestone', title: 'You stopped working', text: `Retired at ${run.age}. Your money pays for your life.`, tags: ['freedom'] });
    return { ok: true, text: 'You hand in your notice. Your time is your own now.' };
  }
  return null;
}

export const bizView = (run) => {
  const b = run.h.biz;
  if (b.c <= 0) return null;
  const margin = 0.25 * (b.price === 1 ? 1.25 : b.price === -1 ? 0.8 : 1);
  const revenue = b.profit / margin;
  return { capital: b.c, profit: b.profit, revenue, customers: Math.max(1, Math.round(revenue / (0.004 * unit(run)))), price: b.price || 0, staff: b.staff || 0, acted: b.acted === run.turn, managed: bizManaged(run), share: !!b.share, ops: (b.opsUntil || 0) > run.turn };
};

// One business move a year. Each nudges profit through bizBoost.
export function bizAction(run, kind, dir = 0) {
  const b = run.h.biz;
  if (!canAct(run) || b.c <= 0 || b.acted === run.turn) return false;
  const cost = { marketing: 0.08, hire: 0.1, ops: 0.06 }[kind];
  if (cost && run.cash < cost * b.c) return false;
  if (cost) run.cash -= cost * b.c;
  if (kind === 'marketing') b.mkt = run.turn;
  else if (kind === 'hire') { if ((b.staff || 0) >= 3) return false; b.staff = (b.staff || 0) + 1; }
  else if (kind === 'ops') b.opsUntil = run.turn + Math.max(1, Math.round(3 / run.ypt));
  else if (kind === 'price') b.price = clamp((b.price || 0) + dir, -1, 1);
  else return false;
  b.acted = run.turn;
  b.profit = bizProfit(run, 1);
  return true;
}

// Hidden price elasticity: raising prices works in good times, cutting them
// in bad times. Staff help with diminishing returns.
function bizBoost(run) {
  const b = run.h.biz;
  const state = run.market[Math.min(run.turn, run.market.length - 1)].state;
  let k = 1;
  if (b.mkt === run.turn) k *= 1.18;
  k *= [1, 1.08, 1.14, 1.18][Math.min(3, b.staff || 0)];
  if (b.price === 1) k *= 1.25 * (1 - ({ boom: 0.12, over: 0.1, crash: 0.35, recov: 0.25 }[state] ?? 0.2));
  if (b.price === -1) k *= 0.8 * (1 + ({ crash: 0.45, recov: 0.35 }[state] ?? 0.2));
  if (b.warT === run.turn && b.warK) k *= b.warK;
  if (b.share) k *= 1.15;
  return k;
}

// Finish the game on your own terms once you are free.
export function endGame(run) {
  return finish(run, run.freeAge ? 'free' : 'quit');
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

// ---------------------------------------------------------------- life events (partner, Circle)

export const AGAIN = '\u0001again';

function upHome(run) {
  const i = HOME_ORDER.indexOf(run.home.id);
  if (i >= HOME_ORDER.length - 1) return false;
  const id = HOME_ORDER[i + 1];
  if (run.home.own) return false;
  run.home = { ...run.home, id, rentMult: 1 };
  gotIt(run, 'homes', id);
  return true;
}

function split(run) {
  const h = run.h;
  const half = (x) => x / 2;
  if (run.cash > 0) run.cash = half(run.cash);
  h.save = half(h.save); h.index = half(h.index); h.crypto = half(h.crypto); h.fx = half(h.fx);
  h.stocks = h.stocks.map(half);
  h.prop.v = half(h.prop.v); h.prop.debt = half(h.prop.debt); if (h.prop.home) h.prop.home = half(h.prop.home);
  h.biz.c = half(h.biz.c); h.biz.profit = bizProfit(run, 1);
  run.land.forEach((l, i) => { if (i % 2 === 1) l.lost = true; });
  run.land = run.land.filter((l) => !l.lost);
  run.partner = null;
  run.flags.married = false;
  run.flags.separated = (run.flags.separated || 0) + 1;
}

function circleAct(run, h, v, act) {
  const m = v.mid ? run.circle.find((c) => c.id === v.mid) : null;
  const who = m ? m.name : v.who;
  const T = v.type;
  if (act === 'ask') {
    v.asked = true;
    if (m && !m.clues.includes(v.clue)) m.clues.push(v.clue);
    if (T === 'schemer') rep(run, -1);
    seeP(run, 'x_clues');
    return AGAIN;
  }
  if (m) m.asks += 1;
  if (T === 'helper') {
    if (act === 'no') { rep(run, -1); return `${who} shrugs. Maybe next time.`; }
    if (m) m.known = true;
    rep(run, 2);
    if (v.offer === 'job') { h.salary(1.08); h.skill(); return `${who} put your name forward. New job, 8% more pay.`; }
    if (v.offer === 'land') {
      const price = giftPlot(run, v.zone, 0.2);
      return `A real seller with real papers. You bought a plot in ${COUNTRIES[run.currency].zones[v.zone]} for ${h.f(price)}, 20% below the market.`;
    }
    h.joy(3);
    return 'The accountant spots two things to fix and one to stop. You feel more in control.';
  }
  if (act === 'no') {
    rep(run, { genuine: -5, taker: -2, schemer: -1, fraudster: 0 }[T]);
    if (T === 'genuine') h.joy(-4);
    if (T === 'taker') { h.joy(-2); if (m && m.asks >= 2) m.known = true; }
    if (T === 'fraudster') { learn(run, 'ponzi'); return 'You ignore it. Good call: it was a scam.'; }
    return {
      genuine: `${who} understands, but it stings. Word gets around.`,
      taker: `${who} tells everyone you have changed.`,
      schemer: `${who} finds someone else to ask.`,
    }[T];
  }
  const amt = act === 'part' ? v.amt / 2 : v.amt;
  const n = h.expense(amt, true);
  if (m) m.given += amt;
  if (T === 'genuine') { rep(run, act === 'part' ? 3 : 6); h.joy(act === 'part' ? 1 : 4); return `${who} is grateful: "I won't forget this." ${n}`; }
  if (T === 'taker') { rep(run, act === 'part' ? 1 : 2); if (m && m.asks >= 2) m.known = true; return `${who} thanks you, and asks when you can do it again. ${n}`; }
  if (T === 'schemer') {
    if (m) m.known = true;
    if (h.r() < 0.2) { run.cash += amt * 1.3; if (m) m.returned += amt * 1.3; return `Against the odds, it worked. ${who} pays you back with a little extra.`; }
    run.log.scam += amt / run.salary; run.flags.scammed = true; learn(run, 'ponzi');
    return `Nothing ever happened with the money, and ${who} stops answering. ${n}`;
  }
  run.log.scam += amt / run.salary; run.flags.scammed = true; learn(run, 'ponzi');
  return `It was a scam. The money is gone. ${n}`;
}

const LIFE_EVENTS = [
  {
    id: 'wedding', cat: 'Love', title: 'Someone special', w: (run) => (run.age >= 24 && run.age <= 36 ? 7 : 2.5),
    cond: (run) => !run.partner && run.age >= 21 && run.age < 48 && (run.flags.weddingSkip == null || run.age - run.flags.weddingSkip >= 4),
    setup: (run) => ({ cands: partnerCandidates(run), cost: 0.3 * run.salary }),
    text: (v, h) => `Three people have caught your eye. You only get a first impression: one clue each, and a clue is right about 70% of the time. A small wedding costs about ${h.f(v.cost)}.`,
    choices: (run, v) => [
      ...v.cands.map((c) => ({
        label: `Marry ${c.name}`, note: `Clue: ${c.clue}`, person: c, lesson: 'x_clues',
        fx: (r2, h) => { const n = h.expense(v.cost); marry(r2, c); h.joy(10); return `A small, happy wedding. ${n}`; },
      })),
      { label: 'Not now', note: 'Stay single for a while', fx: (r2) => { r2.flags.weddingSkip = r2.age; return 'You focus on yourself for now.'; } },
    ],
  },
  {
    id: 'p_budget', cat: 'Partner', title: 'We need to talk about money', w: (run) => (run.partner && !run.partner.legacy ? 1.3 : 0),
    text: (v, h, run) => `${run.partner.name} wants to sit down and talk about the household money.`,
    choices: [
      {
        label: 'Set a joint budget together', note: '+8 trust',
        fx: (run, h) => {
          h.trust(8); h.joy(2); run.partner.revealAt -= 1;
          return { saver: 'They already had a spreadsheet ready.', balanced: 'Done in an hour. Easy.', spender: 'They agree, then book a weekend away.', builder: 'They want a line in it for "the shop".', taker: 'They agree to everything and change nothing.' }[run.partner.type];
        },
      },
      {
        label: 'Let them run the money', note: 'You find out what they do with it',
        fx: (run, h) => {
          const P = run.partner; P.revealed = true;
          if (P.type === 'saver') { run.plan.pyf = Math.max(run.plan.pyf, 0.2); h.trust(10); return 'They set up automatic saving: 20% of your pay goes to you first.'; }
          if (P.type === 'balanced') { h.trust(6); return 'Bills paid on time, a little saved, a little enjoyed.'; }
          if (P.type === 'spender') { h.life(1); h.trust(8); return 'New sofa, new clothes, new everything. Your everyday spending goes up a level.'; }
          if (P.type === 'builder') { const a = 0.2 * run.salary; h.cash(-a); P.biz += a; h.trust(8); return `${h.f(a)} goes into their shop.`; }
          const a = 0.4 * run.salary; h.cash(-a); h.trust(4); return `${h.f(a)} disappears. "It went to family," they say.`;
        },
      },
      { label: 'Change the subject', note: '−6 trust', fx: (run, h) => { h.trust(-6); return 'The silence at dinner says a lot.'; } },
    ],
  },
  {
    id: 'p_upgrade', cat: 'Partner', title: 'A bigger house and a new car?',
    w: (run) => (run.partner && !run.partner.legacy ? (['spender', 'taker'].includes(run.partner.type) ? 1.4 : 0.4) : 0),
    text: (v, h, run) => `${run.partner.name} has seen a bigger place for rent, and a new saloon car "at a good price".`,
    choices: [
      { label: 'Upgrade both', note: 'Bigger rented home, new car on a loan, +10 trust', fx: (run, h) => { const a = upHome(run); const b = carSwap(run, 'saloon', true); h.trust(10); h.joy(6); h.term('creep'); return `${a ? 'A bigger home. ' : ''}${b ? 'A new car on a loan. ' : ''}Your costs just jumped.`; } },
      { label: 'Just the car', note: 'New car on a loan, +4 trust', fx: (run, h) => { const b = carSwap(run, 'saloon', true); h.trust(4); h.term('creep'); return b ? 'A new car in the drive, and a loan to pay.' : 'You couldn\'t raise the deposit. Maybe next year.'; } },
      { label: 'Not yet', note: '−10 trust', lesson: 'r_doodads', fx: (run, h) => { h.trust(run.partner.type === 'saver' ? 4 : -10); return run.partner.type === 'saver' ? 'They look relieved. "I was testing you."' : 'They go quiet for a week.'; } },
    ],
  },
  {
    id: 'p_business', cat: 'Partner', title: 'Back my business?', w: (run) => (run.partner && run.partner.type === 'builder' && !run.partner.biz0 ? 1.6 : 0),
    setup: (run) => ({ amt: 0.5 * run.salary }),
    text: (v, h, run) => `${run.partner.name} wants ${h.f(v.amt)} to grow their business. It could take off, or it could fail.`,
    choices: [
      {
        label: (v, h) => `Back it (${h.f(v.amt)})`, note: '+12 trust, 45% chance it takes off', need: (run, v) => run.cash >= v.amt, lesson: 'x_ev',
        math: (run, v) => ({ kind: 'stake', stake: v.amt, rows: [{ p: 0.45, m: 3.5, label: 'It takes off (their pay more than doubles)' }, { p: 0.55, m: 0, label: 'It struggles and closes' }] }),
        fx: (run, h, v) => { h.cash(-v.amt); run.partner.biz0 = v.amt; run.partner.bizT = run.turn; run.partner.revealed = true; h.trust(12); return 'They hug you. The sign goes up next month.'; },
      },
      { label: 'Not now', note: '−6 trust', fx: (run, h) => { h.trust(-6); return 'They carry on small, on their own.'; } },
    ],
  },
  {
    id: 'p_debts', cat: 'Partner', title: 'Hidden debts', w: (run) => (run.partner && run.partner.type === 'taker' ? 1.6 : 0),
    setup: (run) => ({ amt: 0.6 * run.salary }),
    text: (v, h, run) => `A letter arrives: ${run.partner.name} owes ${h.f(v.amt)} to a lender you have never heard of.`,
    choices: [
      { label: (v, h) => `Pay it off (${h.f(v.amt)})`, note: '+2 trust', fx: (run, h, v) => { const n = h.expense(v.amt, true); run.partner.revealed = true; h.trust(2); return `Cleared. They promise it won't happen again. ${n}`; } },
      { label: 'Refuse', note: '−15 trust, −6 joy', fx: (run, h) => { run.partner.revealed = true; h.trust(-15); h.joy(-6); return 'A long, loud night. The debt is theirs to sort out.'; } },
    ],
  },
  {
    id: 'p_inlaws', cat: 'Partner', title: 'Your in-laws need money',
    w: (run) => (run.partner && !run.partner.legacy ? (run.partner.type === 'taker' ? 1.3 : 0.5) : 0),
    setup: (run) => ({ amt: 0.25 * run.salary }),
    text: (v, h, run) => `${run.partner.name}'s family asks for ${h.f(v.amt)} for a family ceremony.`,
    choices: [
      { label: (v, h) => `Send it (${h.f(v.amt)})`, note: '+6 trust', fx: (run, h, v) => { const n = h.expense(v.amt, true); h.trust(6); h.rep(3); return `The family is delighted. ${n}`; } },
      { label: 'Say no', note: '−12 trust', fx: (run, h) => { h.trust(run.partner.type === 'taker' ? -15 : -12); h.rep(-4); return 'Your partner is embarrassed in front of their family.'; } },
    ],
  },
  {
    id: 'separation', cat: 'Partner', title: 'Your partner wants to separate', w: 0, forced: true,
    setup: (run) => ({ cost: 0.15 * run.salary }),
    text: (v, h, run) => `Trust has been gone for a long time. ${run.partner.name} says it is over.`,
    choices: [
      { label: (v, h) => `Try counselling (${h.f(v.cost)})`, note: 'Half the time it works', fx: (run, h, v) => { const n = h.expense(v.cost); if (h.r() < 0.5) { run.partner.trust = 30; run.partner.zero = 0; return `Slowly, you learn to talk again. ${n}`; } split(run); h.joy(-25); return `It didn't work. You split everything you own, half each. ${n}`; } },
      { label: 'Split fairly', note: 'Everything you own, half each', fx: (run, h) => { split(run); h.joy(-25); return 'You go your separate ways. Everything you owned is split in half.'; } },
    ],
  },
  {
    id: 'circle', cat: 'Circle', title: 'Someone asks for help', w: (run) => (run.circle.length ? 2.3 : 0),
    setup: (run) => {
      const r = rngFor(run.seed, 'circle', run.turn);
      let m = null;
      if (r() >= 0.22) {
        const w = {};
        for (const c of run.circle) if (!c.cast || c.role === 'parent') w[c.id] = { taker: 3, genuine: 1.2, schemer: 1.2, helper: 1 }[c.type];
        m = run.circle.find((c) => c.id === r.weighted(w));
      }
      const type = m ? m.type : 'fraudster';
      const a = r.pick(CIRCLE_ASKS[type]);
      const who = m ? m.name : a.stranger;
      const base = { genuine: 0.3, taker: 0.2, schemer: 0.6, fraudster: 0.5, helper: 0 }[type];
      const amt = a.stranger === 'A "bank officer"' ? 0.5 * (Math.max(0, run.cash) + run.h.save) : base * run.salary;
      const f = (n) => fmt(n, run.currency);
      return {
        mid: m ? m.id : null, who, rel: m ? m.rel : 'Stranger', type, amt, offer: a.offer || null,
        zone: r.pick(['corridor', 'farm', 'coast']), asked: false, look: m ? m.look : null,
        text: a.text.replace(/\{name\}/g, who).replace('{amt}', f(amt)),
        clue: a.clue.replace(/\{name\}/g, who),
      };
    },
    text: (v) => v.text,
    choices: (run, v) => {
      const ask = v.asked ? [] : [{ label: 'Ask questions', note: 'Find out more first', act: 'ask', fx: (r2, h) => circleAct(r2, h, v, 'ask') }];
      if (v.type === 'helper') {
        const price = v.offer === 'land' ? plotPrice(run, v.zone) * 0.8 : 0;
        return [
          { label: v.offer === 'land' ? `Buy the plot (${fmt(price, run.currency)})` : 'Yes please', note: v.offer === 'job' ? '+8% pay' : v.offer === 'land' ? 'Full title, 20% off' : '+3 joy', need: () => run.cash >= price, fx: (r2, h) => circleAct(r2, h, v, 'give') },
          ...ask,
          { label: 'No thanks', note: '', fx: (r2, h) => circleAct(r2, h, v, 'no') },
        ];
      }
      const f = (n) => fmt(n, run.currency);
      const sms = v.who === 'A "bank officer"';
      return [
        { label: sms ? 'Reply with the code' : `Give ${f(v.amt)}`, note: sms ? 'Unlock your account' : '', fx: (r2, h) => circleAct(r2, h, v, 'give') },
        ...(v.type === 'fraudster' ? [] : [{ label: `Give part (${f(v.amt / 2)})`, note: '', fx: (r2, h) => circleAct(r2, h, v, 'part') }]),
        ...ask,
        { label: sms ? 'Ignore it' : 'Say no', note: '', fx: (r2, h) => circleAct(r2, h, v, 'no') },
      ];
    },
  },
];

export const ALL_EVENTS = [...EVENTS, ...LIFE_EVENTS, ...STORY];
export const evById = (id) => ALL_EVENTS.find((e) => e.id === id);
const choicesOf = (ev, run, v) => (typeof ev.choices === 'function' ? ev.choices(run, v) : ev.choices);

// ---------------------------------------------------------------- event helpers

export const helpersFor = (run) => helpers(run, rngFor(run.seed, 'helpers', run.turn));

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
    kid: (nanny) => newKid(run, nanny),
    trust: (d) => trust(run, d),
    rep: (d) => rep(run, d),
    newCar: (id, loan) => carSwap(run, id, loan),
    scrapCar: () => { run.cash += 0.1 * run.car.v - run.car.loan; run.car = { id: 'none', v: 0, loan: 0, loan0: 0 }; },
    rentUp: (k) => { run.home.rentMult = (run.home.rentMult || 1) * k; },
    moveCheaper: () => {
      const i = DISTRICT_ORDER.indexOf(run.home.district);
      if (i > 0) { run.home = { ...run.home, district: DISTRICT_ORDER[i - 1], levy: false, guard: false, rentMult: 1 }; return `You move to a ${DISTRICTS[run.home.district].name.toLowerCase()}. Cheaper, and further from what you like.`; }
      const j = HOME_ORDER.indexOf(run.home.id);
      if (j > 0) { run.home = { ...run.home, id: HOME_ORDER[j - 1], rentMult: 1 }; return 'You move to a smaller place nearby.'; }
      return 'There is nowhere cheaper. You pay up anyway.';
    },
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
  return Object.assign(h, storyHelpers(run, h));
}

export function eventView(run) {
  if (!run.pending) return null;
  const ev = evById(run.pending.id);
  const h = helpers(run, () => 0.5);
  const v = run.pending.v;
  return {
    id: ev.id, cat: ev.cat, title: typeof ev.title === 'function' ? ev.title(v, h, run) : ev.title, v, cast: ev.cast || null,
    text: ev.text(v, h, run),
    choices: choicesOf(ev, run, v).map((c) => ({
      label: typeof c.label === 'function' ? c.label(v, h) : c.label,
      note: c.note || '',
      ok: !c.need || c.need(run, v),
      person: c.person || null,
      act: c.act || null,
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
  if (run.partner && run.partner.zero >= 2) return 'separation';
  if (run.frugalYears >= 2) { run.frugalYears = 0; run.flags.frugalBurn = true; return 'burnout'; }
  if (run.joy < 20 && r() < 0.65) return 'burnout';
  if (run.forceEvent) {
    const f = evById(run.forceEvent);
    run.forceEvent = null;
    run.teaser = null;
    if (f && (!f.cond || f.cond(run))) return f.id;
  }
  const recent = run.seenEv.slice(-5);
  const pool = {};
  for (const e of ALL_EVENTS) {
    if (e.forced || recent.includes(e.id)) continue;
    if (e.once && run.seenEv.includes(e.id)) continue;
    if (e.cond && !e.cond(run)) continue;
    let w = typeof e.w === 'function' ? e.w(run) : e.w;
    if (e.id === 'promo' && has(run, 'networker')) w *= 2;
    if (run.life === 0 && e.id === 'medical') w *= 1.8;
    if (run.life === 0 && e.id === 'car') w *= 2;
    if (e.id === 'medical' && rule(run, 'hospitalFees')) w *= 1.3;
    if (e.id === 'circle' && rule(run, 'bigFamily')) w *= 2;
    if (w > 0) pool[e.id] = w;
  }
  return r.weighted(pool);
}

// ---------------------------------------------------------------- the turn

const RISKY = ['index', 'stocks', 'crypto'];

// Two (or four) years pass. Returns what happened for the play-out screen.
export function live(run) {
  if (run.phase !== 'alloc' || run.pending) return null;
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
  const S = unit(run);
  const P = run.partner;
  const k2 = y / 2;
  // The final stretch: near freedom (or near 60), a sharp crash is the worst
  // thing that can happen, so the game makes it likelier. Savings are untouched.
  const prog0 = clamp(passive(run).total / bowl(run), 0, 2);
  const near = !run.eraId && !MODES[run.mode].years && (prog0 >= 0.75 || run.age + y > run.deadline - 10);
  const seqHit = near && m.seq != null && m.seq < 0.16 * k2 && m.state !== 'crash';
  res.seqHit = seqHit;

  // Salary and living costs over the period.
  const drift = Math.pow(1 + m.infl, (y - 1) / 2);
  let pay = run.flags.retired ? 0 : run.salary * y * drift;
  if (c.volatile) pay *= m.hustle;
  if (m.swan === 'pandemic' && !has(run, 'remote_job')) pay *= 0.7;
  if (run.flags.riskyJob && m.state === 'crash' && rngFor(run.seed, 'riskyjob', t)() < 0.4) { pay *= 0.6; res.notes.push('Your fast-growing employer cut staff in the crash. You were out of work for months.'); }
  if (run.side && !run.flags.retired) { const sd = 0.15 * run.salary * y * drift; pay += sd; res.sideIncome = sd; }
  const spend = costs(run) * y * drift;
  const partnerPay = P && !P.legacy ? P.pay * y * drift : 0;
  const kidHelp = run.kids.filter((kd) => kd.outcome === 'helping').length * 0.1 * S * y;
  const given = run.giving * (pay + partnerPay);
  run.cash += pay + partnerPay + kidHelp - spend - given;
  res.flows.push({ label: 'Salary', v: pay });
  if (partnerPay) res.flows.push({ label: `${P.name}'s pay`, v: partnerPay });
  if (kidHelp) res.flows.push({ label: 'Money from your children', v: kidHelp });
  res.flows.push({ label: 'Living costs', v: -spend });
  if (given) res.flows.push({ label: 'Giving', v: -given, giving: true });
  res.given = given;
  if (run.car.loan > 0) {
    const princ = Math.min(run.car.loan, ((run.car.loan0 || run.car.loan) / 4) * y);
    run.cash -= princ; run.car.loan -= princ;
    res.flows.push({ label: 'Car loan repaid', v: -princ });
  }

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
  const SEQ = { index: -0.25, stocks: -0.28, crypto: -0.35 };
  const adj = (x, asset) => {
    if (seqHit && SEQ[asset]) x = (1 + x) * (1 + SEQ[asset]) - 1;
    if (asset === 'index' && rule(run, 'indexFees')) x = (1 + x) * Math.pow(0.98, y) - 1;
    if ((asset === 'index' || asset === 'stocks') && rule(run, 'dividendTax')) x = (1 + x) * Math.pow(0.995, y) - 1;
    if (RISKY.includes(asset)) {
      if (run.lev > 0) x *= 2;
      if (asset === 'crypto' && has(run, 'degen')) x *= 1.5;
      if (asset !== 'crypto' && has(run, 'dividend')) x = (1 + x) * Math.pow(1.01, y) - 1;
      if (asset === 'index' && m.state === 'crash' && has(run, 'bs_hedge')) x = 0.15;
      if (x < 0 && m.state === 'crash' && has(run, 'diamond_hands') && !soldRisk) x /= 2;
    }
    return Math.max(-0.99, x);
  };
  let saveRet = Math.pow(1 + m.rate + (has(run, 'compound') ? 0.02 : 0) + (rule(run, 'tightMoney') ? 0.02 : 0), y) - 1;
  if (rule(run, 'savingsTax')) saveRet *= 0.7;
  const gains = {};
  gains.save = h.save * saveRet; h.save += gains.save;
  gains.index = h.index * adj(m.ret.index, 'index'); h.index += gains.index;
  gains.stocks = 0;
  h.stocks = h.stocks.map((v, i) => { const g = v * adj(m.ret.stocks[i], 'stocks'); gains.stocks += g; return v + g; });
  gains.crypto = h.crypto * adj(m.ret.crypto, 'crypto'); h.crypto += gains.crypto;
  gains.fx = h.fx * m.ret.fx; h.fx += gains.fx;
  const propRet = seqHit ? (1 + m.ret.prop) * 0.95 - 1 : m.ret.prop;
  gains.prop = h.prop.v * propRet; h.prop.v += gains.prop;
  if (h.prop.home) h.prop.home *= 1 + propRet;
  if (run.car.v > 0) {
    const c0 = run.car.v;
    run.car.v *= Math.pow(1 - CARS[run.car.id].dep, y);
    gains.car = run.car.v - c0;
    res.carDep = -gains.car;
    run.story.carLoss = (run.story.carLoss || 0) + res.carDep;
  }

  // Land: zone prices move with the region's news; farms pay a harvest.
  const land0 = landValue(run);
  for (const z of ZONE_ORDER) run.zonePx[z] *= (m.land ? 1 + m.land[z] : Math.pow(1 + m.infl, y)) * (rule(run, 'landRush') ? Math.pow(1.03, y) : 1);
  gains.land = landValue(run) - land0;
  const rl = rngFor(run.seed, 'land', t);
  let farm = 0;
  for (const l of run.land) {
    const val = l.plots * plotPrice(run, l.zone);
    const zn = COUNTRIES[run.currency].zones[l.zone];
    if (l.use === 'farm') {
      const weather = (m.zone ? m.zone.farmYield : 1) * { boom: 1.05, steady: 1, over: 1, crash: 0.85, recov: 1 }[m.state] * (0.67 + 0.66 * rl());
      farm += val * farmRate(run, l.zone) * weather * y;
    }
    if (m.zone && m.zone.acquire && l.zone === m.zone.zone) {
      const paid = val * (0.4 + 0.2 * rl());
      run.cash += paid; l.lost = true;
      res.notes.push(`The government took your land in ${zn} and paid ${fmt(paid, run.currency)}, well under its value.`);
      continue;
    }
    if (m.zone && m.zone.grab && l.zone === m.zone.zone) {
      const fee = 0.05 * val; run.cash -= fee;
      res.notes.push(`Land grabbers in ${zn} demanded a "foundation fee" of ${fmt(fee, run.currency)}.`);
    }
    if (rl() < 1 - Math.pow(1 - TITLES[l.title].hazard, y)) {
      res.titleProblem = true;
      if (l.title === 'receipt') { l.lost = true; res.notes.push(`Your plot in ${zn} had been sold to two people, and the other buyer had better papers. The plot is gone.`); }
      else { const fee = (l.title === 'progress' ? 0.2 : 0.1) * val; run.cash -= fee; res.notes.push(`A dispute over your plot in ${zn}. Lawyers and fees cost ${fmt(fee, run.currency)}.`); }
    }
  }
  if (run.land.some((l) => l.lost)) { gains.land -= run.land.filter((l) => l.lost).reduce((s2, l) => s2 + l.plots * plotPrice(run, l.zone), 0); run.land = run.land.filter((l) => !l.lost); }
  if (farm) { run.cash += farm; res.flows.push({ label: 'Farm harvests', v: farm }); }

  if (prev === 'crash' && has(run, 'contrarian')) {
    const bonus = 0.12 * ((run.flow.buy.index || 0) + (run.flow.buy.stocks || 0));
    if (bonus > 0) { h.index += bonus; gains.index += bonus; res.notes.push(`Contrarian bonus: ${fmt(bonus, run.currency, true)} for buying after the crash.`); }
  }
  if (prev === 'crash' && ((run.flow.buy.index || 0) + (run.flow.buy.stocks || 0)) > 0) { learn(run, 'dip'); run.beh.dipBuys = (run.beh.dipBuys || 0) + 1; }

  // Rent, mortgage interest, business profit, debt interest.
  if (h.prop.v > 0) {
    let rent = rentable(run) * rentYield(run) * y;
    if (rentable(run) > 0 && (run.flags.vacancy || rngFor(run.seed, 'vacancy', t)() < (m.state === 'crash' ? 0.18 : 0.08) * k2)) {
      rent *= 0.5; run.flags.vacancy = false;
      res.notes.push('Your tenant moved out and the flat stood empty for months. Half a year of rent lost.');
    }
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
    const wear = (h.biz.opsUntil || 0) > run.turn ? 0.04 : h.biz.share ? 0.05 : 0.07;
    h.biz.c *= Math.pow((1 - wear) * (1 + m.infl), y);
    // A bad year can break a business. Tight operations and a manager help.
    if ((m.state === 'crash' || m.bizMult < 0.6) && rngFor(run.seed, 'bizfail', t)() < 0.16 * k2 * ((h.biz.opsUntil || 0) > run.turn ? 0.5 : 1) * (bizManaged(run) ? 0.8 : 1)) {
      const lost = 0.6 * h.biz.c;
      h.biz.c -= lost; h.biz.profit = bizProfit(run, 1);
      res.bizHit = lost;
      res.notes.push(`A terrible year for your business. It lost ${fmt(lost, run.currency)} of its value.`);
      run.story.threads.push({ id: 'biz_fail', due: run.age + y, v: { lost } });
      addMemory(run, { type: 'failure', title: 'Your business was hit hard', text: `It lost ${fmt(lost, run.currency)} at ${run.age}.`, impact: -lost, tags: ['business', 'loss'] });
    }
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

  // Break-ins, car theft and floods, from the player's own dice.
  const li = rngFor(run.seed, 'life', t);
  const st = stars(run);
  const crime = rule(run, 'crimeWave') ? 2 : 1;
  if (li() < [0.16, 0.1, 0.06, 0.03, 0.012][st - 1] * crime * k2) {
    const loss = Math.max(0, run.cash) * (0.1 + 0.3 * li());
    run.cash -= loss; run.joy = clamp(run.joy - 8, 0, 100);
    res.notes.push(`Thieves broke into your home${loss > 0 ? ` and took ${fmt(loss, run.currency)} in cash and goods` : ''}. Better security makes this rarer.`);
    res.incident = 'breakin';
  }
  if (run.car.id !== 'none' && li() < CARS[run.car.id].theft * [0.12, 0.08, 0.05, 0.025, 0.01][st - 1] * crime * k2) {
    res.notes.push(`Your ${CARS[run.car.id].name.toLowerCase()} was stolen. It wasn't insured${run.car.loan > 0 ? ', and you still owe the loan' : ''}.`);
    run.cash -= run.car.loan; run.car = { id: 'none', v: 0, loan: 0, loan0: 0 };
    run.joy = clamp(run.joy - 6, 0, 100);
    res.incident = res.incident || 'cartheft';
  }
  if (li() < DISTRICTS[run.home.district].flood * 0.1 * (rule(run, 'wetDecade') ? 2 : 1) * (m.zone && m.zone.flood ? 2 : 1) * k2) {
    const fix = 0.08 * S;
    run.cash -= fix; run.joy = clamp(run.joy - 5, 0, 100);
    if (run.home.own && h.prop.home) { const cut = h.prop.home * 0.05; h.prop.home -= cut; h.prop.v -= cut; }
    res.notes.push(`Floodwater came into your home. Repairs cost ${fmt(fix, run.currency)}.`);
    res.incident = res.incident || 'flood';
  }

  // The Circle: genuine people pay back; a good name brings help in a crisis.
  const rc = rngFor(run.seed, 'circlepay', t);
  for (const c of run.circle) {
    const owed = c.given - c.returned;
    if (c.type === 'genuine' && owed > 0 && rc() < 0.35 * k2) {
      const back = owed * (0.5 + 0.5 * rc());
      run.cash += back; c.returned += back; c.known = true;
      res.notes.push(`${c.name} paid you back ${fmt(back, run.currency)}.`);
      res.repaid = c.name;
    }
  }
  rep(run, (50 - run.rep) * 0.04 * k2);
  if (run.giving > 0) {
    rep(run, Math.min(3, run.giving * 40) * k2);
    if (rc() < run.giving * 1.5 * k2) {
      if (rc() < 0.5) { run.salary *= 1.05; res.notes.push('Someone you helped through your giving put you forward for a better role: +5% pay.'); }
      else { const g = 0.15 * run.salary; run.cash += g; res.notes.push(`A person you once helped sends a big customer your way: +${fmt(g, run.currency)}.`); }
    }
  }
  if (run.cash < 0) {
    if (run.rep >= 65 && t - (run.flags.helpT ?? -9) >= 3) {
      const g = 0.3 * run.salary;
      run.cash += g; run.flags.helpT = t; rep(run, -5);
      res.notes.push(`Your Circle rallied round when you were short: ${fmt(g, run.currency)} to tide you over.`);
    } else if (run.rep <= 30 && !run.flags.aloneSeen) {
      run.flags.aloneSeen = true;
      res.notes.push('You are short of money and nobody in your Circle picks up. Your name matters when trouble hits.');
    }
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
  run.feeIdx = (run.feeIdx || 1) * Math.pow((1 + m.infl) * 1.03, y);
  if (m.zone && m.zone.costs !== 1) { run.costMult *= m.zone.costs; res.notes.push('Fuel subsidy removed: everyday costs rise 5% for good.'); }
  let realGrowth = Math.max(0, 0.026 - 0.0009 * (run.age - 22)) - (run.asc >= 5 ? 0.01 : 0);
  if (rule(run, 'wageFreeze') && run.age - run.startAge < 10) realGrowth = 0;
  if (rule(run, 'hotJobs')) realGrowth += 0.01;
  if (has(run, 'remote_job') && profileOf(run.currency).fx) run.salary *= (1 + m.fxDev) * Math.pow(1 + realGrowth, y);
  else run.salary *= Math.pow((1 + realGrowth) * (1 + m.infl), y);
  // Partner and children: pay, trust, schooling and grown-up outcomes.
  if (P && !P.legacy) {
    P.pay *= Math.pow((1 + realGrowth) * (1 + m.infl), y);
    if (P.biz0 && !P.bizDone && run.turn - P.bizT >= Math.max(1, Math.round(2 / y))) {
      P.bizDone = true;
      if (rngFor(run.seed, 'pbiz', t)() < 0.45) { P.pay *= 2.2; res.notes.push(`${P.name}'s business took off. Their income more than doubled.`); }
      else res.notes.push(`${P.name}'s business struggled and closed. The money is gone.`);
    }
    let dt = 3;
    if (run.life === 0) dt -= 8;
    if (run.home.id === 'room') dt -= 8; else if (HOMES[run.home.id].beds >= 2) dt += 2;
    if (run.kids.length && HOMES[run.home.id].beds < 2) dt -= 5;
    if (P.type === 'spender' && run.life < 2) dt -= 5;
    if (P.type === 'saver' && run.life >= 3) dt -= 5;
    if (P.type === 'saver' && run.plan.pyf >= 0.2) dt += 3;
    if (P.type === 'taker') dt -= 3;
    if (run.cash < 0) dt -= 4;
    P.trust = clamp(P.trust + dt * k2, 0, 100);
    P.zero = P.trust <= 0 ? (P.zero || 0) + 1 : 0;
    if (P.type === 'saver' && run.cash < 0 && !P.potUsed) {
      P.potUsed = true; P.revealed = true;
      const pot = 0.5 * run.salary; run.cash += pot;
      res.notes.push(`${P.name} opens a secret savings tin: ${fmt(pot, run.currency)} to get you out of the hole.`);
    }
    if (!P.revealed && run.age + y - P.since >= P.revealAt) { P.revealed = true; res.partnerReveal = P.type; }
  }
  if (run.life === 0 && run.kids.some((kd) => SCHOOLS[kd.school].rank > 1)) {
    run.kids.forEach((kd) => { if (SCHOOLS[kd.school].rank > 1) kd.school = 'budget'; });
    res.notes.push('Money is too tight for private school fees. The children move to a budget school.');
  }
  for (const kd of run.kids) {
    if (kd.legacy) continue;
    const a0 = run.age - kd.born;
    if (a0 >= 5 && a0 < 18) { kd.upSum += SCHOOLS[kd.school].uplift * y; kd.schoolYrs += y; }
    if (a0 >= 18 && a0 < 22 && kd.uni === 'abroad') kd.abroad = true;
    if (a0 < 22 && a0 + y >= 22 && !kd.outcome) {
      const kr = rngFor(run.seed, `kid|${kd.name}`, t);
      const up = kd.schoolYrs ? kd.upSum / kd.schoolYrs : 0;
      const sx = (st - 3) * 0.02;
      const pHelp = clamp(0.12 + up + (kd.abroad ? UNI_ABROAD.uplift : 0) + sx, 0.05, 0.6);
      const pSup = clamp(0.28 - up - (kd.abroad ? 0.06 : 0) - sx, 0.05, 0.5);
      const u = kr();
      kd.outcome = u < pHelp ? 'helping' : u < pHelp + pSup ? 'support' : 'independent';
      res.kidOutcome = { name: kd.name, outcome: kd.outcome };
    }
  }
  if (run.life === 0) run.frugalYears += y; else run.frugalYears = 0;

  let dj = LIFESTYLES[run.life].joy + lifeJoy(run) - run.refJoy;
  if (has(run, 'side_hustle')) dj -= 3;
  if (run.flags.gig) dj -= 3;
  if (P && P.legacy) dj += 2;
  else if (P) dj += P.type === 'taker' && P.revealed ? -2 : PARTNERS[P.type].joy / 2;
  dj += Math.min(2, run.kids.filter((kd) => !kd.outcome).length);
  dj += run.kids.filter((kd) => kd.school === 'intl' && !kd.outcome).length;
  if (run.kids.some((kd) => run.age - kd.born < 18) && HOMES[run.home.id].beds < 2) dj -= 4;
  dj += Math.min(2, run.giving * 40);
  if (run.asc >= 8) dj -= 2;
  if (c.sailor) dj -= 2;
  if (m.state === 'crash' && nw0 > 0 && netWorth(run) < nw0 * 0.8) dj -= 4;
  run.joy = clamp(run.joy + dj * Math.min(1, y / 2), has(run, 'stoic') ? 30 : 0, 100);
  run.stats.joySum += run.joy * y; run.stats.years += y;
  if (run.partner && !run.partner.legacy) { run.stats.trustSum += run.partner.trust * y; run.stats.trustYears += y; }
  run.stats.givingSum += run.giving * y;
  run.age += y;
  if (run.lev > 0) run.lev -= 1;
  if (run.cash > 0.2 * Math.max(netWorth(run), 1)) run.flags.idle = (run.flags.idle || 0) + 1; else run.flags.idle = 0;

  // Rare golden events, and (16+) a mystery envelope every year.
  const gr = rngFor(run.seed, 'gold', t);
  if (!run.eraId && gr() < 0.02 * y * (run.weekend ? 3 : 1)) {
    const g = GOLDEN[Math.floor(gr() * GOLDEN.length)];
    if (g.fx === 'cash') run.cash += g.k * run.salary;
    else if (g.fx === 'salary') run.salary *= 1 + g.k;
    else if (g.fx === 'index' && h.index > 0) h.index *= 1 + g.k;
    else if (g.fx === 'home' && run.home.own && h.prop.home) { const up = h.prop.home * g.k; h.prop.home += up; h.prop.v += up; }
    else run.cash += 0.15 * run.salary;
    res.golden = { id: g.id, title: g.title, text: g.text };
    gotIt(run, 'golden', g.id);
  }
  if (run.envelopes) {
    const er = rngFor(run.seed, 'env', t);
    const big = er() < 1 / 8;
    const kind = er.pick(['cash', 'wisdom', 'card']);
    const env = { kind, big };
    if (kind === 'cash') { env.amt = (big ? 0.5 : 0.05) * run.salary; run.cash += env.amt; }
    else if (kind === 'wisdom') { env.amt = big ? 15 : 2; run.bonusWisdom += env.amt; }
    else {
      const legends = CARDS.filter((c) => c.legendary && !has(run, c.id));
      if (big && legends.length) { const c = legends[Math.floor(er() * legends.length)]; run.cards.push(c.id); if (c.take) c.take(run, helpers(run, er)); env.card = c.name; }
      else { run.charges.insider = (run.charges.insider || 0) + 1; env.card = 'Insider Whisper'; }
    }
    res.envelope = env;
  }

  res.nw1 = netWorth(run);
  res.passive = passive(run).total;
  res.costs = costs(run);
  res.bowl = bowl(run);
  res.milestones = [];
  for (const ms of milestonesNow(run)) if (!run.milestones.includes(ms)) { run.milestones.push(ms); res.milestones.push(ms); }

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
  if (run.learnMode && run.think && t === 0) mo.push(['base_intro']);
  if (run.learnMode && run.think && t === 1) mo.push(['bayes_intro']);
  if (seqHit) mo.push(['seq_hit']);
  else if (near && prog0 >= 0.75 && !run.flags.stretchSeen) { run.flags.stretchSeen = true; mo.push(['final_stretch']); }
  if (res.carDep > 0 && !run.flags.carDepSeen) { run.flags.carDepSeen = true; mo.push(['car_dep', money(res.carDep)]); }
  if (res.partnerReveal) mo.push(['partner_reveal', PARTNERS[res.partnerReveal].name.toLowerCase()]);
  if (res.kidOutcome) mo.push(['kid_outcome', res.kidOutcome.name, KID_OUTCOMES[res.kidOutcome.outcome]]);
  if (res.titleProblem) mo.push(['title_problem']);
  if (res.repaid) mo.push(['circle_repaid', res.repaid]);
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
    home: run.home.id, district: run.home.district, own: run.home.own, car: run.car.id,
    trust: run.partner ? Math.round(run.partner.trust) : null, kids: run.kids.length, rep: Math.round(run.rep),
    giving: run.giving, given: Math.round(given), land: Math.round(landValue(run)), seq: seqHit,
    golden: res.golden ? res.golden.title : null, incident: res.incident || null,
  });

  // Memories the year made on its own.
  if (m.state === 'crash' && prev !== 'crash' && before.index + before.stocks + before.crypto > 0) addMemory(run, { type: 'investment', title: m.swan ? `${(SWANS.find((x) => x.id === m.swan) || {}).name || 'A black swan'}` : 'A market crash', text: `Your investments moved ${fmt(res.rows.filter((q) => RISKY.includes(q.id)).reduce((s2, q) => s2 + q.gain, 0), run.currency, true)} that year.`, impact: Math.min(0, res.rows.filter((q) => RISKY.includes(q.id)).reduce((s2, q) => s2 + q.gain, 0)), tags: ['crash', 'market'] });
  if (res.golden) addMemory(run, { type: 'success', title: res.golden.title, text: res.golden.text, impact: 0.3 * run.salary, tags: ['luck'] });
  if (res.titleProblem) addMemory(run, { type: 'failure', title: 'A land deal went wrong', text: 'The paperwork was not what the seller said.', impact: -0.3 * run.salary, tags: ['land', 'loss'] });
  if (res.kidOutcome) addMemory(run, { type: 'family', title: `${res.kidOutcome.name} grew up`, text: KID_OUTCOMES[res.kidOutcome.outcome], tags: ['family'] });
  if (run.log.scam > scam0) addMemory(run, { type: 'failure', title: 'You lost money to a scam', text: 'It promised too much.', impact: -(run.log.scam - scam0) * run.salary, tags: ['scam', 'loss'] });

  // The year is done: the story updates, the clock moves, and the next
  // year's event is dealt so it greets the player at the start of the year.
  storyYear(run, res, { pyf });
  const done = endTurn(run, res);
  if (done) { res.result = done; return res; }
  dealNext(run, res);
  return res;
}

export function chooseEvent(run, i) {
  if (run.phase !== 'alloc' || !run.pending) return null;
  const ev = evById(run.pending.id);
  const choice = choicesOf(ev, run, run.pending.v)[i];
  if (!choice || (choice.need && !choice.need(run, run.pending.v))) return null;
  const h = helpers(run, rngFor(run.seed, 'evo', run.turn));
  run.eventLesson = null;
  const text = choice.fx(run, h, run.pending.v) || '';
  if (text === AGAIN) return AGAIN;
  const lesson = choice.lesson || run.eventLesson || (ev.id === 'circle' ? 'b_lend' : null) || (ev.id === 'burnout' && run.flags.frugalBurn ? 'p_reasonable' : null);
  run.flags.frugalBurn = false;
  run.eventLesson = lesson || null;
  if (lesson) seeP(run, lesson);
  if (choice.math) seeP(run, 'x_ev');
  const view = typeof choice.label === 'function' ? choice.label(run.pending.v, h) : choice.label;
  const title = ev.id === 'circle' ? `${run.pending.v.who} (${run.pending.v.rel.toLowerCase()}) asked for help` : typeof ev.title === 'function' ? ev.title(run.pending.v, h, run) : ev.title;
  const entry = run.journal && run.journal[run.journal.length - 1];
  if (entry) entry.event = { id: ev.id, title, choice: view, note: choice.note || '', outcome: text, lesson: lesson || null };
  run.story.decisions.push({ age: run.age, id: ev.id, title, choice: view, outcome: text });
  if (run.story.decisions.length > 80) run.story.decisions.shift();
  if (ev.cast) { const p = person(run, ev.cast); if (p) { p.history = [...(p.history || []), { age: run.age, text: `${title}: ${view}` }].slice(-12); } }
  run.pending = null;
  return text;
}

// ---------------------------------------------------------------- cards

export const unlockedCards = (wisdom) => CARDS.filter((c) => c.unlock <= wisdom).map((c) => c.id);
export const cardById = (id) => CARDS.find((c) => c.id === id);

export function makeOffer(run, unlocked) {
  const r = rngFor(run.seed, 'card', run.turn);
  const n = has(run, 'coach') ? 4 : run.asc >= 11 ? 2 : 3;
  const eligible = (c) => (c.stack || !has(run, c.id)) && (!c.cond || c.cond(run)) && !(c.id === 'remote_job' && rule(run, 'noRemote'));
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
  // Cards are earned by behaviour now (see EARNED in story.js). This keeps the
  // old entry point working for offers from envelopes and saved games.
  if (id && run.offer && run.offer.includes(id) && !has(run, id)) {
    const card = cardById(id);
    run.cards.push(id);
    if (card.take) card.take(run, helpers(run, rngFor(run.seed, 'take', run.turn)));
  }
  run.offer = null;
  return run.phase === 'done' ? run.result : null;
}

function endTurn(run, res = {}) {
  run.turn += 1;
  run.flow = { buy: {}, sell: {} };
  run.lifeStart = run.life;
  run.eventLesson = null;
  run.hist.push(snapshot(run));
  const nw = netWorth(run);
  run.negTurns = nw < 0 ? run.negTurns + 1 : 0;
  const e = era(run);
  if (passive(run).total >= bowl(run)) {
    if (!run.freeAge) {
      run.freeAge = run.age;
      res.freedom = true;
      addMemory(run, { type: 'milestone', title: 'Financial freedom', text: `At ${run.age}, your money began paying for your whole life.`, impact: nw * 0.1, tags: ['freedom'] });
    }
    if (run.stopAtFree) return finish(run, 'free');
  }
  // Broke for four years in a row (two 2-year turns) ends the run.
  if (run.negTurns * run.ypt >= 4) return finish(run, 'bankrupt');
  if (run.turn >= run.turns) return finish(run, e ? (nw >= e.target * costs(run) ? 'target' : 'missed') : run.freeAge ? 'free' : 'clock');
  run.phase = 'alloc';
  return null;
}

export function abandon(run) {
  return finish(run, 'quit');
}

// ---------------------------------------------------------------- milestones and the Life Score

export const MILESTONES = {
  efund: 'Emergency fund',
  car: 'First car',
  home: 'Own your home',
  half: 'Half free',
  cushion: '5 years of pay',
  debtfree: 'Debt-free',
  school: 'Kids through school',
};

function milestonesNow(run) {
  const out = [];
  if (run.h.save >= costs(run)) out.push('efund');
  if (run.car.id !== 'none') out.push('car');
  if (run.home.own) out.push('home');
  if (passive(run).total >= 0.5 * bowl(run)) out.push('half');
  if (netWorth(run) >= 5 * run.salary) out.push('cushion');
  if (run.h.prop.debt > 0 || run.car.loan > 0 || run.cash < 0) run.flags.hadDebt = true;
  else if (run.flags.hadDebt) out.push('debtfree');
  if (run.kids.length && run.kids.every((k) => run.age - k.born >= 18)) out.push('school');
  return out;
}

// The whole life, not only the age: freedom, joy, family and your name among
// people. Several different lives can reach five stars.
export function lifeScore(run, reason) {
  const st = run.stats || { joySum: 0, years: 0, trustSum: 0, trustYears: 0, givingSum: 0 };
  const years = Math.max(1, st.years);
  const ratio = clamp(passive(run).total / bowl(run), 0, 1);
  const freedom = reason === 'free' ? clamp(2 - Math.max(0, (run.freeAge ?? run.age) - 38) * 0.06, 0.9, 2) : reason === 'bankrupt' ? 0 : MODES[run.mode] && MODES[run.mode].years ? 2 * clamp(ratio / 0.3, 0, 1) : 0.9 * ratio;
  const avgJoy = st.years ? st.joySum / years : run.joy;
  const joy = clamp((avgJoy - 30) / 50, 0, 1);
  const trustAvg = st.trustYears ? st.trustSum / st.trustYears : null;
  const partner = trustAvg != null ? 0.5 * (trustAvg / 100) * (run.flags.separated ? 0.6 : 1) : 0.25;
  const kidScore = (k) => (k.outcome === 'helping' ? 1 : k.outcome === 'independent' ? 0.85 : k.outcome === 'support' ? 0.35
    : clamp(0.45 + 2.5 * (k.schoolYrs ? k.upSum / k.schoolYrs : 0), 0, 1));
  const kids = run.kids.length ? 0.5 * run.kids.reduce((s, k) => s + kidScore(k), 0) / run.kids.length : 0.2;
  const people = 0.7 * (run.rep / 100) + 0.3 * Math.min(1, st.givingSum / years / 0.05);
  const total = freedom + joy + partner + kids + people;
  return {
    stars: clamp(Math.round(total * 2) / 2, 0, 5), total,
    parts: { freedom, joy, family: partner + kids, people }, avgJoy,
  };
}

// ---------------------------------------------------------------- scoring

export function finish(run, reason) {
  const p = passive(run);
  const C = costs(run);
  const nw = netWorth(run);
  const ratio = clamp(p.total / bowl(run), 0, 1);
  const e = era(run);
  let score;
  const freeAt = run.freeAge ?? run.age;
  if (reason === 'free') score = 1000 + (60 - freeAt) * 60 + Math.round(run.joy * 3);
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
  const life = lifeScore(run, reason);
  if (reason !== 'quit') bonus += Math.round(life.stars * 150);
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
    wisdom: Math.round(score / 40) + (reason === 'free' || reason === 'target' ? 10 : 2) + run.seenP.length + (run.bonusWisdom || 0),
    learnMode: run.learnMode, aim: run.aim, aimMet, bonus, forecast: fstats,
    cureYears: run.cureYears.slice(), years: run.age - run.startAge,
    seenP: run.seenP.slice(), quizRight: run.quizRight, quizAsked: run.quizAsked.length,
    journal: (run.journal || []).slice(),
    freeAge: run.freeAge, story: storySummary(run, annual),
    life, sprint: !!MODES[run.mode].years, rules: (run.rules || []).slice(), gen: run.gen || 1,
    bonusWisdom: run.bonusWisdom || 0, got: run.got, milestones: (run.milestones || []).slice(),
    kids: run.kids.map((k) => ({ name: k.name, age: run.age - k.born, outcome: k.outcome || null, sex: k.sex, look: k.look })),
    partner: run.partner ? { name: run.partner.name, type: run.partner.type, trust: run.partner.trust, sex: run.partner.sex, look: run.partner.look } : null,
    rep: run.rep, home: { ...run.home }, car: run.car.id, landV: landValue(run),
  };
  run.phase = 'done';
  return run.result;
}

// The life story: numbers, the best and worst moments, a timeline, and a few
// honest "what ifs" computed from what actually happened.
function storySummary(run, annual) {
  const S = run.story || { memories: [], decisions: [] };
  const mem = S.memories;
  const byImpact = mem.filter((m) => m.impact).slice().sort((a, b) => b.impact - a.impact);
  const success = byImpact.find((m) => m.impact > 0 && !m.tags.includes('card'));
  const mistake = byImpact.slice().reverse().find((m) => m.impact < 0);
  const decision = byImpact.find((m) => m.tags.includes('decision') && m.impact > 0);
  const g = Math.max(0.02, annual || 0.05);
  const yearsLeft = Math.max(5, 60 - run.startAge);
  const grow = (x, yrs) => x * (Math.pow(1 + g, yrs) - 1);
  const L = run.log;
  const inv = run.h.save + run.h.index + stocksTotal(run) + run.h.crypto + run.h.fx;
  // A habit is worth a lot, but never more than a believable share of the life you actually built.
  const cap = Math.max(netWorth(run) * 0.6, run.salary * 10);
  const whatIf = [
    ['early', 'If you had started investing four years earlier', inv > 0 ? inv * (Math.pow(1 + g, 4) - 1) : 0],
    ['doodads', 'If you had skipped the car upgrades and lifestyle creep, and invested the difference', grow(((S.carLoss || 0) + L.creep * run.salary * 0.5) / 2, yearsLeft / 2)],
    ['panic', 'If you had held on instead of selling in the crash', L.panic * run.salary],
    ['diversify', 'If no single investment had held most of your money', L.conc * run.salary],
    ['promo', 'If you had taken the promotion you turned down', (run.flags.declinedPromo || 0) * 0.35 * run.salary * 0.25 * Math.min(15, yearsLeft)],
    ['scam', 'If you had walked away from the scams', L.scam * run.salary],
    ['debt', 'If an emergency fund had kept you out of expensive debt', L.debt * run.salary],
  ].map(([id, text, v]) => [id, text, Math.min(v, cap)]).filter((w) => w[2] > 0.05 * run.salary).sort((a, b) => b[2] - a[2]).slice(0, 3).map(([id, text, v]) => ({ id, text, v: Math.round(v) }));
  const people = run.circle.filter((c) => c.given > 0).length + (run.giving > 0 ? 1 : 0);
  return {
    memories: mem.slice(), decisions: (S.decisions || []).slice(),
    success, mistake, decision, whatIf,
    businesses: S.bizStarted || 0, properties: (S.propsBought || 0) + (run.home.own ? 1 : 0) + run.land.length,
    people, goals: (S.goalsDone || []).length, chapter: S.chapter,
  };
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
