// Tycoon Rush art: every picture in the game, drawn as SVG in code.
//
// No image files: people are assembled from parts (skin, hair, outfit,
// expression, age, accessories), icons and scenes are a few shapes each, so the
// whole set adds a few tens of kilobytes to the offline cache and scales to any
// screen. One flat style: thick dark outlines, 3–4 fills per figure.

const O = '#140e29';
export const PAL = {
  gold: '#ffc53d', gold2: '#e0a100', mint: '#3ddc97', sky: '#5cc8ff', orange: '#ff9f43', violet: '#b69cff',
  pink: '#ff7ad9', red: '#ff5d73', cream: '#f6f1ff', ink: O, brown: '#a0673a', grey: '#a99fd2', navy: '#2d3f7a', white: '#fbfaff', green: '#4caf6a',
};
const P_ = PAL;

export const SKINS = ['#f7d9bd', '#eab78d', '#cf9164', '#a8703f', '#7c4a27', '#4e2d18'];
export const HAIRS = ['short', 'afro', 'long', 'bun', 'braids', 'curly', 'bald', 'wrap'];
export const HAIR_COLORS = ['#1d140f', '#3b2416', '#6b3f1d', '#b0772f', '#1d140f', '#1d140f', '#1d140f', '#1d140f'];
export const OUTFITS = ['#3ddc97', '#5cc8ff', '#ff9f43', '#b69cff', '#ff7ad9', '#ffc53d'];

