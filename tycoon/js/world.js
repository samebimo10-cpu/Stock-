// Countries, currencies and places: what a person's money is exposed to
// depends on where each piece of it is.
//
// Every number here is a long-run planning estimate, shown to the user and
// editable per plan. They are not forecasts. Sources for the shape: long-run
// house-price and rent studies (real house prices in rich cities rise about
// 0-2% a year), exchange-rate volatility over the last decade, labour-market
// surveys of job loss and time to re-employment, and land-registry and
// title-dispute reporting for emerging markets.

// Country economics. infl: average inflation. fxSd: yearly swing of the real
// exchange rate against the US dollar; fxLocal: how much the currency falls in
// a bad local year (0..1). eq: local share market real return and swing.
// bizRisk: multiplier on new-business closure. wage: real pay growth and its
// yearly swing. job: yearly chance of losing a job by employer type, months to
// find new work, and the pay of the next job as a share of the last.
export const COUNTRIES = {
  NG: { name: 'Nigeria', cur: 'NGN', infl: 0.18, fxSd: 0.15, fxLocal: 0.5, eq: { mu: 0.045, sd: 0.26 }, bizRisk: 1.3, wage: { g: 0.0, sd: 0.06 }, job: { public: 0.02, large: 0.07, sme: 0.12, contract: 0.25, search: 8, next: 0.9 } },
  GH: { name: 'Ghana', cur: 'GHS', infl: 0.15, fxSd: 0.15, fxLocal: 0.5, eq: { mu: 0.04, sd: 0.25 }, bizRisk: 1.25, wage: { g: 0.0, sd: 0.06 }, job: { public: 0.02, large: 0.07, sme: 0.12, contract: 0.25, search: 8, next: 0.9 } },
  KE: { name: 'Kenya', cur: 'KES', infl: 0.055, fxSd: 0.08, fxLocal: 0.4, eq: { mu: 0.04, sd: 0.22 }, bizRisk: 1.15, wage: { g: 0.005, sd: 0.05 }, job: { public: 0.02, large: 0.06, sme: 0.1, contract: 0.2, search: 7, next: 0.9 } },
  ZA: { name: 'South Africa', cur: 'ZAR', infl: 0.045, fxSd: 0.12, fxLocal: 0.4, eq: { mu: 0.045, sd: 0.2 }, bizRisk: 1.1, wage: { g: 0.005, sd: 0.04 }, job: { public: 0.02, large: 0.06, sme: 0.1, contract: 0.2, search: 9, next: 0.9 } },
  US: { name: 'United States', cur: 'USD', infl: 0.025, fxSd: 0, fxLocal: 0, eq: { mu: 0.05, sd: 0.17 }, bizRisk: 1, wage: { g: 0.01, sd: 0.03 }, job: { public: 0.015, large: 0.04, sme: 0.07, contract: 0.15, search: 4, next: 0.95 } },
  GB: { name: 'United Kingdom', cur: 'GBP', infl: 0.025, fxSd: 0.08, fxLocal: 0.3, eq: { mu: 0.045, sd: 0.16 }, bizRisk: 1, wage: { g: 0.008, sd: 0.03 }, job: { public: 0.015, large: 0.04, sme: 0.07, contract: 0.15, search: 4, next: 0.95 } },
  EU: { name: 'Eurozone', cur: 'EUR', infl: 0.02, fxSd: 0.08, fxLocal: 0.3, eq: { mu: 0.045, sd: 0.17 }, bizRisk: 1, wage: { g: 0.008, sd: 0.03 }, job: { public: 0.01, large: 0.035, sme: 0.06, contract: 0.15, search: 6, next: 0.95 } },
  CA: { name: 'Canada', cur: 'CAD', infl: 0.025, fxSd: 0.06, fxLocal: 0.3, eq: { mu: 0.045, sd: 0.15 }, bizRisk: 1, wage: { g: 0.008, sd: 0.03 }, job: { public: 0.015, large: 0.04, sme: 0.07, contract: 0.15, search: 4, next: 0.95 } },
  IN: { name: 'India', cur: 'INR', infl: 0.045, fxSd: 0.05, fxLocal: 0.3, eq: { mu: 0.05, sd: 0.2 }, bizRisk: 1.1, wage: { g: 0.02, sd: 0.05 }, job: { public: 0.01, large: 0.05, sme: 0.1, contract: 0.2, search: 6, next: 0.9 } },
  AE: { name: 'UAE', cur: 'AED', infl: 0.025, fxSd: 0.005, fxLocal: 0, eq: { mu: 0.04, sd: 0.2 }, bizRisk: 1, wage: { g: 0.005, sd: 0.04 }, job: { public: 0.015, large: 0.05, sme: 0.08, contract: 0.15, search: 4, next: 0.9 } },
};

