// Tycoon Rush screens. Plain DOM: each screen renders into #app, and sheets and
// modals render into #layer. All game rules live in engine.js.

import * as E from './engine.js';
import {
  CURRENCIES, LIFESTYLES, CHARACTERS, ASSETS, COMPANIES, STATE_INFO, SWANS, CARDS,
  ERAS, CHALLENGES, ASCENSION, GLOSSARY, SCAM_TIPS, LESSONS, TIPS, REGIONS, PROFILE_BLURB,
} from './content.js';
import * as A from './art.js';
import { buildReport } from './report.js';
import { BOOKS, PRINCIPLES, PLANS, AIMS } from './learn.js';

const app = document.getElementById('app');
const layer = document.getElementById('layer');
const fxCanvas = document.getElementById('fx');

// ------------------------------------------------------------------ profile

const KEY = 'tycoonrush.v1';
const DEFAULTS = {
  wisdom: 0, runs: 0, best: 0, freedoms: 0, bestAge: null, maxAsc: 0,
  glossary: [], scamLesson: false, daily: {}, weekly: {}, duels: {}, eras: {},
  principles: [], fcAll: [],
  settings: { sound: true, timer: false, currency: 'NGN', calm: false, lens: false },
  setup: { char: 'graduate', asc: 0, aim: 45 },
  onboarded: false, region: null, look: { skin: 3, hair: 'short', hairColor: 0, outfit: 0 },
  start: 'story',
  me: { age: 25, pay: 0, costs: 0, cash: 0, save: 0, index: 0, stocks: 0, crypto: 0, fx: 0, prop: 0, mortgage: 0, biz: 0, bizManaged: false, liveIn: true, debt: 0, aim: 45, goal: 0 },
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
  p.look = { ...DEFAULTS.look, ...(p.look || {}) };
  p.me = { ...DEFAULTS.me, ...(p.me || {}) };
  if (!CURRENCIES[p.settings.currency]) p.settings.currency = 'NGN';
  // Players from before the redesign skip the intro but keep their progress.
  if (saved && saved.runs > 0 && saved.onboarded == null) { p.onboarded = true; p.region = p.region || (p.settings.currency === 'USD' ? 'europe_na' : 'westafrica'); }
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
const pc = (x) => `${Math.round(x * 100)}%`;
const needsForecast = () => run && run.learnMode && !run.eraId && run.forecast == null;

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
  const homeBtn = run && run.phase !== 'done' ? `<button class="home-pill modal-home" data-act="home" aria-label="Home screen (your game is saved)">${A.icon('house', 22, '')}<span>Home</span></button>` : '';
  layer.innerHTML = `<div class="scrim full"><div class="modal" role="dialog" aria-modal="true">${homeBtn}${html}</div></div>`;
  layer.querySelector('.modal').scrollTop = 0;
}
function closeLayer() { layer.innerHTML = ''; sheetCtx = null; }
let sheetCtx = null;

// ------------------------------------------------------------------ people, places and plain words

const region = () => REGIONS[P.region] || REGIONS.westafrica;
const guideId = () => region().guide;
const guideName = () => A.GUIDES[guideId()].name;

// The guide talks in a speech bubble. `text` must already be safe HTML.
function guideSay(text, expr = 'happy', extra = '') {
  return `<div class="guide"><span class="guide-face">${A.castFace(guideId(), expr, 58, guideName())}</span><div class="bubble"><b>${esc(guideName())}</b><p>${text}</p>${extra}</div></div>`;
}

// A real finance word, shown small and tappable next to the plain one.
const jtag = (word, term) => `<button class="jtag" data-act="term" data-id="${term}">${esc(word)} ⓘ</button>`;
const ASSET_TERM = { save: 'realreturn', index: 'index', stocks: 'diversify', prop: 'mortgage', crypto: 'volatility', biz: 'passive', fx: 'devaluation' };

function youExpr() {
  if (!run) return 'happy';
  if (run.joy < 25) return 'tired';
  if (run.turn > 0 && run.market[run.turn - 1].state === 'crash') return 'shocked';
  return run.joy >= 45 ? 'happy' : 'neutral';
}

function lastMood() {
  return run && run.turn > 0 ? run.market[run.turn - 1].state : 'steady';
}

function sceneFor(r, opts = {}) {
  const prog = clamp(E.passive(r).total / E.bowl(r), 0, 1);
  return A.homeScene({
    stage: opts.stage ?? A.stageOf(prog), life: r.life, mood: opts.mood || lastMood(), look: P.look, char: r.char, age: r.age,
    expr: opts.expr || youExpr(), prop: r.h.prop.v > 0, biz: r.h.biz.c > 0, farmer: r.char === 'farmer',
    kids: !!r.flags.kids, car: !!r.flags.car, sea: E.atSea(r),
  }, { label: opts.label || 'Your home. It grows as your fruit basket fills.' });
}

// Effects written with little pictures: pay slip, smile, bowl, coin.
function fxIcons(note) {
  return esc(note)
    .replace(/\bjoy\b/g, `<span class="fx-i">${A.icon('smile', 16)}</span>joy`)
    .replace(/\b(salary|income|pay)\b/g, (w) => `<span class="fx-i">${A.icon('payslip', 16)}</span>${w}`)
    .replace(/\b([Cc]osts)\b/g, (w) => `<span class="fx-i">${A.icon('bowl', 16)}</span>${w}`);
}

function termSheet(id) {
  const g = GLOSSARY[id];
  if (!g) return;
  openSheet(`${sheetHead('', g[0])}${guideSay(esc(g[1]))}<button class="btn wide" data-act="close">Got it</button>`);
}

function pricesSheet() {
  const c = CURRENCIES[run.currency];
  const bread = 1.2 * c.scale * run.prices;
  const before = run.turn > 0 ? bread / Math.pow(1 + run.infl, run.ypt) : bread;
  const real = (1 + run.rate) / (1 + run.infl) - 1;
  const mood = lastMood();
  openSheet(`
    ${sheetHead('', 'Prices and rates')}
    <div class="pr-row">${A.icon('bread', 48, 'A loaf of bread')}<div><b>A loaf of bread: ${f(bread)}</b><p class="muted">${run.turn > 0 ? `Last year it was ${f(before)}.` : 'Watch this price each year.'}</p><p>Prices are rising <b>${pctS(run.infl)}</b> a year. ${jtag('Inflation', 'inflation')}</p></div></div>
    <div class="pr-row">${A.icon('counter', 48, 'Bank counter')}<div><b>The bank pays ${pctS(run.rate)} a year</b><p>on money in your safe box. ${jtag('Interest rate', 'rates')}</p><p class="${real >= 0 ? 'up' : 'down'}">${real >= 0 ? '▲' : '▼'} After rising prices, the safe box ${real >= 0 ? 'gains' : 'loses'} about ${pctS(Math.abs(real))} a year. ${jtag('Real return', 'realreturn')}</p></div></div>
    <div class="pr-row">${A.moodIcon(mood, 48)}<div><b>Market weather ${run.turn > 0 ? 'last year' : 'so far'}: ${A.WEATHER[mood].word}</b><p class="muted">${esc(STATE_INFO[mood].name)}. ${esc(STATE_INFO[mood].line)}</p></div></div>
    <button class="btn wide" data-act="close">Close</button>`);
}

function townSheet() {
  const open = ORDER.filter((id) => E.isOpen(run, id));
  openSheet(`${sheetHead('', 'Your town')}<p class="muted">Each building is a place to put money. Tap one to go in.</p>${A.townScene(open, lastMood())}<button class="btn wide" data-act="close">Back to my home</button>`);
}

// ------------------------------------------------------------------ first launch: intro, region, look

function intro(step = 0) {
  stopTimer();
  closeLayer();
  const steps = [
    { art: A.castFace(guideId(), 'cheer', 150, guideName()), text: `Hi! I'm <b>${esc(guideName())}</b>. I'll help you grow rich, one year at a time.` },
    { art: `<div class="intro-pair">${A.coinJar(0.7, { size: 110 })}${A.icon('bread', 90, 'Bread with a price tag')}</div>`, text: 'This jar is your money. Prices go up every year, so coins that just sit there buy less bread.' },
    { art: `<div class="intro-pair">${A.fruitTree(0.8, 110)}${A.icon('fruitbasket', 90, 'Fruit basket')}${A.icon('bowl', 90, 'Bowl')}</div>`, text: 'Money that comes by itself is fruit in your basket. Your living costs are the bowl. <b>Fill the bowl before 60 and you are free.</b>' },
  ];
  const s = steps[step];
  app.innerHTML = `
  <main class="intro">
    <div class="intro-art">${s.art}</div>
    ${guideSay(s.text, step === 0 ? 'cheer' : 'happy')}
    <div class="dots">${steps.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>
    <button class="btn primary wide" data-act="${step < steps.length - 1 ? 'intro' : 'region-screen'}" data-step="${step + 1}">${step < steps.length - 1 ? 'Next' : 'Choose where you live'}</button>
    <button class="btn ghost wide" data-act="region-screen">Skip</button>
  </main>`;
}

function regionScreen() {
  const sel = P.region || 'westafrica';
  page('Where do you live?', `
    ${A.worldMap(REGIONS, sel)}
    <div class="choice-list">${Object.entries(REGIONS).map(([id, r]) => `<button class="choice ${sel === id ? 'on' : ''}" data-act="region" data-id="${id}"><span class="av">${A.castFace(r.guide, 'happy', 44, '')}</span><span><b>${esc(r.name)}</b><small>Guide: ${esc(A.GUIDES[r.guide].name)} · ${r.currencies.map((c) => `${esc(CURRENCIES[c].sym.trim())} ${esc(CURRENCIES[c].name)}`).join(', ')}</small></span></button>`).join('')}</div>
    <p class="note">Your region sets your money, your guide and your town. The markets work the same way everywhere.</p>
    <div class="sticky-go"><button class="btn primary wide" data-act="look-screen">Next: how you look</button></div>`, P.onboarded ? 'settings' : 'intro');
}

function lookScreen() {
  const l = P.look;
  const swatch = (key, arr) => arr.map((c, i) => `<button class="swatch ${l[key] === i ? 'on' : ''}" style="--sw:${c}" data-act="look" data-k="${key}" data-v="${i}" aria-label="${key} ${i + 1}"></button>`).join('');
  page('How do you look?', `
    <div class="look-preview">${A.avatar(l, P.setup.char || 'graduate', { age: 22, expr: 'cheer', size: 180, label: 'Your character' })}</div>
    <section class="field"><span class="lbl">Skin</span><div class="swatches">${swatch('skin', A.SKINS)}</div></section>
    <section class="field"><span class="lbl">Hair</span><div class="hair-grid">${A.HAIRS.map((h) => `<button class="hair-btn ${l.hair === h ? 'on' : ''}" data-act="look" data-k="hair" data-v="${h}" aria-label="${h}">${A.person({ skin: A.SKINS[l.skin], hair: h, hairColor: A.HAIR_COLORS[l.hairColor || 0], outfit: A.OUTFITS[l.outfit], accent: A.OUTFITS[(l.outfit + 2) % 6], expr: 'happy' }, { size: 56 })}</button>`).join('')}</div></section>
    <section class="field"><span class="lbl">Hair colour</span><div class="swatches">${swatch('hairColor', A.HAIR_COLORS.slice(0, 4))}</div></section>
    <section class="field"><span class="lbl">Clothes</span><div class="swatches">${swatch('outfit', A.OUTFITS)}</div></section>
    <div class="sticky-go"><button class="btn primary wide" data-act="look-done">${P.onboarded ? 'Save' : 'Start playing'}</button></div>`, 'region-screen');
}

// ------------------------------------------------------------------ home

