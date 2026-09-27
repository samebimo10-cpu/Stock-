// Tycoon Rush screens. Plain DOM: each screen renders into #app, and sheets and
// modals render into #layer. All game rules live in engine.js.

import * as E from './engine.js';
import {
  CURRENCIES, LIFESTYLES, CHARACTERS, ASSETS, COMPANIES, STATE_INFO, SWANS, CARDS,
  ERAS, CHALLENGES, ASCENSION, GLOSSARY, SCAM_TIPS, LESSONS, TIPS,
} from './content.js';

const app = document.getElementById('app');
const layer = document.getElementById('layer');
const fxCanvas = document.getElementById('fx');

// ------------------------------------------------------------------ profile

const KEY = 'tycoonrush.v1';
const DEFAULTS = {
  wisdom: 0, runs: 0, best: 0, freedoms: 0, bestAge: null, maxAsc: 0,
  glossary: [], scamLesson: false, daily: {}, weekly: {}, duels: {}, eras: {},
  settings: { sound: true, timer: false, currency: 'NGN', calm: false },
  setup: { char: 'graduate', asc: 0 },
  run: null,
};
let P = loadProfile();
let run = P.run;

function loadProfile() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { saved = null; }
  const p = { ...DEFAULTS, ...(saved || {}) };
  p.settings = { ...DEFAULTS.settings, ...(p.settings || {}) };
  p.setup = { ...DEFAULTS.setup, ...(p.setup || {}) };
  return p;
}
function saveProfile() {
  try { localStorage.setItem(KEY, JSON.stringify(P)); } catch { /* private window: play on without saving */ }
}
function persist() {
  P.run = run && run.phase !== 'done' ? run : null;
  saveProfile();
}

// ------------------------------------------------------------------ small helpers

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const f = (n, signed) => E.fmt(n, run ? run.currency : P.settings.currency, signed);
const pctS = (x) => `${(x * 100).toFixed(1)}%`;
const cls = (x) => (x > 0.0005 ? 'up' : x < -0.0005 ? 'down' : 'muted');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const weekNo = () => Math.floor((Date.now() / 864e5 + 3) / 7);
const weeklyChallenge = () => CHALLENGES[weekNo() % CHALLENGES.length];
const calm = () => P.settings.calm || matchMedia('(prefers-reduced-motion: reduce)').matches;
const fairMode = (mode) => ['daily', 'duel'].includes(mode);
const unlockedIds = () => E.unlockedCards(run && fairMode(run.mode) ? 0 : P.wisdom);
const initials = (name) => name.replace('The ', '').slice(0, 2).toUpperCase();

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function applyCalm() { document.body.classList.toggle('calm', !!P.settings.calm); }

// ------------------------------------------------------------------ sound (synthesised, no files)

let ac = null;
function tone(freq, dur = 0.12, type = 'sine', vol = 0.06, when = 0) {
  if (!P.settings.sound) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = ac.currentTime + when;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  } catch { /* no audio available */ }
}
const SFX = {
  tap: () => tone(700, 0.04, 'square', 0.025),
  buy: () => { tone(880, 0.06, 'square', 0.035); tone(1320, 0.1, 'square', 0.03, 0.05); },
  sell: () => { tone(660, 0.06, 'triangle', 0.05); tone(440, 0.1, 'triangle', 0.04, 0.05); },
  gain: () => [523, 659, 784, 1047].forEach((fq, i) => tone(fq, 0.14, 'triangle', 0.06, i * 0.07)),
  loss: () => [392, 330, 262].forEach((fq, i) => tone(fq, 0.18, 'sawtooth', 0.035, i * 0.09)),
  crash: () => { tone(110, 0.6, 'sawtooth', 0.09); tone(70, 0.7, 'square', 0.05, 0.05); },
  card: () => { tone(1047, 0.08, 'square', 0.03); tone(1568, 0.14, 'square', 0.03, 0.06); },
  win: () => [523, 659, 784, 1047, 1319, 1568].forEach((fq, i) => tone(fq, 0.22, 'triangle', 0.06, i * 0.09)),
  swan: () => { tone(55, 1.4, 'sine', 0.12); tone(58, 1.4, 'sine', 0.08); },
};
const buzz = (ms) => { try { if (!calm() && navigator.vibrate) navigator.vibrate(ms); } catch { /* ignore */ } };

// ------------------------------------------------------------------ juice

function shake() {
  if (calm()) return;
  document.body.classList.remove('shake');
  void document.body.offsetWidth;
  document.body.classList.add('shake');
  setTimeout(() => document.body.classList.remove('shake'), 450);
}

