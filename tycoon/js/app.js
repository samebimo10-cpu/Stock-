// Tycoon Rush, the wealth planner: screens and interactions.
//
// Four places: Home (where you stand and what to do next), Money (what you own,
// owe, earn and spend), Plan (your future, what-ifs and goals) and Track
// (monthly check-ins against the plan). The heavy maths runs in a worker.

import * as M from './model.js';
import { CURRENCIES, CURRENCY_ORDER, ASSET_CLASSES, CLASS_ORDER, fmt, pct, clamp, parseMoney } from './money.js';
import { loadCached, refresh as refreshMarket, searchStocks } from './market.js';
import { fanChart, lineChart, barRows, attachCharts } from './charts.js';
import { compare, payoff } from './debt.js';
import { planPdf } from './pdf.js';
import { analyse, whatIf } from './analyse.js';

const app = document.getElementById('app');
const layer = document.getElementById('layer');
const A_KEY = 'tycoonplan.analysis';

let st = M.load();
let market = loadCached();
let A = null;
let tab = 'home';
let busy = false;
let ob = null;
let whatIfExtra = 0;
let whatIfOut = null;
let debtExtra = 0;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f = (n, o) => fmt(n, st ? st.currency : 'NGN', o);
const sym = () => CURRENCIES[st ? st.currency : (ob && ob.currency) || 'NGN'].symbol;

const parsePct = (s) => { const n = parseFloat(String(s).replace('%', '')); return Number.isFinite(n) ? n / 100 : 0; };
const moneyIn = (name, val, label, hint = '') => `<label class="field"><span>${label}</span><span class="money-in"><i>${esc(sym())}</i><input name="${name}" inputmode="decimal" autocomplete="off" value="${val ? esc(Math.round(val)) : ''}" placeholder="0"></span>${hint ? `<small>${hint}</small>` : ''}</label>`;
const pctIn = (name, val, label, hint = '') => `<label class="field"><span>${label}</span><span class="money-in"><input name="${name}" inputmode="decimal" value="${val != null ? +(val * 100).toFixed(2) : ''}" placeholder="0"><i>%</i></span>${hint ? `<small>${hint}</small>` : ''}</label>`;
const numIn = (name, val, label, hint = '', attrs = '') => `<label class="field"><span>${label}</span><input name="${name}" inputmode="numeric" value="${val ?? ''}" ${attrs}>${hint ? `<small>${hint}</small>` : ''}</label>`;
const form = (el) => Object.fromEntries(new FormData(el.closest('form') || el).entries());

const ICON = {
  home: '<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/>',
  money: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
  plan: '<path d="M4 19h16M6 16l4-5 3 3 5-7"/>',
  track: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  gear: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  ok: '<path d="m5 12 4 4 10-10"/>',
  warn: '<path d="M12 4 2 20h20zM12 10v4m0 3v.5"/>',
  stop: '<circle cx="12" cy="12" r="9"/><path d="M8 8l8 8M16 8l-8 8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  live: '<circle cx="12" cy="12" r="4"/>',
};
const icon = (k, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

// ------------------------------------------------------------------ analysis

let worker = null;
let reqId = 0;
const waiting = new Map();
try {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => { const w = waiting.get(e.data.id); if (w) { waiting.delete(e.data.id); e.data.ok ? w.ok(e.data.out) : w.no(new Error(e.data.error)); } };
  // If the worker fails, finish the work here instead of waiting forever.
  worker.onerror = () => { worker = null; for (const w of waiting.values()) w.no(new Error('retry')); waiting.clear(); rerun(0); };
} catch { worker = null; }

function compute(type, patch) {
  if (worker) {
    return new Promise((ok, no) => { const id = ++reqId; waiting.set(id, { ok, no }); worker.postMessage({ id, type, st, market, patch }); });
  }
  return new Promise((ok) => setTimeout(() => ok(type === 'whatif' ? whatIf(st, market, patch) : analyse(st, market)), 20));
}

const sig = () => JSON.stringify([st.accounts, st.debts, st.income, st.spending, st.goals, st.plan, st.assumptions, st.born, st.currency, market.asOf]);
let timer = 0;
function rerun(delay = 350) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!st) return;
    busy = true; paintBusy();
    const s = sig();
    try {
      A = await compute('analyse');
      try { localStorage.setItem(A_KEY, JSON.stringify({ s, A })); } catch { /* ignore */ }
    } catch (err) { if (err.message !== 'retry') toast(`Could not run the plan: ${err.message}`); }
    busy = false;
    render();
  }, delay);
}
function loadAnalysis() {
  try { const c = JSON.parse(localStorage.getItem(A_KEY) || 'null'); if (c && c.s === sig()) { A = c.A; return true; } if (c) A = c.A; } catch { /* ignore */ }
  return false;
}
function paintBusy() { const b = document.getElementById('busy'); if (b) b.hidden = !busy; }

function commit() { M.save(st); rerun(); render(); }

// ------------------------------------------------------------------ chrome

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}

function sheet(html, { wide = false } = {}) {
  layer.innerHTML = `<div class="scrim" data-act="close"></div><section class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</section>`;
  layer.hidden = false;
  const first = layer.querySelector('input:not([type=hidden]), select, textarea, button.primary');
  if (first) setTimeout(() => first.focus(), 30);
  attachCharts(layer);
}
function closeSheet() { layer.hidden = true; layer.innerHTML = ''; }
const sheetHead = (title, sub = '') => `<header class="sheet-h"><div><h2>${esc(title)}</h2>${sub ? `<p class="muted">${sub}</p>` : ''}</div><button class="icon-btn" data-act="close" aria-label="Close">✕</button></header>`;

function topbar() {
  return `<header class="top">
    <div class="brand"><svg viewBox="0 0 32 32" class="logo" aria-hidden="true"><rect width="32" height="32" rx="8"/><path d="M8 22l6-7 4 4 6-9" /></svg><div><b>Tycoon Rush</b><small>Wealth planner</small></div></div>
    <span id="busy" class="busy" ${busy ? '' : 'hidden'}>Updating…</span>
    <button class="icon-btn" data-act="settings" aria-label="Settings">${icon('gear')}</button>
  </header>`;
}
function tabbar() {
  const t = [['home', 'Home'], ['money', 'Money'], ['plan', 'Plan'], ['track', 'Track']];
  return `<nav class="tabbar" aria-label="Sections">${t.map(([id, n]) => `<button class="${tab === id ? 'on' : ''}" data-act="tab" data-t="${id}" ${tab === id ? 'aria-current="page"' : ''}>${icon(id)}<span>${n}</span></button>`).join('')}</nav>`;
}

function render() {
  if (!st) return renderOnboarding();
  const body = { home: homeTab, money: moneyTab, plan: planTab, track: trackTab }[tab]();
  app.innerHTML = `${topbar()}<main class="page">${body}</main>${tabbar()}`;
  attachCharts(app);
}

// ------------------------------------------------------------------ status helpers

function health() {
  if (!A) return null;
  const gap = A.success - A.target;
  if (gap >= 0) return { cls: 'good', icon: 'ok', label: 'On track' };
  if (A.success >= A.target - 0.2) return { cls: 'warn', icon: 'warn', label: 'Needs work' };
  return { cls: 'bad', icon: 'stop', label: 'At risk' };
}
const freeText = (fa, planAge) => (Number.isFinite(fa.p50) ? `around ${fa.p50}` : `not by ${planAge}`);
const range = (fa, planAge) => (Number.isFinite(fa.p10) ? `${fa.p10} to ${Number.isFinite(fa.p90) ? fa.p90 : `after ${planAge}`}` : '');
function pricesLine() {
  if (!market || !market.asOf) return '<p class="fine">Live prices load when you are online. Values you type in are used meanwhile.</p>';
  const d = new Date(market.asOf);
  return `<p class="fine">${icon('live', 'live')} Prices from NGX and NYSE, ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${market.fx && st.currency === 'NGN' ? ` · $1 = ₦${Math.round(market.fx).toLocaleString()}` : ''}</p>`;
}