function home() {
  stopTimer();
  closeLayer();
  if (!P.onboarded) return intro(0);
  run = P.run;
  const daily = P.daily[today()];
  const wk = weeklyChallenge();
  const wkDone = P.weekly[weekNo()];
  const resume = run && run.phase !== 'done'
    ? `<button class="continue" data-act="resume"><span class="c-face">${A.avatar(P.look, run.char, { age: run.age, expr: 'happy', size: 52, label: '' })}</span><span><span class="kicker">Continue</span><b>${esc(E.MODES[run.mode].name)} · Age ${run.age}</b><span class="muted">${f(E.netWorth(run))} owned</span></span><span class="kicker">▶</span></button>` : '';
  const more = [
    ['daily', 'calendar', 'Daily Market', daily ? 'Done today ✓' : 'Same market for everyone'],
    ['duel', 'swords', 'Duel', 'Play a friend\'s market'],
    ['eras', 'clock', 'Eras', 'Famous booms and busts'],
    ['blitz', 'bolt', 'Blitz', '15 seconds a turn'],
    ['weekly', 'trophy', `Weekly: ${wk.name}`, wkDone != null ? 'Badge earned ✓' : wk.text],
    ['library', 'book', 'Library', 'The books behind the game'],
    ['collection', 'star', 'Collection', 'Cards, people, words'],
  ];
  app.innerHTML = `
  <main class="home">
    <div class="home-scene">${A.homeScene({ stage: P.bestAge ? 4 : 1, life: 2, mood: 'boom', look: P.look, char: P.setup.char || 'graduate', age: 22, expr: 'cheer', prop: P.freedoms > 0, biz: P.runs > 2 }, { label: 'Your home' })}</div>
    <header class="brand">
      <div class="logo">TYCOON<span>RUSH</span></div>
      <p class="tag">Fill your bowl with fruit from your money tree, before 60.</p>
    </header>
    ${resume}
    <button class="play-big" data-act="setup" data-mode="journey">${A.icon('play', 60, '')}<span><b>Play</b><small>Learn as you go, one year at a time</small></span></button>
    <button class="btn wide" data-act="setup" data-mode="classic">${A.icon('coin', 26, '')} Quick game · about 10 minutes</button>
    <details class="more"><summary>${A.icon('gift', 26, '')} More ways to play</summary>
      <div class="more-grid">${more.map(([act, ic, name, sub]) => `<button class="more-b" data-act="${act === 'blitz' ? 'setup' : act}" ${act === 'blitz' ? 'data-mode="blitz"' : ''}>${A.icon(ic, 40, '')}<b>${esc(name)}</b><small>${esc(sub)}</small></button>`).join('')}</div>
    </details>
    <div class="stats-row">
      <div class="stat"><b>${P.wisdom}</b><span>Wisdom</span></div>
      <div class="stat"><b>${P.best.toLocaleString()}</b><span>Best score</span></div>
      <div class="stat"><b>${P.bestAge ?? '–'}</b><span>Free at</span></div>
      <div class="stat"><b>${P.runs}</b><span>Runs</span></div>
    </div>
    ${standalone() ? '' : `<button class="btn wide" data-act="get-app">${A.icon('phone', 26, '')} Get the app · works offline</button>`}
    <nav class="homebar">
      <button class="btn small" data-act="look-screen">${A.icon('smile', 20, '')} Me</button>
      <button class="btn small" data-act="how">How to play</button>
      <button class="btn small" data-act="settings">${A.icon('gear', 20, '')} Settings</button>
    </nav>
    <div class="share-actions">
      <button class="btn" data-act="share-game">${A.icon('phone', 22, '')} Share with a friend</button>
      <button class="btn" data-act="feedback">${A.icon('envelope', 22, '')} Send feedback</button>
    </div>
  </main>`;
}

// ------------------------------------------------------------------ sharing and feedback

// The public address of the game, for sharing from anywhere (including copies
// of the game that run somewhere else).
const GAME_URL = 'https://samebimo10-cpu.github.io/Stock-/tycoon/';
// Put a WhatsApp number here (country code, digits only, e.g. '2348012345678')
// to send feedback straight to it. Left empty, WhatsApp asks who to send it to.
const FEEDBACK_WHATSAPP = '';
const INVITE = 'Try Tycoon Rush, a free game that teaches money. Grow your money tree and get free before 60. It works offline too.';
const waLink = (text, to = '') => `https://wa.me/${to.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

function shareGame() {
  if (navigator.share) {
    navigator.share({ title: 'Tycoon Rush', text: INVITE, url: GAME_URL }).catch(() => {});
    return;
  }
  const msg = `${INVITE}\n${GAME_URL}`;
  openSheet(`
    ${sheetHead('', 'Share with a friend')}
    ${guideSay('Send this link. Your friends can play in their browser and add it to their home screen.')}
    <div class="share"><pre id="share-text">${esc(msg)}</pre>
      <div class="share-actions"><button class="btn small" data-act="copy">Copy</button><a class="btn small primary" href="${waLink(msg)}" target="_blank" rel="noopener">WhatsApp</a></div></div>
    <button class="btn wide" data-act="close">Done</button>`);
}

const FB_TAGS = ['Fun', 'Learned something', 'Confusing', 'Too much reading', 'Too slow', 'Too fast', 'Found a bug'];
let fb = { rate: 0, tags: [] };

function feedbackText() {
  const d = lastDone && lastDone.result;
  const played = d
    ? `${E.MODES[lastDone.mode].name}, ${d.reason === 'free' ? `free at ${d.age}` : d.reason === 'bankrupt' ? `broke at ${d.age}` : `ended at ${d.age}`}, score ${d.score.toLocaleString()}`
    : run ? `${E.MODES[run.mode].name}, playing at age ${run.age}` : 'Not played yet';
  const text = (document.getElementById('fb-text') || {}).value || '';
  return [
    'Tycoon Rush feedback',
    fb.rate ? `Rating: ${fb.rate}/5` : '',
    fb.tags.length ? `Noticed: ${fb.tags.join(', ')}` : '',
    text.trim() ? `Comments: ${text.trim()}` : '',
    '—',
    `Played: ${played} · ${P.runs} run${P.runs === 1 ? '' : 's'} · ${region().name} · ${CURRENCIES[P.settings.currency].name}`,
  ].filter(Boolean).join('\n');
}

function updateFeedbackLink() {
  const a = document.getElementById('fb-send');
  if (a) a.href = waLink(feedbackText(), FEEDBACK_WHATSAPP);
  const pre = document.getElementById('share-text');
  if (pre) pre.textContent = feedbackText();
}

function feedbackSheet() {
  fb = { rate: 0, tags: [] };
  const faces = [10, 30, 50, 75, 100];
  openSheet(`
    ${sheetHead('', 'Tell us what you think')}
    ${guideSay('Your message goes to the person who shared this game with you. Honest is best!')}
    <span class="lbl">How much did you enjoy it?</span>
    <div class="fb-rate">${faces.map((j, i) => `<button class="fb-face" data-act="fb-rate" data-v="${i + 1}" aria-label="${i + 1} out of 5">${A.joyFace(j, 40)}<small>${i + 1}</small></button>`).join('')}</div>
    <span class="lbl">What stood out? Tap any</span>
    <div class="fb-tags">${FB_TAGS.map((t) => `<button class="fb-tag" data-act="fb-tag" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <label class="lbl" for="fb-text">Anything else?</label>
    <textarea id="fb-text" class="fb-text" rows="4" placeholder="What confused you, what you liked, what you would change…"></textarea>
    <pre id="share-text" hidden></pre>
    <a class="btn primary wide" id="fb-send" href="${waLink(feedbackText(), FEEDBACK_WHATSAPP)}" target="_blank" rel="noopener">Send on WhatsApp</a>
    <button class="btn wide" data-act="copy">Copy message instead</button>
    <p class="note">${FEEDBACK_WHATSAPP ? 'WhatsApp opens with your message ready to send.' : 'WhatsApp opens with your message ready. Pick the friend who sent you the game.'}</p>`);
  updateFeedbackLink();
}

// ------------------------------------------------------------------ the PDF report

let reportRun = null;

function reportTitle(r) {
  const res = r.result;
  if (!res) return `Game in progress, age ${r.age}`;
  return resultTitle(res)[1];
}

function reportSheet(r) {
  reportRun = r;
  const canShareFiles = !!(navigator.canShare && navigator.share);
  const framed = window.self !== window.top;
  openSheet(`
    ${sheetHead('', 'Your money report')}
    ${guideSay(r.result ? 'Here is how you did: a grade for each money habit, your key decisions, and what to try next.' : 'A report on your game so far. You can keep playing afterwards.')}
    <label class="me-f" for="report-name"><span><b>Name on the report</b><small>Optional</small></span><span class="me-in"><input id="report-name" type="text" maxlength="40" value="${esc(P.reportName || '')}" placeholder="Your name"></span></label>
    <button class="btn primary wide" data-act="report-download">${A.icon('payslip', 22, '')} Download PDF</button>
    ${canShareFiles ? `<button class="btn wide" data-act="report-share">${A.icon('phone', 22, '')} Share PDF (WhatsApp, email…)</button>` : ''}
    ${framed ? '<p class="note">Downloads can be blocked inside claude.ai. If nothing happens, open the game from its website to get the PDF.</p>' : '<p class="note">The report is made on your phone. Nothing is uploaded.</p>'}
    <button class="btn ghost wide" data-act="close">Close</button>`);
}

function makeReport() {
  const r = reportRun;
  const input = document.getElementById('report-name');
  P.reportName = input ? input.value.trim() : '';
  saveProfile();
  const bytes = buildReport(r, { name: P.reportName, modeName: E.MODES[r.mode].name, regionName: region().name, title: reportTitle(r) });
  const who = P.reportName ? `-${P.reportName.replace(/[^A-Za-z0-9]+/g, '-')}` : '';
  const file = `tycoon-rush-report${who}-age-${r.age}.pdf`;
  return { blob: new Blob([bytes], { type: 'application/pdf' }), file };
}

function downloadReport() {
  const { blob, file } = makeReport();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = file;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast('Report downloaded');
}

async function shareReport() {
  const { blob, file } = makeReport();
  const f = new File([blob], file, { type: 'application/pdf' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [f] })) await navigator.share({ files: [f], title: 'My Tycoon Rush report' });
    else downloadReport();
  } catch { /* cancelled */ }
}

// ------------------------------------------------------------------ setup

