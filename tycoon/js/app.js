// Tycoon Rush screens. Plain DOM: each screen renders into #app, and sheets and
// modals render into #layer. All game rules live in engine.js.

import * as E from './engine.js';
import {
  CURRENCIES, LIFESTYLES, CHARACTERS, ASSETS, COMPANIES, STATE_INFO, SWANS, CARDS,
  ERAS, CHALLENGES, ASCENSION, GLOSSARY, SCAM_TIPS, LESSONS, TIPS, REGIONS, PROFILE_BLURB,
  HOMES, HOME_ORDER, DISTRICTS, DISTRICT_ORDER, CARS, CAR_ORDER, PARTNERS, SCHOOLS, SCHOOL_ORDER, KID_OUTCOMES,
  WORLD_RULES, CIRCLE_TYPES, FAITHS, ZONE_TYPES, ZONE_ORDER, COUNTRIES, TITLES, GOLDEN,
} from './content.js';
import * as A from './art.js';
import { buildReport } from './report.js';
import { BOOKS, PRINCIPLES, PLANS, AIMS } from './learn.js';
import { CHAPTERS, CAST as STORY_CAST } from './story.js';

const app = document.getElementById('app');
const layer = document.getElementById('layer');
const fxCanvas = document.getElementById('fx');

// ------------------------------------------------------------------ profile

const KEY = 'tycoonrush.v1';
const DEFAULTS = {
  wisdom: 0, runs: 0, best: 0, freedoms: 0, bestAge: null, maxAsc: 0,
  glossary: [], scamLesson: false, daily: {}, weekly: {}, duels: {}, eras: {},
  principles: [], fcAll: [],
  settings: { sound: true, timer: false, currency: 'NGN', calm: false, lens: false, autoplay: true, reminders: false },
  setup: { char: 'graduate', asc: 0, aim: 45 },
  onboarded: false, region: null, look: { skin: 3, hair: 'short', hairColor: 0, outfit: 0, sex: 'm', build: 'average', wear: 'none', hijab: false, beard: false },
  start: 'story',
  me: { age: 25, pay: 0, costs: 0, cash: 0, save: 0, index: 0, stocks: 0, crypto: 0, fx: 0, prop: 0, mortgage: 0, biz: 0, bizManaged: false, liveIn: true, debt: 0, aim: 45, goal: 0, home: 'studio', district: 'suburb', car: 'none' },
  // Under 16 is a protected mode; 16+ turns on the full set of pull-you-back techniques.
  ageMode: null, faith: 'none', sprintDone: false,
  trophies: { homes: [], cars: [], districts: [], zones: [], golden: [] },
  streak: { n: 0, last: null, best: 0, skipWeek: null },
  board: {}, gen: 1, heir: null, newsPack: null,
  run: null,
};
let P = loadProfile();
let run = E.upgradeRun(P.run);
const adult = () => P.ageMode === 'adult';
const myLook = () => (run && run.look) || P.look;

function loadProfile() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { saved = null; }
  const p = { ...DEFAULTS, ...(saved || {}) };
  p.settings = { ...DEFAULTS.settings, ...(p.settings || {}) };
  p.setup = { ...DEFAULTS.setup, ...(p.setup || {}) };
  p.look = { ...DEFAULTS.look, ...(p.look || {}) };
  p.me = { ...DEFAULTS.me, ...(p.me || {}) };
  p.trophies = { ...DEFAULTS.trophies, ...(p.trophies || {}) };
  p.streak = { ...DEFAULTS.streak, ...(p.streak || {}) };
  p.board = p.board || {};
  // Players who already finished a game skip the first-run Sprint.
  if (saved && saved.runs > 0 && saved.sprintDone == null) p.sprintDone = true;
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
const needsForecast = () => false;

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
    <div class="look-preview">${A.avatar(l, P.setup.char || 'graduate', { age: 22, expr: 'cheer', size: 180, label: 'Your character', style: 2 })}</div>
    <section class="field"><span class="lbl">Skin</span><div class="swatches">${swatch('skin', A.SKINS)}</div></section>
    <section class="field"><span class="lbl">Hair</span><div class="hair-grid">${A.HAIRS.map((h) => `<button class="hair-btn ${l.hair === h ? 'on' : ''}" data-act="look" data-k="hair" data-v="${h}" aria-label="${h}">${A.person({ skin: A.SKINS[l.skin], hair: h, hairColor: A.HAIR_COLORS[l.hairColor || 0], outfit: A.OUTFITS[l.outfit], accent: A.OUTFITS[(l.outfit + 2) % 6], expr: 'happy' }, { size: 56 })}</button>`).join('')}</div></section>
    <section class="field"><span class="lbl">Hair colour</span><div class="swatches">${swatch('hairColor', A.HAIR_COLORS.slice(0, 4))}</div></section>
    <section class="field"><span class="lbl">Clothes colour</span><div class="swatches">${swatch('outfit', A.OUTFITS)}</div></section>
    <section class="field"><span class="lbl">You are</span><div class="seg"><button class="${l.sex !== 'f' ? 'on' : ''}" data-act="look" data-k="sex" data-v="m">A man</button><button class="${l.sex === 'f' ? 'on' : ''}" data-act="look" data-k="sex" data-v="f">A woman</button></div><span class="note">Used for your partner in the game: a wife for a man, a husband for a woman.</span></section>
    <section class="field"><span class="lbl">Build</span><div class="seg">${A.BUILDS.map((b) => `<button class="${(l.build || 'average') === b ? 'on' : ''}" data-act="look" data-k="build" data-v="${b}">${b[0].toUpperCase() + b.slice(1)}</button>`).join('')}</div></section>
    <section class="field"><span class="lbl">Dress</span><div class="seg wrap-seg">${A.WEARS.map((w) => `<button class="${(l.wear || 'none') === w ? 'on' : ''}" data-act="look" data-k="wear" data-v="${w}">${esc(A.WEAR_NAMES[w])}</button>`).join('')}</div><span class="note">How smart you look still follows your money: from a plain T-shirt to designer.</span></section>
    <section class="field"><div class="seg"><button class="${l.hijab ? 'on' : ''}" data-act="look" data-k="hijab" data-v="${l.hijab ? '' : '1'}">Hijab ${l.hijab ? '✓' : ''}</button><button class="${l.beard ? 'on' : ''}" data-act="look" data-k="beard" data-v="${l.beard ? '' : '1'}" ${l.sex === 'f' ? 'disabled' : ''}>Beard ${l.beard ? '✓' : ''}</button></div></section>
    <div class="sticky-go"><button class="btn primary wide" data-act="look-done">${P.onboarded ? 'Save' : 'Start playing'}</button></div>`, 'region-screen');
}

// ------------------------------------------------------------------ home

function ageScreen() {
  page('Before you play', `
    ${guideSay('One quick question. It changes how the game treats your time, never the money lessons.')}
    <div class="choice-list">
      <button class="choice ${P.ageMode === 'u16' ? 'on' : ''}" data-act="age-mode" data-v="u16"><span class="av">${A.icon('shield', 40, '')}</span><span><b>Under 16</b><small>No streak losses, no reminders, no autoplay, no endless play, no "a friend passed you" alerts, and a break reminder after 45 minutes.</small></span></button>
      <button class="choice ${P.ageMode === 'adult' ? 'on' : ''}" data-act="age-mode" data-v="adult"><span class="av">${A.icon('flame', 40, '')}</span><span><b>16 or over</b><small>The full game: autoplay, daily streaks with rewards, mystery envelopes, weekend events, endless play as your children, and optional reminders.</small></span></button>
    </div>
    <p class="note">You can change this later in Settings.</p>`, P.onboarded && P.ageMode ? 'settings' : 'home');
}

function msToMidnight() {
  const d = new Date();
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  const mins = Math.max(0, Math.round((m - d) / 60000));
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function home() {
  stopTimer();
  closeLayer();
  if (!P.onboarded) return intro(0);
  if (!P.ageMode) return ageScreen();
  run = E.upgradeRun(P.run);
  const daily = P.daily[today()];
  const wk = weeklyChallenge();
  const wkDone = P.weekly[weekNo()];
  const resume = run && run.phase !== 'done'
    ? `<button class="continue" data-act="resume"><span class="c-face">${A.avatar(myLook(), run.char, { age: run.age, expr: 'happy', size: 52, label: '', style: run.life })}</span><span><span class="kicker">Continue</span><b>${esc(E.MODES[run.mode].name)} · Age ${run.age}</b><span class="muted">${run.teaser ? esc(run.teaser) : `${f(E.netWorth(run))} owned`}</span></span><span class="kicker">▶</span></button>` : '';
  const boardN = Object.values(P.board).reduce((s, x) => s + x.length, 0);
  const more = [
    ['daily', 'calendar', 'Daily Market', daily ? `Done ✓ · new in ${msToMidnight()}` : `Ends in ${msToMidnight()}`],
    ['duel', 'swords', 'Duel', 'Play a friend\'s market'],
    ['board', 'trophy', 'Friends board', boardN ? `${boardN} result${boardN > 1 ? 's' : ''}` : 'Scores your friends send'],
    ['eras', 'clock', 'Eras', 'Famous booms and busts'],
    ['blitz', 'bolt', 'Blitz', '15 seconds a turn'],
    ['weekly', 'trophy', `Weekly: ${wk.name}`, wkDone != null ? 'Badge earned ✓' : wk.text],
    ['library', 'book', 'Library', 'The books behind the game'],
    ['collection', 'star', 'Collection', 'Cards, people, words'],
  ];
  const first = !P.sprintDone;
  const streak = P.streak.n > 0 ? `<button class="streak" data-act="daily" aria-label="Daily streak ${P.streak.n} days">${A.icon('flame', 26, '')}<b>${P.streak.n}</b><small>day${P.streak.n > 1 ? 's' : ''}${adult() && streakBoost() > 0 ? ` · +${Math.round(streakBoost() * 100)}% starting cash` : ''}</small></button>` : '';
  app.innerHTML = `
  <main class="home">
    <div class="home-scene">${A.homeScene({ home: P.freedoms > 0 ? 'house' : 'studio', district: P.freedoms > 0 ? 'upscale' : 'suburb', car: P.freedoms > 0 ? 'saloon' : 'none', mood: 'boom', family: [{ look: P.look, age: 24, expr: 'cheer', style: 2, sex: P.look.sex }], beach: !!P.bestAge && P.freedoms > 2 }, { label: 'Your home' })}</div>
    <header class="brand">
      <div class="logo">TYCOON<span>RUSH</span></div>
      <p class="tag">You have one life. Make your money work before your time runs out.</p>
    </header>
    ${adult() && isWeekend() ? `<div class="chip-line" style="border-color:var(--gold);color:var(--gold)">${A.icon('sparkle', 22, '')} <b>Boom Weekend:</b> golden events are three times as likely until Monday.</div>` : ''}
    ${streak}
    ${resume}
    ${first
    ? `<button class="play-big" data-act="sprint">${A.icon('play', 60, '')}<span><b>Play</b><small>Your first ten years · about 5 minutes</small></span></button>`
    : `<button class="play-big" data-act="setup" data-mode="journey">${A.icon('play', 60, '')}<span><b>Play</b><small>A whole life, one year at a time</small></span></button>
    <button class="btn wide" data-act="setup" data-mode="classic">${A.icon('coin', 26, '')} Quick game · about 10 minutes</button>
    <button class="btn wide" data-act="real-start">${A.icon('smile', 26, '')} Start from my real life</button>`}
    ${first ? '<p class="note" style="text-align:center">Finish the Sprint to unlock the full life: every mode, the Map and more.</p>' : `<details class="more"><summary>${A.icon('gift', 26, '')} More ways to play</summary>
      <div class="more-grid">${more.map(([act, ic, name, sub]) => `<button class="more-b" data-act="${act === 'blitz' ? 'setup' : act}" ${act === 'blitz' ? 'data-mode="blitz"' : ''}>${A.icon(ic, 40, '')}<b>${esc(name)}</b><small>${esc(sub)}</small></button>`).join('')}</div>
    </details>`}
    <div class="stats-row">
      <div class="stat"><b>${P.wisdom}</b><span>Wisdom</span></div>
      <div class="stat"><b>${P.bestStars != null ? `${P.bestStars}★` : '–'}</b><span>Best life</span></div>
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
    <p class="maker">${MAKER}</p>
  </main>`;
}

// A picture of your life for WhatsApp: your family in front of your home.
async function shareCard() {
  const d = lastDone;
  if (!d || !d.result) return;
  const r = d.result;
  try {
    const svgStr = resultScene(d).replace('<svg ', '<svg width="1080" height="540" ');
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 1080; c.height = 1350;
    const x = c.getContext('2d');
    x.fillStyle = '#140e29'; x.fillRect(0, 0, 1080, 1350);
    x.drawImage(img, 0, 170, 1080, 540);
    x.textAlign = 'center';
    x.fillStyle = '#ffc53d'; x.font = '84px Bungee, Figtree, sans-serif';
    x.fillText('TYCOON RUSH', 540, 120);
    x.fillStyle = '#ffffff'; x.font = '800 76px Figtree, sans-serif';
    x.fillText(resultTitle(r)[1], 540, 840);
    if (r.life) { x.fillStyle = '#ffc53d'; x.font = '110px sans-serif'; x.fillText(starsText(r.life.stars), 540, 990); }
    x.fillStyle = '#a99fd2'; x.font = '600 44px Figtree, sans-serif';
    x.fillText(`Score ${r.score.toLocaleString()} · ${E.MODES[d.mode].name}`, 540, 1090);
    x.fillText('Can you build a better life?', 540, 1180);
    x.font = '600 34px Figtree, sans-serif';
    x.fillText(MAKER, 540, 1270);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    const file = new File([blob], 'my-tycoon-rush-life.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text: shareText(d) });
    else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast('Picture saved');
    }
  } catch { toast('Could not make the picture here.'); }
}

// ------------------------------------------------------------------ reminders (16+, opt-in)
//
// There is no server, so reminders use the browser's periodic background sync
// where it exists (Chrome on Android, installed game). The service worker
// reads the latest teaser from a small cache entry.

function saveTeaser() {
  if (!adult() || !P.settings.reminders || !('caches' in window)) return;
  const text = run && run.teaser ? run.teaser : run && !run.home.own ? 'Rent is due. Your money is waiting for you.' : 'Your money tree has grown. Come and see.';
  caches.open('tr-state').then((c) => c.put('./state/teaser.json', new Response(JSON.stringify({ text, at: Date.now() }), { headers: { 'Content-Type': 'application/json' } }))).catch(() => {});
}

async function setupReminders() {
  try {
    if (!('Notification' in window)) { toast('Reminders are not available on this phone.'); P.settings.reminders = false; saveProfile(); return; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Reminders need notification permission.'); P.settings.reminders = false; saveProfile(); settings(); return; }
    const reg = await navigator.serviceWorker.ready;
    if (reg.periodicSync) { await reg.periodicSync.register('tr-remind', { minInterval: 20 * 60 * 60 * 1000 }); toast('Reminders on.'); }
    else toast('Reminders are on, but this browser only shows them when the game is open. Install the game for the best results.');
    saveTeaser();
  } catch { toast('Reminders could not be set up here.'); }
}

// Under 16: a gentle break after 45 minutes of play.
let sessionStart = Date.now();
setInterval(() => {
  if (P.ageMode !== 'u16' || !run || document.hidden) return;
  if (Date.now() - sessionStart < 45 * 60 * 1000) return;
  sessionStart = Date.now();
  stopTimer(); stopAutoplay(); persist();
  openModal(`<div class="swan swan-in"><span class="kicker">Break time</span><div class="mood" style="color:var(--sky)">45 MINUTES</div><p class="outcome">You have been playing for a while. Your game is saved exactly where you left it.</p><button class="btn primary wide" data-act="home">Take a break</button><button class="btn wide" data-act="break-on">Keep playing</button></div>`);
}, 60 * 1000);

// ------------------------------------------------------------------ the weekly real-news pack
//
// Online, the game fetches a small file of real headlines for your region,
// published weekly. They replace the "noise" headlines only, so they never
// change the market. Offline, the generated headlines are used.

async function loadNewsPack() {
  try {
    const r = await fetch('./news/weekly.json', { cache: 'no-cache' });
    if (!r.ok) return;
    const pack = await r.json();
    if (pack && pack.regions) { P.newsPack = { week: pack.week, regions: pack.regions }; saveProfile(); }
  } catch { /* offline: keep the last pack, or the generated headlines */ }
}

function realNoise(i) {
  const pack = P.newsPack;
  if (!pack || !run) return null;
  const list = (pack.regions && (pack.regions[run.region] || pack.regions.world)) || [];
  if (!list.length) return null;
  const h = list[(run.turn * 3 + i) % list.length];
  return typeof h === 'string' ? h : h && h.title;
}

// ------------------------------------------------------------------ friends board
//
// No server: a result travels inside the link a friend shares. Opening the
// link adds it to your board, grouped by Duel code.

const b64 = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (t) => JSON.parse(decodeURIComponent(escape(atob(t.replace(/-/g, '+').replace(/_/g, '/')))));

function resultLink(done) {
  const r = done.result;
  const code = done.mode === 'duel' ? done.seed.replace('duel-', '') : done.mode === 'daily' ? `Daily ${done.seed.replace('daily-', '')}` : 'Open play';
  return `${GAME_URL}?vs=${b64({ n: (P.reportName || 'A friend').slice(0, 20), c: code, s: r.score, st: r.life ? r.life.stars : 0, a: r.age, r: r.reason, d: today() })}`;
}

function ingestLink() {
  let q = null;
  try { q = new URLSearchParams(location.search).get('vs'); } catch { q = null; }
  if (!q) return;
  try {
    const e = unb64(q);
    if (!e || typeof e.s !== 'number') return;
    const code = String(e.c || 'Open play').slice(0, 24);
    const list = P.board[code] || [];
    if (!list.some((x) => x.n === e.n && x.s === e.s)) list.push({ n: String(e.n).slice(0, 20), s: e.s, st: Number(e.st) || 0, a: e.a, r: e.r, d: e.d || today() });
    P.board[code] = list.slice(-30);
    saveProfile();
    const mine = code.startsWith('Daily') ? (P.daily[code.replace('Daily ', '')] || {}).score : (P.duels[code] || {}).score;
    setTimeout(() => toast(adult() && mine != null && e.s > mine ? `${e.n} passed your score. Play ${code} again?` : `${e.n}'s result added to your friends board`), 600);
    history.replaceState(null, '', location.pathname);
  } catch { /* not a valid link */ }
}