export const CUR_COUNTRY = { NGN: 'NG', GHS: 'GH', KES: 'KE', ZAR: 'ZA', USD: 'US', GBP: 'GB', EUR: 'EU', CAD: 'CA', INR: 'IN', AED: 'AE' };

// Approximate units per US dollar. Only the naira rate is live (from the
// market data); edit the others to today's rate in Assumptions.
export const DEFAULT_RATES = { USD: 1, NGN: 1500, GHS: 12, KES: 129, ZAR: 18, GBP: 0.75, EUR: 0.88, CAD: 1.38, INR: 88, AED: 3.6725 };

// Deposit rates in each currency (for savings held there).
export const DEPOSIT = { NGN: 0.17, GHS: 0.18, KES: 0.1, ZAR: 0.07, USD: 0.04, GBP: 0.04, EUR: 0.025, CAD: 0.035, INR: 0.07, AED: 0.04 };

export const EMPLOYERS = {
  public: 'Government or public sector',
  large: 'Large private company or multinational',
  sme: 'Small or medium business',
  contract: 'Contract, casual or commission work',
};

// Places. prop and land: long-run real price growth (after local inflation)
// and yearly swing, in the local currency. rent: typical gross yield. title:
// chance of a title or ownership dispute over a holding. Edit any of them.
export const LOCATIONS = {
  'NG-LAG-ISL': { c: 'NG', name: 'Lagos: Ikoyi, Victoria Island, Lekki Phase 1', prop: { mu: 0.01, sd: 0.18 }, land: { mu: 0.03, sd: 0.2 }, rent: 0.06, title: 0.04 },
  'NG-LAG-LEK': { c: 'NG', name: 'Lagos: Lekki–Ajah–Epe corridor', prop: { mu: 0.015, sd: 0.22 }, land: { mu: 0.04, sd: 0.28 }, rent: 0.07, title: 0.08 },
  'NG-LAG-MAIN': { c: 'NG', name: 'Lagos: Mainland', prop: { mu: 0.005, sd: 0.16 }, land: { mu: 0.02, sd: 0.2 }, rent: 0.08, title: 0.07 },
  'NG-ABJ': { c: 'NG', name: 'Abuja', prop: { mu: 0.005, sd: 0.18 }, land: { mu: 0.02, sd: 0.22 }, rent: 0.07, title: 0.06 },
  'NG-PHC': { c: 'NG', name: 'Port Harcourt', prop: { mu: -0.01, sd: 0.18 }, land: { mu: 0, sd: 0.2 }, rent: 0.07, title: 0.07 },
  'NG-IBD': { c: 'NG', name: 'Ibadan', prop: { mu: 0, sd: 0.15 }, land: { mu: 0.02, sd: 0.18 }, rent: 0.08, title: 0.08 },
  'NG-OTH': { c: 'NG', name: 'Elsewhere in Nigeria', prop: { mu: -0.005, sd: 0.15 }, land: { mu: 0.01, sd: 0.18 }, rent: 0.08, title: 0.09 },
  'GH-ACC': { c: 'GH', name: 'Accra', prop: { mu: 0.01, sd: 0.16 }, land: { mu: 0.02, sd: 0.2 }, rent: 0.07, title: 0.06 },
  'GH-OTH': { c: 'GH', name: 'Elsewhere in Ghana', prop: { mu: 0, sd: 0.15 }, land: { mu: 0.01, sd: 0.18 }, rent: 0.08, title: 0.08 },
  'KE-NBO': { c: 'KE', name: 'Nairobi', prop: { mu: 0.005, sd: 0.14 }, land: { mu: 0.02, sd: 0.18 }, rent: 0.06, title: 0.04 },
  'KE-OTH': { c: 'KE', name: 'Elsewhere in Kenya', prop: { mu: 0, sd: 0.14 }, land: { mu: 0.015, sd: 0.17 }, rent: 0.07, title: 0.05 },
  'ZA-JNB': { c: 'ZA', name: 'Johannesburg', prop: { mu: -0.005, sd: 0.12 }, land: { mu: 0, sd: 0.15 }, rent: 0.08, title: 0.01 },
  'ZA-CPT': { c: 'ZA', name: 'Cape Town', prop: { mu: 0.01, sd: 0.12 }, land: { mu: 0.015, sd: 0.15 }, rent: 0.07, title: 0.01 },
  'US-NYC': { c: 'US', name: 'New York City (Manhattan, Brooklyn)', prop: { mu: 0.005, sd: 0.1 }, land: { mu: 0.01, sd: 0.12 }, rent: 0.035, title: 0.002 },
  'US-TX': { c: 'US', name: 'Texas (Houston, Dallas, Austin)', prop: { mu: 0.015, sd: 0.09 }, land: { mu: 0.015, sd: 0.11 }, rent: 0.06, title: 0.003 },
  'US-OTH': { c: 'US', name: 'Elsewhere in the US', prop: { mu: 0.01, sd: 0.08 }, land: { mu: 0.01, sd: 0.1 }, rent: 0.055, title: 0.003 },
  'GB-LON': { c: 'GB', name: 'London', prop: { mu: 0.01, sd: 0.1 }, land: { mu: 0.01, sd: 0.12 }, rent: 0.035, title: 0.001 },
  'GB-OTH': { c: 'GB', name: 'Elsewhere in the UK', prop: { mu: 0.01, sd: 0.08 }, land: { mu: 0.01, sd: 0.1 }, rent: 0.05, title: 0.001 },
  'EU-AVG': { c: 'EU', name: 'Eurozone city', prop: { mu: 0.01, sd: 0.08 }, land: { mu: 0.01, sd: 0.1 }, rent: 0.045, title: 0.002 },
  'CA-TOR': { c: 'CA', name: 'Toronto', prop: { mu: 0.01, sd: 0.11 }, land: { mu: 0.01, sd: 0.12 }, rent: 0.04, title: 0.002 },
  'CA-OTH': { c: 'CA', name: 'Elsewhere in Canada', prop: { mu: 0.01, sd: 0.09 }, land: { mu: 0.01, sd: 0.1 }, rent: 0.05, title: 0.002 },
  'AE-DXB': { c: 'AE', name: 'Dubai', prop: { mu: 0.01, sd: 0.18 }, land: { mu: 0.01, sd: 0.2 }, rent: 0.06, title: 0.005 },
  'IN-MUM': { c: 'IN', name: 'Mumbai', prop: { mu: 0.01, sd: 0.12 }, land: { mu: 0.02, sd: 0.15 }, rent: 0.03, title: 0.03 },
  'IN-OTH': { c: 'IN', name: 'Elsewhere in India', prop: { mu: 0.01, sd: 0.12 }, land: { mu: 0.02, sd: 0.15 }, rent: 0.035, title: 0.04 },
};
export const LOCATION_ORDER = Object.keys(LOCATIONS);
export const HOME_LOC = { NG: 'NG-LAG-MAIN', GH: 'GH-ACC', KE: 'KE-NBO', ZA: 'ZA-JNB', US: 'US-OTH', GB: 'GB-OTH', EU: 'EU-AVG', CA: 'CA-OTH', IN: 'IN-OTH', AE: 'AE-DXB' };