let setupMode = 'classic';
function setup(mode) {
  setupMode = mode || setupMode;
  const s = P.setup;
  const cur = P.settings.currency;
  const regionCurs = region().currencies;
  const otherCurs = Object.keys(CURRENCIES).filter((c) => !regionCurs.includes(c));
  const opt = (c) => `<option value="${c}" ${c === cur ? 'selected' : ''}>${esc(CURRENCIES[c].sym.trim())} ${esc(CURRENCIES[c].name)}</option>`;
  const chars = Object.entries(CHARACTERS).filter(([, c]) => !c.custom).map(([id, c]) => {
    const locked = c.unlock > P.wisdom;
    return `<button class="char-card ${s.char === id ? 'on' : ''} ${locked ? 'locked' : ''}" data-act="pick-char" data-id="${id}" ${locked ? 'disabled' : ''}>
      ${A.avatar(P.look, id, { age: 24, expr: locked ? 'neutral' : 'happy', size: 120, label: c.name })}
      <b>${esc(c.name)}</b><small>${locked ? `Unlocks at ${c.unlock} wisdom` : esc(c.blurb)}</small></button>`;
  }).join('');
  const asc = setupMode === 'classic' ? `
    <section class="field">
      <span class="lbl">Difficulty mountain</span>
      <div class="mountain">${Array.from({ length: ASCENSION.length }, (_, i) => `<span class="flag ${i <= P.maxAsc ? 'got' : ''} ${i === s.asc ? 'on' : ''}" style="--i:${i * 3}" title="${esc(ASCENSION[i])}"></span>`).join('')}</div>
      <div class="stepper">
        <button class="icon-btn" data-act="asc" data-d="-1" aria-label="Easier">−</button>
        <b>${s.asc}</b>
        <button class="icon-btn" data-act="asc" data-d="1" aria-label="Harder" ${s.asc >= P.maxAsc ? 'disabled' : ''}>+</button>
        <span class="note">${esc(ASCENSION[s.asc])}${P.maxAsc === 0 ? '. Reach freedom to climb higher.' : ''}</span>
      </div>
    </section>` : '';
  app.innerHTML = `
  <main class="page">
    <header class="page-h"><button class="home-pill" data-act="home" aria-label="Home screen">‹ ${A.icon('house', 20, '')}<span>Home</span></button><h1>${esc(E.MODES[setupMode].name)}</h1></header>
    ${['journey', 'classic', 'blitz'].includes(setupMode) ? `<section class="field">
      <span class="lbl">How do you want to start?</span>
      <div class="seg start-seg">
        <button class="${P.start !== 'me' ? 'on' : ''}" data-act="start-as" data-v="story">${A.icon('star', 22, '')} A story character</button>
        <button class="${P.start === 'me' ? 'on' : ''}" data-act="start-as" data-v="me">${A.icon('smile', 22, '')} My real life</button>
      </div>
    </section>` : ''}
    <section class="field">
      <label class="lbl" for="cur">Your money (currency)</label>
      <select id="cur" class="select">${regionCurs.map(opt).join('')}<optgroup label="Other currencies">${otherCurs.map(opt).join('')}</optgroup></select>
      <span class="note">${esc(PROFILE_BLURB[CURRENCIES[cur].profile])}</span>
    </section>
    ${P.start === 'me' && ['journey', 'classic', 'blitz'].includes(setupMode) ? meForm() : `<section class="field"><span class="lbl">Who are you? Swipe to see more</span><div class="char-strip">${chars}</div></section>`}

    ${asc}
    ${setupMode === 'journey' && P.start !== 'me' ? `<section class="field">
      <span class="lbl">Your goal: free by what age?</span>
      <div class="seg">${AIMS.map((a) => `<button class="${P.setup.aim === a ? 'on' : ''}" data-act="aim" data-v="${a}">${a}</button>`).join('')}</div>
      ${guideSay('Write your goal down and keep it in sight. <i>Think and Grow Rich</i> starts here. Each turn is one year, and your progress saves, so play a few years at a time.')}
    </section>` : ''}
    <div class="sticky-go"><button class="btn primary wide" data-act="start">${A.icon('play', 24, '')} Start at ${P.start === 'me' && ['journey', 'classic', 'blitz'].includes(setupMode) ? meAge() : E.MODES[setupMode].startAge}</button></div>
  </main>`;
  const strip = app.querySelector('.char-strip .on');
  if (strip) strip.scrollIntoView({ block: 'nearest', inline: 'center' });
}

// ------------------------------------------------------------------ start from your real life

const ME_FIELDS = [
  ['Your money now', [
    ['cash', 'Cash and current account', 'Money that earns no interest'],
    ['save', 'Savings and fixed deposits', 'Earns interest, safe'],
    ['index', 'Index or mutual funds', 'A basket of many companies'],
    ['stocks', 'Shares in single companies', ''],
    ['crypto', 'Crypto', ''],
    ['fx', 'Foreign money (e.g. dollars)', 'Its value in your own money'],
    ['prop', 'Property you own (value)', 'Home or land, what it would sell for'],
    ['biz', 'Your business (value)', 'What you have put in or could sell it for'],
  ]],
  ['What you owe', [
    ['mortgage', 'Mortgage left on property', ''],
    ['debt', 'Other debts', 'Loans, cards, money owed to people'],
  ]],
];
const num = (v) => Math.max(0, Number(v) || 0);
const meAge = () => clamp(Math.round(num(P.me.age) || 25), 16, 75);

function mePreview() {
  const m = P.me;
  const cur = P.settings.currency;
  const F = (n) => E.fmt(n, cur);
  const nw = num(m.cash) + num(m.save) + num(m.index) + num(m.stocks) + num(m.crypto) + num(m.fx) + num(m.prop) + num(m.biz) - num(m.mortgage) - num(m.debt);
  const bowlYr = Math.max(num(m.costs), num(m.goal)) * 12;
  const passiveYr = 0.04 * (num(m.save) + num(m.index) + num(m.stocks) + num(m.fx)) + (m.liveIn === false ? num(m.prop) * 0.05 : 0);
  const left = (num(m.pay) - num(m.costs)) * 12;
  const prog = bowlYr > 0 ? clamp(passiveYr / bowlYr, 0, 1) : 0;
  return `<div class="me-preview">
    <div class="f-row">${A.fruitTree(prog, 44)}<div><b>Net worth ${F(nw)}</b><p class="muted">Freedom Number ${F(25 * bowlYr)} · about ${Math.round(prog * 100)}% of the way</p></div></div>
    <p class="${left >= 0 ? 'up' : 'down'}">${left >= 0 ? '▲' : '▼'} You keep ${F(left)} a year after living costs.</p>
    ${num(m.costs) <= 0 ? '<p class="warn">Add your monthly living costs to start.</p>' : ''}
  </div>`;
}

const echo = (v) => (num(v) >= 1000 ? E.fmt(num(v), P.settings.currency) : '');

function meForm() {
  const m = P.me;
  const sym = CURRENCIES[P.settings.currency].sym.trim();
  const field = ([k, label, hint], opts = {}) => `<label class="me-f" for="me-${k}"><span><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span>
    <span class="me-in"><i>${opts.unit || esc(sym)}</i><input id="me-${k}" data-me="${k}" type="number" inputmode="decimal" min="0" step="any" value="${m[k] || ''}" placeholder="0"></span>
    <small class="me-echo" id="echo-${k}">${opts.unit ? '' : echo(m[k])}</small></label>`;
  return `<section class="field me-form">
    ${guideSay('Put in your real numbers. They stay on this phone only and are never sent anywhere. The game starts from exactly where you are.')}
    <span class="lbl">You</span>
    ${field(['age', 'Your age', ''], { unit: 'yrs' })}
    ${field(['pay', 'Take-home pay, per month', 'After tax'])}
    ${field(['costs', 'Living costs, per month', 'Rent, food, transport, bills, family. Not loan repayments: the game charges their interest'])}
    ${ME_FIELDS.map(([title, rows]) => `<span class="lbl">${title}</span>${rows.map((r) => field(r)).join('')}`).join('')}
    <label class="check" id="box-prop" ${num(m.prop) > 0 ? '' : 'hidden'}><input type="checkbox" id="me-liveIn" ${m.liveIn !== false ? 'checked' : ''}> I live in this property (it pays no rent)</label>
    <label class="check" id="box-biz" ${num(m.biz) > 0 ? '' : 'hidden'}><input type="checkbox" id="me-bizManaged" ${m.bizManaged ? 'checked' : ''}> My business runs without me (a manager runs it)</label>
    <span class="lbl">Your goals</span>
    ${field(['aim', 'Free by what age?', 'When you want work to be optional'], { unit: 'age' })}
    ${field(['goal', 'Income you want when free, per month', 'In today\'s money. Leave empty to use your living costs'])}
    <div id="me-preview">${mePreview()}</div>
  </section>`;
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
  const pl = A.PLAIN[id];
  if (id === 'fx' && !E.isOpen(run, 'fx') && !E.challenge(run)) return '';
  const open = E.isOpen(run, id);
  const hv = E.holdings(run)[id];
  let change = run.last[id];
  if (id === 'stocks' && Array.isArray(change)) change = change.reduce((s, x) => s + x, 0) / change.length;
  const arrow = (x) => (x > 0.0005 ? '▲' : x < -0.0005 ? '▼' : '■');
  let foot = change != null ? `<span class="${cls(change)}">${arrow(change)} ${E.pct(change, 1)}</span>` : '<span class="muted">New</span>';
  if (id === 'biz' && run.h.biz.c > 0) foot = `<span class="up">▲ ${f(run.h.biz.profit)}/yr</span>`;
  if (id === 'prop' && run.h.prop.v > 0) foot = E.rentable(run) > 0 ? `<span class="up">▲ ${f(E.rentable(run) * E.rentYield(run))}/yr</span>` : '<span class="muted">■ Your home</span>';
  if (id === 'save') foot = `<span class="${run.rate < run.infl ? 'down' : 'up'}">${run.rate < run.infl ? '▼' : '▲'} ${pctS(run.rate)}/yr</span>`;
  return `<button class="tile ${open ? '' : 'closed'}" style="--c:${ASSETS[id].color}" data-act="asset" data-id="${id}" ${open ? '' : 'disabled'} aria-label="${esc(pl.label)}: ${esc(f(hv))}">
    <span class="t-top">${A.icon(pl.icon, 40, '')}<span class="t-name">${esc(pl.label)}<small>${esc(ASSETS[id].name)}</small></span></span>
    <b class="t-val ${hv > 0 ? '' : 'zero'}">${f(hv)}</b>
    <span class="t-cap">${open ? esc(pl.cap) : 'Closed this week'}</span>
    ${id === 'index' && open ? (() => { const mm = E.mrMarket(run); return `<span class="mm" style="color:${mm.v < 0.92 ? 'var(--gain)' : mm.v > 1.08 ? 'var(--orange)' : 'var(--sky)'}">${mm.v < 0.92 ? '▼ Cheap' : mm.v > 1.08 ? '▲ Dear' : '■ Fair'} · ${mm.v.toFixed(2)}× value</span>`; })() : ''}
    <span class="t-foot">${foot}<canvas class="spark" data-id="${id}" width="64" height="24"></canvas></span>
  </button>`;
}

function headlinePic(n) {
  if (n.kind === 'trap') return A.castFace('hype', 'sly', 44, 'The Hype Guy');
  if (n.tag === 'co') return A.icon('companies', 40, 'A company');
  if (n.tag === 'rate') return A.icon('bank', 40, 'The central bank');
  if (n.tag === 'fx') return A.icon('swap', 40, 'Currency');
  if (n.hint) return A.moodIcon(n.hint, 40);
  return A.icon('tv', 40, 'News');
}
const STAMP = { real: ['tick', 'Real'], fake: ['cross', 'Fake'], noise: ['shrug', 'Noise'], scam: ['warn', 'Scam'] };

