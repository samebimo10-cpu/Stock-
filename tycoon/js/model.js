// Your financial picture: what you own, owe, earn and spend, your goals and
// your assumptions. Everything stays on this phone (localStorage) unless you
// export a backup yourself.

import { CURRENCIES, ASSET_CLASSES, CLASS_ORDER, SPEND_CATS, SCHOOL, suggestedMix, clamp } from './money.js';
import { portfolioVol } from './market.js';

export const KEY = 'tycoonplan.v1';
export const VERSION = 3;

// The kinds of account people add, and the asset class each one is modelled as.
// usd: the amount is entered in dollars. rate: it earns a stated interest rate.
export const ACCOUNT_TYPES = {
  current: { name: 'Current account / cash', cls: 'cash', hint: 'Money for everyday spending. Earns nothing.' },
  savings: { name: 'Savings or fixed deposit', cls: 'deposit', hint: 'Bank savings that earn interest. Enter the rate.', rate: true },
  tbill: { name: 'Treasury bills / commercial paper', cls: 'deposit', hint: 'Short government or company debt. Enter the yield.', rate: true },
  mmf: { name: 'Money market fund', cls: 'deposit', hint: 'A fund that holds T-bills and deposits. Enter its yield.', rate: true },
  coop: { name: 'Cooperative, ajo or esusu', cls: 'deposit', hint: 'Group or cooperative savings. Enter any interest or dividend rate (0 if none).', rate: true, rate0: 0 },
  loanOut: { name: 'Money you lent to someone', cls: 'deposit', hint: 'Count it only if you expect it back. Enter any interest rate (0 if none).', rate: true, rate0: 0 },
  stock: { name: 'Shares in a company', cls: null, hint: 'Search NGX or NYSE and enter how many shares you own. Valued at the latest price.', stock: true },
  fundLocal: { name: 'Local share or index fund', cls: 'localEq', hint: 'A fund that owns many local companies.' },
  fundGlobal: { name: 'US or global share fund / ETF', cls: 'globalEq', hint: 'An index fund or ETF of US or world companies. Enter its value in dollars.', usd: true },
  reit: { name: 'Real estate fund (REIT)', cls: 'reit', hint: 'Listed property funds. Earn rent and move with property prices.' },
  bond: { name: 'Bonds in your currency (FGN bonds)', cls: 'bonds', hint: 'Government or company bonds. Enter what they would sell for.' },
  usd: { name: 'Dollar or foreign-currency savings', cls: 'usdCash', hint: 'Domiciliary account, dollar money market, cash dollars, pounds or euros. Enter the value in dollars.', usd: true },
  eurobond: { name: 'Eurobonds / dollar bonds', cls: 'usdBonds', hint: 'Bonds paid in dollars. Enter the value in dollars.', usd: true },
  gold: { name: 'Gold and precious metals', cls: 'gold', hint: 'What it would sell for today in your currency.' },
  crypto: { name: 'Crypto', cls: 'crypto', hint: 'What it is worth today in your currency.' },
  pension: { name: 'Pension (RSA)', cls: 'pension', hint: 'Retirement savings you can reach from pension age.' },
  property: { name: 'House or flat', cls: 'property', hint: 'What it would sell for today. Add any rent you receive. Put its mortgage under debts.', rent: true },
  land: { name: 'Land', cls: 'land', hint: 'What it would sell for today. Land pays no rent but tends to hold its value.' },
  business: { name: 'Business', cls: 'business', hint: 'What you could sell your share for, and the profit you take out each month.', profit: true },
  farm: { name: 'Farm or agric investment', cls: 'business', hint: 'Poultry, fish, crops or an agric fund: its value and what it pays you each month.', profit: true },
  car: { name: 'Car or vehicle', cls: 'car', hint: 'What it would sell for today. Cars lose value every year.' },
};
export const TYPE_GROUPS = [
  ['Cash and safe savings', ['current', 'savings', 'tbill', 'mmf', 'coop', 'loanOut']],
  ['Shares and funds', ['stock', 'fundLocal', 'fundGlobal', 'reit', 'bond']],
  ['Dollars and foreign currency', ['usd', 'eurobond']],
  ['Property and land', ['property', 'land']],
  ['Business and farming', ['business', 'farm']],
  ['Gold and crypto', ['gold', 'crypto']],
  ['Pension', ['pension']],
  ['Vehicles', ['car']],
];
export const TYPE_ORDER = TYPE_GROUPS.flatMap((g) => g[1]);