function boardScreen() {
  const codes = Object.keys(P.board);
  const mine = (code) => (code.startsWith('Daily') ? P.daily[code.replace('Daily ', '')] : P.duels[code]);
  page('Friends board', `
    <p class="muted">When a friend shares a result link and you open it, their score lands here. Share yours from the results screen. Ranked by Life Score, then points.</p>
    ${codes.length ? codes.map((code) => {
    const me = mine(code);
    const rows = [...P.board[code].map((x) => ({ ...x })), ...(me ? [{ n: 'You', s: me.score, st: me.stars || 0, you: true }] : [])].sort((a, b) => b.st - a.st || b.s - a.s);
    return `<section class="field"><span class="lbl">${esc(code)}</span><ol class="board">${rows.map((x) => `<li class="${x.you ? 'you' : ''}"><b>${esc(x.n)}</b><span>${'★'.repeat(Math.floor(x.st))}${x.st % 1 ? '½' : ''}</span><span>${Number(x.s).toLocaleString()}</span></li>`).join('')}</ol>${code !== 'Open play' && !code.startsWith('Daily') ? `<button class="btn small" data-act="duel-code" data-code="${esc(code)}">Play ${esc(code)}</button>` : ''}</section>`;
  }).join('') : '<p class="note">Nothing here yet. Start a Duel and send the code, or share a result.</p>'}`);
}

// ------------------------------------------------------------------ daily streak

function bumpStreak() {
  const s = P.streak;
  const t = today();
  if (s.last === t) return;
  const days = s.last ? Math.round((new Date(t) - new Date(s.last)) / 864e5) : 1;
  if (!s.last || days === 1) s.n += 1;
  else if (!adult()) s.n += 1; // Under 16: a streak never breaks.
  else if (days === 2 && s.skipWeek !== weekNo()) { s.n += 1; s.skipWeek = weekNo(); }
  else if ((s.freezes || 0) >= days - 1) { s.freezes -= days - 1; s.n += 1; }
  else s.n = 1;
  s.last = t;
  s.best = Math.max(s.best || 0, s.n);
}

// ------------------------------------------------------------------ sharing and feedback