// ------------------------------------------------------------------ Home

function homeTab() {
  const T = M.totals(st, market);
  const H = health();
  const last = st.checkins[st.checkins.length - 1];
  const due = !last || Date.now() - new Date(last.date).getTime() > 28 * 864e5;
  return `
    <section class="hero">
      <span class="lbl">Net worth</span>
      <b class="big ${T.netWorth < 0 ? 'neg' : ''}">${f(T.netWorth, { short: false })}</b>
      <span class="muted">${f(T.assets)} owned · ${f(T.debt)} owed</span>
    </section>
    ${A && H ? `<button class="card health ${H.cls}" data-act="tab" data-t="plan">
      <span class="status ${H.cls}">${icon(H.icon)} ${H.label}</span>
      <b class="pc">${pct(A.success)}</b>
      <span>Your plan works in <b>${pct(A.success)}</b> of 2,000 possible futures, stopping work at ${st.plan.retireAge}.</span>
      <span class="muted">Financially free ${freeText(A.freeAge, st.plan.planAge)}${range(A.freeAge, st.plan.planAge) ? ` (likely ${range(A.freeAge, st.plan.planAge)})` : ''}.</span>
      <span class="go">See your plan ${icon('chev')}</span>
    </button>` : `<div class="card"><p>Working out your plan…</p></div>`}
    <section class="tiles">
      ${tile('Left over each month', f(T.surplus), T.surplus < 0 ? 'bad' : '', 'money')}
      ${tile('Savings rate', pct(T.savingsRate), T.savingsRate < 0.1 ? 'warn' : '', 'money')}
      ${tile('Emergency fund', T.emergencyMonths == null ? '–' : `${T.emergencyMonths.toFixed(1)} months`, T.emergencyMonths != null && T.emergencyMonths < 3 ? 'warn' : '', 'money')}
      ${tile('Debts', f(T.debt), '', 'debts')}
    </section>
    ${due ? `<button class="card nudge" data-act="checkin">${icon('track')}<span><b>${last ? 'Time for your monthly check-in' : 'Do your first check-in'}</b><small>Update your balances in a minute. The plan learns from what really happens.</small></span>${icon('chev')}</button>` : ''}
    <section>
      <h2 class="sec">Your next steps</h2>
      ${A ? A.steps.slice(0, 5).map((s) => `<button class="step ${s.level}" data-act="go" data-t="${s.go}">
        <span class="status ${s.level === 'urgent' ? 'bad' : s.level === 'important' ? 'warn' : 'good'}">${icon(s.level === 'urgent' ? 'stop' : s.level === 'important' ? 'warn' : 'ok')} ${s.level === 'urgent' ? 'Do first' : s.level === 'important' ? 'Important' : 'Good move'}</span>
        <b>${esc(s.title)}</b><p>${esc(s.body)}</p></button>`).join('') : '<p class="muted">…</p>'}
    </section>
    ${pricesLine()}
    <p class="fine">An educational planner, not financial advice. Your numbers stay on this phone.</p>`;
}
const tile = (k, v, cls, go) => `<button class="tile ${cls}" data-act="go" data-t="${go}"><span>${k}</span><b>${v}</b></button>`;

// ------------------------------------------------------------------ Money

function moneyTab() {
  const T = M.totals(st, market);
  const rows = CLASS_ORDER.filter((c) => T.byClass[c] > 0).map((c) => ({ label: ASSET_CLASSES[c].short, v: T.byClass[c] }));
  const accRow = (a) => {
    const v = M.valueOf(a, st, market);
    const sub = a.type === 'stock' ? `${a.shares} × ${a.sym} @ ${fmt(v.price, v.cur)}${v.live ? ' · live' : ''}` : M.ACCOUNT_TYPES[a.type].usd && st.currency !== 'USD' ? `$${Math.round(a.value || 0).toLocaleString()}` : a.type === 'savings' && a.rate ? `${pct(a.rate, 1)} a year` : a.type === 'property' && a.rent ? `Rent ${f(a.rent)}/month` : a.type === 'business' && a.profit ? `Profit ${f(a.profit)}/month` : M.ACCOUNT_TYPES[a.type].name;
    return `<button class="row" data-act="edit-acc" data-id="${a.id}"><span><b>${esc(a.name || M.ACCOUNT_TYPES[a.type].name)}</b><small>${esc(sub)}</small></span><span class="amt">${f(v.v)}${v.live ? `<i class="live-dot" title="Live price"></i>` : ''}</span></button>`;
  };
  return `
    <section class="summary">
      <div><span>Owned</span><b>${f(T.assets)}</b></div><div><span>Owed</span><b>${f(T.debt)}</b></div><div><span>Net worth</span><b>${f(T.netWorth)}</b></div>
    </section>
    ${rows.length ? `<section class="card"><h2 class="sec">Where your money is</h2>${barRows(rows, { cur: st.currency, total: T.assets })}</section>` : ''}
    <section>
      <div class="sec-h"><h2 class="sec">What you own</h2><button class="btn small" data-act="add-acc">${icon('plus')} Add</button></div>
      <div class="list">${st.accounts.length ? st.accounts.map(accRow).join('') : '<p class="muted pad">Add your bank accounts, savings, shares, pension and property.</p>'}</div>
    </section>
    <section id="debts">
      <div class="sec-h"><h2 class="sec">What you owe</h2><button class="btn small" data-act="add-debt">${icon('plus')} Add</button></div>
      <div class="list">${st.debts.length ? st.debts.map((d) => `<button class="row" data-act="edit-debt" data-id="${d.id}"><span><b>${esc(d.name)}</b><small>${pct(d.rate, 1)} · ${f(d.payment)}/month</small></span><span class="amt neg">${f(-d.balance)}</span></button>`).join('') : '<p class="muted pad">No debts. Add loans, cards, mortgages or money owed to people.</p>'}</div>
      ${st.debts.some((d) => d.balance > 0) ? debtPlanner() : ''}
    </section>
    <section>
      <div class="sec-h"><h2 class="sec">Money coming in (monthly)</h2><button class="btn small" data-act="add-inc">${icon('plus')} Add</button></div>
      <div class="list">${st.income.map((x) => `<button class="row" data-act="edit-inc" data-id="${x.id}"><span><b>${esc(x.name)}</b><small>${x.kind === 'other' ? 'Continues after you stop work' : 'Stops when you stop work'}</small></span><span class="amt">${f(x.amount)}</span></button>`).join('')}
      ${T.rent ? `<div class="row static"><span><b>Rent from property</b><small>From your property accounts</small></span><span class="amt">${f(T.rent)}</span></div>` : ''}
      ${T.profit ? `<div class="row static"><span><b>Business profit</b><small>From your business accounts</small></span><span class="amt">${f(T.profit)}</span></div>` : ''}</div>
    </section>
    <section>
      <div class="sec-h"><h2 class="sec">Spending (monthly)</h2><button class="btn small" data-act="add-sp">${icon('plus')} Add</button></div>
      <div class="list">${st.spending.map((x) => `<button class="row" data-act="edit-sp" data-id="${x.id}"><span><b>${esc(x.name)}</b></span><span class="amt">${f(x.amount)}</span></button>`).join('')}
      <div class="row static total"><span><b>Total spending</b></span><span class="amt">${f(T.monthlySpend)}</span></div>
      ${T.debtPay ? `<div class="row static"><span><b>Debt payments</b><small>From your debts</small></span><span class="amt">${f(T.debtPay)}</span></div>` : ''}</div>
    </section>
    ${pricesLine()}`;
}

