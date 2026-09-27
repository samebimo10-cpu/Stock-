// Tycoon Rush content: characters, cards, events, headlines, eras and lessons.
//
// Everything here is data plus small effect functions. The rules that call them
// live in engine.js. Money amounts are in US dollars and are scaled by the
// currency's `scale` when a run starts, so one table serves both modes.

// Each currency has a price scale (a graduate's first salary in it, over
// US$24,000) and an economy profile. Profiles, not currencies, drive the market:
//   stable   calm prices, savings roughly keep up with inflation
//   moderate a few points of inflation and a slowly sliding currency
//   volatile Naira-like: high inflation, negative real rates, devaluation shocks
export const CURRENCIES = {
  NGN: { sym: '₦', scale: 100, name: 'Naira', profile: 'volatile', locale: 'en-NG', duel: 'N' },
  GHS: { sym: 'GH₵', scale: 1.6, name: 'Cedi', profile: 'volatile', locale: 'en-GH', duel: 'H' },
  KES: { sym: 'KSh', scale: 25, name: 'Shilling', profile: 'moderate', locale: 'en-KE', duel: 'K' },
  INR: { sym: '₹', scale: 21, name: 'Rupee', profile: 'moderate', locale: 'en-IN', duel: 'I' },
  PKR: { sym: 'Rs', scale: 38, name: 'Pakistani rupee', profile: 'volatile', locale: 'en-PK', duel: 'P' },
  CNY: { sym: '¥', scale: 3.5, name: 'Yuan', profile: 'stable', locale: 'zh-CN', duel: 'C' },
  JPY: { sym: '¥', scale: 150, name: 'Yen', profile: 'stable', locale: 'ja-JP', duel: 'Y' },
  KRW: { sym: '₩', scale: 1400, name: 'Won', profile: 'stable', locale: 'ko-KR', duel: 'W' },
  PHP: { sym: '₱', scale: 13, name: 'Peso', profile: 'moderate', locale: 'en-PH', duel: 'F' },
  MXN: { sym: 'MX$', scale: 8, name: 'Mexican peso', profile: 'moderate', locale: 'es-MX', duel: 'M' },
  BRL: { sym: 'R$', scale: 2.2, name: 'Real', profile: 'moderate', locale: 'pt-BR', duel: 'B' },
  JMD: { sym: 'J$', scale: 50, name: 'Jamaican dollar', profile: 'moderate', locale: 'en-JM', duel: 'J' },
  USD: { sym: '$', scale: 1, name: 'Dollar', profile: 'stable', locale: 'en-US', duel: 'D' },
  EUR: { sym: '€', scale: 1.1, name: 'Euro', profile: 'stable', locale: 'de-DE', duel: 'E' },
  GBP: { sym: '£', scale: 1, name: 'Pound', profile: 'stable', locale: 'en-GB', duel: 'G' },
  AED: { sym: 'AED ', scale: 3.8, name: 'Dirham', profile: 'stable', locale: 'en-AE', duel: 'A' },
  EGP: { sym: 'E£', scale: 6, name: 'Egyptian pound', profile: 'volatile', locale: 'en-EG', duel: 'Q' },
};

export const PROFILE_BLURB = {
  stable: 'Calm prices and steady rates. A gentler market to learn in.',
  moderate: 'Prices rise a few points a year and the currency slowly slides. Foreign money helps.',
  volatile: 'High inflation and devaluation shocks. Holding foreign money becomes a strategy.',
};

// The player's home region sets the default currency, the guide, and the look
// of the town. It never changes the maths. Cities are invented and unnamed.
export const REGIONS = {
  westafrica: { name: 'West Africa', currencies: ['NGN', 'GHS'], guide: 'ebi', bus: 'danfo bus', food: 'jollof rice', x: 47, y: 55 },
  eastafrica: { name: 'East Africa', currencies: ['KES'], guide: 'wanjiru', bus: 'matatu', food: 'nyama choma', x: 58, y: 60 },
  southasia: { name: 'South Asia', currencies: ['INR', 'PKR'], guide: 'priya', bus: 'auto-rickshaw', food: 'biryani', x: 70, y: 45 },
  eastasia: { name: 'East Asia', currencies: ['CNY', 'JPY', 'KRW', 'PHP'], guide: 'wei', bus: 'scooter', food: 'dumplings', x: 81, y: 37 },
  latam: { name: 'Latin America', currencies: ['MXN', 'BRL'], guide: 'rosa', bus: 'colectivo', food: 'tamales', x: 28, y: 62 },
  caribbean: { name: 'Caribbean', currencies: ['JMD'], guide: 'marcia', bus: 'minibus', food: 'jerk chicken', x: 27, y: 46 },
  europe_na: { name: 'Europe & North America', currencies: ['USD', 'EUR', 'GBP'], guide: 'joe', bus: 'city bus', food: 'sandwiches', x: 32, y: 28 },
  middleeast: { name: 'Middle East', currencies: ['AED', 'EGP'], guide: 'samira', bus: 'minibus', food: 'falafel', x: 58, y: 43 },
};

export const LIFESTYLES = [
  { name: 'Frugal', mult: 0.75, joy: -8, blurb: 'Rice and beans, no outings.' },
  { name: 'Modest', mult: 1, joy: 0, blurb: 'Shared flat, bus to work.' },
  { name: 'Comfy', mult: 1.3, joy: 4, blurb: 'Your own flat and the odd holiday.' },
  { name: 'Lavish', mult: 1.75, joy: 7, blurb: 'New car, nice restaurants.' },
  { name: 'Baller', mult: 2.4, joy: 10, blurb: 'Designer everything.' },
];

export const CHARACTERS = {
  graduate: { name: 'The Graduate', blurb: 'Low salary, no debt, long runway.', salary: 24000, costs: 16800, cash: 3000, life: 1, unlock: 0 },
  heir: { name: 'The Heir', blurb: 'Big starting cash and a lavish habit you must rein in.', salary: 20000, costs: 16800, cash: 200000, life: 3, joy: 75, unlock: 0 },
  farmer: { name: 'The Farmer', blurb: 'Starts with a farm business. Weather hits harder.', salary: 12000, costs: 13500, cash: 3000, biz: 50000, life: 1, unlock: 40, weather: 2 },
  hustler: { name: 'The Hustler', blurb: 'Income swings wildly. Starts holding crypto.', salary: 26000, costs: 16800, cash: 1000, crypto: 12000, life: 1, unlock: 100, volatile: 0.35 },
  // Not picked from the list: used when a player starts from their own real life.
  me: { name: 'You', blurb: 'Your real age, money and goals.', salary: 24000, costs: 16800, cash: 0, life: 1, unlock: 0, custom: true },
  sailor: { name: 'The Sailor', blurb: 'High pay, but at sea every other turn: you can only invest in port, and it gets lonely.', salary: 38000, costs: 21000, cash: 4000, life: 1, unlock: 180, sailor: true },
};