// The public address of the game, for sharing from anywhere (including copies
// of the game that run somewhere else).
const GAME_URL = 'https://samebimo10-cpu.github.io/Stock-/tycoon/';
// Put a WhatsApp number here (country code, digits only, e.g. '2348012345678')
// to send feedback straight to it. Left empty, WhatsApp asks who to send it to.
const FEEDBACK_WHATSAPP = '';
// The name people see as the maker, in shared messages, pictures and the report.
const MAKER = 'Produced by Ebims';
const INVITE = 'Try Tycoon Rush by Ebims, a free game that teaches money. Grow your money tree and get free before 60. It works offline too.';
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
    <label class="me-f" for="me-home"><span><b>Your home now</b><small>Rent is already in your living costs</small></span><span class="me-in"><select id="me-home" class="select">${HOME_ORDER.map((id) => `<option value="${id}" ${m.home === id ? 'selected' : ''}>${esc(HOMES[id].long)}</option>`).join('')}</select></span></label>
    <label class="me-f" for="me-district"><span><b>Your area</b></span><span class="me-in"><select id="me-district" class="select">${DISTRICT_ORDER.map((id) => `<option value="${id}" ${m.district === id ? 'selected' : ''}>${esc(DISTRICTS[id].name)}</option>`).join('')}</select></span></label>
    <label class="me-f" for="me-car"><span><b>Your car</b><small>Counted at about 60% of the new price</small></span><span class="me-in"><select id="me-car" class="select">${CAR_ORDER.map((id) => `<option value="${id}" ${m.car === id ? 'selected' : ''}>${esc(CARS[id].name)}</option>`).join('')}</select></span></label>
    ${ME_FIELDS.map(([title, rows]) => `<span class="lbl">${title}</span>${rows.map((r) => field(r)).join('')}`).join('')}
    <label class="check" id="box-prop" ${num(m.prop) > 0 ? '' : 'hidden'}><input type="checkbox" id="me-liveIn" ${m.liveIn !== false ? 'checked' : ''}> I live in this property (it pays no rent)</label>
    <label class="check" id="box-biz" ${num(m.biz) > 0 ? '' : 'hidden'}><input type="checkbox" id="me-bizManaged" ${m.bizManaged ? 'checked' : ''}> My business runs without me (a manager runs it)</label>
    <span class="lbl">Your goals</span>
    ${field(['aim', 'Free by what age?', 'When you want work to be optional'], { unit: 'age' })}
    ${field(['goal', 'Income you want when free, per month', 'In today\'s money. Leave empty to use your living costs'])}
    <div id="me-preview">${mePreview()}</div>
  </section>`;
}

const isWeekend = () => [0, 6].includes(new Date().getDay());
const streakBoost = () => (adult() ? Math.min(0.3, 0.01 * (P.streak.n || 0)) : 0);

function startRun(opts) {
  const fair = fairMode(opts.mode);
  run = E.newRun({
    sex: P.look.sex, region: P.region || 'westafrica',
    think: (P.runs || 0) >= 2,
    envelopes: adult(), weekend: adult() && isWeekend(),
    cashBoost: fair ? 0 : streakBoost(),
    ...opts,
  });
  run.lookSkin = P.look.skin;
  tab = 'today';
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
    <span class="t-cap">${open ? esc(pl.cap) : E.rule(run, 'cryptoBan') && id === 'crypto' ? 'Banned in this world' : 'Closed this week'}</span>
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

// The game is a life, not a dashboard. One primary screen shows your life, one
// message, your money tree and four actions; everything else is a place you
// visit when you want to (World, Money, People, Story).
let tab = 'today';
const TABS = [['today', 'house', 'Today'], ['world', 'map', 'World'], ['money', 'coins', 'Money'], ['people', 'people', 'People'], ['story', 'book', 'Story']];
const circleSeen = (r = run) => r.seenEv.includes('circle') || E.circleOpen(r);
const tabLock = () => null;
const zoneName = (z, r = run) => COUNTRIES[r.currency].zones[z];
const ms = (r) => r.milestones || [];
const castOf = (role) => run.circle.find((c) => c.role === role);
const chapterName = (id) => (CHAPTERS.find((c) => c.id === id) || CHAPTERS[0]).name;
const freeProg = (r = run) => clamp(E.passive(r).total / E.bowl(r), 0, 1.2);

function topbarHTML() {
  const ch = run.story ? run.story.chapter : 'start';
  return `<header class="topbar">
      <button class="home-pill hud-home" data-act="home" aria-label="Home screen (your game is saved)">‹ ${A.icon('house', 20, '')}<span>Home</span></button>
      <button class="age-big" data-act="tab" data-t="story" aria-label="Age ${run.age}. Open your life story"><b>AGE ${run.age}</b><small>${esc(chapterName(ch))}</small></button>
      <button class="icon-btn" data-act="menu" aria-label="Menu">☰</button>
    </header>`;
}

function tabbarHTML() {
  const dot = { people: !!run.flags.circleNew };
  return `<nav class="tabbar five" aria-label="Game sections">${TABS.map(([id, ic, name]) => `<button class="tb ${tab === id || (tab === 'map' && id === 'world') ? 'on' : ''}" data-act="tab" data-t="${id}" aria-label="${name}" ${tab === id ? 'aria-current="page"' : ''}>${A.icon(ic, 24, '')}<span>${name}</span>${dot[id] ? '<i class="tb-dot"></i>' : ''}</button>`).join('')}</nav>`;
}

function familyOf(r) {
  const out = [{ look: { ...((r.look) || P.look) }, age: r.age, expr: youExpr(), style: r.life, sex: ((r.look) || P.look).sex }];
  if (r.partner && r.partner.look && Object.keys(r.partner.look).length) out.push({ look: r.partner.look, age: r.age, sex: r.partner.sex, style: r.life, expr: r.partner.trust < 25 ? 'tired' : 'happy' });
  for (const k of r.kids) { const a = r.age - k.born; if (a < 22 && k.look) out.push({ look: k.look, age: Math.max(1, a), sex: k.sex, style: 1 }); }
  return out.slice(0, 5);
}

function sceneFor(r, opts = {}) {
  if (!r.home) {
    const prog = clamp(E.passive(r).total / E.bowl(r), 0, 1);
    return A.homeScene({ stage: opts.stage ?? A.stageOf(prog), life: r.life, mood: opts.mood || lastMood(), look: P.look, age: r.age, expr: opts.expr || youExpr() }, { label: opts.label || 'Your home' });
  }
  return A.homeScene({
    home: r.home.id, district: r.home.district, car: r.car.id, family: familyOf(r).map((p, i) => (i === 0 && opts.expr ? { ...p, expr: opts.expr } : p)),
    mood: opts.mood || lastMood(), rental: E.rentable(r) > 0, biz: r.h.biz.c > 0, farmer: r.char === 'farmer', sea: E.atSea(r),
    guard: r.home.guard, cctv: r.home.cctv, worn: r.cash < 0, beach: !!opts.beach,
  }, { label: opts.label || `Your ${HOMES[r.home.id].name.toLowerCase()} in a ${DISTRICTS[r.home.district].name.toLowerCase()}` });
}

function treeFor(r, size = 96) {
  return A.moneyTree({ prog: freeProg(r), invested: r.h.index + E.stocksTotal(r) + r.h.save > 0, prop: E.rentable(r) > 0 || r.home.own, biz: r.h.biz.c > 0, debt: r.cash < 0, crash: lastMood() === 'crash', free: !!r.freeAge }, size);
}

function renderGame() {
  if (!run) return home();
  E.upgradeRun(run);
  if (!['today', 'world', 'money', 'people', 'story', 'map'].includes(tab)) tab = 'today';
  if (tab === 'people') run.flags.circleNew = false;
  const body = { today: todayTab, world: worldTab, map: mapTab, money: moneyTab, people: peopleTab, story: storyTab }[tab]();
  app.innerHTML = `
  <div class="game tab-${tab}">
    ${topbarHTML()}
    ${body}
    ${tab === 'today' ? `<footer class="actionbar"><div class="actions-row"><button class="home-big" data-act="home" aria-label="Home screen (your game is saved)">${A.icon('house', 28, '')}<span>Home</span></button><button class="next ${run.pending ? 'wait' : ''}" data-act="next"><span>${run.pending ? 'Open your message' : `Live ${run.ypt === 1 ? 'the year' : `${run.ypt} years`} ▸`}</span><small>Age ${run.age} → ${run.age + run.ypt}</small><i class="timer"></i></button></div></footer>` : ''}
    ${tabbarHTML()}
  </div>`;
  if (tab === 'money') requestAnimationFrame(drawSparks);
}

// ------------------------------------------------------------------ Today: your life, one message, a few actions

function guideTip() {
  if (P.runs > 0 || run.turn > 3) return '';
  const t = run.pending && run.turn === 0 ? 'Here is your first choice. Tap the message to open it.'
    : run.turn === 0 ? 'Now tap <b>Live the year</b> to see what a year does to your money.'
      : run.turn === 1 && !run.pending ? 'Tap <b>Invest</b> to put spare cash to work, or <b>Life</b> to change how you live. Then live the year.'
        : run.turn === 2 && !run.pending ? 'Your money tree grows as money starts paying you. Fill it and you are free.' : '';
  return t ? `<div class="sec">${guideSay(t)}</div>` : '';
}

function messageCard() {
  if (!run.pending) {
    const tip = run.lastResult && run.lastResult.moments && run.lastResult.moments[0];
    return tip ? `<button class="msg coach" data-act="principle" data-id="${tip.p}"><span class="msg-face">${A.castFace(guideId(), 'happy', 48, guideName())}</span><span><span class="kicker">${esc(guideName())}</span><b>${esc(tip.text.split('. ')[0])}.</b><small>Want to see why? ▸</small></span></button>` : '';
  }
  const v = E.eventView(run);
  const face = eventFace(v);
  const title = v.id === 'circle' ? (v.v.offer ? `${v.v.who} has an offer` : v.v.type === 'fraudster' ? `${v.v.who} gets in touch` : `${v.v.who} asks for help`) : v.title;
  const first = String(v.text).split(/(?<=[.!?"])\s/)[0];
  return `<button class="msg" data-act="decide">
      <span class="msg-face">${face.small || face.html}</span>
      <span><span class="kicker">${A.icon('phone', 16, '')} New message · ${esc(face.name)}</span><b>${esc(title)}</b><small>${esc(first)}</small></span>
      <span class="msg-go">Open ▸</span></button>`;
}

function todayTab() {
  const nw = E.netWorth(run);
  const p = E.passive(run);
  const B = E.bowl(run);
  const prog = freeProg(run);
  const gv = E.goalView(run);
  const need = Math.max(0, B - p.total);
  const acts = [['work-sheet', 'desk', 'Work'], ['invest', 'coins', 'Invest'], ['life-sheet', 'house', 'Life'], ['opps', 'dice', 'Opportunity']];
  return `
    <section class="today">
      <button class="scene-btn big" data-act="life-sheet" aria-label="Your life">${sceneFor(run)}</button>
      <div class="wealth"><b class="${nw < 0 ? 'down' : ''}" id="nw">${f(nw)}</b><span>NET WORTH</span></div>
      <button class="tree-row" data-act="passive">${treeFor(run, 92)}
        <span class="tree-txt"><b>${Math.round(Math.min(1, prog) * 100)}% FREE</b><span class="fbar"><i style="width:${(Math.min(1, prog) * 100).toFixed(1)}%"></i></span>
        <small>${run.freeAge ? `Free since ${run.freeAge}. Your money pays for your life.` : need > 0 ? `You need another ${f(need)} a year` : 'Your money covers your life'}</small></span></button>
      ${gv ? `<button class="goal" data-act="tab" data-t="story">${A.icon('flag', 22, '')}<span><small>Your goal</small><b>${esc(gv.title)}</b><span class="gbar"><i style="width:${Math.round(gv.prog * 100)}%"></i></span></span></button>` : ''}
      ${run.teaser && run.pending ? '' : ''}
      ${messageCard()}
      ${guideTip()}
      ${E.atSea(run) ? `<div class="sea-note">${A.icon('clock', 22, '')} <b>At sea this year.</b> Your money keeps working while you sail.</div>` : ''}
      <div class="acts">${acts.map(([a, ic, name]) => `<button class="act" data-act="${a}">${A.icon(ic, 34, '')}<span>${name}</span></button>`).join('')}</div>
    </section>`;
}

// ------------------------------------------------------------------ the action sheets

function workSheet() {
  const can = E.canAct(run);
  const P_ = run.partner && !run.partner.legacy ? run.partner : null;
  const boss = castOf('boss');
  const courseReady = run.age - (run.flags.courseAge ?? -99) >= 3;
  const raiseReady = run.turn - (run.flags.raiseT ?? -9) >= Math.max(1, Math.round(2 / run.ypt));
  const power = (() => { const months = run.h.save / Math.max(1, E.costs(run) / 12); return months >= 9 ? 'Strong' : months >= 3 ? 'Fair' : 'Weak'; })();
  openSheet(`
    ${sheetHead('', run.flags.retired ? 'You are retired' : 'Your work')}
    <div class="life-card">${A.icon('desk', 56, '')}<div><b>${run.flags.retired ? 'Work is optional' : `${f(run.salary / 12)} a month`}</b><small>${run.flags.retired ? 'Your money pays for your life.' : `${f(run.salary)} a year${boss ? ` · Boss: ${esc(boss.name)}` : ''}`}</small>${P_ ? `<small>${esc(P_.name)} brings in ${f(P_.pay)} a year.</small>` : ''}</div></div>
    ${run.flags.retired ? '' : `
    <button class="big-row" data-act="work" data-k="course" ${can && courseReady && run.cash >= 0.3 * run.salary ? '' : 'disabled'}>${A.icon('diploma', 30, '')}<span><b>Take a course</b><small>${f(0.3 * run.salary)} · pay +12%${courseReady ? '' : ' · done recently'}</small></span></button>
    <button class="big-row" data-act="work" data-k="raise" ${can && raiseReady ? '' : 'disabled'}>${A.icon('payslip', 30, '')}<span><b>Ask for a raise</b><small>Your bargaining power: ${power}. Savings, fresh skills and a good year help.</small></span></button>
    <button class="big-row" data-act="work" data-k="side" ${can ? '' : 'disabled'}>${A.icon('bolt', 30, '')}<span><b>${run.side ? 'Stop your side hustle' : 'Start a side hustle'}</b><small>${run.side ? 'Get your evenings back' : '+15% income, a little less joy'}</small></span></button>`}
    ${run.freeAge && !run.flags.retired ? `<button class="big-row" data-act="work" data-k="retire">${A.icon('sun', 30, '')}<span><b>Retire</b><small>Stop working. Your money pays the bills.</small></span></button>` : ''}
    ${run.freeAge ? '<button class="btn wide" data-act="end-game">See my life story now</button>' : ''}
    <button class="btn ghost wide" data-act="close">Close</button>`);
}

function investSheet() {
  const can = E.canAct(run);
  const C = E.costs(run);
  const spare = Math.max(0, run.cash - 0.25 * C);
  const opt = (id, ic, name, sub, asset) => `<div class="inv-row">${A.icon(ic, 40, '')}<span><b>${name}</b><small>${sub}</small><small class="muted">You have ${f(asset === 'stocks' ? E.stocksTotal(run) : run.h[asset])}</small></span><button class="btn small primary" data-act="quickinv" data-a="${asset}" ${can && spare > 0 ? '' : 'disabled'}>Put in ${f(spare)}</button></div>`;
  openSheet(`
    ${sheetHead('', 'Put your money to work')}
    <p class="muted">Spare cash: <b>${f(spare)}</b> (we keep three months of costs in your pocket).</p>
    ${opt('save', 'safe', 'Safe', 'The bank. Never falls, grows slowly.', 'save')}
    ${opt('index', 'basket', 'Steady', 'A basket of every big company. Dips, then grows.', 'index')}
    ${opt('stocks', 'companies', 'Bold', 'Single companies. Big wins, big falls.', 'stocks')}
    <div class="plan">${planHTML(E.atSea(run))}</div>
    <button class="btn wide" data-act="tab" data-t="money">${A.icon('coins', 20, '')} Open the full money view</button>`);
}

function lifeSheet() {
  openSheet(`${sheetHead('', 'Your life')}${lifeTab()}<button class="btn wide" data-act="close">Close</button>`);
}

function oppsSheet() {
  const can = E.canAct(run);
  const zs = E.mapOpen(run) ? ZONE_ORDER.map((z) => ({ z, o: E.landOffer(run, z) })).filter((x) => !x.o.sold && run.cash >= x.o.price).slice(0, 2) : [];
  const b = run.h.biz;
  openSheet(`
    ${sheetHead('', 'Opportunities')}
    <button class="big-row" data-act="bizsheet">${A.icon('shop', 36, '')}<span><b>${b.c > 0 ? 'Your business' : 'Start a business'}</b><small>${b.c > 0 ? `Makes ${f(b.profit)} a year` : 'Profit if you feed it; most struggle at first'}</small></span><span>▸</span></button>
    <button class="big-row" data-act="propsheet">${A.icon('house', 36, '')}<span><b>Property</b><small>${E.rentable(run) > 0 ? `Your rentals pay ${f(E.rentable(run) * E.rentYield(run))} a year` : 'Buy a flat to rent out'}</small></span><span>▸</span></button>
    <button class="big-row" data-act="tab" data-t="map" ${E.mapOpen(run) ? '' : 'disabled'}>${A.icon('map', 36, '')}<span><b>Land across ${esc(COUNTRIES[run.currency].name)}</b><small>${E.mapOpen(run) ? (zs.length ? `Plots for sale in ${zs.map((x) => esc(zoneName(x.z))).join(' and ')}` : 'See this year\'s plots') : 'Opens after your third year'}</small></span><span>▸</span></button>
    ${E.isOpen(run, 'crypto') ? `<button class="big-row" data-act="asset" data-id="crypto">${A.icon('rocket', 36, '')}<span><b>Crypto</b><small>Can fly or crash. Pays nothing while you hold it.</small></span><span>▸</span></button>` : ''}
    ${E.isOpen(run, 'fx') ? `<button class="big-row" data-act="asset" data-id="fx">${A.icon('swap', 36, '')}<span><b>Foreign money</b><small>Rises when your own money falls</small></span><span>▸</span></button>` : ''}
    <p class="note">${can ? 'One life, many doors. Each takes cash you could also keep safe.' : 'You are at sea this year. Opportunities wait for port.'}</p>`);
}

function bizSheet() {
  const b = run.h.biz;
  const can = E.canAct(run) && E.isOpen(run, 'biz');
  const cash = Math.max(0, run.cash);
  const v = E.bizView(run);
  sheetCtx = { id: 'biz' };
  if (!v) {
    openSheet(`
      ${sheetHead('biz', 'Start a business')}
      <p class="muted">${esc(ASSETS.biz.blurb)}</p>
      ${cash > 0 ? `<label class="lbl" for="amt">Cash to start with</label>
      <input type="range" id="amt" min="0" max="${cash}" step="${cash / 400}" value="${cash / 3}" ${can ? '' : 'disabled'}>
      <div class="sl-read"><b id="amtv">${f(cash / 3)}</b><span class="muted">Bigger isn't always better: profit per coin falls as it grows</span></div>
      <button class="btn primary wide" data-act="investbiz" ${can ? '' : 'disabled'}>Open the business</button>` : '<p class="note">You need some cash to start.</p>'}`);
    return;
  }
  const act = (k, ic, name, sub, extra = '', ok = true) => `<button class="biz-act" data-act="bizact" data-k="${k}" ${extra} ${can && !v.acted && ok ? '' : 'disabled'}>${A.icon(ic, 30, '')}<b>${name}</b><small>${sub}</small></button>`;
  openSheet(`
    ${sheetHead('biz', 'Your business')}
    <div class="biz-stats"><div><b>${v.customers.toLocaleString()}</b><small>Customers</small></div><div><b>${f(v.revenue)}</b><small>Revenue a year</small></div><div><b class="up">${f(v.profit)}</b><small>Profit a year</small></div></div>
    <p class="muted">${v.managed ? `A manager runs it${v.share ? ' on a profit share' : ''}. Its profit counts as money that comes by itself.` : 'You run it yourself: it costs you some joy, and its profit needs your time.'}${v.ops ? ' Operations are tight: it wears out slower.' : ''}</p>
    <span class="lbl">${v.acted ? 'You have made your move this year' : 'What do you do this year? (one move)'}</span>
    <div class="biz-grid">
      ${act('marketing', 'tv', 'Marketing', `${f(0.08 * b.c)} · more customers this year`, '', run.cash >= 0.08 * b.c)}
      ${act('hire', 'people', 'Hire', `${f(0.1 * b.c)} · staff ${v.staff}/3`, '', v.staff < 3 && run.cash >= 0.1 * b.c)}
      ${act('price', 'arrowup', 'Raise prices', 'Better margins, fewer customers', 'data-d="1"', v.price < 1)}
      ${act('price', 'arrowdown', 'Cut prices', 'More customers, thinner margins', 'data-d="-1"', v.price > -1)}
      ${act('ops', 'wrench', 'Improve operations', `${f(0.06 * b.c)} · wears out slower`, '', run.cash >= 0.06 * b.c)}
    </div>
    ${cash > 0 ? `<label class="lbl" for="amt">Expand: put in more cash</label><input type="range" id="amt" min="0" max="${cash}" step="${cash / 400}" value="${cash / 3}" ${can ? '' : 'disabled'}>
    <div class="sl-read"><b id="amtv">${f(cash / 3)}</b><span class="muted">Profit per coin falls as it grows</span></div>
    <button class="btn wide" data-act="investbiz" ${can ? '' : 'disabled'}>Expand</button>` : ''}
    ${!v.managed ? `<button class="btn wide" data-act="manager" ${can && run.cash >= E.managerCost(run) ? '' : 'disabled'}>Hire a manager (${f(E.managerCost(run))}, takes 25% of profit)</button>` : ''}
    <details class="more"><summary>View business finances</summary><dl class="stats"><div><dt>Capital</dt><dd>${f(b.c)}</dd></div><div><dt>Price level</dt><dd>${['Low', 'Normal', 'High'][v.price + 1]}</dd></div><div><dt>Staff</dt><dd>${v.staff}</dd></div></dl></details>
    <button class="btn danger wide" data-act="sellbiz" ${can ? '' : 'disabled'}>Sell the business for ${f(b.c * 0.6)}</button>`);
}

// ------------------------------------------------------------------ World: your town, where money lives

function worldTab() {
  const m = run.market[run.turn];
  const mood = lastMood();
  const open = ORDER.filter((id) => E.isOpen(run, id));
  const revealAll = E.newsRevealed(run, {});
  const news = m.news.map((n, i) => {
    const shown = E.newsRevealed(run, n);
    const real = n.kind === 'noise' ? realNoise(i) : null;
    const key = n.kind === 'trap' ? 'scam' : n.kind === 'noise' ? 'noise' : n.real ? 'real' : 'fake';
    const verdict = shown ? `<span class="stamp">${A.icon(STAMP[key][0], 24, STAMP[key][1])}<small>${STAMP[key][1]}</small></span>` : '';
    const getin = n.kind === 'trap' ? `<button class="getin" data-act="trap" data-i="${i}" ${n.taken ? 'disabled' : ''}>${n.taken ? 'You are in' : 'Get in early ▸'}</button>` : '';
    const zoneBtn = n.tag === 'zone' && n.zone && E.mapOpen(run) ? `<button class="linkish" data-act="zone" data-id="${n.zone}">See land in ${esc(zoneName(n.zone))} ▸</button>` : '';
    return `<article class="tv-line ${n.kind === 'trap' ? 'is-trap' : ''}"><span class="h-pic">${headlinePic(n)}</span><div><p>${esc(real || n.text)}</p>${getin}${zoneBtn}</div>${verdict}</article>`;
  }).join('');
  const whisper = (run.charges.insider > 0 && !revealAll) ? `<button class="btn small" data-act="tool" data-tool="insider">Whisper (${run.charges.insider})</button>` : '';
  return `
    <section class="sec">
      <div class="sec-h"><h2>${A.icon('map', 24, '')} Your town</h2><button class="wx small" data-act="prices">${A.moodIcon(mood, 26)}<small>${A.WEATHER[mood].word}</small></button></div>
      ${A.townScene(open, mood)}
      <p class="note">Tap a building. The bank keeps your savings, the market hall holds the index fund, and the estate agent sells property.</p>
      <div class="two-btn"><button class="big-row" data-act="tab" data-t="map" ${E.mapOpen(run) ? '' : 'disabled'}>${A.icon('plot', 30, '')}<span><b>Land office</b><small>${E.mapOpen(run) ? `Plots across ${esc(COUNTRIES[run.currency].name)}` : 'Opens after year 3'}</small></span></button><button class="big-row" data-act="bizsheet">${A.icon('shop', 30, '')}<span><b>${run.h.biz.c > 0 ? 'Your business' : 'Shop to let'}</b><small>${run.h.biz.c > 0 ? f(run.h.biz.profit) + '/yr' : 'Start one'}</small></span></button></div>
    </section>
    <section class="sec">
      <div class="sec-h"><h2>${A.icon('tv', 24, '')} On the news</h2>${whisper}</div>
      <div class="tv">${news}</div>
      <p class="note">Most news is noise; some hints at what's coming, and some is a scam. The Money screen has tools to read it.</p>
    </section>
    ${run.rules && run.rules.length ? `<button class="chip-line rules-chip" data-act="rules">${A.icon('dice', 22, '')} This world: ${run.rules.map((id) => esc(WORLD_RULES[id].name)).join(' · ')} ▸</button>` : ''}`;
}

// ------------------------------------------------------------------ Money: the ledger, for when you want the detail

function moneyTab() {
  const sea = E.atSea(run);
  const C = E.costs(run);
  const p = E.passive(run);
  const idle = run.flags.idle || 0;
  const h = run.h;
  const debt = h.prop.debt + run.car.loan + Math.max(0, -run.cash);
  const partnerPay = run.partner && !run.partner.legacy ? run.partner.pay : 0;
  const income = run.flags.retired ? partnerPay : run.salary + partnerPay + (run.side ? 0.15 * run.salary : 0);
  const saving = income - C - run.giving * income;
  const row = (k, v, cls_ = '') => `<div><span>${k}</span><b class="${cls_}">${f(v)}</b></div>`;
  const ponzi = run.h.ponzi ? `<button class="tile special" data-act="ponzi"><span class="t-top">${A.castFace('hype', 'sly', 40, 'The Hype Guy')}<span class="t-name">Golden Circle<small>"Guaranteed 30%"</small></span></span><b class="t-val">${f(run.h.ponzi.v)}</b><span class="t-foot"><span class="up">▲ +30.0%</span></span></button>` : '';
  const heldCards = run.cards.map((id) => { const c = E.cardById(id); return c ? `<span class="hc ${c.type === 'Tool' ? 'tool' : ''}">${A.icon(A.TYPE_ICON[c.type] === 'hype' ? 'warn' : A.TYPE_ICON[c.type], 16, '')} ${esc(c.name)}${run.charges[id] ? ` ×${run.charges[id]}` : ''}</span>` : ''; }).join('');
  return `
    <section class="sec">
      <div class="sec-h"><h2>${A.icon('coins', 24, '')} Your money</h2><span class="note">The instrument panel</span></div>
      <div class="brk ledger">
        ${row('Cash', run.cash, run.cash < 0 ? 'down' : '')}
        ${row('Savings and investments', h.save + h.index + E.stocksTotal(run) + h.crypto + h.fx)}
        ${h.prop.v ? row('Property', h.prop.v) : ''}${h.biz.c ? row('Business', h.biz.c) : ''}${run.land.length ? row('Land', E.landValue(run)) : ''}${run.car.v ? row('Car', run.car.v) : ''}
        ${debt ? row('Debts', -debt, 'down') : ''}
        <div class="tot"><span>Net worth</span><b>${f(E.netWorth(run))}</b></div>
        ${row('Income a year', income, 'up')}${row('Living costs a year', -C, 'down')}
        <div><span>Left over a year</span><b class="${saving >= 0 ? 'up' : 'down'}">${f(saving, true)}</b></div>
        <div class="tot"><span>Money that comes by itself</span><b>${f(p.total)}/yr</b></div>
      </div>
      ${idle > 0 && run.cash > 0 ? `<p class="warn">Cash sitting idle loses ${pctS(run.infl)} a year to rising prices.</p>` : ''}
    </section>
    <section class="sec"><div class="wallet">${planHTML(sea)}</div></section>
    <section class="sec">
      <div class="sec-h"><h2>Where your money is</h2><span class="note">Tap to put in or take out</span></div>
      <div class="grid">${ORDER.map(tileHTML).join('')}${ponzi}</div>
    </section>
    ${run.eraId ? '' : run.think ? `<button class="big-row" data-act="think">${A.icon('dice', 30, '')}<span><b>Market and forecasts</b><small>Base rates, headlines, Mr. Market${run.learnMode ? ', and your yearly call' : ''}</small></span><span>▸</span></button>` : `<div class="big-row locked">${A.icon('lock', 30, '')}<span><b>Market and forecasts</b><small>Unlock after your second game.</small></span></div>`}
    <div class="two-btn"><button class="big-row" data-act="statement">${A.icon('payslip', 28, '')}<span><b>Statement</b><small>Rich Dad's test</small></span></button><button class="big-row" data-act="cures">${A.icon('star', 28, '')}<span><b>Coach</b><small>Arkad's seven cures</small></span></button></div>
    <button class="big-row" data-act="costs">${A.icon('bowl', 28, '')}<span><b>Where your costs go</b><small>${f(C)} a year</small></span><span>▸</span></button>
    ${heldCards ? `<section class="sec"><div class="sec-h"><h2>What you have become</h2></div><div class="held">${heldCards}</div></section>` : ''}`;
}

// ------------------------------------------------------------------ People: everyone in your life

const bar = (label, v, col) => `<div class="trust"><span class="lbl">${label}</span><div class="jbar"><i style="width:${Math.round(v)}%;background:${col}"></i></div><b class="num">${Math.round(v)}</b></div>`;

function peopleTab() {
  const P_ = run.partner;
  const T = P_ ? PARTNERS[P_.type] : null;
  const can = E.canAct(run);
  const kids = run.kids.map((k, i) => {
    const a = run.age - k.born;
    const open = E.schoolsOpen(run);
    let ctl = '';
    if (a < 5) ctl = '<small class="muted">Starts school at 5</small>';
    else if (a < 18) ctl = `<div class="seg school-seg">${SCHOOL_ORDER.map((id) => `<button class="${k.school === id ? 'on' : ''}" data-act="school" data-i="${i}" data-id="${id}" ${can && open.includes(id) ? '' : 'disabled'}>${esc(SCHOOLS[id].name.replace(' private', ''))}<small>${f(SCHOOLS[id].fee * run.salaryStart * (run.feeIdx || 1))}</small></button>`).join('')}</div>`;
    else if (a < 22) ctl = `<div class="seg"><button class="${k.uni !== 'abroad' ? 'on' : ''}" data-act="uni" data-i="${i}" data-v="0" ${can ? '' : 'disabled'}>Study at home</button><button class="${k.uni === 'abroad' ? 'on' : ''}" data-act="uni" data-i="${i}" data-v="1" ${can ? '' : 'disabled'}>Abroad<small>${f(1.5 * run.salaryStart * (run.feeIdx || 1))}/yr</small></button></div>`;
    else ctl = `<small class="${k.outcome === 'support' ? 'down' : 'up'}">${esc(KID_OUTCOMES[k.outcome] || '')}</small>`;
    return `<div class="person-row">${k.look ? A.lookPerson(k.look, { age: Math.max(2, a), size: 54, sex: k.sex, label: k.name }) : A.icon('family', 44, '')}<div><b>${esc(k.name)}, ${a}</b>${ctl}</div></div>`;
  }).join('');
  const face = (c) => `<button class="face-b" data-act="person" data-id="${c.id}">${A.lookPerson(c.look, { age: run.age + (c.ageGap || 0), size: 60, sex: c.sex, expr: (c.conflict || 0) > 20 ? 'sly' : (c.closeness ?? 50) > 60 ? 'happy' : 'neutral', label: c.name })}<b>${esc(c.name)}</b><small>${esc(c.rel)}</small>${c.cast ? `<span class="rel-bar"><i style="width:${Math.round(c.closeness ?? 40)}%"></i></span>` : c.known ? `<span class="type-tag t-${c.type}">${esc(CIRCLE_TYPES[c.type].name)}</span>` : c.clues.length ? '<span class="type-tag">Clue noted</span>' : ''}</button>`;
  const F = FAITHS[P.faith || 'none'];
  const cast = run.circle.filter((c) => c.cast && (c.role !== 'rival' || run.h.biz.c > 0 || (c.history || []).length));
  const circle = run.circle.filter((c) => !c.cast);
  return `
    <section class="sec">
      <div class="sec-h"><h2>${A.icon('heart', 24, '')} Family</h2></div>
      ${P_ ? `<div class="person-row">${P_.look && Object.keys(P_.look).length ? A.lookPerson(P_.look, { age: run.age, size: 64, sex: P_.sex, expr: P_.trust < 25 ? 'worried' : 'happy', label: P_.name }) : A.icon('heart', 48, '')}<div><b>${esc(P_.name)}</b><small>${P_.revealed ? `${esc(T.name)}: ${esc(T.line)}` : 'Still getting to know each other.'}</small>${bar('Trust', P_.trust, P_.trust < 25 ? 'var(--loss)' : 'var(--pink)')}</div></div>` : '<p class="muted">Single for now. Someone special may come along.</p>'}
      ${kids}
    </section>
    <section class="sec">
      <div class="sec-h"><h2>${A.icon('people', 24, '')} The people in your life</h2></div>
      <p class="muted">They remember how you treated them. Tap anyone to see your history together.</p>
      <div class="faces">${cast.map(face).join('')}${circle.map(face).join('')}</div>
    </section>
    <section class="sec">
      ${bar('Reputation', run.rep, 'var(--gold)')}
      <p class="note">${run.rep >= 65 ? 'People speak well of you. If trouble comes, they will help.' : run.rep <= 30 ? 'People have stopped expecting help from you, and won\'t help you either.' : 'Help the genuine, set limits with takers, and people will stand by you.'}</p>
    </section>
    <section class="sec">
      <div class="sec-h"><h2>${A.icon('jar', 24, '')} ${esc(F.jar)} jar</h2><button class="linkish" data-act="settings-faith">Wording ▸</button></div>
      <div class="seg">${[0, 0.02, 0.05, 0.1, 0.15].map((g) => `<button class="${Math.abs(run.giving - g) < 0.001 ? 'on' : ''}" data-act="giving" data-v="${g}" ${can ? '' : 'disabled'}>${Math.round(g * 100)}%</button>`).join('')}</div>
      <p class="note">Giving lifts joy and your name, and now and then someone you helped opens a door. It is not an investment.</p>
    </section>`;
}

function personSheet(id) {
  const c = run.circle.find((x) => x.id === id);
  if (!c) return;
  const hist = (c.history || []).slice().reverse();
  openSheet(`
    ${sheetHead('', c.name)}
    <div class="person-row">${A.lookPerson(c.look, { age: run.age + (c.ageGap || 0), size: 90, sex: c.sex, label: c.name })}<div><b>${esc(c.rel)}</b><small>${c.cast ? esc(STORY_CAST[c.role].about) : `Asked ${c.asks} time${c.asks === 1 ? '' : 's'} · you gave ${f(c.given)} · paid back ${f(c.returned)}`}</small>
      ${c.cast ? `${bar('Trust', c.trust ?? 50, 'var(--sky)')}${bar('Closeness', c.closeness ?? 40, 'var(--pink)')}${(c.conflict || 0) > 0 ? bar('Tension', c.conflict, 'var(--loss)') : ''}` : c.known ? `<p><b>${esc(CIRCLE_TYPES[c.type].name)}.</b> ${esc(CIRCLE_TYPES[c.type].tell)}</p>` : '<p class="muted">You don\'t know them well yet.</p>'}</div></div>
    ${c.clues.length ? `<span class="lbl">What you noticed</span><ul class="clues">${c.clues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${hist.length ? `<span class="lbl">Your history</span><ul class="clues">${hist.map((x) => `<li><b>${x.age}</b> · ${esc(x.text)}</li>`).join('')}</ul>` : ''}
    <button class="btn wide" data-act="close">Close</button>`);
}