const svg = (vb, body, { size = null, cls = '', label = '' } = {}) => {
  const dims = size ? `width="${size}" height="${size}"` : '';
  const aria = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true"';
  return `<svg class="art ${cls}" viewBox="${vb}" ${dims} ${aria} xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
};
const S = `stroke="${O}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;
const s2 = `stroke="${O}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"`;

// ------------------------------------------------------------------ people
//
// Semi-realistic illustrated people, closer to a storybook than a cartoon:
// three tones per skin colour, necks and shoulders, body builds, subtle
// expressions, and ageing (grey hair from 45, lines at 50, reading glasses at
// 55). Clothes follow money, from a plain T-shirt to designer, with regional
// dress as an option. All drawn in code so the offline cache stays small.

const hexRgb = (h) => { const n = parseInt(h.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const mix = (a, b, t) => { const A = hexRgb(a); const B = hexRgb(b); return `#${A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, '0')).join('')}`; };
const dark = (c, t) => mix(c, '#1a0f0a', t);
const light = (c, t) => mix(c, '#ffffff', t);
let uid = 0;
const nextId = () => `p${(uid = (uid + 1) % 1e6)}`;

export const BUILDS = ['slim', 'average', 'heavy'];
// Regional dress. `style` (0–4) still sets how rich the details are.
export const WEARS = ['none', 'agbada', 'kaftan', 'ankara', 'sari', 'kurta', 'suit'];
export const WEAR_NAMES = { none: 'Everyday clothes', agbada: 'Agbada', kaftan: 'Kaftan', ankara: 'Ankara print', sari: 'Sari', kurta: 'Kurta', suit: 'Suit' };
export const STYLE_NAMES = ['Plain T-shirt', 'Shirt', 'Smart casual', 'Tailored', 'Designer'];

function greyed(hc, age) {
  if (age < 45) return hc;
  return mix(hc, '#cfcbd6', Math.min(0.85, (age - 45) / 18));
}

// Hair behind the head, then in front. Head spans x 33.5–66.5, top at y 21.
function hairBack(style, c) {
  const sh = dark(c, 0.25);
  switch (style) {
    case 'afro': return `<circle cx="50" cy="35" r="22.5" fill="${c}" stroke="${sh}" stroke-width="1.4"/><circle cx="43" cy="24" r="6" fill="${light(c, 0.12)}" opacity=".35"/>`;
    case 'long': return `<path d="M31 40 C29 21 40 14 50 14 C60 14 71 21 69 40 L72 86 C62 92 38 92 28 86 Z" fill="${c}" stroke="${sh}" stroke-width="1.4"/><path d="M36 50 L33 84 M64 50 L67 84" stroke="${sh}" stroke-width="1.2" opacity=".6"/>`;
    case 'braids': return [30, 35, 65, 70].map((x) => `<path d="M${x} 38 C${x - 1} 55 ${x + 1} 70 ${x} 88" stroke="${c}" stroke-width="5" stroke-linecap="round" fill="none"/><path d="M${x} 42 L${x} 86" stroke="${sh}" stroke-width="1" stroke-dasharray="2 3"/>`).join('');
    case 'curly': return [33, 41, 50, 59, 67].map((x, i) => `<circle cx="${x}" cy="${i % 2 ? 19 : 23}" r="8.5" fill="${c}" stroke="${sh}" stroke-width="1.2"/>`).join('') + `<circle cx="31" cy="36" r="7" fill="${c}"/><circle cx="69" cy="36" r="7" fill="${c}"/>`;
    case 'bun': return `<circle cx="50" cy="15.5" r="7.5" fill="${c}" stroke="${sh}" stroke-width="1.4"/>`;
    default: return '';
  }
}

function hairFront(style, c, accent) {
  const sh = dark(c, 0.3);
  const hi = light(c, 0.2);
  switch (style) {
    case 'bald': return `<path d="M34.5 44 C34 39 35 35.5 36.5 33.5 M65.5 44 C66 39 65 35.5 63.5 33.5" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/><path d="M42 24 Q50 21 58 24" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"/>`;
    case 'wrap': return `<path d="M31 40 C27 17 40 9 50 9 C62 9 75 15 69 40 C63 31 57 28.5 50 28.5 C43 28.5 36 31 31 40 Z" fill="${accent}" stroke="${dark(accent, 0.35)}" stroke-width="1.4"/><path d="M37 18 C45 22 57 22 65 16 M34 27 C44 31 58 30 67 25" fill="none" stroke="${dark(accent, 0.3)}" stroke-width="1.2"/><path d="M62 10 C70 4 76 10 72 16 C68 13 65 13 62 10 Z" fill="${accent}" stroke="${dark(accent, 0.35)}" stroke-width="1.2"/>`;
    case 'hijab': return '';
    case 'afro': return `<path d="M32 39 C33 28 41 23.5 50 23.5 C59 23.5 67 28 68 39 C62 33 57 31.5 50 31.5 C43 31.5 37 33 32 39 Z" fill="${c}"/>`;
    case 'curly': return `<path d="M32 40 C32 27 41 22.5 50 22.5 C59 22.5 68 27 68 40 C63 34 57 32 50 32 C43 32 37 34 32 40 Z" fill="${c}" stroke="${sh}" stroke-width="1.2"/>${[38, 46, 54, 62].map((x) => `<circle cx="${x}" cy="30" r="3" fill="${hi}" opacity=".35"/>`).join('')}`;
    case 'long': return `<path d="M32 42 C31 26 40 18.5 50 18.5 C60 18.5 69 26 68 42 C64 33 57 28.5 48 28.5 C42 31 36 36 32 42 Z" fill="${c}" stroke="${sh}" stroke-width="1.2"/><path d="M44 21 C50 20 58 22 63 28" fill="none" stroke="${hi}" stroke-width="1.6" opacity=".5"/>`;
    case 'braids': return `<path d="M32.5 40 C31 25 40 18.5 50 18.5 C60 18.5 69 25 67.5 40 C64 32 58 29 50 29 C42 29 36 32 32.5 40 Z" fill="${c}" stroke="${sh}" stroke-width="1.2"/>${[38, 44, 50, 56, 62].map((x) => `<path d="M${x} 20 L${x + (x - 50) * 0.3} 30" stroke="${sh}" stroke-width="1.1"/>`).join('')}`;
    case 'bun': return `<path d="M32.5 40 C31 25 40 18.5 50 18.5 C60 18.5 69 25 67.5 40 C64 30 58 26.5 50 26.5 C42 26.5 36 30 32.5 40 Z" fill="${c}" stroke="${sh}" stroke-width="1.2"/><path d="M40 22 Q50 18 60 22" fill="none" stroke="${hi}" stroke-width="1.4" opacity=".5"/>`;
    default: return `<path d="M32.5 40 C31 25 40 17.5 50 17.5 C61 17.5 69 25 67.5 40 C65.5 33 60 28.5 50 28.5 C42 28.5 35 32 32.5 40 Z" fill="${c}" stroke="${sh}" stroke-width="1.2"/><path d="M43 19.5 C47 24 49 26 53 28" fill="none" stroke="${sh}" stroke-width="1.1"/><path d="M52 20 C57 21 62 24 64 29" fill="none" stroke="${hi}" stroke-width="1.4" opacity=".45"/>`;
  }
}

// Subtle expressions: the eyes, brows and mouth move a little, never a cartoon grin.
function faceParts(expr, skin, hc, age, child) {
  const line = dark(skin, 0.55);
  const brow = dark(hc, 0.1);
  const lip = mix(skin, '#a4404f', 0.42);
  const ey = 42;
  const eye = (x) => {
    if (expr === 'cheer') return `<path d="M${x - 4} ${ey + 0.5} Q${x} ${ey - 2.8} ${x + 4} ${ey + 0.5}" fill="none" stroke="${line}" stroke-width="1.5" stroke-linecap="round"/>`;
    const open = expr === 'shocked' ? 3.6 : expr === 'tired' ? 1.6 : expr === 'sly' ? 1.8 : 2.7;
    const iris = child ? 2.4 : 2.1;
    return `<path d="M${x - 4.2} ${ey} Q${x} ${ey - open - 0.4} ${x + 4.2} ${ey} Q${x} ${ey + 2.3} ${x - 4.2} ${ey} Z" fill="#fbf8f5" stroke="${line}" stroke-width="0.9"/>
      <circle cx="${x}" cy="${ey + 0.1}" r="${iris}" fill="#3a2418"/><circle cx="${x}" cy="${ey + 0.1}" r="1" fill="#0d0806"/><circle cx="${x + 0.8}" cy="${ey - 0.8}" r="0.6" fill="#fff"/>
      <path d="M${x - 4.4} ${ey - 0.2} Q${x} ${ey - open - 0.9} ${x + 4.4} ${ey - 0.2}" fill="none" stroke="${line}" stroke-width="1.4" stroke-linecap="round"/>
      ${expr === 'tired' ? `<path d="M${x - 4.4} ${ey - 0.4} Q${x} ${ey - 2.2} ${x + 4.4} ${ey - 0.4} L${x + 4.4} ${ey - 3} L${x - 4.4} ${ey - 3} Z" fill="${skin}"/><path d="M${x - 3.5} ${ey + 3} Q${x} ${ey + 4.6} ${x + 3.5} ${ey + 3}" fill="none" stroke="${dark(skin, 0.3)}" stroke-width="0.9"/>` : ''}`;
  };
  const brows = {
    neutral: ['M38.5 36.5 Q43 35 47.5 36.2', 'M52.5 36.2 Q57 35 61.5 36.5'],
    happy: ['M38.5 36.2 Q43 34.2 47.5 35.8', 'M52.5 35.8 Q57 34.2 61.5 36.2'],
    cheer: ['M38.5 35.2 Q43 32.8 47.5 34.6', 'M52.5 34.6 Q57 32.8 61.5 35.2'],
    tired: ['M38.5 37 Q43 36.2 47.5 35', 'M52.5 35 Q57 36.2 61.5 37'],
    worried: ['M38.5 37 Q43 36 47.5 34.2', 'M52.5 34.2 Q57 36 61.5 37'],
    shocked: ['M38.5 33.8 Q43 31.5 47.5 33.2', 'M52.5 33.2 Q57 31.5 61.5 33.8'],
    sly: ['M38.5 36.8 Q43 35.8 47.5 36.4', 'M52.5 35 Q57 33 61.5 34.2'],
  }[expr] || ['M38.5 36.5 Q43 35 47.5 36.2', 'M52.5 36.2 Q57 35 61.5 36.5'];
  const mouth = {
    happy: `<path d="M44.5 55 Q50 58.6 55.5 55" fill="none" stroke="${dark(lip, 0.35)}" stroke-width="1.4" stroke-linecap="round"/><path d="M45.5 56 Q50 59.5 54.5 56 Q50 58 45.5 56 Z" fill="${lip}"/>`,
    cheer: `<path d="M44 54.5 Q50 61 56 54.5 Q50 56.5 44 54.5 Z" fill="#fff" stroke="${dark(lip, 0.35)}" stroke-width="1.2" stroke-linejoin="round"/><path d="M45 56.5 Q50 60.5 55 56.5" fill="none" stroke="${lip}" stroke-width="1.4"/>`,
    neutral: `<path d="M45.5 55.8 Q50 56.6 54.5 55.8" fill="none" stroke="${dark(lip, 0.35)}" stroke-width="1.3" stroke-linecap="round"/><path d="M46.5 56.4 Q50 58 53.5 56.4" fill="none" stroke="${lip}" stroke-width="1.3"/>`,
    tired: `<path d="M45.5 56.8 Q50 55.4 54.5 56.8" fill="none" stroke="${dark(lip, 0.35)}" stroke-width="1.3" stroke-linecap="round"/>`,
    worried: `<path d="M45 57 Q47.5 55.6 50 56.4 Q52.5 57.2 55 55.8" fill="none" stroke="${dark(lip, 0.35)}" stroke-width="1.3" stroke-linecap="round"/>`,
    shocked: `<ellipse cx="50" cy="57" rx="2.6" ry="3.2" fill="#5a1f28" stroke="${dark(lip, 0.3)}" stroke-width="1"/>`,
    sly: `<path d="M45 56.4 Q51 57.6 55.5 54" fill="none" stroke="${dark(lip, 0.35)}" stroke-width="1.4" stroke-linecap="round"/>`,
  }[expr] || '';
  const blush = (expr === 'happy' || expr === 'cheer') ? `<ellipse cx="39.5" cy="49" rx="3.4" ry="2" fill="#e0667a" opacity=".18"/><ellipse cx="60.5" cy="49" rx="3.4" ry="2" fill="#e0667a" opacity=".18"/>` : '';
  const nose = `<path d="M50.5 43.5 C50 47 48.3 49.2 48.4 50.6 C49.4 51.6 51.2 51.6 52.4 50.8" fill="none" stroke="${dark(skin, 0.38)}" stroke-width="1.1" stroke-linecap="round"/><ellipse cx="51.5" cy="49.2" rx="1.6" ry="0.9" fill="${light(skin, 0.25)}" opacity=".5"/>`;
  const lines = age >= 50 ? `<g stroke="${dark(skin, 0.4)}" stroke-width="0.8" fill="none" opacity="${Math.min(0.7, 0.35 + (age - 50) / 40)}"><path d="M42 28.5 Q50 27 58 28.5 M43.5 31 Q50 30 56.5 31"/><path d="M33.8 41.5 L36 42.8 M33.8 44 L36 44 M66.2 41.5 L64 42.8 M66.2 44 L64 44"/><path d="M45 50.5 Q43.5 53.5 44.2 56 M55 50.5 Q56.5 53.5 55.8 56"/></g>` : '';
  return `${lines}<path d="${brows[0]}" fill="none" stroke="${brow}" stroke-width="1.9" stroke-linecap="round"/><path d="${brows[1]}" fill="none" stroke="${brow}" stroke-width="1.9" stroke-linecap="round"/>${eye(43)}${eye(57)}${nose}${blush}${mouth}`;
}

// Garments. Every top is drawn inside the torso outline, so builds just work.
function garment(o, W, cid) {
  const c = o.outfit;
  const a = o.accent;
  const style = o.style ?? 1;
  const wear = o.wear && o.wear !== 'none' ? o.wear : null;
  const gold = '#d9a93a';
  const out = [];
  const neckL = 50 - 7.5;
  const neckR = 50 + 7.5;
  const rich = style >= 3;
  if (wear === 'agbada' || wear === 'kaftan') {
    out.push(`<path d="M${50 - W - 6} 121 C${50 - W - 4} 96 ${50 - W + 4} 78 ${neckL} 72 L${neckR} 72 C${50 + W - 4} 78 ${50 + W + 4} 96 ${50 + W + 6} 121 Z" fill="${c}"/>`);
    out.push(`<path d="M${neckL} 72 Q50 ${wear === 'agbada' ? 96 : 86} ${neckR} 72" fill="none" stroke="${rich ? gold : light(c, 0.45)}" stroke-width="${rich ? 3.2 : 2.2}"/>`);
    out.push(`<path d="M50 ${wear === 'agbada' ? 96 : 86} L50 121" stroke="${rich ? gold : light(c, 0.35)}" stroke-width="${rich ? 2.4 : 1.4}" stroke-dasharray="${rich ? '0' : '3 3'}"/>`);
    if (wear === 'agbada') out.push(`<path d="M${50 - W - 5} 108 Q${50 - 22} 100 ${50 - 14} 121 M${50 + W + 5} 108 Q${50 + 22} 100 ${50 + 14} 121" fill="none" stroke="${dark(c, 0.25)}" stroke-width="1.4"/>`);
    return out.join('');
  }
  out.push(`<rect x="0" y="60" width="100" height="61" fill="${wear === 'suit' || (!wear && style >= 3) ? '#f4f2f8' : c}" clip-path="url(#${cid})"/>`);
  if (wear === 'ankara') {
    out.push(`<g clip-path="url(#${cid})">${Array.from({ length: 24 }, (_, i) => `<circle cx="${8 + (i % 6) * 17 + (Math.floor(i / 6) % 2) * 8}" cy="${80 + Math.floor(i / 6) * 12}" r="4.5" fill="none" stroke="${a}" stroke-width="2.2"/>`).join('')}</g>`);
    out.push(`<path d="M${neckL} 72 Q50 80 ${neckR} 72" fill="none" stroke="${dark(c, 0.3)}" stroke-width="1.6"/>`);
  } else if (wear === 'sari') {
    out.push(`<path d="M${neckR - 2} 71 L${50 + W} 90 L${50 + W} 121 L${50 + 4} 121 Z" fill="${a}" clip-path="url(#${cid})"/><path d="M${neckR - 2} 71 L${50 + 4} 121" stroke="${rich ? gold : light(a, 0.4)}" stroke-width="${rich ? 2.6 : 1.6}"/>`);
    out.push(`<path d="M${neckL} 72 Q50 79 ${neckR} 72" fill="none" stroke="${dark(c, 0.3)}" stroke-width="1.4"/>`);
  } else if (wear === 'kurta') {
    out.push(`<path d="M${neckL} 72 Q50 77 ${neckR} 72" fill="none" stroke="${dark(c, 0.3)}" stroke-width="1.6"/><path d="M50 75 L50 96" stroke="${dark(c, 0.3)}" stroke-width="1.4"/>${[80, 86, 92].map((y) => `<circle cx="51.8" cy="${y}" r="1" fill="${rich ? gold : dark(c, 0.4)}"/>`).join('')}`);
  } else if (wear === 'suit' || (!wear && style >= 3)) {
    const jacket = wear === 'suit' ? '#2c3348' : style === 4 ? dark(a, 0.25) : dark(c, 0.45);
    out.push(`<path d="M${50 - W - 1} 121 L${50 - W - 1} 86 C${50 - W + 4} 76 ${neckL - 2} 73 ${neckL} 72 L50 100 L${neckR} 72 C${neckR + 2} 73 ${50 + W - 4} 76 ${50 + W + 1} 86 L${50 + W + 1} 121 Z" fill="${jacket}" clip-path="url(#${cid})"/>`);
    out.push(`<path d="M${neckL} 72 L${neckL + 1} 84 L50 100 M${neckR} 72 L${neckR - 1} 84 L50 100" fill="none" stroke="${dark(jacket, 0.4)}" stroke-width="1.4"/>`);
    if (o.sex !== 'f') out.push(`<path d="M50 74 L47.5 78 L50 98 L52.5 78 Z" fill="${style === 4 ? gold : a}" stroke="${dark(a, 0.4)}" stroke-width="0.8"/>`);
    else out.push(`<path d="M44 74 Q50 84 56 74" fill="none" stroke="${gold}" stroke-width="1.4"/><circle cx="50" cy="83" r="1.8" fill="${gold}"/>`);
    if (style === 4) out.push(`<path d="M${50 + W - 12} 92 l6 -2 l1 4 l-6 1 Z" fill="${gold}"/>`);
  } else if (style === 0) {
    out.push(`<path d="M${neckL - 1} 71.5 Q50 80 ${neckR + 1} 71.5" fill="none" stroke="${dark(c, 0.3)}" stroke-width="1.8"/>`);
  } else {
    // Shirt, or smart casual: a collared shirt under a V-neck.
    if (style === 2) out.push(`<path d="M${50 - W} 121 L${50 - W} 88 C${50 - W + 6} 78 ${neckL} 73 ${neckL} 72 L50 94 L${neckR} 72 C${neckR} 73 ${50 + W - 6} 78 ${50 + W} 88 L${50 + W} 121 Z" fill="${a}" clip-path="url(#${cid})"/><path d="M${neckL} 72 L50 94 L${neckR} 72" fill="none" stroke="${dark(a, 0.35)}" stroke-width="1.3"/>`);
    out.push(`<path d="M${neckL - 1} 70.5 L${neckL + 2} 78 L50 73.5 L${neckR - 2} 78 L${neckR + 1} 70.5" fill="${light(c, 0.55)}" stroke="${dark(c, 0.35)}" stroke-width="1.1" stroke-linejoin="round"/>`);
    if (style === 1) out.push(`<path d="M50 75 L50 121" stroke="${dark(c, 0.25)}" stroke-width="1"/>${[82, 92, 102].map((y) => `<circle cx="51.6" cy="${y}" r="0.9" fill="${dark(c, 0.4)}"/>`).join('')}`);
  }
  return out.join('');
}

const ACC = {
  mortarboard: () => `<path d="M28 23 L50 13 L72 23 L50 32 Z" fill="#231a3f" stroke="#0e0a1c" stroke-width="1.2"/><rect x="39" y="23.5" width="22" height="7" fill="#231a3f"/><path d="M68 24 L70 35" stroke="${P_.gold}" stroke-width="1.6"/><circle cx="70" cy="36.5" r="2" fill="${P_.gold}"/>`,
  sailorcap: () => `<path d="M32 30 C32 20 68 20 68 30 Z" fill="${P_.white}" stroke="#555" stroke-width="1.2"/><rect x="31" y="28" width="38" height="6" rx="2" fill="${P_.navy}"/><rect x="46" y="22" width="8" height="5" rx="1.5" fill="${P_.gold}"/>`,
  strawhat: () => `<ellipse cx="50" cy="29" rx="32" ry="6.5" fill="#e3bf66" stroke="#9c7a2a" stroke-width="1.2"/><path d="M35 29 C35 13 65 13 65 29 Z" fill="#e8c46a" stroke="#9c7a2a" stroke-width="1.2"/><path d="M36 26 L64 26" stroke="${P_.red}" stroke-width="3"/>`,
  cap: (a) => `<path d="M32 31 C32 17 68 17 68 31 Z" fill="${a}" stroke="${dark(a, 0.4)}" stroke-width="1.2"/><path d="M50 31 L78 33 L76 36 L50 34.5 Z" fill="${dark(a, 0.15)}" stroke="${dark(a, 0.4)}" stroke-width="1.1"/>`,
  raincap: () => `<path d="M28 37 C28 15 72 15 72 37 L78 40 L22 40 Z" fill="${P_.gold}" stroke="#9c7a2a" stroke-width="1.2"/>`,
  sunglasses: () => `<rect x="37" y="38.5" width="12" height="7.5" rx="3" fill="#15121f"/><rect x="51" y="38.5" width="12" height="7.5" rx="3" fill="#15121f"/><path d="M49 41 L51 41 M37 40 L33.5 39 M63 40 L66.5 39" stroke="#15121f" stroke-width="1.6"/><path d="M39.5 40.5 L43 40.5" stroke="#fff" stroke-width="1" opacity=".7"/>`,
  glasses: () => `<rect x="37.5" y="38.5" width="11" height="7.5" rx="3" fill="#fff" fill-opacity=".12" stroke="#2a2233" stroke-width="1.2"/><rect x="51.5" y="38.5" width="11" height="7.5" rx="3" fill="#fff" fill-opacity=".12" stroke="#2a2233" stroke-width="1.2"/><path d="M48.5 41.5 L51.5 41.5 M37.5 40.5 L33.5 39.5 M62.5 40.5 L66.5 39.5" stroke="#2a2233" stroke-width="1.1"/>`,
  tie: (a) => `<path d="M50 74 L47.5 78 L50 100 L52.5 78 Z" fill="${a}" stroke="${dark(a, 0.4)}" stroke-width="0.8"/>`,
  collar: () => `<path d="M42 70.5 L45 78 L50 73.5 L55 78 L58 70.5" fill="${P_.white}" stroke="#77738a" stroke-width="1" stroke-linejoin="round"/>`,
  lanyard: () => `<path d="M43 72 L50 92 L57 72" fill="none" stroke="${P_.red}" stroke-width="1.8"/><rect x="45" y="91" width="10" height="12" rx="1.5" fill="${P_.white}" stroke="#77738a" stroke-width="1"/><rect x="47" y="94" width="6" height="2" fill="${P_.sky}"/>`,
  stethoscope: () => `<path d="M42 72 C41 92 59 92 58 72" fill="none" stroke="#4a5a8a" stroke-width="2"/><circle cx="50" cy="93" r="3" fill="#c9d4f0" stroke="#4a5a8a" stroke-width="1.2"/>`,
  chain: () => `<path d="M40 73 Q50 88 60 73" fill="none" stroke="${P_.gold}" stroke-width="2.4" stroke-dasharray="2.4 1.4"/><circle cx="50" cy="85" r="3.5" fill="${P_.gold}" stroke="#9c7a2a" stroke-width="1"/>`,
  earrings: () => `<circle cx="33.6" cy="50.5" r="1.8" fill="${P_.gold}"/><circle cx="66.4" cy="50.5" r="1.8" fill="${P_.gold}"/>`,
  beard: (a, hc) => `<path d="M34.5 45 C35 58 43 64.5 50 64.5 C57 64.5 65 58 65.5 45 C62 53 57 55 50 55 C43 55 38 53 34.5 45 Z" fill="${hc}" stroke="${dark(hc, 0.3)}" stroke-width="1"/><path d="M44 54 Q50 52 56 54" fill="none" stroke="${dark(hc, 0.3)}" stroke-width="1.6"/>`,
  shawl: (a) => `<path d="M16 121 C18 94 30 80 50 82 C70 80 82 94 84 121" fill="${a}" stroke="${dark(a, 0.35)}" stroke-width="1.2"/><path d="M26 104 C36 96 64 96 74 104" fill="none" stroke="${light(a, 0.35)}" stroke-width="1.4"/>`,
  coat: () => `<path d="M42 72 L50 104 L58 72" fill="none" stroke="#77738a" stroke-width="1.4"/>`,
  watch: () => `<rect x="74" y="108" width="8" height="7" rx="1.5" fill="${P_.gold}" stroke="#9c7a2a" stroke-width="1"/>`,
  hoe: () => `<path d="M88 64 L80 121" stroke="${P_.brown}" stroke-width="3" stroke-linecap="round"/><path d="M82 62 L95 66 L93 71 Z" fill="#9aa4b8" stroke="#555" stroke-width="1"/>`,
  phones: () => `<rect x="8" y="96" width="10" height="18" rx="2.5" fill="#2b2b3f"/><rect x="82" y="96" width="10" height="18" rx="2.5" fill="#2b2b3f"/><rect x="10" y="99" width="6" height="11" fill="${P_.sky}"/><rect x="84" y="99" width="6" height="11" fill="${P_.mint}"/>`,
  diploma: () => `<rect x="74" y="100" width="20" height="8" rx="4" fill="${P_.white}" stroke="#77738a" stroke-width="1"/><path d="M84 100 L84 108" stroke="${P_.red}" stroke-width="2.4"/>`,
  coinbag: () => `<path d="M77 98 C70 102 70 118 82 118 C94 118 94 102 87 98 Z" fill="#c9a36a" stroke="#7a5a2a" stroke-width="1.2"/><path d="M78 98 L86 98" stroke="#7a5a2a" stroke-width="2"/><circle cx="82" cy="109" r="3.5" fill="${P_.gold}"/>`,
  phonehype: () => `<rect x="76" y="90" width="14" height="25" rx="2.5" fill="#2b2b3f"/><rect x="78" y="93" width="10" height="18" fill="${P_.mint}"/><path d="M79 108 L81.5 103 L84 104.5 L87 96" fill="none" stroke="#15121f" stroke-width="1.4"/>`,
  hijab: (a) => `<path d="M27 50 C24 20 38 12 50 12 C62 12 76 20 73 50 C73 70 66 80 50 82 C34 80 27 70 27 50 Z" fill="${a}" stroke="${dark(a, 0.35)}" stroke-width="1.3"/><path d="M33 30 C40 26 60 26 67 30" fill="none" stroke="${light(a, 0.3)}" stroke-width="1.2"/>`,
  wave: (a, hc, skin) => `<path d="M76 92 L88 66" stroke="${skin}" stroke-width="7" stroke-linecap="round"/><ellipse cx="89" cy="62" rx="4.5" ry="5.5" fill="${skin}" stroke="${dark(skin, 0.4)}" stroke-width="1"/>`,
};

// o: { skin, hair, hairColor, outfit, accent, expr, age, acc: [], build, style, wear, sex, label }
export function person(o, opts = {}) {
  const skin = o.skin || SKINS[2];
  const age = o.age ?? 25;
  const child = age < 13;
  const hc = greyed(o.hairColor || HAIR_COLORS[0], age);
  const outfit = o.outfit || P_.mint;
  const accent = o.accent || P_.orange;
  const acc = (o.acc || []).slice();
  const has = (k) => acc.includes(k);
  if (age >= 55 && !has('glasses') && !has('sunglasses') && !child) acc.push('glasses');
  const hair = has('hijab') ? 'hijab' : o.hair || 'short';
  const W = { slim: 29, average: 33, heavy: 38 }[o.build || 'average'] * (child ? 0.8 : 1);
  const cid = nextId();
  const skinSh = dark(skin, 0.16);
  const skinHi = light(skin, 0.16);
  const outline = dark(skin, 0.45);
  const jaw = o.build === 'heavy' ? 'M33.5 40 C33.5 27 41 21 50 21 C59 21 66.5 27 66.5 40 C66.5 52 63 59 57.5 62.5 C54 64.8 46 64.8 42.5 62.5 C37 59 33.5 52 33.5 40 Z'
    : child ? 'M32.5 40 C32.5 26 40.5 20 50 20 C59.5 20 67.5 26 67.5 40 C67.5 51 62.5 60 56 62 C53 63.2 47 63.2 44 62 C37.5 60 32.5 51 32.5 40 Z'
      : 'M33.5 40 C33.5 27 41 21 50 21 C59 21 66.5 27 66.5 40 C66.5 50 63 58 57 62 C54 64.5 46 64.5 43 62 C37 58 33.5 50 33.5 40 Z';
  const torso = `M${50 - W} 121 C${50 - W} 94 ${50 - W + 5} 78 ${50 - 11} 72 L${50 + 11} 72 C${50 + W - 5} 78 ${50 + W} 94 ${50 + W} 121 Z`;
  const back = [];
  if (has('hijab')) back.push(ACC.hijab(accent));
  const front = [];
  for (const k of acc) {
    if (['hijab', 'shawl', 'wave', 'glasses', 'sunglasses', 'beard', 'earrings'].includes(k)) continue;
    if (ACC[k]) front.push(ACC[k](accent, hc, skin));
  }
  const faceAcc = ['beard', 'earrings', 'glasses', 'sunglasses'].filter(has).map((k) => ACC[k](accent, hc, skin)).join('');
  const inner = `
    <defs><clipPath id="${cid}"><path d="${torso}"/></clipPath></defs>
    ${back.join('')}${hairBack(hair, hc)}
    <path d="${torso}" fill="${outfit}" stroke="${dark(outfit, 0.45)}" stroke-width="1.4"/>
    ${garment({ ...o, outfit, accent }, W, cid)}
    <path d="${torso}" fill="none" stroke="${dark(outfit, 0.45)}" stroke-width="1.4"/>
    <path d="M${50 - W + 3} 121 C${50 - W + 3} 100 ${50 - W + 8} 84 ${50 - 13} 78" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="3"/>
    ${has('shawl') ? ACC.shawl(accent) : ''}${has('wave') ? ACC.wave(accent, hc, skin) : ''}
    <path d="M43.5 56 L44 73 C46 76 54 76 56 73 L56.5 56 Z" fill="${skin}"/>
    <path d="M44 61 C47 66 53 66 56 61 L56.3 68 C53 70 47 70 43.8 68 Z" fill="${skinSh}" opacity=".85"/>
    <path d="M43.6 58 L44 73 M56.4 58 L56 73" stroke="${outline}" stroke-width="1.1" fill="none"/>
    <ellipse cx="33.8" cy="44" rx="3" ry="5.4" fill="${skin}" stroke="${outline}" stroke-width="1.1"/><path d="M34.2 41.5 Q32.6 44 34.4 46.5" fill="none" stroke="${skinSh}" stroke-width="1"/>
    <ellipse cx="66.2" cy="44" rx="3" ry="5.4" fill="${skin}" stroke="${outline}" stroke-width="1.1"/><path d="M65.8 41.5 Q67.4 44 65.6 46.5" fill="none" stroke="${skinSh}" stroke-width="1"/>
    <path d="${jaw}" fill="${skin}" stroke="${outline}" stroke-width="1.3"/>
    <path d="M58 23.5 C65 28.5 67 39 65.2 49.5 C63.5 56.5 59 60.5 54.5 62.8 C60 55 62 44 58 23.5 Z" fill="${skinSh}" opacity=".55"/>
    <ellipse cx="46" cy="29.5" rx="7" ry="3.6" fill="${skinHi}" opacity=".45"/><ellipse cx="40.5" cy="47.5" rx="3" ry="2.2" fill="${skinHi}" opacity=".35"/>
    ${faceParts(o.expr || 'happy', skin, hc, age, child)}
    ${hairFront(hair, hc, accent)}${faceAcc}${front.join('')}`;
  // Small face chips zoom in on the head and shoulders.
  const vb = opts.crop || (opts.size && opts.size <= 64 ? '16 8 68 68' : '0 0 100 121');
  return svg(vb, inner, { size: opts.size, cls: `person ${opts.cls || ''}`, label: opts.label ?? o.label ?? '' });
}

// A whole person, about 6.5 heads tall for adults and 4–5 for children, for
// scenes: you, your partner and your children in front of your home.
export function figure(o) {
  const skin = o.skin || SKINS[2];
  const age = o.age ?? 25;
  const kid = age < 16;
  const H = kid ? 34 + Math.min(16, age) * 2.2 : 72 * (o.tall ? 1.05 : 1) * (o.sex === 'f' ? 0.95 : 1);
  const heads = kid ? 4 + Math.min(age, 15) / 6 : 6.6;
  const hh = H / heads;
  const W = ({ slim: 0.8, average: 1, heavy: 1.28 }[o.build || 'average']) * hh * (kid ? 0.66 : 0.78);
  const cx = 20;
  const top = 80 - H;
  const hc = greyed(o.hairColor || HAIR_COLORS[0], age);
  const c = o.outfit || P_.mint;
  const a = o.accent || P_.orange;
  const style = o.style ?? 1;
  const wear = o.wear && o.wear !== 'none' ? o.wear : null;
  const line = dark(skin, 0.5);
  const headR = hh * 0.46;
  const hy = top + headR;
  const neckY = top + hh * 0.95;
  const shoulderY = neckY + hh * 0.18;
  const waistY = top + hh * 3.1;
  const hipY = top + hh * 3.5;
  const footY = 80;
  const long = wear === 'agbada' || wear === 'kaftan' || wear === 'sari' || (o.sex === 'f' && (wear === 'ankara' || style === 2));
  const topCol = wear === 'suit' || (!wear && style >= 3) ? (wear === 'suit' ? '#2c3348' : style === 4 ? dark(a, 0.2) : dark(c, 0.4)) : c;
  const legCol = wear === 'suit' || (!wear && style >= 3) ? '#2c3348' : style === 0 ? '#4a5a7a' : style === 1 ? '#3d4660' : '#2a2e3f';
  const parts = [];
  // Legs and shoes.
  if (!long) {
    parts.push(`<path d="M${cx - W * 0.42} ${hipY - 2} L${cx - W * 0.36} ${footY - 2} M${cx + W * 0.42} ${hipY - 2} L${cx + W * 0.36} ${footY - 2}" stroke="${legCol}" stroke-width="${W * 0.55}" stroke-linecap="round"/>`);
  } else {
    parts.push(`<path d="M${cx - W * 0.62} ${shoulderY + 4} L${cx - W * 0.9} ${footY - 3} L${cx + W * 0.9} ${footY - 3} L${cx + W * 0.62} ${shoulderY + 4} Z" fill="${wear === 'sari' ? a : c}" stroke="${dark(c, 0.4)}" stroke-width="0.8"/>`);
  }
  parts.push(`<ellipse cx="${cx - W * 0.38}" cy="${footY - 1.2}" rx="${W * 0.36}" ry="1.6" fill="${style >= 3 ? '#1d1a24' : '#5a3a2a'}"/><ellipse cx="${cx + W * 0.38}" cy="${footY - 1.2}" rx="${W * 0.36}" ry="1.6" fill="${style >= 3 ? '#1d1a24' : '#5a3a2a'}"/>`);
  // Body.
  parts.push(`<path d="M${cx - W * 0.6} ${shoulderY} Q${cx - W * 0.66} ${waistY} ${cx - W * 0.52} ${hipY + (long ? 0 : 2)} L${cx + W * 0.52} ${hipY + (long ? 0 : 2)} Q${cx + W * 0.66} ${waistY} ${cx + W * 0.6} ${shoulderY} Q${cx} ${shoulderY - 2} ${cx - W * 0.6} ${shoulderY} Z" fill="${topCol}" stroke="${dark(topCol, 0.45)}" stroke-width="0.8"/>`);
  if (wear === 'ankara') parts.push(Array.from({ length: 6 }, (_, i) => `<circle cx="${cx - W * 0.35 + (i % 2) * W * 0.6}" cy="${shoulderY + 5 + Math.floor(i / 2) * hh * 0.7}" r="${W * 0.14}" fill="none" stroke="${a}" stroke-width="1.1"/>`).join(''));
  if (wear === 'sari') parts.push(`<path d="M${cx + W * 0.2} ${shoulderY} L${cx - W * 0.5} ${hipY}" stroke="${a}" stroke-width="${W * 0.35}"/>`);
  if (wear === 'suit' || (!wear && style >= 3)) parts.push(`<path d="M${cx - 2} ${shoulderY + 0.5} L${cx} ${shoulderY + hh * 0.9} L${cx + 2} ${shoulderY + 0.5} Z" fill="#f4f2f8"/>${o.sex !== 'f' ? `<path d="M${cx} ${shoulderY + 1} L${cx} ${shoulderY + hh * 0.8}" stroke="${style === 4 ? '#d9a93a' : a}" stroke-width="1.4"/>` : ''}`);
  if (!wear && style === 1) parts.push(`<path d="M${cx - 2.5} ${shoulderY} L${cx} ${shoulderY + 3} L${cx + 2.5} ${shoulderY}" fill="${light(c, 0.55)}"/>`);
  if (!wear && style === 2 && o.sex !== 'f') parts.push(`<path d="M${cx - W * 0.6} ${shoulderY} L${cx} ${shoulderY + hh * 0.9} L${cx + W * 0.6} ${shoulderY}" fill="none" stroke="${a}" stroke-width="2"/>`);
  if (wear === 'agbada' || wear === 'kaftan') parts.push(`<path d="M${cx - 3} ${shoulderY} Q${cx} ${shoulderY + hh * 0.7} ${cx + 3} ${shoulderY}" fill="none" stroke="${style >= 3 ? '#d9a93a' : light(c, 0.45)}" stroke-width="1.4"/>`);
  // Arms and hands.
  const armW = W * 0.3;
  const sleeve = wear === 'agbada' ? c : topCol;
  parts.push(`<path d="M${cx - W * 0.62} ${shoulderY + 2} Q${cx - W * 0.85} ${waistY - 2} ${cx - W * 0.74} ${hipY - 1}" stroke="${sleeve}" stroke-width="${wear === 'agbada' ? armW * 2.2 : armW}" stroke-linecap="round" fill="none"/><path d="M${cx + W * 0.62} ${shoulderY + 2} Q${cx + W * 0.85} ${waistY - 2} ${cx + W * 0.74} ${hipY - 1}" stroke="${sleeve}" stroke-width="${wear === 'agbada' ? armW * 2.2 : armW}" stroke-linecap="round" fill="none"/>`);
  parts.push(`<circle cx="${cx - W * 0.74}" cy="${hipY + 0.6}" r="${armW * 0.55}" fill="${skin}"/><circle cx="${cx + W * 0.74}" cy="${hipY + 0.6}" r="${armW * 0.55}" fill="${skin}"/>`);
  if (style === 4 && !kid) parts.push(`<rect x="${cx + W * 0.66}" y="${hipY - 3}" width="${armW * 0.9}" height="1.8" fill="#d9a93a"/>`);
  // Neck and head.
  parts.push(`<rect x="${cx - headR * 0.32}" y="${hy + headR * 0.7}" width="${headR * 0.64}" height="${shoulderY - hy - headR * 0.5}" fill="${dark(skin, 0.1)}"/>`);
  const hb = { afro: `<circle cx="${cx}" cy="${hy - headR * 0.2}" r="${headR * 1.35}" fill="${hc}"/>`, long: `<path d="M${cx - headR * 0.98} ${hy} Q${cx - headR * 1.05} ${hy - headR * 1.3} ${cx} ${hy - headR * 1.2} Q${cx + headR * 1.05} ${hy - headR * 1.3} ${cx + headR * 0.98} ${hy} L${cx + headR * 1.02} ${hy + headR * 1.7} L${cx + headR * 0.55} ${hy + headR * 1.7} L${cx + headR * 0.6} ${hy} L${cx - headR * 0.6} ${hy} L${cx - headR * 0.55} ${hy + headR * 1.7} L${cx - headR * 1.02} ${hy + headR * 1.7} Z" fill="${hc}"/>`, braids: `<path d="M${cx - headR * 0.95} ${hy} L${cx - headR} ${hy + headR * 2.4} M${cx + headR * 0.95} ${hy} L${cx + headR} ${hy + headR * 2.4}" stroke="${hc}" stroke-width="${headR * 0.5}" stroke-linecap="round"/>`, bun: `<circle cx="${cx}" cy="${hy - headR * 1.1}" r="${headR * 0.45}" fill="${hc}"/>`, curly: `<circle cx="${cx}" cy="${hy - headR * 0.3}" r="${headR * 1.2}" fill="${hc}"/>` }[o.hair] || '';
  parts.push(hb);
  if (o.hijab) parts.push(`<path d="M${cx - headR * 1.25} ${hy + headR * 0.3} Q${cx - headR * 1.3} ${hy - headR * 1.4} ${cx} ${hy - headR * 1.35} Q${cx + headR * 1.3} ${hy - headR * 1.4} ${cx + headR * 1.25} ${hy + headR * 0.3} Q${cx + headR} ${shoulderY + 3} ${cx} ${shoulderY + 4} Q${cx - headR} ${shoulderY + 3} ${cx - headR * 1.25} ${hy + headR * 0.3} Z" fill="${a}"/>`);
  parts.push(`<ellipse cx="${cx}" cy="${hy}" rx="${headR * 0.88}" ry="${headR}" fill="${skin}" stroke="${line}" stroke-width="0.6"/><path d="M${cx + headR * 0.3} ${hy - headR * 0.9} Q${cx + headR * 1.05} ${hy} ${cx + headR * 0.2} ${hy + headR * 0.95}" fill="${dark(skin, 0.15)}" opacity=".5"/>`);
  if (!o.hijab) {
    const hf = o.hair === 'bald' ? '' : o.hair === 'wrap' ? `<path d="M${cx - headR * 1.02} ${hy - headR * 0.1} Q${cx - headR * 1.1} ${hy - headR * 1.8} ${cx + headR * 0.3} ${hy - headR * 1.6} Q${cx + headR * 1.2} ${hy - headR * 1.2} ${cx + headR * 0.95} ${hy - headR * 0.1} Q${cx} ${hy - headR * 0.6} ${cx - headR * 1.02} ${hy - headR * 0.1} Z" fill="${a}"/>`
      : `<path d="M${cx - headR * 0.92} ${hy - headR * 0.05} Q${cx - headR} ${hy - headR * 1.15} ${cx} ${hy - headR * 1.08} Q${cx + headR} ${hy - headR * 1.15} ${cx + headR * 0.92} ${hy - headR * 0.05} Q${cx + headR * 0.4} ${hy - headR * 0.6} ${cx - headR * 0.92} ${hy - headR * 0.05} Z" fill="${hc}"/>`;
    parts.push(hf);
  }
  const ey = hy + headR * 0.05;
  const smile = o.expr === 'tired' || o.expr === 'shocked' ? `M${cx - headR * 0.3} ${hy + headR * 0.55} Q${cx} ${hy + headR * 0.42} ${cx + headR * 0.3} ${hy + headR * 0.55}` : `M${cx - headR * 0.32} ${hy + headR * 0.45} Q${cx} ${hy + headR * 0.68} ${cx + headR * 0.32} ${hy + headR * 0.45}`;
  parts.push(`<circle cx="${cx - headR * 0.34}" cy="${ey}" r="${headR * 0.1}" fill="#2a1a12"/><circle cx="${cx + headR * 0.34}" cy="${ey}" r="${headR * 0.1}" fill="#2a1a12"/><path d="${smile}" fill="none" stroke="${dark(skin, 0.5)}" stroke-width="0.7" stroke-linecap="round"/>`);
  if (age >= 55) parts.push(`<path d="M${cx - headR * 0.6} ${ey} h${headR * 0.5} M${cx + headR * 0.1} ${ey} h${headR * 0.5}" stroke="#2a2233" stroke-width="0.6"/>`);
  return parts.join('');
}

// Wraps a figure in its own SVG (for UI chips and the share card).
export function figureSvg(o, { size = 80, label = '' } = {}) {
  return svg('0 0 40 82', figure(o), { size, cls: 'figure', label });
}

// ------------------------------------------------------------------ the cast

export const CAST = {
  boss: { name: 'Your boss', skin: SKINS[1], hair: 'short', hairColor: '#3b2416', outfit: '#3a4a7a', accent: P_.red, acc: ['collar', 'tie', 'lanyard'], age: 45 },
  family: { name: 'Auntie', skin: SKINS[4], hair: 'wrap', outfit: P_.orange, accent: '#e0527a', acc: ['earrings', 'shawl'], age: 48 },
  friend: { name: 'Your best friend', skin: SKINS[3], hair: 'curly', hairColor: '#1d140f', outfit: P_.sky, accent: P_.gold, acc: [], age: 24 },
  banker: { name: 'The banker', skin: SKINS[0], hair: 'short', hairColor: '#6b3f1d', outfit: '#2d5da8', accent: P_.sky, acc: ['collar', 'tie', 'glasses'], age: 40 },
  doctor: { name: 'The doctor', skin: SKINS[2], hair: 'bun', hairColor: '#1d140f', outfit: P_.white, accent: P_.sky, acc: ['coat', 'stethoscope'], age: 38 },
  landlord: { name: 'The landlord', skin: SKINS[3], hair: 'short', outfit: '#8a5a3a', accent: '#5a4a8a', acc: ['cap'], age: 52 },
  mechanic: { name: 'The mechanic', skin: SKINS[5], hair: 'short', outfit: '#4a6a8a', accent: P_.orange, acc: ['cap'], age: 35 },
  hype: { name: 'The Hype Guy', skin: SKINS[2], hair: 'short', hairColor: '#1d140f', outfit: P_.pink, accent: P_.gold, acc: ['sunglasses', 'chain', 'phonehype'], age: 30, expr: 'sly' },
  anchor: { name: 'The news anchor', skin: SKINS[1], hair: 'long', hairColor: '#3b2416', outfit: '#5a3a8a', accent: P_.gold, acc: ['collar', 'earrings'], age: 36 },
  neighbour: { name: 'Your neighbour', skin: SKINS[4], hair: 'short', outfit: P_.green, accent: P_.gold, acc: ['raincap'], age: 55 },
};

export const GUIDES = {
  ebi: { name: 'Mama Ebi', skin: SKINS[4], hair: 'wrap', outfit: '#2f9e6a', accent: P_.orange, acc: ['earrings', 'glasses'], age: 62 },
  wanjiru: { name: 'Mama Wanjiru', skin: SKINS[5], hair: 'short', outfit: '#c24a3a', accent: P_.gold, acc: ['earrings', 'shawl'], age: 62 },
  priya: { name: 'Nani Priya', skin: SKINS[2], hair: 'bun', outfit: '#c2408a', accent: P_.gold, acc: ['earrings', 'shawl', 'glasses'], age: 64 },
  wei: { name: 'Grandpa Wei', skin: SKINS[1], hair: 'bald', outfit: '#3a5a8a', accent: P_.sky, acc: ['glasses', 'beard'], age: 66 },
  rosa: { name: 'Abuela Rosa', skin: SKINS[2], hair: 'bun', outfit: '#a83a5a', accent: P_.gold, acc: ['earrings', 'glasses', 'shawl'], age: 65 },
  marcia: { name: 'Auntie Marcia', skin: SKINS[4], hair: 'wrap', outfit: '#1f8a8a', accent: P_.gold, acc: ['earrings'], age: 58 },
  joe: { name: 'Uncle Joe', skin: SKINS[0], hair: 'short', outfit: '#5a6a3a', accent: '#8a3a3a', acc: ['beard', 'cap'], age: 63 },
  samira: { name: 'Khala Samira', skin: SKINS[2], hair: 'short', outfit: '#5a3a8a', accent: P_.violet, acc: ['hijab', 'earrings'], age: 60 },
};

export const castFace = (id, expr, size, label) => {
  const c = CAST[id] || GUIDES[id];
  return person({ ...c, expr: expr || c.expr || 'happy' }, { size, label: label ?? c.name });
};

// The player's avatar: their chosen look, plus their character's signature items.
export const CHAR_ACC = {
  graduate: (age) => (age < 30 ? ['mortarboard', 'diploma'] : ['collar', 'lanyard']),
  heir: () => ['collar', 'chain', 'watch', 'coinbag'],
  farmer: () => ['strawhat', 'hoe'],
  hustler: () => ['cap', 'phones'],
  sailor: () => ['sailorcap', 'collar'],
  me: (age) => (age < 30 ? [] : ['collar']),
};

export function avatar(look, char, { age = 22, expr = 'happy', size = null, label = 'You', style = null } = {}) {
  const l = look || {};
  let acc = (CHAR_ACC[char] || CHAR_ACC.graduate)(age).slice();
  const st = style ?? 1;
  const wear = l.wear && l.wear !== 'none' ? l.wear : null;
  if (st >= 2 || wear) acc = acc.filter((a) => a !== 'collar');
  if (l.hijab) acc.push('hijab');
  const hair = l.hair || 'short';
  if ((hair === 'wrap' || l.hijab) && acc.some((a) => ['mortarboard', 'strawhat', 'cap', 'sailorcap'].includes(a))) acc = acc.filter((a) => !['mortarboard', 'strawhat', 'cap', 'sailorcap'].includes(a));
  if (l.beard && l.sex !== 'f') acc.push('beard');
  return person({
    skin: SKINS[l.skin ?? 2], hair, hairColor: HAIR_COLORS[l.hairColor ?? 0],
    outfit: OUTFITS[l.outfit ?? 0], accent: OUTFITS[((l.outfit ?? 0) + 2) % OUTFITS.length], expr, age, acc,
    build: l.build || 'average', style: st, wear, sex: l.sex,
  }, { size, label });
}

// Anyone else in your life (partner, children, the Circle) from a stored look.
export function lookPerson(look, { age = 30, expr = 'happy', size = null, label = '', style = 1, sex = null } = {}) {
  const l = look || {};
  return person({
    skin: SKINS[l.skin ?? 2], hair: l.hair || 'short', hairColor: HAIR_COLORS[l.hairColor ?? 0],
    outfit: OUTFITS[l.outfit ?? 0], accent: OUTFITS[((l.outfit ?? 0) + 2) % OUTFITS.length], expr, age,
    acc: [...(l.acc || []), ...(l.beard && age >= 18 ? ['beard'] : [])], build: l.build || 'average', style, wear: l.wear || null, sex: sex || l.sex,
  }, { size, label });
}

export function lookFigure(look, { age = 30, expr = 'happy', style = 1, sex = null } = {}) {
  const l = look || {};
  return figure({
    skin: SKINS[l.skin ?? 2], hair: l.hair || 'short', hairColor: HAIR_COLORS[l.hairColor ?? 0],
    outfit: OUTFITS[l.outfit ?? 0], accent: OUTFITS[((l.outfit ?? 0) + 2) % OUTFITS.length], expr, age,
    build: l.build || 'average', style, wear: l.wear && l.wear !== 'none' ? l.wear : null, sex: sex || l.sex, hijab: !!l.hijab,
  });
}

// ------------------------------------------------------------------ icons (48 × 48)

const I = {
  safe: `<ellipse cx="24" cy="29" rx="17" ry="12" fill="${P_.pink}" ${s2}/><circle cx="12" cy="20" r="4" fill="${P_.pink}" ${s2}/><ellipse cx="40" cy="29" rx="4" ry="5" fill="#ffb0e6" ${s2}/><circle cx="33" cy="25" r="1.8" fill="${O}"/><rect x="14" y="38" width="5" height="6" rx="1" fill="${P_.pink}" ${s2}/><rect x="28" y="38" width="5" height="6" rx="1" fill="${P_.pink}" ${s2}/><rect x="19" y="16" width="10" height="3" rx="1.5" fill="${O}"/><circle cx="24" cy="9" r="5" fill="${P_.gold}" ${s2}/>`,
  basket: `<rect x="10" y="12" width="8" height="12" fill="${P_.sky}" ${s2}/><rect x="20" y="8" width="8" height="16" fill="${P_.violet}" ${s2}/><rect x="30" y="14" width="8" height="10" fill="${P_.orange}" ${s2}/><path d="M6 22 L42 22 L37 42 L11 42 Z" fill="#c98a4a" ${s2}/><path d="M9 29 L39 29 M11 35 L37 35 M19 22 L20 42 M29 22 L28 42" stroke="${O}" stroke-width="1.6"/>`,
  companies: `<rect x="5" y="20" width="11" height="22" fill="${P_.sky}" ${s2}/><rect x="18" y="8" width="12" height="34" fill="${P_.violet}" ${s2}/><rect x="32" y="16" width="11" height="26" fill="${P_.mint}" ${s2}/><path d="M8 25h5M8 31h5M21 13h6M21 19h6M21 25h6M21 31h6M35 21h5M35 27h5M35 33h5" stroke="${O}" stroke-width="1.8"/>`,
  house: `<path d="M6 24 L22 10 L38 24" fill="none" ${S}/><path d="M9 22 L9 42 L35 42 L35 22 L22 11 Z" fill="${P_.orange}" ${s2}/><rect x="18" y="30" width="8" height="12" fill="#7a4a2a" ${s2}/><circle cx="40" cy="36" r="4" fill="${P_.gold}" ${s2}/><path d="M40 40 L40 46 M40 44 L43 44" stroke="${O}" stroke-width="2.4"/>`,
  rocket: `<path d="M6 44 C12 40 10 36 16 33 C20 31 18 27 22 26" fill="none" stroke="${P_.grey}" stroke-width="2.4" stroke-dasharray="3 3"/><path d="M24 30 C24 16 32 8 40 6 C40 16 34 24 28 32 Z" fill="${P_.cream}" ${s2}/><circle cx="34" cy="16" r="3" fill="${P_.sky}" ${s2}/><path d="M24 30 L18 30 L24 22 Z M28 32 L28 38 L34 30 Z" fill="${P_.red}" ${s2}/><path d="M24 32 L20 38 L26 36 Z" fill="${P_.orange}"/>`,
  shop: `<rect x="8" y="20" width="32" height="22" fill="${P_.cream}" ${s2}/><path d="M6 12 L42 12 L42 20 L6 20 Z" fill="${P_.red}" ${s2}/><path d="M13 12 L13 20 M20 12 L20 20 M27 12 L27 20 M34 12 L34 20" stroke="${P_.white}" stroke-width="3"/><rect x="12" y="26" width="12" height="10" fill="${P_.sky}" ${s2}/><rect x="28" y="26" width="8" height="16" fill="#7a4a2a" ${s2}/>`,
  field: `<circle cx="38" cy="10" r="5" fill="${P_.gold}" ${s2}/><path d="M4 26 L44 26 L44 42 L4 42 Z" fill="#8a5a3a" ${s2}/>${[10, 18, 26, 34, 40].map((x) => `<path d="M${x} 34 C${x - 3} 28 ${x} 22 ${x} 22 C${x} 22 ${x + 3} 28 ${x} 34 Z" fill="${P_.mint}" ${s2}/>`).join('')}`,
  swap: `<circle cx="16" cy="18" r="10" fill="${P_.gold}" ${s2}/><circle cx="32" cy="30" r="10" fill="${P_.sky}" ${s2}/><path d="M14 18h5M30 30h5" stroke="${O}" stroke-width="2.4"/><path d="M34 8 C40 10 42 14 41 18 M41 18 L38 15 M41 18 L44 15" fill="none" ${s2}/><path d="M14 40 C8 38 6 34 7 30 M7 30 L4 33 M7 30 L10 33" fill="none" ${s2}/>`,
  bank: `<path d="M5 18 L24 6 L43 18 Z" fill="${P_.cream}" ${s2}/><rect x="7" y="38" width="34" height="5" fill="${P_.cream}" ${s2}/>${[11, 19, 27, 35].map((x) => `<rect x="${x}" y="19" width="4" height="19" fill="${P_.cream}" ${s2}/>`).join('')}<circle cx="24" cy="13" r="2.5" fill="${P_.gold}"/>`,
  coin: `<circle cx="24" cy="24" r="16" fill="${P_.gold}" ${s2}/><circle cx="24" cy="24" r="10" fill="none" stroke="${P_.gold2}" stroke-width="3"/>`,
  coins: `<ellipse cx="24" cy="38" rx="14" ry="5" fill="${P_.gold2}" ${s2}/><ellipse cx="24" cy="32" rx="14" ry="5" fill="${P_.gold}" ${s2}/><ellipse cx="24" cy="26" rx="14" ry="5" fill="${P_.gold2}" ${s2}/><ellipse cx="24" cy="20" rx="14" ry="5" fill="${P_.gold}" ${s2}/><ellipse cx="24" cy="14" rx="14" ry="5" fill="${P_.gold}" ${s2}/>`,
  smile: `<circle cx="24" cy="24" r="17" fill="${P_.gold}" ${s2}/><circle cx="18" cy="21" r="2.4" fill="${O}"/><circle cx="30" cy="21" r="2.4" fill="${O}"/><path d="M16 28 Q24 36 32 28" fill="none" ${s2}/>`,
  sad: `<circle cx="24" cy="24" r="17" fill="${P_.sky}" ${s2}/><circle cx="18" cy="21" r="2.4" fill="${O}"/><circle cx="30" cy="21" r="2.4" fill="${O}"/><path d="M16 33 Q24 26 32 33" fill="none" ${s2}/>`,
  payslip: `<rect x="10" y="6" width="26" height="36" rx="2" fill="${P_.white}" ${s2}/><path d="M15 14h16M15 20h12M15 26h16" stroke="${P_.grey}" stroke-width="2.4"/><circle cx="34" cy="36" r="8" fill="${P_.gold}" ${s2}/>`,
  bowl: `<path d="M6 22 L42 22 C42 34 34 42 24 42 C14 42 6 34 6 22 Z" fill="${P_.orange}" ${s2}/><path d="M12 22 C14 16 34 16 36 22" fill="#fff3d6" ${s2}/>`,
  tree: `<rect x="21" y="28" width="6" height="16" fill="${P_.brown}" ${s2}/><circle cx="24" cy="20" r="15" fill="${P_.green}" ${s2}/><circle cx="17" cy="18" r="3" fill="${P_.red}" ${s2}/><circle cx="29" cy="14" r="3" fill="${P_.red}" ${s2}/><circle cx="30" cy="25" r="3" fill="${P_.red}" ${s2}/>`,
  fruitbasket: `<circle cx="17" cy="20" r="5" fill="${P_.red}" ${s2}/><circle cx="27" cy="18" r="5" fill="${P_.orange}" ${s2}/><circle cx="33" cy="23" r="5" fill="${P_.red}" ${s2}/><path d="M6 24 L42 24 L37 42 L11 42 Z" fill="#c98a4a" ${s2}/><path d="M9 31h30M11 37h26" stroke="${O}" stroke-width="1.6"/>`,
  bread: `<path d="M6 30 C6 16 42 16 42 30 L42 38 L6 38 Z" fill="#e3a45a" ${s2}/><path d="M16 22 L19 30 M24 20 L26 29 M32 22 L33 30" stroke="${O}" stroke-width="2"/><path d="M30 6 L44 6 L44 16 L37 20 L30 16 Z" fill="${P_.gold}" ${s2}/>`,
  sun: `<circle cx="24" cy="24" r="10" fill="${P_.gold}" ${s2}/>${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M24 4 L24 9" transform="rotate(${a} 24 24)" stroke="${P_.gold2}" stroke-width="3.5" stroke-linecap="round"/>`).join('')}`,
  cloud: `<circle cx="34" cy="16" r="6" fill="${P_.gold}" ${s2}/><path d="M10 36 C4 36 4 26 11 26 C12 18 24 16 27 23 C33 20 40 25 38 31 C43 32 42 38 37 38 L12 38 Z" fill="${P_.white}" ${s2}/>`,
  hotsun: `<circle cx="24" cy="20" r="11" fill="${P_.red}" ${s2}/><path d="M6 36 C10 33 14 39 18 36 C22 33 26 39 30 36 C34 33 38 39 42 36 M8 43 C12 40 16 46 20 43 C24 40 28 46 32 43" fill="none" stroke="${P_.orange}" stroke-width="2.6" stroke-linecap="round"/>`,
  storm: `<path d="M9 26 C3 26 3 16 10 16 C11 8 24 6 27 13 C33 10 41 15 39 21 C44 22 43 28 38 28 L11 28 Z" fill="#5a6080" ${s2}/><path d="M24 28 L18 38 L24 38 L20 46 L32 34 L26 34 L30 28 Z" fill="${P_.gold}" ${s2}/><path d="M10 32 L8 38 M36 32 L34 38" stroke="${P_.sky}" stroke-width="2.4" stroke-linecap="round"/>`,
  rainbow: `<path d="M4 38 A20 20 0 0 1 44 38" fill="none" stroke="${P_.red}" stroke-width="4"/><path d="M9 38 A15 15 0 0 1 39 38" fill="none" stroke="${P_.gold}" stroke-width="4"/><path d="M14 38 A10 10 0 0 1 34 38" fill="none" stroke="${P_.mint}" stroke-width="4"/><path d="M19 38 A5 5 0 0 1 29 38" fill="none" stroke="${P_.sky}" stroke-width="4"/><path d="M28 14 C24 14 24 8 29 8 C30 4 37 4 38 8 C42 8 42 14 38 14 Z" fill="${P_.white}" ${s2}/>`,
  desk: `<rect x="6" y="28" width="36" height="5" fill="#8a5a3a" ${s2}/><path d="M9 33 L9 44 M39 33 L39 44" ${S}/><rect x="14" y="12" width="20" height="14" rx="2" fill="#2b2b3f" ${s2}/><rect x="16.5" y="14.5" width="15" height="9" fill="${P_.sky}"/><path d="M11 28 L37 28" stroke="${O}" stroke-width="2.4"/>`,
  tent: `<path d="M4 40 L24 10 L44 40 Z" fill="${P_.white}" ${s2}/><path d="M24 10 L18 40 M24 10 L30 40" stroke="${O}" stroke-width="2"/><path d="M8 20 L24 28 L40 20" fill="none" stroke="${P_.red}" stroke-width="2"/>${[12, 18, 24, 30, 36].map((x, i) => `<path d="M${x} ${22 + (i % 2) * 2} l2 4 l2 -4 Z" fill="${[P_.gold, P_.pink, P_.sky, P_.mint, P_.orange][i]}"/>`).join('')}`,
  rings: `<circle cx="18" cy="26" r="10" fill="none" stroke="${P_.gold}" stroke-width="5"/><circle cx="30" cy="26" r="10" fill="none" stroke="${P_.gold2}" stroke-width="5"/><path d="M26 10 L30 6 L34 10 L30 14 Z" fill="${P_.sky}" ${s2}/>`,
  cot: `<rect x="6" y="18" width="36" height="18" rx="3" fill="${P_.white}" ${s2}/><path d="M12 18v18M18 18v18M24 18v18M30 18v18M36 18v18" stroke="${P_.grey}" stroke-width="2"/><path d="M8 36 L8 44 M40 36 L40 44" ${S}/><circle cx="24" cy="12" r="5" fill="${P_.pink}" ${s2}/>`,
  car: `<path d="M5 34 L7 24 L14 16 L32 16 L40 24 L44 26 L44 34 Z" fill="${P_.sky}" ${s2}/><rect x="16" y="19" width="14" height="6" fill="${P_.white}" ${s2}/><circle cx="14" cy="36" r="5" fill="#2b2b3f" ${s2}/><circle cx="36" cy="36" r="5" fill="#2b2b3f" ${s2}/><path d="M42 16 C40 12 44 10 42 6 M46 18 C44 14 47 12 46 8" fill="none" stroke="${P_.grey}" stroke-width="2.4" stroke-linecap="round"/>`,
  clinic: `<rect x="8" y="14" width="32" height="28" fill="${P_.white}" ${s2}/><rect x="20" y="30" width="8" height="12" fill="${P_.sky}" ${s2}/><path d="M21 17 h6 v5 h5 v6 h-5 v5 h-6 v-5 h-5 v-6 h5 Z" fill="${P_.red}" ${s2} transform="translate(0 -6) scale(1 0.9)"/>`,
  phone: `<rect x="14" y="4" width="20" height="40" rx="4" fill="#2b2b3f" ${s2}/><rect x="17" y="9" width="14" height="28" fill="${P_.cream}"/><path d="M19 13 h10 v6 h-7 l-3 3 Z" fill="${P_.mint}"/><path d="M29 24 h-10 v6 h7 l3 3 Z" fill="${P_.sky}"/>`,
  heart: `<path d="M24 41 C10 31 5 24 5 17 C5 10 10 6 16 6 C20 6 23 9 24 12 C25 9 28 6 32 6 C38 6 43 10 43 17 C43 24 38 31 24 41 Z" fill="${P_.pink}" ${s2}/><path d="M12 14 C13 11 15 10 17 10" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".7"/>`,
  people: `<circle cx="16" cy="16" r="6" fill="${P_.orange}" ${s2}/><path d="M5 40 C5 30 10 25 16 25 C22 25 27 30 27 40 Z" fill="${P_.orange}" ${s2}/><circle cx="32" cy="14" r="6.5" fill="${P_.sky}" ${s2}/><path d="M20 41 C20 30 25 24 32 24 C39 24 44 30 44 41 Z" fill="${P_.sky}" ${s2}/>`,
  school: `<path d="M4 20 L24 8 L44 20 Z" fill="${P_.red}" ${s2}/><rect x="8" y="20" width="32" height="22" fill="${P_.cream}" ${s2}/><rect x="20" y="30" width="8" height="12" fill="#7a4a2a" ${s2}/><rect x="11" y="24" width="6" height="6" fill="#8fb7d9" ${s2}/><rect x="31" y="24" width="6" height="6" fill="#8fb7d9" ${s2}/><circle cx="24" cy="16" r="2.6" fill="${P_.gold}" ${s2}/>`,
  shield: `<path d="M24 5 L40 11 L40 23 C40 33 32 40 24 44 C16 40 8 33 8 23 L8 11 Z" fill="${P_.sky}" ${s2}/><path d="M16 24 L22 30 L33 18" fill="none" stroke="${O}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  bell: `<path d="M12 34 C14 30 13 20 16 15 C18 11 21 10 24 10 C27 10 30 11 32 15 C35 20 34 30 36 34 Z" fill="${P_.gold}" ${s2}/><path d="M9 34 L39 34" ${S}/><circle cx="24" cy="39" r="3.4" fill="${P_.gold}" ${s2}/><circle cx="24" cy="7" r="2.4" fill="${P_.gold}" ${s2}/>`,
  key: `<circle cx="16" cy="24" r="9" fill="${P_.gold}" ${s2}/><circle cx="16" cy="24" r="3.4" fill="${P_.cream}" ${s2}/><path d="M25 24 L43 24 L43 30 M37 24 L37 29" fill="none" ${S}/>`,
  flame: `<path d="M24 44 C13 44 9 36 10 29 C11 22 17 19 17 11 C23 14 26 19 25 25 C28 23 29 19 29 16 C35 21 39 27 38 33 C37 40 31 44 24 44 Z" fill="${P_.orange}" ${s2}/><path d="M24 42 C19 42 17 38 18 34 C19 31 22 30 22 26 C26 29 28 32 28 35 C28 39 27 42 24 42 Z" fill="${P_.gold}"/>`,
  flag: `<path d="M12 44 L12 5" ${S}/><path d="M12 7 L38 10 L32 17 L38 24 L12 22 Z" fill="${P_.red}" ${s2}/>`,
  family: `<circle cx="13" cy="13" r="5" fill="${P_.sky}" ${s2}/><path d="M5 38 C5 27 8 22 13 22 C18 22 21 27 21 38 Z" fill="${P_.sky}" ${s2}/><circle cx="35" cy="13" r="5" fill="${P_.pink}" ${s2}/><path d="M27 38 C27 27 30 22 35 22 C40 22 43 27 43 38 Z" fill="${P_.pink}" ${s2}/><circle cx="24" cy="27" r="3.6" fill="${P_.gold}" ${s2}/><path d="M18.5 42 C18.5 35 21 33 24 33 C27 33 29.5 35 29.5 42 Z" fill="${P_.gold}" ${s2}/>`,
  cctv: `<rect x="8" y="14" width="26" height="12" rx="3" fill="#e8e8f0" ${s2}/><circle cx="12" cy="20" r="2.4" fill="${P_.red}"/><path d="M34 20 L40 20 L40 38" fill="none" ${S}/>`,
  plot: `<path d="M4 40 L44 40" ${S}/><path d="M6 40 C10 34 16 36 20 32 C26 30 30 34 36 32 C40 32 42 36 44 40 Z" fill="${P_.green}" ${s2}/><path d="M30 12 L30 34" ${S}/><rect x="18" y="8" width="24" height="12" rx="2" fill="${P_.gold}" ${s2}/><path d="M22 14h16" stroke="${O}" stroke-width="2"/>`,
  counter: `<rect x="4" y="26" width="40" height="16" fill="#8a5a3a" ${s2}/><path d="M4 26 L44 26" stroke="${O}" stroke-width="3"/><rect x="8" y="10" width="32" height="14" rx="2" fill="${P_.sky}" opacity=".6" ${s2}/><circle cx="34" cy="22" r="4" fill="${P_.gold}" ${s2}/>`,
  coffee: `<rect x="6" y="20" width="14" height="16" rx="3" fill="${P_.white}" ${s2}/><path d="M20 24 C25 24 25 32 20 32" fill="none" ${s2}/><rect x="26" y="20" width="14" height="16" rx="3" fill="${P_.orange}" ${s2}/><path d="M10 14 C8 10 12 8 10 4 M34 14 C32 10 36 8 34 4" fill="none" stroke="${P_.grey}" stroke-width="2" stroke-linecap="round"/><path d="M4 38 L44 38" ${S}/>`,
  pump: `<rect x="10" y="10" width="20" height="32" rx="2" fill="${P_.red}" ${s2}/><rect x="14" y="14" width="12" height="8" fill="${P_.white}" ${s2}/><path d="M30 16 C38 16 38 24 38 30 L38 36" fill="none" ${S}/><rect x="35" y="34" width="6" height="6" fill="#2b2b3f" ${s2}/><path d="M17 28 l3 -3 l3 3 l-3 5 Z" fill="${P_.gold}"/>`,
  crowd: `<path d="M8 20 L24 10 L40 20 Z" fill="${P_.cream}" ${s2}/><rect x="10" y="20" width="28" height="12" fill="${P_.cream}" ${s2}/>${[8, 16, 24, 32, 40].map((x, i) => `<circle cx="${x}" cy="${38 - (i % 2) * 2}" r="4" fill="${[P_.orange, P_.sky, P_.pink, P_.mint, P_.violet][i]}" ${s2}/>`).join('')}`,
  lock: `<path d="M15 22 L15 16 C15 6 33 6 33 16 L33 22" fill="none" stroke="${P_.grey}" stroke-width="5"/><rect x="10" y="22" width="28" height="20" rx="3" fill="${P_.gold}" ${s2}/><circle cx="24" cy="31" r="3" fill="${O}"/><path d="M24 31 L24 37" stroke="${O}" stroke-width="3"/>`,
  rain: `<path d="M9 22 C3 22 3 12 10 12 C11 4 24 2 27 9 C33 6 41 11 39 17 C44 18 43 24 38 24 L11 24 Z" fill="#7a86a8" ${s2}/>${[12, 20, 28, 36].map((x) => `<path d="M${x} 29 L${x - 3} 37" stroke="${P_.sky}" stroke-width="3" stroke-linecap="round"/>`).join('')}<path d="M4 44 L44 44" stroke="${P_.sky}" stroke-width="3"/>`,
  envelope: `<rect x="6" y="12" width="36" height="26" rx="2" fill="${P_.white}" ${s2}/><path d="M6 14 L24 28 L42 14" fill="none" ${s2}/><circle cx="36" cy="34" r="6" fill="${P_.gold}" ${s2}/>`,
  hand: `<path d="M16 44 L16 22 C16 18 21 18 21 22 L21 12 C21 8 26 8 26 12 L26 10 C26 6 31 6 31 10 L31 14 C31 10 36 10 36 14 L36 32 C36 40 32 44 26 44 Z" fill="${P_.cream}" ${s2}/>`,
  diploma: `<rect x="6" y="14" width="36" height="16" rx="8" fill="${P_.white}" ${s2}/><path d="M24 14 L24 30" stroke="${P_.red}" stroke-width="4"/><path d="M22 30 L20 40 L24 37 L28 40 L26 30" fill="${P_.red}" ${s2}/>`,
  fire: `<rect x="8" y="24" width="32" height="18" fill="#5a4a4a" ${s2}/><path d="M14 24 C10 16 18 14 16 6 C24 10 26 16 24 22 C28 18 30 14 30 10 C38 16 36 22 34 24 Z" fill="${P_.orange}" ${s2}/><path d="M20 24 C18 20 22 18 22 14 C26 18 28 22 26 24 Z" fill="${P_.gold}"/>`,
  ticket: `<path d="M6 14 L42 14 L42 20 C38 20 38 28 42 28 L42 34 L6 34 L6 28 C10 28 10 20 6 20 Z" fill="${P_.gold}" ${s2}/><path d="M16 14 L16 34" stroke="${O}" stroke-width="2" stroke-dasharray="3 3"/><path d="M22 22h14M22 27h10" stroke="${O}" stroke-width="2"/>`,
  suitcase: `<rect x="6" y="16" width="36" height="24" rx="3" fill="${P_.orange}" ${s2}/><path d="M18 16 L18 10 L30 10 L30 16" fill="none" ${S}/><path d="M16 16 L16 40 M32 16 L32 40" stroke="${O}" stroke-width="2"/><circle cx="38" cy="10" r="5" fill="${P_.gold}" ${s2}/>`,
  gem: `<path d="M8 18 L16 8 L32 8 L40 18 L24 42 Z" fill="${P_.sky}" ${s2}/><path d="M8 18 L40 18 M16 8 L20 18 L24 42 M32 8 L28 18 L24 42" fill="none" stroke="${O}" stroke-width="2"/>`,
  umbrella: `<path d="M4 24 C4 6 44 6 44 24 C40 20 36 20 32 24 C28 20 20 20 16 24 C12 20 8 20 4 24 Z" fill="${P_.violet}" ${s2}/><path d="M24 22 L24 38 C24 44 16 44 16 38" fill="none" ${S}/>`,
  ball: `<circle cx="24" cy="22" r="15" fill="${P_.violet}" ${s2}/><path d="M16 16 C18 12 22 10 26 10" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M12 38 L36 38 L32 44 L16 44 Z" fill="${P_.brown}" ${s2}/>`,
  egg: `<path d="M24 6 C34 6 40 22 40 30 C40 40 32 44 24 44 C16 44 8 40 8 30 C8 22 14 6 24 6 Z" fill="${P_.gold}" ${s2}/><path d="M16 22 C18 16 20 14 22 12" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`,
  dice: `<rect x="8" y="8" width="32" height="32" rx="6" fill="${P_.white}" ${s2}/><circle cx="16" cy="16" r="3" fill="${O}"/><circle cx="24" cy="24" r="3" fill="${O}"/><circle cx="32" cy="32" r="3" fill="${O}"/>`,
  star: `<path d="M24 5 L29 18 L43 18 L32 27 L36 41 L24 33 L12 41 L16 27 L5 18 L19 18 Z" fill="${P_.gold}" ${s2}/>`,
  wrench: `<path d="M30 6 C38 4 44 12 40 18 L34 16 L32 22 L36 26 C30 30 22 26 24 18 L8 34 C6 36 6 40 8 42 C10 44 14 44 16 40 L30 26" fill="${P_.grey}" ${s2}/>`,
  sparkle: `<path d="M24 4 C26 18 30 22 44 24 C30 26 26 30 24 44 C22 30 18 26 4 24 C18 22 22 18 24 4 Z" fill="${P_.gold}" ${s2}/>`,
  tick: `<circle cx="24" cy="24" r="18" fill="${P_.mint}" ${s2}/><path d="M15 25 L22 32 L34 17" fill="none" stroke="${O}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  cross: `<circle cx="24" cy="24" r="18" fill="${P_.red}" ${s2}/><path d="M17 17 L31 31 M31 17 L17 31" stroke="${O}" stroke-width="4" stroke-linecap="round"/>`,
  shrug: `<circle cx="24" cy="24" r="18" fill="${P_.grey}" ${s2}/><path d="M14 28 L18 22 L22 26 M34 28 L30 22 L26 26" fill="none" stroke="${O}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 16 L29 16" stroke="${O}" stroke-width="3" stroke-linecap="round"/>`,
  warn: `<path d="M24 5 L44 40 L4 40 Z" fill="${P_.gold}" ${s2}/><path d="M24 17 L24 29" stroke="${O}" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="35" r="2.4" fill="${O}"/>`,
  factory: `<path d="M4 42 L4 22 L14 28 L14 22 L24 28 L24 22 L34 28 L34 10 L42 10 L42 42 Z" fill="${P_.violet}" ${s2}/><path d="M36 4 C34 2 38 0 40 2" fill="none" stroke="${P_.grey}" stroke-width="2"/><path d="M8 34h6M18 34h6M28 34h6" stroke="${P_.gold}" stroke-width="3"/>`,
  chartup: `<rect x="4" y="6" width="40" height="36" rx="3" fill="${P_.white}" ${s2}/><path d="M9 34 L18 26 L25 30 L38 14" fill="none" stroke="${P_.mint}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M31 14 L38 14 L38 21" fill="none" stroke="${P_.mint}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  chartdown: `<rect x="4" y="6" width="40" height="36" rx="3" fill="${P_.white}" ${s2}/><path d="M9 14 L18 22 L25 18 L38 34" fill="none" stroke="${P_.red}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M31 34 L38 34 L38 27" fill="none" stroke="${P_.red}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  tv: `<rect x="4" y="10" width="40" height="28" rx="4" fill="#2b2b3f" ${s2}/><rect x="8" y="14" width="32" height="20" fill="${P_.sky}"/><path d="M18 4 L24 10 L30 4" fill="none" ${s2}/><path d="M16 42 L32 42" ${S}/>`,
  gift: `<rect x="8" y="20" width="32" height="22" fill="${P_.pink}" ${s2}/><rect x="6" y="14" width="36" height="8" fill="${P_.pink}" ${s2}/><path d="M24 14 L24 42" stroke="${P_.gold}" stroke-width="5"/><path d="M24 14 C16 4 10 10 16 14 M24 14 C32 4 38 10 32 14" fill="none" ${s2}/>`,
  jar: `<path d="M12 12 L36 12 L36 16 C42 18 42 22 42 28 L42 40 C42 44 38 46 34 46 L14 46 C10 46 6 44 6 40 L6 28 C6 22 6 18 12 16 Z" fill="${P_.sky}" fill-opacity=".25" ${s2}/><rect x="12" y="6" width="24" height="7" rx="2" fill="${P_.brown}" ${s2}/><circle cx="16" cy="38" r="5" fill="${P_.gold}" ${s2}/><circle cx="28" cy="39" r="5" fill="${P_.gold}" ${s2}/><circle cx="22" cy="31" r="5" fill="${P_.gold}" ${s2}/>`,
  calendar: `<rect x="6" y="10" width="36" height="32" rx="3" fill="${P_.white}" ${s2}/><rect x="6" y="10" width="36" height="9" fill="${P_.red}" ${s2}/><path d="M15 6 L15 14 M33 6 L33 14" ${S}/><path d="M13 26h6M22 26h6M31 26h4M13 33h6M22 33h6" stroke="${O}" stroke-width="2.6"/>`,
  swords: `<path d="M8 8 L30 30 M40 8 L18 30" stroke="${P_.grey}" stroke-width="5" stroke-linecap="round"/><path d="M26 34 L34 26 M14 26 L22 34" stroke="${P_.gold}" stroke-width="5" stroke-linecap="round"/><path d="M34 34 L40 40 M14 34 L8 40" stroke="${P_.brown}" stroke-width="5" stroke-linecap="round"/>`,
  clock: `<circle cx="24" cy="24" r="18" fill="${P_.white}" ${s2}/><path d="M24 12 L24 24 L32 30" fill="none" stroke="${O}" stroke-width="3" stroke-linecap="round"/>`,
  cap: `<path d="M4 18 L24 8 L44 18 L24 28 Z" fill="#231a3f" ${s2}/><path d="M12 22 L12 32 C18 38 30 38 36 32 L36 22" fill="#231a3f" ${s2}/><path d="M40 20 L40 32" stroke="${P_.gold}" stroke-width="3"/><circle cx="40" cy="34" r="3" fill="${P_.gold}"/>`,
  bolt: `<path d="M28 4 L10 28 L22 28 L18 44 L38 18 L26 18 Z" fill="${P_.gold}" ${s2}/>`,
  trophy: `<path d="M14 8 L34 8 L34 18 C34 26 28 30 24 30 C20 30 14 26 14 18 Z" fill="${P_.gold}" ${s2}/><path d="M14 12 C6 12 6 22 14 22 M34 12 C42 12 42 22 34 22" fill="none" ${s2}/><path d="M24 30 L24 36 M16 42 L32 42 L30 36 L18 36 Z" fill="${P_.gold2}" ${s2}/>`,
  book: `<path d="M24 12 C18 8 10 8 6 10 L6 40 C10 38 18 38 24 42 C30 38 38 38 42 40 L42 10 C38 8 30 8 24 12 Z" fill="${P_.white}" ${s2}/><path d="M24 12 L24 42" stroke="${O}" stroke-width="2.4"/><path d="M10 18h10M10 24h10M28 18h10M28 24h10" stroke="${P_.grey}" stroke-width="2"/>`,
  gear: `<circle cx="24" cy="24" r="9" fill="${P_.grey}" ${s2}/>${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<rect x="21" y="5" width="6" height="8" rx="1" fill="${P_.grey}" ${s2} transform="rotate(${a} 24 24)"/>`).join('')}<circle cx="24" cy="24" r="4" fill="${O}"/>`,
  mountain: `<path d="M2 42 L18 14 L26 26 L32 18 L46 42 Z" fill="${P_.violet}" ${s2}/><path d="M18 14 L14 21 L18 19 L22 21 Z" fill="${P_.white}"/><path d="M32 18 L32 6 L40 9 L32 12" fill="${P_.red}" stroke="${O}" stroke-width="2"/>`,
  play: `<circle cx="24" cy="24" r="20" fill="${P_.gold}" ${s2}/><path d="M19 14 L35 24 L19 34 Z" fill="${O}"/>`,
  arrowup: `<path d="M24 6 L42 26 L31 26 L31 42 L17 42 L17 26 L6 26 Z" fill="${P_.mint}" ${s2}/>`,
  arrowdown: `<path d="M24 42 L42 22 L31 22 L31 6 L17 6 L17 22 L6 22 Z" fill="${P_.red}" ${s2}/>`,
  chain: `<ellipse cx="14" cy="24" rx="9" ry="6" fill="none" stroke="${P_.grey}" stroke-width="4"/><ellipse cx="34" cy="24" rx="9" ry="6" fill="none" stroke="${P_.grey}" stroke-width="4"/><ellipse cx="24" cy="24" rx="9" ry="6" fill="none" stroke="#7a70a8" stroke-width="4"/>`,
  map: `<rect x="4" y="8" width="40" height="32" rx="3" fill="${P_.sky}" ${s2}/><path d="M10 16 C14 12 20 16 18 22 C16 26 12 26 10 22 Z M26 14 C32 12 38 16 36 22 C34 30 28 32 26 26 Z" fill="${P_.green}" ${s2}/>`,
};

export function icon(name, size = 48, label = '') {
  return svg('0 0 48 48', I[name] || I.coin, { size, cls: `icon icon-${name}`, label });
}
export const hasIcon = (name) => !!I[name];

// ------------------------------------------------------------------ what stands for what

export const PLAIN = {
  save: { label: 'Safe box', icon: 'safe', cap: 'Grows slowly, never falls', town: 'bank', townName: 'Bank' },
  index: { label: 'Basket of companies', icon: 'basket', cap: 'Owns a bit of everything', town: 'basket', townName: 'Market hall' },
  stocks: { label: 'Pick a company', icon: 'companies', cap: 'Big wins, big falls', town: 'companies', townName: 'Company street' },
  prop: { label: 'Houses', icon: 'house', cap: 'Pays rent every year', town: 'house', townName: 'Estate agent' },
  crypto: { label: 'Crypto', icon: 'rocket', cap: 'Can fly or crash', town: 'rocket', townName: 'Neon kiosk' },
  biz: { label: 'Your business', icon: 'shop', cap: 'Pays profit if you feed it', town: 'shop', townName: 'Your shop' },
  land: { label: 'Land', icon: 'plot', cap: 'Plots across your country', town: 'plot', townName: 'Land office' },
  car: { label: 'Car', icon: 'car', cap: 'Loses value every year', town: 'car', townName: 'Car lot' },
  fx: { label: 'Foreign money', icon: 'swap', cap: 'Rises when your money falls', town: 'swap', townName: 'Money changer' },
};

export const WEATHER = {
  boom: { icon: 'sun', word: 'Sunny', sky: ['#7fd1ff', '#c9ecff'] },
  steady: { icon: 'cloud', word: 'Cloudy', sky: ['#9fc3e0', '#d7e7f3'] },
  over: { icon: 'hotsun', word: 'Heatwave', sky: ['#ff9f6b', '#ffd9a8'] },
  crash: { icon: 'storm', word: 'Storm', sky: ['#3a3f5c', '#6a7090'] },
  recov: { icon: 'rainbow', word: 'Rainbow', sky: ['#8fd3ff', '#e0f4ff'] },
};

// Who brings each event, and the picture behind them.
export const EVENT_ART = {
  promo: ['boss', 'desk'], layoff: ['boss', 'desk'], wedding: ['family', 'rings'], baby: ['family', 'cot'],
  medical: ['doctor', 'clinic'], blacktax: ['family', 'fire'], car: ['mechanic', 'car'], raise: ['boss', 'payslip'],
  inherit: ['family', 'envelope'], gig: ['friend', 'desk'], course: ['boss', 'diploma'], burnout: ['doctor', 'clinic'],
  bonus: ['boss', 'payslip'], loan: ['friend', 'coffee'], renthike: ['landlord', 'house'], deval: ['anchor', 'swap'],
  fuel: ['anchor', 'pump'], bankrumour: ['anchor', 'crowd'], land: ['landlord', 'plot'], bond: ['banker', 'counter'],
  startup: ['friend', 'phone'], forex: ['hype', 'chartup'], coinhype: ['hype', 'rocket'], contract: ['boss', 'shop'],
  theft: ['neighbour', 'lock'], flood: ['neighbour', 'rain'], shop: ['landlord', 'shop'], mentor: ['guide', 'coffee'],
  offplan: ['hype', 'plot'], pension: ['boss', 'payslip'], lotto: ['friend', 'ticket'], hack: ['anchor', 'lock'],
};

export const CARD_ART = {
  side_hustle: 'desk', diamond_hands: 'gem', landlord: 'house', contrarian: 'chartup', frugal_genius: 'safe',
  insider: 'phone', leverage: 'dice', compound: 'coins', efund_pro: 'umbrella', networker: 'coffee', dividend: 'coins',
  ponzi: 'hype', mlm: 'hype', health_cover: 'clinic', remote_job: 'desk', crystal: 'ball', manager_pro: 'shop',
  franchise: 'shop', rate_watcher: 'bank', analyst: 'companies', angel: 'rocket', tax_smart: 'payslip', degen: 'rocket',
  stoic: 'smile', coach: 'diploma', oracle: 'ball', golden_goose: 'egg', rich_uncle: 'envelope', bs_hedge: 'umbrella',
};
export const TYPE_ICON = { Skill: 'star', Tool: 'wrench', Gamble: 'dice', Offer: 'hype', Legendary: 'sparkle' };

export function cardPic(id, size = 64) {
  const k = CARD_ART[id] || 'star';
  return k === 'hype' ? castFace('hype', 'sly', size) : icon(k, size);
}

// ------------------------------------------------------------------ small money pictures

// Cash as coins in a jar. Fill tracks cash against a year of costs; idle cash
// makes the jar shrink a little; debt wraps it in a chain.
export function coinJar(fill, { debt = false, shrink = 0, size = 52 } = {}) {
  const f = Math.max(0, Math.min(1, fill));
  const n = Math.round(f * 9);
  const coins = [];
  const spots = [[16, 40], [28, 40], [22, 40], [13, 33], [25, 33], [34, 36], [19, 26], [30, 27], [24, 20]];
  for (let i = 0; i < n; i++) coins.push(`<circle cx="${spots[i][0]}" cy="${spots[i][1]}" r="5" fill="${P_.gold}" ${s2}/>`);
  const sc = 1 - Math.min(0.2, shrink);
  const chain = debt ? `<path d="M3 24 C16 30 32 30 45 24" fill="none" stroke="${P_.grey}" stroke-width="4" stroke-dasharray="5 2"/><rect x="36" y="30" width="10" height="12" rx="2" fill="#5a5470" ${s2}/>` : '';
  return svg('0 0 48 48', `<g transform="translate(${24 * (1 - sc)} ${24 * (1 - sc)}) scale(${sc})"><path d="M12 12 L36 12 L36 16 C42 18 42 22 42 28 L42 40 C42 44 38 46 34 46 L14 46 C10 46 6 44 6 40 L6 28 C6 22 6 18 12 16 Z" fill="${P_.sky}" fill-opacity=".18" ${s2}/>${coins.join('')}<rect x="12" y="6" width="24" height="7" rx="2" fill="${P_.brown}" ${s2}/></g>${chain}`, { size, cls: 'jar', label: debt ? 'Coin jar in chains: you owe money' : `Coin jar ${Math.round(f * 100)}% full` });
}

// Freedom as a fruit tree: the more passive income, the more fruit.
export function fruitTree(prog, size = 44) {
  const n = Math.round(Math.max(0, Math.min(1, prog)) * 7);
  const spots = [[16, 18], [28, 13], [31, 24], [20, 26], [24, 8], [12, 25], [36, 17]];
  const fruit = spots.slice(0, n).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.4" fill="${P_.red}" ${s2}/>`).join('');
  return svg('0 0 48 48', `<rect x="21" y="28" width="6" height="16" fill="${P_.brown}" ${s2}/><circle cx="24" cy="19" r="15" fill="${P_.green}" ${s2}/>${fruit}`, { size, cls: 'tree', label: `Fruit tree with ${n} fruit` });
}

