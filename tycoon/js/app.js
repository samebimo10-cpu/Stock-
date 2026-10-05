// Tycoon Rush, the wealth planner: screens and interactions.
//
// Four places: Home (where you stand and what to do next), Money (what you own,
// owe, earn and spend), Plan (your future, what-ifs and goals) and Track
// (monthly check-ins against the plan). The heavy maths runs in a worker.

import * as M from './model.js';
import { CURRENCIES, CURRENCY_ORDER, ASSET_CLASSES, CLASS_ORDER, SPEND_CATS, SPEND_ORDER, SCHOOL, fmt, pct, clamp, parseMoney } from './money.js';
import { loadCached, refresh as refreshMarket, searchStocks } from './market.js';
import { fanChart, lineChart, barRows, stackedArea, deltaBars, attachCharts } from './charts.js';
import { compare, payoff } from './debt.js';
import { planPdf } from './pdf.js';
import { analyse, whatIf } from './analyse.js';
import * as V from './venture.js';

const app = document.getElementById('app');
const layer = document.getElementById('layer');
const aKey = () => `tycoonplan.analysis.${st ? st.id : 'none'}`;
let pendingVenture = null;

let st = M.load();
let market = loadCached();
let A = null;
let tab = 'home';
let busy = false;
let ob = null;
let whatIfExtra = 0;
let whatIfOut = null;
let debtExtra = 0;
let nominal = false;

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
  insights: '<path d="M5 20V11M10 20V5M15 20v-7M20 20V8"/>',
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
      try { localStorage.setItem(aKey(), JSON.stringify({ s, A })); } catch { /* ignore */ }
      M.noteSummary(st.id, { nw: A.totals.netWorth, success: A.success, name: st.name });
    } catch (err) { if (err.message !== 'retry') toast(`Could not run the plan: ${err.message}`); }
    busy = false;
    render();
    if (pendingVenture && !layer.hidden && layer.querySelector('.sheet') && !layer.querySelector('form')) ventureResultSheet(pendingVenture);
    pendingVenture = null;
  }, delay);
}
function loadAnalysis() {
  try { const c = JSON.parse(localStorage.getItem(aKey()) || 'null'); if (c && c.s === sig()) { A = c.A; return true; } if (c) A = c.A; } catch { /* ignore */ }
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
    <button class="who-chip" data-act="clients" aria-label="People and clients: ${esc(st.name || 'Me')}"><i class="avatar">${esc(initials(st.name))}</i><span>${esc((st.name || 'Me').split(' ')[0])}</span>▾</button>
    <button class="icon-btn" data-act="settings" aria-label="Settings">${icon('gear')}</button>
  </header>`;
}
function tabbar() {
  const t = [['home', 'Home'], ['money', 'Money'], ['plan', 'Plan'], ['insights', 'Insights'], ['track', 'Track']];
  return `<nav class="tabbar" aria-label="Sections">${t.map(([id, n]) => `<button class="${tab === id ? 'on' : ''}" data-act="tab" data-t="${id}" ${tab === id ? 'aria-current="page"' : ''}>${icon(id)}<span>${n}</span></button>`).join('')}</nav>`;
}

function render() {
  if (!st) return renderOnboarding();
  const body = { home: homeTab, money: moneyTab, plan: planTab, insights: insightsTab, track: trackTab }[tab]();
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
    ${personCard()}
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
      ${st.accounts.length ? M.TYPE_GROUPS.map(([g, types]) => { const accs = st.accounts.filter((a) => types.includes(a.type)); if (!accs.length) return ''; const sub = accs.reduce((s2, a) => s2 + M.valueOf(a, st, market).v, 0); return `<div class="group-h"><span>${esc(g)}</span><b>${f(sub)}</b></div><div class="list">${accs.map(accRow).join('')}</div>`; }).join('') : '<div class="list"><p class="muted pad">Add your bank accounts, T-bills, shares, dollars, land, property, business, gold, crypto, pension and car.</p></div>'}
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
      <div class="sec-h"><h2 class="sec">Household spending</h2><button class="btn small" data-act="add-sp">${icon('plus')} Add</button></div>
      <div class="list">${st.spending.map((x) => { const C = SPEND_CATS[x.cat] || SPEND_CATS.other; return `<button class="row" data-act="edit-sp" data-id="${x.id}"><span><b>${esc(x.name || C.name)}</b><small>${x.freq === 'year' ? `${f(x.amount)} a year · ` : ''}${C.prem ? `rises ${pct(C.prem, 0)} faster than prices` : 'rises with prices'}</small></span><span class="amt">${f(M.monthlyOf(x))}<small>a month</small></span></button>`; }).join('')}
      ${T.school ? `<div class="row static"><span><b>School fees</b><small>From your children below</small></span><span class="amt">${f(T.school)}<small>a month</small></span></div>` : ''}
      ${T.giving ? `<div class="row static"><span><b>Giving</b><small>${pct(st.household.givingPct, 0)} of income</small></span><span class="amt">${f(T.giving)}<small>a month</small></span></div>` : ''}
      <div class="row static total"><span><b>Total spending</b></span><span class="amt">${f(T.monthlySpend)}<small>a month</small></span></div>
      ${T.debtPay ? `<div class="row static"><span><b>Debt payments</b><small>From your debts</small></span><span class="amt">${f(T.debtPay)}</span></div>` : ''}</div>
    </section>
    ${householdSection()}
    ${pricesLine()}`;
}

function householdSection() {
  const H = st.household;
  const stage = (a) => { const s2 = SCHOOL.stages.find(([, , a0, a1]) => a >= a0 && a <= a1); return s2 ? s2[1] : a < 3 ? 'Not in school yet' : 'Finished school'; };
  return `<section id="household">
      <div class="sec-h"><h2 class="sec">Children and school</h2><button class="btn small" data-act="add-kid">${icon('plus')} Add child</button></div>
      <div class="list">${H.kids.length ? H.kids.map((k) => { const a = M.kidAge(k); return `<button class="row" data-act="edit-kid" data-id="${k.id}"><span><b>${esc(k.name || 'Child')}</b><small>Age ${a} · ${stage(a)}</small></span><span class="amt">${f(M.feeAt(st, a))}<small>a year now</small></span></button>`; }).join('') : '<p class="muted pad">Add children to plan their school fees from nursery to university.</p>'}
      <button class="row" data-act="household"><span><b>School fees, car and giving</b><small>Fees a year: ${SCHOOL.stages.map(([id, n]) => `${n.toLowerCase()} ${f(H.fees[id] || 0)}`).join(', ')}${H.car.every ? ` · new car every ${H.car.every} years` : ''}${H.givingPct ? ` · giving ${pct(H.givingPct, 0)}` : ''}</small></span>${icon('chev')}</button></div>
      <p class="fine">School fees rise ${pct(H.eduPrem, 0)} a year faster than prices in your plan.</p>
    </section>`;
}

// ------------------------------------------------------------------ Insights

const NAMES = Object.fromEntries(Object.entries(ASSET_CLASSES).map(([k, v]) => [k, v.short]));
const stat = (k, v, cls) => `<div class="stat ${cls}"><span>${k}</span><b>${v}</b></div>`;