// ------------------------------------------------------------------ Story: your life so far

function timelineHTML(mem, max = 40) {
  const items = mem.filter((m) => !m.tags.includes('card')).slice(-max);
  return `<ol class="timeline">${items.map((m) => `<li class="t-${m.type} ${m.impact > 0 ? 'win' : m.impact < 0 ? 'loss' : ''}"><span class="t-age">${m.age}</span><div><b>${esc(m.title)}</b>${m.text ? `<small>${esc(m.text)}</small>` : ''}</div></li>`).join('')}</ol>`;
}

function storyTab() {
  const S = run.story;
  const earned = run.cards.map((id) => E.cardById(id)).filter(Boolean);
  const got = trophiesAll();
  return `
    <section class="sec chapter-card"><span class="kicker">Chapter</span><h2>${esc(chapterName(S.chapter))}</h2><p class="muted">${esc((CHAPTERS.find((c) => c.id === S.chapter) || {}).line || '')}</p></section>
    <section class="sec">
      <div class="sec-h"><h2>${A.icon('book', 24, '')} Your life so far</h2></div>
      ${timelineHTML(S.memories)}
    </section>
    <section class="sec">
      <div class="sec-h"><h2>${A.icon('trophy', 24, '')} Achievements</h2><span class="note">${S.goalsDone.length} goals reached</span></div>
      ${earned.length ? `<div class="held">${earned.map((c) => `<span class="hc">${A.icon(A.TYPE_ICON[c.type] === 'hype' ? 'warn' : A.TYPE_ICON[c.type], 16, '')} ${esc(c.name)}</span>`).join('')}</div>` : '<p class="muted">Cards are earned by what you do: hold through two crashes, pay yourself first for years, own a rental.</p>'}
      <div class="trophies">${HOME_ORDER.map((id) => `<span class="tro">${A.homePic(id, 52, got.homes.includes(id))}<small>${esc(HOMES[id].name)}</small></span>`).join('')}${CAR_ORDER.filter((id) => id !== 'none').map((id) => `<span class="tro">${A.carPic(id, 52, got.cars.includes(id))}<small>${esc(CARS[id].name)}</small></span>`).join('')}</div>
    </section>
    <section class="sec me-card">${A.avatar(myLook(), run.char, { age: run.age, expr: 'happy', size: 80, label: 'You', style: run.life })}<div><b>${esc(run.heirName || P.reportName || 'You')}, ${run.age}</b><small>${esc(E.MODES[run.mode].name)} · ${esc(CURRENCIES[run.currency].name)}${run.gen > 1 ? ` · Generation ${run.gen}` : ''}</small><button class="btn small" data-act="look-screen">${A.icon('smile', 18, '')} Change my look</button></div></section>
    <div class="me-grid">
      <button class="big-row" data-act="report-now">${A.icon('payslip', 28, '')}<span><b>Report (PDF)</b><small>How your choices are going</small></span></button>
      <button class="big-row" data-act="library">${A.icon('book', 28, '')}<span><b>Library</b><small>The ideas behind the game</small></span></button>
      <button class="big-row" data-act="settings">${A.icon('gear', 28, '')}<span><b>Settings</b><small>Sound, motion, age mode</small></span></button>
      <button class="big-row" data-act="how">${A.icon('star', 28, '')}<span><b>How to play</b><small>In plain words</small></span></button>
    </div>
    <button class="btn danger wide" data-act="abandon">Abandon this life</button>`;
}

// ------------------------------------------------------------------ deciding: situation, choice, consequence