export const ASSETS = {
  save: { name: 'Savings', sub: 'Deposits & T-bills', color: '#5cc8ff', fee: 0, blurb: 'Safe and never crashes. Pays the interest rate, which can trail inflation.' },
  index: { name: 'Index fund', sub: 'Whole market', color: '#3ddc97', fee: 0.005, blurb: 'A slice of every big company. Steady climb, sharp drops, recovers if you hold.' },
  stocks: { name: 'Stocks', sub: '5 companies', color: '#b69cff', fee: 0.01, blurb: 'Pick single companies. Big swings, and headlines move them.' },
  prop: { name: 'Property', sub: 'Rent + growth', color: '#ffb35c', fee: 0.06, blurb: 'Pays rent every year. Slow to sell, and you can borrow to buy.' },
  crypto: { name: 'Crypto', sub: 'Wild ride', color: '#ff7ad9', fee: 0.015, blurb: 'Can triple or go to nearly zero. Hype moves it. Pays nothing.' },
  biz: { name: 'Business', sub: 'Your venture', color: '#ffd54a', fee: 0, blurb: 'Pays profit every year but wears out without new cash. Hire a manager to make it passive.' },
  fx: { name: 'Foreign money', sub: 'Dollar fund', color: '#7fe3ff', fee: 0.01, blurb: 'Earns dollar interest and gains whenever your own currency falls.' },
};

export const COMPANIES = [
  { id: 'ZNK', name: 'Zenko Bank', sector: 'Banking', beta: 1.1, alpha: 0.02, idio: 0.14 },
  { id: 'PLM', name: 'Palmline Agro', sector: 'Farming', beta: 0.6, alpha: 0.04, idio: 0.16 },
  { id: 'BGP', name: 'BrightGrid Power', sector: 'Utilities', beta: 0.5, alpha: 0.03, idio: 0.09 },
  { id: 'KUL', name: 'Kulo Tech', sector: 'Technology', beta: 1.7, alpha: 0.06, idio: 0.32 },
  { id: 'NXO', name: 'Nexa Oil', sector: 'Energy', beta: 1.1, alpha: 0.02, idio: 0.24 },
];

export const STATE_INFO = {
  boom: { name: 'Boom', color: '#3ddc97', line: 'Everything is going up.' },
  steady: { name: 'Steady', color: '#5cc8ff', line: 'A calm, ordinary stretch.' },
  over: { name: 'Overheating', color: '#ff9f43', line: 'Prices are racing ahead of reality.' },
  crash: { name: 'Crash', color: '#ff5d73', line: 'Markets are falling hard.' },
  recov: { name: 'Recovery', color: '#b69cff', line: 'Prices climb back from the lows.' },
};

// Headlines. Signals are drawn from the mood the market is about to enter, so a
// careful reader can see what is coming. Noise means nothing; traps are scams.
export const NEWS = {
  boom: [
    'Factories report record orders',
    'Unemployment falls to a 10-year low',
    'Banks loosen lending as profits jump',
    'Shoppers spend more for a third straight quarter',
    'IPO market heats up with 12 new listings',
    'Business confidence hits its best level in years',
  ],
  steady: [
    'Growth steady at 3%, economists shrug',
    'Central bank holds rates, calls economy balanced',
    'Retail sales in line with forecasts',
    'Business confidence flat but positive',
    'Quiet year expected on the stock exchange',
  ],
  over: [
    'House prices up 25% in a year: "it can only go up"',
    'Taxi drivers are giving stock tips',
    'Borrowing to buy shares hits an all-time high',
    'Tech companies valued at 80 times earnings',
    'Wages and prices chase each other higher',
    'Everyone you know is quitting their job to trade',
  ],
  crash: [
    'Major lender misses payments, shares halted',
    'Regulators warn of hidden losses at big banks',
    'Oil exporter defaults on its bonds',
    'Credit markets freeze as defaults climb',
    'Layoffs spread from finance to retail',
    'Property developer collapses owing billions',
  ],
  recov: [
    'Bargain hunters return after the sell-off',
    'Central bank cuts rates to support growth',
    'Hiring picks up for the first time in 18 months',
    'Stocks cheapest in a decade, analysts say',
    'Factory orders rebound from the lows',
  ],
  noise: [
    'Celebrity couple\'s wedding breaks the internet',
    'Local side wins the cup on penalties',
    'Astrologer predicts a lucky year for Leos',
    'New phone launches in three colours',
    'Heatwave expected this weekend',
    'Minister opens a new footbridge',
    'Viral dance challenge sweeps the country',
    'Jollof rice cook-off ends in a draw',
  ],
  trap: [
    'Influencer: new coin "guaranteed 10x" by Friday',
    'Forex guru: "Double your money in 30 days"',
    'Investment club pays members 20% every month',
    'Secret land deal "only for insiders", pay today',
    'AI trading bot "never loses", deposit now',
  ],
  rateUp: ['Central bank hints at a rate hike', 'Bond yields jump on inflation fears'],
  rateDown: ['Central bank signals rate cuts ahead', 'Inflation cools, rate cut expected'],
  rateHold: ['Central bank expected to keep rates on hold'],
  fx: ['Dollar queues grow at bureaux as reserves fall', 'Importers can\'t find dollars; street rate jumps'],
  coUp: ['{co} lands a huge government contract', '{co} earnings expected to smash forecasts', '{co} unveils a product everyone wants'],
  coDown: ['{co} chief under investigation for fraud', '{co} warns profits will fall sharply', '{co} hit by a major recall'],
};

export const SWANS = [
  { id: 'meltdown', name: 'Market Meltdown', text: 'A giant bank collapses overnight. Every market falls at once.', state: 'crash', index: -0.18, prop: -0.08, crypto: -0.2 },
  { id: 'pandemic', name: 'Pandemic', text: 'A new virus shuts the world down. Offices close, markets plunge and pay is cut.', state: 'crash', index: -0.08, salary: 0.7 },
  { id: 'mania', name: 'Crypto Mania', text: 'A coin frenzy grips the planet. Crypto goes vertical. It will not last.', state: 'over', crypto: 2.5 },
  { id: 'hyper', name: 'Hyperinflation Scare', text: 'Prices spiral and the currency loses half its value in months.', ngn: true, infl: 0.3, dev: 0.8 },
];