function insightsTab() {
  if (!A || !A.portfolio) return '<section class="card"><p>Working out your plan…</p></section>';
  const P = A.portfolio;
  const infl = A.infl;
  const fac = (t) => (nominal ? Math.pow(1 + infl, t) : 1);
  const money = nominal ? `future money (prices rising about ${pct(infl, 0)} a year)` : "today's money";
  const rows = A.middle || [];
  const pick = rows.filter((r, i) => i < 10 || r.age % 5 === 0 || r.age === st.plan.retireAge || i === rows.length - 1);
  const yr0 = new Date().getFullYear();
  return `
    <section class="seg-row"><span>Show amounts in</span><div class="seg"><button class="${nominal ? '' : 'on'}" data-act="nominal" data-v="0">Today's money</button><button class="${nominal ? 'on' : ''}" data-act="nominal" data-v="1">Future money</button></div></section>
    <section class="card">
      <h2 class="sec">Your investments today</h2>
      <div class="stat-row">
        ${stat('Expected return after inflation', `${pct(P.mu, 1)} a year`, P.mu < 0 ? 'bad' : '')}
        ${stat('Typical yearly swing', pct(P.vol, 0), '')}
        ${stat('Risk level', P.level, '')}
        ${stat('A bad year (1 in 20)', pct(P.badYear, 0), 'bad')}
        ${stat('In dollars, gold or crypto', pct(P.usdShare, 0), '')}
        ${stat('Easy to sell quickly', pct(P.liquidShare, 0), '')}
      </div>
      <div class="table-wrap"><table><thead><tr><th>What you own</th><th>Value</th><th>Share</th><th>Real return</th></tr></thead><tbody>
        ${P.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${f(r.value)}</td><td>${pct(r.weight, 0)}</td><td class="${r.real < 0 ? 'neg' : ''}">${pct(r.real, 1)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Add what you own under Money.</td></tr>'}
      </tbody></table></div>
      <p class="muted">Real return means after inflation of ${pct(infl, 1)} a year. Cars lose value and are left out.</p>
    </section>
    ${P.accounts.length ? `<section class="card"><h2 class="sec">Is your safe money beating inflation?</h2><div class="table-wrap"><table><thead><tr><th>Account</th><th>Rate</th><th>Real</th></tr></thead><tbody>
      ${P.accounts.map((a) => `<tr><td>${esc(a.name)}</td><td>${pct(a.rate, 1)}</td><td><span class="status ${a.real >= 0 ? 'good' : a.real > -0.02 ? 'warn' : 'bad'}">${icon(a.real >= 0 ? 'ok' : 'warn')} ${pct(a.real, 1)}</span></td></tr>`).join('')}
    </tbody></table></div></section>` : ''}
    <section class="card">
      <h2 class="sec">What your wealth is made of</h2>
      <p class="muted">The middle path, in ${money}. Hover or tap for the numbers.</p>
      ${stackedArea(rows.map((r) => ({ ...r, classes: Object.fromEntries(Object.entries(r.classes).filter(([k]) => k !== 'car')) })), { cur: st.currency, names: NAMES, factor: (i) => fac(i + 1), height: 360 })}
    </section>
    <section class="card">
      <h2 class="sec">What could go wrong</h2>
      <p class="muted">How each shock would change your chance of success, which is ${pct(A.success)} now.</p>
      <div class="list flat">${A.stress.map((x) => `<div class="row static"><span><b>${esc(x.name)}</b><small>${esc(x.what)}</small></span><span class="amt"><span class="status ${x.delta >= -0.02 ? 'good' : x.delta > -0.1 ? 'warn' : 'bad'}">${pct(x.success)}</span><small>${x.delta >= 0 ? '+' : '−'}${Math.abs(Math.round(x.delta * 100))} pts</small></span></div>`).join('')}</div>
    </section>
    <section class="card">
      <h2 class="sec">What matters most to your plan</h2>
      <p class="muted">Each change on its own, in points of success. Effort pays most at the top.</p>
      ${deltaBars(A.sensitivity)}
    </section>
    <section class="card">
      <h2 class="sec">Year by year</h2>
      <p class="muted">The middle path, in ${money}. Saved is what is left after spending and debt payments; growth is what your money earned.</p>
      <div class="table-wrap"><table class="yby"><thead><tr><th>Age</th><th>Year</th><th>Income</th><th>Living</th><th>School, car</th><th>Debts</th><th>Saved</th><th>Growth</th><th>Net worth</th></tr></thead><tbody>
        ${pick.map((r) => { const i = rows.indexOf(r) + 1; const k = fac(i); return `<tr class="${r.age === st.plan.retireAge ? 'mark' : ''}"><td>${r.age}</td><td>${yr0 + i}</td><td>${f(r.income * k)}</td><td>${f(r.living * k)}</td><td>${r.extra ? f(r.extra * k) : '–'}</td><td>${r.debtCost ? f(r.debtCost * k) : '–'}</td><td class="${r.saved < 0 ? 'neg' : ''}">${f(r.saved * k)}</td><td class="${r.growth < 0 ? 'neg' : ''}">${f(r.growth * k)}</td><td><b>${f(r.nw * k)}</b></td></tr>`; }).join('')}
      </tbody></table></div>
      <p class="fine">The highlighted row is the year you stop work.</p>
    </section>`;
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
  const spendR = P.spendRetire ?? T.monthlyLiving;
  const H = health();
  const maxExtra = Math.max(10000, Math.round((T.allIn * 0.5) / 1000) * 1000);
  return `
    <section class="card">
      <h2 class="sec">Your plan</h2>
      <label class="field"><span>Stop work at <b id="ra">${P.retireAge}</b></span><input type="range" min="${Math.max(age + 1, 30)}" max="80" value="${P.retireAge}" data-act="retire" aria-label="Stop work age"></label>
      ${moneyIn('spendRetire', spendR, 'Spending each month once you stop (today\'s money)', `Your living costs now: ${f(T.monthlyLiving)} a month. School fees and car replacements are planned separately.`)}
      ${moneyIn('pensionIncome', P.pensionIncome, `Pension or other income from ${CURRENCIES[st.currency].pensionAge} (monthly, today's money)`, 'Leave empty if unsure.')}
      <div class="seg-row"><span>Outlook</span><div class="seg">${Object.entries(M.OUTLOOKS).map(([k, o]) => `<button class="${P.outlook === k ? 'on' : ''}" data-act="outlook" data-v="${k}">${o.name}</button>`).join('')}</div></div>
      <div class="seg-row"><span>How sure do you want to be?</span><div class="seg">${[0.75, 0.85, 0.95].map((x) => `<button class="${P.success === x ? 'on' : ''}" data-act="sure" data-v="${x}">${pct(x)}</button>`).join('')}</div></div>
      <button class="btn primary wide" data-act="save-plan">Update my plan</button>
    </section>
    ${A ? `
    <section class="card">
      <div class="sec-h"><h2 class="sec">Your net worth over time</h2>${H ? `<span class="status ${H.cls}">${icon(H.icon)} ${H.label}</span>` : ''}</div>
      <div class="seg small"><button class="${nominal ? '' : 'on'}" data-act="nominal" data-v="0">Today's money</button><button class="${nominal ? 'on' : ''}" data-act="nominal" data-v="1">Future money</button></div>
      <p class="muted">${nominal ? `In future money, with prices rising about ${pct(A.infl, 0)} a year.` : "In today's money."} 2,000 possible futures with random markets, inflation${CURRENCIES[st.currency].usdFx ? ' and exchange rates' : ''}.</p>
      ${fanChart(nominal ? A.bands.map((b, i) => { const k = Math.pow(1 + A.infl, i); return { age: b.age, p10: b.p10 * k, p25: b.p25 * k, p50: b.p50 * k, p75: b.p75 * k, p90: b.p90 * k }; }) : A.bands, { cur: st.currency, retireAge: P.retireAge, height: 330, mark: { v: T.freedomNumber, label: `Freedom number ${f(T.freedomNumber)}` } })}
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
    ${venturesSection()}
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
    sheet(`${sheetHead('Add something you own')}${M.TYPE_GROUPS.map(([g, types]) => `<h3 class="group-t">${esc(g)}</h3><div class="type-grid">${types.map((t) => `<button class="type" data-act="new-acc" data-type="${t}"><b>${M.ACCOUNT_TYPES[t].name}</b><small>${M.ACCOUNT_TYPES[t].hint}</small></button>`).join('')}</div>`).join('')}`);
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
      ${T.rate ? pctIn('rate', acc.rate ?? (T.rate0 ?? st.assumptions.deposit), 'Interest or yield a year', `Prices are rising about ${pct(st.assumptions.infl, 0)} a year.`) : ''}
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
  const cat = x.cat || 'food';
  const freq = x.freq || (cat === 'rent' ? 'year' : 'month');
  sheet(`${sheetHead(x.id ? 'Edit spending' : 'Add spending', 'Leave out debt payments and school fees: they are counted under debts and children.')}
    <form id="sp" data-id="${x.id || ''}">
      <label class="field"><span>Category</span><select name="cat" id="sp-cat">${SPEND_ORDER.map((c) => `<option value="${c}" ${c === cat ? 'selected' : ''}>${esc(SPEND_CATS[c].name)}${SPEND_CATS[c].prem ? ` (rises ${pct(SPEND_CATS[c].prem, 0)} faster than prices)` : ''}</option>`).join('')}</select></label>
      <label class="field"><span>Name (optional)</span><input name="name" id="sp-name" value="${esc(x.name || '')}" placeholder="e.g. Flat rent, Diesel, Groceries"></label>
      ${moneyIn('amount', x.amount, 'Amount')}
      <div class="seg-row"><span>How often</span><div class="seg"><label><input type="radio" name="freq" value="month" ${freq === 'month' ? 'checked' : ''}> Each month</label><label><input type="radio" name="freq" value="year" ${freq === 'year' ? 'checked' : ''}> Each year</label></div></div>
      <div class="btn-row"><button class="btn primary" data-act="save-sp">Save</button>${x.id ? '<button class="btn danger" data-act="del-sp">Delete</button>' : ''}</div>
    </form>`);
}

function kidSheet(k = {}) {
  const yr = new Date().getFullYear();
  sheet(`${sheetHead(k.id ? 'Edit child' : 'Add a child', 'Fees follow their age: nursery 3–5, primary 6–11, secondary 12–17, university 18–21.')}
    <form id="kid" data-id="${k.id || ''}">
      <label class="field"><span>Name</span><input name="name" id="kid-name" value="${esc(k.name || '')}" placeholder="e.g. Ada"></label>
      ${numIn('born', k.born || yr - 3, 'Year of birth (or expected birth)', '', `min="${yr - 30}" max="${yr + 10}"`)}
      <div class="btn-row"><button class="btn primary" data-act="save-kid">Save</button>${k.id ? '<button class="btn danger" data-act="del-kid">Delete</button>' : ''}</div>
    </form>`);
}

function householdSheet() {
  const H = st.household;
  sheet(`${sheetHead('School fees, car and giving', 'In today\'s money. The plan adds inflation for you.')}
    <form id="hh">
      <h3 class="group-t">School fees a year, per child</h3>
      ${SCHOOL.stages.map(([id, n, a0, a1]) => moneyIn(`fee_${id}`, H.fees[id], `${n} (ages ${a0}–${a1})`)).join('')}
      ${pctIn('eduPrem', H.eduPrem, 'How much faster than prices school fees rise, a year')}
      <h3 class="group-t">Car</h3>
      ${numIn('carEvery', H.car.every || '', 'Replace your car every how many years? (empty for never)')}
      ${moneyIn('carCost', H.car.cost, 'Cost of each replacement, after selling the old one')}
      <h3 class="group-t">Giving</h3>
      ${pctIn('givingPct', H.givingPct, 'Share of your income you give (tithe, charity, family)')}
      <button class="btn primary wide" data-act="save-hh">Save</button>
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
      <label class="row"><span><b>Restore a backup</b><small>Adds it as a person on this phone</small></span><input type="file" accept="application/json,.json" id="import" class="sr"></label>
      <button class="row" data-act="about"><span><b>How it works</b><small>The maths and its limits</small></span>${icon('chev')}</button>
      <button class="row" data-act="clients"><span><b>People and clients</b><small>Switch person, add a client, adviser details</small></span>${icon('chev')}</button>
      <button class="row danger-row" data-act="wipe"><span><b>Delete this person's plan</b><small>Removes ${esc(st.name || 'this plan')} from this phone</small></span></button>
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
    ob = { step: 0, rent: '', kids: '', currency: 'NGN', age: me ? me.age : '', income: me ? me.pay : '', spend: me ? me.costs : '', cash: me ? me.cash : '', savings: me ? me.save : '', invest: me ? (me.index || 0) + (me.stocks || 0) : '', usd: '', pension: '', property: me ? me.prop : '', debt: me ? (me.debt || 0) + (me.mortgage || 0) : '', debtRate: '', debtPay: '', retireAge: me && me.aim ? me.aim : 55, spendRetire: '', fromGame: !!me };
  }
  const steps = [obWelcome, obYou, obMonthly, obHave, obGoal];
  app.innerHTML = `<main class="ob"><div class="ob-prog" aria-hidden="true">${steps.map((_, i) => `<i class="${i <= ob.step ? 'on' : ''}"></i>`).join('')}</div>${steps[ob.step]()}</main>`;
}
const obNav = (next = 'Next') => `<div class="btn-row">${ob.step ? '<button class="btn" data-act="ob-back">Back</button>' : M.profiles().list.length ? '<button class="btn" data-act="ob-cancel">Cancel</button>' : ''}<button class="btn primary" data-act="ob-next">${next}</button></div>`;
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
      <label class="field"><span>Name</span><input name="name" id="ob-name" value="${esc(ob.name || '')}" placeholder="Your name, or your client's"></label>
      ${numIn('age', ob.age, 'Age', '', 'min="16" max="90"')}
    </form>${obNav()}</section>`;
}
function obMonthly() {
  return `<section class="ob-card"><h2>Each month</h2><form id="ob">
    ${moneyIn('income', ob.income, 'Money coming in, after tax', 'Salary, business profit you take home, side income.')}
    ${moneyIn('spend', ob.spend, 'What you spend', 'Food, transport, power, bills, family, fun. Leave out rent, school fees and loan payments.')}
    ${moneyIn('rent', ob.rent, 'Rent a year (if you rent)', 'Many landlords collect a year at a time.')}
    ${numIn('kids', ob.kids, 'Children (yours or ones you pay school fees for)', 'Add their ages under Money → Children later.', 'min="0" max="12"')}
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
    ${moneyIn('spendRetire', ob.spendRetire || (ob.spend || 0) + (ob.rent || 0) / 12, 'Monthly spending you want then, in today\'s money', 'Starts at what you spend now, including rent.')}
    </form>${obNav('See my plan')}</section>`;
}
function obRead() {
  const el = document.getElementById('ob');
  if (!el) return;
  const d = form(el);
  for (const [k, v] of Object.entries(d)) ob[k] = ['currency', 'name'].includes(k) ? v : ['age', 'retireAge', 'kids'].includes(k) ? +v : k === 'debtRate' ? parsePct(v) : parseMoney(v);
}
function obFinish() {
  const s = M.newState(ob.currency);
  s.name = (ob.name || '').trim();
  const now = new Date();
  s.born = `${now.getFullYear() - (ob.age || 30)}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (ob.income) s.income.push({ id: M.uid(), name: 'Take-home pay', amount: ob.income, kind: 'work' });
  if (ob.spend) s.spending.push({ id: M.uid(), cat: 'other', name: 'Living costs', amount: ob.spend, freq: 'month' });
  if (ob.rent) s.spending.push({ id: M.uid(), cat: 'rent', name: 'Rent', amount: ob.rent, freq: 'year' });
  for (let i = 0; i < Math.min(12, ob.kids || 0); i++) s.household.kids.push({ id: M.uid(), name: `Child ${i + 1}`, born: now.getFullYear() - 6 });
  const add = (type, name, value, extra = {}) => { if (value > 0) s.accounts.push({ id: M.uid(), type, name, value, ...extra }); };
  add('current', 'Cash and current accounts', ob.cash);
  add('savings', 'Savings and T-bills', ob.savings, { rate: s.assumptions.deposit });
  add('fundLocal', 'Shares and funds', ob.invest);
  add('usd', 'Dollar savings', ob.usd);
  add('pension', 'Pension', ob.pension);
  add('property', 'Property and land', ob.property);
  if (ob.debt > 0) s.debts.push({ id: M.uid(), name: 'Debts', balance: ob.debt, rate: ob.debtRate || 0.2, payment: ob.debtPay || 0 });
  s.plan.retireAge = clamp(ob.retireAge || 55, (ob.age || 30) + 1, 80);
  s.plan.spendRetire = ob.spendRetire || null;
  st = s; ob = null; tab = 'home';
  M.save(st); render(); rerun(0);
}

