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

function hairBack(style, c) {
  switch (style) {
    case 'afro': return `<circle cx="50" cy="42" r="31" fill="${c}" ${S}/>`;
    case 'long': return `<path d="M25 52 C22 24 38 18 50 18 C63 18 79 24 75 52 L80 92 L20 92 Z" fill="${c}" ${S}/>`;
    case 'braids': return `<rect x="21" y="44" width="9" height="46" rx="4" fill="${c}" ${S}/><rect x="70" y="44" width="9" height="46" rx="4" fill="${c}" ${S}/>`;
    case 'curly': return [26, 38, 50, 62, 74].map((x, i) => `<circle cx="${x}" cy="${i % 2 ? 22 : 27}" r="11" fill="${c}" ${S}/>`).join('') + `<circle cx="24" cy="42" r="9" fill="${c}" ${S}/><circle cx="76" cy="42" r="9" fill="${c}" ${S}/>`;
    case 'bun': return `<circle cx="50" cy="17" r="10" fill="${c}" ${S}/>`;
    default: return '';
  }
}

function hairFront(style, c, accent) {
  switch (style) {
    case 'bald': return `<path d="M28 50 C27 44 29 40 31 38" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/><path d="M72 50 C73 44 71 40 69 38" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`;
    case 'wrap': return `<path d="M23 48 C19 22 38 12 50 12 C64 12 83 18 77 48 C70 37 60 34 50 34 C41 34 30 37 23 48 Z" fill="${accent}" ${S}/><path d="M34 22 C44 26 58 26 68 20" fill="none" stroke="${O}" stroke-width="2"/><circle cx="72" cy="17" r="8" fill="${accent}" ${S}/>`;
    case 'hijab': return '';
    case 'afro': return `<path d="M28 44 C30 32 40 27 50 27 C60 27 70 32 72 44 C64 38 58 37 50 37 C42 37 35 39 28 44 Z" fill="${c}"/>`;
    case 'curly': return `<path d="M27 46 C29 32 40 28 50 28 C61 28 71 32 73 46 C66 40 58 38 50 38 C42 38 34 40 27 46 Z" fill="${c}" ${S}/>`;
    case 'long': return `<path d="M27 48 C27 28 40 22 50 22 C60 22 73 28 73 48 C66 38 57 33 47 33 C40 36 32 41 27 48 Z" fill="${c}" ${S}/>`;
    default: return `<path d="M27 47 C27 28 39 22 50 22 C62 22 74 28 73 47 C67 38 58 34 50 34 C42 34 33 38 27 47 Z" fill="${c}" ${S}/>`;
  }
}

function face(expr, eye = O) {
  const eyes = {
    happy: `<circle cx="41" cy="52" r="2.8" fill="${eye}"/><circle cx="59" cy="52" r="2.8" fill="${eye}"/>`,
    neutral: `<circle cx="41" cy="52" r="2.6" fill="${eye}"/><circle cx="59" cy="52" r="2.6" fill="${eye}"/>`,
    tired: `<path d="M37 53 L45 53 M55 53 L63 53" stroke="${eye}" stroke-width="2.6" stroke-linecap="round"/><path d="M38 57 Q41 59 44 57 M56 57 Q59 59 62 57" fill="none" stroke="#8a5a6a" stroke-width="1.6"/>`,
    shocked: `<circle cx="41" cy="51" r="4.2" fill="#fff" stroke="${eye}" stroke-width="2"/><circle cx="59" cy="51" r="4.2" fill="#fff" stroke="${eye}" stroke-width="2"/><circle cx="41" cy="51" r="1.8" fill="${eye}"/><circle cx="59" cy="51" r="1.8" fill="${eye}"/>`,
    cheer: `<path d="M37 53 Q41 47 45 53 M55 53 Q59 47 63 53" fill="none" stroke="${eye}" stroke-width="2.6" stroke-linecap="round"/>`,
    sly: `<path d="M37 52 L45 51 M55 51 L63 52" stroke="${eye}" stroke-width="2.6" stroke-linecap="round"/>`,
  }[expr] || '';
  const mouth = {
    happy: `<path d="M42 62 Q50 69 58 62" fill="none" stroke="${O}" stroke-width="2.6" stroke-linecap="round"/>`,
    neutral: `<path d="M44 64 L56 64" stroke="${O}" stroke-width="2.6" stroke-linecap="round"/>`,
    tired: `<path d="M43 66 Q50 62 57 66" fill="none" stroke="${O}" stroke-width="2.6" stroke-linecap="round"/>`,
    shocked: `<ellipse cx="50" cy="65" rx="4.5" ry="5.5" fill="#6b1f2b" stroke="${O}" stroke-width="2"/>`,
    cheer: `<path d="M40 60 Q50 75 60 60 Z" fill="#6b1f2b" stroke="${O}" stroke-width="2.4" stroke-linejoin="round"/><path d="M43 61 L57 61" stroke="#fff" stroke-width="2"/>`,
    sly: `<path d="M43 64 Q52 67 59 60" fill="none" stroke="${O}" stroke-width="2.6" stroke-linecap="round"/>`,
  }[expr] || '';
  const blush = expr === 'happy' || expr === 'cheer' ? '<circle cx="35" cy="60" r="3.5" fill="#ff7a8a" opacity=".35"/><circle cx="65" cy="60" r="3.5" fill="#ff7a8a" opacity=".35"/>' : '';
  return eyes + mouth + blush;
}