let parts = [];
let fxRaf = 0;
function coinBurst(n = 60, x = innerWidth / 2, y = innerHeight / 2) {
  if (calm()) return;
  const dpr = devicePixelRatio || 1;
  fxCanvas.width = innerWidth * dpr; fxCanvas.height = innerHeight * dpr;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 4 + Math.random() * 9;
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 6, r: 5 + Math.random() * 6, life: 70 + Math.random() * 40, spin: Math.random() * 6 });
  }
  if (!fxRaf) fxRaf = requestAnimationFrame(stepFx);
}
function stepFx() {
  const ctx = fxCanvas.getContext('2d');
  const dpr = devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter((p) => p.life > 0);
  for (const p of parts) {
    p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.life -= 1; p.spin += 0.2;
    const w = Math.abs(Math.cos(p.spin)) * p.r;
    ctx.globalAlpha = Math.min(1, p.life / 30);
    ctx.fillStyle = '#ffc53d';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, w + 0.5, p.r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e0a100';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, Math.max(0.5, w * 0.55), p.r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  fxRaf = parts.length ? requestAnimationFrame(stepFx) : 0;
  if (!parts.length) ctx.clearRect(0, 0, innerWidth, innerHeight);
}

function rollNumber(el, from, to, ms = 900) {
  if (!el) return;
  if (calm()) { el.textContent = f(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = f(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ------------------------------------------------------------------ canvases

function sizeCanvas(c) {
  const dpr = devicePixelRatio || 1;
  const w = c.clientWidth || 64;
  const h = c.clientHeight || 24;
  c.width = w * dpr; c.height = h * dpr;
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function drawSparks() {
  document.querySelectorAll('canvas.spark').forEach((c) => {
    const s = run.px[c.dataset.id];
    if (!s || s.length < 2) return;
    const { ctx, w, h } = sizeCanvas(c);
    const lo = Math.min(...s);
    const hi = Math.max(...s);
    const span = hi - lo || 1;
    const X = (i) => 2 + (i / (s.length - 1)) * (w - 6);
    const Y = (v) => h - 3 - ((v - lo) / span) * (h - 6);
    const up = s[s.length - 1] >= s[s.length - 2];
    const col = up ? '#3ddc97' : '#ff5d73';
    ctx.beginPath();
    s.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
    ctx.lineTo(X(s.length - 1), h); ctx.lineTo(X(0), h); ctx.closePath();
    ctx.fillStyle = up ? 'rgba(61,220,151,.16)' : 'rgba(255,93,115,.16)';
    ctx.fill();
    ctx.beginPath();
    s.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
    ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(X(s.length - 1), Y(s[s.length - 1]), 2.4, 0, Math.PI * 2); ctx.fill();
  });
}

// Net worth against the Freedom Number, on a log scale so inflation-era
// numbers stay readable.
function drawChart(c, hist, currency) {
  const { ctx, w, h } = sizeCanvas(c);
  const padL = 46; const padB = 20; const padT = 8; const padR = 8;
  const vals = hist.flatMap((p) => [Math.max(1, p.nw), p.fn]).filter((v) => v > 0);
  const lo = Math.floor(Math.log10(Math.max(1, Math.min(...vals))));
  const hi = Math.ceil(Math.log10(Math.max(...vals)));
  const span = Math.max(1, hi - lo);
  const X = (i) => padL + (i / Math.max(1, hist.length - 1)) * (w - padL - padR);
  const Y = (v) => padT + (1 - (Math.log10(Math.max(1, v)) - lo) / span) * (h - padT - padB);
  ctx.font = '600 10px Figtree, system-ui, sans-serif';
  ctx.fillStyle = '#a99fd2'; ctx.strokeStyle = 'rgba(169,159,210,.15)'; ctx.lineWidth = 1;
  const stepE = span > 4 ? 2 : 1;
  for (let e = lo; e <= hi; e += stepE) {
    const y = Y(Math.pow(10, e));
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(E.fmt(Math.pow(10, e), currency), padL - 6, y);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const every = Math.ceil(hist.length / 6);
  hist.forEach((p, i) => { if (i % every === 0 || i === hist.length - 1) ctx.fillText(String(p.age), X(i), h - 5); });
  // Freedom Number, dashed.
  ctx.setLineDash([5, 4]); ctx.strokeStyle = '#ffc53d'; ctx.lineWidth = 1.5;
  ctx.beginPath(); hist.forEach((p, i) => (i ? ctx.lineTo(X(i), Y(p.fn)) : ctx.moveTo(X(i), Y(p.fn)))); ctx.stroke();
  ctx.setLineDash([]);
  // Net worth, with a soft area.
  ctx.beginPath(); hist.forEach((p, i) => (i ? ctx.lineTo(X(i), Y(p.nw)) : ctx.moveTo(X(i), Y(p.nw))));
  ctx.lineTo(X(hist.length - 1), h - padB); ctx.lineTo(X(0), h - padB); ctx.closePath();
  ctx.fillStyle = 'rgba(61,220,151,.14)'; ctx.fill();
  ctx.beginPath(); hist.forEach((p, i) => (i ? ctx.lineTo(X(i), Y(p.nw)) : ctx.moveTo(X(i), Y(p.nw))));
  ctx.strokeStyle = '#3ddc97'; ctx.lineWidth = 2.2; ctx.stroke();
  const last = hist[hist.length - 1];
  ctx.fillStyle = '#3ddc97'; ctx.beginPath(); ctx.arc(X(hist.length - 1), Y(last.nw), 3.5, 0, Math.PI * 2); ctx.fill();
}

// ------------------------------------------------------------------ layer (sheets, modals)

function openSheet(html) {
  layer.innerHTML = `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
}
function openModal(html) {
  layer.innerHTML = `<div class="scrim full"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  layer.querySelector('.modal').scrollTop = 0;
}
function closeLayer() { layer.innerHTML = ''; sheetCtx = null; }
let sheetCtx = null;

// ------------------------------------------------------------------ home

function home() {
  stopTimer();
  closeLayer();
  run = P.run;
  const daily = P.daily[today()];
  const wk = weeklyChallenge();
  const wkDone = P.weekly[weekNo()];
  const resume = run && run.phase !== 'done'
    ? `<button class="continue" data-act="resume"><span><span class="kicker">Continue run</span><b>${esc(E.MODES[run.mode].name)} · Age ${run.age}</b><span class="muted">${esc(CHARACTERS[run.char].name)} · ${f(E.netWorth(run))}</span></span><span class="kicker">Play ▸</span></button>` : '';
  app.innerHTML = `
  <main class="home">
    <header class="brand">
      <div class="logo">TYCOON<span>RUSH</span></div>
      <p class="tag">Retire rich before 60, in ten minutes.</p>
    </header>
    <div class="ticker-strip" aria-hidden="true"><span>ZNK +2.1% · PLM −0.8% · BGP +0.4% · KUL +6.3% · NXO −3.2% · INDEX +1.2% · MOONCOIN −41% · T-BILL 13.5% · </span></div>
    ${resume}
    <section class="modes">
      <button class="mode hero" data-act="setup" data-mode="classic"><b>Classic Run</b><small>From 22 to financial freedom. About 10 minutes. Unlocks and Ascension live here.</small></button>
      <button class="mode" data-act="setup" data-mode="blitz"><b>Blitz</b><small>4 years a turn, 15 seconds to decide.</small></button>
      <button class="mode" data-act="daily"><b>Daily Market</b><small>Same market for everyone today. One try.</small>${daily ? `<span class="badge pill v-real">Done</span>` : ''}</button>
      <button class="mode" data-act="eras"><b>Eras</b><small>Survive famous booms and busts.</small></button>
      <button class="mode" data-act="duel"><b>Duel</b><small>Share a code, play the same market as friends.</small></button>
      <button class="mode" data-act="weekly" style="grid-column:1/-1"><b>Weekly: ${esc(wk.name)}</b><small>${esc(wk.text)}</small>${wkDone != null ? `<span class="badge pill v-real">Badge</span>` : ''}</button>
    </section>
    <div class="stats-row">
      <div class="stat"><b>${P.wisdom}</b><span>Wisdom</span></div>
      <div class="stat"><b>${P.best.toLocaleString()}</b><span>Best score</span></div>
      <div class="stat"><b>${P.bestAge ?? '–'}</b><span>Freest at</span></div>
      <div class="stat"><b>${P.runs}</b><span>Runs</span></div>
    </div>
    <nav class="homebar">
      <button class="btn small" data-act="collection">Collection</button>
      <button class="btn small" data-act="how">How to play</button>
      <button class="btn small" data-act="settings">Settings</button>
    </nav>
  </main>`;
}

// ------------------------------------------------------------------ setup

let setupMode = 'classic';
function setup(mode) {
  setupMode = mode || setupMode;
  const s = P.setup;
  const cur = P.settings.currency;
  const chars = Object.entries(CHARACTERS).map(([id, c]) => {
    const locked = c.unlock > P.wisdom;
    return `<button class="choice ${s.char === id ? 'on' : ''} ${locked ? 'locked' : ''}" data-act="pick-char" data-id="${id}" ${locked ? 'disabled' : ''}>
      <span class="av">${initials(c.name)}</span>
      <span><b>${esc(c.name)}</b><small>${locked ? `Unlocks at ${c.unlock} wisdom` : esc(c.blurb)}</small></span></button>`;
  }).join('');
  const asc = setupMode === 'classic' ? `
    <section class="field">
      <span class="lbl">Ascension</span>
      <div class="stepper">
        <button class="icon-btn" data-act="asc" data-d="-1" aria-label="Lower">−</button>
        <b>${s.asc}</b>
        <button class="icon-btn" data-act="asc" data-d="1" aria-label="Higher" ${s.asc >= P.maxAsc ? 'disabled' : ''}>+</button>
        <span class="note">${esc(ASCENSION[s.asc])}${P.maxAsc === 0 ? '. Reach freedom to unlock level 1.' : ''}</span>
      </div>
    </section>` : '';
  app.innerHTML = `
  <main class="page">
    <header class="page-h"><button class="icon-btn" data-act="home" aria-label="Back">‹</button><h1>${esc(E.MODES[setupMode].name)}</h1></header>
    <section class="field"><span class="lbl">Who are you?</span><div class="choice-list">${chars}</div></section>
    <section class="field">
      <span class="lbl">Currency</span>
      <div class="seg">${Object.entries(CURRENCIES).map(([id, c]) => `<button class="${cur === id ? 'on' : ''}" data-act="cur" data-id="${id}">${c.sym} ${c.name}</button>`).join('')}</div>
      <span class="note">${esc(CURRENCIES[cur].blurb)}</span>
    </section>
    ${asc}
    <div class="sticky-go"><button class="btn primary wide" data-act="start">Start at ${E.MODES[setupMode].startAge}</button></div>
  </main>`;
}

function startRun(opts) {
  run = E.newRun(opts);
  persist();
  closeLayer();
  renderGame();
  startTimer();
  coinBurst(20, innerWidth / 2, 120);
  SFX.card();
}

// ------------------------------------------------------------------ the main game screen

const ORDER = ['save', 'index', 'stocks', 'prop', 'crypto', 'biz', 'fx'];

function tileHTML(id) {
  const A = ASSETS[id];
  if (id === 'fx' && run.currency !== 'NGN') return '';
  const open = E.isOpen(run, id);
  const hv = E.holdings(run)[id];
  let change = run.last[id];
  if (id === 'stocks' && Array.isArray(change)) change = change.reduce((s, x) => s + x, 0) / change.length;
  let foot = change != null ? `<span class="${cls(change)}">${E.pct(change, 1)}</span>` : '<span class="muted">New</span>';
  if (id === 'biz' && run.h.biz.c > 0) foot = `<span class="up">${f(run.h.biz.profit)}/yr</span>`;
  if (id === 'prop' && run.h.prop.v > 0) foot = `<span class="up">${f(run.h.prop.v * E.rentYield(run))}/yr</span>`;
  if (id === 'save') foot = `<span class="${run.rate < run.infl ? 'down' : 'up'}">${pctS(run.rate)}/yr</span>`;
  return `<button class="tile ${open ? '' : 'closed'}" style="--c:${A.color}" data-act="asset" data-id="${id}" ${open ? '' : 'disabled'}>
    <span class="t-name">${esc(A.name)}</span>
    <span class="t-sub">${open ? esc(A.sub) : 'Closed this week'}</span>
    <b class="t-val ${hv > 0 ? '' : 'zero'}">${f(hv)}</b>
    <span class="t-foot">${foot}<canvas class="spark" data-id="${id}" width="64" height="24"></canvas></span>
  </button>`;
}

function renderGame() {
  if (!run) return home();
  const m = run.market[run.turn];
  const nw = E.netWorth(run);
  const p = E.passive(run);
  const C = E.costs(run);
  const prog = clamp(p.total / C, 0, 1);
  const sea = E.atSea(run);
  const locked = E.lifeLocked(run);
  const idle = run.flags.idle || 0;
  const tip = P.runs === 0 && run.turn < TIPS.length && !run.flags[`tip${run.turn}`]
    ? `<div class="tip"><span>${esc(TIPS[run.turn])}</span><button data-act="tip">Got it</button></div>` : '';
  const crystal = run.crystal[run.turn]
    ? `<div class="chip-line" style="border-color:${STATE_INFO[m.state].color};color:${STATE_INFO[m.state].color}">Crystal ball: the next ${run.ypt} years look like a ${STATE_INFO[m.state].name.toUpperCase()}.</div>` : '';
  const revealAll = E.newsRevealed(run, {});
  const headlines = m.news.map((n, i) => {
    const shown = E.newsRevealed(run, n);
    const src = n.tag === 'co' ? 'Markets' : n.tag === 'rate' ? 'Central bank' : n.tag === 'fx' ? 'Currency' : n.kind === 'trap' ? 'Sponsored' : 'Headline';
    const verdict = !shown ? '' : n.kind === 'trap' ? '<span class="pill verdict v-scam">Scam</span>'
      : n.kind === 'noise' ? '<span class="pill verdict v-noise">Noise</span>'
        : n.real ? '<span class="pill verdict v-real">Real</span>' : '<span class="pill verdict v-fake">Fake</span>';
    const getin = n.kind === 'trap' ? `<button class="getin" data-act="trap" data-i="${i}" ${n.taken ? 'disabled' : ''}>${n.taken ? 'You are in' : 'Get in early ▸'}</button>` : '';
    return `<article class="headline"><span class="src">${src}</span>${verdict}<p>${esc(n.text)}</p>${getin}</article>`;
  }).join('');
  const whisper = (run.charges.insider > 0 && !revealAll) ? `<button class="btn small" data-act="tool" data-tool="insider">Whisper (${run.charges.insider})</button>` : '';
  const ball = (run.charges.crystal > 0 && !run.crystal[run.turn]) ? `<button class="btn small" data-act="tool" data-tool="crystal">Crystal ball (${run.charges.crystal})</button>` : '';
  const ponzi = run.h.ponzi ? `<button class="tile special" data-act="ponzi"><span class="t-name">Golden Circle</span><span class="t-sub">"Guaranteed 30%"</span><b class="t-val">${f(run.h.ponzi.v)}</b><span class="t-foot"><span class="up">+30.0%</span></span></button>` : '';
  const heldCards = run.cards.map((id) => { const c = E.cardById(id); return `<span class="hc ${c.type === 'Tool' ? 'tool' : ''}">${esc(c.name)}${run.charges[id] ? ` ×${run.charges[id]}` : ''}</span>`; }).join('');
  const lev = run.lev > 0 ? `<span class="hc" style="border-color:var(--orange);color:var(--orange)">Leverage: ${run.lev} turn${run.lev > 1 ? 's' : ''}</span>` : '';
  const debtLine = run.cash < 0 ? `Debt at ${pctS(E.debtRate(run))} a year. Sell something to clear it.` : idle > 0 ? `Idle cash. Inflation takes ${pctS(run.infl)} a year.` : 'Cash earns nothing.';
  const saving = run.salary - C;

  app.innerHTML = `
  <div class="game">
    <header class="hud">
      <div class="hud-row">
        <button class="icon-btn" data-act="menu" aria-label="Menu">☰</button>
        <div class="age"><b>${run.age}</b><span>yrs · turn ${run.turn + 1}/${run.turns}</span></div>
        <div class="macro"><span>Inflation <b>${pctS(run.infl)}</b></span><span>Interest <b>${pctS(run.rate)}</b></span></div>
      </div>
      <div class="nw-row"><span class="lbl">Net worth</span><b class="nw ${nw < 0 ? 'down' : ''}" id="nw">${f(nw)}</b></div>
      <button class="freedom" data-act="passive" aria-label="Passive income breakdown">
        <div class="fbar"><i style="width:${(prog * 100).toFixed(1)}%"></i></div>
        <div class="fmeta"><span>Passive <b>${f(p.total)}</b>/yr</span><span><b>${Math.round(prog * 100)}%</b> free</span><span>Costs <b>${f(C)}</b>/yr</span></div>
      </button>
    </header>
    ${tip}${crystal}
    ${sea ? '<div class="sea-note"><b>At sea.</b> You can\'t trade or change your lifestyle this turn. Your money keeps working while you sail.</div>' : ''}
    ${E.era(run) ? `<div class="chip-line" style="border-color:var(--gold);color:var(--gold)">${esc(E.era(run).name)}: finish with ${E.era(run).target}× your yearly costs (${f(E.era(run).target * C)}), or reach freedom.</div>` : ''}
    <section class="sec">
      <div class="sec-h"><h2>Headlines</h2><div style="display:flex;gap:6px">${whisper}${ball}</div></div>
      <div class="news-strip">${headlines}</div>
    </section>
    <section class="sec">
      <div class="sec-h"><h2>Your money</h2><span class="note">Tap to buy or sell</span></div>
      <div class="grid">${ORDER.map(tileHTML).join('')}${ponzi}</div>
    </section>
    <section class="sec">
      <div class="wallet">
        <div class="cash-row"><span><span class="lbl">Cash</span><br><span class="cash-sub">${debtLine}</span></span><b class="${run.cash < 0 ? 'down' : ''}" style="filter:grayscale(${Math.min(1, idle * 0.25)});opacity:${1 - Math.min(0.45, idle * 0.12)}">${f(run.cash)}</b></div>
        <div class="flowline">Salary <b>${f(run.salary)}</b> − costs <b>${f(C)}</b> = <b class="${saving >= 0 ? 'up' : 'down'}">${f(saving, true)}</b> a year</div>
        <div class="field">
          <span class="lbl">Lifestyle${locked ? ' (locked)' : ''}</span>
          <div class="seg">${LIFESTYLES.map((l, i) => `<button class="${run.life === i ? 'on' : ''}" data-act="life" data-lv="${i}" ${sea || locked ? 'disabled' : ''} aria-label="${l.name}">${l.name}</button>`).join('')}</div>
          <span class="note">${esc(LIFESTYLES[run.life].blurb)} Joy ${LIFESTYLES[run.life].joy >= 0 ? '+' : ''}${LIFESTYLES[run.life].joy} a turn.</span>
        </div>
        <div class="joy"><span>Joy</span><div class="jbar"><i style="width:${run.joy}%;background:${run.joy < 25 ? 'var(--loss)' : 'var(--pink)'}"></i></div><b class="num">${Math.round(run.joy)}</b></div>
      </div>
    </section>
    ${heldCards || lev ? `<section class="sec"><div class="sec-h"><h2>Your cards</h2></div><div class="held">${lev}${heldCards}</div></section>` : ''}
    <footer class="actionbar"><button class="next" data-act="next"><span>Live ${run.ypt} years ▸</span><small>Age ${run.age} → ${run.age + run.ypt}</small><i class="timer"></i></button></footer>
  </div>`;
  requestAnimationFrame(drawSparks);
}

// ------------------------------------------------------------------ asset sheets

function sheetHead(id, title) {
  return `<header class="sh-h"><span class="dot" style="--c:${ASSETS[id] ? ASSETS[id].color : 'var(--gold)'}"></span><h2>${esc(title)}</h2><button class="icon-btn" data-act="close" aria-label="Close">✕</button></header>`;
}

function assetSheet(id) {
  if (id === 'stocks') return stocksSheet();
  if (id === 'prop') return propSheet();
  if (id === 'biz') return bizSheet();
  const A = ASSETS[id];
  const hold = run.h[id];
  const max = hold + Math.max(0, run.cash);
  const last = run.last[id];
  const can = E.canAct(run);
  sheetCtx = { id, hold, max };
  openSheet(`
    ${sheetHead(id, A.name)}
    <p class="muted">${esc(A.blurb)}</p>
    <dl class="stats">
      <div><dt>You hold</dt><dd>${f(hold)}</dd></div>
      <div><dt>${id === 'save' ? 'Interest' : 'Last turn'}</dt><dd class="${id === 'save' ? '' : cls(last || 0)}">${id === 'save' ? pctS(run.rate) + '/yr' : last != null ? E.pct(last, 1) : '–'}</dd></div>
      <div><dt>${id === 'fx' ? 'Spread' : 'Fee to sell'}</dt><dd>${pctS(A.fee * (run.asc >= 7 ? 2 : 1))}</dd></div>
    </dl>
    ${max <= 0 ? '<p class="note">No cash to invest. Sell something, or wait for your next pay.</p>' : `
    <label class="lbl" for="amt">Set how much you hold</label>
    <input type="range" id="amt" min="0" max="${max}" step="${max / 400}" value="${hold}" ${can ? '' : 'disabled'}>
    <div class="sl-read"><b id="amtv">${f(hold)}</b><span id="amtd" class="muted">No change</span></div>
    <div class="quick">${[0, 0.25, 0.5, 0.75, 1].map((q) => `<button class="btn small" data-act="q" data-q="${q}" ${can ? '' : 'disabled'}>${q === 0 ? 'None' : q === 1 ? 'All' : `${q * 100}%`}</button>`).join('')}</div>
    <button class="btn primary wide" data-act="commit" ${can ? '' : 'disabled'}>Confirm</button>`}
  `);
}

function updateSlider() {
  const el = document.getElementById('amt');
  if (!el || !sheetCtx) return;
  const v = Number(el.value);
  const d = v - sheetCtx.hold;
  document.getElementById('amtv').textContent = f(v);
  const fee = ASSETS[sheetCtx.id].fee * (run.asc >= 7 ? 2 : 1);
  document.getElementById('amtd').textContent = Math.abs(d) < sheetCtx.max * 0.002 ? 'No change'
    : d > 0 ? `Buy ${f(d)}` : `Sell ${f(-d)}${fee ? `, fee ${f(-d * fee)}` : ''}`;
  const dd = document.getElementById('amtd');
  dd.className = Math.abs(d) < sheetCtx.max * 0.002 ? 'muted' : d > 0 ? 'up' : 'down';
}

function stocksSheet() {
  const can = E.canAct(run);
  const rows = COMPANIES.map((c, i) => {
    const last = run.last.stocks ? run.last.stocks[i] : null;
    return `<li><div><b>${esc(c.name)}</b><small>${esc(c.sector)} · ${last != null ? `<span class="${cls(last)}">${E.pct(last, 0)}</span>` : 'new'}</small></div>
      <span class="v">${f(run.h.stocks[i])}</span>
      <div class="btns"><button data-act="co" data-i="${i}" data-d="-1" aria-label="Sell ${esc(c.name)}" ${can && run.h.stocks[i] > 0 ? '' : 'disabled'}>−</button><button data-act="co" data-i="${i}" data-d="1" aria-label="Buy ${esc(c.name)}" ${can && run.cash > 0 ? '' : 'disabled'}>+</button></div></li>`;
  }).join('');
  sheetCtx = { id: 'stocks' };
  openSheet(`
    ${sheetHead('stocks', 'Single stocks')}
    <p class="muted">${esc(ASSETS.stocks.blurb)} <b>+</b> buys with 20% of your cash, <b>−</b> sells half.</p>
    <div class="sl-read"><span class="lbl">Cash to spend</span><b>${f(Math.max(0, run.cash))}</b></div>
    <ul class="cos">${rows}</ul>
    <button class="btn wide" data-act="close">Done</button>`);
}

function propSheet() {
  const p = run.h.prop;
  const can = E.canAct(run) && E.isOpen(run, 'prop');
  const lockedSale = E.propLocked(run);
  const cash = Math.max(0, run.cash);
  sheetCtx = { id: 'prop' };
  openSheet(`
    ${sheetHead('prop', 'Property')}
    <p class="muted">${esc(ASSETS.prop.blurb)}</p>
    <dl class="stats">
      <div><dt>Value</dt><dd>${f(p.v)}</dd></div>
      <div><dt>Mortgage</dt><dd class="${p.debt > 0 ? 'down' : ''}">${f(p.debt)}</dd></div>
      <div><dt>Rent a year</dt><dd class="up">${f(p.v * E.rentYield(run))}</dd></div>
    </dl>
    ${cash > 0 ? `
    <label class="lbl" for="amt">Cash to put in</label>
    <input type="range" id="amt" min="0" max="${cash}" step="${cash / 400}" value="${cash / 2}" ${can ? '' : 'disabled'}>
    <label class="check"><input type="checkbox" id="mort" ${can ? '' : 'disabled'}> Borrow the other 70% (mortgage at ${pctS(E.mortRate(run))})</label>
    <div class="sl-read"><b id="amtv">${f(cash / 2)}</b><span id="amtd" class="muted"></span></div>
    <button class="btn primary wide" data-act="buyprop" ${can ? '' : 'disabled'}>Buy property</button>` : '<p class="note">No cash to buy with right now.</p>'}
    ${p.v > 0 ? `<div class="hr"></div>
    <span class="lbl">Sell (6% agent and legal fees)</span>
    ${lockedSale ? '<p class="note">You just got the keys. You can sell from next turn.</p>' : ''}
    <div class="quick" style="grid-template-columns:repeat(3,1fr)">${[0.25, 0.5, 1].map((q) => `<button class="btn small" data-act="sellprop" data-q="${q}" ${can && !lockedSale ? '' : 'disabled'}>${q === 1 ? 'Sell all' : `Sell ${q * 100}%`}</button>`).join('')}</div>
    ${p.debt > 0 ? `<button class="btn wide" data-act="repay" ${can && run.cash > 0 ? '' : 'disabled'}>Pay down mortgage (${f(Math.min(cash, p.debt))})</button>` : ''}` : ''}
  `);
  updatePropSlider();
}

function updatePropSlider() {
  const el = document.getElementById('amt');
  if (!el || !sheetCtx || sheetCtx.id !== 'prop') return;
  const v = Number(el.value);
  const mort = document.getElementById('mort').checked;
  const worth = (mort ? v / 0.3 : v) * 0.97;
  document.getElementById('amtv').textContent = f(v);
  document.getElementById('amtd').textContent = `Gets property worth ${f(worth)}${mort ? `, debt ${f(v / 0.3 - v)}` : ''}`;
}

function bizSheet() {
  const b = run.h.biz;
  const can = E.canAct(run) && E.isOpen(run, 'biz');
  const cash = Math.max(0, run.cash);
  const managed = E.bizManaged(run);
  sheetCtx = { id: 'biz' };
  openSheet(`
    ${sheetHead('biz', b.c > 0 ? 'Your business' : 'Start a business')}
    <p class="muted">${esc(ASSETS.biz.blurb)}</p>
    <dl class="stats">
      <div><dt>Capital</dt><dd>${f(b.c)}</dd></div>
      <div><dt>Profit a year</dt><dd class="up">${f(b.profit)}</dd></div>
      <div><dt>Status</dt><dd>${b.c <= 0 ? '–' : managed ? 'Passive' : 'You run it'}</dd></div>
    </dl>
    ${b.c > 0 && !managed ? `<p class="note">Running it yourself costs 3 joy a turn and its profit doesn't count as passive income.</p>` : ''}
    ${cash > 0 ? `
    <label class="lbl" for="amt">${b.c > 0 ? 'Inject cash' : 'Cash to start with'}</label>
    <input type="range" id="amt" min="0" max="${cash}" step="${cash / 400}" value="${cash / 3}" ${can ? '' : 'disabled'}>
    <div class="sl-read"><b id="amtv">${f(cash / 3)}</b><span class="muted">Profit rate falls as it gets big</span></div>
    <button class="btn primary wide" data-act="investbiz" ${can ? '' : 'disabled'}>${b.c > 0 ? 'Invest' : 'Open the business'}</button>` : ''}
    ${b.c > 0 && !managed ? `<button class="btn wide" data-act="manager" ${can && run.cash >= E.managerCost(run) ? '' : 'disabled'}>Hire a manager (${f(E.managerCost(run))}, takes 25% of profit)</button>` : ''}
    ${b.c > 0 ? `<button class="btn danger wide" data-act="sellbiz" ${can ? '' : 'disabled'}>Sell the business for ${f(b.c * 0.6)}</button>` : ''}
  `);
}

function passiveSheet() {
  const p = E.passive(run);
  const C = E.costs(run);
  const row = (label, v, neg) => (Math.abs(v) > 0 ? `<div><span>${label}</span><b class="${neg ? 'down' : 'up'}">${neg ? '−' : ''}${f(Math.abs(v))}</b></div>` : '');
  openSheet(`
    ${sheetHead('', 'Road to freedom')}
    <p>You are free when your <b>passive income</b> covers your <b>living costs</b>. Investments count at 4% a year, the rate they can pay you for life.</p>
    <div class="brk">
      ${row('4% of savings, index, stocks, dollars', p.invest)}
      ${row('Rent', p.rent)}
      ${row('Managed business profit', p.biz)}
      ${row('Mortgage interest', p.mort, true)}
      ${row('Debt interest', p.debt, true)}
      <div class="tot"><span>Passive income</span><b>${f(p.total)}/yr</b></div>
      <div><span>Living costs</span><b>${f(C)}/yr</b></div>
    </div>
    <p class="note">Your Freedom Number is 25 × your costs: <b>${f(E.freedomNumber(run))}</b> invested. Crypto pays no income, so it only counts once you sell it into something that does. Every lifestyle upgrade raises this number.</p>
    <button class="btn wide" data-act="close">Close</button>`);
}

function menuSheet() {
  openSheet(`
    ${sheetHead('', 'Paused')}
    <button class="btn primary wide" data-act="close">Resume</button>
    <button class="btn wide" data-act="glossary-sheet">Words you have learned</button>
    <button class="btn wide" data-act="home">Save and go home</button>
    <button class="btn danger wide" data-act="abandon">Abandon this run</button>`);
}

// ------------------------------------------------------------------ the turn sequence

function nextTurn() {
  if (!run || run.phase !== 'alloc') return;
  stopTimer();
  closeLayer();
  const res = E.live(run);
  persist();
  if (res.swan) {
    const s = SWANS.find((x) => x.id === res.swan);
    SFX.swan(); buzz([80, 60, 200]);
    openModal(`<div class="swan swan-in"><span class="kicker">Black swan</span><div class="mood">${esc(s.name)}</div><p class="outcome">${esc(s.text)}</p><button class="btn primary wide" data-act="playout">Brace yourself</button></div>`);
    pendingPlay = res;
    return;
  }
  playout(res);
}
let pendingPlay = null;

function playout(res) {
  const info = STATE_INFO[res.state];
  const rows = res.rows.map((r, i) => `<li style="animation-delay:${0.35 + i * 0.12}s"><span>${esc(ASSETS[r.id].name)}</span><span class="${cls(r.gain)}">${f(r.gain, true)}</span><span class="p ${cls(r.pct)}">${E.pct(r.pct, 1)}</span></li>`).join('');
  const flows = res.flows.map((x) => `<div><span>${esc(x.label)}</span><b class="${cls(x.v)}">${f(x.v, true)}</b></div>`).join('');
  const notes = res.notes.map((n) => `<p>${esc(n)}</p>`).join('');
  openModal(`
    <div class="play">
      <div class="years">Age ${res.age0} → ${res.age1}</div>
      <div class="mood" style="--mc:${info.color}">${info.name.toUpperCase()}</div>
      <p class="mood-line">${esc(info.line)}</p>
      ${rows ? `<ul class="rows">${rows}</ul>` : '<p class="note" style="text-align:center">You had nothing invested. The market moved without you.</p>'}
      <div class="flows">${flows}</div>
      ${notes ? `<div class="notes">${notes}</div>` : ''}
      <div class="big-nw"><span class="lbl">Net worth</span><b id="roll" class="${res.nw1 >= res.nw0 ? 'up' : 'down'}">${f(res.nw0)}</b></div>
      <button class="btn primary wide" data-act="to-event">Continue</button>
    </div>`);
  const delta = res.nw1 - res.nw0;
  setTimeout(() => rollNumber(document.getElementById('roll'), res.nw0, res.nw1, 1000), 350);
  if (res.state === 'crash') { SFX.crash(); shake(); buzz([60, 40, 120]); } else if (delta >= 0) { SFX.gain(); } else { SFX.loss(); }
  if (delta > Math.abs(res.nw0) * 0.25 && delta > 0) setTimeout(() => coinBurst(50, innerWidth / 2, innerHeight * 0.75), 900);
}

function showEvent() {
  const v = E.eventView(run);
  if (!v) return showCards();
  openModal(`
    <div class="ev-card">
      <span class="kicker">${esc(v.cat)} · Age ${run.age}</span>
      <h2>${esc(v.title)}</h2>
      <p>${esc(v.text)}</p>
    </div>
    <div class="choices">${v.choices.map((c, i) => `<button class="choice-btn" data-act="choose" data-i="${i}" ${c.ok ? '' : 'disabled'}><b>${esc(c.label)}</b><small>${c.ok ? esc(c.note) : 'Not enough cash'}</small></button>`).join('')}</div>`);
}

function showOutcome(text) {
  const nw = E.netWorth(run);
  openModal(`
    <div class="ev-card"><span class="kicker">What happened</span><p class="outcome">${esc(text || 'Done.')}</p><p class="muted">Net worth now ${f(nw)} · Joy ${Math.round(run.joy)}</p></div>
    <button class="btn primary wide" data-act="to-cards">Pick a card</button>`);
}

const TYPE_COLOR = { Skill: 'var(--gain)', Tool: 'var(--sky)', Gamble: 'var(--orange)', Offer: 'var(--pink)', Legendary: 'var(--gold)' };

function cardHTML(c, act, extra = '') {
  return `<button class="gcard ${c.legendary ? 'legend' : ''} ${extra}" style="--tc:${TYPE_COLOR[c.type]}" ${act ? `data-act="${act}" data-id="${c.id}"` : 'disabled'}>
    <span class="ty">${esc(c.type)}</span><b>${esc(c.name)}</b><p>${esc(c.text)}</p></button>`;
}

function showCards() {
  if (!run.offer) { E.makeOffer(run, unlockedIds()); persist(); }
  const cards = run.offer.map((id) => cardHTML(E.cardById(id), 'take')).join('');
  SFX.card();
  openModal(`
    <div class="pick-h"><span class="kicker">Age ${run.age}</span><h2>Pick a card</h2><p class="muted">Cards stack into combos. Choose carefully: not every offer is what it seems.</p></div>
    <div class="cards">${cards}</div>
    <button class="btn ghost wide" data-act="take" data-id="">Skip</button>`);
}

function takeCard(id) {
  const card = id ? E.cardById(id) : null;
  const res = E.pickCard(run, id || null);
  if (card && card.trap) toast(card.id === 'ponzi' ? 'You joined the club. Watch it closely.' : 'Starter kit bought. Your friends stop answering.');
  else if (card) toast(`${card.name} added`);
  persist();
  if (res) return endRun(res);
  closeLayer();
  renderGame();
  startTimer();
  const nwEl = document.getElementById('nw');
  if (nwEl) nwEl.animate?.([{ transform: 'scale(1.12)' }, { transform: 'none' }], { duration: 300 });
}

// ------------------------------------------------------------------ timer

let timerRaf = 0;
let timerEnd = 0;
function timerSeconds() {
  if (!run || run.phase !== 'alloc') return 0;
  if (E.MODES[run.mode].timer) return E.MODES[run.mode].timer;
  return P.settings.timer ? 20 : 0;
}
function startTimer() {
  stopTimer();
  const secs = timerSeconds();
  if (!secs) return;
  timerEnd = performance.now() + secs * 1000;
  const tick = (t) => {
    const bar = document.querySelector('.next .timer');
    const left = timerEnd - t;
    if (bar) bar.style.width = `${clamp(100 - (left / (secs * 1000)) * 100, 0, 100)}%`;
    if (left <= 0) {
      timerRaf = 0;
      if (run && run.phase === 'alloc') { toast('The market doesn\'t wait.'); nextTurn(); }
      return;
    }
    timerRaf = requestAnimationFrame(tick);
  };
  timerRaf = requestAnimationFrame(tick);
}
function stopTimer() { if (timerRaf) cancelAnimationFrame(timerRaf); timerRaf = 0; }

// ------------------------------------------------------------------ end of run

function endRun(res) {
  stopTimer();
  const before = P.wisdom;
  const newTerms = res.learned.filter((t) => !P.glossary.includes(t));
  P.glossary = [...P.glossary, ...newTerms];
  const gained = res.wisdom + newTerms.length * 2;
  P.wisdom += gained;
  P.runs += 1;
  P.best = Math.max(P.best, res.score);
  const won = res.reason === 'free' || res.reason === 'target';
  if (res.reason === 'free') {
    P.freedoms += 1;
    P.bestAge = P.bestAge == null ? res.age : Math.min(P.bestAge, res.age);
    if (run.mode === 'classic' && run.asc === P.maxAsc && P.maxAsc < ASCENSION.length - 1) { P.maxAsc += 1; res.ascUp = P.maxAsc; }
  }
  if (res.scammed) P.scamLesson = true;
  if (run.mode === 'daily') P.daily[run.seed.replace('daily-', '')] = { score: res.score, reason: res.reason, age: res.age, grid: E.emojiGrid(run) };
  if (run.mode === 'weekly' && res.reason !== 'quit') P.weekly[weekNo()] = Math.max(P.weekly[weekNo()] || 0, res.score);
  if (run.mode === 'era') { const prev = P.eras[run.eraId]; P.eras[run.eraId] = { score: Math.max(prev ? prev.score : 0, res.score), won: won || (prev && prev.won) }; }
  if (run.mode === 'duel') { const code = run.seed.replace('duel-', ''); const prev = P.duels[code]; if (!prev || res.score > prev.score) P.duels[code] = { score: res.score, reason: res.reason, age: res.age }; }
  res.gained = gained;
  res.newTerms = newTerms;
  res.unlocks = [
    ...CARDS.filter((c) => c.unlock > before && c.unlock <= P.wisdom).map((c) => `Card: ${c.name}`),
    ...Object.values(CHARACTERS).filter((c) => c.unlock > before && c.unlock <= P.wisdom).map((c) => c.name),
    ...ERAS.filter((e) => e.unlock > before && e.unlock <= P.wisdom).map((e) => `Era: ${e.name}`),
  ];
  if (res.ascUp) res.unlocks.push(`Ascension ${res.ascUp}`);
  const done = run;
  run = null;
  persist();
  if (won) {
    SFX.win(); buzz([40, 40, 40, 40, 200]);
    openModal(`<div class="swan swan-in"><span class="kicker">${res.reason === 'free' ? 'Financial freedom' : 'Era beaten'}</span><div class="mood" style="color:var(--gold)">${res.reason === 'free' ? `FREE AT ${res.age}` : 'YOU MADE IT'}</div><p class="outcome">${res.reason === 'free' ? 'Your money now pays for your life. Work is optional.' : 'You came through the storm with your target met.'}</p><button class="btn primary wide" data-act="results">See your results</button></div>`);
    coinBurst(90); setTimeout(() => coinBurst(70, innerWidth * 0.25, innerHeight * 0.4), 300); setTimeout(() => coinBurst(70, innerWidth * 0.75, innerHeight * 0.4), 600);
    lastDone = done;
    return;
  }
  if (res.reason === 'bankrupt') { SFX.crash(); shake(); } else SFX.loss();
  results(done);
}
let lastDone = null;

function resultTitle(r) {
  switch (r.reason) {
    case 'free': return ['win', `Free at ${r.age}`];
    case 'target': return ['win', 'Era beaten'];
    case 'missed': return ['lose', 'Target missed'];
    case 'bankrupt': return ['lose', `Bankrupt at ${r.age}`];
    case 'quit': return ['lose', 'Run abandoned'];
    default: return ['lose', `Still working at ${r.age}`];
  }
}

function shareText(done) {
  const r = done.result;
  const outcome = r.reason === 'free' ? `Free at ${r.age}` : r.reason === 'bankrupt' ? `Bankrupt at ${r.age}` : `Still working at ${r.age}`;
  if (done.mode === 'daily') return `Tycoon Rush Daily ${done.seed.replace('daily-', '')}\n${E.emojiGrid(done)}\n${outcome} · Score ${r.score.toLocaleString()}`;
  if (done.mode === 'duel') return `Tycoon Rush duel ${done.seed.replace('duel-', '')}: ${outcome}, score ${r.score.toLocaleString()}. Same market, can you beat me?\n${E.emojiGrid(done)}`;
  return `Tycoon Rush: ${outcome}, score ${r.score.toLocaleString()}.\n${E.emojiGrid(done)}`;
}

function results(done) {
  closeLayer();
  lastDone = done;
  const r = done.result;
  const cur = done.currency;
  const F = (n) => E.fmt(n, cur);
  const [tone_, title] = resultTitle(r);
  const insights = [];
  if (r.best) insights.push(['var(--gain)', 'Biggest win', r.best]);
  if (r.worst) insights.push(['var(--loss)', 'Worst mistake', r.worst.text]);
  insights.push(['var(--gold)', 'Lesson', LESSONS[r.lesson]]);
  if (r.earlier > 0) insights.push(['var(--sky)', 'Compound growth', `Starting just 4 years earlier would have grown your investments by about ${F(r.earlier)} more (${pctS(r.annual)} a year).`]);
  const share = ['daily', 'duel'].includes(done.mode) || r.reason === 'free';
  const text = shareText(done);
  app.innerHTML = `
  <main class="results">
    <span class="kicker">${esc(E.MODES[done.mode].name)} · ${esc(CHARACTERS[done.char].name)}${done.asc ? ` · Ascension ${done.asc}` : ''}</span>
    <h1 class="res-title ${tone_}">${esc(title)}</h1>
    <div class="score-box"><span class="lbl">Score</span><b>${r.score.toLocaleString()}</b></div>
    <div class="chart-wrap"><canvas class="chart" id="chart"></canvas>
      <div class="legend"><span><i style="background:#3ddc97"></i>Net worth</span><span><i style="background:#ffc53d"></i>Freedom Number (25× costs)</span></div></div>
    <dl class="res-stats">
      <div><dt>Net worth</dt><dd>${F(r.nw)}</dd></div>
      <div><dt>Passive income</dt><dd>${F(r.passive)}/yr</dd></div>
      <div><dt>Living costs</dt><dd>${F(r.costs)}/yr</dd></div>
      <div><dt>Joy</dt><dd>${Math.round(r.joy)}/100</dd></div>
    </dl>
    ${insights.map(([c, k, t]) => `<div class="insight" style="--ic:${c}"><span class="lbl">${k}</span><p>${esc(t)}</p></div>`).join('')}
    ${r.scammed ? `<div class="scam-card"><span class="kicker" style="color:var(--pink)">How to spot a scam</span><ol>${SCAM_TIPS.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div>` : ''}
    <div class="insight" style="--ic:var(--violet)"><span class="lbl">Wisdom earned</span><p><b>+${r.gained}</b>${r.newTerms.length ? ` · new words: ${r.newTerms.map((t) => esc(GLOSSARY[t][0])).join(', ')}` : ''}</p>
      ${r.unlocks.length ? `<div class="unlock-list">${r.unlocks.map((u) => `<span>${esc(u)}</span>`).join('')}</div>` : ''}</div>
    ${share ? `<div class="share"><span class="lbl">Share</span><pre id="share-text">${esc(text)}</pre>
      <div class="share-actions"><button class="btn small" data-act="copy">Copy</button><a class="btn small" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">WhatsApp</a></div></div>` : ''}
    <div class="share-actions">
      <button class="btn primary" data-act="again">Play again</button>
      <button class="btn" data-act="home">Home</button>
    </div>
  </main>`;
  window.scrollTo(0, 0);
  requestAnimationFrame(() => drawChart(document.getElementById('chart'), r.hist, cur));
}

// ------------------------------------------------------------------ other pages

function page(title, body, back = 'home') {
  stopTimer();
  closeLayer();
  app.innerHTML = `<main class="page"><header class="page-h"><button class="icon-btn" data-act="${back}" aria-label="Back">‹</button><h1>${esc(title)}</h1></header>${body}</main>`;
  window.scrollTo(0, 0);
}

function eras() {
  page('Eras', `
    <p class="muted">Replay famous crises with fictional names. Finish with your target multiple of yearly costs, or reach freedom first.</p>
    <div class="choice-list">${ERAS.map((e) => {
    const locked = e.unlock > P.wisdom;
    const best = P.eras[e.id];
    return `<button class="choice ${locked ? 'locked' : ''}" data-act="era" data-id="${e.id}" ${locked ? 'disabled' : ''}>
      <span class="av">${e.currency === 'NGN' ? '₦' : '$'}</span>
      <span><b>${esc(e.name)} <span class="muted" style="font-weight:500">· ${esc(e.years)}</span></b>
      <small>${locked ? `Unlocks at ${e.unlock} wisdom` : esc(e.blurb)}${best ? ` · Best ${best.score.toLocaleString()}${best.won ? ' ✓' : ''}` : ''}</small></span></button>`;
  }).join('')}</div>`);
}

function randomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return `${P.settings.currency === 'NGN' ? 'N' : 'D'}${s}`;
}

function duel(code) {
  const c = code || randomCode();
  const past = Object.entries(P.duels).slice(-5).reverse();
  page('Duel', `
    <p class="muted">Everyone who plays the same code gets the same market, events and cards. Send the code to friends and compare scores.</p>
    <section class="field"><label class="lbl" for="code">Duel code</label><input class="text-in" id="code" maxlength="6" value="${esc(c)}" autocomplete="off" spellcheck="false"></section>
    <div class="share-actions"><button class="btn" data-act="duel-new">New code</button><button class="btn" data-act="duel-copy">Copy code</button></div>
    <p class="note">Codes starting with N play in naira, D in dollars. Everyone plays The Graduate with the base cards.</p>
    ${past.length ? `<section class="field"><span class="lbl">Your duels</span><div class="gloss">${past.map(([k, v]) => `<div><b>${esc(k)}</b><p>Score ${v.score.toLocaleString()} · ${v.reason === 'free' ? `free at ${v.age}` : v.reason}</p></div>`).join('')}</div></section>` : ''}
    <div class="sticky-go"><button class="btn primary wide" data-act="duel-go">Play this code</button></div>`);
}

function collection(tab = 'cards') {
  const tabs = [['cards', 'Cards'], ['people', 'Characters'], ['words', 'Words'], ['ladder', 'Ascension']];
  let body = '';
  if (tab === 'cards') {
    body = `<p class="note">You have ${P.wisdom} wisdom. Cards unlock as it grows; legendary cards can appear in any run.</p><div class="mini-cards">${CARDS.map((c) => {
      if (c.unlock > P.wisdom) return `<div class="gcard locked" style="--tc:var(--faint)"><span class="ty">Locked</span><b>${esc(c.name)}</b><p>Unlocks at ${c.unlock} wisdom</p></div>`;
      if (c.trap && !P.scamLesson) return `<div class="gcard" style="--tc:var(--pink)"><span class="ty">Offer</span><b>${esc(c.name)}</b><p>Looks tempting. Try it and see.</p></div>`;
      return cardHTML(c, null).replace('<button', '<div').replace('</button>', '</div>').replace(' disabled', '');
    }).join('')}</div>`;
  } else if (tab === 'people') {
    body = `<div class="choice-list">${Object.values(CHARACTERS).map((c) => `<div class="choice ${c.unlock > P.wisdom ? 'locked' : ''}"><span class="av">${initials(c.name)}</span><span><b>${esc(c.name)}</b><small>${c.unlock > P.wisdom ? `Unlocks at ${c.unlock} wisdom` : esc(c.blurb)}</small></span></div>`).join('')}</div>`;
  } else if (tab === 'words') {
    const learned = Object.keys(GLOSSARY).filter((k) => P.glossary.includes(k));
    body = `<p class="note">${learned.length} of ${Object.keys(GLOSSARY).length} words learned. New ones unlock when they happen to you.</p>
      <div class="gloss">${learned.map((k) => `<div><b>${esc(GLOSSARY[k][0])}</b><p>${esc(GLOSSARY[k][1])}</p></div>`).join('') || '<div><p>Play a run to start learning.</p></div>'}</div>
      ${P.scamLesson ? `<div class="scam-card"><span class="kicker" style="color:var(--pink)">How to spot a scam</span><ol>${SCAM_TIPS.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div>` : ''}`;
  } else {
    body = `<p class="note">Reach freedom in a Classic run at your highest level to unlock the next one. Each level adds its rule to all the ones before it, and scores more.</p>
      <ol class="ladder">${ASCENSION.map((a, i) => `<li class="${i > P.maxAsc ? 'off' : ''}"><b>${i}</b><span>${esc(a)}</span></li>`).join('')}</ol>`;
  }
  page('Collection', `<div class="seg">${tabs.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="coll" data-tab="${k}">${l}</button>`).join('')}</div>${body}`);
}

function glossarySheet() {
  const learned = Object.keys(GLOSSARY).filter((k) => P.glossary.includes(k) || (run && run.learned.includes(k)));
  openSheet(`${sheetHead('', 'Words you have learned')}<div class="gloss">${learned.map((k) => `<div><b>${esc(GLOSSARY[k][0])}</b><p>${esc(GLOSSARY[k][1])}</p></div>`).join('')}</div><button class="btn wide" data-act="close">Close</button>`);
}

function how() {
  page('How to play', `
    <ol class="how">
      <li>Each turn is two years of your life. Your salary lands, your living costs go out, and whatever is left sits in cash.</li>
      <li>Read the three headlines. Most hint at what the next two years hold. Some are noise, and some are scams.</li>
      <li>Tap an asset to move cash into it or out of it. Each one behaves differently in booms and crashes.</li>
      <li>Press <b>Live 2 years</b>. Markets move, rent and profits arrive, and life throws you one event with a choice.</li>
      <li>Pick one of three cards. Skills, tools and gambles stack into combos.</li>
      <li>You win when passive income covers your living costs. You lose if you go broke two turns in a row, or reach 60 still working.</li>
      <li>Higher lifestyle means more joy but a bigger Freedom Number. Too little joy leads to burnout.</li>
      <li>Every run earns wisdom, which unlocks cards, characters and eras.</li>
    </ol>
    <p class="note">Everything is fictional, and it's a game, not financial advice. The lessons are real though.</p>`);
}

function settings(confirmReset = false) {
  const s = P.settings;
  const row = (key, title, sub) => `<button class="toggle-row" data-act="toggle" data-key="${key}" role="switch" aria-checked="${!!s[key]}"><span style="text-align:left"><b>${title}</b><small>${sub}</small></span><span class="switch ${s[key] ? 'on' : ''}"></span></button>`;
  page('Settings', `
    ${row('sound', 'Sound', 'Blips, coins and crash thuds.')}
    ${row('timer', 'The market doesn\'t wait', 'A 20-second clock on every Classic turn.')}
    ${row('calm', 'Reduce motion', 'No shaking, bursts or rolling numbers.')}
    <section class="field"><span class="lbl">Default currency</span><div class="seg">${Object.entries(CURRENCIES).map(([id, c]) => `<button class="${s.currency === id ? 'on' : ''}" data-act="set-cur" data-id="${id}">${c.sym} ${c.name}</button>`).join('')}</div></section>
    <div class="hr"></div>
    ${confirmReset ? `<p>This erases your wisdom, unlocks, records and any saved run.</p><div class="share-actions"><button class="btn danger" data-act="reset-yes">Erase everything</button><button class="btn" data-act="settings">Keep my progress</button></div>`
    : '<button class="btn danger wide" data-act="reset">Reset progress</button>'}
    <p class="note">Progress is saved on this device only. The game works offline once it has loaded.</p>`);
}

function dailyScreen() {
  const key = today();
  const rec = P.daily[key];
  if (!rec) {
    return startRun({ mode: 'daily', char: 'graduate', currency: 'NGN', seed: `daily-${key}` });
  }
  const text = `Tycoon Rush Daily ${key}\n${rec.grid}\n${rec.reason === 'free' ? `Free at ${rec.age}` : rec.reason === 'bankrupt' ? `Bankrupt at ${rec.age}` : `Still working at ${rec.age}`} · Score ${rec.score.toLocaleString()}`;
  page('Daily Market', `
    <p class="muted">You have played today's market. A new one opens at midnight.</p>
    <div class="score-box"><span class="lbl">Today's score</span><b>${rec.score.toLocaleString()}</b></div>
    <div class="share"><span class="lbl">Share</span><pre id="share-text">${esc(text)}</pre>
      <div class="share-actions"><button class="btn small" data-act="copy">Copy</button><a class="btn small" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">WhatsApp</a></div></div>`);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); } catch {
    const pre = document.getElementById('share-text');
    if (pre) { const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
    toast('Selected. Copy it from here.');
  }
}

// ------------------------------------------------------------------ actions

const ACT = {
  home: () => { persist(); home(); },
  resume: () => resume(),
  setup: (d) => setup(d.mode),
  'pick-char': (d) => { P.setup.char = d.id; saveProfile(); setup(); },
  cur: (d) => { P.settings.currency = d.id; saveProfile(); setup(); },
  asc: (d) => { P.setup.asc = clamp(P.setup.asc + Number(d.d), 0, P.maxAsc); saveProfile(); setup(); },
  start: () => startRun({ mode: setupMode, char: P.setup.char, currency: P.settings.currency, asc: setupMode === 'classic' ? Math.min(P.setup.asc, P.maxAsc) : 0 }),
  daily: () => dailyScreen(),
  weekly: () => startRun({ mode: 'weekly', char: 'graduate', currency: P.settings.currency, challengeId: weeklyChallenge().id, seed: `week-${weekNo()}` }),
  eras: () => eras(),
  era: (d) => startRun({ mode: 'era', char: 'graduate', eraId: d.id }),
  duel: () => duel(),
  'duel-new': () => duel(randomCode()),
  'duel-copy': () => { const v = document.getElementById('code').value.trim().toUpperCase(); copyText(`Play my Tycoon Rush duel: code ${v}`); },
  'duel-go': () => {
    const v = (document.getElementById('code').value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (v.length < 3) { toast('Enter a code of at least 3 letters.'); return; }
    startRun({ mode: 'duel', char: 'graduate', currency: v[0] === 'D' ? 'USD' : 'NGN', seed: `duel-${v}` });
  },
  collection: () => collection(),
  coll: (d) => collection(d.tab),
  how: () => how(),
  settings: () => settings(),
  toggle: (d) => { P.settings[d.key] = !P.settings[d.key]; saveProfile(); applyCalm(); settings(); },
  'set-cur': (d) => { P.settings.currency = d.id; saveProfile(); settings(); },
  reset: () => settings(true),
  'reset-yes': () => { const keep = P.settings; P = { ...structuredClone(DEFAULTS), settings: keep }; run = null; saveProfile(); toast('Progress erased'); home(); },

  menu: () => menuSheet(),
  close: () => closeLayer(),
  scrim: (d, el, e) => { if (e.target === el) closeLayer(); },
  abandon: () => {
    openSheet(`${sheetHead('', 'Abandon this run?')}<p>You will get a small amount of wisdom for the words you learned, and no score.</p><button class="btn danger wide" data-act="abandon-yes">Abandon</button><button class="btn wide" data-act="close">Keep playing</button>`);
  },
  'abandon-yes': () => { const res = E.abandon(run); closeLayer(); endRun(res); },
  'glossary-sheet': () => glossarySheet(),
  tip: () => { run.flags[`tip${run.turn}`] = true; persist(); renderGame(); },
  passive: () => passiveSheet(),
  asset: (d) => { SFX.tap(); assetSheet(d.id); },
  q: (d) => { const el = document.getElementById('amt'); if (!el) return; el.value = String(Number(el.max) * Number(d.q)); updateSlider(); },
  commit: () => {
    const el = document.getElementById('amt');
    const moved = E.setHolding(run, sheetCtx.id, Number(el.value));
    if (moved > 0) SFX.buy(); else if (moved < 0) SFX.sell();
    closeLayer(); persist(); renderGame();
  },
  co: (d) => {
    const i = Number(d.i);
    const cur = run.h.stocks[i];
    if (Number(d.d) > 0) {
      const cash = Math.max(0, run.cash);
      const amt = cash < E.netWorth(run) * 0.03 ? cash : cash * 0.2;
      if (E.setHolding(run, 'stocks', cur + amt, i) > 0) SFX.buy();
    } else {
      const target = cur < E.netWorth(run) * 0.01 ? 0 : cur / 2;
      if (E.setHolding(run, 'stocks', target, i) < 0) SFX.sell();
    }
    persist(); renderGame(); stocksSheet();
  },
  buyprop: () => {
    const v = Number(document.getElementById('amt').value);
    if (E.buyProperty(run, v, document.getElementById('mort').checked)) { SFX.buy(); toast('Keys in hand. Rent starts now.'); }
    closeLayer(); persist(); renderGame();
  },
  sellprop: (d) => { if (E.sellProperty(run, Number(d.q))) SFX.sell(); persist(); renderGame(); propSheet(); },
  repay: () => { if (E.repayMortgage(run, Math.max(0, run.cash))) SFX.sell(); persist(); renderGame(); propSheet(); },
  investbiz: () => { if (E.investBiz(run, Number(document.getElementById('amt').value))) SFX.buy(); closeLayer(); persist(); renderGame(); },
  manager: () => { if (E.hireManager(run)) { SFX.card(); toast('Manager hired. Profit is now passive.'); } persist(); renderGame(); bizSheet(); },
  sellbiz: () => { if (E.sellBiz(run)) SFX.sell(); closeLayer(); persist(); renderGame(); },
  ponzi: () => {
    openSheet(`${sheetHead('', 'Golden Circle Club')}<p>Your balance: <b>${f(run.h.ponzi.v)}</b>. The club says returns are guaranteed and your money is safe.</p>
      <p class="muted">You can withdraw now, minus a 30% "exit fee".</p>
      <button class="btn danger wide" data-act="ponzi-out" ${E.canAct(run) ? '' : 'disabled'}>Withdraw ${f(run.h.ponzi.v * 0.7)}</button><button class="btn wide" data-act="close">Stay in the club</button>`);
  },
  'ponzi-out': () => { E.exitPonzi(run); SFX.sell(); toast('You got out. Most members won\'t.'); closeLayer(); persist(); renderGame(); },
  life: (d) => { if (E.setLife(run, Number(d.lv))) { SFX.tap(); persist(); renderGame(); } },
  trap: (d) => {
    const amt = E.takeTrap(run, Number(d.i));
    if (amt > 0) { SFX.buy(); toast(`You sent ${f(amt)}. They promise 3× by next turn.`); persist(); renderGame(); }
  },
  tool: (d) => { if (E.useTool(run, d.tool)) { SFX.card(); persist(); renderGame(); } },
  next: () => nextTurn(),
  playout: () => { const r = pendingPlay; pendingPlay = null; playout(r || run.lastResult); },
  'to-event': () => showEvent(),
  choose: (d) => { const text = E.chooseEvent(run, Number(d.i)); if (text === null) return; SFX.tap(); persist(); showOutcome(text); },
  'to-cards': () => showCards(),
  take: (d) => { SFX.card(); takeCard(d.id); },
  results: () => results(lastDone),
  again: () => {
    const d = lastDone;
    if (!d) return home();
    if (d.mode === 'daily') return dailyScreen();
    if (d.mode === 'duel') return duel(d.seed.replace('duel-', ''));
    if (d.mode === 'era') return eras();
    if (d.mode === 'weekly') return ACT.weekly();
    return setup(d.mode);
  },
  copy: () => copyText(document.getElementById('share-text').textContent),
};

function resume() {
  run = P.run;
  if (!run) return home();
  renderGame();
  if (run.phase === 'event') { if (run.lastResult) playout(run.lastResult); else showEvent(); } else if (run.phase === 'cards') showCards();
  else startTimer();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act];
  if (fn) fn(el.dataset, el, e);
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'amt') { if (sheetCtx && sheetCtx.id === 'prop') updatePropSlider(); else updateSlider(); }
});
document.addEventListener('change', (e) => { if (e.target.id === 'mort') updatePropSlider(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && layer.querySelector('.sheet')) closeLayer(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
addEventListener('resize', () => { if (run && run.phase === 'alloc') drawSparks(); });

applyCalm();
home();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* no offline cache here; the game still runs */ });
}