// A face that shows joy, for places where the avatar is too big.
export function joyFace(joy, size = 22) {
  // Five steps, from sad to beaming, so every level looks different.
  const lv = joy >= 85 ? 4 : joy >= 60 ? 3 : joy >= 40 ? 2 : joy >= 20 ? 1 : 0;
  const mouth = ['M16 33 Q24 26 32 33', 'M17 32 Q24 29 31 32', 'M17 30 L31 30', 'M16 28 Q24 36 32 28', ''][lv];
  const fill = [P_.sky, '#bfe0f0', P_.cream, P_.gold, P_.gold][lv];
  const grin = lv === 4 ? `<path d="M14 27 Q24 42 34 27 Z" fill="#6b1f2b" ${s2}/><path d="M17 28 L31 28" stroke="#fff" stroke-width="2"/>` : `<path d="${mouth}" fill="none" ${s2}/>`;
  return svg('0 0 48 48', `<circle cx="24" cy="24" r="17" fill="${fill}" ${s2}/><circle cx="18" cy="21" r="2.4" fill="${O}"/><circle cx="30" cy="21" r="2.4" fill="${O}"/>${grin}`, { size, cls: 'joyface', label: `Joy ${Math.round(joy)}` });
}

// ------------------------------------------------------------------ lifestyle rooms