const ACC = {
  mortarboard: () => `<path d="M24 26 L50 15 L76 26 L50 37 Z" fill="#231a3f" ${S}/><rect x="37" y="27" width="26" height="9" fill="#231a3f"/><path d="M72 27 L74 40" stroke="${P_.gold}" stroke-width="3" stroke-linecap="round"/><circle cx="74" cy="42" r="3" fill="${P_.gold}"/>`,
  sailorcap: () => `<path d="M28 34 C28 22 72 22 72 34 Z" fill="${P_.white}" ${S}/><rect x="27" y="31" width="46" height="8" rx="2" fill="${P_.navy}" ${S}/><rect x="45" y="24" width="10" height="7" rx="2" fill="${P_.gold}"/>`,
  strawhat: () => `<ellipse cx="50" cy="33" rx="37" ry="8" fill="#e8c46a" ${S}/><path d="M32 33 C32 16 68 16 68 33 Z" fill="#e8c46a" ${S}/><path d="M33 29 L67 29" stroke="${P_.red}" stroke-width="4"/>`,
  cap: (a) => `<path d="M27 36 C27 20 73 20 73 36 Z" fill="${a}" ${S}/><path d="M50 36 L82 38 L80 42 L50 40 Z" fill="${a}" ${S}/>`,
  raincap: () => `<path d="M22 42 C22 18 78 18 78 42 L84 46 L16 46 Z" fill="${P_.gold}" ${S}/>`,
  sunglasses: () => `<rect x="31" y="46" width="16" height="11" rx="4" fill="${O}"/><rect x="53" y="46" width="16" height="11" rx="4" fill="${O}"/><path d="M47 50 L53 50" stroke="${O}" stroke-width="3"/><path d="M34 49 L39 49" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M56 49 L61 49" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`,
  glasses: () => `<circle cx="41" cy="52" r="7" fill="none" stroke="${O}" stroke-width="2.4"/><circle cx="59" cy="52" r="7" fill="none" stroke="${O}" stroke-width="2.4"/><path d="M48 52 L52 52" stroke="${O}" stroke-width="2.4"/>`,
  tie: (a) => `<path d="M50 86 L45 92 L50 116 L55 92 Z" fill="${a}" ${S}/>`,
  collar: () => `<path d="M38 85 L50 96 L62 85" fill="${P_.white}" ${S}/>`,
  lanyard: () => `<path d="M39 86 L50 104 L61 86" fill="none" stroke="${P_.red}" stroke-width="3"/><rect x="44" y="102" width="12" height="14" rx="2" fill="${P_.white}" ${S}/>`,
  stethoscope: () => `<path d="M38 86 C38 104 62 104 62 86" fill="none" stroke="#4a5a8a" stroke-width="3.5"/><circle cx="50" cy="104" r="4" fill="#c9d4f0" ${s2}/>`,
  chain: () => `<path d="M36 88 Q50 104 64 88" fill="none" stroke="${P_.gold}" stroke-width="4" stroke-dasharray="3 2"/><circle cx="50" cy="100" r="5" fill="${P_.gold}" ${s2}/>`,
  earrings: () => `<circle cx="28" cy="61" r="3" fill="${P_.gold}" ${s2}/><circle cx="72" cy="61" r="3" fill="${P_.gold}" ${s2}/>`,
  beard: (a, hc) => `<path d="M30 56 C31 76 42 80 50 80 C58 80 69 76 70 56 C64 66 58 67 50 67 C42 67 36 66 30 56 Z" fill="${hc}" ${S}/><path d="M44 63 Q50 60 56 63" fill="none" stroke="${O}" stroke-width="2"/>`,
  shawl: (a) => `<path d="M18 120 C20 96 32 86 50 88 C68 86 80 96 82 120" fill="${a}" ${S}/>`,
  coat: () => `<path d="M40 86 L50 112 L60 86" fill="none" stroke="${O}" stroke-width="2.4"/>`,
  watch: () => `<rect x="70" y="104" width="10" height="9" rx="2" fill="${P_.gold}" ${s2}/>`,
  hoe: () => `<path d="M86 60 L78 120" stroke="${P_.brown}" stroke-width="4" stroke-linecap="round"/><path d="M80 58 L94 62 L92 68 Z" fill="#9aa4b8" ${s2}/>`,
  phones: () => `<rect x="10" y="94" width="12" height="20" rx="3" fill="#2b2b3f" ${s2}/><rect x="78" y="94" width="12" height="20" rx="3" fill="#2b2b3f" ${s2}/><rect x="12.5" y="97" width="7" height="12" fill="${P_.sky}"/><rect x="80.5" y="97" width="7" height="12" fill="${P_.mint}"/>`,
  diploma: () => `<rect x="72" y="98" width="22" height="9" rx="4" fill="${P_.white}" ${s2}/><path d="M83 98 L83 107" stroke="${P_.red}" stroke-width="3"/>`,
  coinbag: () => `<path d="M76 96 C68 100 68 118 82 118 C96 118 96 100 88 96 Z" fill="#c9a36a" ${s2}/><path d="M77 96 L87 96" stroke="${O}" stroke-width="3"/><circle cx="82" cy="108" r="4" fill="${P_.gold}" ${s2}/>`,
  phonehype: () => `<rect x="74" y="88" width="16" height="28" rx="3" fill="#2b2b3f" ${s2}/><rect x="76.5" y="91" width="11" height="20" fill="${P_.mint}"/><path d="M77 108 L80 102 L83 104 L87 94" fill="none" stroke="${O}" stroke-width="1.8"/>`,
  hijab: (a) => `<path d="M22 60 C18 24 36 14 50 14 C64 14 82 24 78 60 C78 80 70 92 50 94 C30 92 22 80 22 60 Z" fill="${a}" ${S}/>`,
  wave: (a, hc, skin) => `<path d="M80 90 L92 66" stroke="${skin}" stroke-width="9" stroke-linecap="round"/><path d="M80 90 L92 66" fill="none" stroke="${O}" stroke-width="2" stroke-linecap="round" opacity=".0"/><circle cx="93" cy="62" r="6" fill="${skin}" ${s2}/>`,
};