// ------------------------------------------------------------------ people: you, or the clients you advise

const initials = (n) => (n || 'Me').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'ME';

function clientsSheet() {
  const idx = M.profiles();
  const adv = M.adviser();
  sheet(`${sheetHead(adv.on ? 'Your clients' : 'People', adv.on ? 'Each client has their own plan on this phone.' : 'Keep a separate plan for each person: you, your spouse, a parent, or clients you advise.')}
    <div class="list">${idx.list.map((p) => `<button class="row ${p.id === st.id ? 'current' : ''}" data-act="open-person" data-id="${p.id}">
      <span class="who"><i class="avatar">${esc(initials(p.name))}</i><span><b>${esc(p.name || 'Me')}</b><small>${p.currency || ''}${p.nw != null ? ` · net worth ${fmt(p.nw, p.currency)}` : ''}${p.success != null ? ` · plan works in ${pct(p.success)}` : ''}</small></span></span>
      ${p.id === st.id ? '<span class="status good">Open</span>' : icon('chev')}</button>`).join('')}</div>
    <div class="btn-row"><button class="btn primary" data-act="new-person">${icon('plus')} New person</button><button class="btn" data-act="dup-person">Copy this plan</button></div>
    <form id="adv" class="card">
      <h3 class="group-t">Advising others</h3>
      <div class="seg-row"><span>Use as an adviser</span><div class="seg"><label><input type="radio" name="on" value="no" ${adv.on ? '' : 'checked'}> No</label><label><input type="radio" name="on" value="yes" ${adv.on ? 'checked' : ''}> Yes</label></div></div>
      <label class="field"><span>Your name (printed on reports)</span><input name="name" id="adv-name" value="${esc(adv.name)}"></label>
      <label class="field"><span>Firm or practice</span><input name="firm" id="adv-firm" value="${esc(adv.firm)}"></label>
      <label class="field"><span>Contact (phone or email for the report)</span><input name="contact" id="adv-contact" value="${esc(adv.contact)}"></label>
      <button class="btn wide" data-act="save-adviser">Save</button>
    </form>
    <p class="fine">Everything stays on this phone. Back up each person from Settings.</p>`);
}

