// Charts drawn as plain SVG, with a hover/tap layer.
//
// Specs follow the house data-viz rules: 2px lines, 10% area washes, hairline
// solid gridlines, text in text colours (never the series colour), one y-axis,
// and a tooltip on every chart. Colours come from CSS custom properties so
// light and dark mode each use their own validated steps.

import { fmt } from './money.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Round numbers for an axis: 0, 2M, 4M ...
export function niceTicks(lo, hi, n = 4) {
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / n;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || 10 * p;
  const out = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(+v.toFixed(10));
  return out;
}

// Net worth over your life: the middle outcome as a line, the likely range as washes.
export function fanChart(bands, { cur, retireAge, height = 240, id = 'fan', mark = null, tick = (a) => a % 10 === 0, xName = 'Age' } = {}) {
  if (!bands || bands.length < 2) return '<p class="muted">Add your numbers to see your projection.</p>';
  const W = 640; const H = height; const L = 56; const R = 16; const Tp = 14; const B = 28;
  const xs = bands.map((b) => b.age);
  const lo = Math.min(0, ...bands.map((b) => b.p10));
  // Scale to the likely range; the luckiest futures are clipped rather than
  // squashing everything else flat (the tooltip still gives their numbers).
  const hi = Math.max(Math.min(Math.max(...bands.map((b) => b.p90)), Math.max(...bands.map((b) => b.p75)) * 1.35), 1);
  const ticks = niceTicks(lo, hi);
  const y0 = ticks[0]; const y1 = ticks[ticks.length - 1];
  const X = (a) => L + ((a - xs[0]) / (xs[xs.length - 1] - xs[0])) * (W - L - R);
  const Y = (v) => Tp + (1 - (v - y0) / (y1 - y0)) * (H - Tp - B);
  const path = (k) => bands.map((b, i) => `${i ? 'L' : 'M'}${X(b.age).toFixed(1)},${Y(b[k]).toFixed(1)}`).join('');
  const area = (a, b) => `${path(a)}${bands.slice().reverse().map((x) => `L${X(x.age).toFixed(1)},${Y(x[b]).toFixed(1)}`).join('')}Z`;
  const decade = xs.filter(tick);
  const last = bands[bands.length - 1];
  const rx = retireAge && retireAge > xs[0] && retireAge < xs[xs.length - 1] ? X(retireAge) : null;
  const data = esc(JSON.stringify(bands.map((b) => [b.age, Math.round(b.p10), Math.round(b.p50), Math.round(b.p90)])));
  return `<figure class="chart" id="${id}" data-kind="fan" data-xname="${esc(xName)}" data-cur="${cur}" data-pts="${data}" data-l="${L}" data-r="${R}" data-w="${W}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Projection from ${xName.toLowerCase()} ${xs[0]} to ${last.age}. Middle outcome at ${last.age}: ${fmt(last.p50, cur)}.">
      ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}"/><text class="tick" x="${L - 8}" y="${(Y(t) + 4).toFixed(1)}" text-anchor="end">${esc(fmt(t, cur))}</text>`).join('')}
      ${decade.map((a) => `<text class="tick" x="${X(a).toFixed(1)}" y="${H - 8}" text-anchor="middle">${a}</text>`).join('')}
      ${lo < 0 ? `<line class="zero" x1="${L}" x2="${W - R}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}"/>` : ''}
      <clipPath id="${id}-clip"><rect x="${L}" y="${Tp}" width="${W - L - R}" height="${H - Tp - B}"/></clipPath>
      <g clip-path="url(#${id}-clip)">
      <path class="band outer" d="${area('p90', 'p10')}"/>
      <path class="band inner" d="${area('p75', 'p25')}"/>
      ${rx ? `<line class="marker" x1="${rx.toFixed(1)}" x2="${rx.toFixed(1)}" y1="${Tp}" y2="${H - B}"/><text class="tick strong" x="${(rx + 6).toFixed(1)}" y="${Tp + 12}">Stop work ${retireAge}</text>` : ''}
      ${mark ? `<line class="goal" x1="${L}" x2="${W - R}" y1="${Y(mark.v).toFixed(1)}" y2="${Y(mark.v).toFixed(1)}"/><text class="tick" x="${W - R}" y="${(Y(mark.v) - 6).toFixed(1)}" text-anchor="end">${esc(mark.label)}</text>` : ''}
      <path class="line s1" d="${path('p50')}"/>
      </g>
      <circle class="dot s1" cx="${X(last.age).toFixed(1)}" cy="${Y(last.p50).toFixed(1)}" r="4"/>
      <g class="hover" hidden><line class="cross" y1="${Tp}" y2="${H - B}"/><circle class="dot s1" r="5"/></g>
      <rect class="hit" x="${L}" y="${Tp}" width="${W - L - R}" height="${H - Tp - B}"/>
    </svg>
    <div class="tip" hidden></div>
    <figcaption><span class="key"><i class="sw s1"></i>Middle outcome</span><span class="key"><i class="sw band-key"></i>8 in 10 futures land in the shaded range</span></figcaption>
  </figure>`;
}

// Two lines on one money axis: what your plan expected and what really happened.
export function lineChart(series, { cur, height = 200, id = 'line' } = {}) {
  const all = series.flatMap((s) => s.pts);
  if (all.length < 2) return '<p class="muted">Check in for a couple of months to see your progress against the plan.</p>';
  const W = 640; const H = height; const L = 56; const R = 84; const Tp = 12; const B = 28;
  const t0 = Math.min(...all.map((p) => p.x)); const t1 = Math.max(...all.map((p) => p.x), t0 + 1);
  const ticks = niceTicks(Math.min(0, ...all.map((p) => p.y)), Math.max(...all.map((p) => p.y), 1));
  const y0 = ticks[0]; const y1 = ticks[ticks.length - 1];
  const X = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const Y = (v) => Tp + (1 - (v - y0) / (y1 - y0)) * (H - Tp - B);
  const months = [];
  const d0 = new Date(t0);
  for (let d = new Date(d0.getFullYear(), d0.getMonth(), 1); d.getTime() <= t1; d.setMonth(d.getMonth() + 3)) if (d.getTime() >= t0) months.push(d.getTime());
  const data = esc(JSON.stringify(series.map((s) => ({ n: s.name, c: s.cls, p: s.pts.map((p) => [p.x, Math.round(p.y)]) }))));
  return `<figure class="chart" id="${id}" data-kind="line" data-cur="${cur}" data-series="${data}" data-l="${L}" data-r="${R}" data-w="${W}" data-t0="${t0}" data-t1="${t1}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((s) => `${s.name}: latest ${fmt(s.pts[s.pts.length - 1].y, cur)}`).join('. '))}">
      ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}"/><text class="tick" x="${L - 8}" y="${(Y(t) + 4).toFixed(1)}" text-anchor="end">${esc(fmt(t, cur))}</text>`).join('')}
      ${months.map((m) => `<text class="tick" x="${X(m).toFixed(1)}" y="${H - 8}" text-anchor="middle">${new Date(m).toLocaleDateString('en', { month: 'short', year: '2-digit' })}</text>`).join('')}
      ${series.map((s) => {
        const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
        const e = s.pts[s.pts.length - 1];
        return `<path class="line ${s.cls}" d="${d}"/><circle class="dot ${s.cls}" cx="${X(e.x).toFixed(1)}" cy="${Y(e.y).toFixed(1)}" r="4"/><text class="tick strong" x="${(X(e.x) + 8).toFixed(1)}" y="${(Y(e.y) + 4).toFixed(1)}">${esc(s.name)}</text>`;
      }).join('')}
      <g class="hover" hidden><line class="cross" y1="${Tp}" y2="${H - B}"/></g>
      <rect class="hit" x="${L}" y="${Tp}" width="${W - L - R}" height="${H - Tp - B}"/>
    </svg>
    <div class="tip" hidden></div>
    <figcaption>${series.map((s) => `<span class="key"><i class="sw ${s.cls}"></i>${esc(s.name)}</span>`).join('')}</figcaption>
  </figure>`;
}

// Horizontal bars of one series: where your money is. Value at the tip.
export function barRows(rows, { cur, total, format }) {
  const max = Math.max(...rows.map((r) => r.v), 1);
  const show = format || ((v) => fmt(v, cur));
  return `<div class="bars" role="list">${rows.map((r) => `<div class="bar-row" role="listitem" title="${esc(r.label)}: ${esc(format ? format(r.v) : fmt(r.v, cur, { short: false }))}${total ? ` (${Math.round((r.v / total) * 100)}%)` : ''}">
    <span class="bar-label">${esc(r.label)}</span>
    <span class="bar-track"><i style="width:${Math.max(1, (r.v / max) * 100).toFixed(1)}%"></i></span>
    <span class="bar-val">${esc(show(r.v))}${total ? `<small>${Math.round((r.v / total) * 100)}%</small>` : ''}</span></div>`).join('')}</div>`;
}

// Hover and tap: a crosshair and a tooltip with the numbers under your finger.
export function attachCharts(root) {
  for (const fig of root.querySelectorAll('figure.chart')) {
    const svg = fig.querySelector('svg');
    const hit = fig.querySelector('.hit');
    const tip = fig.querySelector('.tip');
    const hov = fig.querySelector('.hover');
    if (!hit || !tip) continue;
    const W = +fig.dataset.w; const L = +fig.dataset.l; const R = +fig.dataset.r;
    const cur = fig.dataset.cur;
    const vb = svg.viewBox.baseVal;
    const move = (ev) => {
      const box = svg.getBoundingClientRect();
      const px = ((ev.clientX - box.left) / box.width) * vb.width;
      const frac = Math.min(1, Math.max(0, (px - L) / (W - L - R)));
      let html = ''; let x = px;
      if (fig.dataset.kind === 'stack') {
        const D = JSON.parse(fig.dataset.pts);
        const i = Math.round(frac * (D.r.length - 1));
        const row = D.r[i];
        x = L + (i / (D.r.length - 1)) * (W - L - R);
        const tot = row.slice(1).reduce((s, v) => s + v, 0);
        html = `<b>Age ${row[0]} · ${fmt(tot, cur)}</b>${D.s.map(([n, c], j) => (row[j + 1] > 0 ? `<span><i class="sq ${c}"></i>${n} ${fmt(row[j + 1], cur)}</span>` : '')).join('')}`;
      } else if (fig.dataset.kind === 'fan') {
        const pts = JSON.parse(fig.dataset.pts);
        const i = Math.round(frac * (pts.length - 1));
        const [age, p10, p50, p90] = pts[i];
        x = L + (i / (pts.length - 1)) * (W - L - R);
        html = `<b>${fig.dataset.xname || 'Age'} ${age}</b><span><i class="sw s1"></i>Middle ${fmt(p50, cur)}</span><span class="muted">Range ${fmt(p10, cur)} to ${fmt(p90, cur)}</span>`;
      } else {
        const series = JSON.parse(fig.dataset.series);
        const t0 = +fig.dataset.t0; const t1 = +fig.dataset.t1;
        const t = t0 + frac * (t1 - t0);
        const rows = series.map((s) => {
          let best = s.p[0];
          for (const p of s.p) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
          return { s, best };
        });
        const tt = rows[0].best[0];
        x = L + ((tt - t0) / (t1 - t0)) * (W - L - R);
        html = `<b>${new Date(tt).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}</b>${rows.map((r) => `<span><i class="sw ${r.s.c}"></i>${r.s.n} ${fmt(r.best[1], cur)}</span>`).join('')}`;
      }
      if (hov) {
        hov.hidden = false;
        const ln = hov.querySelector('.cross');
        ln.setAttribute('x1', x); ln.setAttribute('x2', x);
        const dot = hov.querySelector('.dot');
        if (dot) {
          // Put the dot on the middle line by reading the path at this x.
          const p = svg.querySelector('.line.s1');
          const y = yOnPath(p, x);
          if (y != null) { dot.setAttribute('cx', x); dot.setAttribute('cy', y); }
        }
      }
      tip.innerHTML = html;
      tip.hidden = false;
      const left = (x / vb.width) * box.width;
      tip.style.left = `${Math.min(box.width - 170, Math.max(0, left + 12))}px`;
    };
    const leave = () => { tip.hidden = true; if (hov) hov.hidden = true; };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);
  }
}

function yOnPath(path, x) {
  if (!path) return null;
  const d = path.getAttribute('d');
  const pts = d.slice(1).split(/L/).map((s) => s.split(',').map(Number));
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]; const [x1, y1] = pts[i];
    if (x >= x0 - 0.01 && x <= x1 + 0.01) return x1 === x0 ? y0 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return null;
}

// What your wealth is made of over the years: one band per asset class,
// stacked, the biggest six by name and the rest as "Other". Colours follow
// the categorical order (never cycled) so a class keeps its colour.
export function stackedArea(rows, { cur, names, factor = () => 1, height = 260, id = 'stack' } = {}) {
  if (!rows || rows.length < 2) return '';
  const keys = Object.keys(rows[0].classes);
  const peak = Object.fromEntries(keys.map((k) => [k, Math.max(...rows.map((r) => Math.max(0, r.classes[k])))]));
  const top = keys.filter((k) => peak[k] > 0).sort((a, b) => peak[b] - peak[a]);
  const shown = top.slice(0, 6);
  const rest = top.slice(6);
  const series = [...shown.map((k, i) => ({ k, name: names[k] || k, cls: `c${i + 1}` })), ...(rest.length ? [{ k: '_other', name: 'Other', cls: 'cother' }] : [])];
  const val = (r, k, i) => Math.max(0, k === '_other' ? rest.reduce((s, x) => s + r.classes[x], 0) : r.classes[k]) * factor(i);
  const W = 640; const H = height; const L = 56; const R = 16; const Tp = 12; const B = 28;
  const totals = rows.map((r, i) => series.reduce((s, x) => s + val(r, x.k, i), 0));
  const ticks = niceTicks(0, Math.max(...totals, 1));
  const y1 = ticks[ticks.length - 1];
  const X = (i) => L + (i / (rows.length - 1)) * (W - L - R);
  const Y = (v) => Tp + (1 - v / y1) * (H - Tp - B);
  const acc = rows.map(() => 0);
  const paths = series.map((s) => {
    const lo = acc.slice();
    rows.forEach((r, i) => { acc[i] += val(r, s.k, i); });
    const d = `${rows.map((r, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(acc[i]).toFixed(1)}`).join('')}${rows.map((r, i) => i).reverse().map((i) => `L${X(i).toFixed(1)},${Y(lo[i]).toFixed(1)}`).join('')}Z`;
    return `<path class="area ${s.cls}" d="${d}"/>`;
  });
  const decade = rows.map((r, i) => [r.age, i]).filter(([a]) => a % 10 === 0);
  const data = esc(JSON.stringify({ s: series.map((x) => [x.name, x.cls]), r: rows.map((r, i) => [r.age, ...series.map((x) => Math.round(val(r, x.k, i)))]) }));
  return `<figure class="chart" id="${id}" data-kind="stack" data-cur="${cur}" data-pts="${data}" data-l="${L}" data-r="${R}" data-w="${W}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Your wealth by asset class from age ${rows[0].age} to ${rows[rows.length - 1].age}">
      ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}"/><text class="tick" x="${L - 8}" y="${(Y(t) + 4).toFixed(1)}" text-anchor="end">${esc(fmt(t, cur))}</text>`).join('')}
      ${decade.map(([a, i]) => `<text class="tick" x="${X(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${a}</text>`).join('')}
      ${paths.join('')}
      <g class="hover" hidden><line class="cross" y1="${Tp}" y2="${H - B}"/></g>
      <rect class="hit" x="${L}" y="${Tp}" width="${W - L - R}" height="${H - Tp - B}"/>
    </svg>
    <div class="tip" hidden></div>
    <figcaption>${series.map((s) => `<span class="key"><i class="sq ${s.cls}"></i>${esc(s.name)}</span>`).join('')}</figcaption>
  </figure>`;
}

// Change in your chance of success, either side of zero. Signs and words carry
// the meaning as well as the two colours.
export function deltaBars(items) {
  const max = Math.max(0.05, ...items.map((x) => Math.abs(x.delta)));
  return `<div class="dbars">${items.map((x) => {
    const w = (Math.abs(x.delta) / max) * 50;
    const pts = Math.round(x.delta * 100);
    return `<div class="dbar" title="${esc(x.label)}: ${pts >= 0 ? '+' : ''}${pts} points">
      <span class="dl">${esc(x.label)}</span>
      <span class="dtrack"><i class="${x.delta >= 0 ? 'pos' : 'neg'}" style="${x.delta >= 0 ? `left:50%;width:${w.toFixed(1)}%` : `right:50%;width:${w.toFixed(1)}%`}"></i></span>
      <span class="dv">${pts >= 0 ? '+' : '−'}${Math.abs(pts)} pts</span></div>`;
  }).join('')}</div>`;
}
