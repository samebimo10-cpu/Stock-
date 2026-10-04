// Paying off debts: month by month, with any extra you can add each month.
//
// Avalanche pays the highest interest rate first (always the least interest).
// Snowball pays the smallest balance first (quick wins keep some people going).
// When a debt is cleared, its payment rolls on to the next one.

export function payoff(debts, extra = 0, order = 'avalanche', maxMonths = 600) {
  const ds = debts.filter((d) => d.balance > 0).map((d) => ({ id: d.id, name: d.name, bal: d.balance, rate: d.rate || 0, pay: d.payment || 0, done: null, interest: 0 }));
  if (!ds.length) return { months: 0, interest: 0, debts: [], stuck: false };
  const pick = order === 'snowball' ? (a, b) => a.bal - b.bal || b.rate - a.rate : (a, b) => b.rate - a.rate || a.bal - b.bal;
  const budget = ds.reduce((s, d) => s + d.pay, 0) + extra;
  let month = 0;
  let interest = 0;
  while (ds.some((d) => d.bal > 0.005) && month < maxMonths) {
    month += 1;
    for (const d of ds) if (d.bal > 0) { const i = (d.bal * d.rate) / 12; d.bal += i; d.interest += i; interest += i; }
    let left = budget;
    // Minimums first, then everything else at the target debt.
    for (const d of ds) if (d.bal > 0) { const p = Math.min(d.pay, d.bal, left); d.bal -= p; left -= p; }
    for (const d of ds.filter((x) => x.bal > 0).sort(pick)) { if (left <= 0) break; const p = Math.min(d.bal, left); d.bal -= p; left -= p; }
    for (const d of ds) if (d.bal <= 0.005 && d.done == null) { d.bal = 0; d.done = month; }
  }
  const stuck = ds.some((d) => d.bal > 0.005);
  return { months: stuck ? null : month, interest, stuck, debts: ds.map((d) => ({ id: d.id, name: d.name, done: d.done, interest: d.interest })) };
}

// Compare the two orders and say how much the extra payment saves.
export function compare(debts, extra = 0) {
  const base = payoff(debts, 0, 'avalanche');
  const av = payoff(debts, extra, 'avalanche');
  const sn = payoff(debts, extra, 'snowball');
  return { base, avalanche: av, snowball: sn, saved: base.stuck ? null : base.interest - av.interest, sooner: base.months != null && av.months != null ? base.months - av.months : null };
}