// o: { skin, hair, hairColor, outfit, accent, expr, age, acc: [], label }
export function person(o, opts = {}) {
  const skin = o.skin || SKINS[2];
  const age = o.age || 25;
  const hc = age >= 50 ? '#cfcbdc' : o.hairColor || HAIR_COLORS[0];
  const outfit = o.outfit || P_.mint;
  const accent = o.accent || P_.orange;
  const acc = o.acc || [];
  const has = (k) => acc.includes(k);
  const hair = has('hijab') ? 'hijab' : o.hair || 'short';
  const back = [];
  const front = [];
  if (has('hijab')) back.push(ACC.hijab(accent));
  if (has('shawl') || has('wave')) { /* drawn with body */ }
  const lines = age >= 50 ? `<path d="M33 48 L30 46 M67 48 L70 46" stroke="${O}" stroke-width="1.4" opacity=".6"/><path d="M42 40 L58 40" stroke="${O}" stroke-width="1.2" opacity=".35"/>` : '';
  for (const k of acc) {
    if (['hijab', 'shawl', 'wave'].includes(k)) continue;
    front.push(ACC[k] ? ACC[k](accent, hc, skin) : '');
  }
  const body = `
    <path d="M16 121 C16 96 30 85 50 85 C70 85 84 96 84 121 Z" fill="${outfit}" ${S}/>
    ${has('shawl') ? ACC.shawl(accent) : ''}
    ${has('wave') ? ACC.wave(accent, hc, skin) : ''}
    <path d="M43 70 L43 90 L50 95 L57 90 L57 70 Z" fill="${skin}"/><path d="M43 70 L43 88 M57 70 L57 88" stroke="${O}" stroke-width="3" stroke-linecap="round"/><path d="M43 88 L50 94 L57 88" fill="none" stroke="${O}" stroke-width="2.4" stroke-linejoin="round"/>`;
  const head = `
    <circle cx="27" cy="54" r="6" fill="${skin}" ${S}/><circle cx="73" cy="54" r="6" fill="${skin}" ${S}/>
    <ellipse cx="50" cy="51" rx="23" ry="25" fill="${skin}" ${S}/>`;
  const inner = `${back.join('')}${hairBack(hair, hc)}${body}${head}${lines}${hairFront(hair, hc, accent)}${face(o.expr || 'happy')}${front.join('')}`;
  return svg('0 0 100 121', inner, { size: opts.size, cls: `person ${opts.cls || ''}`, label: opts.label ?? o.label ?? '' });
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
  ada: { name: 'Mama Ada', skin: SKINS[4], hair: 'wrap', outfit: '#2f9e6a', accent: P_.orange, acc: ['earrings', 'glasses'], age: 62 },
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
};