function debtPlanner() {
  const c = compare(st.debts, debtExtra);
  const mo = (n) => (n == null ? 'never at this payment' : n < 24 ? `${n} months` : `${(n / 12).toFixed(1)} years`);
  return `<div class="card debt-plan">
    <h3>Your payoff plan</h3>
    <label class="field"><span>Extra you could add each month</span><span class="money-in"><i>${esc(sym())}</i><input id="debt-extra" inputmode="decimal" value="${debtExtra || ''}" placeholder="0"></span></label>
    ${st.debts.filter((d) => d.balance > 0).length > 1 ? `<div class="compare">
      <div><span>Highest rate first</span><b>${mo(c.avalanche.months)}</b><small>${f(c.avalanche.interest)} interest</small></div>
      <div><span>Smallest balance first</span><b>${mo(c.snowball.months)}</b><small>${f(c.snowball.interest)} interest</small></div>
    </div>` : `<div class="compare"><div><span>Debt-free in</span><b>${mo(c.avalanche.months)}</b><small>${f(c.avalanche.interest)} interest to pay</small></div></div>`}
    ${debtExtra > 0 && c.saved > 0 ? `<p class="good-text">${icon('ok')} Adding ${f(debtExtra)} a month saves ${f(c.saved)} and makes you debt-free ${c.sooner} months sooner.</p>` : ''}
    ${st.debts.filter((d) => d.balance > 0).length > 1 ? `<p class="muted">Paying the highest rate first always costs the least. Order: ${c.avalanche.debts.slice().sort((a, b) => (a.done ?? 1e9) - (b.done ?? 1e9)).map((d) => esc(d.name)).join(' → ')}.</p>` : ''}
  </div>`;
}

// ------------------------------------------------------------------ Plan