export function room(level, size = 64) {
  const wall = ['#8a7a6a', '#b8a58a', '#d9c7a8', '#e8d4f0', '#f4e3b0'][level];
  const floor = ['#6a4a3a', '#8a5a3a', '#a06a42', '#7a4a8a', '#c9a24a'][level];
  const items = [
    `<rect x="16" y="46" width="30" height="5" rx="1" fill="#c98a4a" ${s2}/><path d="M32 8 L32 18" stroke="${O}" stroke-width="2"/><circle cx="32" cy="21" r="4" fill="#fff4b0" ${s2}/>`,
    `<rect x="8" y="38" width="30" height="12" rx="2" fill="${P_.sky}" ${s2}/><rect x="8" y="34" width="10" height="8" rx="2" fill="${P_.white}" ${s2}/><path d="M50 30 L50 50" stroke="${O}" stroke-width="2"/><circle cx="50" cy="28" r="6" fill="${P_.green}" ${s2}/>`,
    `<rect x="6" y="36" width="34" height="14" rx="4" fill="${P_.orange}" ${s2}/><rect x="6" y="30" width="34" height="8" rx="3" fill="${P_.orange}" ${s2}/><rect x="44" y="18" width="16" height="12" rx="2" fill="#2b2b3f" ${s2}/><rect x="46" y="20" width="12" height="8" fill="${P_.sky}"/><path d="M52 30 L52 50" stroke="${O}" stroke-width="2"/>`,
    `<rect x="4" y="34" width="38" height="16" rx="5" fill="${P_.violet}" ${s2}/><rect x="4" y="28" width="38" height="9" rx="4" fill="${P_.violet}" ${s2}/><rect x="44" y="14" width="18" height="14" rx="2" fill="#2b2b3f" ${s2}/><rect x="46" y="16" width="14" height="10" fill="${P_.pink}"/><ellipse cx="32" cy="54" rx="26" ry="3" fill="${P_.pink}" opacity=".6"/>`,
    `<path d="M32 4 L32 10" stroke="${O}" stroke-width="2"/><path d="M20 12 L44 12 L40 20 L24 20 Z" fill="${P_.gold}" ${s2}/>${[22, 28, 34, 40].map((x) => `<circle cx="${x}" cy="22" r="2" fill="#fff4b0"/>`).join('')}<rect x="4" y="34" width="40" height="16" rx="6" fill="${P_.gold}" ${s2}/><rect x="4" y="27" width="40" height="10" rx="5" fill="${P_.gold2}" ${s2}/><ellipse cx="56" cy="44" rx="5" ry="7" fill="${P_.mint}" ${s2}/>`,
  ][level];
  return svg('0 0 64 60', `<rect x="1" y="1" width="62" height="58" rx="6" fill="${wall}"/><rect x="1" y="50" width="62" height="9" fill="${floor}"/>${items}<rect x="1" y="1" width="62" height="58" rx="6" fill="none" ${s2}/>`, { size, cls: 'room', label: ['A mat on the floor', 'A small room with a bed', 'A sofa and a TV', 'A big sofa and a large TV', 'A chandelier and a golden sofa'][level] });
}