function decisionScreen() {
  const v = E.eventView(run);
  if (!v) return;
  stopTimer();
  const face = eventFace(v);
  const title = v.id === 'circle' ? (v.v.offer ? `${v.v.who} has an offer` : v.v.type === 'fraudster' ? `${v.v.who} gets in touch` : `${v.v.who} asks for help`) : v.title;
  if (v.id === 'wedding') return showEvent();
  const clue = v.id === 'circle' && v.v.asked ? `<div class="insight clue" style="--ic:var(--violet)"><span class="lbl">You asked questions</span><p>${esc(v.v.clue)}</p></div>` : '';
  openModal(`
    <div class="decide">
      <div class="dec-face">${face.html}</div>
      <span class="kicker">${esc(face.name)} · Age ${run.age}</span>
      <h2>${esc(title)}</h2>
      <p class="dec-text">${esc(v.text)}</p>
      ${face.hype ? `<p class="hype-note">${A.icon('warn', 18, '')} You've seen this face before.</p>` : ''}
      ${clue}
      <div class="choices">${v.choices.map((c, i) => `<button class="choice-card ${c.act === 'ask' ? 'ask' : ''}" data-act="choose" data-i="${i}" ${c.ok ? '' : 'disabled'}><b>${esc(c.label)}</b>${c.note || !c.ok ? `<small>${c.ok ? fxIcons(c.note) : 'Not enough cash'}</small>` : ''}</button>
        ${c.math && run.think ? `<button class="linkish math-btn" data-act="math" data-i="${i}">What are the odds?</button><div class="math" id="math-${i}" hidden>${mathHTML(c.math)}</div>` : ''}`).join('')}</div>
    </div>`);
}

function outcomeScreen(text) {
  const lesson = run.eventLesson;
  openModal(`
    <div class="decide outcome-box">
      <span class="kicker">What happened</span>
      <p class="outcome">${esc(text || 'Done.')}</p>
      <p class="muted">Net worth ${f(E.netWorth(run))} · Joy ${Math.round(run.joy)}</p>
      ${lesson ? `<details class="why"><summary>Want to understand why?</summary>${lessonHTML(lesson)}</details>` : ''}
      <button class="btn primary wide" data-act="close-go">Continue</button>
    </div>`);
}

// ------------------------------------------------------------------ one year later

function yearTransition(res) {
  const flows = res.flows || [];
  const sumF = (pred) => flows.filter(pred).reduce((s, x) => s + x.v, 0);
  const isIncome = (x) => x.label === 'Salary' || x.label.endsWith('\'s pay') || x.label === 'Money from your children';
  const income = sumF(isIncome);
  const expenses = sumF((x) => x.v < 0 && !['Mortgage interest'].includes(x.label));
  const rowG = (ids) => res.rows.filter((r) => ids.includes(r.id)).reduce((s, r) => s + r.gain, 0);
  const investments = rowG(['save', 'index', 'stocks', 'crypto', 'fx']);
  const property = rowG(['prop']) + sumF((x) => ['Rent', 'Mortgage interest', 'Farm harvests'].includes(x.label));
  const business = rowG(['biz']) + sumF((x) => x.label.startsWith('Business profit'));
  const line = (k, v) => (Math.abs(v) > 0.5 ? `<div><span>${k}</span><b class="${cls(v)}">${f(v, true)}</b></div>` : '');
  const W = A.WEATHER[res.state];
  const crash = res.state === 'crash' || res.seqHit;
  const risky = res.rows.filter((r) => r.before > 0);
  const port = risky.reduce((s, r) => s + r.gain, 0) / Math.max(1, risky.reduce((s, r) => s + r.before, 0));
  const ch = res.chapter ? CHAPTERS.find((c) => c.id === res.chapter) : null;
  const tip = (res.moments || [])[0];
  openModal(`
    <div class="year-card">
      ${ch ? `<div class="chapter-banner"><span class="kicker">A new chapter</span><h2>${esc(ch.name)}</h2><p>${esc(ch.line)}</p></div>` : ''}
      <div class="one-year">${run.ypt === 1 ? 'One year later…' : `${run.ypt} years later…`}</div>
      <div class="years">Age ${res.age0} → ${res.age1}</div>
      <div class="play-scene ${res.nw1 >= res.nw0 ? 'rise' : 'fall'}">${sceneFor(run, { mood: res.state, expr: res.state === 'crash' ? 'shocked' : res.nw1 >= res.nw0 ? 'cheer' : 'tired' })}</div>
      <div class="mood flip" style="--mc:${STATE_INFO[res.state].color}">${esc(W.word.toUpperCase())}</div>
      ${crash ? `<div class="crash-box"><b>${res.seqHit ? 'A LATE CRASH' : 'MARKET CRASH'}</b>${risky.map((r) => `<div><span>${A.icon(A.PLAIN[r.id].icon, 20, '')} ${esc(A.PLAIN[r.id].label)}</span><b class="${cls(r.pct)}">${E.pct(r.pct, 0)}</b></div>`).join('')}${risky.length ? `<div class="tot"><span>Your investments</span><b class="${cls(port)}">${E.pct(port, 0)}</b></div>` : ''}</div>` : ''}
      <div class="flows summary">${line('Income', income)}${line('Expenses', expenses)}${line('Investments', investments)}${line('Property and land', property)}${line('Business', business)}</div>
      <div class="big-nw"><span class="lbl">Net worth</span><span class="nw-from">${f(res.nw0)} →</span><b id="roll" class="${res.nw1 >= res.nw0 ? 'up' : 'down'}">${f(res.nw0)}</b></div>
      ${res.freedom && !res.result ? `<div class="freedom-box"><span class="kicker">You did it</span><h2>FREE AT ${run.age}</h2><p>Your money now pays for your whole life. What now?</p><div class="choices"><button class="choice-card" data-act="free-keep"><b>Keep working</b><small>More money, more to give</small></button><button class="choice-card" data-act="free-retire"><b>Retire</b><small>Work is optional now</small></button><button class="choice-card" data-act="end-game"><b>See my life story</b><small>End here</small></button></div></div>` : ''}
      ${res.goalDone ? `<div class="golden goal-done">${A.icon('flag', 36, '')}<div><span class="kicker">Goal reached</span><b>${esc(res.goalDone.title)}</b><p>${esc(res.goalDone.reward)}</p></div></div>` : ''}
      ${(res.cardsEarned || []).map((c) => `<div class="golden card-earned">${A.cardPic(c.id, 40)}<div><span class="kicker">You became</span><b>${esc(c.name)}</b><p>${esc(c.why)} ${esc(c.text)}</p></div></div>`).join('')}
      ${res.golden ? `<div class="golden">${A.icon('sparkle', 40, '')}<div><span class="kicker">Golden event</span><b>${esc(res.golden.title)}</b><p>${esc(res.golden.text)}</p></div></div>` : ''}
      ${res.milestones && res.milestones.length ? `<div class="unlock-list">${res.milestones.map((m) => `<span>${A.icon('trophy', 16, '')} ${esc(E.MILESTONES[m])}</span>`).join('')}</div>` : ''}
      ${res.envelope ? `<button class="envelope ${res.envelope.big ? 'big' : ''}" data-act="envelope">${A.icon('envelope', 44, '')}<span><b>Mystery envelope</b><small>Tap to open</small></span></button>` : ''}
      ${res.notes.length ? `<div class="notes">${res.notes.slice(0, 3).map((n) => `<p>${esc(n)}</p>`).join('')}</div>` : ''}
      ${tip ? `<details class="why"><summary>${A.castFace(guideId(), 'happy', 28, '')} ${esc(guideName())} has a thought</summary>${lessonHTML(tip.p, tip.text)}</details>` : ''}
      <details class="why"><summary>See the details</summary>
        <ul class="rows">${res.rows.map((r) => `<li><span class="r-name">${A.icon(A.PLAIN[r.id].icon, 22, '')}${esc(A.PLAIN[r.id].label)}</span><span class="${cls(r.gain)}">${f(r.gain, true)}</span><span class="p ${cls(r.pct)}">${E.pct(r.pct, 1)}</span></li>`).join('')}</ul>
        <div class="flows">${flows.map((x) => `<div><span>${esc(x.label)}</span><b class="${cls(x.v)}">${f(x.v, true)}</b></div>`).join('')}</div>
        ${res.fc ? `<p class="why">Your forecast: ${pc(res.fc.p)}. The index ${res.fc.up ? 'did' : 'did not'} beat inflation.</p>` : ''}
      </details>
      <button class="btn primary wide" data-act="year-go" id="go-on">${res.result ? 'See your life story' : run.pending ? 'Next: your new message' : 'Continue'}</button>
    </div>`);
  setTimeout(() => rollNumber(document.getElementById('roll'), res.nw0, res.nw1, 1000), 350);
  const delta = res.nw1 - res.nw0;
  if (res.state === 'crash') { SFX.crash(); shake(); buzz([60, 40, 120]); } else if (delta >= 0) SFX.gain(); else SFX.loss();
  if (res.freedom || res.goalDone || (res.cardsEarned || []).length) setTimeout(() => { SFX.win(); coinBurst(60); }, 900);
  if (res.golden) setTimeout(() => { SFX.win(); coinBurst(60); }, 900);
  lastEnvelope = res.envelope || null;
  pendingResult = res.result || null;
  if (!res.freedom) startAutoplay();
}
let pendingResult = null;

// ------------------------------------------------------------------ Life: home, car, partner, children

const starStr = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

function lifeTab() {
  const H = HOMES[run.home.id];
  const D = DISTRICTS[run.home.district];
  const lc = E.lifeCosts(run);
  const st = E.stars(run);
  const can = E.canAct(run) && !E.atSea(run);
  const locked = E.lifeLocked(run);
  const L = LIFESTYLES;
  return `
    <section class="sec life-home">
      <div class="sec-h"><h2>${A.icon('house', 26, '')} Home</h2><button class="btn small" data-act="move" ${can ? '' : 'disabled'}>Move ▸</button></div>
      <div class="life-card">${A.homePic(run.home.id, 84)}<div><b>${esc(H.name)}</b><small>${esc(D.name)} · ${run.home.own ? 'You own it' : `Rent ${f(lc.rent)}/yr`}</small><small>Security <span class="stars" aria-label="${st} of 5 stars">${starStr(st)}</span> · Flood risk ${D.flood >= 0.5 ? 'medium–high' : 'low'}</small></div></div>
      <div class="sec-row">${[['levy', 'Estate levy', `${f(0.02 * run.salary)}/yr`], ['guard', 'Private guard', `${f(0.05 * run.salary)}/yr`]].map(([k, name, cost]) => `<button class="toggle-row" data-act="security" data-k="${k}" role="switch" aria-checked="${!!run.home[k]}" ${can ? '' : 'disabled'}><span style="text-align:left"><b>${A.icon('shield', 18, '')} ${name}</b><small>+1 star · ${cost}</small></span><span class="switch ${run.home[k] ? 'on' : ''}"></span></button>`).join('')}
        <button class="toggle-row" data-act="security" data-k="cctv" ${can && !run.home.cctv ? '' : 'disabled'}><span style="text-align:left"><b>${A.icon('cctv', 18, '')} CCTV and alarm</b><small>${run.home.cctv ? 'Installed: +1 star' : `+1 star · one-off ${f(0.08 * run.salary)}`}</small></span><span class="switch ${run.home.cctv ? 'on' : ''}"></span></button></div>
    </section>
    <section class="sec">
      <div class="sec-h"><h2>${A.icon('car', 26, '')} Car</h2><button class="btn small" data-act="carsheet" ${can ? '' : 'disabled'}>Change ▸</button></div>
      <div class="life-card">${run.car.id === 'none' ? A.icon('crowd', 64, '') : A.carPic(run.car.id, 84)}<div><b>${esc(CARS[run.car.id].name)}</b><small>${run.car.id === 'none' ? esc(CARS.none.long) : `Worth ${f(run.car.v)}${run.car.loan > 0 ? ` · loan ${f(run.car.loan)}` : ''}`}</small><small>Running costs ${f(lc.car)}/yr</small></div></div>
    </section>
    <section class="sec">
      <span class="lbl">Everyday spending${locked ? ' (locked)' : ''}</span>
      <div class="rooms">${L.map((l, i) => `<button class="room-b ${run.life === i ? 'on' : ''}" data-act="life" data-lv="${i}" ${!can || locked ? 'disabled' : ''} aria-label="${l.name}, joy ${l.joy >= 0 ? '+' : ''}${l.joy}">${A.room(i, 52)}<b>${l.name}</b><small>${A.icon(l.joy >= 0 ? 'smile' : 'sad', 14, '')}${l.joy >= 0 ? '+' : ''}${l.joy}</small></button>`).join('')}</div>
      <span class="note">${esc(L[run.life].blurb)} Your clothes follow it too. ${run.life === 0 ? 'Two frugal years in a row bring burnout.' : ''}</span>
      <div class="joy">${A.joyFace(run.joy, 24)}<div class="jbar"><i style="width:${run.joy}%;background:${run.joy < 25 ? 'var(--loss)' : 'var(--pink)'}"></i></div><b class="num">${Math.round(run.joy)}</b></div>
    </section>
    <section class="sec"><button class="big-row" data-act="costs">${A.icon('bowl', 28, '')}<span><b>Where your costs go</b><small>${f(E.costs(run))} a year</small></span><span>▸</span></button></section>
`;
}

function trophiesAll() {
  const t = P.trophies || {};
  const g = (run && run.got) || {};
  const u = (k) => [...new Set([...(t[k] || []), ...(g[k] || [])])];
  return { homes: u('homes'), cars: u('cars'), districts: u('districts'), zones: u('zones'), golden: u('golden') };
}

function costsSheet() {
  const lc = E.lifeCosts(run);
  const row = (label, v) => (v > 0 ? `<div><span>${label}</span><b>${f(v)}</b></div>` : '');
  openSheet(`
    ${sheetHead('', 'Where your costs go')}
    <div class="brk">
      ${row(`Everyday spending (${LIFESTYLES[run.life].name.toLowerCase()}${run.partner ? ', for two' : ''})`, E.everyday(run))}
      ${row('Rent', lc.rent)}${row('Home upkeep', lc.upkeep)}${row('Property tax', lc.tax)}
      ${row('Car running costs', lc.car)}${row('Car loan interest', lc.loan)}${row('Security', lc.security)}
      ${row('Children (food, clothes, school fees)', lc.kids)}${row('Nanny', lc.nanny)}
      <div class="tot"><span>Living costs</span><b>${f(E.costs(run))}/yr</b></div>
    </div>
    <p class="note">Your Freedom Number is 25 × these costs. A bigger house, a better car or a pricier school all raise it.</p>
    <button class="btn wide" data-act="close">Close</button>`);
}

let moveCtx = null;
function moveSheet() {
  const c = moveCtx || (moveCtx = { home: run.home.id, district: run.home.district, buy: false, mortgage: true, keepOld: false });
  const price = HOMES[c.home].buy ? E.homePrice(run, c.home, c.district) : 0;
  const rent = E.homeRent(run, c.home, c.district);
  const equity = c.buy ? (c.mortgage ? price * (1 - E.ltv(run)) : price) : 0;
  const ok = !(c.home === run.home.id && c.district === run.home.district && c.buy === run.home.own) && (!c.buy || HOMES[c.home].buy);
  openSheet(`
    ${sheetHead('', 'Move home')}
    <span class="lbl">What kind of home?</span>
    <div class="pick-grid">${HOME_ORDER.map((id) => `<button class="pick ${c.home === id ? 'on' : ''}" data-act="mv" data-k="home" data-v="${id}">${A.homePic(id, 60)}<b>${esc(HOMES[id].name)}</b><small>${HOMES[id].joy >= 0 ? '+' : ''}${HOMES[id].joy} joy · ${HOMES[id].beds} bed${HOMES[id].beds === 1 ? '' : 's'}</small></button>`).join('')}</div>
    <span class="lbl">Where?</span>
    <div class="choice-list">${DISTRICT_ORDER.map((id) => { const D = DISTRICTS[id]; return `<button class="choice ${c.district === id ? 'on' : ''}" data-act="mv" data-k="district" data-v="${id}"><span class="av">${A.icon('shield', 34, '')}</span><span><b>${esc(D.name)} <span class="stars">${starStr(D.security)}</span></b><small>${esc(D.blurb)} Prices ×${D.price}.${D.commute ? ' Long commute (−3 joy).' : ''}</small></span></button>`; }).join('')}</div>
    <div class="seg"><button class="${!c.buy ? 'on' : ''}" data-act="mv" data-k="buy" data-v="0">Rent<small>${f(rent)}/yr</small></button><button class="${c.buy ? 'on' : ''}" data-act="mv" data-k="buy" data-v="1" ${HOMES[c.home].buy ? '' : 'disabled'}>Buy<small>${HOMES[c.home].buy ? f(price) : 'Not for sale'}</small></button></div>
    ${c.buy ? `<label class="check"><input type="checkbox" id="mv-mort" ${c.mortgage ? 'checked' : ''}> Borrow ${Math.round(E.ltv(run) * 100)}% (mortgage at ${pctS(E.mortRate(run))}). You pay ${f(price * (1 - E.ltv(run)))} now.</label>` : ''}
    ${run.home.own ? `<label class="check"><input type="checkbox" id="mv-keep" ${c.keepOld ? 'checked' : ''}> Keep my old home and rent it out (instead of selling it)</label>` : ''}
    <p class="note">${c.buy ? `You need ${f(equity)} in cash, plus moving costs. The home you live in saves rent but earns none; upkeep is ${Math.round(HOMES[c.home].upkeep * 100)}% of its value a year.` : 'Renting keeps your cash free. Rent rises with prices.'}${run.kids.length && HOMES[c.home].beds < 2 ? ' <b>Children need a home with at least two bedrooms.</b>' : ''}</p>
    <button class="btn primary wide" data-act="mv-go" ${ok ? '' : 'disabled'}>Move here</button>`);
}

function carSheet() {
  const can = E.canAct(run);
  openSheet(`
    ${sheetHead('', 'Change your car')}
    <p class="muted">A car is a doodad: it costs money to run and loses value every year. It also makes life easier and happier. Your old car is traded in.</p>
    <div class="choice-list">${CAR_ORDER.filter((id) => id !== run.car.id).map((id) => {
    const C = CARS[id];
    const price = E.carPrice(run, id);
    return `<div class="choice car-choice">${id === 'none' ? A.icon('crowd', 50, '') : A.carPic(id, 70)}<span><b>${esc(C.name)}</b><small>${id === 'none' ? 'Sell your car and take the bus' : `${f(price)} · runs ${f(C.run * E.unit(run))}/yr · loses ${Math.round(C.dep * 100)}%/yr`} · ${C.joy >= 0 ? '+' : ''}${C.joy} joy</small>
      <span class="share-actions">${id === 'none' ? `<button class="btn small" data-act="buycar" data-id="none" ${can ? '' : 'disabled'}>Sell car</button>` : `<button class="btn small" data-act="buycar" data-id="${id}" ${can ? '' : 'disabled'}>Pay cash</button><button class="btn small" data-act="buycar" data-id="${id}" data-loan="1" ${can ? '' : 'disabled'}>On a loan</button>`}</span></span></div>`;
  }).join('')}</div>
    <p class="note">Car loans cost ${pctS(E.carLoanRate(run))} a year and are paid off over four years.</p>
    <button class="btn wide" data-act="close">Close</button>`);
}

// ------------------------------------------------------------------ Map: land across your country

function mapTab() {
  const zones = ZONE_ORDER.map((id) => ({ id, name: zoneName(id), plots: run.land.filter((l) => l.zone === id).reduce((s, l) => s + l.plots, 0), news: run.market[run.turn].zone && run.market[run.turn].zone.zone === id }));
  const plots = run.land.map((l, i) => {
    const v = l.plots * E.plotPrice(run, l.zone);
    return `<div class="plot-row">${A.icon('plot', 36, '')}<div><b>${esc(zoneName(l.zone))}</b><small>${esc(TITLES[l.title].short)}${l.checked ? '' : ' (unchecked)'} · worth ${f(v)} · paid ${f(l.paid)}</small>
      <div class="seg">${[['hold', 'Hold'], ['farm', 'Farm'], ['build', 'Build to rent']].map(([u, name]) => `<button class="${l.use === u || (u === 'build' && l.built) ? 'on' : ''}" data-act="landuse" data-i="${i}" data-u="${u}" ${E.canAct(run) && !l.built && !(u === 'farm' && ZONE_TYPES[l.zone].farm <= 0) ? '' : 'disabled'}>${name}${u === 'build' ? `<small>${f(2 * v)}</small>` : u === 'farm' && ZONE_TYPES[l.zone].farm > 0 ? `<small>~${pctS(E.farmRate(run, l.zone))}/yr</small>` : ''}</button>`).join('')}<button data-act="sellland" data-i="${i}" ${E.canAct(run) && l.bt !== run.turn ? '' : 'disabled'}>Sell<small>${f(v * 0.94)}</small></button></div></div></div>`;
  }).join('');
  return `
    <section class="sec">
      <div class="sec-h"><h2>${A.icon('map', 26, '')} Land in ${esc(COUNTRIES[run.currency].name)}</h2></div>
      ${A.countryMap(zones, { country: COUNTRIES[run.currency].name })}
      <p class="note">Tap a zone to see this year's plot for sale. Read the news: roads, airports and floods move land prices, and some headlines are only rumours.</p>
    </section>
    ${run.market[run.turn].zone ? `<div class="chip-line" style="border-color:var(--gold);color:var(--gold)">${A.icon('tv', 22, '')} ${esc(run.market[run.turn].zone.text)}</div>` : ''}
    <section class="sec"><div class="sec-h"><h2>Your plots</h2><span class="note">${f(E.landValue(run))}</span></div>${plots || '<p class="muted">You own no land yet.</p>'}</section>`;
}

function zoneSheet(z) {
  const Z = ZONE_TYPES[z];
  const o = E.landOffer(run, z);
  const can = E.canAct(run);
  const n = run.market[run.turn].zone;
  openSheet(`
    ${sheetHead('', zoneName(z))}
    <span class="kicker">${esc(Z.name)}</span>
    <dl class="stats"><div><dt>Plot price</dt><dd>${f(E.plotPrice(run, z))}</dd></div><div><dt>Grows with</dt><dd style="font-size:13px">${esc(Z.driver)}</dd></div><div><dt>Main risk</dt><dd style="font-size:13px">${esc(Z.risk)}</dd></div></dl>
    ${n && n.zone === z ? `<div class="insight" style="--ic:var(--gold)"><span class="lbl">In the news</span><p>${esc(n.text)}</p></div>` : ''}
    <div class="insight" style="--ic:var(--violet)"><span class="lbl">For sale this year</span>
      ${o.sold ? '<p>Sold. Another plot comes up next year.</p>' : `<p>One plot for <b>${f(o.price)}</b>. The seller says: <b>${esc(TITLES[o.claimed].name)}</b>.</p>
      ${o.checked ? `<p class="${o.truth === o.claimed ? 'up' : 'down'}">${A.icon(o.truth === o.claimed ? 'tick' : 'warn', 20, '')} Survey and registry search: <b>${esc(TITLES[o.truth].name)}</b>. ${o.truth === o.claimed ? 'The papers are what the seller said.' : 'The papers are worse than the seller said.'}</p>` : `<p class="muted">Papers can be worse than claimed. Over ten years, problems hit about ${Math.round((1 - Math.pow(1 - TITLES.full.hazard, 10)) * 100)}% of full titles, ${Math.round((1 - Math.pow(1 - TITLES.progress.hazard, 10)) * 100)}% in progress, and ${Math.round((1 - Math.pow(1 - TITLES.receipt.hazard, 10)) * 100)}% with a family receipt only.</p>`}
      <div class="share-actions">${o.checked ? '' : `<button class="btn" data-act="landcheck" data-id="${z}" ${can && run.cash >= o.checkCost ? '' : 'disabled'}>Check the papers (${f(o.checkCost)})</button>`}<button class="btn primary" data-act="landbuy" data-id="${z}" ${can && run.cash >= o.price ? '' : 'disabled'}>Buy (${f(o.price)})</button></div>`}
    </div>
    ${Z.farm > 0 ? `<p class="note">Farming here yields about ${pctS(E.farmRate(run, z))} of the land's value a year, more in good weather.${run.char === 'farmer' ? ' You are a farmer: +50%.' : ''}</p>` : '<p class="note">Too built-up to farm. Hold it, or build to rent.</p>'}
    <button class="btn wide" data-act="close">Close</button>`);
}

// ------------------------------------------------------------------ Circle: people and giving



// ------------------------------------------------------------------ Me


function rulesSheet() {
  openSheet(`${sheetHead('', 'This world\'s rules')}<p class="muted">Every game draws two rules, so the best plan changes from run to run.</p>${(run.rules || []).map((id) => `<div class="insight" style="--ic:var(--orange)"><b>${esc(WORLD_RULES[id].name)}</b><p>${esc(WORLD_RULES[id].text)}</p></div>`).join('')}<button class="btn wide" data-act="close">Got it</button>`);
}

function thinkSheet() {
  openSheet(`${sheetHead('', 'Think in probabilities')}${thinkHTML()}${(() => { const mm = E.mrMarket(run); return `<div class="insight" style="--ic:var(--sky)"><span class="lbl">Mr. Market</span><p>${mm.mood}, at ${mm.v.toFixed(2)}× fair value. ${mm.v < 0.9 ? 'A bargain: a margin of safety.' : mm.v > 1.15 ? 'Expensive: expect weaker years ahead.' : 'Close to fair value.'}</p></div>`; })()}<p class="note">Kelly bet sizing appears under "Show the maths" on risky choices in life events.</p><button class="btn wide" data-act="close">Close</button>`);
}

// ------------------------------------------------------------------ learning panels

const moodName = (s) => STATE_INFO[s].name;

function thinkHTML() {
  if (run.eraId) return '';
  const learnM = run.learnMode;
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

function nextTurn() {
  if (!run || run.phase !== 'alloc') return;
  if (run.pending) { SFX.tap(); decisionScreen(); return; }
  stopTimer();
  closeLayer();
  const res = E.live(run);
  if (!res) return;
  persist();
  if (res.swan) {
    const s = SWANS.find((x) => x.id === res.swan);
    SFX.swan(); buzz([80, 60, 200]);
    openModal(`<div class="swan swan-in"><span class="kicker">Breaking news</span><div class="mood">${esc(s.name)}</div><p class="outcome">${esc(s.text)}</p><button class="btn primary wide" data-act="playout">Brace yourself</button></div>`);
    pendingPlay = res;
    return;
  }
  yearTransition(res);
}
let pendingPlay = null;


// 16+: after the reveal, the next step starts by itself unless you tap.
let autoTimer = 0;
let lastEnvelope = null;
function stopAutoplay() { if (autoTimer) clearInterval(autoTimer); autoTimer = 0; const b = document.getElementById('go-on'); if (b && b.dataset.label) b.textContent = b.dataset.label; }
function startAutoplay() {
  stopAutoplay();
  if (!adult() || !P.settings.autoplay || calm()) return;
  const b = document.getElementById('go-on');
  if (!b) return;
  b.dataset.label = b.textContent;
  let n = 6;
  autoTimer = setInterval(() => {
    n -= 1;
    const btn = document.getElementById('go-on');
    if (!btn) { stopAutoplay(); return; }
    if (n <= 3 && n > 0) btn.textContent = `${btn.dataset.label} in ${n}…`;
    if (n <= 0) { stopAutoplay(); btn.click(); }
  }, 1000);
}

function eventCast(id) {
  const [who, prop] = A.EVENT_ART[id] || ['anchor', 'tv'];
  const castId = who === 'guide' ? guideId() : who;
  const expr = who === 'hype' ? 'sly' : ['layoff', 'burnout', 'blacktax', 'theft', 'hack', 'flood'].includes(id) ? 'tired' : ['wedding', 'baby', 'inherit', 'bonus', 'promo', 'raise'].includes(id) ? 'cheer' : 'happy';
  const name = who === 'guide' ? guideName() : A.CAST[who].name;
  return { castId, prop, expr, name, hype: who === 'hype' };
}

// The face at the top of an event: your partner, the person asking, or the cast.
function eventFace(v) {
  const P_ = run.partner;
  if (v.cat === 'Partner' && P_ && P_.look && Object.keys(P_.look).length) return { html: A.lookPerson(P_.look, { age: run.age, size: 110, sex: P_.sex, expr: v.id === 'separation' ? 'worried' : 'neutral', label: P_.name }), name: P_.name, prop: v.id === 'p_upgrade' ? 'car' : 'payslip' };
  if (v.id === 'circle') {
    const x = v.v;
    if (x.look) return { html: A.lookPerson(x.look, { age: run.age + 10, size: 110, expr: 'neutral', label: x.who }), name: `${x.who} · ${x.rel}`, prop: x.offer ? 'hand' : 'envelope' };
    return { html: A.castFace('hype', 'neutral', 110, x.who), name: x.who, prop: 'phone' };
  }
  if (v.id === 'wedding') return { html: '', name: 'Love', prop: 'rings' };
  if (v.cast) {
    const c = run.circle.find((x) => x.role === v.cast);
    if (c) return { html: A.lookPerson(c.look, { age: run.age + (c.ageGap || 0), size: 110, sex: c.sex, expr: v.cast === 'rival' ? 'sly' : 'neutral', label: c.name }), small: A.lookPerson(c.look, { age: run.age + (c.ageGap || 0), size: 48, sex: c.sex, label: c.name }), name: `${c.name} · ${c.rel}`, prop: 'phone' };
  }
  const ec = eventCast(v.id);
  return { html: A.castFace(ec.castId, ec.expr, 110, ec.name), name: ec.name, prop: ec.prop, hype: ec.hype };
}

function showEvent() {
  const v = E.eventView(run);
  if (!v) return;
  const face = eventFace(v);
  const title = v.id === 'circle' ? (v.v.offer ? `${v.v.who} has an offer` : v.v.type === 'fraudster' ? `${v.v.who} gets in touch` : `${v.v.who} asks for help`) : v.title;
  const clue = v.id === 'circle' && v.v.asked ? `<div class="insight clue" style="--ic:var(--violet)"><span class="lbl">You asked questions</span><p>${esc(v.v.clue)}</p></div>` : '';
  if (v.id === 'wedding') {
    openModal(`
    <div class="ev-card"><span class="kicker">Love · Age ${run.age}</span><h2>${esc(v.title)}</h2><p>${esc(v.text)}</p></div>
    <div class="cands">${v.choices.map((c, i) => (c.person ? `<button class="cand" data-act="choose" data-i="${i}" ${c.ok ? '' : 'disabled'}>${A.lookPerson(c.person.look, { age: run.age, size: 84, sex: c.person.sex, label: c.person.name })}<b>${esc(c.person.name)}</b><small>Clue: ${esc(c.person.clue)}</small></button>` : '')).join('')}</div>
    <div class="choices">${v.choices.map((c, i) => (c.person ? '' : `<button class="choice-btn" data-act="choose" data-i="${i}"><b>${esc(c.label)}</b><small>${esc(c.note)}</small></button>`)).join('')}</div>
    <p class="note">A clue is right about 70% of the time. The truth comes out over your first years together.</p>`);
    return;
  }
  openModal(`
    <div class="ev-card ${face.hype ? 'hype' : ''}">
      <div class="ev-art"><span class="ev-cast">${face.html}</span><span class="ev-prop">${A.icon(face.prop, 84, esc(title))}</span></div>
      <span class="kicker">${esc(face.name)} · ${esc(v.cat)} · Age ${run.age}</span>
      <h2>${esc(title)}</h2>
      <p>${esc(v.text)}</p>
      ${face.hype ? `<p class="hype-note">${A.icon('warn', 18, '')} You've seen this face before.</p>` : ''}
    </div>
    ${clue}
    <div class="choices">${v.choices.map((c, i) => `<button class="choice-btn ${c.act === 'ask' ? 'ask' : ''}" data-act="choose" data-i="${i}" ${c.ok ? '' : 'disabled'}><b>${esc(c.label)}</b><small>${c.ok ? fxIcons(c.note) : 'Not enough cash'}</small></button>
      ${c.math && run.think ? `<button class="linkish math-btn" data-act="math" data-i="${i}">Show the maths</button><div class="math" id="math-${i}" hidden>${mathHTML(c.math)}</div>` : ''}`).join('')}</div>`);
}


const TYPE_COLOR = { Skill: 'var(--gain)', Tool: 'var(--sky)', Gamble: 'var(--orange)', Offer: 'var(--pink)', Legendary: 'var(--gold)' };

function cardHTML(c, act, extra = '') {
  const t = A.TYPE_ICON[c.type];
  return `<button class="gcard ${c.legendary ? 'legend' : ''} ${extra}" style="--tc:${TYPE_COLOR[c.type]}" ${act ? `data-act="${act}" data-id="${c.id}"` : 'disabled'}>
    <span class="card-pic">${A.cardPic(c.id, 64)}</span>
    <span class="card-body"><span class="ty">${t === 'hype' ? A.icon('warn', 14, '') : A.icon(t, 14, '')} ${esc(c.type)}</span><b>${esc(c.name)}</b><p>${fxIcons(c.text)}</p></span></button>`;
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
  for (const k of Object.keys(P.trophies)) P.trophies[k] = [...new Set([...(P.trophies[k] || []), ...((run.got && run.got[k]) || [])])];
  if (res.life && res.reason !== 'quit') P.bestStars = Math.max(P.bestStars || 0, res.life.stars);
  if (run.mode === 'sprint' && !P.sprintDone) { P.sprintDone = true; res.sprintUnlock = true; }
  if (run.mode === 'daily' && res.reason !== 'quit') bumpStreak();
  P.principles = [...new Set([...(P.principles || []), ...(res.seenP || [])])];
  P.fcAll = [...(P.fcAll || []), ...run.fc.map((x) => ({ p: x.p, ideal: x.ideal, up: x.up }))].slice(-400);
  if (run.mode === 'daily') P.daily[run.seed.replace('daily-', '')] = { score: res.score, reason: res.reason, age: res.age, grid: E.emojiGrid(run), stars: res.life ? res.life.stars : 0 };
  if (run.mode === 'weekly' && res.reason !== 'quit') P.weekly[weekNo()] = Math.max(P.weekly[weekNo()] || 0, res.score);
  if (run.mode === 'era') { const prev = P.eras[run.eraId]; P.eras[run.eraId] = { score: Math.max(prev ? prev.score : 0, res.score), won: won || (prev && prev.won) }; }
  if (run.mode === 'duel') { const code = run.seed.replace('duel-', ''); const prev = P.duels[code]; if (!prev || res.score > prev.score) P.duels[code] = { score: res.score, reason: res.reason, age: res.age, stars: res.life ? res.life.stars : 0 }; }
  res.gained = gained;
  res.newTerms = newTerms;
  res.unlocks = [
    ...CARDS.filter((c) => c.unlock > before && c.unlock <= P.wisdom).map((c) => `Card: ${c.name}`),
    ...Object.values(CHARACTERS).filter((c) => c.unlock > before && c.unlock <= P.wisdom).map((c) => c.name),
    ...ERAS.filter((e) => e.unlock > before && e.unlock <= P.wisdom).map((e) => `Era: ${e.name}`),
  ];
  if (res.ascUp) res.unlocks.push(`Ascension ${res.ascUp}`);
  if (res.sprintUnlock) res.unlocks.unshift('The full life: every mode, and a whole lifetime to play');
  const done = run;
  run = null;
  persist();
  if (won) {
    SFX.win(); buzz([40, 40, 40, 40, 200]);
    openModal(`<div class="swan swan-in"><span class="kicker">${res.reason === 'free' ? 'Your life' : 'Era beaten'}</span><div class="mood" style="color:var(--gold)">${res.reason === 'free' ? `FREE AT ${res.freeAge ?? res.age}` : 'YOU MADE IT'}</div><p class="outcome">${res.reason === 'free' ? 'Your money paid for your life. Here is the story of how.' : 'You came through the storm with your target met.'}</p><button class="btn primary wide" data-act="results">See your life story</button></div>`);
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
    case 'free': return ['win', `Free at ${r.freeAge ?? r.age}`];
    case 'target': return ['win', 'Era beaten'];
    case 'missed': return ['lose', 'Target missed'];
    case 'bankrupt': return ['lose', `Bankrupt at ${r.age}`];
    case 'quit': return ['lose', 'Run abandoned'];
    case 'clock': if (r.sprint) return ['win', `Ten years done, age ${r.age}`]; return ['lose', `Still working at ${r.age}`];
    default: return ['lose', `Still working at ${r.age}`];
  }
}

function shareText(done) {
  const r = done.result;
  const outcome = r.reason === 'free' ? `Free at ${r.age}` : r.reason === 'bankrupt' ? `Bankrupt at ${r.age}` : `Still working at ${r.age}`;
  const st = r.life ? ` · Life ${r.life.stars}★` : '';
  const link = resultLink(done);
  if (done.mode === 'daily') return `Tycoon Rush Daily ${done.seed.replace('daily-', '')}\n${E.emojiGrid(done)}\n${outcome}${st} · Score ${r.score.toLocaleString()}\n${link}`;
  if (done.mode === 'duel') return `Tycoon Rush duel ${done.seed.replace('duel-', '')}: ${outcome}${st}, score ${r.score.toLocaleString()}. Same market, can you beat me?\n${E.emojiGrid(done)}\n${link}`;
  return `Tycoon Rush by Ebims: ${outcome}${st}, score ${r.score.toLocaleString()}.\n${E.emojiGrid(done)}\n${link}`;
}

const starsText = (n) => `${'★'.repeat(Math.floor(n))}${n % 1 ? '½' : ''}${'☆'.repeat(5 - Math.ceil(n))}`;

function lifeScoreHTML(r) {
  if (!r.life) return '';
  const L = r.life;
  const bar = (name, v, max) => `<div class="ls-part"><span>${name}</span><div class="jbar"><i style="width:${Math.round((v / max) * 100)}%"></i></div><b>${v.toFixed(1)}/${max}</b></div>`;
  return `<div class="life-score"><span class="lbl">Life Score</span><div class="stars-big" aria-label="${L.stars} of 5 stars">${starsText(L.stars)}</div>
    ${bar('Freedom', L.parts.freedom, 2)}${bar('Joy', L.parts.joy, 1)}${bar('Family', L.parts.family, 1)}${bar('People', L.parts.people, 1)}
    <p class="note">${r.sprint ? 'Ten years in. A Sprint can\'t reach freedom, but the habits you built here are the ones that get you there.' : 'Free early, happy, a strong family and a good name. Many different lives can reach five stars.'}</p></div>`;
}

function heirHTML(done) {
  const r = done.result;
  if (!adult() || !['free', 'clock'].includes(r.reason) || r.sprint || done.eraId) return '';
  const kid = (r.kids || []).filter((k) => k.age >= 16).sort((a, b) => b.age - a.age)[0];
  if (!kid) return '';
  return `<button class="big-row heir" data-act="heir">${kid.look ? A.lookPerson(kid.look, { age: kid.age, size: 56, sex: kid.sex }) : A.icon('family', 44, '')}<span><b>Carry on as ${esc(kid.name)}</b><small>Generation ${(done.gen || 1) + 1}: they inherit ${E.fmt(Math.max(0, r.nw) * 0.9, done.currency)} after costs, and start at ${Math.max(22, kid.age)}.</small></span><span>▸</span></button>`;
}

function results(done) {
  closeLayer();
  lastDone = done;
  const r = done.result;
  const cur = done.currency;
  const F = (n) => E.fmt(n, cur);
  const [tone_, title] = resultTitle(r);
  const S = r.story || { memories: [], whatIf: [] };
  const insights = [];
  if (r.best) insights.push(['var(--gain)', 'Biggest win in the markets', r.best]);
  if (r.worst) insights.push(['var(--loss)', 'Costliest habit', r.worst.text]);
  const share = ['daily', 'duel'].includes(done.mode) || r.reason === 'free';
  const text = shareText(done);
  const moment = (label, m, col) => (m ? `<div class="insight" style="--ic:${col}"><span class="lbl">${label}</span><p><b>${esc(m.title)}</b>${m.text ? ` · ${esc(m.text)}` : ''} <span class="muted">(age ${m.age})</span></p></div>` : '');
  const endMem = { age: r.age, type: 'milestone', title: r.reason === 'free' ? 'Legacy' : r.reason === 'bankrupt' ? 'Starting over' : 'Still working', text: r.reason === 'free' ? `Net worth ${F(r.nw)}, money paying ${F(r.passive)} a year.` : '', impact: 0, tags: [] };
  app.innerHTML = `
  <main class="results">
    <button class="home-pill" data-act="home" aria-label="Home screen">‹ ${A.icon('house', 20, '')}<span>Home</span></button>
    <span class="kicker">Your life · ${esc(E.MODES[done.mode].name)}${done.asc ? ` · Ascension ${done.asc}` : ''}</span>
    <div class="res-scene">${resultScene(done)}</div>
    <h1 class="res-title ${tone_}">AGE ${r.age}</h1>
    <p class="res-sub">${esc(title)}</p>
    <dl class="res-stats six">
      <div><dt>Net worth</dt><dd>${F(r.nw)}</dd></div>
      <div><dt>Passive income</dt><dd>${F(r.passive)}/yr</dd></div>
      <div><dt>Financial freedom</dt><dd>${r.freeAge ? `Age ${r.freeAge}` : 'Not yet'}</dd></div>
      <div><dt>Businesses built</dt><dd>${S.businesses || 0}</dd></div>
      <div><dt>Properties</dt><dd>${S.properties || 0}</dd></div>
      <div><dt>People helped</dt><dd>${S.people || 0}</dd></div>
    </dl>
    ${moment('Biggest success', S.success, 'var(--gain)')}
    ${moment('Biggest mistake', S.mistake, 'var(--loss)')}
    ${moment('Best decision', S.decision, 'var(--gold)')}
    ${lifeScoreHTML(r)}
    ${adult() && r.reason === 'clock' && r.ratio >= 0.85 ? `<button class="chip-line near-miss" data-act="again">${A.icon('flame', 22, '')} You were ${Math.max(1, Math.round((1 - r.ratio) * 100))}% from freedom. One more try? ▸</button>` : ''}
    <section class="sec"><div class="sec-h"><h2>${A.icon('book', 24, '')} Your life, year by year</h2></div>${timelineHTML([...S.memories, endMem], 60)}</section>
    ${S.whatIf && S.whatIf.length ? `<section class="sec whatif"><div class="sec-h"><h2>${A.icon('dice', 24, '')} What if?</h2></div>${S.whatIf.map((w) => `<div class="insight" style="--ic:var(--violet)"><p>${esc(w.text)}, you would have had about <b>${F(w.v)}</b> more.</p></div>`).join('')}<p class="note">Estimates from your own game: the same markets, one different habit.</p></section>` : ''}
    ${heirHTML(done)}
    <button class="btn primary wide" data-act="report">${A.icon('payslip', 24, '')} Get my PDF life report</button>
    <button class="btn wide" data-act="share-card">${A.icon('phone', 22, '')} Share a picture of my life</button>
    ${share ? `<div class="share"><span class="lbl">Share</span><pre id="share-text">${esc(text)}</pre>
      <div class="share-actions"><button class="btn small" data-act="copy">Copy</button><a class="btn small" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">WhatsApp</a></div></div>` : ''}
    <details class="more"><summary>The numbers behind it</summary>
      <div class="score-box"><span class="lbl">Score</span><b>${r.score.toLocaleString()}</b></div>
      <div class="chart-wrap"><canvas class="chart" id="chart"></canvas>
        <div class="legend"><span><i style="background:#3ddc97"></i>Net worth</span><span><i style="background:#ffc53d"></i>Freedom Number (25× costs)</span></div></div>
      <dl class="res-stats"><div><dt>Living costs</dt><dd>${F(r.costs)}/yr</dd></div><div><dt>Joy</dt><dd>${Math.round(r.joy)}/100</dd></div></dl>
      ${insights.map(([c, k, t]) => `<div class="insight" style="--ic:${c}"><span class="lbl">${k}</span><p>${esc(t)}</p></div>`).join('')}
      ${learnResults(r)}
      ${r.scammed ? `<div class="scam-card"><span class="kicker" style="color:var(--pink)">How to spot a scam</span><ol>${SCAM_TIPS.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div>` : ''}
    </details>
    <div class="insight" style="--ic:var(--violet)"><span class="lbl">Wisdom earned</span><p><b>+${r.gained}</b>${r.newTerms.length ? ` · new words: ${r.newTerms.map((t) => esc(GLOSSARY[t][0])).join(', ')}` : ''}</p>
      ${r.unlocks.length ? `<div class="unlock-list">${r.unlocks.map((u) => `<span>${esc(u)}</span>`).join('')}</div>` : ''}</div>
    <div class="share-actions">
      <button class="btn" data-act="feedback">${A.icon('envelope', 22, '')} Send feedback</button>
      <button class="btn" data-act="share-game">${A.icon('phone', 22, '')} Invite a friend</button>
    </div>
    <div class="share-actions">
      <button class="btn primary" data-act="again">Live another life</button>
      <button class="btn" data-act="home">Home</button>
    </div>
  </main>`;
  window.scrollTo(0, 0);
  const det = app.querySelector('details.more');
  if (det) det.addEventListener('toggle', () => { if (det.open) requestAnimationFrame(() => { drawChart(document.getElementById('chart'), r.hist, cur); const cc = document.getElementById('calib'); if (cc && r.forecast) drawCalib(cc, r.forecast.buckets); }); }, { once: true });
}

const won = (r) => r.reason === 'free' || r.reason === 'target';

function resultScene(done) {
  const r = done.result;
  const opts = r.reason === 'free' ? { stage: 4, beach: true, mood: 'boom', expr: 'cheer', label: 'You relax on the beach, free' }
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
    <p><b>The goal:</b> become financially free before 60. That means the money your money makes covers your life, so work becomes a choice.</p>
    <ol class="how">
      <li><b>See your life.</b> Your home, your family, your net worth and your money tree. The tree bears fruit as money starts paying you.</li>
      <li><b>Something happens.</b> Each year brings a message: a friend with a plan, a boss with an offer, a crash, a child's school. Open it and decide.</li>
      <li><b>Manage your money and life</b> if you want: Work, Invest, Life and Opportunity are one tap away.</li>
      <li><b>Live the year.</b> One year later, you see what changed, and the next message is waiting.</li>
    </ol>
    <p class="lbl">Good to know</p>
    <ol class="how">
      <li>People remember how you treated them. Friends you helped tend to help you back.</li>
      <li>Your choices echo: an investment made at 25 can pay off, or go wrong, years later.</li>
      <li>Cards are earned by what you do: hold on through two crashes, pay yourself first for years, own a rental.</li>
      <li>Want the detail? The Money screen has every number, chart and forecast.</li>
      <li>At the end you get your life story: a timeline, your best and worst moments, and a few "what ifs".</li>
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
    ${adult() ? row('autoplay', 'Autoplay', 'After each year\'s reveal, carry on by itself in a few seconds unless you tap.') : ''}
    ${adult() ? row('reminders', 'Reminders', 'A notification when your partner has news or rent is due. Needs permission; works best when the game is installed.') : ''}
    <section class="field"><span class="lbl">Age mode</span><button class="btn wide" data-act="age-screen">${P.ageMode === 'u16' ? 'Under 16 (protected)' : '16 or over'} · change</button></section>
    <section class="field"><span class="lbl">Giving wording (optional)</span><div class="seg">${Object.entries(FAITHS).map(([k, v]) => `<button class="${(P.faith || 'none') === k ? 'on' : ''}" data-act="faith" data-v="${k}">${esc(v.name)}</button>`).join('')}</div><span class="note">Changes only the words (tithe, zakat or charity). It never changes the maths.</span></section>
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
    ${P.streak.n ? `<div class="insight" style="--ic:var(--orange)"><span class="lbl">${A.icon('flame', 18, '')} Streak: ${P.streak.n} day${P.streak.n > 1 ? 's' : ''}</span><p>${adult() ? `Each day in a row adds 1% to your starting cash in new games (up to 30%). Miss a day and it resets, except for one free skip day a week. Streak freezes in hand: ${P.streak.freezes || 0}.` : 'Your streak never resets. Play when you like.'}</p>${adult() ? `<button class="btn small" data-act="freeze" ${P.wisdom >= 20 ? '' : 'disabled'}>Buy a streak freeze (20 wisdom)</button>` : ''}</div>` : ''}
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
  home: () => { setTeaser(); stopAutoplay(); persist(); home(); },
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
  'real-start': () => { P.start = 'me'; saveProfile(); setup('journey'); },
  aim: (d) => { P.setup.aim = Number(d.v); saveProfile(); setup(); },
  intro: (d) => intro(Number(d.step)),
  'region-screen': () => regionScreen(),
  region: (d) => { P.region = d.id; P.settings.currency = REGIONS[d.id].currencies[0]; saveProfile(); SFX.tap(); regionScreen(); },
  'look-screen': () => { if (!P.region) P.region = 'westafrica'; lookScreen(); },
  look: (d) => {
    const k = d.k;
    P.look[k] = ['hair', 'sex', 'build', 'wear'].includes(k) ? d.v : ['hijab', 'beard'].includes(k) ? !!d.v : Number(d.v);
    if (k === 'sex' && d.v === 'f') P.look.beard = false;
    saveProfile(); SFX.tap(); lookScreen();
  },
  'look-done': () => { if (!P.region) P.region = 'westafrica'; P.onboarded = true; saveProfile(); SFX.card(); if (!P.ageMode) ageScreen(); else home(); },
  'age-mode': (d) => { P.ageMode = d.v; if (d.v === 'u16') { P.settings.autoplay = false; P.settings.reminders = false; } saveProfile(); SFX.card(); home(); },
  'age-screen': () => ageScreen(),
  sprint: () => startRun({ mode: 'sprint', char: 'graduate', currency: P.settings.currency, rules: false }),
  board: () => boardScreen(),
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
    const inSheet = !!layer.querySelector('.sheet');
    if (E.setForecast(run, Number(d.p))) { SFX.tap(); persist(); renderGame(); if (inSheet) thinkSheet(); }
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
  'duel-code': (d) => duel(d.code),
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
  toggle: (d) => {
    P.settings[d.key] = !P.settings[d.key];
    saveProfile(); applyCalm();
    if (d.key === 'reminders' && P.settings.reminders) setupReminders();
    settings();
  },
  faith: (d) => { P.faith = d.v; saveProfile(); settings(); },
  'set-cur': (d) => { P.settings.currency = d.id; saveProfile(); settings(); },
  reset: () => settings(true),
  'reset-yes': () => { const keep = P.settings; P = { ...structuredClone(DEFAULTS), settings: keep }; run = null; saveProfile(); toast('Progress erased'); home(); },

  tab: (d) => {
    const lock = d.t !== 'year' && tabLock(d.t);
    if (lock) { toast(lock); return; }
    SFX.tap(); tab = d.t; closeLayer(); persist(); renderGame(); window.scrollTo(0, 0);
  },
  rules: () => rulesSheet(),
  think: () => thinkSheet(),
  costs: () => costsSheet(),
  move: () => { moveCtx = null; moveSheet(); },
  mv: (d) => {
    const c = moveCtx;
    if (d.k === 'buy') c.buy = d.v === '1'; else c[d.k] = d.v;
    if (!HOMES[c.home].buy) c.buy = false;
    moveSheet();
  },
  'mv-go': () => {
    const c = moveCtx;
    const ok = E.moveHome(run, c.home, c.district, { buy: c.buy, mortgage: c.mortgage, keepOld: c.keepOld });
    if (!ok) { toast(c.buy ? 'Not enough cash for the deposit and moving costs.' : 'You can\'t move there right now.'); return; }
    SFX.buy(); toast(c.buy ? 'Keys in hand. Welcome home.' : 'Moved in. New neighbours!');
    closeLayer(); persist(); renderGame();
  },
  carsheet: () => carSheet(),
  buycar: (d) => {
    if (E.buyCar(run, d.id, d.loan === '1')) { SFX.buy(); toast(d.id === 'none' ? 'Car sold. Hello, bus.' : 'New wheels!'); closeLayer(); persist(); renderGame(); }
    else toast('Not enough cash for that.');
  },
  security: (d) => { if (E.setSecurity(run, d.k, !run.home[d.k])) { SFX.tap(); persist(); renderGame(); } else if (d.k === 'cctv') toast('Not enough cash for CCTV.'); },
  school: (d) => { if (E.setSchool(run, Number(d.i), d.id)) { SFX.tap(); persist(); renderGame(); } },
  uni: (d) => { if (E.setUni(run, Number(d.i), d.v === '1')) { SFX.tap(); persist(); renderGame(); } },
  zone: (d) => { if (!E.mapOpen(run)) { toast('The Map opens after your third year.'); return; } SFX.tap(); zoneSheet(d.id); },
  landcheck: (d) => { if (E.checkLand(run, d.id)) { SFX.tap(); persist(); renderGame(); zoneSheet(d.id); } },
  landbuy: (d) => { if (E.buyLand(run, d.id)) { SFX.buy(); toast('The plot is yours.'); persist(); renderGame(); zoneSheet(d.id); } },
  landuse: (d) => { if (E.setLandUse(run, Number(d.i), d.u)) { SFX.tap(); if (d.u === 'build') toast('Built. The rent starts next year.'); persist(); renderGame(); } else if (d.u === 'build') toast('Building costs twice the land\'s value.'); },
  sellland: (d) => { if (E.sellLand(run, Number(d.i))) { SFX.sell(); persist(); renderGame(); } },
  person: (d) => personSheet(d.id),
  giving: (d) => { if (E.setGiving(run, Number(d.v))) { SFX.tap(); persist(); renderGame(); } },
  'settings-faith': () => settings(),
  menu: () => menuSheet(),
  close: () => closeLayer(),
  scrim: (d, el, e) => { if (e.target === el) closeLayer(); },
  abandon: () => {
    const lose = adult() ? `<div class="insight" style="--ic:var(--loss)"><span class="lbl">If you quit now you lose</span><ul class="clues"><li>${run.age - run.startAge} years of your life: ${f(E.netWorth(run))} built up</li>${run.partner ? `<li>Your life with ${esc(run.partner.name)}${run.kids.length ? ` and ${run.kids.length} child${run.kids.length > 1 ? 'ren' : ''}` : ''}</li>` : ''}<li>Your Life Score and the points for it</li>${run.milestones.length ? `<li>${run.milestones.length} milestone${run.milestones.length > 1 ? 's' : ''} on this run</li>` : ''}</ul></div>` : '';
    openSheet(`${sheetHead('', 'Abandon this run?')}${lose}<p>You will get a small amount of wisdom for the words you learned, and no score. Your game is saved if you just go home instead.</p><button class="btn danger wide" data-act="abandon-yes">Abandon</button><button class="btn wide" data-act="close">Keep playing</button>`);
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
  trap: (d) => {
    const amt = E.takeTrap(run, Number(d.i));
    if (amt > 0) { SFX.buy(); toast(`You sent ${f(amt)}. They promise 3× by next turn.`); persist(); renderGame(); }
  },
  tool: (d) => { if (E.useTool(run, d.tool)) { SFX.card(); persist(); renderGame(); } },
  next: () => nextTurn(),
  playout: () => { const r = pendingPlay; pendingPlay = null; yearTransition(r || run.lastResult); },
  decide: () => { SFX.tap(); decisionScreen(); },
  'close-go': () => { closeLayer(); renderGame(); },
  'year-go': () => {
    stopAutoplay();
    if (pendingResult) { const r = pendingResult; pendingResult = null; return endRun(r); }
    closeLayer(); tab = 'today'; renderGame(); window.scrollTo(0, 0);
    if (run.pending) setTimeout(() => decisionScreen(), calm() ? 0 : 250);
    else startTimer();
  },
  'free-keep': () => { toast('Onwards. Work is a choice now.'); ACT['year-go'](); },
  'free-retire': () => { const out = E.workAction(run, 'retire'); if (out) toast(out.text); persist(); ACT['year-go'](); },
  'end-game': () => { closeLayer(); const r = E.endGame(run); endRun(r); },
  work: (d) => {
    const out = E.workAction(run, d.k);
    if (!out) { toast('Not right now.'); return; }
    if (out.win === true) { SFX.gain(); coinBurst(30); } else if (out.win === false) SFX.loss(); else SFX.tap();
    toast(out.text); persist(); renderGame(); workSheet();
  },
  'work-sheet': () => workSheet(),
  quickinv: (d) => {
    const spare = Math.max(0, run.cash - 0.25 * E.costs(run));
    let moved = 0;
    if (d.a === 'stocks') { COMPANIES.forEach((_, i) => { moved += E.setHolding(run, 'stocks', run.h.stocks[i] + spare / COMPANIES.length, i); }); }
    else moved = E.setHolding(run, d.a, run.h[d.a] + spare);
    if (moved > 0) { SFX.buy(); toast(`${f(moved)} is working for you now.`); }
    persist(); renderGame(); investSheet();
  },
  invest: () => investSheet(),
  'life-sheet': () => lifeSheet(),
  life: (d) => { if (E.setLife(run, Number(d.lv))) { SFX.tap(); persist(); renderGame(); if (layer.querySelector('.sheet')) lifeSheet(); } },
  opps: () => oppsSheet(),
  bizsheet: () => bizSheet(),
  propsheet: () => propSheet(),
  bizact: (d) => { if (E.bizAction(run, d.k, Number(d.d || 0))) { SFX.card(); toast({ marketing: 'Posters up, adverts out. Watch the customers come.', hire: 'A new pair of hands.', price: 'New prices on the board.', ops: 'Tighter stock, fewer breakdowns.' }[d.k]); persist(); renderGame(); bizSheet(); } else toast('Not this year.'); },
  choose: (d) => {
    const wasCircle = run.pending && run.pending.id === 'circle';
    const text = E.chooseEvent(run, Number(d.i));
    if (text === null) return;
    SFX.tap();
    if (wasCircle) run.flags.circleNew = true;
    persist();
    if (text === E.AGAIN) { decisionScreen(); return; }
    outcomeScreen(text);
  },
  results: () => results(lastDone),
  heir: () => {
    const d = lastDone;
    const r = d && d.result;
    const kid = r && (r.kids || []).filter((k) => k.age >= 16).sort((a, b) => b.age - a.age)[0];
    if (!kid) return;
    startRun({ mode: d.mode === 'journey' ? 'journey' : 'classic', char: 'graduate', currency: d.currency, inherit: Math.max(0, r.nw) * 0.9, gen: (d.gen || 1) + 1, startAge: Math.max(22, kid.age), sex: kid.sex });
    run.look = { ...P.look, ...(kid.look || {}), sex: kid.sex };
    run.heirName = kid.name;
    persist(); renderGame();
    toast(`${kid.name} takes over. Generation ${run.gen}.`);
  },
  'share-card': () => shareCard(),
  freeze: () => { if (P.wisdom < 20) return; P.wisdom -= 20; P.streak.freezes = (P.streak.freezes || 0) + 1; saveProfile(); toast('Streak freeze saved for a day you miss.'); dailyScreen(); },
  'break-on': () => { closeLayer(); if (run && run.phase === 'alloc') startTimer(); },
  envelope: (d, el) => {
    const e = lastEnvelope;
    if (!e || el.classList.contains('open')) return;
    el.classList.add('open');
    SFX.card(); if (e.big) coinBurst(50);
    const what = e.kind === 'cash' ? `${f(e.amt)} in cash` : e.kind === 'wisdom' ? `${e.amt} wisdom` : `a card: ${e.card}`;
    el.innerHTML = `${A.icon(e.big ? 'sparkle' : 'gift', 44, '')}<span><b>${e.big ? 'Big one!' : 'Inside:'}</b><small>${esc(what)}</small></span>`;
  },
  again: () => {
    const d = lastDone;
    if (!d) return home();
    if (d.mode === 'sprint') return setup('journey');
    if (d.mode === 'daily') return dailyScreen();
    if (d.mode === 'duel') return duel(d.seed.replace('duel-', ''));
    if (d.mode === 'era') return eras();
    if (d.mode === 'weekly') return ACT.weekly();
    return setup(d.mode);
  },
  copy: () => copyText(document.getElementById('share-text').textContent),
};

// Leaving mid-year sets up a cliffhanger: that event opens first next time.
function setTeaser() {
  if (!run || run.phase !== 'alloc' || run.teaser || run.eraId) return;
  const c = run.circle && run.circle[run.turn % Math.max(1, run.circle.length)];
  if (run.partner && !run.partner.legacy) { run.teaser = `${run.partner.name} says: "We need to talk about money…"`; run.forceEvent = 'p_budget'; }
  else if (c && run.age - run.startAge >= 2) { run.teaser = `${c.name} left a voice note: "Call me back, it's urgent…"`; run.forceEvent = 'circle'; }
  else { run.teaser = 'A letter from your boss is waiting on your desk…'; run.forceEvent = 'promo'; }
  saveTeaser();
}

function resume() {
  run = P.run;
  if (!run) return home();
  E.upgradeRun(run);
  tab = 'today';
  renderGame();
  startTimer();
}

document.addEventListener('click', (e) => {
  if (autoTimer && e.isTrusted && !(e.target.closest('#go-on'))) stopAutoplay();
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
  if (['me-home', 'me-district', 'me-car'].includes(e.target.id)) { P.me[e.target.id.slice(3)] = e.target.value; saveProfile(); }
  if (e.target.id === 'me-liveIn') { P.me.liveIn = e.target.checked; saveProfile(); const pv = document.getElementById('me-preview'); if (pv) pv.innerHTML = mePreview(); }
  if (e.target.id === 'cur') { P.settings.currency = e.target.value; saveProfile(); if (app.querySelector('.char-strip')) setup(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && layer.querySelector('.sheet')) closeLayer(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { persist(); saveTeaser(); } });
addEventListener('resize', () => { if (run && run.phase === 'alloc') drawSparks(); });

applyCalm();
ingestLink();
home();
loadNewsPack();
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