function renderGame() {
  if (!run) return home();
  const m = run.market[run.turn];
  const nw = E.netWorth(run);
  const p = E.passive(run);
  const C = E.costs(run);
  const B = E.bowl(run);
  const prog = clamp(p.total / B, 0, 1);
  const sea = E.atSea(run);
  const locked = E.lifeLocked(run);
  const idle = run.flags.idle || 0;
  const tip = P.runs === 0 && run.turn < TIPS.length && !run.flags[`tip${run.turn}`]
    ? `<div class="sec">${guideSay(esc(TIPS[run.turn]), 'happy', '<button class="btn small" data-act="tip">Got it</button>')}</div>` : '';
  const crystal = run.crystal[run.turn]
    ? `<div class="chip-line" style="border-color:${STATE_INFO[m.state].color};color:${STATE_INFO[m.state].color}">${A.moodIcon(m.state, 24)} Crystal ball: the next ${run.ypt === 1 ? 'year looks' : `${run.ypt} years look`} ${A.WEATHER[m.state].word.toLowerCase()} (${STATE_INFO[m.state].name}).</div>` : '';
  const revealAll = E.newsRevealed(run, {});
  const headlines = m.news.map((n, i) => {
    const shown = E.newsRevealed(run, n);
    const src = n.tag === 'co' ? 'Markets' : n.tag === 'rate' ? 'Central bank' : n.tag === 'fx' ? 'Currency' : n.kind === 'trap' ? 'Sponsored' : 'News';
    const key = n.kind === 'trap' ? 'scam' : n.kind === 'noise' ? 'noise' : n.real ? 'real' : 'fake';
    const verdict = shown ? `<span class="stamp">${A.icon(STAMP[key][0], 30, STAMP[key][1])}<small>${STAMP[key][1]}</small></span>` : '';
    const getin = n.kind === 'trap' ? `<button class="getin" data-act="trap" data-i="${i}" ${n.taken ? 'disabled' : ''}>${n.taken ? 'You are in' : 'Get in early ▸'}</button>` : '';
    const hint = run.learnMode && n.hint ? `<span class="pill hint-pill" style="--mc:${STATE_INFO[n.hint].color}">Sounds like: ${A.WEATHER[n.hint].word}</span>` : '';
    return `<article class="headline ${n.kind === 'trap' ? 'is-trap' : ''}"><div class="h-top"><span class="h-pic">${headlinePic(n)}</span><span class="src">${src}</span>${verdict}</div><p>${esc(n.text)}</p>${hint}${getin}</article>`;
  }).join('');
  const whisper = (run.charges.insider > 0 && !revealAll) ? `<button class="btn small" data-act="tool" data-tool="insider">Whisper (${run.charges.insider})</button>` : '';
  const ball = (run.charges.crystal > 0 && !run.crystal[run.turn]) ? `<button class="btn small" data-act="tool" data-tool="crystal">Crystal ball (${run.charges.crystal})</button>` : '';
  const ponzi = run.h.ponzi ? `<button class="tile special" data-act="ponzi"><span class="t-top">${A.castFace('hype', 'sly', 40, 'The Hype Guy')}<span class="t-name">Golden Circle<small>"Guaranteed 30%"</small></span></span><b class="t-val">${f(run.h.ponzi.v)}</b><span class="t-foot"><span class="up">▲ +30.0%</span></span></button>` : '';
  const heldCards = run.cards.map((id) => { const c = E.cardById(id); return `<span class="hc ${c.type === 'Tool' ? 'tool' : ''}">${A.icon(A.TYPE_ICON[c.type] === 'hype' ? 'warn' : A.TYPE_ICON[c.type], 16, '')} ${esc(c.name)}${run.charges[id] ? ` ×${run.charges[id]}` : ''}</span>`; }).join('');
  const lev = run.lev > 0 ? `<span class="hc" style="border-color:var(--orange);color:var(--orange)">${A.icon('dice', 16, '')} Leverage: ${run.lev} turn${run.lev > 1 ? 's' : ''}</span>` : '';
  const debtLine = run.cash < 0 ? `You owe this. It grows ${pctS(E.debtRate(run))} a year until you sell something to pay it.` : idle > 0 ? `Sitting idle: rising prices take ${pctS(run.infl)} a year.` : 'Coins in a jar earn nothing.';
  const saving = run.salary - C;
  const mood = lastMood();
  const L = LIFESTYLES;

  app.innerHTML = `
  <div class="game">
    <header class="hud">
      <div class="hud-row">
        <button class="icon-btn" data-act="menu" aria-label="Menu">☰</button>
        <button class="icon-btn" data-act="home" aria-label="Home screen (your game is saved)">${A.icon('house', 26, '')}</button>
        <button class="me" data-act="town" aria-label="You, age ${run.age}. Open your town">${A.avatar(P.look, run.char, { age: run.age, expr: youExpr(), size: 46, label: '' })}<span class="agebadge">${run.age}</span></button>
        <button class="hud-own" data-act="statement" aria-label="Everything you own: ${esc(f(nw))}">${A.icon('coins', 26, '')}<span><span class="lbl">Everything you own</span><b class="nw ${nw < 0 ? 'down' : ''}" id="nw">${f(nw)}</b></span></button>
        <button class="wx" data-act="prices" aria-label="Prices and rates">${A.moodIcon(mood, 34)}<small>Prices</small></button>
      </div>
      <button class="freedom" data-act="passive" aria-label="Fruit basket against the bowl: ${Math.round(prog * 100)}%">
        <span class="f-row">${A.fruitTree(prog, 34)}<span class="fbar"><i style="width:${(prog * 100).toFixed(1)}%"></i><b>${Math.round(prog * 100)}%</b></span>${A.icon('bowl', 30, '')}</span>
        <span class="fmeta"><span>Fruit <b>${f(p.total)}</b>/yr</span><span>Bowl <b>${f(B)}</b>/yr${B > C * 1.001 ? ' (your goal)' : ''}</span></span>
      </button>
    </header>
    <section class="scene-wrap"><button class="scene-btn" data-act="town" aria-label="Your home and town">${sceneFor(run)}</button>
      <div class="scene-cap">${run.turn > 0 ? `Last year: <b>${A.WEATHER[mood].word}</b> (${esc(STATE_INFO[mood].name)})` : 'Age 22: your first home'} · tap to open your town</div></section>
    ${run.aim ? `<div class="chip-line" style="border-color:var(--orange);color:var(--orange)">${A.icon('trophy', 22, '')} Goal: free by ${run.aim}. ${run.age < run.aim ? `${run.aim - run.age} years to go.` : 'The date has passed. Keep going.'}</div>` : ''}
    ${tip}${crystal}
    ${sea ? `<div class="sea-note">${A.icon('clock', 22, '')} <b>At sea.</b> You can't trade or change how you live this turn. Your money keeps working while you sail.</div>` : ''}
    ${E.era(run) ? `<div class="chip-line" style="border-color:var(--gold);color:var(--gold)">${esc(E.era(run).name)}: finish owning ${E.era(run).target}× a year of costs (${f(E.era(run).target * C)}), or reach freedom.</div>` : ''}
    <section class="sec">
      <div class="sec-h"><h2 class="news-h">${A.castFace('anchor', 'neutral', 30, 'The news anchor')} This year's news</h2><div style="display:flex;gap:6px">${whisper}${ball}</div></div>
      <div class="news-strip">${headlines}</div>
    </section>
    ${thinkHTML()}
    <section class="sec">
      <div class="sec-h"><h2>Where your money goes</h2><span class="note">Tap to put in or take out</span></div>
      <div class="grid">${ORDER.map(tileHTML).join('')}${ponzi}</div>
    </section>
    <section class="sec">
      <div class="wallet">
        <div class="cash-row">${A.coinJar(clamp(run.cash / Math.max(1, C), 0, 1), { debt: run.cash < 0, shrink: idle * 0.05, size: 56 })}<span class="cash-txt"><span class="lbl">Cash in your jar</span><b class="${run.cash < 0 ? 'down' : ''}" style="opacity:${1 - Math.min(0.45, idle * 0.12)}">${f(run.cash)}</b><span class="cash-sub">${debtLine}</span></span></div>
        <div class="flowline">${A.icon('payslip', 20, 'Pay')} Pay <b>${f(run.salary)}</b> − ${A.icon('bowl', 20, 'Costs')} costs <b>${f(C)}</b> = <b class="${saving >= 0 ? 'up' : 'down'}">${saving >= 0 ? '▲' : '▼'} ${f(saving, true)}</b> a year</div>
        <div class="field">
          <span class="lbl">How you live${locked ? ' (locked)' : ''}</span>
          <div class="rooms">${L.map((l, i) => `<button class="room-b ${run.life === i ? 'on' : ''}" data-act="life" data-lv="${i}" ${sea || locked ? 'disabled' : ''} aria-label="${l.name}, joy ${l.joy >= 0 ? '+' : ''}${l.joy}">${A.room(i, 52)}<b>${l.name}</b><small>${A.icon(l.joy >= 0 ? 'smile' : 'sad', 14, '')}${l.joy >= 0 ? '+' : ''}${l.joy}</small></button>`).join('')}</div>
          <span class="note">${esc(L[run.life].blurb)} Costs ×${L[run.life].mult}. Better living makes you happier but makes the bowl bigger.</span>
        </div>
        ${planHTML(sea)}
        <div class="joy">${A.joyFace(run.joy, 24)}<div class="jbar"><i style="width:${run.joy}%;background:${run.joy < 25 ? 'var(--loss)' : 'var(--pink)'}"></i></div><b class="num">${Math.round(run.joy)}</b></div>
      </div>
    </section>
    ${curesHTML()}
    ${heldCards || lev ? `<section class="sec"><div class="sec-h"><h2>Your cards</h2></div><div class="held">${lev}${heldCards}</div></section>` : ''}
    <footer class="actionbar"><div class="actions-row"><button class="home-big" data-act="home" aria-label="Home screen (your game is saved)">${A.icon('house', 28, '')}<span>Home</span></button><button class="next" data-act="next" ${needsForecast() ? 'style="opacity:.6"' : ''}><span>${needsForecast() ? 'Guess first ▲' : `Live ${run.ypt === 1 ? 'the year' : `${run.ypt} years`} ▸`}</span><small>Age ${run.age} → ${run.age + run.ypt}</small><i class="timer"></i></button></div></footer>
  </div>`;
  requestAnimationFrame(drawSparks);
}

// ------------------------------------------------------------------ learning panels

const moodName = (s) => STATE_INFO[s].name;

function thinkHTML() {
  if (run.eraId) return '';
  const learnM = run.learnMode;
  if (!learnM && !P.settings.lens) {
    return `<section class="think"><div class="sec-h"><h2>Probability lens</h2><button class="linkish" data-act="lens">Open</button></div><p class="why">See base rates, what the headlines imply, and forecast the year.</p></section>`;
  }
  const { prior: pr, post, hints } = E.posterior(run);
  const decided = run.forecast != null;
  const showPost = decided || !learnM;
  const odds = E.upOdds(run);
  const prevS = run.turn > 0 ? run.market[run.turn - 1].state : null;
  const rows = E.MOODS.map((s) => `<div class="lens-row" style="--mc:${STATE_INFO[s].color}"><span class="mood-n">${moodName(s)}</span>
    <div class="bar"><i style="width:${pr[s] * 100}%"></i><b>${pc(pr[s])}</b></div>
    <div class="bar post ${showPost ? '' : 'hidden'}"><i style="width:${post[s] * 100}%"></i><b>${showPost ? pc(post[s]) : '?'}</b></div></div>`).join('');
  const span = run.ypt === 1 ? 'the next year' : `the next ${run.ypt} years`;
  const chips = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((p) => `<button class="${decided && Math.abs(run.forecast - p) < 0.001 ? 'on' : ''}" data-act="fc" data-p="${p}" ${decided && learnM ? 'disabled' : ''}>${Math.round(p * 100)}</button>`).join('');
  let reveal = '';
  if (showPost) {
    const top = E.MOODS.slice().sort((a, b) => post[b] - post[a])[0];
    const n = hints.filter((x) => x === top).length;
    const mm = E.mrMarket(run);
    reveal = `
      <div class="fc-read">
        <div><b>${decided ? pc(run.forecast) : '–'}</b><span>You said</span></div>
        <div><b>${pc(odds.base)}</b><span>Base rates only</span></div>
        <div><b>${pc(odds.ideal)}</b><span>Base rates + headlines</span></div>
      </div>
      <p class="why">Most likely mood: <b>${moodName(top)}</b>, ${pc(post[top])}. Its base rate was ${pc(pr[top])}, and ${n === 0 ? 'no headline points to it' : `${n} headline${n > 1 ? 's point' : ' points'} to it`}. Each mood headline is right 80% of the time, so every match multiplies its odds by 16 (0.8 ÷ 0.05) against each other mood. In a ${moodName(top)} the index beats inflation ${pc(odds.per[top])} of the time.${Math.abs(mm.gap) > 0.08 ? ` Mr. Market is ${mm.mood.toLowerCase()} at ${mm.v.toFixed(2)}× fair value, which ${mm.gap < 0 ? 'raises' : 'lowers'} the odds.` : ''}</p>`;
  }
  return `<section class="think">
    <div class="sec-h"><h2>Think in probabilities</h2><button class="linkish" data-act="principle" data-id="${showPost ? 'x_bayes' : 'x_base'}">Why?</button></div>
    <p class="why">${prevS ? `Last year was a <b>${moodName(prevS)}</b>. Base rates show what usually followed one.` : 'The first year. Base rates show how careers usually begin.'} ${learnM && !decided ? 'Read the headlines, then make your call. The full maths appears after you commit.' : ''}</p>
    <div class="lens-row head"><span>Next mood</span><span>Base rate</span><span>After headlines</span></div>
    ${rows}
    <div class="fc-q">Will the index fund beat inflation over ${span}? <span class="muted">(%)</span></div>
    <div class="fc-chips">${chips}</div>
    ${reveal}
    ${!learnM ? '<button class="linkish" data-act="lens" style="justify-self:start">Hide lens</button>' : ''}
  </section>`;
}

function planHTML(sea) {
  const pl = run.plan;
  const can = E.canAct(run) && !sea;
  const C = E.costs(run);
  const mix = PLANS[pl.mix];
  return `<div class="plan">
    <span class="lbl">Your plan: pay yourself first</span>
    <div class="seg">${[0, 0.1, 0.2, 0.3, 0.5].map((x) => `<button class="${Math.abs(pl.pyf - x) < 0.001 ? 'on' : ''}" data-act="pyf" data-v="${x}" ${can ? '' : 'disabled'}>${Math.round(x * 100)}%</button>`).join('')}</div>
    <div class="seg">${Object.entries(PLANS).map(([k, v]) => `<button class="${pl.mix === k ? 'on' : ''}" data-act="mix" data-k="${k}" ${can ? '' : 'disabled'}>${v.name}</button>`).join('')}</div>
    <button class="toggle-row" data-act="rebal" role="switch" aria-checked="${!!pl.rebalance}" ${can ? '' : 'disabled'}><span style="text-align:left"><b>Rebalance every year</b><small>Keep savings and index at ${Math.round((1 - mix.index) * 100)} / ${Math.round(mix.index * 100)}</small></span><span class="switch ${pl.rebalance ? 'on' : ''}"></span></button>
    <span class="note">${pl.pyf > 0 ? `${f(run.salary * pl.pyf)} a year goes to you before any spending: ${Math.round(mix.index * 100)}% index, the rest savings.` : 'Nothing goes to you first yet. Arkad says keep at least 10%.'}</span>
    ${run.salary * (1 - pl.pyf) < C ? '<span class="warn">Your plan plus living costs are more than your pay, so the plan will invest less than you set. Cut your lifestyle to make it fit.</span>' : ''}
  </div>`;
}

const CURE_NAMES = ['Pay yourself first', 'Control spending', 'Make gold multiply', 'Guard against loss', 'Own property', 'Future income', 'Grow your earning'];
const CURE_IDS = ['b_purse', 'b_control', 'b_multiply', 'b_guard', 'b_home', 'b_future', 'b_earn'];

function curesHTML() {
  const lit = run.cures.filter(Boolean).length;
  return `<section class="sec"><button class="wallet cures-btn" data-act="cures">
    <span><span class="lbl">Arkad's seven cures</span><br><span class="note">${run.turn === 0 ? 'Checked at the end of each year' : `${lit} of 7 kept last year`}</span></span>
    <span class="stones">${run.cures.map((on, i) => `<span class="stone ${on ? 'on' : ''}">${i + 1}</span>`).join('')}</span></button></section>`;
}

function lessonHTML(pid, text, act = false) {
  const pr = PRINCIPLES[pid];
  const b = BOOKS[pr.book];
  const tag = act ? 'button' : 'div';
  return `<${tag} class="lesson" style="--bc:${b.color}" ${act ? `data-act="principle" data-id="${pid}"` : ''}><span class="book">${esc(b.title)}</span><b>${esc(pr.title)}</b><p>${esc(text || pr.idea)}</p></${tag}>`;
}

function principleSheet(id) {
  const pr = PRINCIPLES[id];
  const b = BOOKS[pr.book];
  openSheet(`
    ${sheetHead('', pr.title)}
    <span class="kicker" style="color:${b.color}">${esc(b.title)}${b.year ? ` · ${esc(b.author)}, ${b.year}` : ''}</span>
    <p>${esc(pr.idea)}</p>
    <div class="insight" style="--ic:${b.color}"><span class="lbl">In the game</span><p>${esc(pr.game)}</p></div>
    <p class="note">Ideas paraphrased from the book. Read the original, it is worth it.</p>
    <button class="btn wide" data-act="close">Close</button>`);
}

function curesSheet() {
  openSheet(`
    ${sheetHead('', 'Arkad\'s seven cures')}
    <p class="muted">From The Richest Man in Babylon: seven habits that cure a lean purse. Each is checked at the end of every year.</p>
    <div class="cure-list">${CURE_IDS.map((id, i) => `<div><span class="stone ${run.cures[i] ? 'on' : ''}">${i + 1}</span><span><b>${esc(PRINCIPLES[id].title)}</b><p>${esc(PRINCIPLES[id].game)}</p><p>Kept for ${run.cureYears[i]} of ${run.age - run.startAge} years.</p></span></div>`).join('')}</div>
    <button class="btn wide" data-act="close">Close</button>`);
}

function statementSheet() {
  const st = E.statement(run);
  const row = ([k, v]) => `<div><span>${esc(k)}</span><b>${f(v)}</b></div>`;
  const q = st.quadrant;
  const tot = q.E + q.S + q.B + q.I || 1;
  const cell = (k, name, sub) => `<div class="${q[k] > 0 ? 'on' : ''}"><small>${name}</small><b>${pc(q[k] / tot)}</b><small>${sub}</small></div>`;
  const inc = st.income.reduce((s, r) => s + r[1], 0);
  const exp = st.expenses.reduce((s, r) => s + r[1], 0);
  openSheet(`
    ${sheetHead('', 'Your financial statement')}
    <p class="muted">Rich Dad's test: assets put money in your pocket, liabilities take it out. Passive income must beat expenses to leave the rat race.</p>
    <div class="stmt">
      <h3>Income a year</h3>${st.income.map(row).join('')}<div><b>Total</b><b class="up">${f(inc)}</b></div>
      <h3>Expenses a year</h3>${st.expenses.map(row).join('')}<div><b>Total</b><b class="down">${f(exp)}</b></div>
      <h3>Assets</h3>${st.assets.map(row).join('') || '<div><span class="muted">None yet</span><b></b></div>'}
      <h3>Liabilities</h3>${st.liabilities.map(row).join('') || '<div><span class="muted">None</span><b></b></div>'}
    </div>
    <span class="lbl">Where your income comes from</span>
    <div class="quad">${cell('E', 'Employee', 'You have a job')}${cell('S', 'Self-employed', 'You run a business')}${cell('B', 'Business owner', 'A system runs it')}${cell('I', 'Investor', 'Money works for you')}</div>
    <p class="note">Only B and I keep paying when you stop working. That is the right-hand side of the cashflow quadrant.</p>
    <button class="btn wide" data-act="close">Close</button>`);
}

function mathHTML(m) {
  if (!m) return '';
  if (m.kind === 'text') return `<p>${esc(m.text)}</p>`;
  const rows = m.rows.map((r) => `<div class="mrow"><span>${pc(r.p)} · ${esc(r.label)}</span><span>${m.kind === 'stake' ? `${r.m === 0 ? 'lose it' : `${r.m.toFixed(r.m < 10 ? 1 : 0)}× stake`}` : f(r.v)}</span></div>`).join('');
  if (m.kind === 'cost') {
    return `${rows}<div class="mrow ev"><span>Expected cost</span><span>${f(m.ev)}</span></div>${m.compare != null ? `<div class="mrow"><span>${esc(m.compareLabel)}</span><span>${f(m.compare)}</span></div>` : ''}<p class="why">The cheaper average isn't always best: ask whether you could survive the bad case.</p>`;
  }
  const verdict = m.kelly <= 0
    ? 'On average this loses money, so Kelly says bet nothing.'
    : `This risks ${pc(m.share)} of your net worth. Kelly says at most ${pc(m.kelly)} (${f(m.kellyAmt)}); careful investors use half that.${m.share > m.kelly ? ' This is more than Kelly.' : ''}`;
  return `${rows}<div class="mrow ev"><span>Expected value</span><span class="${m.ev >= 0 ? 'up' : 'down'}">${f(m.ev, true)} (${m.mult.toFixed(2)}× stake)</span></div><p class="why">${verdict}</p>`;
}