// ------------------------------------------------------------------ the home scene

function weatherLayer(mood, w) {
  const W = WEATHER[mood] || WEATHER.steady;
  const x = w - 46;
  switch (mood) {
    case 'boom': return `<g class="sun-rays"><circle cx="${x}" cy="30" r="15" fill="${P_.gold}" ${s2}/>${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M${x} 6 L${x} 12" transform="rotate(${a} ${x} 30)" stroke="${P_.gold2}" stroke-width="4" stroke-linecap="round"/>`).join('')}</g>`;
    case 'over': return `<circle cx="${x}" cy="30" r="17" fill="${P_.red}" ${s2}/><g class="haze">${[60, 76, 92].map((y) => `<path d="M10 ${y} C30 ${y - 5} 50 ${y + 5} 70 ${y} S110 ${y - 5} 130 ${y} S170 ${y + 5} 190 ${y} S230 ${y - 5} 250 ${y} S290 ${y + 5} 310 ${y} S350 ${y - 5} 360 ${y}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="3"/>`).join('')}</g>`;
    case 'crash': return `<path d="M${x - 50} 38 C${x - 64} 38 ${x - 64} 20 ${x - 48} 20 C${x - 44} 6 ${x - 14} 4 ${x - 8} 16 C${x + 6} 12 ${x + 20} 22 ${x + 14} 32 C${x + 26} 34 ${x + 24} 44 ${x + 12} 44 L${x - 48} 44 Z" fill="#4a4f70" ${s2}/><path class="bolt" d="M${x - 16} 44 L${x - 26} 64 L${x - 16} 64 L${x - 22} 80 L${x - 2} 58 L${x - 12} 58 L${x - 6} 44 Z" fill="${P_.gold}" ${s2}/><g class="rain">${Array.from({ length: 14 }, (_, i) => `<path d="M${14 + i * 25} ${50 + (i % 3) * 18} l-5 12" stroke="${P_.sky}" stroke-width="2.4" stroke-linecap="round"/>`).join('')}</g>`;
    case 'recov': return `<g opacity=".85"><path d="M${w - 170} 130 A90 90 0 0 1 ${w + 10} 130" fill="none" stroke="${P_.red}" stroke-width="7"/><path d="M${w - 160} 130 A80 80 0 0 1 ${w} 130" fill="none" stroke="${P_.gold}" stroke-width="7"/><path d="M${w - 150} 130 A70 70 0 0 1 ${w - 10} 130" fill="none" stroke="${P_.mint}" stroke-width="7"/><path d="M${w - 140} 130 A60 60 0 0 1 ${w - 20} 130" fill="none" stroke="${P_.sky}" stroke-width="7"/></g>`;
    default: return `<circle cx="${x + 8}" cy="26" r="12" fill="${P_.gold}" ${s2}/><path d="M${x - 40} 44 C${x - 52} 44 ${x - 52} 28 ${x - 38} 28 C${x - 36} 14 ${x - 10} 12 ${x - 6} 24 C${x + 4} 20 ${x + 16} 28 ${x + 12} 36 C${x + 20} 38 ${x + 18} 46 ${x + 10} 46 L${x - 40} 46 Z" fill="${P_.white}" ${s2}/>`;
  }
}

// run-like input: { home, district, car, family: [{ look, age, sex, style, expr }], mood,
// rental, biz, farmer, sea, beach, guard, cctv, worn }. Older callers may pass
// { stage, life } instead of a home.
const LEGACY_HOME = ['room', 'studio', 'flat2', 'house', 'mansion'];

function building(id, g, lit) {
  const win = (x, y, w = 12, h = 12, on = false) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="${on ? lit : '#8fb7d9'}" ${s2}/>`;
  switch (id) {
    case 'room': return `<rect x="54" y="${g - 44}" width="150" height="44" fill="#c8a987" ${S}/><path d="M48 ${g - 44} L210 ${g - 44} L204 ${g - 56} L54 ${g - 56} Z" fill="#8f8f9f" ${s2}/>${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${62 + i * 24}" y="${g - 30}" width="12" height="30" fill="${i === 2 ? '#6a4a3a' : '#7a5a44'}" ${s2}/>`).join('')}<path d="M60 ${g - 40} L200 ${g - 40}" stroke="${O}" stroke-width="1"/>${[70, 94, 118, 142].map((x, i) => `<rect x="${x}" y="${g - 39}" width="8" height="10" fill="${[P_.pink, P_.sky, P_.gold, P_.mint][i]}"/>`).join('')}`;
    case 'studio': return `<rect x="68" y="${g - 74}" width="104" height="74" fill="#d9c3a5" ${S}/><rect x="64" y="${g - 80}" width="112" height="8" fill="#9a7a5a" ${S}/>${[0, 1].map((r) => [0, 1, 2].map((c) => win(78 + c * 30, g - 66 + r * 30, 16, 16, r === 1 && c === 0)).join('')).join('')}<rect x="146" y="${g - 30}" width="16" height="30" fill="#6a4a3a" ${s2}/>`;
    case 'flat2': return `<rect x="62" y="${g - 118}" width="112" height="118" fill="#c9b6dc" ${S}/>${[0, 1, 2, 3].map((r) => [0, 1, 2].map((c) => win(72 + c * 34, g - 110 + r * 26, 18, 15, r === 2 && c === 1)).join('') + `<path d="M66 ${g - 92 + r * 26} L170 ${g - 92 + r * 26}" stroke="${O}" stroke-width="1.6"/>`).join('')}<rect x="108" y="${g - 22}" width="20" height="22" fill="#6a4a3a" ${s2}/>`;
    case 'house': return `<path d="M44 ${g - 78} L118 ${g - 124} L192 ${g - 78} Z" fill="${P_.red}" ${S}/><rect x="54" y="${g - 80}" width="128" height="80" fill="${P_.cream}" ${S}/>${win(66, g - 70, 24, 18)}${win(146, g - 70, 24, 18, true)}${win(66, g - 36, 24, 18, true)}${win(146, g - 36, 24, 18)}<rect x="106" y="${g - 38}" width="24" height="38" fill="#7a4a2a" ${s2}/><path d="M54 ${g - 44} L182 ${g - 44}" stroke="${O}" stroke-width="1.6"/>`;
    case 'mansion': return `<path d="M30 ${g - 86} L118 ${g - 130} L206 ${g - 86} Z" fill="#5a4a8a" ${S}/><rect x="38" y="${g - 88}" width="160" height="88" fill="${P_.white}" ${S}/>${[52, 80, 156, 184].map((x) => `<rect x="${x - 4}" y="${g - 84}" width="8" height="84" fill="#ece8f4" ${s2}/>`).join('')}${win(96, g - 78, 18, 20, true)}${win(122, g - 78, 18, 20)}${win(60, g - 40, 14, 18)}${win(162, g - 40, 14, 18, true)}<rect x="104" y="${g - 44}" width="28" height="44" fill="#5a3a1a" ${s2}/><circle cx="118" cy="${g - 102}" r="7" fill="${P_.gold}" ${s2}/>`;
    default: return '';
  }
}

function backdrop(d, g, w) {
  switch (d) {
    case 'inner': return `<g opacity=".55">${[[0, 70], [30, 96], [214, 88], [250, 110], [300, 76], [330, 100]].map(([x, h]) => `<rect x="${x}" y="${g - h}" width="30" height="${h}" fill="#7a7494"/>`).join('')}</g><path d="M0 ${g - 96} Q90 ${g - 84} 180 ${g - 96} T360 ${g - 96}" fill="none" stroke="${O}" stroke-width="1" opacity=".5"/>`;
    case 'suburb': return `<g opacity=".5">${[[214, 40], [290, 34]].map(([x, h]) => `<path d="M${x} ${g - h} L${x + 26} ${g - h - 18} L${x + 52} ${g - h} Z" fill="#b5617a"/><rect x="${x + 4}" y="${g - h}" width="44" height="${h}" fill="#e8dccc"/>`).join('')}</g>`;
    case 'gated': return `<rect x="0" y="${g - 18}" width="${w}" height="18" fill="#d8cbb4" ${s2}/>${[0, 40, 80, 120, 160, 200, 240, 280, 320].map((x) => `<rect x="${x}" y="${g - 22}" width="6" height="22" fill="#b8a888" ${s2}/>`).join('')}`;
    case 'upscale': return [16, 206, 330].map((x) => `<rect x="${x + 8}" y="${g - 40}" width="6" height="40" fill="${P_.brown}"/><circle cx="${x + 11}" cy="${g - 52}" r="18" fill="#3f9d5a" ${s2}/>`).join('');
    case 'waterfront': return `<rect x="0" y="${g - 14}" width="${w}" height="14" fill="#3a8fd0" opacity=".6"/><path d="M280 ${g - 16} L320 ${g - 16} L314 ${g - 8} L286 ${g - 8} Z" fill="${P_.white}" ${s2}/><path d="M300 ${g - 16} L300 ${g - 44} L318 ${g - 20} Z" fill="${P_.white}" ${s2}/>`;
    default: return '';
  }
}

export function carArt(id, x, y) {
  if (!id || id === 'none') return '';
  const body = { used: '#b8584a', saloon: '#3a6fd0', suv: '#2b2b3f', luxury: '#f3f0f8' }[id] || '#3a6fd0';
  const trim = id === 'luxury' ? P_.gold : '#cfe4f5';
  if (id === 'suv') return `<g transform="translate(${x} ${y})"><rect x="0" y="6" width="62" height="20" rx="4" fill="${body}" ${s2}/><path d="M6 6 L12 -8 L50 -8 L56 6 Z" fill="${body}" ${s2}/><rect x="15" y="-5" width="14" height="10" fill="${trim}"/><rect x="33" y="-5" width="14" height="10" fill="${trim}"/><circle cx="14" cy="26" r="7" fill="#1d1a24" ${s2}/><circle cx="48" cy="26" r="7" fill="#1d1a24" ${s2}/></g>`;
  const len = id === 'luxury' ? 70 : id === 'used' ? 50 : 60;
  return `<g transform="translate(${x} ${y + 4})"><path d="M0 ${id === 'used' ? 8 : 10} Q2 4 ${len * 0.2} 2 L${len * 0.3} -8 L${len * 0.72} -8 L${len * 0.86} 2 Q${len} 4 ${len} 12 L${len} 20 L0 20 Z" fill="${body}" ${s2}/><path d="M${len * 0.33} -5 L${len * 0.5} -5 L${len * 0.5} 2 L${len * 0.27} 2 Z M${len * 0.54} -5 L${len * 0.7} -5 L${len * 0.8} 2 L${len * 0.54} 2 Z" fill="${trim}"/>${id === 'luxury' ? `<path d="M2 12 L${len - 2} 12" stroke="${P_.gold}" stroke-width="1.6"/>` : ''}<circle cx="${len * 0.2}" cy="20" r="6.5" fill="#1d1a24" ${s2}/><circle cx="${len * 0.8}" cy="20" r="6.5" fill="#1d1a24" ${s2}/></g>`;
}

export function homeScene(o, { w = 360, h = 180, label = 'Your home' } = {}) {
  const W = WEATHER[o.mood] || WEATHER.steady;
  const g = h - 24;
  const beach = !!o.beach || (o.home == null && o.stage >= 4);
  const home = o.home || LEGACY_HOME[Math.max(0, Math.min(4, o.stage ?? 1))] || 'studio';
  const ground = beach ? '#f0d38a' : '#5fbf6f';
  const lit = '#fff4b0';
  const parts = [];
  parts.push(`<defs><linearGradient id="sky-${o.mood}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${W.sky[0]}"/><stop offset="1" stop-color="${W.sky[1]}"/></linearGradient></defs>`);
  parts.push(`<rect width="${w}" height="${h}" fill="url(#sky-${o.mood})"/>`);
  parts.push(weatherLayer(o.mood, w));
  if (beach) {
    parts.push(`<rect y="${g - 30}" width="${w}" height="30" fill="#3a9fe0" opacity=".75"/><rect y="${g}" width="${w}" height="${h - g}" fill="${ground}"/><path d="M300 ${g} L300 ${g - 74}" stroke="${P_.brown}" stroke-width="7" stroke-linecap="round"/>${[-60, -20, 20, 60].map((a) => `<path d="M300 ${g - 74} q${a / 2} -18 ${a} -4" fill="none" stroke="${P_.green}" stroke-width="9" stroke-linecap="round"/>`).join('')}<path d="M190 ${g - 50} L230 ${g - 62} L270 ${g - 50} Z" fill="${P_.red}" ${s2}/><path d="M230 ${g - 62} L230 ${g}" stroke="${O}" stroke-width="3"/>`);
  } else {
    parts.push(backdrop(o.district, g, w));
    parts.push(`<rect y="${g}" width="${w}" height="${h - g}" fill="${ground}"/><path d="M0 ${g} L${w} ${g}" stroke="${O}" stroke-width="3"/><rect y="${g + 10}" width="${w}" height="7" fill="#5a5470" opacity=".5"/>`);
    parts.push(`<g class="bldg">${building(home, g, lit)}</g>`);
    if (o.worn) parts.push(`<path d="M80 ${g - 20} l6 -8 l-3 -6 l5 -7 M150 ${g - 30} l-4 -6 l4 -5" fill="none" stroke="${O}" stroke-width="1.4" opacity=".7"/>`);
    if (o.cctv) parts.push(`<g transform="translate(${home === 'mansion' ? 190 : 170} ${g - (home === 'flat2' ? 110 : 64)})"><rect x="0" y="0" width="12" height="6" rx="2" fill="#e8e8f0" ${s2}/><circle cx="2" cy="3" r="1.4" fill="${P_.red}"/></g>`);
    if (o.district === 'gated') parts.push(`<g transform="translate(206 ${g - 38})"><rect x="0" y="0" width="22" height="38" fill="${P_.cream}" ${s2}/><path d="M-2 0 L24 0 L20 -8 L2 -8 Z" fill="${P_.red}" ${s2}/><rect x="5" y="8" width="12" height="10" fill="#8fb7d9" ${s2}/></g>`);
    // Rental property and business, small on the far right.
    let rx = 300;
    if (o.rental) { parts.push(`<g class="bldg"><rect x="${rx}" y="${g - 50}" width="46" height="50" fill="${P_.orange}" ${S}/>${[0, 1].map((r) => `<rect x="${rx + 7}" y="${g - 42 + r * 20}" width="12" height="11" fill="#8fb7d9" ${s2}/><rect x="${rx + 27}" y="${g - 42 + r * 20}" width="12" height="11" fill="#8fb7d9" ${s2}/>`).join('')}<rect x="${rx - 3}" y="${g - 64}" width="52" height="12" rx="2" fill="${P_.white}" ${s2}/><text x="${rx + 23}" y="${g - 55}" font-size="8" font-weight="800" text-anchor="middle" fill="${O}">FOR RENT</text></g>`); rx -= 0; }
    if (o.biz && !o.rental) {
      if (o.farmer) parts.push(`<g class="bldg">${[0, 1, 2].map((i) => `<path d="M${rx} ${g - 6 - i * 10} L${rx + 50} ${g - 6 - i * 10}" stroke="${P_.green}" stroke-width="6" stroke-linecap="round"/>`).join('')}</g>`);
      else parts.push(`<g class="bldg"><rect x="${rx}" y="${g - 40}" width="50" height="40" fill="${P_.cream}" ${S}/><path d="M${rx - 4} ${g - 50} L${rx + 54} ${g - 50} L${rx + 54} ${g - 38} L${rx - 4} ${g - 38} Z" fill="${P_.red}" ${s2}/><rect x="${rx + 30}" y="${g - 28}" width="12" height="28" fill="#7a4a2a" ${s2}/></g>`);
    }
    parts.push(carArt(o.car, 214, g - 26));
    if (o.guard) parts.push(`<svg x="236" y="${g - 70}" width="34" height="70" viewBox="0 0 40 82">${figure({ skin: SKINS[4], hair: 'short', outfit: '#2d3f7a', accent: '#2d3f7a', style: 1, age: 40, sex: 'm' })}</svg>`);
  }
  if (o.sea) parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="#2a4a7a" opacity=".45"/><g transform="translate(${w - 120} ${g - 40})"><path d="M0 30 L90 30 L78 44 L12 44 Z" fill="${P_.white}" ${S}/><rect x="30" y="10" width="30" height="20" fill="${P_.red}" ${s2}/><path d="M44 10 L44 -6" ${S}/></g>`);
  // You and your family, standing in front.
  const fam = o.family || (o.look ? [{ look: o.look, age: o.age, expr: o.expr, style: o.style ?? Math.max(0, Math.min(4, o.life ?? 1)) }] : []);
  let fx = beach ? 110 : 4;
  for (const p of fam) {
    const kid = (p.age ?? 30) < 16;
    const fw = kid ? 30 : 36;
    const fh = (fw * 82) / 40;
    parts.push(`<svg x="${fx}" y="${g - fh + 2}" width="${fw}" height="${fh}" viewBox="0 0 40 82">${lookFigure(p.look, { age: p.age, expr: p.expr, style: p.style ?? 1, sex: p.sex })}</svg>`);
    fx += kid ? 20 : 26;
  }
  parts.push(`<rect width="${w}" height="${h}" fill="none" stroke="${O}" stroke-width="3" rx="0"/>`);
  return svg(`0 0 ${w} ${h}`, parts.join(''), { cls: `scene mood-${o.mood}`, label });
}