// Cards. `take` runs once when picked; everything else is checked by the engine
// through has(run, id). `trap` cards show as "Offer" until you take one.
export const CARDS = [
  { id: 'side_hustle', name: 'Side Hustle', type: 'Skill', unlock: 0, text: '+15% salary. −3 joy every turn from the extra hours.', take: (run, h) => { h.salary(1.15); h.skill(); } },
  { id: 'diamond_hands', name: 'Diamond Hands', type: 'Skill', unlock: 0, text: 'In a crash, your losses are halved if you sold nothing risky that turn.' },
  { id: 'landlord', name: 'Landlord', type: 'Skill', unlock: 0, text: 'Property rent +25%.' },
  { id: 'contrarian', name: 'Contrarian', type: 'Skill', unlock: 0, text: 'Money you put into stocks or the index right after a crash earns a 12% bonus.' },
  { id: 'frugal_genius', name: 'Frugal Genius', type: 'Skill', unlock: 0, text: 'Living costs −10% with no joy lost.' },
  { id: 'insider', name: 'Insider Whisper', type: 'Tool', unlock: 0, stack: true, text: 'Use once: reveals which headlines are real.', take: (run) => { run.charges.insider = (run.charges.insider || 0) + 1; } },
  { id: 'leverage', name: 'Leverage', type: 'Gamble', unlock: 0, stack: true, text: 'Double gains and double losses on index, stocks and crypto for 2 turns.', take: (run, h) => { run.lev = 2; h.term('leverage'); } },
  { id: 'compound', name: 'Compound Nerd', type: 'Skill', unlock: 0, text: 'Savings earn +2% a year.', take: (run, h) => h.term('compound') },
  { id: 'efund_pro', name: 'Rainy Day Pro', type: 'Skill', unlock: 0, text: 'If your savings cover a year of costs, life bills cost 40% less.', take: (run, h) => h.term('efund') },
  { id: 'networker', name: 'Networker', type: 'Skill', unlock: 0, text: '+8% salary now, and promotions come twice as often.', take: (run, h) => { h.salary(1.08); h.skill(); } },
  { id: 'dividend', name: 'Dividend Hunter', type: 'Skill', unlock: 0, text: 'Index fund and stocks earn +1% a year.' },
  {
    id: 'ponzi', name: 'Golden Circle Club', type: 'Offer', trap: true, unlock: 0, stack: true,
    text: 'Members earn 30% a turn, guaranteed. Joining puts in 30% of your cash.',
    take: (run, h) => {
      const amt = 0.3 * Math.max(0, run.cash);
      run.cash -= amt;
      run.h.ponzi = { v: (run.h.ponzi ? run.h.ponzi.v : 0) + amt, paid: amt + (run.h.ponzi ? run.h.ponzi.paid : 0), age: 0 };
    },
  },
  {
    id: 'mlm', name: 'Wellness Starter Kit', type: 'Offer', trap: true, unlock: 0, stack: true,
    text: 'Sell health drinks to your friends and build a "downline". The starter kit costs 40% of a year\'s pay.',
    take: (run, h) => { const amt = 0.4 * run.salary; h.expense(amt, true); h.scam(amt); h.joy(-8); },
  },
  { id: 'health_cover', name: 'Health Cover', type: 'Skill', unlock: 20, text: 'Medical bills are covered in full.' },
  { id: 'remote_job', name: 'Remote Job', type: 'Skill', unlock: 40, text: 'Paid in dollars: +10% salary, and in a sliding currency your pay keeps up with devaluation.', take: (run, h) => { h.salary(1.1); h.skill(); } },
  { id: 'crystal', name: 'Crystal Ball', type: 'Tool', unlock: 40, stack: true, text: 'Twice: see the market mood for the next two years.', take: (run) => { run.charges.crystal = (run.charges.crystal || 0) + 2; } },
  { id: 'manager_pro', name: 'Born Manager', type: 'Skill', unlock: 60, text: 'Your business counts as passive income with no manager fee.' },
  { id: 'franchise', name: 'Franchise', type: 'Skill', unlock: 60, text: 'Business profit +30%.' },
  { id: 'rate_watcher', name: 'Rate Watcher', type: 'Skill', unlock: 80, text: 'Interest-rate headlines are always real.' },
  { id: 'analyst', name: 'Stock Analyst', type: 'Skill', unlock: 80, text: 'Company headlines are always real.' },
  {
    id: 'angel', name: 'Angel Investor', type: 'Gamble', unlock: 100, cond: (run) => !run.h.angel,
    text: 'Put 10% of your cash into a startup. In 3 turns it pays 12× (rarely), 1.5× (sometimes) or nothing (usually).',
    take: (run, h) => h.angel(0.1 * Math.max(0, run.cash)),
  },
  { id: 'tax_smart', name: 'Tax Smart', type: 'Skill', unlock: 100, text: 'Passive income +10%.' },
  { id: 'degen', name: 'Crypto Degen', type: 'Gamble', unlock: 120, text: 'Crypto moves 1.5× as hard, both ways.', take: (run, h) => h.term('volatility') },
  { id: 'stoic', name: 'Stoic', type: 'Skill', unlock: 150, text: 'Joy never drops below 30.' },
  { id: 'coach', name: 'Money Coach', type: 'Skill', unlock: 200, text: 'See 4 cards to pick from instead of 3.' },
  // Legendary: 1 in 50 draws.
  { id: 'oracle', name: 'The Oracle', type: 'Legendary', legendary: true, unlock: 0, text: 'Every headline shows whether it is real, for the rest of the run.' },
  { id: 'golden_goose', name: 'Golden Goose', type: 'Legendary', legendary: true, unlock: 0, text: 'Business profit ×2. Starts a small business if you have none.', take: (run, h) => { if (run.h.biz.c <= 0) h.add('biz', 0.8 * run.salary); } },
  { id: 'rich_uncle', name: 'Rich Uncle', type: 'Legendary', legendary: true, unlock: 0, text: 'Receive five years of salary, today.', take: (run, h) => h.cash(5 * run.salary) },
  { id: 'bs_hedge', name: 'Black Swan Hedge', type: 'Legendary', legendary: true, unlock: 0, text: 'Your index fund gains 15% in every crash.' },
];

