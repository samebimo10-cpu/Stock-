// Live market data from the stock selector in this repository.
//
// Every weekday a job fetches NGX and NYSE prices and the USD/NGN rate and
// publishes them as data-pack.json at the site root. The planner reads it to
// value your shares and dollars, and to measure how much your own holdings
// actually swing (from about two years of daily closes), instead of guessing.
// The last pack seen is kept on the phone, so the app works offline.

const KEY = 'tycoonplan.market';
const URL_ = '../data-pack.json';

export function emptyMarket() {
  return { asOf: null, fx: null, fxVol: null, fxDrift: null, prices: {}, closes: {}, dates: [], source: 'none' };
}

// Turn the big pack into the small part the planner needs.
export function slimPack(pack) {
  const m = emptyMarket();
  if (!pack || !pack.board) return m;
  for (const b of pack.board) {
    if (b.price == null || !b.symbol) continue;
    m.prices[`${b.exchange}:${b.symbol}`] = { p: b.price, c: b.currency || (b.exchange === 'NGX' ? 'NGN' : 'USD'), n: b.name || b.symbol, s: b.sector || '', d: b.as_of || null };
  }
  for (const s of pack.stocks || []) {
    if (!s.closes) continue;
    const k = `${s.exchange}:${s.symbol}`;
    m.closes[k] = s.closes.map((x) => (x == null ? null : +x));
    if (!m.prices[k] && s.price != null) m.prices[k] = { p: s.price, c: s.currency, n: s.name || s.symbol, s: s.sector || '', d: null };
  }
  m.dates = pack.dates || [];
  const fxs = (pack.fx_usdngn || []).filter((x) => x != null && x > 0);
  if (fxs.length) {
    m.fx = fxs[fxs.length - 1];
    const st = seriesStats(fxs);
    m.fxVol = st.vol;
    m.fxDrift = st.drift;
  }
  m.asOf = (pack.meta && pack.meta.fetched_at) || (m.dates.length ? m.dates[m.dates.length - 1] : null);
  m.source = pack.meta && pack.meta.is_sample ? 'sample' : 'live';
  return m;
}

// Annualised volatility and drift of a daily price series (log changes).
export function seriesStats(xs) {
  const r = [];
  for (let i = 1; i < xs.length; i++) {
    const a = xs[i - 1]; const b = xs[i];
    if (a > 0 && b > 0) r.push(Math.log(b / a));
  }
  if (r.length < 20) return { vol: null, drift: null, n: r.length };
  const mean = r.reduce((s, x) => s + x, 0) / r.length;
  const v = r.reduce((s, x) => s + (x - mean) ** 2, 0) / (r.length - 1);
  return { vol: Math.sqrt(v * 252), drift: Math.exp(mean * 252) - 1, n: r.length };
}

// Volatility of a set of holdings together, from their daily closes, so that
// owning one stock reads as riskier than owning twenty. Weights by value.
export function portfolioVol(market, holdings) {
  const series = [];
  for (const h of holdings) {
    const c = market.closes[h.key];
    if (!c || h.value <= 0) continue;
    const r = [];
    for (let i = 1; i < c.length; i++) r.push(c[i - 1] > 0 && c[i] > 0 ? Math.log(c[i] / c[i - 1]) : null);
    if (r.filter((x) => x != null).length >= 60) series.push({ w: h.value, r });
  }
  if (!series.length) return null;
  const W = series.reduce((s, x) => s + x.w, 0);
  const n = series[0].r.length;
  const port = [];
  for (let t = 0; t < n; t++) {
    let s = 0; let w = 0;
    for (const x of series) if (x.r[t] != null) { s += x.w * x.r[t]; w += x.w; }
    if (w > 0.5 * W) port.push(s / w);
  }
  if (port.length < 60) return null;
  const mean = port.reduce((s, x) => s + x, 0) / port.length;
  const v = port.reduce((s, x) => s + (x - mean) ** 2, 0) / (port.length - 1);
  return { vol: Math.sqrt(v * 252), covered: W, days: port.length };
}

// Search the price board by symbol or name.
export function searchStocks(market, q, limit = 12) {
  const s = q.trim().toUpperCase();
  if (!s) return [];
  const out = [];
  for (const [k, v] of Object.entries(market.prices)) {
    const [ex, sym] = k.split(':');
    const score = sym === s ? 0 : sym.startsWith(s) ? 1 : (v.n || '').toUpperCase().includes(s) ? 2 : -1;
    if (score >= 0) out.push({ key: k, ex, sym, name: v.n, price: v.p, cur: v.c, score });
  }
  return out.sort((a, b) => a.score - b.score || a.sym.length - b.sym.length).slice(0, limit);
}

export function loadCached() {
  try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : emptyMarket(); } catch { return emptyMarket(); }
}

// Fetch the latest pack; keep only what we need on the phone.
export async function refresh() {
  const res = await fetch(URL_, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Market data not available (${res.status})`);
  const m = slimPack(await res.json());
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* storage full: keep in memory */ }
  return m;
}