// ------------------------------------------------------------------ the town

export function townScene(open, mood, { w = 360, h = 300 } = {}) {
  const W = WEATHER[mood] || WEATHER.steady;
  const spots = [
    ['save', 18, 70], ['index', 132, 60], ['stocks', 246, 70],
    ['prop', 18, 180], ['crypto', 132, 180], ['biz', 246, 180], ['fx', 132, 250],
  ];
  const parts = [`<defs><linearGradient id="tsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${W.sky[0]}"/><stop offset="1" stop-color="${W.sky[1]}"/></linearGradient></defs>`,
    `<rect width="${w}" height="${h}" fill="url(#tsky)"/>`, weatherLayer(mood, w),
    `<rect y="150" width="${w}" height="${h - 150}" fill="#5fbf6f"/><rect y="160" width="${w}" height="14" fill="#5a5470" opacity=".55"/><rect y="272" width="${w}" height="10" fill="#5a5470" opacity=".55"/>`];
  for (const [id, x, y] of spots) {
    if (!open.includes(id)) continue;
    const p = PLAIN[id];
    parts.push(`<g class="town-b" data-act="asset" data-id="${id}" role="button" tabindex="0" aria-label="${p.townName}: ${p.label}">
      <rect x="${x - 4}" y="${y - 4}" width="104" height="${id === 'fx' ? 44 : 86}" rx="10" fill="#fff" fill-opacity=".0"/>
      <svg x="${x + 22}" y="${y}" width="56" height="56" viewBox="0 0 48 48">${I[p.town]}</svg>
      <rect x="${x}" y="${y + 58}" width="96" height="20" rx="6" fill="${P_.cream}" ${s2}/>
      <text x="${x + 48}" y="${y + 72}" font-size="11" font-weight="800" text-anchor="middle" fill="${O}">${p.townName}</text></g>`);
  }
  parts.push(`<rect width="${w}" height="${h}" fill="none" stroke="${O}" stroke-width="3"/>`);
  return svg(`0 0 ${w} ${h}`, parts.join(''), { cls: 'town', label: 'Your town. Tap a building to buy or sell.' });
}

