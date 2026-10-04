// Currencies, number formatting and the default economic assumptions.
//
// The defaults are long-run planning assumptions, not forecasts. Every one of
// them is shown to the user and can be changed in Settings -> Assumptions.
// Inflation and deposit rates move a lot from year to year (especially in
// Nigeria and Ghana), so the app asks people to check them against the
// central bank and statistics office figures when they set up.

export const CURRENCIES = {
  NGN: { name: 'Nigerian naira', symbol: '₦', locale: 'en-NG', infl: 0.18, inflSd: 0.05, deposit: 0.17, pensionAge: 60, usdFx: true },
  USD: { name: 'US dollar', symbol: '$', locale: 'en-US', infl: 0.025, inflSd: 0.012, deposit: 0.04, pensionAge: 67, usdFx: false },
  GBP: { name: 'British pound', symbol: '£', locale: 'en-GB', infl: 0.025, inflSd: 0.012, deposit: 0.04, pensionAge: 67, usdFx: true },
  EUR: { name: 'Euro', symbol: '€', locale: 'en-IE', infl: 0.02, inflSd: 0.01, deposit: 0.025, pensionAge: 67, usdFx: true },
  GHS: { name: 'Ghanaian cedi', symbol: 'GH₵', locale: 'en-GH', infl: 0.15, inflSd: 0.06, deposit: 0.18, pensionAge: 60, usdFx: true },
  KES: { name: 'Kenyan shilling', symbol: 'KSh', locale: 'en-KE', infl: 0.055, inflSd: 0.02, deposit: 0.1, pensionAge: 60, usdFx: true },
  ZAR: { name: 'South African rand', symbol: 'R', locale: 'en-ZA', infl: 0.045, inflSd: 0.015, deposit: 0.07, pensionAge: 65, usdFx: true },
  CAD: { name: 'Canadian dollar', symbol: 'C$', locale: 'en-CA', infl: 0.025, inflSd: 0.012, deposit: 0.035, pensionAge: 65, usdFx: true },
  INR: { name: 'Indian rupee', symbol: '₹', locale: 'en-IN', infl: 0.045, inflSd: 0.015, deposit: 0.07, pensionAge: 60, usdFx: true },
  AED: { name: 'UAE dirham', symbol: 'AED ', locale: 'en-AE', infl: 0.025, inflSd: 0.012, deposit: 0.04, pensionAge: 65, usdFx: false },
};

export const CURRENCY_ORDER = ['NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR', 'CAD', 'INR', 'AED'];

// Long-run real returns (after inflation, in the asset's own currency) and
// yearly volatility. Sources for the shape of these numbers: Dimson, Marsh &
// Staunton's global returns yearbook (world equities about 5% real a year with
// about 17% volatility since 1900; bonds about 2%), adjusted down slightly for
// today's valuations. Nigerian equities are given the same real return with far
// higher volatility. Crypto gets no assumed premium, only its risk.
export const ASSET_CLASSES = {
  cash: { name: 'Cash and current accounts', short: 'Cash', mu: null, sd: 0, liquid: true },
  deposit: { name: 'Savings, fixed deposits, T-bills, money market', short: 'Savings', mu: null, sd: 0.02, liquid: true },
  bonds: { name: 'Bonds', short: 'Bonds', mu: 0.015, sd: 0.08, liquid: true },
  localEq: { name: 'Local shares and funds', short: 'Local shares', mu: 0.045, sd: 0.26, liquid: true },
  globalEq: { name: 'US and global shares and funds', short: 'Global shares', mu: 0.05, sd: 0.17, liquid: true, usd: true },
  usdCash: { name: 'Dollar savings and dollar bonds', short: 'Dollar savings', mu: 0.008, sd: 0.03, liquid: true, usd: true },
  crypto: { name: 'Crypto', short: 'Crypto', mu: 0, sd: 0.65, liquid: true, usd: true },
  pension: { name: 'Pension', short: 'Pension', mu: 0.03, sd: 0.09, liquid: false },
  property: { name: 'Property and land', short: 'Property', mu: 0.005, sd: 0.12, liquid: false },
  business: { name: 'Business', short: 'Business', mu: 0, sd: 0.25, liquid: false },
};

export const CLASS_ORDER = ['cash', 'deposit', 'bonds', 'localEq', 'globalEq', 'usdCash', 'crypto', 'pension', 'property', 'business'];

// Where new savings go by default, by how far away the money is needed.
export function suggestedMix(yearsToGoal, usdFx) {
  const eq = yearsToGoal >= 15 ? 0.8 : yearsToGoal >= 8 ? 0.65 : yearsToGoal >= 4 ? 0.45 : 0.2;
  const rest = 1 - eq;
  // A saver in a weak currency keeps a real share of equities in dollars.
  const glob = usdFx ? eq * 0.6 : eq;
  return {
    localEq: +(eq - glob).toFixed(2),
    globalEq: +glob.toFixed(2),
    deposit: +(rest * (usdFx ? 0.6 : 0.5)).toFixed(2),
    bonds: +(rest * (usdFx ? 0.2 : 0.5)).toFixed(2),
    usdCash: +(usdFx ? rest * 0.2 : 0).toFixed(2),
  };
}

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Money in the user's currency: short form for tiles (₦2.4M), long form for tables.
export function fmt(n, cur = 'USD', { short = true, sign = false } = {}) {
  const c = CURRENCIES[cur] || CURRENCIES.USD;
  if (n == null || !Number.isFinite(n)) return '–';
  const a = Math.abs(n);
  const s = n < 0 ? '−' : sign && n > 0 ? '+' : '';
  let body;
  if (short && a >= 1e9) body = `${trim(a / 1e9)}B`;
  else if (short && a >= 1e6) body = `${trim(a / 1e6)}M`;
  else if (short && a >= 1e4) body = `${trim(a / 1e3)}K`;
  else body = Math.round(a).toLocaleString(c.locale);
  return `${s}${c.symbol}${body}`;
}
// 380 stays 380; 2.50 becomes 2.5; 12.0 becomes 12. Only zeros after a decimal point go.
const trim = (x) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

export const pct = (x, d = 0) => (x == null || !Number.isFinite(x) ? '–' : `${(x * 100).toFixed(d)}%`);

// Monthly payment that clears a loan of P at annual rate r over n months.
export function pmt(P, r, n) {
  if (n <= 0) return P;
  const i = r / 12;
  return i === 0 ? P / n : (P * i) / (1 - Math.pow(1 + i, -n));
}

// Future value of a lump sum plus level monthly saving at annual rate r for n months.
export function fv(P, monthly, r, n) {
  const i = r / 12;
  if (i === 0) return P + monthly * n;
  const g = Math.pow(1 + i, n);
  return P * g + monthly * ((g - 1) / i);
}

// Monthly saving needed to reach target from P in n months at annual rate r.
export function savingFor(target, P, r, n) {
  if (n <= 0) return Math.max(0, target - P);
  const i = r / 12;
  const g = i === 0 ? 1 : Math.pow(1 + i, n);
  const need = target - P * g;
  if (need <= 0) return 0;
  return i === 0 ? need / n : need / ((g - 1) / i);
}

// What people type into a money box: "2.5m", "250k", "1,200,000", "₦300,000".
export function parseMoney(s) {
  if (s == null) return 0;
  const t = String(s).trim().toLowerCase().replace(/[,\s₦$£€]/g, '').replace(/^(ngn|usd|gbp|eur)/, '');
  const m = t.match(/^(-?\d*\.?\d+)([kmb])?$/);
  if (!m) return 0;
  return +m[1] * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1);
}