function showQuiz() {
  const q = E.quizView(run);
  if (!q) return;
  const b = BOOKS[PRINCIPLES[q.p].book];
  openModal(`
    <div class="ev-card"><span class="kicker" style="color:${b.color}">Mentor's question · ${esc(b.title)}</span><p class="outcome">${esc(q.q)}</p></div>
    <div class="choices">${q.opts.map((o, i) => `<button class="quiz-opt" data-act="quiz" data-i="${i}">${esc(o)}</button>`).join('')}</div>`);
}

function drawPath(c, path) {
  const { ctx, w, h } = sizeCanvas(c);
  const lo = Math.min(...path, 1);
  const hi = Math.max(...path, 1);
  const span = hi - lo || 1;
  const X = (i) => 8 + (i / (path.length - 1)) * (w - 16);
  const Y = (v) => 10 + (1 - (v - lo) / span) * (h - 30);
  ctx.strokeStyle = 'rgba(169,159,210,.35)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(8, Y(1)); ctx.lineTo(w - 8, Y(1)); ctx.stroke(); ctx.setLineDash([]);
  const up = path[path.length - 1] >= 1;
  const col = up ? '#3ddc97' : '#ff5d73';
  ctx.font = '600 10px Figtree, system-ui, sans-serif'; ctx.fillStyle = '#a99fd2';
  ctx.fillText('Index fund, month by month', 10, h - 6);
  const months = path.length - 1;
  let i = 0;
  const step = () => {
    i = Math.min(months, i + (calm() ? months : 1));
    ctx.clearRect(0, 0, w, h - 16);
    ctx.strokeStyle = 'rgba(169,159,210,.35)'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(8, Y(1)); ctx.lineTo(w - 8, Y(1)); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath();
    for (let j = 0; j <= i; j++) (j ? ctx.lineTo(X(j), Y(path[j])) : ctx.moveTo(X(j), Y(path[j])));
    ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(i), Y(path[i]), 3, 0, Math.PI * 2); ctx.fill();
    if (i < months) setTimeout(step, 110);
  };
  step();
}

function drawCalib(c, buckets) {
  const { ctx, w, h } = sizeCanvas(c);
  const pad = 28;
  const X = (v) => pad + v * (w - pad - 10);
  const Y = (v) => h - pad + -v * (h - pad - 10);
  ctx.strokeStyle = 'rgba(169,159,210,.2)'; ctx.lineWidth = 1;
  ctx.font = '600 10px Figtree, system-ui, sans-serif'; ctx.fillStyle = '#a99fd2';
  for (const v of [0, 0.5, 1]) {
    ctx.beginPath(); ctx.moveTo(X(0), Y(v)); ctx.lineTo(X(1), Y(v)); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText(pc(v), X(0) - 4, Y(v) + 3);
    ctx.textAlign = 'center'; ctx.fillText(pc(v), X(v), h - pad + 14);
  }
  ctx.fillText('What you said', X(0.5), h - 2);
  ctx.setLineDash([5, 4]); ctx.strokeStyle = '#ffc53d';
  ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(1), Y(1)); ctx.stroke(); ctx.setLineDash([]);
  for (const b of buckets) {
    ctx.fillStyle = '#b69cff';
    ctx.beginPath(); ctx.arc(X(b.said), Y(b.happened), 4 + Math.min(8, Math.sqrt(b.n) * 1.5), 0, Math.PI * 2); ctx.fill();
  }
}

// ------------------------------------------------------------------ asset sheets