function planTab() {
  const T = M.totals(st, market);
  const P = st.plan;
  const age = M.ageOf(st);
  const mix = M.mixOf(st);
  const spendR = P.spendRetire ?? T.monthlySpend;
  const H = health();
  const maxExtra = Math.max(10000, Math.round((T.allIn * 0.5) / 1000) * 1000);
  return `
    <section class="card">
      <h2 class="sec">Your plan</h2>
      <label class="field"><span>Stop work at <b id="ra">${P.retireAge}</b></span><input type="range" min="${Math.max(age + 1, 30)}" max="80" value="${P.retireAge}" data-act="retire" aria-label="Stop work age"></label>
      ${moneyIn('spendRetire', spendR, 'Spending each month once you stop (today\'s money)', `You spend ${f(T.monthlySpend)} a month now.`)}
      ${moneyIn('pensionIncome', P.pensionIncome, `Pension or other income from ${CURRENCIES[st.currency].pensionAge} (monthly, today's money)`, 'Leave empty if unsure.')}
      <div class="seg-row"><span>Outlook</span><div class="seg">${Object.entries(M.OUTLOOKS).map(([k, o]) => `<button class="${P.outlook === k ? 'on' : ''}" data-act="outlook" data-v="${k}">${o.name}</button>`).join('')}</div></div>
      <div class="seg-row"><span>How sure do you want to be?</span><div class="seg">${[0.75, 0.85, 0.95].map((x) => `<button class="${P.success === x ? 'on' : ''}" data-act="sure" data-v="${x}">${pct(x)}</button>`).join('')}</div></div>
      <button class="btn primary wide" data-act="save-plan">Update my plan</button>
    </section>
    ${A ? `
    <section class="card">
      <div class="sec-h"><h2 class="sec">Your net worth over time</h2>${H ? `<span class="status ${H.cls}">${icon(H.icon)} ${H.label}</span>` : ''}</div>
      <p class="muted">In today's money. 2,000 possible futures with random markets, inflation${CURRENCIES[st.currency].usdFx ? ' and exchange rates' : ''}.</p>
      ${fanChart(A.bands, { cur: st.currency, retireAge: P.retireAge, height: 330, mark: { v: T.freedomNumber, label: `Freedom number ${f(T.freedomNumber)}` } })}
    </section>
    <section class="answers">
      ${ans('Plan works in', `${pct(A.success)} of futures`, `Money lasts to ${P.planAge}. You want ${pct(A.target)}.`)}
      ${ans('Financially free', Number.isFinite(A.freeAge.p50) ? `around ${A.freeAge.p50}` : `not by ${P.planAge}`, range(A.freeAge, P.planAge) ? `8 in 10 futures: ${range(A.freeAge, P.planAge)}` : '')}
      ${ans(`Invested when you stop at ${P.retireAge}`, f(A.liquidAtRetire.p50), `Range ${f(A.liquidAtRetire.p10)} to ${f(A.liquidAtRetire.p90)}`)}
      ${ans('Safe spending once you stop', `${f(A.safeMonthly)}/month`, `Works in ${pct(A.target)} of futures`)}
      ${ans('Earliest you could stop work', A.earliestRetire ? `${A.earliestRetire}` : 'not yet', `At your current saving, for ${pct(A.target)} success`)}
      ${ans('To reach your target', A.extraMonthly == null ? 'more income needed' : A.extraMonthly > 0 ? `save ${f(A.extraMonthly)} more/month` : 'you are there', '')}
    </section>
    <section class="card">
      <h2 class="sec">What if I saved more?</h2>
      <label class="field"><span>Extra each month: <b id="wi-v">${f(whatIfExtra)}</b></span><input type="range" min="0" max="${maxExtra}" step="${Math.max(1000, Math.round(maxExtra / 50 / 1000) * 1000)}" value="${whatIfExtra}" data-act="whatif" aria-label="Extra saving each month"></label>
      <p id="wi-out" class="wi">${whatIfHTML()}</p>
    </section>` : '<section class="card"><p>Working out your plan…</p></section>'}
    <section class="card">
      <div class="sec-h"><h2 class="sec">Where new savings go</h2><button class="btn small" data-act="edit-mix">Change</button></div>
      <p class="muted">${P.mix ? 'Your own mix.' : `Suggested for ${Math.max(0, P.retireAge - age)} years until you stop work${CURRENCIES[st.currency].usdFx ? ', with a share in dollars' : ''}.`}</p>
      ${barRows(Object.entries(mix).filter(([, v]) => v > 0).map(([k, v]) => ({ label: ASSET_CLASSES[k].short, v: v * 100 })), { format: (v) => `${Math.round(v)}%` })}
    </section>
    <section>
      <div class="sec-h"><h2 class="sec">Goals</h2><button class="btn small" data-act="add-goal">${icon('plus')} Add</button></div>
      <div class="list">${st.goals.length ? st.goals.map((g) => { const r = A && A.goals.find((x) => x.id === g.id); return `<button class="row" data-act="edit-goal" data-id="${g.id}"><span><b>${esc(g.name)}</b><small>${f(g.amount)} at ${g.age}</small></span><span class="amt">${r ? `${pct(r.prob)} likely` : '…'}</span></button>`; }).join('') : '<p class="muted pad">A house, school fees, a car, a wedding: add what you are saving for.</p>'}</div>
    </section>
    <section class="card">
      <div class="sec-h"><h2 class="sec">Assumptions</h2><button class="btn small" data-act="assumptions">Change</button></div>
      <p class="muted">Inflation ${pct(st.assumptions.infl, 1)} · savings ${pct(st.assumptions.deposit, 1)} · global shares ${pct(ASSET_CLASSES.globalEq.mu, 1)} and local shares ${pct(ASSET_CLASSES.localEq.mu, 1)} a year after inflation${A && A.risk.localEq ? ` · your local shares swing ${pct(A.risk.localEq.measured, 0)} a year (measured)` : ''}.</p>
    </section>`;
}
const ans = (k, v, s) => `<div class="ans"><span>${k}</span><b>${v}</b>${s ? `<small>${s}</small>` : ''}</div>`;
function whatIfHTML() {
  if (!whatIfExtra) return 'Slide to see how saving more changes your chances and your freedom age.';
  if (!whatIfOut) return 'Working it out…';
  const a = whatIfOut.before; const b = whatIfOut.after;
  const yrs = Number.isFinite(a.free) && Number.isFinite(b.free) ? a.free - b.free : null;
  return `Plan works in <b>${pct(a.success)} → ${pct(b.success)}</b> of futures.${yrs > 0 ? ` Free about <b>${yrs} year${yrs > 1 ? 's' : ''} sooner</b> (${a.free} → ${b.free}).` : Number.isFinite(b.free) && !Number.isFinite(a.free) ? ` Free around <b>${b.free}</b>.` : ''}`;
}

// ------------------------------------------------------------------ Track

function trackTab() {
  const pts = st.checkins.map((c) => ({ x: new Date(c.date).getTime(), y: c.nw }));
  const series = [];
  if (st.baseline && pts.length) {
    const b = st.baseline;
    const t0 = new Date(b.date).getTime();
    const tEnd = Math.max(pts[pts.length - 1].x, t0) + 90 * 864e5;
    const plan = [];
    for (let t = t0; t <= tEnd; t += 30 * 864e5) plan.push({ x: t, y: planAt(b, t) });
    series.push({ name: 'Plan', cls: 's1', pts: plan });
  }
  if (pts.length) series.push({ name: 'You', cls: 's2', pts });
  const last = st.checkins[st.checkins.length - 1];
  const settled = last && st.baseline && new Date(last.date) - new Date(st.baseline.date) > 7 * 864e5;
  const vs = settled ? last.nw - planAt(st.baseline, new Date(last.date).getTime()) : null;
  return `
    <section class="card">
      <h2 class="sec">Monthly check-in</h2>
      <p>${last ? `Last check-in ${new Date(last.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}: net worth ${f(last.nw)}.` : 'Check in once a month with your real balances. Over time this is what makes the plan accurate.'}</p>
      <button class="btn primary wide" data-act="checkin">Check in now</button>
    </section>
    ${vs != null ? `<section class="card ${vs >= 0 ? 'good' : 'warn'}-edge"><span class="status ${vs >= 0 ? 'good' : 'warn'}">${icon(vs >= 0 ? 'ok' : 'warn')} ${vs >= 0 ? 'Ahead of plan' : 'Behind plan'}</span><p>You are <b>${f(Math.abs(vs))} ${vs >= 0 ? 'ahead of' : 'behind'}</b> where your plan expected you to be by now.</p></section>` : ''}
    <section class="card">
      <h2 class="sec">You against your plan</h2>
      ${lineChart(series, { cur: st.currency, height: 280 })}
      ${st.baseline ? `<p class="muted">Plan set on ${new Date(st.baseline.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}. <button class="linkish" data-act="rebase">Set today's plan as the new baseline</button></p>` : ''}
    </section>
    <section>
      <h2 class="sec">History</h2>
      <div class="list">${st.checkins.slice().reverse().map((c, i, arr) => { const prev = arr[i + 1]; return `<div class="row static"><span><b>${new Date(c.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</b>${c.note ? `<small>${esc(c.note)}</small>` : ''}</span><span class="amt">${f(c.nw)}${prev ? `<small class="${c.nw >= prev.nw ? 'up' : 'down'}">${f(c.nw - prev.nw, { sign: true })}</small>` : ''}</span></div>`; }).join('') || '<p class="muted pad">No check-ins yet.</p>'}</div>
    </section>`;
}
// Where the plan expected your net worth to be at time t (middle outcome, today's money).
function planAt(b, t) {
  const yrs = (t - new Date(b.date).getTime()) / (365.25 * 864e5);
  const i = clamp(yrs, 0, b.p50.length - 1);
  const lo = Math.floor(i); const hi = Math.min(b.p50.length - 1, lo + 1);
  return b.p50[lo] + (b.p50[hi] - b.p50[lo]) * (i - lo);
}

function checkinSheet() {
  sheet(`${sheetHead('Monthly check-in', 'Type today\'s balances. Shares use live prices; just update the number of shares if it changed.')}
    <form id="ci">
      ${st.accounts.map((a) => a.type === 'stock' ? numIn(`s_${a.id}`, a.shares, `${esc(a.name || a.sym)} (shares)`) : M.ACCOUNT_TYPES[a.type].usd && st.currency !== 'USD' ? `<label class="field"><span>${esc(a.name)} (dollars)</span><span class="money-in"><i>$</i><input name="a_${a.id}" inputmode="decimal" value="${Math.round(a.value || 0)}"></span></label>` : moneyIn(`a_${a.id}`, a.value, esc(a.name || M.ACCOUNT_TYPES[a.type].name))).join('')}
      ${st.debts.map((d) => moneyIn(`d_${d.id}`, d.balance, `${esc(d.name)} (still owed)`)).join('')}
      <label class="field"><span>Note (optional)</span><input name="note" placeholder="e.g. bonus paid, bought land"></label>
      <button class="btn primary wide" data-act="save-checkin">Save check-in</button>
    </form>`);
}

// ------------------------------------------------------------------ forms

function accountSheet(acc) {
  const isNew = !acc;
  if (isNew) {
    sheet(`${sheetHead('Add something you own')}<div class="type-grid">${M.TYPE_ORDER.map((t) => `<button class="type" data-act="new-acc" data-type="${t}"><b>${M.ACCOUNT_TYPES[t].name}</b><small>${M.ACCOUNT_TYPES[t].hint}</small></button>`).join('')}</div>`);
    return;
  }
  const T = M.ACCOUNT_TYPES[acc.type];
  const usd = T.usd && st.currency !== 'USD';
  sheet(`${sheetHead(acc.id ? 'Edit' : T.name, T.hint)}
    <form id="acc" data-id="${acc.id || ''}" data-type="${acc.type}">
      <label class="field"><span>Name</span><input name="name" value="${esc(acc.name || '')}" placeholder="${esc(T.name)}"></label>
      ${T.stock ? `
        <label class="field"><span>Find the share (NGX or NYSE)</span><input id="stock-q" placeholder="e.g. DANGCEM, GTCO, AAPL" value="${esc(acc.sym || '')}" autocomplete="off"></label>
        <div id="stock-res" class="results"></div>
        <input type="hidden" name="key" value="${esc(acc.key || '')}">
        ${numIn('shares', acc.shares, 'Number of shares')}
        <p class="muted" id="stock-px">${acc.key && market.prices[acc.key] ? `Latest price ${fmt(market.prices[acc.key].p, market.prices[acc.key].c)}` : ''}</p>`
      : usd ? `<label class="field"><span>Value in dollars</span><span class="money-in"><i>$</i><input name="value" inputmode="decimal" value="${acc.value ? Math.round(acc.value) : ''}"></span><small>${M.usdRate(st, market) ? `At ${sym()}${Math.round(M.usdRate(st, market)).toLocaleString()} per dollar.` : 'Set the dollar rate in Settings → Assumptions.'}</small></label>`
        : moneyIn('value', acc.value, 'What it is worth today')}
      ${T.rate ? pctIn('rate', acc.rate ?? st.assumptions.deposit, 'Interest rate a year') : ''}
      ${T.rent ? moneyIn('rent', acc.rent, 'Rent you receive each month (after costs)') : ''}
      ${T.profit ? moneyIn('profit', acc.profit, 'Profit you take out each month') : ''}
      <div class="btn-row"><button class="btn primary" data-act="save-acc">Save</button>${acc.id ? '<button class="btn danger" data-act="del-acc">Delete</button>' : ''}</div>
    </form>`);
  const q = document.getElementById('stock-q');
  if (q) {
    const show = () => {
      const res = searchStocks(market, q.value);
      document.getElementById('stock-res').innerHTML = res.length ? res.map((r) => `<button type="button" class="res" data-act="pick-stock" data-key="${r.key}"><b>${esc(r.sym)}</b> <small>${esc(r.name || '')} · ${r.ex} · ${fmt(r.price, r.cur)}</small></button>`).join('') : q.value ? `<p class="muted">${Object.keys(market.prices).length ? 'No match.' : 'Prices load when you are online.'}</p>` : '';
    };
    q.addEventListener('input', show);
  }
}

function debtSheet(d = {}) {
  sheet(`${sheetHead(d.id ? 'Edit debt' : 'Add a debt', 'Loans, cards, mortgages, or money owed to family.')}
    <form id="debt" data-id="${d.id || ''}">
      <label class="field"><span>Name</span><input name="name" value="${esc(d.name || '')}" placeholder="e.g. Car loan"></label>
      ${moneyIn('balance', d.balance, 'Still owed')}
      ${pctIn('rate', d.rate, 'Interest rate a year', 'Use 0 for an interest-free loan.')}
      ${moneyIn('payment', d.payment, 'Monthly payment')}
      <div class="btn-row"><button class="btn primary" data-act="save-debt">Save</button>${d.id ? '<button class="btn danger" data-act="del-debt">Delete</button>' : ''}</div>
    </form>`);
}
function incomeSheet(x = {}) {
  sheet(`${sheetHead(x.id ? 'Edit income' : 'Add income', 'Take-home, after tax and pension deductions.')}
    <form id="inc" data-id="${x.id || ''}">
      <label class="field"><span>Name</span><input name="name" value="${esc(x.name || '')}" placeholder="e.g. Salary, side business"></label>
      ${moneyIn('amount', x.amount, 'Each month')}
      <div class="seg-row"><span>When you stop work</span><div class="seg"><label><input type="radio" name="kind" value="work" ${x.kind !== 'other' ? 'checked' : ''}> It stops</label><label><input type="radio" name="kind" value="other" ${x.kind === 'other' ? 'checked' : ''}> It continues</label></div></div>
      <div class="btn-row"><button class="btn primary" data-act="save-inc">Save</button>${x.id ? '<button class="btn danger" data-act="del-inc">Delete</button>' : ''}</div>
    </form>`);
}
function spendSheet(x = {}) {
  sheet(`${sheetHead(x.id ? 'Edit spending' : 'Add spending', 'Monthly. Leave out debt payments: they are counted under debts.')}
    <form id="sp" data-id="${x.id || ''}">
      <label class="field"><span>What for</span><select name="name">${[...new Set([x.name, ...M.SPEND_CATEGORIES].filter(Boolean))].map((c) => `<option ${c === x.name ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      ${moneyIn('amount', x.amount, 'Each month')}
      <div class="btn-row"><button class="btn primary" data-act="save-sp">Save</button>${x.id ? '<button class="btn danger" data-act="del-sp">Delete</button>' : ''}</div>
    </form>`);
}
function goalSheet(g = {}) {
  const age = M.ageOf(st);
  sheet(`${sheetHead(g.id ? 'Edit goal' : 'Add a goal', 'In today\'s money. The plan adds inflation for you.')}
    <form id="goal" data-id="${g.id || ''}">
      <label class="field"><span>Goal</span><input name="name" value="${esc(g.name || '')}" placeholder="e.g. House deposit, university fees"></label>
      ${moneyIn('amount', g.amount, 'Amount needed')}
      ${numIn('age', g.age || age + 5, 'At what age', '', `min="${age}" max="100"`)}
      <div class="btn-row"><button class="btn primary" data-act="save-goal">Save</button>${g.id ? '<button class="btn danger" data-act="del-goal">Delete</button>' : ''}</div>
    </form>`);
}
function mixSheet() {
  const mix = M.mixOf(st);
  const keys = ['deposit', 'bonds', 'localEq', 'globalEq', 'usdCash', 'crypto'];
  sheet(`${sheetHead('Where new savings go', 'Percentages of what you save each month. They will be scaled to add up to 100%.')}
    <form id="mix">${keys.map((k) => pctIn(k, mix[k] || 0, ASSET_CLASSES[k].name, k === 'crypto' ? 'High risk. The plan assumes no extra return for it.' : '')).join('')}
      <div class="btn-row"><button class="btn primary" data-act="save-mix">Save</button><button class="btn" data-act="mix-suggested">Use the suggested mix</button></div>
    </form>`);
}

function settingsSheet() {
  const As = st.assumptions;
  const C = CURRENCIES[st.currency];
  sheet(`${sheetHead('Settings')}
    <form id="set">
      <label class="field"><span>Your name (for the report)</span><input name="name" value="${esc(st.name)}"></label>
      <label class="field"><span>Born (year and month)</span><input name="born" type="month" value="${esc(st.born || '')}"></label>
      <label class="field"><span>Currency</span><select name="currency">${CURRENCY_ORDER.map((c) => `<option value="${c}" ${c === st.currency ? 'selected' : ''}>${c} · ${CURRENCIES[c].name}</option>`).join('')}</select><small>Changing it does not convert your amounts.</small></label>
      <div class="seg-row"><span>Theme</span><div class="seg">${['auto', 'light', 'dark'].map((t) => `<label><input type="radio" name="theme" value="${t}" ${st.settings.theme === t ? 'checked' : ''}> ${t[0].toUpperCase() + t.slice(1)}</label>`).join('')}</div></div>
      <button class="btn primary wide" data-act="save-settings">Save</button>
    </form>
    <div class="list">
      <button class="row" data-act="assumptions"><span><b>Assumptions</b><small>Inflation ${pct(As.infl, 1)}, savings ${pct(As.deposit, 1)}${C.usdFx ? `, $1 = ${sym()}${Math.round(M.usdRate(st, market) || 0).toLocaleString()}` : ''}</small></span>${icon('chev')}</button>
      <button class="row" data-act="refresh"><span><b>Refresh prices</b><small>${market.asOf ? `Last: ${new Date(market.asOf).toLocaleString('en-GB')}` : 'Not loaded yet'}</small></span>${icon('chev')}</button>
      <button class="row" data-act="pdf"><span><b>Download my plan (PDF)</b><small>To keep, print or share</small></span>${icon('chev')}</button>
      <button class="row" data-act="export"><span><b>Back up my data</b><small>Saves a file you can restore on any phone</small></span>${icon('chev')}</button>
      <label class="row"><span><b>Restore a backup</b><small>Replaces what is on this phone</small></span><input type="file" accept="application/json,.json" id="import" class="sr"></label>
      <button class="row" data-act="about"><span><b>How it works</b><small>The maths and its limits</small></span>${icon('chev')}</button>
      <button class="row danger-row" data-act="wipe"><span><b>Delete everything</b><small>Removes all your numbers from this phone</small></span></button>
    </div>
    <p class="fine">Produced by Ebims</p>`);
  document.getElementById('import').addEventListener('change', importBackup);
}

function assumptionsSheet() {
  const As = st.assumptions;
  const C = CURRENCIES[st.currency];
  const live = st.currency === 'NGN' && market.fx;
  sheet(`${sheetHead('Assumptions', 'Check inflation and deposit rates against your central bank and statistics office. These matter more than anything else.')}
    <form id="asm">
      ${pctIn('infl', As.infl, 'Inflation a year (average)', `Default for ${st.currency}: ${pct(C.infl, 1)}.`)}
      ${pctIn('inflSd', As.inflSd, 'How much inflation varies year to year')}
      ${pctIn('deposit', As.deposit, 'Savings, fixed deposit and T-bill rate a year', `Default: ${pct(C.deposit, 1)}.`)}
      ${C.usdFx ? `<label class="field"><span>${esc(sym())} per US dollar</span><input name="usdRate" inputmode="decimal" value="${As.usdRate || ''}" placeholder="${live ? Math.round(market.fx) : ''}"><small>${live ? `Leave empty to use the live rate (${Math.round(market.fx).toLocaleString()}).` : 'Needed to value dollar holdings.'}</small></label>
        ${pctIn('fxDrift', As.fxDrift, 'Extra yearly weakening of your currency beyond inflation', 'Leave at 0 for no view (the honest default).')}` : ''}
      <details><summary>Returns and risk by asset (advanced)</summary>
        <p class="muted">Long-run real returns after inflation, and yearly swings. Defaults follow a century of global market history.</p>
        ${['bonds', 'localEq', 'globalEq', 'usdCash', 'crypto', 'pension', 'property', 'business'].map((k) => `<div class="pair"><b>${ASSET_CLASSES[k].short}</b>${pctIn(`mu_${k}`, (As.overrides[k] || {}).mu ?? ASSET_CLASSES[k].mu, 'Return')}${pctIn(`sd_${k}`, (As.overrides[k] || {}).sd ?? ASSET_CLASSES[k].sd, 'Swing')}</div>`).join('')}
      </details>
      <div class="btn-row"><button class="btn primary" data-act="save-asm">Save</button><button class="btn" data-act="reset-asm">Reset to defaults</button></div>
    </form>`);
}

function aboutSheet() {
  sheet(`${sheetHead('How it works')}
    <div class="prose">
      <p><b>No app can know what markets will do.</b> This one gets right what can be right: the maths on your real numbers (interest, debts, inflation, compounding), and an honest range for the rest.</p>
      <p><b>2,000 futures.</b> Each one plays your life forward year by year to your planning age: your pay, spending, debt payments, goals and savings, with random market returns, random inflation${CURRENCIES[st.currency].usdFx ? ' and a random exchange rate' : ''}. Returns have fat tails, so crashes happen about as often as history says, and bad years hit local shares, property and the currency together.</p>
      <p><b>Your own shares.</b> When you hold NGX or NYSE shares, the plan measures how much they have actually swung over about two years of daily prices and blends that with the long-run figure, so one company counts as riskier than a fund.</p>
      <p><b>In today's money.</b> Every number is after inflation, so ${sym()}1M in 20 years means what ${sym()}1M buys today.</p>
      <p><b>"Free"</b> means your investments could pay ${pct(st.plan.swr, 1)} a year, plus rent, profit and pension, enough to cover your retirement spending.</p>
      <p><b>Fair comparisons.</b> What-ifs replay the same 2,000 futures, so a difference comes from your choice, not luck.</p>
      <p><b>It learns from you.</b> Monthly check-ins compare where you are with where the plan expected. Update your numbers and assumptions as life changes.</p>
      <p class="muted">Educational projections, not financial advice. Speak to a licensed adviser before large decisions. Your data never leaves this phone unless you export it.</p>
    </div>`);
}

// ------------------------------------------------------------------ onboarding

function oldGameNumbers() {
  try { const P = JSON.parse(localStorage.getItem('tycoonrush.v1') || 'null'); return P && P.me && (P.me.pay || P.me.costs) ? P.me : null; } catch { return null; }
}

function renderOnboarding() {
  if (!ob) {
    const me = oldGameNumbers();
    ob = { step: 0, currency: 'NGN', age: me ? me.age : '', income: me ? me.pay : '', spend: me ? me.costs : '', cash: me ? me.cash : '', savings: me ? me.save : '', invest: me ? (me.index || 0) + (me.stocks || 0) : '', usd: '', pension: '', property: me ? me.prop : '', debt: me ? (me.debt || 0) + (me.mortgage || 0) : '', debtRate: '', debtPay: '', retireAge: me && me.aim ? me.aim : 55, spendRetire: '', fromGame: !!me };
  }
  const steps = [obWelcome, obYou, obMonthly, obHave, obGoal];
  app.innerHTML = `<main class="ob"><div class="ob-prog" aria-hidden="true">${steps.map((_, i) => `<i class="${i <= ob.step ? 'on' : ''}"></i>`).join('')}</div>${steps[ob.step]()}</main>`;
}
const obNav = (next = 'Next') => `<div class="btn-row">${ob.step ? '<button class="btn" data-act="ob-back">Back</button>' : ''}<button class="btn primary" data-act="ob-next">${next}</button></div>`;
function obWelcome() {
  return `<section class="ob-card"><svg viewBox="0 0 32 32" class="logo big" aria-hidden="true"><rect width="32" height="32" rx="8"/><path d="M8 22l6-7 4 4 6-9"/></svg>
    <h1>Plan your money.<br>See your future.</h1>
    <p>Tycoon Rush turns your real numbers into a plan: when you can be financially free, what to do next, and how likely it is, across 2,000 possible futures.</p>
    <ul class="ticks"><li>${icon('ok')} Your numbers stay on this phone</li><li>${icon('ok')} Live NGX and NYSE prices and the dollar rate</li><li>${icon('ok')} Works offline</li></ul>
    <p class="fine">An educational planner, not financial advice.</p>
    ${obNav('Start')}</section>`;
}
function obYou() {
  return `<section class="ob-card"><h2>About you</h2>${ob.fromGame ? '<p class="muted">We filled in the numbers from your "My real life" game start. Check them.</p>' : ''}
    <form id="ob">
      <label class="field"><span>Your money is in</span><select name="currency">${CURRENCY_ORDER.map((c) => `<option value="${c}" ${c === ob.currency ? 'selected' : ''}>${CURRENCIES[c].name} (${c})</option>`).join('')}</select></label>
      ${numIn('age', ob.age, 'Your age', '', 'min="16" max="90"')}
    </form>${obNav()}</section>`;
}
function obMonthly() {
  return `<section class="ob-card"><h2>Each month</h2><form id="ob">
    ${moneyIn('income', ob.income, 'Money coming in, after tax', 'Salary, business profit you take home, side income.')}
    ${moneyIn('spend', ob.spend, 'What you spend', 'Rent, food, transport, school fees, family, fun. Leave out loan payments.')}
    </form>${obNav()}</section>`;
}
function obHave() {
  return `<section class="ob-card"><h2>What you have and owe</h2><p class="muted">Rough numbers are fine. You can add each account properly later.</p><form id="ob">
    ${moneyIn('cash', ob.cash, 'Cash and current accounts')}
    ${moneyIn('savings', ob.savings, 'Savings, fixed deposits, T-bills')}
    ${moneyIn('invest', ob.invest, 'Shares and funds')}
    ${ob.currency !== 'USD' ? `<label class="field"><span>Dollars you hold</span><span class="money-in"><i>$</i><input name="usd" inputmode="decimal" value="${ob.usd || ''}" placeholder="0"></span></label>` : ''}
    ${moneyIn('pension', ob.pension, 'Pension')}
    ${moneyIn('property', ob.property, 'Property and land (what it would sell for)')}
    ${moneyIn('debt', ob.debt, 'Total debts')}
    ${pctIn('debtRate', ob.debtRate || null, 'Their interest rate (roughly)')}
    ${moneyIn('debtPay', ob.debtPay, 'Monthly debt payments')}
    </form>${obNav()}</section>`;
}
function obGoal() {
  return `<section class="ob-card"><h2>Your goal</h2><form id="ob">
    ${numIn('retireAge', ob.retireAge, 'Age you want work to be optional', '', 'min="30" max="80"')}
    ${moneyIn('spendRetire', ob.spendRetire || ob.spend, 'Monthly spending you want then, in today\'s money')}
    </form>${obNav('See my plan')}</section>`;
}
function obRead() {
  const el = document.getElementById('ob');
  if (!el) return;
  const d = form(el);
  for (const [k, v] of Object.entries(d)) ob[k] = ['currency'].includes(k) ? v : ['age', 'retireAge'].includes(k) ? +v : k === 'debtRate' ? parsePct(v) : parseMoney(v);
}
function obFinish() {
  const s = M.newState(ob.currency);
  const now = new Date();
  s.born = `${now.getFullYear() - (ob.age || 30)}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (ob.income) s.income.push({ id: M.uid(), name: 'Take-home pay', amount: ob.income, kind: 'work' });
  if (ob.spend) s.spending.push({ id: M.uid(), name: 'Living costs', amount: ob.spend });
  const add = (type, name, value, extra = {}) => { if (value > 0) s.accounts.push({ id: M.uid(), type, name, value, ...extra }); };
  add('current', 'Cash and current accounts', ob.cash);
  add('savings', 'Savings and T-bills', ob.savings, { rate: s.assumptions.deposit });
  add('fundLocal', 'Shares and funds', ob.invest);
  add('usd', 'Dollar savings', ob.usd);
  add('pension', 'Pension', ob.pension);
  add('property', 'Property and land', ob.property);
  if (ob.debt > 0) s.debts.push({ id: M.uid(), name: 'Debts', balance: ob.debt, rate: ob.debtRate || 0.2, payment: ob.debtPay || 0 });
  s.plan.retireAge = clamp(ob.retireAge || 55, (ob.age || 30) + 1, 80);
  s.plan.spendRetire = ob.spendRetire || ob.spend || null;
  st = s; ob = null; tab = 'home';
  M.save(st); render(); rerun(0);
}

// ------------------------------------------------------------------ actions

const byId = (list, id) => list.find((x) => x.id === id);
function upsert(list, id, obj) { if (id) Object.assign(byId(list, id), obj); else list.push({ id: M.uid(), ...obj }); }

const ACT = {
  close: closeSheet,
  tab: (d) => { tab = d.t; render(); window.scrollTo(0, 0); },
  go: (d) => { if (d.t === 'debts') { tab = 'money'; render(); document.getElementById('debts')?.scrollIntoView(); } else { tab = d.t; render(); window.scrollTo(0, 0); } },
  settings: settingsSheet,
  assumptions: assumptionsSheet,
  about: aboutSheet,
  'ob-next': () => { obRead(); if (ob.step === 1 && !(ob.age >= 16)) return toast('Enter your age.'); if (ob.step === 2 && !ob.income && !ob.spend) return toast('Enter what comes in and what you spend.'); if (ob.step === 4) return obFinish(); ob.step += 1; renderOnboarding(); },
  'ob-back': () => { obRead(); ob.step -= 1; renderOnboarding(); },
  'add-acc': () => accountSheet(null),
  'new-acc': (d) => accountSheet({ type: d.type }),
  'edit-acc': (d) => accountSheet(byId(st.accounts, d.id)),
  'pick-stock': (d) => {
    const q = market.prices[d.key];
    const fm = document.getElementById('acc');
    fm.querySelector('[name=key]').value = d.key;
    document.getElementById('stock-q').value = d.key.split(':')[1];
    document.getElementById('stock-px').textContent = `Latest price ${fmt(q.p, q.c)}${q.n ? ` · ${q.n}` : ''}`;
    if (!fm.querySelector('[name=name]').value) fm.querySelector('[name=name]').value = q.n || d.key.split(':')[1];
    document.getElementById('stock-res').innerHTML = '';
  },
  'save-acc': (d, el) => {
    const fm = el.closest('form'); const v = form(fm); const type = fm.dataset.type; const T = M.ACCOUNT_TYPES[type];
    const o = { type, name: v.name.trim() };
    if (T.stock) {
      if (!v.key) return toast('Pick the share from the list.');
      const [ex, s] = v.key.split(':'); const q = market.prices[v.key];
      Object.assign(o, { key: v.key, ex, sym: s, shares: +v.shares || 0, lastPrice: q ? q.p : 0, priceCur: q ? q.c : null });
      if (!o.name) o.name = s;
    } else o.value = parseMoney(v.value);
    if (T.rate) o.rate = parsePct(v.rate);
    if (T.rent) o.rent = parseMoney(v.rent);
    if (T.profit) o.profit = parseMoney(v.profit);
    upsert(st.accounts, fm.dataset.id, o); closeSheet(); commit();
  },
  'del-acc': (d, el) => { const id = el.closest('form').dataset.id; st.accounts = st.accounts.filter((a) => a.id !== id); closeSheet(); commit(); },
  'add-debt': () => debtSheet(),
  'edit-debt': (d) => debtSheet(byId(st.debts, d.id)),
  'save-debt': (d, el) => {
    const fm = el.closest('form'); const v = form(fm);
    const o = { name: v.name.trim() || 'Debt', balance: parseMoney(v.balance), rate: parsePct(v.rate), payment: parseMoney(v.payment) };
    if (o.payment > 0 && o.balance * o.rate / 12 >= o.payment) toast('Warning: this payment does not cover the interest, so the debt will grow.');
    upsert(st.debts, fm.dataset.id, o); closeSheet(); commit();
  },
  'del-debt': (d, el) => { const id = el.closest('form').dataset.id; st.debts = st.debts.filter((x) => x.id !== id); closeSheet(); commit(); },
  'add-inc': () => incomeSheet(),
  'edit-inc': (d) => incomeSheet(byId(st.income, d.id)),
  'save-inc': (d, el) => { const fm = el.closest('form'); const v = form(fm); upsert(st.income, fm.dataset.id, { name: v.name.trim() || 'Income', amount: parseMoney(v.amount), kind: v.kind }); closeSheet(); commit(); },
  'del-inc': (d, el) => { const id = el.closest('form').dataset.id; st.income = st.income.filter((x) => x.id !== id); closeSheet(); commit(); },
  'add-sp': () => spendSheet(),
  'edit-sp': (d) => spendSheet(byId(st.spending, d.id)),
  'save-sp': (d, el) => { const fm = el.closest('form'); const v = form(fm); upsert(st.spending, fm.dataset.id, { name: v.name, amount: parseMoney(v.amount) }); closeSheet(); commit(); },
  'del-sp': (d, el) => { const id = el.closest('form').dataset.id; st.spending = st.spending.filter((x) => x.id !== id); closeSheet(); commit(); },
  'add-goal': () => goalSheet(),
  'edit-goal': (d) => goalSheet(byId(st.goals, d.id)),
  'save-goal': (d, el) => { const fm = el.closest('form'); const v = form(fm); upsert(st.goals, fm.dataset.id, { name: v.name.trim() || 'Goal', amount: parseMoney(v.amount), age: clamp(+v.age || M.ageOf(st) + 5, M.ageOf(st), 100) }); closeSheet(); commit(); },
  'del-goal': (d, el) => { const id = el.closest('form').dataset.id; st.goals = st.goals.filter((x) => x.id !== id); closeSheet(); commit(); },
  'edit-mix': mixSheet,
  'save-mix': (d, el) => { const v = form(el.closest('form')); const m = {}; for (const [k, x] of Object.entries(v)) m[k] = Math.max(0, parsePct(x)); if (!Object.values(m).some((x) => x > 0)) return toast('Give at least one a share.'); st.plan.mix = m; closeSheet(); commit(); },
  'mix-suggested': () => { st.plan.mix = null; closeSheet(); commit(); },
  outlook: (d) => { st.plan.outlook = d.v; commit(); },
  sure: (d) => { st.plan.success = +d.v; commit(); },
  'save-plan': (d, el) => {
    const card = el.closest('.card');
    st.plan.spendRetire = parseMoney(card.querySelector('[name=spendRetire]').value) || null;
    st.plan.pensionIncome = parseMoney(card.querySelector('[name=pensionIncome]').value);
    st.plan.retireAge = +card.querySelector('[data-act=retire]').value;
    whatIfOut = null; commit(); toast('Plan updated.');
  },
  checkin: () => checkinSheet(),
  'save-checkin': (d, el) => {
    const v = form(el.closest('form'));
    for (const a of st.accounts) {
      if (a.type === 'stock' && v[`s_${a.id}`] != null) a.shares = +v[`s_${a.id}`] || 0;
      else if (v[`a_${a.id}`] != null) a.value = parseMoney(v[`a_${a.id}`]);
    }
    for (const x of st.debts) if (v[`d_${x.id}`] != null) x.balance = parseMoney(v[`d_${x.id}`]);
    const T = M.totals(st, market);
    st.checkins.push({ date: new Date().toISOString(), nw: T.netWorth, assets: T.assets, debt: T.debt, note: (v.note || '').trim() });
    if (!st.baseline && A) st.baseline = { date: new Date().toISOString(), p50: A.bands.map((b) => b.p50), age: A.age };
    closeSheet(); tab = 'track'; commit(); toast('Check-in saved.');
  },
  rebase: () => { if (A) { st.baseline = { date: new Date().toISOString(), p50: A.bands.map((b) => b.p50), age: A.age }; commit(); toast('New baseline set.'); } },
  'save-settings': (d, el) => {
    const v = form(el.closest('form'));
    st.name = v.name.trim(); if (v.born) st.born = v.born;
    if (v.currency !== st.currency) { const C = CURRENCIES[v.currency]; st.currency = v.currency; Object.assign(st.assumptions, { infl: C.infl, inflSd: C.inflSd, deposit: C.deposit, usdRate: v.currency === 'USD' ? 1 : null }); }
    st.settings.theme = v.theme; applyTheme(); closeSheet(); commit();
  },
  'save-asm': (d, el) => {
    const v = form(el.closest('form')); const As = st.assumptions;
    As.infl = parsePct(v.infl); As.inflSd = parsePct(v.inflSd); As.deposit = parsePct(v.deposit);
    if (v.usdRate != null) As.usdRate = v.usdRate ? parseMoney(v.usdRate) : null;
    if (v.fxDrift != null) As.fxDrift = parsePct(v.fxDrift);
    for (const k of Object.keys(ASSET_CLASSES)) {
      if (v[`mu_${k}`] == null) continue;
      const mu = parsePct(v[`mu_${k}`]); const sd = parsePct(v[`sd_${k}`]);
      const base = ASSET_CLASSES[k];
      if (Math.abs(mu - (base.mu ?? 0)) > 1e-6 || Math.abs(sd - base.sd) > 1e-6) As.overrides[k] = { mu, sd }; else delete As.overrides[k];
    }
    closeSheet(); commit();
  },
  'reset-asm': () => { const C = CURRENCIES[st.currency]; st.assumptions = { ...st.assumptions, infl: C.infl, inflSd: C.inflSd, deposit: C.deposit, usdRate: st.currency === 'USD' ? 1 : null, fxDrift: 0, fxSd: null, overrides: {} }; closeSheet(); commit(); },
  refresh: async () => { toast('Loading prices…'); try { market = await refreshMarket(); toast('Prices updated.'); closeSheet(); commit(); } catch (e) { toast(e.message); } },
  pdf: () => { if (!A) return toast('The plan is still being worked out.'); download(new Blob([planPdf(st, market, A)], { type: 'application/pdf' }), 'my-financial-plan.pdf'); },
  export: () => download(new Blob([JSON.stringify(st, null, 2)], { type: 'application/json' }), `tycoon-plan-backup-${new Date().toISOString().slice(0, 10)}.json`),
  wipe: () => { if (!confirm('Delete all your numbers from this phone? This cannot be undone. Back up first if you want to keep them.')) return; localStorage.removeItem(M.KEY); localStorage.removeItem(A_KEY); st = null; A = null; ob = null; closeSheet(); render(); },
};

function download(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) { navigator.share({ files: [file], title: name }).catch(() => {}); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function importBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || !data.currency || !Array.isArray(data.accounts)) throw new Error('That file is not a Tycoon Rush backup.');
    if (!confirm('Replace what is on this phone with this backup?')) return;
    st = M.upgrade(data); closeSheet(); commit(); toast('Backup restored.');
  } catch (err) { toast(err.message); }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACT[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'BUTTON' || el.tagName === 'A') e.preventDefault();
  fn(el.dataset, el);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !layer.hidden) closeSheet(); });
document.addEventListener('submit', (e) => e.preventDefault());

let wiTimer = 0;
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.act === 'retire') document.getElementById('ra').textContent = t.value;
  if (t.dataset.act === 'whatif') {
    whatIfExtra = +t.value;
    document.getElementById('wi-v').textContent = f(whatIfExtra);
    whatIfOut = null;
    document.getElementById('wi-out').innerHTML = whatIfHTML();
    clearTimeout(wiTimer);
    wiTimer = setTimeout(async () => {
      if (!whatIfExtra) return;
      const inp = M.buildInputs(st, market);
      whatIfOut = await compute('whatif', { spendNow: inp.spendNow - whatIfExtra * 12 });
      const o = document.getElementById('wi-out'); if (o) o.innerHTML = whatIfHTML();
    }, 250);
  }
  if (t.id === 'debt-extra') {
    debtExtra = parseMoney(t.value);
    clearTimeout(wiTimer);
    wiTimer = setTimeout(() => { const pos = t.selectionStart; render(); const n = document.getElementById('debt-extra'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* ignore */ } } }, 500);
  }
});

function applyTheme() {
  const t = st ? st.settings.theme : 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
}

// ------------------------------------------------------------------ start

applyTheme();
if (st) { if (!loadAnalysis()) rerun(0); }
render();
if (navigator.onLine !== false) {
  refreshMarket().then((m) => { const changed = m.asOf !== market.asOf; market = m; if (st && changed) { render(); rerun(0); } }).catch(() => { /* offline: keep the last prices */ });
}
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});

export { payoff };