const uid = () => Math.random().toString(36).slice(2, 10);
export { uid };

export function newState(currency = 'NGN') {
  const C = CURRENCIES[currency];
  return {
    v: VERSION,
    created: new Date().toISOString(),
    currency,
    name: '',
    born: null,
    income: [],
    spending: [],
    household: { kids: [], fees: { ...(SCHOOL[currency] || SCHOOL.USD) }, eduPrem: 0.03, givingPct: 0, car: { every: 0, cost: 0 } },
    accounts: [],
    debts: [],
    goals: [],
    plan: { retireAge: 55, spendRetire: null, planAge: 95, swr: 0.035, success: 0.85, growth: 0.015, pensionIncome: 0, mix: null, outlook: 'base' },
    assumptions: { infl: C.infl, inflSd: C.inflSd, deposit: C.deposit, usdRate: currency === 'USD' ? 1 : null, fxDrift: 0, fxSd: null, overrides: {} },
    checkins: [],
    person: { occupation: '', employment: 'salaried', marital: 'single', dependants: 0, health: 'good', riskScore: null, riskAnswers: [], experience: 'some', lifeCover: 'no', goals: '', notes: '', reviewDate: '' },
    ventures: [],
    baseline: null,
    settings: { theme: 'auto', remind: true },
  };
}

// ------------------------------------------------------------------ several people