// ------------------------------------------------------------------ world map for the region picker

export function worldMap(regions, selected) {
  const land = [
    'M40 30 C60 14 110 14 128 30 C136 44 120 58 104 60 C96 74 84 80 78 70 C70 60 52 58 44 50 C36 44 34 36 40 30 Z',
    'M96 88 C108 82 124 90 122 108 C120 126 110 146 102 150 C96 140 92 118 90 104 C88 96 90 90 96 88 Z',
    'M160 30 C176 22 196 24 200 36 C196 46 180 48 170 46 C160 44 154 38 160 30 Z',
    'M162 56 C180 50 204 56 210 72 C214 92 206 110 196 124 C188 132 180 126 178 114 C176 100 168 92 162 84 C156 72 154 62 162 56 Z',
    'M206 26 C240 12 300 16 324 34 C334 46 322 60 304 62 C296 74 282 78 272 74 C260 82 250 70 244 62 C230 60 214 56 210 46 C204 38 202 30 206 26 Z',
    'M290 110 C304 104 326 108 330 120 C330 132 312 136 300 132 C290 128 284 118 290 110 Z',
  ].map((d) => `<path d="${d}" fill="#5fbf6f" ${s2}/>`).join('');
  const pins = Object.entries(regions).map(([id, r]) => {
    const x = r.x * 3.6;
    const y = r.y * 1.6;
    const on = id === selected;
    return `<g class="pin" data-act="region" data-id="${id}" role="button" tabindex="0" aria-label="${r.name}"><circle cx="${x}" cy="${y}" r="${on ? 11 : 8}" fill="${on ? P_.gold : P_.red}" ${s2}/><circle cx="${x}" cy="${y}" r="3" fill="${O}"/></g>`;
  }).join('');
  return svg('0 0 360 170', `<rect width="360" height="170" rx="12" fill="#3a8fd0"/>${land}${pins}`, { cls: 'worldmap', label: 'World map. Tap your home region.' });
}