// Life, world and opportunity events. One per turn, and every one is a choice.
// setup() fixes the amounts, so the text and the effect agree.
export const EVENTS = [
  {
    id: 'promo', cat: 'Career', title: 'Promotion on the table', w: 2.4, cond: (run) => run.age < 57,
    text: () => 'Your boss offers you the team lead role. More pay, more meetings, later nights.',
    choices: [
      { label: 'Take it', note: '+25% salary, −6 joy', lesson: 'h_knowledge', fx: (run, h) => { h.salary(1.25); h.joy(-6); h.skill(); return 'New title, new pay slip.'; } },
      { label: 'Stay where you are', note: '+4 joy', fx: (run, h) => { h.joy(4); return 'You keep your evenings.'; } },
    ],
  },
  {
    id: 'layoff', cat: 'Career', title: 'Laid off', w: 1.5, cond: (run) => run.age < 56,
    text: () => 'Your company cuts a fifth of its staff and you are on the list.',
    choices: [
      { label: 'Take the first job offered', note: 'Salary −20% from now on', fx: (run, h) => { h.salary(0.8); h.joy(-4); return 'Back at work within a month, on less money.'; } },
      {
        label: 'Hold out for a better role', note: 'No pay for a year; 60% chance of +15%', lesson: 'x_ev',
        math: () => ({ kind: 'text', text: 'Expected pay change: 0.6 × (+15%) + 0.4 × (−5%) = +7%, against −20% for the first job. The price is one year of pay now, so it pays off after about 4 years at the better rate.' }),
        fx: (run, h) => {
          h.cash(-run.salary); h.joy(-6);
          if (h.r() < 0.6) { h.salary(1.15); return 'Eleven months later: a better job at 15% more.'; }
          h.salary(0.95); return 'The search dragged on. You took a job at 5% less.';
        },
      },
    ],
  },
  {
    id: 'wedding', cat: 'Life', title: 'Wedding bells', w: 2, once: true, cond: (run) => !run.flags.married && run.age < 45,
    setup: (run) => ({ big: 1.1 * run.salary, small: 0.25 * run.salary }),
    text: () => 'You are getting married! Two incomes, shared bills, and a party to plan.',
    choices: [
      { label: (v, h) => `Big party (${h.f(v.big)})`, note: '+18 joy', fx: (run, h, v) => { const n = h.expense(v.big); h.marry(); h.joy(18); return `Five hundred guests and a live band. ${n}`; } },
      { label: (v, h) => `Small ceremony (${h.f(v.small)})`, note: '+8 joy', fx: (run, h, v) => { const n = h.expense(v.small); h.marry(); h.joy(8); return `Close family, good food, no debt. ${n}`; } },
    ],
  },
  {
    id: 'baby', cat: 'Life', title: 'A baby is on the way', w: 2, cond: (run) => run.flags.married && (run.flags.kids || 0) < 3 && run.age < 46,
    text: () => 'Congratulations. Nappies, school fees and a lot of joy are coming.',
    choices: [
      { label: 'Nanny and private school', note: 'Costs +25%, +16 joy', fx: (run, h) => { h.costMult(1.25); h.joy(16); h.kid(); return 'Only the best for the little one.'; } },
      { label: 'Family help and hand-me-downs', note: 'Costs +10%, +10 joy', fx: (run, h) => { h.costMult(1.1); h.joy(10); h.kid(); return 'Grandma moves in to help.'; } },
    ],
  },
  {
    id: 'medical', cat: 'Health', title: 'Hospital bill', w: 2,
    setup: (run) => ({ best: 0.5 * run.salary, cheap: 0.18 * run.salary }),
    text: (v, h) => (h.has('health_cover') ? 'You need an operation. Your health cover kicks in.' : 'You need an operation. The good hospital is expensive.'),
    choices: [
      {
        label: (v, h) => (h.has('health_cover') ? 'Use your cover' : `Best hospital (${h.f(v.best)})`), note: 'Safe',
        fx: (run, h, v) => (h.has('health_cover') ? 'Covered in full. Insurance did its job.' : `Back on your feet quickly. ${h.expense(v.best)}`),
      },
      {
        label: (v, h) => `Cheaper clinic (${h.f(v.cheap)})`, note: '30% chance of complications', lesson: 'x_ev',
        math: (run, v) => ({ kind: 'cost', rows: [{ p: 0.7, v: -v.cheap, label: 'It goes fine' }, { p: 0.3, v: -(v.cheap + v.best), label: 'Complications: you pay both' }], compare: -v.best, compareLabel: 'Best hospital, for certain' }),
        fx: (run, h, v) => {
          const n = h.expense(v.cheap);
          if (h.r() < 0.3) { h.joy(-8); return `Complications. You ended up at the big hospital anyway. ${h.expense(v.best)}`; }
          return `It went fine. ${n}`;
        },
      },
    ],
  },
  {
    id: 'blacktax', cat: 'Family', title: 'Family needs help', w: 2,
    setup: (run) => ({ amt: 0.3 * run.salary }),
    text: (v, h) => `Your uncle's shop burned down and the family asks you for ${h.f(v.amt)}.`,
    choices: [
      { label: 'Send the money', note: '+6 joy', fx: (run, h, v) => { const n = h.expense(v.amt); h.joy(6); return `The family is grateful. ${n}`; } },
      { label: 'Say no this time', note: '−10 joy', fx: (run, h) => { h.joy(-10); return 'Awkward phone calls for months.'; } },
    ],
  },
  {
    id: 'car', cat: 'Life', title: 'Your car dies', w: 1.7,
    setup: (run) => ({ fix: 0.12 * run.salary }),
    text: () => 'The engine is gone. The mechanic shakes his head.',
    choices: [
      { label: 'New car on a loan', note: 'Costs +8% for good, +8 joy', fx: (run, h) => { h.costMult(1.08); h.joy(8); h.term('creep'); return 'That new-car smell. And a monthly payment.'; } },
      { label: (v, h) => `Rebuild the engine (${h.f(v.fix)})`, note: 'One-off cost', fx: (run, h, v) => `Runs like new, mostly. ${h.expense(v.fix)}` },
      { label: 'Take the bus', note: '−5 joy', fx: (run, h) => { h.joy(-5); return 'Long commutes, more podcasts.'; } },
    ],
  },
  {
    id: 'raise', cat: 'Career', title: 'You got a raise', w: 2.2,
    text: () => 'A 10% raise. Your friends are already moving to nicer places.',
    choices: [
      { label: 'Upgrade your lifestyle', note: 'Lifestyle up a level, +6 joy', lesson: 'r_doodads', fx: (run, h) => { h.salary(1.1); h.life(1); h.joy(6); h.term('creep'); return 'Bigger flat, better view. Higher costs, and a higher Freedom Number.'; } },
      { label: 'Live the same, invest the raise', note: '−2 joy', lesson: 'p_enough', fx: (run, h) => { h.salary(1.1); h.joy(-2); h.term('creep'); return 'Same flat. The raise goes to work for you.'; } },
    ],
  },
  {
    id: 'inherit', cat: 'Luck', title: 'An inheritance', w: 1.1, once: true,
    setup: (run) => ({ amt: 1.4 * run.salary }),
    text: (v, h) => `A great-aunt leaves you ${h.f(v.amt)}.`,
    choices: [
      { label: 'Invest it in the index fund', note: 'Straight into the market', fx: (run, h, v) => { h.add('index', v.amt); h.term('index'); return 'Every coin goes to work.'; } },
      { label: 'Celebrate and spend most of it', note: '+15 joy, keep 30%', fx: (run, h, v) => { h.cash(0.3 * v.amt); h.joy(15); return 'A trip to remember.'; } },
      { label: 'Keep it in cash', note: 'Into your wallet', fx: (run, h, v) => { h.cash(v.amt); return 'Safe in the current account, for now.'; } },
    ],
  },
  {
    id: 'gig', cat: 'Career', title: 'Weekend gig', w: 1.4, cond: (run) => !run.flags.gig,
    text: () => 'A client wants you for weekend consulting. Good money, no rest.',
    choices: [
      { label: 'Take it', note: '+12% income, −3 joy each turn', fx: (run, h) => { h.salary(1.12); h.flag('gig'); h.skill(); return 'Saturdays belong to the client now.'; } },
      { label: 'Protect your weekends', note: '+3 joy', fx: (run, h) => { h.joy(3); return 'You rest. It shows at work.'; } },
    ],
  },
  {
    id: 'course', cat: 'Career', title: 'Upskill course', w: 1.5, cond: (run) => run.age < 50,
    setup: (run) => ({ cost: 0.35 * run.salary }),
    text: (v, h) => `A professional certificate costs ${h.f(v.cost)}. Graduates earn more.`,
    choices: [
      { label: (v, h) => `Enrol (${h.f(v.cost)})`, note: 'Salary +15%', need: (run, v) => run.cash >= v.cost, lesson: 'b_earn', fx: (run, h, v) => { h.cash(-v.cost); h.salary(1.15); h.skill(); return 'Certified. Your pay goes up.'; } },
      { label: 'Skip it', note: 'No change', fx: () => 'Maybe next year.' },
    ],
  },
  {
    id: 'burnout', cat: 'Health', title: 'Burnout', w: 0, forced: true,
    text: () => 'You are exhausted and your doctor says something has to give. Too little joy for too long does this.',
    choices: [
      { label: 'Take a sabbatical', note: 'Lose half a year of pay, +35 joy', fx: (run, h) => { h.cash(-0.5 * run.salary); h.joy(35); return 'Six months off. You come back whole.'; } },
      { label: 'Push through', note: '+8 joy, salary −15%', fx: (run, h) => { h.joy(8); h.salary(0.85); return 'You keep going, but your work suffers.'; } },
    ],
  },
  {
    id: 'bonus', cat: 'Career', title: 'Year-end bonus', w: 1.8,
    setup: (run) => ({ amt: 0.4 * run.salary }),
    text: (v, h) => `A ${h.f(v.amt)} bonus lands in your account.`,
    choices: [
      { label: 'Invest it in the index fund', note: 'Long-term growth', fx: (run, h, v) => { h.add('index', v.amt); h.term('index'); return 'Invested. Future you says thanks.'; } },
      { label: 'Book a holiday', note: '+12 joy', fx: (run, h) => { h.joy(12); return 'Beaches, good food, no email.'; } },
      { label: 'Top up savings', note: 'Safe', fx: (run, h, v) => { h.add('save', v.amt); h.term('efund'); return 'Your rainy-day fund grows.'; } },
    ],
  },
  {
    id: 'loan', cat: 'Friends', title: 'A friend asks for a loan', w: 1.3,
    setup: (run) => ({ amt: 0.25 * run.salary }),
    text: (v, h) => `An old classmate needs ${h.f(v.amt)} to cover rent. "I'll pay you back in 3 months."`,
    choices: [
      {
        label: 'Lend it', note: '50/50 you see it again',
        math: (run, v) => ({ kind: 'cost', rows: [{ p: 0.5, v: 0, label: 'Paid back' }, { p: 0.5, v: -v.amt, label: 'Never repaid' }] }),
        fx: (run, h, v) => {
          h.cash(-v.amt);
          if (h.r() < 0.5) { h.cash(v.amt); h.joy(4); return 'Paid back in full, with a thank-you card.'; }
          h.joy(-4); return 'Three months became never.';
        },
      },
      { label: 'Politely decline', note: '−4 joy', fx: (run, h) => { h.joy(-4); return 'They understand. Mostly.'; } },
    ],
  },
  {
    id: 'renthike', cat: 'Home', title: 'Landlord raises the rent', w: 1.6, cond: (run) => run.h.prop.v <= 0,
    text: () => 'Your landlord puts the rent up 25%. Owning property would stop this.',
    choices: [
      { label: 'Pay it', note: 'Costs +8%', fx: (run, h) => { h.costMult(1.08); return 'Paid. Your costs creep up.'; } },
      { label: 'Move further out', note: '−6 joy', fx: (run, h) => { h.joy(-6); return 'Cheaper place, longer commute.'; } },
    ],
  },
  {
    id: 'deval', cat: 'World', title: 'Currency devalued overnight', w: 0, forced: true,
    setup: (run) => ({ amt: 0.5 * Math.max(0, run.cash) }),
    text: () => 'The central bank lets the currency fall. Import prices jump. Anyone holding foreign money just got richer.',
    choices: [
      {
        label: (v, h) => `Move ${h.f(v.amt)} of cash into foreign money`, note: '5% exchange spread', need: (run, v) => v.amt > 0,
        fx: (run, h, v) => { h.cash(-v.amt); h.add('fx', 0.95 * v.amt); h.costMult(1.06); h.term('devaluation'); return 'Your foreign money will hold its value.'; },
      },
      { label: 'Keep your local money', note: 'Costs +6%', fx: (run, h) => { h.costMult(1.06); h.term('devaluation'); return 'Prices keep climbing.'; } },
    ],
  },
  {
    id: 'fuel', cat: 'World', title: 'Fuel price shock', w: 1.3,
    setup: (run) => ({ solar: 0.3 * run.salary }),
    text: () => 'Fuel prices double overnight. Transport and power bills jump.',
    choices: [
      { label: (v, h) => `Install solar (${h.f(v.solar)})`, note: 'Costs −4% for good', need: (run, v) => run.cash >= v.solar, fx: (run, h, v) => { h.cash(-v.solar); h.costMult(0.96); return 'The generator goes quiet. Bills drop.'; } },
      { label: 'Absorb it', note: 'Costs +5%', fx: (run, h) => { h.costMult(1.05); return 'Everything costs a little more.'; } },
    ],
  },
  {
    id: 'bankrumour', cat: 'World', title: 'Bank run rumour', w: 1, cond: (run) => run.h.save > 0,
    text: () => 'A WhatsApp voice note says your bank is about to collapse. Queues form outside branches.',
    choices: [
      { label: 'Withdraw your savings to cash', note: 'Cash earns nothing', fx: (run, h) => { h.cash(run.h.save); run.h.save = 0; return 'You queue for hours. The bank was fine, and your cash now earns nothing.'; } },
      { label: 'Stay calm', note: 'Deposits are insured', lesson: 'h_persist', fx: (run, h) => { h.joy(2); return 'The rumour was fake. Voice notes are not news.'; } },
    ],
  },
  {
    id: 'land', cat: 'Opportunity', title: 'Land going cheap', w: 1.5,
    setup: (run) => ({ price: 0.9 * run.salary, worth: 1.35 * run.salary }),
    text: (v, h) => `A seller needs cash fast: land worth ${h.f(v.worth)} for ${h.f(v.price)}. The documents check out.`,
    choices: [
      { label: (v, h) => `Buy it (${h.f(v.price)})`, note: 'Instant equity', lesson: 'g_margin', need: (run, v) => run.cash >= v.price, fx: (run, h, v) => { h.cash(-v.price); h.buyProp(v.worth); return 'The title deed is yours.'; } },
      { label: 'Pass', note: 'Keep your cash', fx: () => 'Someone else snaps it up.' },
    ],
  },
  {
    id: 'bond', cat: 'Opportunity', title: 'Government bond sale', w: 1.3,
    setup: (run) => ({ amt: 0.3 * Math.max(0, run.cash) }),
    text: () => 'The treasury is selling a special bond at a fixed, above-market rate.',
    choices: [
      { label: (v, h) => `Buy ${h.f(v.amt)} of bonds`, note: '+10% bonus, into savings', need: (run, v) => v.amt > 0, fx: (run, h, v) => { h.cash(-v.amt); h.add('save', 1.1 * v.amt); return 'Locked in a good rate.'; } },
      { label: 'Pass', note: 'No change', fx: () => 'You keep your cash liquid.' },
    ],
  },
  {
    id: 'startup', cat: 'Opportunity', title: 'Friend\'s startup', w: 1.2, cond: (run) => !run.h.angel,
    setup: (run) => ({ amt: 0.4 * run.salary }),
    text: (v, h) => `Your friend is building a delivery app and wants ${h.f(v.amt)} for a small stake.`,
    choices: [
      { label: (v, h) => `Invest ${h.f(v.amt)}`, note: 'Most startups fail. A few go huge.', need: (run, v) => run.cash >= v.amt, lesson: 'x_kelly',
        math: (run, v) => ({ kind: 'stake', stake: v.amt, rows: [{ p: 0.15, m: 12, label: 'Bought by a giant' }, { p: 0.25, m: 1.5, label: 'Sold for a small profit' }, { p: 0.6, m: 0, label: 'Shuts down' }] }), fx: (run, h, v) => { h.angel(v.amt); return 'You own a sliver of a dream. Results in 3 turns.'; } },
      { label: 'Wish them luck', note: 'No change', fx: () => 'You send a thumbs-up emoji.' },
    ],
  },
  {
    id: 'forex', cat: 'Offer', title: '"10% a week, guaranteed"', w: 1.2, once: true,
    setup: (run) => ({ amt: Math.max(0.3 * Math.max(0, run.cash), 0.1 * run.salary) }),
    text: () => 'A slick trader on Instagram posts screenshots of huge profits. "Send any amount. Withdraw anytime."',
    choices: [
      { label: (v, h) => `Send ${h.f(v.amt)}`, note: 'Could be life-changing', lesson: 'b_guard',
        math: () => ({ kind: 'text', text: '10% a week compounds to about 14,000% a year. The best investors in history averaged about 20% a year. A promise 700 times better than the best is not an investment.' }), fx: (run, h, v) => { h.cash(-v.amt); h.scam(v.amt); return `Week one: +10%. Week three: account blocked. ${h.f(v.amt)} gone.`; } },
      { label: 'Block and report', note: '+3 joy', lesson: 'g_investor', fx: (run, h) => { h.joy(3); h.term('ponzi'); return 'Guaranteed returns plus pressure to act is the classic scam pattern.'; } },
    ],
  },
  {
    id: 'coinhype', cat: 'Offer', title: 'Everyone is buying MoonCoin', w: 1.2,
    setup: (run) => ({ amt: 0.3 * Math.max(0, run.cash) }),
    text: () => 'Your barber, your pastor and your group chat are all in. It is up 400% this month.',
    choices: [
      { label: (v, h) => `Buy ${h.f(v.amt)} of crypto`, note: 'Into your crypto', need: (run, v) => v.amt > 0, lesson: 'g_investor',
        math: () => ({ kind: 'text', text: 'When everyone you know is buying, the market is usually Overheating. From Overheating, a Crash follows 55% of the time in this game, and crypto falls about 60% in a crash.' }), fx: (run, h, v) => { h.cash(-v.amt); h.add('crypto', v.amt); h.term('volatility'); return 'You are in. Hold on tight.'; } },
      { label: 'Sit this one out', note: 'No change', fx: () => 'Fear of missing out is loud. You stay calm.' },
    ],
  },
  {
    id: 'contract', cat: 'Business', title: 'Big contract offer', w: 2, cond: (run) => run.h.biz.c > 0,
    setup: (run) => ({ cost: 0.4 * run.salary }),
    text: (v, h) => `A supermarket chain wants to stock your products. You need ${h.f(v.cost)} for equipment.`,
    choices: [
      { label: (v, h) => `Invest ${h.f(v.cost)}`, note: 'Business grows 2.5× that', need: (run, v) => run.cash >= v.cost, fx: (run, h, v) => { h.cash(-v.cost); h.add('biz', 2.5 * v.cost); return 'Signed. Your business doubles its shelf space.'; } },
      { label: 'Too risky', note: 'No change', fx: () => 'A competitor takes the deal.' },
    ],
  },
  {
    id: 'theft', cat: 'Business', title: 'Break-in at the business', w: 1.4, cond: (run) => run.h.biz.c > 0,
    setup: (run) => ({ cam: 0.1 * run.salary }),
    text: () => 'Someone broke in overnight and took stock and equipment.',
    choices: [
      { label: (v, h) => `Cameras and a guard (${h.f(v.cam)})`, note: 'Business −5%', fx: (run, h, v) => { const n = h.expense(v.cam); h.scale('biz', 0.95); return `Secured. ${n}`; } },
      { label: 'Absorb the loss', note: 'Business −20%', fx: (run, h) => { h.scale('biz', 0.8); return 'You restock from scratch.'; } },
    ],
  },
  {
    id: 'flood', cat: 'Weather', title: 'Flood season', w: 1.5, cond: (run) => run.h.biz.c > 0,
    setup: (run) => ({ ins: 0.12 * run.salary }),
    text: (v, h, run) => (run.flags.weather > 1 ? 'Heavy rains are forecast and your fields sit low.' : 'Heavy rains are forecast near your business.'),
    choices: [
      { label: (v, h) => `Buy insurance (${h.f(v.ins)})`, note: 'Safe', fx: (run, h, v) => `Insured. The rain comes and goes. ${h.expense(v.ins)}` },
      {
        label: 'Take the chance', note: '50% chance of heavy damage', lesson: 'p_room',
        math: (run, v) => ({ kind: 'cost', rows: [{ p: 0.5, v: 0, label: 'The rain misses you' }, { p: 0.5, v: -0.3 * (run.flags.weather || 1) * run.h.biz.c, label: 'Flood damage' }], compare: -v.ins, compareLabel: 'Insurance, for certain' }),
        fx: (run, h) => {
          if (h.r() < 0.5) { const hit = 0.3 * (run.flags.weather || 1); h.scale('biz', 1 - hit); return `The water came in. Your business lost ${Math.round(hit * 100)}% of its value.`; }
          return 'The rains missed you.';
        },
      },
    ],
  },
  {
    id: 'shop', cat: 'Opportunity', title: 'A small shop is for sale', w: 1.4, cond: (run) => run.h.biz.c <= 0,
    setup: (run) => ({ price: 0.8 * run.salary }),
    text: (v, h) => `A retiring owner is selling a profitable corner shop for ${h.f(v.price)}.`,
    choices: [
      { label: (v, h) => `Buy it (${h.f(v.price)})`, note: 'You become a business owner', need: (run, v) => run.cash >= v.price, fx: (run, h, v) => { h.cash(-v.price); h.add('biz', 1.1 * v.price); h.term('passive'); return 'The keys are yours. Hire a manager to make it passive.'; } },
      { label: 'Pass', note: 'No change', fx: () => 'Someone else buys it.' },
    ],
  },
  {
    id: 'mentor', cat: 'Luck', title: 'A mentor appears', w: 0.9, once: true,
    text: () => 'A retired fund manager offers to have coffee with you.',
    choices: [
      { label: 'Listen and take notes', note: '+1 Crystal Ball use', lesson: 'h_mastermind', fx: (run) => { run.charges.crystal = (run.charges.crystal || 0) + 1; return 'Her advice: "Read the cycle, not the noise."'; } },
      { label: 'Too busy', note: 'No change', fx: () => 'You reschedule. It never happens.' },
    ],
  },
  {
    id: 'offplan', cat: 'Offer', title: 'Off-plan apartment', w: 1.1,
    setup: (run) => ({ dep: 0.6 * run.salary, worth: 1.2 * run.salary }),
    text: (v, h) => `A developer sells flats before building them. Pay ${h.f(v.dep)} today for one worth ${h.f(v.worth)} when finished.`,
    choices: [
      {
        label: (v, h) => `Pay the deposit (${h.f(v.dep)})`, note: 'Pay today, keys later', need: (run, v) => run.cash >= v.dep, lesson: 'x_kelly',
        math: (run, v) => ({ kind: 'stake', stake: v.dep, rows: [{ p: 0.65, m: v.worth / v.dep, label: 'Flat is built' }, { p: 0.35, m: 0, label: 'Developer vanishes' }] }),
        fx: (run, h, v) => {
          h.cash(-v.dep);
          if (h.r() < 0.35) { h.scam(v.dep); return 'The developer vanished with everyone\'s deposits.'; }
          h.buyProp(v.worth); return 'The building went up. The flat is yours.';
        },
      },
      { label: 'Visit the site first', note: 'Do your homework', lesson: 'g_investor', fx: (run, h) => { h.term('ponzi'); return h.r() < 0.35 ? 'The "site" is an empty field. Good thing you checked.' : 'Building is real but slow. You decide to wait.'; } },
    ],
  },
  {
    id: 'pension', cat: 'Career', title: 'Employer pension match', w: 1.2, once: true,
    setup: (run) => ({ amt: 0.15 * run.salary }),
    text: () => 'HR says: put some pay into the company pension and they will match every coin you put in.',
    choices: [
      { label: (v, h) => `Join (${h.f(v.amt)} from you)`, note: 'Company doubles it', lesson: 'b_purse', need: (run, v) => run.cash >= v.amt, fx: (run, h, v) => { h.cash(-v.amt); h.add('index', 2 * v.amt); h.term('compound'); return 'Free money: the company doubled it.'; } },
      { label: 'Keep all my take-home', note: 'No change', fx: () => 'You leave the match on the table.' },
    ],
  },
  {
    id: 'lotto', cat: 'Luck', title: 'Office lottery pool', w: 0.8,
    setup: (run) => ({ amt: 0.05 * run.salary }),
    text: () => 'Your office runs a lottery syndicate. Everyone is chipping in.',
    choices: [
      {
        label: (v, h) => `Chip in (${h.f(v.amt)})`, note: 'The odds are terrible', lesson: 'x_ev',
        math: (run, v) => ({ kind: 'stake', stake: v.amt, rows: [{ p: 0.002, m: 20 * run.salary / v.amt, label: 'Jackpot' }, { p: 0.998, m: 0, label: 'Nothing' }] }),
        fx: (run, h, v) => {
          h.cash(-v.amt);
          if (h.r() < 0.002) { h.cash(20 * run.salary); return 'YOU WON. Twenty years of salary. This almost never happens.'; }
          return 'No luck. The house always wins.';
        },
      },
      { label: 'Pass', note: 'No change', fx: () => 'You keep your money.' },
    ],
  },
  {
    id: 'hack', cat: 'World', title: 'Crypto exchange hacked', w: 1.2, cond: (run) => run.h.crypto > 0,
    setup: (run) => ({ fee: 0.1 * run.salary }),
    text: () => 'The exchange holding your crypto freezes withdrawals after a hack.',
    choices: [
      { label: 'Wait it out', note: 'Lose 30% of your crypto', fx: (run, h) => { h.scale('crypto', 0.7); return 'You got 70% back after months of waiting.'; } },
      { label: (v, h) => `Pay a "recovery expert" (${h.f(v.fee)})`, note: 'They promise to get it all back', lesson: 'b_guard', fx: (run, h, v) => { h.cash(-v.fee); h.scam(v.fee); h.scale('crypto', 0.7); return 'The expert disappeared too. Recovery "experts" are almost always scammers.'; } },
    ],
  },
];