// Each person (you, or each client you advise) is kept separately on this
// phone; a small index lists them. Version 1 kept one plan under KEY.
export const INDEX = 'tycoonplan.profiles';
const pKey = (id) => `tycoonplan.p.${id}`;
const readJSON = (k) => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch { return null; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export function profiles() {
  let idx = readJSON(INDEX);
  if (!idx) {
    idx = { active: null, list: [] };
    const old = readJSON(KEY);
    if (old) {
      const st = upgrade(old);
      idx.list.push(summaryOf(st)); idx.active = st.id;
      writeJSON(pKey(st.id), st);
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    }
    writeJSON(INDEX, idx);
  }
  return idx;
}
const summaryOf = (st, extra = {}) => ({ id: st.id, name: st.name || 'Me', currency: st.currency, updated: new Date().toISOString(), ...extra });

export function load(id) {
  const idx = profiles();
  const want = id || idx.active;
  if (!want) return null;
  const st = readJSON(pKey(want));
  return st ? upgrade(st) : null;
}
export function save(st, extra = {}) {
  if (!st.id) st.id = uid();
  const idx = profiles();
  const i = idx.list.findIndex((p) => p.id === st.id);
  const prev = i >= 0 ? idx.list[i] : {};
  const row = { ...prev, ...summaryOf(st), ...extra };
  if (i >= 0) idx.list[i] = row; else idx.list.push(row);
  idx.active = st.id;
  writeJSON(INDEX, idx);
  return writeJSON(pKey(st.id), st);
}
export function setActive(id) { const idx = profiles(); idx.active = id; writeJSON(INDEX, idx); }
export function noteSummary(id, extra) { const idx = profiles(); const r = idx.list.find((p) => p.id === id); if (r) { Object.assign(r, extra); writeJSON(INDEX, idx); } }
export function remove(id) {
  const idx = profiles();
  idx.list = idx.list.filter((p) => p.id !== id);
  if (idx.active === id) idx.active = idx.list.length ? idx.list[0].id : null;
  writeJSON(INDEX, idx);
  try { localStorage.removeItem(pKey(id)); localStorage.removeItem(`tycoonplan.analysis.${id}`); } catch { /* ignore */ }
}
export function duplicate(st, name) {
  const copy = upgrade(JSON.parse(JSON.stringify(st)));
  copy.id = uid(); copy.name = name; copy.checkins = []; copy.baseline = null; copy.created = new Date().toISOString();
  save(copy);
  return copy;
}

// The adviser's own details, shared by every profile on this phone.
export const ADVISER = 'tycoonplan.adviser';
export const adviser = () => ({ on: false, name: '', firm: '', contact: '', ...(readJSON(ADVISER) || {}) });
export const saveAdviser = (a) => writeJSON(ADVISER, a);

export function upgrade(st) {
  const base = newState(st.currency || 'NGN');
  const out = { ...base, ...st };
  out.plan = { ...base.plan, ...(st.plan || {}) };
  out.assumptions = { ...base.assumptions, ...(st.assumptions || {}) };
  out.settings = { ...base.settings, ...(st.settings || {}) };
  out.household = { ...base.household, ...(st.household || {}) };
  out.household.fees = { ...base.household.fees, ...((st.household || {}).fees || {}) };
  out.household.car = { ...base.household.car, ...((st.household || {}).car || {}) };
  if (!Array.isArray(out.household.kids)) out.household.kids = [];
  // Version 1 spending had no category or frequency.
  out.spending = (out.spending || []).map((x) => ({ cat: catGuess(x.name), freq: 'month', ...x }));
  for (const k of ['income', 'spending', 'accounts', 'debts', 'goals', 'checkins']) if (!Array.isArray(out[k])) out[k] = [];
  out.person = { ...base.person, ...(st.person || {}) };
  if (!Array.isArray(out.ventures)) out.ventures = [];
  if (!out.id) out.id = uid();
  out.v = VERSION;
  return out;
}

function catGuess(name = '') {
  const n = name.toLowerCase();
  for (const [k, c] of Object.entries(SPEND_CATS)) if (n.includes(k) || n.includes(c.name.toLowerCase().split(' ')[0])) return k;
  return 'other';
}

// ------------------------------------------------------------------ the person

// Five questions about attitude to risk, scored 1 (most careful) to 5.
export const RISK_QUIZ = [
  ['If your investments fell 25% in a year, you would…', ['Sell everything to stop the loss', 'Sell some', 'Do nothing and wait', 'Buy a little more', 'Buy a lot more']],
  ['When will you need most of this money?', ['Within 2 years', 'In 2–5 years', 'In 5–10 years', 'In 10–20 years', 'More than 20 years away']],
  ['Which would you rather have?', ['A sure 10%', 'Mostly sure, small chance of more', 'A balance', 'More chance of big gains', 'The biggest possible gain, whatever the risk']],
  ['How steady is your income?', ['Very unsteady', 'Unsteady', 'Fairly steady', 'Steady', 'Very steady, with savings behind it']],
  ['How much do you know about investing?', ['Nothing', 'A little', 'Some', 'A good deal', 'A lot, I invest actively']],
];
export const RISK_LEVELS = {
  1: { name: 'Very careful', eq: 0.5 }, 2: { name: 'Careful', eq: 0.75 }, 3: { name: 'Balanced', eq: 1 }, 4: { name: 'Growth', eq: 1.12 }, 5: { name: 'Adventurous', eq: 1.25 },
};
export function riskScore(answers) {
  const a = (answers || []).filter((x) => x != null);
  if (a.length < RISK_QUIZ.length) return null;
  const avg = a.reduce((s, x) => s + x + 1, 0) / a.length;
  // The first answer (how you behave in a fall) caps the score: tolerance shows in a crash.
  return clamp(Math.min(Math.round(avg), a[0] + 2), 1, 5);
}
export const EMPLOYMENT = { salaried: 'Employed (salary)', self: 'Self-employed', business: 'Business owner', retired: 'Retired', student: 'Student', none: 'Not working' };

// ------------------------------------------------------------------ the numbers

// A spending line in monthly terms (rent is often paid once a year).
export const monthlyOf = (x) => (x.amount || 0) / (x.freq === 'year' ? 12 : 1);

// Which school stage a child is in at a given age, and its yearly fee in today's money.
export function feeAt(st, kidAge) {
  for (const [id, , a0, a1] of SCHOOL.stages) if (kidAge >= a0 && kidAge <= a1) return st.household.fees[id] || 0;
  return 0;
}
export const kidAge = (k, year = new Date().getFullYear()) => year - (k.born || year);


export function ageOf(st, now = new Date()) {
  if (!st.born) return 30;
  const [y, m] = st.born.split('-').map(Number);
  return Math.max(16, now.getFullYear() - y - (now.getMonth() + 1 < (m || 1) ? 1 : 0));
}

// Local currency units per US dollar: from live data for NGN, else what the user set.
export function usdRate(st, market) {
  if (st.currency === 'USD') return 1;
  if (st.currency === 'NGN' && market && market.fx && !st.assumptions.usdRate) return market.fx;
  return st.assumptions.usdRate || (st.currency === 'NGN' && market && market.fx) || null;
}

export function classOf(acc) {
  if (acc.type === 'stock') return acc.ex === 'NGX' ? 'localEq' : 'globalEq';
  return ACCOUNT_TYPES[acc.type] ? ACCOUNT_TYPES[acc.type].cls : 'cash';
}

// Value of an account in the user's currency today, and where the number came from.
export function valueOf(acc, st, market) {
  const fx = usdRate(st, market) || 0;
  if (acc.type === 'stock') {
    const q = market && market.prices[acc.key];
    const price = q ? q.p : acc.lastPrice || 0;
    const cur = q ? q.c : acc.priceCur || (acc.ex === 'NGX' ? 'NGN' : 'USD');
    const local = (acc.shares || 0) * price * (cur === st.currency ? 1 : cur === 'USD' ? fx : 0);
    return { v: local, live: !!q, price, cur };
  }
  if (ACCOUNT_TYPES[acc.type] && ACCOUNT_TYPES[acc.type].usd && st.currency !== 'USD') return { v: (acc.value || 0) * fx, live: false, usd: acc.value || 0 };
  return { v: acc.value || 0, live: false };
}

export function totals(st, market) {
  const byClass = Object.fromEntries(CLASS_ORDER.map((c) => [c, 0]));
  for (const a of st.accounts) byClass[classOf(a)] += valueOf(a, st, market).v;
  const assets = Object.values(byClass).reduce((s, x) => s + x, 0);
  const debt = st.debts.reduce((s, d) => s + (d.balance || 0), 0);
  const monthlyIncome = st.income.reduce((s, x) => s + (x.amount || 0), 0);
  const rent = st.accounts.filter((a) => ACCOUNT_TYPES[a.type] && ACCOUNT_TYPES[a.type].rent).reduce((s, a) => s + (a.rent || 0), 0);
  const profit = st.accounts.filter((a) => ACCOUNT_TYPES[a.type] && ACCOUNT_TYPES[a.type].profit).reduce((s, a) => s + (a.profit || 0), 0);
  const H = st.household;
  const monthlyLiving = st.spending.reduce((s, x) => s + monthlyOf(x), 0);
  const school = H.kids.reduce((s, k) => s + feeAt(st, kidAge(k)), 0) / 12;
  const giving = (H.givingPct || 0) * monthlyIncome;
  const monthlySpend = monthlyLiving + school + giving;
  const debtPay = st.debts.reduce((s, d) => s + (d.payment || 0), 0);
  const allIn = monthlyIncome + rent + profit;
  const surplus = allIn - monthlySpend - debtPay;
  const quick = byClass.cash + byClass.deposit + byClass.usdCash;
  const investable = CLASS_ORDER.filter((c) => ASSET_CLASSES[c].liquid && c !== 'cash').reduce((s, c) => s + byClass[c], 0);
  return {
    byClass, assets, debt, netWorth: assets - debt,
    monthlyIncome, rent, profit, allIn, monthlyLiving, school, giving, monthlySpend, debtPay, surplus,
    savingsRate: allIn > 0 ? surplus / allIn : 0,
    emergencyMonths: monthlySpend > 0 ? quick / (monthlySpend + debtPay) : null,
    quick, investable,
    freedomNumber: ((st.plan.spendRetire ?? monthlyLiving) * 12) / st.plan.swr,
  };
}

// Interest earned on safe savings: the value-weighted rate across your accounts.
export function depositRateOf(st, market) {
  let w = 0; let r = 0;
  for (const a of st.accounts) {
    if (classOf(a) !== 'deposit') continue;
    const v = valueOf(a, st, market).v;
    w += v; r += v * (a.rate ?? st.assumptions.deposit);
  }
  return w > 0 ? r / w : st.assumptions.deposit;
}

// Your living costs year by year in today's money, each category rising at its
// own pace above inflation, plus giving tied to your pay.
export function spendPath(st, years, salaryPath) {
  const out = new Float64Array(years + 1);
  for (let t = 0; t <= years; t++) {
    let y = 0;
    for (const x of st.spending) y += monthlyOf(x) * 12 * Math.pow(1 + ((SPEND_CATS[x.cat] || SPEND_CATS.other).prem || 0), t);
    y += (st.household.givingPct || 0) * (salaryPath ? salaryPath(t) : 0);
    out[t] = y;
  }
  return out;
}

// Costs that come and go on a schedule: school fees by each child's stage,
// rising faster than inflation, and replacing the car every few years.
export function extraPath(st, years) {
  const H = st.household;
  const out = new Float64Array(years + 1);
  const y0 = new Date().getFullYear();
  for (let t = 0; t <= years; t++) {
    let y = 0;
    for (const k of H.kids) y += feeAt(st, kidAge(k, y0 + t)) * Math.pow(1 + (H.eduPrem || 0), t);
    if (H.car && H.car.every > 0 && H.car.cost > 0 && t > 0 && t % H.car.every === 0) y += H.car.cost;
    out[t] = y;
  }
  return out;
}

// Measured risk of the shares you actually own, blended half-and-half with the
// long-run figure so two years of history cannot dominate.
export function measuredRisk(st, market) {
  const out = {};
  if (!market || !Object.keys(market.closes || {}).length) return out;
  for (const cls of ['localEq', 'globalEq']) {
    const accs = st.accounts.filter((a) => a.type === 'stock' && classOf(a) === cls);
    if (!accs.length) continue;
    const h = accs.map((a) => ({ key: a.key, value: valueOf(a, st, market).v }));
    const pv = portfolioVol(market, h);
    if (!pv) continue;
    const classTotal = st.accounts.filter((a) => classOf(a) === cls).reduce((s, a) => s + valueOf(a, st, market).v, 0);
    const share = classTotal > 0 ? clamp(pv.covered / classTotal, 0, 1) : 0;
    const d = ASSET_CLASSES[cls].sd;
    const stockSd = Math.sqrt(0.5 * d * d + 0.5 * pv.vol * pv.vol);
    out[cls] = { sd: Math.sqrt(share * stockSd * stockSd + (1 - share) * d * d), measured: pv.vol, days: pv.days, share };
  }
  if (st.currency === 'NGN' && market.fxVol) out.fx = { sd: Math.sqrt(0.5 * 0.15 * 0.15 + 0.5 * market.fxVol * market.fxVol), measured: market.fxVol };
  return out;
}

export const OUTLOOKS = {
  cautious: { name: 'Cautious', shift: -0.015, note: 'Returns 1.5% a year lower than the long-run average.' },
  base: { name: 'Long-run average', shift: 0, note: 'Returns in line with long history.' },
  hopeful: { name: 'Hopeful', shift: 0.01, note: 'Returns 1% a year higher than the long-run average.' },
};

export function mixOf(st) {
  const age = ageOf(st);
  const C = CURRENCIES[st.currency];
  let m = st.plan.mix;
  if (!m) {
    m = suggestedMix(Math.max(0, st.plan.retireAge - age), C.usdFx);
    // The person's attitude to risk moves the share in shares up or down.
    const k = RISK_LEVELS[st.person && st.person.riskScore] ? RISK_LEVELS[st.person.riskScore].eq : 1;
    if (k !== 1) {
      const eq = ['localEq', 'globalEq'];
      const eqSum = eq.reduce((a, c) => a + (m[c] || 0), 0);
      const target = clamp(eqSum * k, 0.05, 0.95);
      const safeKeys = Object.keys(m).filter((c) => !eq.includes(c));
      const safeSum = safeKeys.reduce((a, c) => a + (m[c] || 0), 0) || 1;
      m = { ...m };
      for (const c of eq) m[c] = (m[c] || 0) * (target / (eqSum || 1));
      for (const c of safeKeys) m[c] = (m[c] || 0) * ((1 - target) / safeSum);
    }
  }
  const s = Object.values(m).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v / s]));
}