function sheetHead(id, title) {
  const pl = A.PLAIN[id];
  const pic = pl ? A.icon(pl.icon, 40, '') : `<span class="dot" style="--c:var(--gold)"></span>`;
  const name = pl ? `${esc(pl.label)} ${jtag(ASSETS[id].name, ASSET_TERM[id])}` : esc(title);
  return `<header class="sh-h">${pic}<h2>${name}</h2><button class="icon-btn" data-act="close" aria-label="Close">✕</button></header>`;
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
    ${id === 'index' ? (() => { const mm = E.mrMarket(run); const pos = clamp((mm.v - 0.6) / 1.0, 0, 1) * 100; return `<div class="field"><span class="lbl">Mr. Market today: ${mm.mood}, ${mm.v.toFixed(2)}× fair value</span><div class="gauge"><i style="left:${pos}%"></i></div><div class="gauge-l"><span>Cheap 0.6×</span><span>Fair 1.0×</span><span>Dear 1.6×</span></div><p class="why">${mm.v < 0.9 ? `He is selling ${pc(-mm.gap)} below fair value. That gap is a margin of safety: on average, prices drift back up to value.` : mm.v > 1.15 ? `He wants ${pc(mm.gap)} more than fair value. On average, expensive starts lead to weaker years.` : 'Prices are close to fair value. No bargain, no bubble.'} <button class="linkish" data-act="principle" data-id="${mm.v < 1 ? 'g_margin' : 'g_mrmarket'}">Learn more</button></p></div>`; })() : ''}
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
      <div><dt>Rent a year</dt><dd class="up">${f(E.rentable(run) * E.rentYield(run))}</dd></div>
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
      ${E.bowl(run) > C * 1.001 ? `<div><span>Your goal income when free</span><b>${f(E.bowl(run))}/yr</b></div>` : ''}
    </div>
    <p class="note">Your Freedom Number is 25 × your bowl: <b>${f(E.freedomNumber(run))}</b> invested. Crypto pays no income, so it only counts once you sell it into something that does. Every lifestyle upgrade raises this number.</p>
    <button class="btn wide" data-act="close">Close</button>`);
}

function menuSheet() {
  openSheet(`
    ${sheetHead('', 'Paused')}
    <button class="btn primary wide" data-act="close">Resume</button>
    <button class="btn wide" data-act="glossary-sheet">Words you have learned</button>
    <button class="btn wide" data-act="home">Save and go home</button>
    <button class="btn wide" data-act="report-now">${A.icon('payslip', 22, '')} Progress report (PDF)</button>
    <div class="share-actions"><button class="btn" data-act="share-game">Share game</button><button class="btn" data-act="feedback">Send feedback</button></div>
    <button class="btn danger wide" data-act="abandon">Abandon this run</button>`);
}

// ------------------------------------------------------------------ the turn sequence

function nextTurn(force = false) {
  if (!run || run.phase !== 'alloc') return;
  if (!force && needsForecast()) {
    toast('Make your forecast first: will the index beat inflation?');
    const t = document.querySelector('.think');
    if (t) t.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'center' });
    return;
  }
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
  const rows = res.rows.map((r, i) => `<li style="animation-delay:${0.35 + i * 0.12}s"><span class="r-name">${A.icon(A.PLAIN[r.id].icon, 26, '')}${esc(A.PLAIN[r.id].label)}</span><span class="${cls(r.gain)}">${f(r.gain, true)}</span><span class="p ${cls(r.pct)}">${r.pct >= 0 ? '▲' : '▼'} ${E.pct(r.pct, 1)}</span></li>`).join('');
  const flows = res.flows.map((x) => `<div><span>${esc(x.label)}</span><b class="${cls(x.v)}">${f(x.v, true)}</b></div>`).join('');
  const notes = res.notes.map((n) => `<p>${esc(n)}</p>`).join('');
  const planLine = [
    res.pyf ? `<div><span>Paid yourself first</span><b class="up">${f(res.pyf)} invested</b></div>` : '',
    res.rebal ? `<div><span>Rebalanced</span><b>${res.rebal > 0 ? 'bought' : 'sold'} ${f(Math.abs(res.rebal))} index</b></div>` : '',
  ].join('');
  let verdict = '';
  if (res.fc) {
    const fc = res.fc;
    const o = fc.up ? 1 : 0;
    const realRet = fc.ret;
    verdict = `<div class="verdict-box">
      <span class="lbl">Your forecast</span>
      <p>You said <b>${pc(fc.p)}</b> that the index would beat inflation. It <b class="${o ? 'up' : 'down'}">${o ? 'did' : 'did not'}</b>: it returned ${E.pct(realRet, 1)} while prices rose ${pctS(fc.infl)}, so ${E.pct(fc.real, 1)} after inflation.</p>
      <p class="why">Score for this call: <b>${Math.pow(fc.p - o, 2).toFixed(2)}</b> (Brier: 0 is perfect, 0.25 is a coin flip). The careful answer, ${pc(fc.ideal)}, would have scored ${Math.pow(fc.ideal - o, 2).toFixed(2)}.</p>
    </div>`;
  }
  const moments = (res.moments || []).map((mo) => lessonHTML(mo.p, mo.text)).join('');
  const delta0 = res.nw1 - res.nw0;
  const W = A.WEATHER[res.state];
  openModal(`
    <div class="play">
      <div class="years">Age ${res.age0} → ${res.age1}</div>
      <div class="play-scene ${delta0 >= 0 ? 'rise' : 'fall'}">${sceneFor(run, { mood: res.state, expr: res.state === 'crash' ? 'shocked' : delta0 >= 0 ? 'cheer' : 'tired', label: `${W.word} over your town` })}</div>
      <div class="mood" style="--mc:${info.color}">${W.word.toUpperCase()}</div>
      <p class="mood-line">${esc(info.name)}: ${esc(info.line)}</p>
      ${res.path && run.learnMode ? '<canvas class="path" id="path"></canvas>' : ''}
      ${rows ? `<ul class="rows">${rows}</ul>` : '<p class="note" style="text-align:center">You had nothing invested. The market moved without you.</p>'}
      <div class="flows">${flows}${planLine}</div>
      ${notes ? `<div class="notes">${notes}</div>` : ''}
      <div class="big-nw"><span class="lbl">Net worth</span><b id="roll" class="${res.nw1 >= res.nw0 ? 'up' : 'down'}">${f(res.nw0)}</b></div>
      ${verdict}
      ${moments ? `<span class="lbl">What this year teaches</span>${moments}` : ''}
      <button class="btn primary wide" data-act="to-event">${res.quiet ? 'On to next year' : 'Continue'}</button>
    </div>`);
  const pc_ = document.getElementById('path');
  if (pc_) drawPath(pc_, res.path);
  const delta = res.nw1 - res.nw0;
  setTimeout(() => rollNumber(document.getElementById('roll'), res.nw0, res.nw1, 1000), 350);
  if (res.state === 'crash') { SFX.crash(); shake(); buzz([60, 40, 120]); } else if (delta >= 0) { SFX.gain(); } else { SFX.loss(); }
  if (delta > Math.abs(res.nw0) * 0.25 && delta > 0) setTimeout(() => coinBurst(50, innerWidth / 2, innerHeight * 0.75), 900);
}

function eventCast(id) {
  const [who, prop] = A.EVENT_ART[id] || ['anchor', 'tv'];
  const castId = who === 'guide' ? guideId() : who;
  const expr = who === 'hype' ? 'sly' : ['layoff', 'burnout', 'blacktax', 'theft', 'hack', 'flood'].includes(id) ? 'tired' : ['wedding', 'baby', 'inherit', 'bonus', 'promo', 'raise'].includes(id) ? 'cheer' : 'happy';
  const name = who === 'guide' ? guideName() : A.CAST[who].name;
  return { castId, prop, expr, name, hype: who === 'hype' };
}

function showEvent() {
  const v = E.eventView(run);
  if (!v) return showCards();
  const ec = eventCast(v.id);
  openModal(`
    <div class="ev-card ${ec.hype ? 'hype' : ''}">
      <div class="ev-art"><span class="ev-cast">${A.castFace(ec.castId, ec.expr, 110, ec.name)}</span><span class="ev-prop">${A.icon(ec.prop, 84, esc(v.title))}</span></div>
      <span class="kicker">${esc(ec.name)} · ${esc(v.cat)} · Age ${run.age}</span>
      <h2>${esc(v.title)}</h2>
      <p>${esc(v.text)}</p>
      ${ec.hype ? `<p class="hype-note">${A.icon('warn', 18, '')} You've seen this face before.</p>` : ''}
    </div>
    <div class="choices">${v.choices.map((c, i) => `<button class="choice-btn" data-act="choose" data-i="${i}" ${c.ok ? '' : 'disabled'}><b>${esc(c.label)}</b><small>${c.ok ? fxIcons(c.note) : 'Not enough cash'}</small></button>
      ${c.math ? `<button class="linkish math-btn" data-act="math" data-i="${i}">Show the maths</button><div class="math" id="math-${i}" hidden>${mathHTML(c.math)}</div>` : ''}`).join('')}</div>`);
}

function showOutcome(text) {
  const nw = E.netWorth(run);
  openModal(`
    <div class="ev-card"><span class="kicker">What happened</span><p class="outcome">${esc(text || 'Done.')}</p><p class="muted">Net worth now ${f(nw)} · Joy ${Math.round(run.joy)}</p></div>
    ${run.eventLesson ? lessonHTML(run.eventLesson) : ''}
    <button class="btn primary wide" data-act="to-cards">Pick a card</button>`);
}

const TYPE_COLOR = { Skill: 'var(--gain)', Tool: 'var(--sky)', Gamble: 'var(--orange)', Offer: 'var(--pink)', Legendary: 'var(--gold)' };

function cardHTML(c, act, extra = '') {
  const t = A.TYPE_ICON[c.type];
  return `<button class="gcard ${c.legendary ? 'legend' : ''} ${extra}" style="--tc:${TYPE_COLOR[c.type]}" ${act ? `data-act="${act}" data-id="${c.id}"` : 'disabled'}>
    <span class="card-pic">${A.cardPic(c.id, 64)}</span>
    <span class="card-body"><span class="ty">${t === 'hype' ? A.icon('warn', 14, '') : A.icon(t, 14, '')} ${esc(c.type)}</span><b>${esc(c.name)}</b><p>${fxIcons(c.text)}</p></span></button>`;
}

function showCards() {
  if (run.quiet) { run.quiet = false; takeCard(''); return; }
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
  if (run.quiz) { showQuiz(); return; }
  startTimer();
  const nwEl = document.getElementById('nw');
  if (nwEl) nwEl.animate?.([{ transform: 'scale(1.12)' }, { transform: 'none' }], { duration: 300 });
}

// ------------------------------------------------------------------ timer

let timerRaf = 0;
let timerEnd = 0;
function timerSeconds() {
  if (!run || run.phase !== 'alloc') return 0;
  if (E.MODES[run.mode].timer) return P.settings.noBlitzTimer ? 0 : E.MODES[run.mode].timer;
  return P.settings.timer && !run.learnMode ? 20 : 0;
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
      if (run && run.phase === 'alloc') { toast('The market doesn\'t wait.'); nextTurn(true); }
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
  P.principles = [...new Set([...(P.principles || []), ...(res.seenP || [])])];
  P.fcAll = [...(P.fcAll || []), ...run.fc.map((x) => ({ p: x.p, ideal: x.ideal, up: x.up }))].slice(-400);
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
  if (done.mode === 'daily') return `Tycoon Rush Daily ${done.seed.replace('daily-', '')}\n${E.emojiGrid(done)}\n${outcome} · Score ${r.score.toLocaleString()}\n${GAME_URL}`;
  if (done.mode === 'duel') return `Tycoon Rush duel ${done.seed.replace('duel-', '')}: ${outcome}, score ${r.score.toLocaleString()}. Same market, can you beat me?\n${E.emojiGrid(done)}\n${GAME_URL}`;
  return `Tycoon Rush: ${outcome}, score ${r.score.toLocaleString()}.\n${E.emojiGrid(done)}\n${GAME_URL}`;
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
  const lessonBubble = guideSay(esc(LESSONS[r.lesson]), won(r) ? 'cheer' : 'happy');
  if (r.earlier > 0) insights.push(['var(--sky)', 'Compound growth', `Starting just 4 years earlier would have grown your investments by about ${F(r.earlier)} more (${pctS(r.annual)} a year).`]);
  const share = ['daily', 'duel'].includes(done.mode) || r.reason === 'free';
  const text = shareText(done);
  app.innerHTML = `
  <main class="results">
    <button class="home-pill" data-act="home" aria-label="Home screen">‹ ${A.icon('house', 20, '')}<span>Home</span></button>
    <span class="kicker">${esc(E.MODES[done.mode].name)} · ${esc(CHARACTERS[done.char].name)}${done.asc ? ` · Ascension ${done.asc}` : ''}</span>
    <div class="res-scene">${resultScene(done)}</div>
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
    ${lessonBubble}
    ${insights.map(([c, k, t]) => `<div class="insight" style="--ic:${c}"><span class="lbl">${k}</span><p>${esc(t)}</p></div>`).join('')}
    ${learnResults(r)}
    ${r.scammed ? `<div class="scam-card"><span class="kicker" style="color:var(--pink)">How to spot a scam</span><ol>${SCAM_TIPS.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div>` : ''}
    <div class="insight" style="--ic:var(--violet)"><span class="lbl">Wisdom earned</span><p><b>+${r.gained}</b>${r.newTerms.length ? ` · new words: ${r.newTerms.map((t) => esc(GLOSSARY[t][0])).join(', ')}` : ''}</p>
      ${r.unlocks.length ? `<div class="unlock-list">${r.unlocks.map((u) => `<span>${esc(u)}</span>`).join('')}</div>` : ''}</div>
    ${share ? `<div class="share"><span class="lbl">Share</span><pre id="share-text">${esc(text)}</pre>
      <div class="share-actions"><button class="btn small" data-act="copy">Copy</button><a class="btn small" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">WhatsApp</a></div></div>` : ''}
    <button class="btn primary wide" data-act="report">${A.icon('payslip', 24, '')} Get my PDF report</button>
    <div class="share-actions">
      <button class="btn" data-act="feedback">${A.icon('envelope', 22, '')} Send feedback</button>
      <button class="btn" data-act="share-game">${A.icon('phone', 22, '')} Invite a friend</button>
    </div>
    <div class="share-actions">
      <button class="btn primary" data-act="again">Play again</button>
      <button class="btn" data-act="home">Home</button>
    </div>
  </main>`;
  window.scrollTo(0, 0);
  requestAnimationFrame(() => {
    drawChart(document.getElementById('chart'), r.hist, cur);
    const cc = document.getElementById('calib');
    if (cc && r.forecast) drawCalib(cc, r.forecast.buckets);
  });
}

const won = (r) => r.reason === 'free' || r.reason === 'target';

function resultScene(done) {
  const r = done.result;
  const opts = r.reason === 'free' ? { stage: 4, mood: 'boom', expr: 'cheer', label: 'You relax on the beach, free' }
    : r.reason === 'bankrupt' ? { stage: 0, mood: 'crash', expr: 'shocked', label: 'An empty room after going broke' }
      : r.reason === 'target' ? { mood: 'recov', expr: 'cheer', label: 'You came through the storm' }
        : { mood: 'steady', expr: 'tired', label: 'Still working' };
  return sceneFor(done, opts);
}

function forecastVerdict(fs) {
  if (fs.brier < fs.ideal + 0.02) return 'As sharp as the careful Bayesian answer. Excellent.';
  if (fs.brier < 0.19) return 'Better than base rates alone. You are reading the evidence.';
  if (fs.brier < 0.25) return 'Better than a coin flip, but the lens would have helped more.';
  return 'Worse than a coin flip. Start from the base rate, then adjust a little for each headline.';
}

function learnResults(r) {
  const out = [];
  if (r.aim) out.push(`<div class="insight" style="--ic:var(--orange)"><span class="lbl">Chief aim (Think and Grow Rich)</span><p>${r.aimMet ? `Free by ${r.aim}, as you wrote down. Aim met: +300 points.` : `You aimed for freedom by ${r.aim}. ${r.reason === 'free' ? `You got there at ${r.age}.` : 'Not this time.'} Hill would say: keep the aim, fix the plan.`}</p></div>`);
  const fs = r.forecast;
  if (fs) out.push(`<div class="insight" style="--ic:var(--violet)"><span class="lbl">Your forecasting</span>
    <p>${fs.n} forecasts. Your Brier score: <b>${fs.brier.toFixed(3)}</b>. A coin flip scores 0.250; the careful Bayesian answer scored ${fs.ideal.toFixed(3)}. ${forecastVerdict(fs)}</p>
    <canvas class="calib" id="calib"></canvas>
    <p class="why">Dots on the dashed line mean well calibrated: things you called 70% happened about 70% of the time. Dots below the line mean overconfidence.</p></div>`);
  if (r.learnMode) {
    out.push(`<div class="insight" style="--ic:var(--gold)"><span class="lbl">Arkad's seven cures</span>
      <div class="cure-list">${CURE_IDS.map((id, i) => `<div><span class="stone ${r.cureYears[i] >= r.years / 2 ? 'on' : ''}">${i + 1}</span><span><b>${CURE_NAMES[i]}</b><p>Kept ${r.cureYears[i]} of ${r.years} years</p></span></div>`).join('')}</div></div>`);
    if (r.quizAsked) out.push(`<div class="insight" style="--ic:var(--sky)"><span class="lbl">Mentor's questions</span><p>${r.quizRight} of ${r.quizAsked} right.</p></div>`);
  }
  if (r.seenP && r.seenP.length) out.push(`<div class="insight" style="--ic:var(--gain)"><span class="lbl">Principles met this run</span><div class="unlock-list">${r.seenP.map((id) => `<span>${esc(PRINCIPLES[id].title)}</span>`).join('')}</div></div>`);
  return out.join('');
}