export const ERAS = [
  {
    id: 'oil', name: 'Oil Shock', years: '1970s-style', unlock: 0, currency: 'USD', startAge: 30, target: 7,
    blurb: 'Oil prices quadruple, inflation hits double digits, and stocks go nowhere for years.',
    states: ['boom', 'over', 'crash', 'steady', 'crash', 'recov', 'steady', 'boom', 'boom', 'over'],
    adj: { 1: { infl: 0.05 }, 2: { infl: 0.08, co: { 4: 0.5 } }, 3: { infl: 0.07 }, 4: { infl: 0.06, co: { 4: 0.3 } }, 5: { infl: 0.03 } },
  },
  {
    id: 'dotcom', name: 'Dot-Com Bubble', years: 'Late-1990s-style', unlock: 40, currency: 'USD', startAge: 26, target: 7,
    blurb: 'Tech stocks soar on hype, then lose most of their value. Can you get out in time?',
    states: ['steady', 'boom', 'over', 'over', 'crash', 'crash', 'recov', 'steady', 'boom', 'steady'],
    adj: { 2: { co: { 3: 0.8 } }, 3: { co: { 3: 1.0 } }, 4: { co: { 3: -0.7 } }, 5: { co: { 3: -0.3 } } },
  },
  {
    id: 'crunch', name: 'Credit Crunch', years: '2008-style', unlock: 100, currency: 'USD', startAge: 28, target: 7,
    blurb: 'Easy mortgages inflate a housing bubble. Then the banks break.',
    states: ['boom', 'boom', 'over', 'crash', 'crash', 'recov', 'recov', 'steady', 'boom', 'steady'],
    adj: { 1: { prop: 0.12 }, 2: { prop: 0.2 }, 3: { prop: -0.25, co: { 0: -0.5 } }, 4: { prop: -0.1 } },
  },
  {
    id: 'slide', name: 'Naira Slide', years: 'Currency-collapse', unlock: 160, currency: 'NGN', startAge: 25, target: 7,
    blurb: 'Oil money dries up, the currency slides, and prices race ahead of pay.',
    states: ['steady', 'over', 'crash', 'recov', 'steady', 'over', 'crash', 'recov', 'boom', 'steady'],
    adj: { 2: { dev: 0.5, infl: 0.1 }, 3: { infl: 0.08 }, 6: { dev: 0.6, infl: 0.12 }, 7: { infl: 0.1 } },
  },
];