// ------------------------------------------------------------------ your country, as six land zones

const ZONE_SPOTS = { farm: [180, 50], capital: [222, 118], corridor: [104, 104], mega: [82, 190], industry: [284, 170], coast: [214, 212] };
const ZONE_COL = { capital: P_.violet, mega: P_.orange, industry: '#8a8fa8', corridor: P_.gold, farm: P_.green, coast: P_.sky };
const ZONE_ICON = { capital: 'bank', mega: 'companies', industry: 'factory', corridor: 'arrowup', farm: 'field', coast: 'umbrella' };

// zones: [{ id, name, plots, news, locked }]. A schematic map, not to scale.
export function countryMap(zones, { country = '', w = 360, h = 270 } = {}) {
  const land = 'M60 40 C110 14 200 10 262 28 C318 44 344 92 330 142 C340 190 320 244 262 252 C206 262 168 238 122 250 C70 262 30 236 26 196 C22 160 40 136 34 104 C28 70 34 54 60 40 Z';
  const parts = [`<rect width="${w}" height="${h}" rx="12" fill="#3a8fd0"/>`, `<path d="${land}" fill="#79c47f" ${s2}/>`,
    `<path d="M104 104 L222 118 L82 190 M222 118 L284 170 M222 118 L180 50" fill="none" stroke="#e8dcc0" stroke-width="4" stroke-dasharray="2 5" stroke-linecap="round"/>`];
  for (const z of zones) {
    const [x, y] = ZONE_SPOTS[z.id];
    const col = ZONE_COL[z.id];
    parts.push(`<g class="zone-pin ${z.locked ? 'locked' : ''}" data-act="zone" data-id="${z.id}" role="button" tabindex="0" aria-label="${(z.name || '').replace(/"/g, '')}${z.plots ? `, you own ${z.plots}` : ''}">
      ${z.news ? `<circle class="zone-news" cx="${x}" cy="${y}" r="31" fill="none" stroke="${P_.gold}" stroke-width="3" stroke-dasharray="6 4"/>` : ''}
      <circle cx="${x}" cy="${y}" r="24" fill="${col}" ${s2}/>
      <svg x="${x - 15}" y="${y - 15}" width="30" height="30" viewBox="0 0 48 48">${I[ZONE_ICON[z.id]] || I.plot}</svg>
      ${z.plots ? `<g transform="translate(${x + 12} ${y - 30})"><path d="M0 22 L0 0" stroke="${O}" stroke-width="2"/><path d="M0 1 L14 3 L10 7 L14 11 L0 10 Z" fill="${P_.red}" ${s2}/><text x="7" y="-2" font-size="10" font-weight="800" text-anchor="middle" fill="#fff" stroke="${O}" stroke-width="2.5" paint-order="stroke">${z.plots}</text></g>` : ''}
      <text x="${x}" y="${y + 38}" font-family="Figtree, system-ui, sans-serif" font-size="10.5" font-weight="800" text-anchor="middle" fill="#fff" stroke="${O}" stroke-width="3" paint-order="stroke">${(z.name || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').slice(0, 26)}</text></g>`);
  }
  parts.push(`<text x="14" y="${h - 12}" font-family="Figtree, system-ui, sans-serif" font-size="11" font-weight="800" fill="#fff" stroke="${O}" stroke-width="3" paint-order="stroke">${country.replace(/</g, '&lt;')} · map not to scale</text>`);
  return svg(`0 0 ${w} ${h}`, parts.join(''), { cls: 'countrymap', label: `${country}: six land zones. Tap one to see plots for sale.` });
}

// Small pictures for the Trophy Wall. Missing ones are drawn as silhouettes.
export function homePic(id, size = 56, got = true) {
  const g = 150;
  const inner = building(id, g, '#fff4b0');
  const body = inner;
  return svg('24 14 196 140', got ? body : `<g opacity=".9" filter="url(#sil)">${body}</g><defs><filter id="sil"><feColorMatrix type="matrix" values="0 0 0 0 0.25  0 0 0 0 0.22  0 0 0 0 0.38  0 0 0 1 0"/></filter></defs>`, { size, cls: `trophy ${got ? '' : 'missing'}`, label: '' });
}
export function carPic(id, size = 56, got = true) {
  const body = carArt(id, 4, 18);
  return svg('0 0 80 50', got ? body : `<g filter="url(#silc)">${body}</g><defs><filter id="silc"><feColorMatrix type="matrix" values="0 0 0 0 0.25  0 0 0 0 0.22  0 0 0 0 0.38  0 0 0 1 0"/></filter></defs>`, { size, cls: `trophy ${got ? '' : 'missing'}`, label: '' });
}

// ------------------------------------------------------------------ small helpers used across screens

export const moodIcon = (mood, size = 28) => icon((WEATHER[mood] || WEATHER.steady).icon, size, (WEATHER[mood] || WEATHER.steady).word);

export function stageOf(prog) {
  return prog >= 1 ? 4 : prog >= 0.75 ? 3 : prog >= 0.5 ? 2 : prog >= 0.25 ? 1 : 0;
}