export function avatar(look, char, { age = 22, expr = 'happy', size = null, label = 'You' } = {}) {
  const l = look || {};
  const acc = (CHAR_ACC[char] || CHAR_ACC.graduate)(age).slice();
  if (age >= 60 && !acc.includes('glasses') && !acc.includes('sunglasses')) acc.push('glasses');
  const hair = l.hair || 'short';
  if (hair === 'wrap' && acc.some((a) => ['mortarboard', 'strawhat', 'cap', 'sailorcap'].includes(a))) acc.splice(acc.findIndex((a) => ['mortarboard', 'strawhat', 'cap', 'sailorcap'].includes(a)), 1);
  return person({
    skin: SKINS[l.skin ?? 2], hair, hairColor: HAIR_COLORS[l.hairColor ?? 0],
    outfit: OUTFITS[l.outfit ?? 0], accent: OUTFITS[((l.outfit ?? 0) + 2) % OUTFITS.length], expr, age, acc,
  }, { size, label });
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
  const expr = joy >= 60 ? 'smile' : joy >= 30 ? 'neutral' : 'sad';
  const mouth = expr === 'smile' ? 'M16 28 Q24 36 32 28' : expr === 'neutral' ? 'M17 30 L31 30' : 'M16 33 Q24 26 32 33';
  const fill = expr === 'smile' ? P_.gold : expr === 'neutral' ? P_.cream : P_.sky;
  return svg('0 0 48 48', `<circle cx="24" cy="24" r="17" fill="${fill}" ${s2}/><circle cx="18" cy="21" r="2.4" fill="${O}"/><circle cx="30" cy="21" r="2.4" fill="${O}"/><path d="${mouth}" fill="none" ${s2}/>`, { size, cls: 'joyface', label: `Joy ${Math.round(joy)}` });
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

function dwelling(stage, life, g) {
  const lit = ['#fff4b0', '#bfe9a0', '#ffd08a', '#ffb0e6', '#ffe066'][life];
  switch (stage) {
    case 0: return `<rect x="70" y="${g - 54}" width="74" height="54" fill="#b89a7a" ${S}/><rect x="66" y="${g - 60}" width="82" height="8" fill="#8a6a4a" ${S}/><rect x="82" y="${g - 42}" width="22" height="18" fill="${lit}" ${s2}/><path d="M93 ${g - 42} L93 ${g - 24} M82 ${g - 33} L104 ${g - 33}" stroke="${O}" stroke-width="2"/><rect x="116" y="${g - 36}" width="16" height="36" fill="#6a4a3a" ${s2}/><path d="M186 ${g} L186 ${g - 50}" ${S}/><rect x="172" y="${g - 62}" width="28" height="14" rx="3" fill="${P_.sky}" ${s2}/><text x="186" y="${g - 51}" font-size="9" font-weight="800" text-anchor="middle" fill="${O}">BUS</text>`;
    case 1: return `<rect x="66" y="${g - 104}" width="88" height="104" fill="#c9a6d6" ${S}/>${[0, 1, 2].map((r) => [0, 1, 2].map((c) => `<rect x="${76 + c * 26}" y="${g - 94 + r * 30}" width="16" height="18" fill="${r === 1 && c === 1 ? lit : '#8fb7d9'}" ${s2}/>`).join('')).join('')}<rect x="100" y="${g - 22}" width="20" height="22" fill="#6a4a3a" ${s2}/>`;
    case 2: return `<path d="M52 ${g - 56} L112 ${g - 100} L172 ${g - 56} Z" fill="${P_.red}" ${S}/><rect x="60" y="${g - 58}" width="104" height="58" fill="${P_.cream}" ${S}/><rect x="72" y="${g - 46}" width="24" height="20" fill="${lit}" ${s2}/><rect x="128" y="${g - 46}" width="24" height="20" fill="#8fb7d9" ${s2}/><rect x="102" y="${g - 36}" width="20" height="36" fill="#7a4a2a" ${s2}/>${[40, 48, 176, 184].map((x) => `<path d="M${x} ${g} L${x} ${g - 16}" stroke="${O}" stroke-width="2.4"/>`).join('')}<path d="M36 ${g - 10} L52 ${g - 10} M172 ${g - 10} L190 ${g - 10}" stroke="${O}" stroke-width="2.4"/><circle cx="44" cy="${g - 20}" r="4" fill="${P_.pink}" ${s2}/><circle cx="182" cy="${g - 20}" r="4" fill="${P_.gold}" ${s2}/>`;
    case 3: return `<path d="M40 ${g - 62} L106 ${g - 110} L172 ${g - 62} Z" fill="#5a4a8a" ${S}/><rect x="48" y="${g - 64}" width="116" height="64" fill="${P_.white}" ${S}/><rect x="164" y="${g - 40}" width="40" height="40" fill="${P_.cream}" ${S}/><rect x="170" y="${g - 30}" width="28" height="30" fill="#9aa4b8" ${s2}/>${[0, 1, 2].map((c) => `<rect x="${60 + c * 34}" y="${g - 52}" width="22" height="20" fill="${c === 1 ? lit : '#8fb7d9'}" ${s2}/>`).join('')}<rect x="96" y="${g - 28}" width="20" height="28" fill="#7a4a2a" ${s2}/><circle cx="106" cy="${g - 86}" r="6" fill="#fff4b0" ${s2}/>`;
    default: return `<rect x="0" y="${g - 20}" width="360" height="20" fill="#5cc8ff" opacity=".7"/><path d="M60 ${g} L60 ${g - 70}" stroke="${P_.brown}" stroke-width="7" stroke-linecap="round"/>${[-60, -20, 20, 60].map((a) => `<path d="M60 ${g - 70} q${a / 2} -18 ${a} -4" fill="none" stroke="${P_.green}" stroke-width="9" stroke-linecap="round"/>`).join('')}<path d="M110 ${g - 60} L150 ${g - 72} L190 ${g - 60} Z" fill="${P_.red}" ${s2}/><path d="M150 ${g - 72} L150 ${g}" stroke="${O}" stroke-width="3"/><path d="M120 ${g - 6} L136 ${g - 24} L176 ${g - 24} L168 ${g - 6} Z" fill="${P_.sky}" ${s2}/>`;
  }
}

// run-like input: { stage 0–4, life 0–4, mood, look, char, age, expr, prop, biz, farmer, kids, car, sea }
export function homeScene(o, { w = 360, h = 168, label = 'Your home' } = {}) {
  const W = WEATHER[o.mood] || WEATHER.steady;
  const g = h - 26;
  const beach = o.stage >= 4;
  const ground = beach ? '#f0d38a' : '#5fbf6f';
  const parts = [];
  parts.push(`<defs><linearGradient id="sky-${o.mood}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${W.sky[0]}"/><stop offset="1" stop-color="${W.sky[1]}"/></linearGradient></defs>`);
  parts.push(`<rect width="${w}" height="${h}" fill="url(#sky-${o.mood})"/>`);
  parts.push(weatherLayer(o.mood, w));
  parts.push(`<rect y="${g}" width="${w}" height="${h - g}" fill="${ground}"/><path d="M0 ${g} L${w} ${g}" stroke="${O}" stroke-width="3"/>`);
  if (!beach) parts.push(`<rect y="${g + 12}" width="${w}" height="8" fill="#5a5470" opacity=".5"/>`);
  parts.push(`<g class="bldg">${dwelling(o.stage, o.life || 0, g)}</g>`);
  // What you own, on the right-hand side of the street.
  let rx = 214;
  if (o.prop) {
    parts.push(`<g class="bldg"><rect x="${rx}" y="${g - 70}" width="52" height="70" fill="${P_.orange}" ${S}/>${[0, 1].map((r) => `<rect x="${rx + 8}" y="${g - 60 + r * 24}" width="14" height="14" fill="#8fb7d9" ${s2}/><rect x="${rx + 30}" y="${g - 60 + r * 24}" width="14" height="14" fill="#8fb7d9" ${s2}/>`).join('')}<rect x="${rx - 4}" y="${g - 86}" width="60" height="14" rx="2" fill="${P_.white}" ${s2}/><text x="${rx + 26}" y="${g - 75.5}" font-size="9" font-weight="800" text-anchor="middle" fill="${O}">FOR RENT</text><circle cx="${rx + 62}" cy="${g - 30}" r="5" fill="${P_.gold}" ${s2}/><circle cx="${rx + 70}" cy="${g - 18}" r="5" fill="${P_.gold}" ${s2}/></g>`);
    rx += 78;
  }
  if (o.biz && rx < w - 40) {
    if (o.farmer) parts.push(`<g class="bldg">${[0, 1, 2].map((i) => `<path d="M${rx} ${g - 6 - i * 10} L${rx + 56} ${g - 6 - i * 10}" stroke="${P_.green}" stroke-width="6" stroke-linecap="round"/>`).join('')}</g>`);
    else parts.push(`<g class="bldg"><rect x="${rx}" y="${g - 44}" width="56" height="44" fill="${P_.cream}" ${S}/><path d="M${rx - 4} ${g - 54} L${rx + 60} ${g - 54} L${rx + 60} ${g - 42} L${rx - 4} ${g - 42} Z" fill="${P_.red}" ${s2}/>${[1, 2, 3, 4].map((i) => `<path d="M${rx - 4 + i * 13} ${g - 54} L${rx - 4 + i * 13} ${g - 42}" stroke="${P_.white}" stroke-width="4"/>`).join('')}<rect x="${rx + 8}" y="${g - 34}" width="20" height="16" fill="${P_.sky}" ${s2}/><rect x="${rx + 34}" y="${g - 30}" width="14" height="30" fill="#7a4a2a" ${s2}/></g>`);
  }
  if (o.car && !beach) parts.push(`<g transform="translate(150 ${g - 26}) scale(0.9)">${I.car.replace(/<path d="M42 16[^>]*\/>/, '').replace(/<path d="M46 18[^>]*\/>/, '')}</g>`);
  if (o.kids && !beach) parts.push(`<g transform="translate(20 ${g - 20})"><circle cx="6" cy="14" r="6" fill="none" stroke="${O}" stroke-width="2.4"/><circle cx="24" cy="14" r="6" fill="none" stroke="${O}" stroke-width="2.4"/><path d="M6 14 L14 4 L24 14 M12 4 L18 4" fill="none" stroke="${P_.red}" stroke-width="2.6"/></g>`);
  if (o.sea) parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="#2a4a7a" opacity=".45"/><g transform="translate(${w - 120} ${g - 40})"><path d="M0 30 L90 30 L78 44 L12 44 Z" fill="${P_.white}" ${S}/><rect x="30" y="10" width="30" height="20" fill="${P_.red}" ${s2}/><path d="M44 10 L44 -6" ${S}/></g>`);
  // You, in front of your home.
  const av = avatar(o.look, o.char, { age: o.age, expr: o.expr || 'happy', label: '' });
  parts.push(`<svg x="${beach ? 196 : 8}" y="${g - 74}" width="62" height="75" viewBox="0 0 100 121">${av.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg>`);
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

// ------------------------------------------------------------------ small helpers used across screens

export const moodIcon = (mood, size = 28) => icon((WEATHER[mood] || WEATHER.steady).icon, size, (WEATHER[mood] || WEATHER.steady).word);

export function stageOf(prog) {
  return prog >= 1 ? 4 : prog >= 0.75 ? 3 : prog >= 0.5 ? 2 : prog >= 0.25 ? 1 : 0;
}