export const CHALLENGES = [
  { id: 'nostocks', name: 'No Stocks Week', text: 'The index fund and single stocks are closed.', off: ['index', 'stocks'] },
  { id: 'cryptoonly', name: 'Crypto Only', text: 'Only savings and crypto are open.', off: ['index', 'stocks', 'prop', 'biz', 'fx'] },
  { id: 'late', name: 'Late Starter', text: 'You start at 40 with double pay and some savings.', startAge: 40, salaryMult: 2, cashMult: 8 },
  { id: 'monk', name: 'Monk Mode', text: 'Lifestyle is locked to Frugal. Watch your joy.', lockLife: 0 },
  { id: 'landlord', name: 'Landlord Life', text: 'Only savings and property are open.', off: ['index', 'stocks', 'crypto', 'biz', 'fx'] },
  { id: 'founder', name: 'Founder', text: 'You start with a business, and stock markets are closed.', off: ['index', 'stocks'], biz: 30000 },
];

export const ASCENSION = [
  'Base game',
  'Inflation runs 1 point hotter',
  'Life bills cost 15% more',
  'Crashes come more often',
  'Start with half the cash',
  'Pay rises 1 point slower',
  'More scam headlines',
  'Selling fees doubled',
  'Joy drains 2 faster per turn',
  'Black swans twice as likely',
  'Living costs 10% higher',
  'Only 2 cards to choose from',
  'Deadline moves to 56',
];