export const countryOfCur = (cur) => CUR_COUNTRY[cur] || 'US';
export const countryOfLoc = (loc) => (LOCATIONS[loc] ? LOCATIONS[loc].c : null);

// A place's numbers with the plan's own overrides on top.
export function place(st, loc) {
  const base = LOCATIONS[loc] || LOCATIONS[HOME_LOC[countryOfCur(st.currency)]];
  const o = (st.assumptions.places || {})[loc] || {};
  return { ...base, prop: { ...base.prop, ...(o.prop || {}) }, land: { ...base.land, ...(o.land || {}) }, rent: o.rent ?? base.rent, title: o.title ?? base.title };
}

// A country's numbers with overrides on top.
export function country(st, c) {
  const base = COUNTRIES[c] || COUNTRIES.US;
  const o = (st.assumptions.countries || {})[c] || {};
  return { ...base, ...o, eq: { ...base.eq, ...(o.eq || {}) }, wage: { ...base.wage, ...(o.wage || {}) }, job: { ...base.job, ...(o.job || {}) } };
}

// Units of a currency per US dollar: live for the naira, else set or default.
export function rate(st, market, cur) {
  if (cur === 'USD') return 1;
  const set = (st.assumptions.rates || {})[cur];
  if (set) return set;
  if (cur === 'NGN' && market && market.fx) return market.fx;
  if (cur === st.currency && st.assumptions.usdRate) return st.assumptions.usdRate;
  return DEFAULT_RATES[cur] || 1;
}

// Convert an amount in one currency into another at today's rates.
export const convert = (st, market, amount, from, to) => (from === to ? amount : (amount / rate(st, market, from)) * rate(st, market, to));