// ------------------------------------------------------------------ other pages

function page(title, body, back = 'home') {
  stopTimer();
  closeLayer();
  const backBtn = back === 'home'
    ? `<button class="home-pill" data-act="home" aria-label="Home screen">‹ ${A.icon('house', 20, '')}<span>Home</span></button>`
    : `<button class="icon-btn" data-act="${back}" aria-label="Back">‹</button>`;
  const homeRight = back !== 'home' && P.onboarded ? `<button class="home-pill page-home" data-act="home" aria-label="Home screen">${A.icon('house', 20, '')}<span>Home</span></button>` : '';
  app.innerHTML = `<main class="page"><header class="page-h">${backBtn}<h1>${esc(title)}</h1>${homeRight}</header>${body}</main>`;
  window.scrollTo(0, 0);
}

function eras() {
  page('Eras', `
    <p class="muted">Replay famous crises with fictional names. Finish with your target multiple of yearly costs, or reach freedom first.</p>
    <div class="choice-list">${ERAS.map((e) => {
    const locked = e.unlock > P.wisdom;
    const best = P.eras[e.id];
    return `<button class="choice ${locked ? 'locked' : ''}" data-act="era" data-id="${e.id}" ${locked ? 'disabled' : ''}>
      <span class="av">${A.icon('clock', 36, '')}</span>
      <span><b>${esc(e.name)} <span class="muted" style="font-weight:500">· ${esc(e.years)}</span></b>
      <small>${locked ? `Unlocks at ${e.unlock} wisdom` : esc(e.blurb)}${best ? ` · Best ${best.score.toLocaleString()}${best.won ? ' ✓' : ''}` : ''}</small></span></button>`;
  }).join('')}</div>`);
}

function randomCode() {
  const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPH[Math.floor(Math.random() * ALPH.length)];
  return `${(CURRENCIES[P.settings.currency] || CURRENCIES.NGN).duel}${s}`;
}

function duel(code) {
  const c = code || randomCode();
  const past = Object.entries(P.duels).slice(-5).reverse();
  page('Duel', `
    <p class="muted">Everyone who plays the same code gets the same market, events and cards. Send the code to friends and compare scores.</p>
    <section class="field"><label class="lbl" for="code">Duel code</label><input class="text-in" id="code" maxlength="6" value="${esc(c)}" autocomplete="off" spellcheck="false"></section>
    <div class="share-actions"><button class="btn" data-act="duel-new">New code</button><button class="btn" data-act="duel-copy">Copy code</button></div>
    <p class="note">The first letter picks the money (N naira, D dollars, I rupees, K shillings…). Everyone plays The Graduate with the base cards.</p>
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
    body = `<div class="choice-list">${Object.values(CHARACTERS).filter((c) => !c.custom).map((c) => `<div class="choice ${c.unlock > P.wisdom ? 'locked' : ''}"><span class="av">${A.avatar(P.look, Object.keys(CHARACTERS).find((k) => CHARACTERS[k] === c), { size: 44, label: '' })}</span><span><b>${esc(c.name)}</b><small>${c.unlock > P.wisdom ? `Unlocks at ${c.unlock} wisdom` : esc(c.blurb)}</small></span></div>`).join('')}</div>`;
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

function library() {
  const learned = P.principles || [];
  const total = Object.keys(PRINCIPLES).length;
  const fs = E.forecastStats(P.fcAll || []);
  const books = Object.entries(BOOKS).map(([bid, b]) => {
    const ps = Object.entries(PRINCIPLES).filter(([, pr]) => pr.book === bid);
    const got = ps.filter(([id]) => learned.includes(id)).length;
    return `<div class="book-card" style="--bc:${b.color}">
      <h2>${esc(b.title)}</h2><span class="by">${esc(b.author)}${b.year ? `, ${b.year}` : ''} · ${got}/${ps.length} met in play</span>
      <p class="muted">${esc(b.blurb)}</p>
      <div class="plist">${ps.map(([id, pr]) => `<button class="${learned.includes(id) ? '' : 'off'}" data-act="principle" data-id="${id}"><span>${esc(pr.title)}</span><span>${learned.includes(id) ? '✓' : '▸'}</span></button>`).join('')}</div>
    </div>`;
  }).join('');
  page('Library', `
    <p class="muted">The game is built on these books. You meet each idea when it happens to you in play; tap any one to read it now.</p>
    <div class="score-box"><span class="lbl">Principles met</span><b>${learned.length}/${total}</b></div>
    ${fs ? `<div class="insight" style="--ic:var(--violet)"><span class="lbl">Your forecasting, all runs</span><p>${fs.n} forecasts · Brier ${fs.brier.toFixed(3)} (coin flip 0.250, careful Bayesian ${fs.ideal.toFixed(3)}). ${forecastVerdict(fs)}</p><canvas class="calib" id="calib"></canvas></div>` : ''}
    <div class="books">${books}</div>`);
  const cc = document.getElementById('calib');
  if (cc && fs) requestAnimationFrame(() => drawCalib(cc, fs.buckets));
}

function glossarySheet() {
  const learned = Object.keys(GLOSSARY).filter((k) => P.glossary.includes(k) || (run && run.learned.includes(k)));
  openSheet(`${sheetHead('', 'Words you have learned')}<div class="gloss">${learned.map((k) => `<div><b>${esc(GLOSSARY[k][0])}</b><p>${esc(GLOSSARY[k][1])}</p></div>`).join('')}</div><button class="btn wide" data-act="close">Close</button>`);
}

function how() {
  page('How to play', `
    <p><b>New here? Start with the Wisdom Journey.</b> It goes one year at a time and teaches as you play.</p>
    <ol class="how">
      <li><b>Think.</b> The probability lens shows base rates: how often each market mood follows the last one. Headlines are evidence, right 80% of the time.</li>
      <li><b>Forecast.</b> Say how likely the index is to beat inflation. After you commit, you see the careful answer, and every forecast is scored.</li>
      <li><b>Plan.</b> Pay yourself first, pick a Graham-style mix, and switch on rebalancing. The plan runs every year, even when you are scared.</li>
      <li><b>Review.</b> After each year, a mentor points out what it teaches, from Babylon, Rich Dad, Graham, Hill, Housel or probability.</li>
    </ol>
    <p class="lbl">The basics, in every mode</p>
    <ol class="how">
      <li>Each turn is one to four years of your life. Your salary lands, your living costs go out, and whatever is left sits in cash.</li>
      <li>Read the three headlines. Most hint at what the next two years hold. Some are noise, and some are scams.</li>
      <li>Tap an asset to move cash into it or out of it. Each one behaves differently in booms and crashes.</li>
      <li>Press <b>Live 2 years</b>. Markets move, rent and profits arrive, and life throws you one event with a choice.</li>
      <li>Pick one of three cards. Skills, tools and gambles stack into combos.</li>
      <li>You win when passive income covers your living costs. You lose if you are broke for four years in a row, or reach 60 still working.</li>
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
    ${row('noBlitzTimer', 'No clock in Blitz', 'Take your time, even in Blitz.')}
    ${row('calm', 'Reduce motion', 'No shaking, bursts or rolling numbers.')}
    <section class="field"><label class="lbl" for="cur">Your money</label><select id="cur" class="select">${Object.entries(CURRENCIES).map(([id, c]) => `<option value="${id}" ${s.currency === id ? 'selected' : ''}>${esc(c.sym.trim())} ${esc(c.name)}</option>`).join('')}</select></section>
    <div class="share-actions"><button class="btn" data-act="region-screen">${A.icon('map', 22, '')} Region</button><button class="btn" data-act="look-screen">${A.icon('smile', 22, '')} My look</button></div>
    <button class="btn wide" data-act="replay-intro">Watch the intro again</button>
    <div class="hr"></div>
    ${confirmReset ? `<p>This erases your wisdom, unlocks, records and any saved run.</p><div class="share-actions"><button class="btn danger" data-act="reset-yes">Erase everything</button><button class="btn" data-act="settings">Keep my progress</button></div>`
    : '<button class="btn danger wide" data-act="reset">Reset progress</button>'}
    <p class="note">Progress is saved on this device only. The game works offline once it has loaded.</p>`);
}

function dailyScreen() {
  const key = today();
  const rec = P.daily[key];
  if (!rec) {
    return startRun({ mode: 'daily', char: 'graduate', currency: P.settings.currency, seed: `daily-${key}` });
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

// ------------------------------------------------------------------ install as an app
//
// Anyone who opens the link in a browser is offered the home-screen app, the
// same full-screen, offline game the owner has installed. Chrome and Edge give
// a one-tap install; iPhones only allow Share > Add to Home Screen, so we show
// those steps; Android in-app browsers (WhatsApp, Facebook) can't install, so
// we offer to reopen the link in Chrome.

let installEvt = null;
const UA = navigator.userAgent;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/.test(UA);
const inAppBrowser = () => /FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|TikTok|; wv\)/.test(UA);
const INSTALL_SNOOZE_MS = 3 * 864e5;

function installSheet() {
  if (standalone()) return;
  const chrome = `intent://${location.host}${location.pathname}#Intent;scheme=https;package=com.android.chrome;end`;
  let body;
  if (installEvt) {
    body = `<button class="btn primary wide" data-act="install">${A.icon('phone', 22, '')} Install Tycoon Rush</button>`;
  } else if (isIOS()) {
    body = `${inAppBrowser() ? '<p class="note">First open this page in <b>Safari</b> (tap ⋯ or the compass, then Open in Safari).</p>' : ''}
      <ol class="install-steps"><li>Tap <b>Share</b> <span class="ios-share" aria-hidden="true">⬆</span> at the bottom of Safari</li><li>Scroll down and tap <b>Add to Home Screen</b></li><li>Tap <b>Add</b></li></ol>`;
  } else if (isAndroid()) {
    body = `<a class="btn primary wide" href="${chrome}">${A.icon('phone', 22, '')} Open in Chrome to install</a>
      <ol class="install-steps"><li>In Chrome, tap the menu <b>⋮</b> at the top right</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b></li></ol>`;
  } else {
    body = '<ol class="install-steps"><li>Open your browser menu</li><li>Choose <b>Install app</b> or <b>Add to Home screen</b></li></ol>';
  }
  openSheet(`<div data-install>${sheetHead('', 'Get the app')}
    ${guideSay('Put Tycoon Rush on your home screen. It opens full screen like an app and works with no internet.')}
    ${body}
    <button class="btn ghost wide" data-act="install-later">Not now</button></div>`);
}

function offerInstall() {
  if (standalone() || (P.installLater && Date.now() - P.installLater < INSTALL_SNOOZE_MS)) return;
  // Give Chrome a moment to announce that one-tap install is available.
  setTimeout(() => { if (!standalone() && !layer.innerHTML.trim()) installSheet(); }, 1500);
}

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
  if (layer.querySelector('[data-install]')) installSheet();
});
addEventListener('appinstalled', () => {
  installEvt = null;
  if (layer.querySelector('[data-install]')) closeLayer();
  toast('Installed! Open Tycoon Rush from your home screen.');
});