export const GLOSSARY = {
  freedom: ['Freedom Number', 'The investments you need so that 4% a year covers your living costs: 25 times your yearly costs.'],
  rule4: ['4% rule', 'Taking about 4% of your investments each year is likely to last a lifetime.'],
  passive: ['Passive income', 'Money that arrives without your working hours: rent, interest, dividends, a managed business.'],
  inflation: ['Inflation', 'Prices rising over time, so the same cash buys less each year.'],
  realreturn: ['Real return', 'What you earn after inflation. 12% interest with 18% inflation loses you money.'],
  compound: ['Compound growth', 'Returns earning their own returns. It snowballs the longer you leave it.'],
  index: ['Index fund', 'One purchase that owns a slice of every big company, so no single failure sinks you.'],
  diversify: ['Diversification', 'Spreading money across assets that do not all fall at the same time.'],
  bear: ['Crash (bear market)', 'A fall of 20% or more. Markets in this game have recovered from every one.'],
  dip: ['Buying the dip', 'Investing more when prices are low after a crash.'],
  mortgage: ['Mortgage', 'A loan to buy property, repaid with interest. The property secures the loan.'],
  leverage: ['Leverage', 'Investing with borrowed money. It multiplies gains and losses alike.'],
  ponzi: ['Ponzi scheme', 'A fraud that pays early members with new members\' money until it collapses.'],
  efund: ['Emergency fund', 'A year of costs in safe savings, so a surprise bill does not push you into debt.'],
  creep: ['Lifestyle creep', 'Spending rising with every raise, so your Freedom Number keeps running away.'],
  devaluation: ['Devaluation', 'Your currency buying fewer dollars. Imported goods and anything priced in dollars get dearer.'],
  volatility: ['Volatility', 'How wildly a price swings. Higher volatility means bigger ups and bigger downs.'],
  liquidity: ['Liquidity', 'How quickly you can sell without losing value. Cash is liquid; property and businesses are not.'],
  rates: ['Interest rates', 'The price of borrowing. Rising rates usually push stocks and property down and help savers.'],
  debt: ['High-interest debt', 'Borrowing to cover bills. At these rates it grows faster than almost any investment.'],
};