// Everything the simulation needs, in yearly amounts of today's money.
export function buildInputs(st, market, patch = {}) {
  const T = totals(st, market);
  const age = ageOf(st);
  const C = CURRENCIES[st.currency];
  const A = st.assumptions;
  const risk = measuredRisk(st, market);
  const shift = (OUTLOOKS[st.plan.outlook] || OUTLOOKS.base).shift;
  const cls = {};
  for (const c of CLASS_ORDER) {
    const base = ASSET_CLASSES[c];
    const o = A.overrides[c] || {};
    const riskier = !['cash', 'deposit', 'usdCash'].includes(c);
    cls[c] = { mu: (o.mu ?? base.mu ?? 0) + (riskier ? shift : 0), sd: o.sd ?? (risk[c] ? risk[c].sd : base.sd) };
  }
  const salary = st.income.filter((x) => x.kind !== 'other').reduce((s, x) => s + (x.amount || 0), 0) * 12;
  const other = st.income.filter((x) => x.kind === 'other').reduce((s, x) => s + (x.amount || 0), 0) * 12;
  const rate = usdRate(st, market) || 0;
  const inp = {
    age,
    years: Math.max(1, st.plan.planAge - age),
    retireAge: st.plan.retireAge,
    planAge: st.plan.planAge,
    pensionAge: C.pensionAge,
    salary,
    otherIncome: other,
    growth: st.plan.growth,
    spendNow: (T.monthlyLiving + T.giving) * 12,
    spendPath: spendPath(st, Math.max(1, st.plan.planAge - age), (t) => salary * Math.pow(1 + st.plan.growth, t)),
    extraPath: extraPath(st, Math.max(1, st.plan.planAge - age)),
    spendRetire: (st.plan.spendRetire ?? T.monthlyLiving) * 12,
    pensionIncome: (st.plan.pensionIncome || 0) * 12,
    rent: T.rent * 12,
    bizProfit: T.profit * 12,
    start: { ...T.byClass },
    debts: st.debts.filter((d) => d.balance > 0).map((d) => ({ bal: d.balance, rate: d.rate || 0, payment: d.payment || 0 })),
    goals: st.goals.map((g) => ({ id: g.id, age: g.age, amount: g.amount || 0 })),
    mix: mixOf(st),
    cls,
    infl: A.infl,
    inflSd: A.inflSd,
    depositRate: depositRateOf(st, market),
    usdFx: C.usdFx && rate > 0,
    fxDrift: A.fxDrift || 0,
    fxSd: A.fxSd ?? (risk.fx ? risk.fx.sd : 0.1),
    swr: st.plan.swr,
    ...patch,
  };
  return inp;
}