function confirmSheet(title, body, act, label = 'Delete', data = {}) {
  sheet(`${sheetHead(title)}<p>${body}</p>
    <div class="btn-row"><button class="btn" data-act="close">Cancel</button><button class="btn danger-solid" data-act="${act}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${esc(label)}</button></div>`);
}

// ------------------------------------------------------------------ the person behind the numbers

function personCard() {
  const P = st.person;
  const age = M.ageOf(st);
  const risk = P.riskScore ? M.RISK_LEVELS[P.riskScore].name : null;
  const deps = (P.dependants || 0) + st.household.kids.length;
  const bits = [`${age}`, M.EMPLOYMENT[P.employment] || '', P.occupation, P.marital === 'married' ? 'married' : '', deps ? `${deps} dependant${deps > 1 ? 's' : ''}` : ''].filter(Boolean);
  return `<button class="card person" data-act="person">
    <span class="who"><i class="avatar big">${esc(initials(st.name))}</i><span><b>${esc(st.name || 'You')}</b><small>${esc(bits.join(' · '))}</small></span></span>
    <span class="chips">${risk ? `<span class="chip">Risk: ${esc(risk)}</span>` : '<span class="chip warn">Risk profile not done</span>'}${P.health !== 'good' ? `<span class="chip">Health: ${esc(P.health)}</span>` : ''}${P.reviewDate ? `<span class="chip">Review ${esc(new Date(P.reviewDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</span>` : ''}</span>
    ${P.goals ? `<span class="muted">${esc(P.goals)}</span>` : ''}
  </button>`;
}

function personSheet() {
  const P = st.person;
  const opt = (name, opts, val) => `<select name="${name}" id="p-${name}">${opts.map(([k, n]) => `<option value="${k}" ${String(k) === String(val) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
  sheet(`${sheetHead('About this person', 'The human side of the plan. It shapes the advice and the odds.')}
    <form id="person">
      <label class="field"><span>Name</span><input name="name" id="p-name" value="${esc(st.name)}"></label>
      <label class="field"><span>Born (year and month)</span><input name="born" id="p-born" type="month" value="${esc(st.born || '')}"></label>
      <label class="field"><span>Work</span>${opt('employment', Object.entries(M.EMPLOYMENT), P.employment)}<small>Self-employed and business owners need a bigger emergency fund.</small></label>
      <label class="field"><span>Occupation</span><input name="occupation" id="p-occupation" value="${esc(P.occupation)}" placeholder="e.g. Pharmacist, trader, engineer"></label>
      <label class="field"><span>Family</span>${opt('marital', [['single', 'Single'], ['married', 'Married'], ['partner', 'Living with a partner'], ['widowed', 'Widowed'], ['divorced', 'Divorced']], P.marital)}</label>
      ${numIn('dependants', P.dependants, 'Other people who depend on you (parents, relatives)', 'Children are added under Money.', 'min="0" max="20"')}
      <label class="field"><span>Health</span>${opt('health', [['good', 'Good'], ['fair', 'Fair'], ['poor', 'Poor']], P.health)}</label>
      <label class="field"><span>Life insurance</span>${opt('lifeCover', [['no', 'None'], ['yes', 'Yes, enough to protect dependants']], P.lifeCover)}</label>
      <label class="field"><span>Investing experience</span>${opt('experience', [['none', 'None'], ['some', 'Some'], ['experienced', 'Experienced']], P.experience)}</label>
      <label class="field"><span>Goals in their own words</span><textarea name="goals" id="p-goals" rows="2" placeholder="e.g. Own a home by 40, put three children through university, retire to the farm">${esc(P.goals)}</textarea></label>
      <label class="field"><span>Notes</span><textarea name="notes" id="p-notes" rows="3" placeholder="Anything that matters: plans, worries, family obligations">${esc(P.notes)}</textarea></label>
      <label class="field"><span>Next review</span><input name="reviewDate" id="p-review" type="date" value="${esc(P.reviewDate)}"></label>
      <div class="btn-row"><button class="btn primary" data-act="save-person">Save</button><button class="btn" data-act="risk-quiz">${P.riskScore ? 'Redo risk questions' : 'Answer risk questions'}</button></div>
    </form>`);
}

function riskSheet() {
  const a = st.person.riskAnswers || [];
  sheet(`${sheetHead('Attitude to risk', 'Five questions. The answer to the first counts most, because how you act in a fall matters more than what you hope for.')}
    <form id="risk">${M.RISK_QUIZ.map(([q, opts], i) => `<fieldset class="quiz"><legend>${i + 1}. ${esc(q)}</legend>${opts.map((o, j) => `<label><input type="radio" name="q${i}" value="${j}" ${a[i] === j ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</fieldset>`).join('')}
      <button class="btn primary wide" data-act="save-risk">See the result</button>
    </form>`);
}

// ------------------------------------------------------------------ plans: businesses and investments

function venturesSection() {
  return `<section id="ventures">
    <div class="sec-h"><h2 class="sec">Business and investment plans</h2><button class="btn small" data-act="add-venture">${icon('plus')} Add</button></div>
    <div class="list">${st.ventures.length ? st.ventures.map((v) => { const r = A && A.ventures && A.ventures.find((x) => x.id === v.id); const st2 = r ? (r.success >= 0.65 ? 'good' : r.success >= 0.45 ? 'warn' : 'bad') : ''; return `<button class="row" data-act="venture-result" data-id="${v.id}"><span><b>${esc(v.name || V.KINDS[v.kind].name)}</b><small>${esc(V.KINDS[v.kind].name)}${v.include === false ? ' · not in your plan' : ''}</small></span><span class="amt">${r ? `<span class="status ${st2}">${pct(r.success)}</span><small>${esc(successWord(v))}</small>` : '…'}</span></button>`; }).join('') : '<p class="muted pad">Thinking of starting a business, building to rent, buying land, or putting money into shares or someone else\'s venture? Add it to see its chances in 2,000 scenarios and what it does to the whole plan.</p>'}</div>
  </section>`;
}
const successWord = (v) => (v.successTest === 'survive' ? `still running after ${v.years} years` : v.successTest === 'payback' ? `pays back within ${v.years} years` : 'beats safe savings');

function ventureKindSheet() {
  sheet(`${sheetHead('What are you planning?')}<div class="type-grid">${Object.entries(V.KINDS).map(([k, x]) => `<button class="type" data-act="new-venture" data-kind="${k}"><b>${esc(x.name)}</b><small>${esc(x.hint)}</small></button>`).join('')}</div>`);
}

function ventureSheet(v) {
  const isBiz = v.kind === 'business' || v.kind === 'expand';
  const fx = CURRENCIES[st.currency].usdFx;
  const sel = (name, opts, val, id = name) => `<select name="${name}" id="v-${id}">${opts.map(([k, n]) => `<option value="${k}" ${String(k) === String(val) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
  const common = `
    <label class="field"><span>Name</span><input name="name" id="v-name" value="${esc(v.name)}" placeholder="e.g. Bakery in Yaba, 4 flats in Lugbe"></label>
    ${numIn('startMonth', v.startMonth, 'Starts in how many months?', '', 'min="0" max="120"')}
    ${numIn('years', v.years, 'Judge it over how many years?', '', 'min="1" max="25"')}`;
  let body = '';
  if (isBiz) {
    body = `
      <label class="field"><span>Line of business</span>${sel('sector', Object.entries(V.SECTORS).map(([k, x]) => [k, x.name]), v.sector)}<small>Sets how often such businesses close and how uncertain sales are.</small></label>
      <h3 class="group-t">Money to start</h3>
      ${moneyIn('capex', v.capex, 'Set-up cost (equipment, shop fit-out, vehicles, licences)')}
      ${moneyIn('workingCapital', v.workingCapital, 'Working capital (first stock, a few months of running costs)')}
      ${moneyIn('maxTopUp', v.maxTopUp, 'Extra you could add if it struggles', 'Beyond this, the business closes. Leave empty to allow half the set-up money.')}
      ${moneyIn('loan', v.loan, 'Of the set-up money, how much is borrowed?')}
      ${v.loan ? `${pctIn('loanRate', v.loanRate, 'Loan interest a year')}${numIn('loanMonths', v.loanMonths, 'Loan length in months')}` : ''}
      <h3 class="group-t">Sales and costs</h3>
      ${moneyIn('revenue', v.revenue, 'Sales a month once it is running well')}
      ${numIn('rampMonths', v.rampMonths, 'Months to reach that level')}
      ${pctIn('varCost', v.varCost, 'Cost of what you sell, as a share of sales', 'Ingredients, stock, materials, commissions.')}
      ${moneyIn('fixedCost', v.fixedCost, 'Fixed costs a month (rent, staff, power, fuel)')}
      ${fx ? pctIn('imported', v.imported, 'Share of costs that follow the dollar', 'Imported stock, machines, parts.') : ''}
      <h3 class="group-t">The person running it</h3>
      ${Object.entries(V.HUMAN).map(([k, q]) => `<label class="field"><span>${esc(q.label)}</span>${sel(`h_${k}`, q.options.map((o) => [o[0], o[1]]), (v.human || {})[k], `h-${k}`)}</label>`).join('')}
      <details><summary>Advanced</summary>
        ${pctIn('reality', v.reality, 'Reality check: how much to trim your sales estimate', 'Plans run optimistic; 15% is a typical correction.')}
        ${pctIn('overrun', v.overrun, 'Typical set-up cost overrun')}
        ${numIn('delay', v.delay, 'Possible delay to opening, in months')}
        ${pctIn('growth', v.growth, 'Sales growth a year after the first year (after inflation)')}
        ${pctIn('salvage', v.salvage, 'If it closes, what the equipment sells for (share of set-up cost)')}
        ${numIn('exitMultiple', v.exitMultiple, 'If it is running at the end, it is worth this many years of profit')}
        ${pctIn('s5', v.s5 ?? (V.SECTORS[v.sector] || V.SECTORS.other).s5, 'Five-year survival for this line of business, before your own factors')}
        ${pctIn('countryRisk', (v.countryRisk ?? 1) - 1, 'Extra closure risk for doing business here', 'Raises the chance of closing; 30% is the default for Nigeria.')}
      </details>`;
  } else if (v.kind === 'rental') {
    body = `
      ${moneyIn('price', v.price, 'Price of the property or the build')}
      ${pctIn('buyCosts', v.buyCosts, 'Buying costs (legal, agency, survey, approvals)')}
      ${moneyIn('renovation', v.renovation, 'Renovation or finishing cost')}
      ${moneyIn('rent', v.rent, 'Total rent a month when let')}
      ${pctIn('occupancy', v.occupancy, 'Share of the time it is let and paid')}
      ${pctIn('upkeep', v.upkeep, 'Upkeep, agency and service costs, as a share of rent')}
      ${numIn('delay', v.delay, 'Months before the first tenant moves in')}
      ${moneyIn('loan', v.loan, 'Borrowed (mortgage or loan)')}
      ${v.loan ? `${pctIn('loanRate', v.loanRate, 'Loan interest a year')}${numIn('loanMonths', v.loanMonths, 'Loan length in months')}` : ''}`;
  } else if (v.kind === 'land') {
    body = `
      ${moneyIn('price', v.price, 'Price of the land')}
      ${pctIn('buyCosts', v.buyCosts, 'Buying costs (survey, documents, agency, omonile/community fees)')}
      ${moneyIn('holdCost', v.holdCost, 'Holding costs a year (fencing, security, ground rent)')}
      ${pctIn('titleRisk', v.titleRisk, 'Chance of a title or ownership dispute', 'Lower it only if the title is verified (C of O, registered survey).')}`;
  } else if (v.kind === 'shares') {
    body = `
      <label class="field"><span>Into what</span>${sel('cls', [['localEq', 'Local shares or fund'], ['globalEq', 'US or global shares or fund'], ['reit', 'Real estate fund (REIT)'], ['usdBonds', 'Eurobonds'], ['gold', 'Gold'], ['crypto', 'Crypto']], v.cls)}</label>
      <label class="field"><span>A particular share? (optional)</span><input id="stock-q" placeholder="e.g. MTNN, ZENITHBANK, AAPL" value="${esc(v.key ? v.key.split(':')[1] : '')}" autocomplete="off"><small>Its own price swings over two years are used.</small></label>
      <div id="stock-res" class="results"></div><input type="hidden" name="key" value="${esc(v.key || '')}"><p class="muted" id="stock-px"></p>
      ${moneyIn('amount', v.amount, 'Amount to invest')}`;
  } else {
    body = `
      ${moneyIn('amount', v.amount, 'Amount')}
      ${pctIn('rate', v.rate, 'Interest or return promised a year')}
      ${numIn('months', v.months, 'Repaid over how many months')}
      ${pctIn('defaultRisk', v.defaultRisk, 'Chance they do not pay it all back', 'Be honest: family loans and private investments often go unpaid.')}
      ${pctIn('recovery', v.recovery, 'If they stop paying, share of the rest you recover')}`;
  }
  sheet(`${sheetHead(v.id && st.ventures.some((x) => x.id === v.id) ? 'Edit plan' : V.KINDS[v.kind].name, 'Answer what you can; the rest has sensible defaults. Amounts in today\'s money.')}
    <form id="venture" data-id="${v.id}" data-kind="${v.kind}">
      ${common}${body}
      <label class="field"><span>Call it a success if it…</span>${sel('successTest', [['beat', 'Beats keeping the money in safe savings'], ['payback', 'Pays back everything put in'], ['survive', 'Is still running or held at the end']], v.successTest)}</label>
      <div class="seg-row"><span>Include in your life plan</span><div class="seg"><label><input type="radio" name="include" value="yes" ${v.include !== false ? 'checked' : ''}> Yes</label><label><input type="radio" name="include" value="no" ${v.include === false ? 'checked' : ''}> No, just test it</label></div></div>
      <div class="btn-row"><button class="btn primary" data-act="save-venture">Run 2,000 scenarios</button>${st.ventures.some((x) => x.id === v.id) ? '<button class="btn danger" data-act="del-venture">Delete</button>' : ''}</div>
    </form>`);
  const q = document.getElementById('stock-q');
  if (q) q.addEventListener('input', () => {
    const res = searchStocks(market, q.value);
    document.getElementById('stock-res').innerHTML = res.map((r) => `<button type="button" class="res" data-act="pick-vstock" data-key="${r.key}"><b>${esc(r.sym)}</b> <small>${esc(r.name || '')} · ${r.ex} · ${fmt(r.price, r.cur)}</small></button>`).join('');
  });
}

function ventureResultSheet(id) {
  const v = st.ventures.find((x) => x.id === id);
  const r = A && A.ventures && A.ventures.find((x) => x.id === id);
  if (!v) return;
  if (!r) { sheet(`${sheetHead(v.name || V.KINDS[v.kind].name)}<p>Running 2,000 scenarios…</p>`); pendingVenture = id; return; }
  const cls = r.success >= 0.65 ? 'good' : r.success >= 0.45 ? 'warn' : 'bad';
  const word = r.success >= 0.65 ? 'Good odds' : r.success >= 0.45 ? 'A coin toss' : 'Long odds';
  const isBiz = v.kind === 'business' || v.kind === 'expand';
  const yrs = (m) => (m == null || !Number.isFinite(m) ? `not within ${v.years} years` : m < 24 ? `${Math.round(m)} months` : `${(m / 12).toFixed(1)} years`);
  const cum = (r.cum || []).filter((x, i) => i % 12 === 0).map((b, y) => ({ age: y, ...b, p25: b.p10 + (b.p50 - b.p10) / 2, p75: b.p50 + (b.p90 - b.p50) / 2 }));
  const SE = V.SECTORS[v.sector] || V.SECTORS.other;
  sheet(`${sheetHead(v.name || V.KINDS[v.kind].name, `${esc(V.KINDS[v.kind].name)} · judged over ${v.years} years · 2,000 scenarios`)}
    <section class="card verdict ${cls}"><span class="status ${cls}">${icon(cls === 'good' ? 'ok' : cls === 'warn' ? 'warn' : 'stop')} ${word}</span><b class="pc">${pct(r.success)}</b><span>chance it ${esc(successWord(v))}.</span></section>
    <div class="stat-row">
      ${stat('Makes more than it costs', pct(r.profitable), '')}
      ${stat(isBiz ? `Still open after ${v.years} years` : v.kind === 'land' ? 'No title dispute' : v.kind === 'lend' ? 'Paid back in full' : 'Still held', pct(r.survive), '')}
      ${stat('Loses half or more', pct(r.lostHalf), r.lostHalf > 0.25 ? 'bad' : '')}
      ${stat('Typical result', `${r.multiple.p50.toFixed(2)}× your money`, '')}
      ${stat('Range (8 in 10)', `${r.multiple.p10.toFixed(1)}× to ${r.multiple.p90.toFixed(1)}×`, '')}
      ${stat('Typical yearly return', r.irr == null ? '–' : pct(r.irr, 0), '')}
      ${stat('Money you may need in total', `${f(r.peak.p50)} (up to ${f(r.peak.p90)})`, '')}
      ${stat('Pays back in', yrs(r.payback), '')}
      ${isBiz ? stat('Break-even sales a month', f(r.breakEven), '') : ''}
      ${r.monthlyProfit != null && v.kind !== 'land' && v.kind !== 'shares' ? stat(isBiz ? 'Profit a month, if it lasts' : 'Cash a month', f(r.monthlyProfit), '') : ''}
    </div>
    <section class="card"><h3 class="sec">How the 2,000 scenarios end</h3><p class="muted">What comes back, as a multiple of the money put in. Below 1× is a loss.</p>${barRows(r.hist.map((h) => ({ label: h.label, v: h.share * 100 })), { format: (x) => `${Math.round(x)}%` })}</section>
    ${cum.length > 1 ? `<section class="card"><h3 class="sec">Your cash in and out over time</h3><p class="muted">Running total of money you put in (below zero) and take out, in today's money.</p>${fanChart(cum, { cur: st.currency, id: 'vfan', height: 260, tick: () => true, xName: 'Year' })}</section>` : ''}
    ${(() => { const T = M.totals(st, market); const have = T.quick + T.investable; return r.peak.p50 > have ? `<section class="card warn-edge"><span class="status bad">${icon('stop')} Funding gap</span><p>It typically needs <b>${f(r.peak.p50)}</b> in total (up to ${f(r.peak.p90)}), but your cash, savings and investments come to <b>${f(have)}</b>. The whole-plan figures below assume the shortfall comes out of your other money; plan a loan, a partner or a smaller start.</p></section>` : ''; })()}
    ${isBiz ? `<section class="card"><h3 class="sec">Why these odds</h3><p>Of new ${esc(SE.name.split(':')[0].toLowerCase())} businesses, about <b>${pct(v.s5 ?? SE.s5)}</b> are still open after five years. With the person running it and where it operates, the plan uses <b>${pct(r.s5)}</b>. Sales are drawn around your estimate trimmed by ${pct(v.reality, 0)}, with wide uncertainty; set-up costs can overrun and opening can slip.</p></section>` : ''}
    ${r.measured ? `<p class="muted">This share swung ${pct(r.measured, 0)} a year over the last two years of prices.</p>` : ''}
    ${r.levers && r.levers.length ? `<section class="card"><h3 class="sec">What would change the odds most</h3>${deltaBars(r.levers)}</section>` : ''}
    ${v.include !== false ? `<section class="card"><h3 class="sec">What it does to your whole plan</h3>
      <div class="stat-row">${stat('Plan works, with it', pct(r.planWith), '')}${stat('Without it', pct(r.planWithout), '')}${stat('Invested at retirement, with it', f(r.retireWith), '')}${stat('Without it', f(r.retireWithout), '')}</div></section>` : '<p class="muted">Not included in your life plan. Edit it to include it.</p>'}
    <div class="btn-row"><button class="btn" data-act="edit-venture" data-id="${v.id}">Change the numbers</button><button class="btn" data-act="close">Done</button></div>`, { wide: true });
}

// ------------------------------------------------------------------ actions

const byId = (list, id) => list.find((x) => x.id === id);
function upsert(list, id, obj) { if (id) Object.assign(byId(list, id), obj); else list.push({ id: M.uid(), ...obj }); }

const ACT = {
  close: closeSheet,
  clients: clientsSheet,
  'open-person': (d) => { if (d.id === st.id) { closeSheet(); return; } M.save(st); const s2 = M.load(d.id); if (!s2) return toast('That plan could not be opened.'); M.setActive(d.id); st = s2; A = null; tab = 'home'; closeSheet(); applyTheme(); if (!loadAnalysis()) rerun(0); render(); toast(`Opened ${st.name || 'plan'}.`); },
  'new-person': () => { M.save(st); st = null; A = null; ob = null; closeSheet(); render(); },
  'dup-person': () => { const name = `${st.name || 'Plan'} (copy)`; st = M.duplicate(st, name); A = null; closeSheet(); rerun(0); render(); toast(`Made a copy: ${name}.`); },
  'save-adviser': (d, el) => { const v = form(el.closest('form')); M.saveAdviser({ on: v.on === 'yes', name: v.name.trim(), firm: v.firm.trim(), contact: v.contact.trim() }); closeSheet(); render(); toast('Saved.'); },
  person: personSheet,
  'save-person': (d, el) => {
    const v = form(el.closest('form'));
    st.name = v.name.trim(); if (v.born) st.born = v.born;
    Object.assign(st.person, { employment: v.employment, occupation: v.occupation.trim(), marital: v.marital, dependants: Math.max(0, +v.dependants || 0), health: v.health, lifeCover: v.lifeCover, experience: v.experience, goals: v.goals.trim(), notes: v.notes.trim(), reviewDate: v.reviewDate });
    closeSheet(); commit();
  },
  'risk-quiz': riskSheet,
  'save-risk': (d, el) => {
    const v = form(el.closest('form'));
    const answers = M.RISK_QUIZ.map((x, i) => (v[`q${i}`] != null ? +v[`q${i}`] : null));
    const score = M.riskScore(answers);
    if (!score) return toast('Answer all five questions.');
    st.person.riskAnswers = answers; st.person.riskScore = score;
    closeSheet(); commit();
    toast(`Risk profile: ${M.RISK_LEVELS[score].name}. New savings follow it unless you set your own mix.`);
  },
  'add-venture': ventureKindSheet,
  'new-venture': (d) => ventureSheet(V.newVenture(d.kind, st.currency)),
  'edit-venture': (d) => ventureSheet(byId(st.ventures, d.id)),
  'venture-result': (d) => ventureResultSheet(d.id),
  'pick-vstock': (d) => { const q = market.prices[d.key]; const fm = document.getElementById('venture'); fm.querySelector('[name=key]').value = d.key; document.getElementById('stock-q').value = d.key.split(':')[1]; document.getElementById('stock-px').textContent = `Latest price ${fmt(q.p, q.c)}${q.n ? ` · ${q.n}` : ''}`; document.getElementById('stock-res').innerHTML = ''; if (!fm.querySelector('[name=name]').value) fm.querySelector('[name=name]').value = q.n || d.key.split(':')[1]; const c = fm.querySelector('[name=cls]'); if (c) c.value = d.key.startsWith('NGX') ? 'localEq' : 'globalEq'; },
  'save-venture': (d, el) => {
    const fm = el.closest('form'); const x = form(fm);
    const old = byId(st.ventures, fm.dataset.id);
    const v = old || V.newVenture(fm.dataset.kind, st.currency);
    if (!old) v.id = fm.dataset.id;
    const money = ['capex', 'workingCapital', 'maxTopUp', 'loan', 'revenue', 'fixedCost', 'price', 'renovation', 'rent', 'holdCost', 'amount'];
    const pcts = ['loanRate', 'varCost', 'imported', 'reality', 'overrun', 'growth', 'salvage', 's5', 'buyCosts', 'occupancy', 'upkeep', 'titleRisk', 'rate', 'defaultRisk', 'recovery'];
    const ints = ['startMonth', 'years', 'loanMonths', 'rampMonths', 'delay', 'months', 'exitMultiple'];
    v.name = (x.name || '').trim();
    for (const k of money) if (x[k] != null) v[k] = parseMoney(x[k]);
    if (x.maxTopUp != null && !String(x.maxTopUp).trim()) v.maxTopUp = null;
    for (const k of pcts) if (x[k] != null) v[k] = parsePct(x[k]);
    for (const k of ints) if (x[k] != null && x[k] !== '') v[k] = Math.max(0, +x[k]);
    if (x.countryRisk != null) v.countryRisk = 1 + parsePct(x.countryRisk);
    if (x.sector) { if (old && old.sector !== x.sector && x.s5 != null && Math.abs(parsePct(x.s5) - (V.SECTORS[old.sector] || V.SECTORS.other).s5) < 1e-9) v.s5 = null; v.sector = x.sector; }
    if (x.s5 != null && v.s5 != null && Math.abs(v.s5 - (V.SECTORS[v.sector] || V.SECTORS.other).s5) < 1e-9) v.s5 = null;
    if (x.cls) v.cls = x.cls;
    if (x.key != null) v.key = x.key;
    if (v.human) for (const k of Object.keys(V.HUMAN)) if (x[`h_${k}`] != null) { const o = V.HUMAN[k].options.find((q) => String(q[0]) === x[`h_${k}`]); if (o) v.human[k] = o[0]; }
    v.successTest = x.successTest || 'beat';
    v.include = x.include !== 'no';
    v.years = clamp(v.years || 5, 1, 25);
    const cost = (v.capex || 0) + (v.workingCapital || 0) + (v.price || 0) + (v.amount || 0);
    if (cost <= 0) return toast('Enter what it costs to start.');
    if (!old) st.ventures.push(v);
    pendingVenture = v.id; A = A ? { ...A, ventures: (A.ventures || []).filter((r) => r.id !== v.id) } : A;
    commit();
    ventureResultSheet(v.id);
  },
  'del-venture': (d, el) => { const id = el.closest('form').dataset.id; confirmSheet('Delete this plan?', 'Its scenarios and results will be removed.', 'del-venture-yes', 'Delete', { id }); },
  'del-venture-yes': (d) => { st.ventures = st.ventures.filter((x) => x.id !== d.id); closeSheet(); commit(); },
  tab: (d) => { tab = d.t; render(); window.scrollTo(0, 0); },
  go: (d) => { if (d.t === 'debts') { tab = 'money'; render(); document.getElementById('debts')?.scrollIntoView(); } else { tab = d.t; render(); window.scrollTo(0, 0); } },
  settings: settingsSheet,
  assumptions: assumptionsSheet,
  about: aboutSheet,
  'ob-next': () => { obRead(); if (ob.step === 1 && !(ob.age >= 16)) return toast('Enter your age.'); if (ob.step === 2 && !ob.income && !ob.spend) return toast('Enter what comes in and what you spend.'); if (ob.step === 4) return obFinish(); ob.step += 1; renderOnboarding(); },
  'ob-cancel': () => { ob = null; st = M.load(); if (st && !loadAnalysis()) rerun(0); render(); },
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
  'save-sp': (d, el) => { const fm = el.closest('form'); const v = form(fm); upsert(st.spending, fm.dataset.id, { cat: v.cat, name: v.name.trim() || SPEND_CATS[v.cat].name, amount: parseMoney(v.amount), freq: v.freq || 'month' }); closeSheet(); commit(); },
  'add-kid': () => kidSheet(),
  'edit-kid': (d) => kidSheet(byId(st.household.kids, d.id)),
  'save-kid': (d, el) => { const fm = el.closest('form'); const v = form(fm); upsert(st.household.kids, fm.dataset.id, { name: v.name.trim() || 'Child', born: +v.born || new Date().getFullYear() }); closeSheet(); commit(); },
  'del-kid': (d, el) => { const id = el.closest('form').dataset.id; st.household.kids = st.household.kids.filter((x) => x.id !== id); closeSheet(); commit(); },
  household: householdSheet,
  'save-hh': (d, el) => {
    const v = form(el.closest('form')); const H = st.household;
    for (const [id] of SCHOOL.stages) H.fees[id] = parseMoney(v[`fee_${id}`]);
    H.eduPrem = parsePct(v.eduPrem); H.givingPct = parsePct(v.givingPct);
    H.car = { every: Math.max(0, Math.round(+v.carEvery || 0)), cost: parseMoney(v.carCost) };
    closeSheet(); commit();
  },
  nominal: (d) => { nominal = d.v === '1'; render(); },
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
  pdf: () => { if (!A) return toast('The plan is still being worked out.'); download(new Blob([planPdf(st, market, A, { adviser: M.adviser() })], { type: 'application/pdf' }), `${(st.name || 'my').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-financial-plan.pdf`); },
  export: () => download(new Blob([JSON.stringify(st, null, 2)], { type: 'application/json' }), `${(st.name || 'plan').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-backup-${new Date().toISOString().slice(0, 10)}.json`),
  wipe: () => confirmSheet(`Delete ${st.name ? `${esc(st.name)}'s` : 'this'} plan?`, 'All of this person\'s numbers will be removed from this phone. This cannot be undone. Back it up first if you want to keep it.', 'wipe-yes'),
  'wipe-yes': () => { M.remove(st.id); st = M.load(); A = null; ob = null; closeSheet(); if (st && !loadAnalysis()) rerun(0); render(); },
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
    const s2 = M.upgrade(data);
    if (M.profiles().list.some((p) => p.id === s2.id)) s2.id = M.uid();
    st = s2; A = null; closeSheet(); commit(); toast(`Restored ${st.name || 'the plan'} as a person on this phone.`);
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
      whatIfOut = await compute('whatif', { spendCut: whatIfExtra * 12 });
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