export const SCAM_TIPS = [
  'Guaranteed high returns. Real investments never guarantee 10% a week, or 30% a turn.',
  'Pressure to act today. "Only for insiders", "slots closing" and "pay now" are warning signs.',
  'Paying to join or recruiting friends. If the money comes from new members, it is a pyramid.',
  'No clear way the money is made. If they cannot explain it simply, walk away.',
];

export const LESSONS = {
  panic: 'Selling right after a crash locks in the loss. Every crash in this game was followed by a recovery.',
  scam: 'Guaranteed high returns are the signature of a scam. Real returns come with risk.',
  idle: 'Cash left idle lost value to inflation every single turn.',
  conc: 'Too much in one asset. Spreading your money would have softened that blow.',
  creep: 'Lifestyle upgrades raised your Freedom Number faster than you could invest.',
  debt: 'High-interest debt ate your returns. An emergency fund in savings prevents it.',
  none: 'Starting earlier is the cheapest advantage there is. Compound growth needs time.',
};

export const TIPS = [
  'Tap an asset to move cash into it. Cash left idle shrinks with inflation.',
  'Read the headlines. They hint at what the next two years will bring, but some are noise or scams.',
  'Freedom means passive income covers your living costs. Watch the bar at the top.',
  'Cheaper living lowers your Freedom Number, but too little joy leads to burnout.',
];