// ------------------------------------------------------------------ actions

const ACT = {
  'get-app': () => installSheet(),
  install: async () => {
    if (!installEvt) return installSheet();
    const evt = installEvt;
    installEvt = null;
    evt.prompt();
    const choice = await evt.userChoice.catch(() => null);
    closeLayer();
    if (!choice || choice.outcome !== 'accepted') { P.installLater = Date.now(); saveProfile(); }
  },
  'install-later': () => { P.installLater = Date.now(); saveProfile(); closeLayer(); },
  home: () => { persist(); home(); },
  resume: () => resume(),
  setup: (d) => setup(d.mode),
  'pick-char': (d) => { P.setup.char = d.id; saveProfile(); setup(); },
  cur: (d) => { P.settings.currency = d.id; saveProfile(); setup(); },
  asc: (d) => { P.setup.asc = clamp(P.setup.asc + Number(d.d), 0, P.maxAsc); saveProfile(); setup(); },
  start: () => {
    const real = P.start === 'me' && ['journey', 'classic', 'blitz'].includes(setupMode);
    if (real && num(P.me.costs) <= 0) { toast('Add your monthly living costs first.'); document.getElementById('me-costs')?.focus(); return; }
    startRun({
      mode: setupMode, char: P.setup.char, currency: P.settings.currency,
      asc: setupMode === 'classic' && !real ? Math.min(P.setup.asc, P.maxAsc) : 0,
      aim: real ? null : setupMode === 'journey' ? P.setup.aim : null,
      me: real ? { ...P.me, age: meAge() } : null,
    });
  },
  'start-as': (d) => { P.start = d.v; saveProfile(); setup(); },
  aim: (d) => { P.setup.aim = Number(d.v); saveProfile(); setup(); },
  intro: (d) => intro(Number(d.step)),
  'region-screen': () => regionScreen(),
  region: (d) => { P.region = d.id; P.settings.currency = REGIONS[d.id].currencies[0]; saveProfile(); SFX.tap(); regionScreen(); },
  'look-screen': () => { if (!P.region) P.region = 'westafrica'; lookScreen(); },
  look: (d) => { P.look[d.k] = d.k === 'hair' ? d.v : Number(d.v); saveProfile(); SFX.tap(); lookScreen(); },
  'look-done': () => { if (!P.region) P.region = 'westafrica'; P.onboarded = true; saveProfile(); SFX.card(); home(); },
  term: (d) => termSheet(d.id),
  'share-game': () => shareGame(),
  report: () => reportSheet(lastDone),
  'report-now': () => reportSheet(run),
  'report-download': () => downloadReport(),
  'report-share': () => shareReport(),
  feedback: () => feedbackSheet(),
  'fb-rate': (d) => {
    fb.rate = Number(d.v);
    document.querySelectorAll('.fb-face').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === fb.rate));
    updateFeedbackLink();
  },
  'fb-tag': (d, el) => {
    fb.tags = fb.tags.includes(d.t) ? fb.tags.filter((t) => t !== d.t) : [...fb.tags, d.t];
    el.classList.toggle('on', fb.tags.includes(d.t));
    updateFeedbackLink();
  },
  prices: () => pricesSheet(),
  town: () => townSheet(),
  library: () => library(),
  principle: (d) => principleSheet(d.id),
  statement: () => statementSheet(),
  cures: () => curesSheet(),
  lens: () => { P.settings.lens = !P.settings.lens; saveProfile(); renderGame(); },
  fc: (d) => {
    if (run.learnMode && run.forecast != null) return;
    if (E.setForecast(run, Number(d.p))) { SFX.tap(); persist(); renderGame(); const t = document.querySelector('.think'); if (t && run.learnMode) t.scrollIntoView({ block: 'nearest' }); }
  },
  pyf: (d) => { if (E.setPlan(run, { pyf: Number(d.v) })) { SFX.tap(); persist(); renderGame(); } },
  mix: (d) => { if (E.setPlan(run, { mix: d.k })) { SFX.tap(); persist(); renderGame(); } },
  rebal: () => { if (E.setPlan(run, { rebalance: !run.plan.rebalance })) { SFX.tap(); persist(); renderGame(); } },
  math: (d) => { const el = document.getElementById(`math-${d.i}`); if (el) el.hidden = !el.hidden; },
  quiz: (d) => {
    const q = E.quizView(run);
    const out = E.answerQuiz(run, Number(d.i));
    if (!out) return;
    persist();
    if (out.right) { SFX.gain(); coinBurst(30); } else SFX.loss();
    openModal(`
      <div class="ev-card"><span class="kicker">${out.right ? 'Correct' : 'Not quite'}</span><p class="outcome">${esc(q.q)}</p>
        <div class="choices">${q.opts.map((o) => `<div class="quiz-opt ${o === out.correct ? 'right' : ''} ${o === q.opts[Number(d.i)] && !out.right ? 'wrong' : ''}">${esc(o)}</div>`).join('')}</div>
        <p>${esc(out.why)}</p>${out.right ? `<p class="up">+${f(0.05 * run.salary)} and +3 joy from your mentor.</p>` : ''}</div>
      ${lessonHTML(out.p)}
      <button class="btn primary wide" data-act="quiz-done">Continue</button>`);
  },
  'quiz-done': () => { closeLayer(); renderGame(); startTimer(); },
  daily: () => dailyScreen(),
  'replay-intro': () => { P.onboarded = false; saveProfile(); intro(0); },
  weekly: () => startRun({ mode: 'weekly', char: 'graduate', currency: P.settings.currency, challengeId: weeklyChallenge().id, seed: `week-${weekNo()}` }),
  eras: () => eras(),
  era: (d) => startRun({ mode: 'era', char: 'graduate', eraId: d.id }),
  duel: () => duel(),
  'duel-new': () => duel(randomCode()),
  'duel-copy': () => { const v = document.getElementById('code').value.trim().toUpperCase(); copyText(`Play my Tycoon Rush duel: code ${v}\n${GAME_URL}`); },
  'duel-go': () => {
    const v = (document.getElementById('code').value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (v.length < 3) { toast('Enter a code of at least 3 letters.'); return; }
    const cur = Object.keys(CURRENCIES).find((c) => CURRENCIES[c].duel === v[0]) || 'NGN';
    startRun({ mode: 'duel', char: 'graduate', currency: cur, seed: `duel-${v}` });
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
  else if (run.quiz) showQuiz();
  else startTimer();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act];
  if (fn) fn(el.dataset, el, e);
});
document.addEventListener('input', (e) => {
  if (e.target.dataset && e.target.dataset.me) {
    P.me[e.target.dataset.me] = e.target.value === '' ? 0 : Number(e.target.value);
    saveProfile();
    const pv = document.getElementById('me-preview');
    if (pv) pv.innerHTML = mePreview();
    // The "I live in it" and "runs without me" boxes show once there is an amount.
    const ec = document.getElementById(`echo-${e.target.dataset.me}`);
    if (ec && !['age', 'aim'].includes(e.target.dataset.me)) ec.textContent = echo(e.target.value);
    const box = document.getElementById(`box-${e.target.dataset.me}`);
    if (box) box.hidden = !(Number(e.target.value) > 0);
    const go = document.querySelector('[data-act=start]');
    if (go && e.target.dataset.me === 'age') go.innerHTML = `${A.icon('play', 24, '')} Start at ${meAge()}`;
  }
  if (e.target.id === 'fb-text') updateFeedbackLink();
  if (e.target.id === 'amt') { if (sheetCtx && sheetCtx.id === 'prop') updatePropSlider(); else updateSlider(); }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'mort') updatePropSlider();
  if (e.target.id === 'me-bizManaged') { P.me.bizManaged = e.target.checked; saveProfile(); }
  if (e.target.id === 'me-liveIn') { P.me.liveIn = e.target.checked; saveProfile(); const pv = document.getElementById('me-preview'); if (pv) pv.innerHTML = mePreview(); }
  if (e.target.id === 'cur') { P.settings.currency = e.target.value; saveProfile(); if (app.querySelector('.char-strip')) setup(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && layer.querySelector('.sheet')) closeLayer(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
addEventListener('resize', () => { if (run && run.phase === 'alloc') drawSparks(); });

applyCalm();
home();
offerInstall();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  // When a new version takes over an open game, reload once so the player
  // sees it now rather than on the next launch. Progress is saved first.
  // A first-ever install has no previous controller, so it doesn't reload.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    persist();
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .then((reg) => reg.update())
    .catch(() => { /* no offline cache here; the game still runs */ });
}
