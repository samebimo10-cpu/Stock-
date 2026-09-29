// Tycoon Rush story: the recurring cast, life chapters, goals, earned cards
// and the story events that the director deals one per year.
//
// Everything here is data plus small effect functions, like content.js. The
// engine passes each effect a helper object `h`, so this file never touches
// the simulation directly. Several events run a small piece of game theory or
// behavioural economics behind the scenes; the player only sees a person, a
// situation and a choice. The "Why?" card names the idea afterwards.
//
//   repeated games     people remember how you treated them (trust, support)
//   signalling         a friend who puts in their own savings is more likely good
//   bargaining power   a raise is easier to win when you can afford to walk away
//   winner's curse     in a bidding war, the winner is often the one who overpaid
//   prisoner's dilemma a price war with a rival, played again every year
//   principal-agent    a manager paid a share of profit works harder than one on salary
//   commitment         an automatic savings plan beats willpower on sale day
//   sunk cost          throwing good money after bad to "save" an investment
//   real options       waiting a year keeps a choice open and brings new information
//   herding            selling with the crowd at the bottom, buying at the top

// ------------------------------------------------------------------ chapters

export const CHAPTERS = [
  { id: 'start', name: 'Starting out', from: 0, to: 25, line: 'First job, first money, first mistakes.' },
  { id: 'build', name: 'Building', from: 26, to: 35, line: 'Career, business, love and a place to live.' },
  { id: 'big', name: 'The big years', from: 36, to: 45, line: 'Children, property and the biggest bets of your life.' },
  { id: 'protect', name: 'Protect', from: 46, to: 55, line: 'Keep what you built. Pay off debt. Plan the finish.' },
  { id: 'free', name: 'Freedom', from: 56, to: 200, line: 'Retirement, legacy and the people you love.' },
];
export const chapterOf = (age) => CHAPTERS.find((c) => age >= c.from && age <= c.to) || CHAPTERS[CHAPTERS.length - 1];

// ------------------------------------------------------------------ the cast
//
// A small cast who recur across a whole life. `skill` and `style` are hidden
// and drawn from the seed; the player learns them through what they do.
export const CAST = {
  ambitious: { rel: 'Friend', art: 'friend', about: 'Big ideas, always starting something.' },
  cautious: { rel: 'Friend', art: 'neighbour', about: 'Careful with money. Asks good questions.' },
  mentor: { rel: 'Mentor', art: 'guide', about: 'Seen a few booms and busts.' },
  boss: { rel: 'Boss', art: 'boss', about: 'Runs your team. Rewards results.' },
  banker: { rel: 'Banker', art: 'banker', about: 'Knows your accounts better than you do.' },
  agent: { rel: 'Property agent', art: 'landlord', about: 'Always has "the perfect place".' },
  rival: { rel: 'Rival', art: 'hype', about: 'Runs the business across the street.' },
  parent: { rel: 'Parent', art: 'family', about: 'Raised you. Getting older.' },
};

// ------------------------------------------------------------------ goals
//
// One goal at a time, chosen for the chapter you are in. Goals also tilt which
// events the director deals: a house goal brings housing chances.
export const GOALS = [
  { id: 'cushion', chapters: ['start', 'build'], tags: ['money'], title: (x) => `Save a cushion of ${x.money(x.costs * 0.25)}`, done: (x) => x.save >= x.costs * 0.25, prog: (x) => x.save / (x.costs * 0.25), reward: 'Three months of costs saved. A surprise bill can\'t push you into debt now.' },
  { id: 'first_invest', chapters: ['start', 'build'], tags: ['investment'], title: () => 'Make your first investment', done: (x) => x.invested > 0, prog: (x) => (x.invested > 0 ? 1 : 0), reward: 'Your money has started working for you.' },
  { id: 'nw1', chapters: ['start', 'build'], tags: ['money', 'career'], title: (x) => `Reach ${x.money(x.nice(2 * x.unit))} net worth`, done: (x) => x.nw >= x.nice(2 * x.unit), prog: (x) => x.nw / x.nice(2 * x.unit), reward: 'Two years of starting pay, all yours.' },
  { id: 'home', chapters: ['build', 'big'], tags: ['property'], title: () => 'Buy your own home', done: (x) => x.ownHome, prog: (x) => Math.min(0.95, x.cash / Math.max(1, x.homeDeposit)), reward: 'Keys in hand. No more landlord.' },
  { id: 'biz', chapters: ['build', 'big'], tags: ['business'], title: () => 'Start a business', done: (x) => x.biz > 0, prog: (x) => (x.biz > 0 ? 1 : Math.min(0.9, x.cash / Math.max(1, x.unit))), reward: 'You are an owner now, not only an employee.' },
  { id: 'nw2', chapters: ['build', 'big'], tags: ['investment', 'money'], title: (x) => `Reach ${x.money(x.nice(8 * x.unit))} net worth`, done: (x) => x.nw >= x.nice(8 * x.unit), prog: (x) => x.nw / x.nice(8 * x.unit), reward: 'Eight years of starting pay. The snowball is rolling.' },
  { id: 'passive25', chapters: ['build', 'big', 'protect'], tags: ['investment', 'property', 'business'], title: (x) => `Money that comes by itself: ${x.money(x.bowl * 0.25)} a year`, done: (x) => x.passive >= x.bowl * 0.25, prog: (x) => x.passive / (x.bowl * 0.25), reward: 'A quarter of your costs paid by your money tree.' },
  { id: 'edu', chapters: ['big', 'protect'], tags: ['family'], need: (x) => x.kidsInSchool > 0, title: () => 'Put aside four years of school fees', done: (x) => x.save >= x.fees * 4, prog: (x) => x.save / Math.max(1, x.fees * 4), reward: 'The children\'s school is safe, whatever happens.' },
  { id: 'debtfree', chapters: ['protect', 'big', 'free'], tags: ['money', 'property'], need: (x) => x.debt > 0, title: () => 'Become debt-free', done: (x) => x.debt <= 0, prog: (x) => 1 - x.debt / Math.max(1, x.debtPeak), reward: 'Nobody owns a piece of you any more.' },
  { id: 'half', chapters: ['big', 'protect', 'free'], tags: ['investment', 'property', 'business'], title: () => 'Get halfway to freedom', done: (x) => x.passive >= x.bowl * 0.5, prog: (x) => x.passive / (x.bowl * 0.5), reward: 'Half your life is now paid for by your money.' },
  { id: 'freedom', chapters: ['start', 'build', 'big', 'protect', 'free'], tags: ['investment'], title: (x) => `Financial freedom${x.aim ? ` by ${x.aim}` : ' before 60'}`, done: (x) => x.passive >= x.bowl, prog: (x) => x.passive / x.bowl, reward: 'Work is optional now.' },
];

// ------------------------------------------------------------------ earned cards
//
// Cards are what you have become. The engine counts behaviour each year and a
// card unlocks when a pattern holds.
export const EARNED = [
  { card: 'compound', why: 'You paid yourself first for 7 years.', test: (b) => b.pyfYears >= 7 },
  { card: 'diamond_hands', why: 'You held on through two crashes without selling.', test: (b) => b.held >= 2 },
  { card: 'contrarian', why: 'You bought after a crash, twice.', test: (b) => b.dipBuys >= 2 },
  { card: 'landlord', why: 'You own property that pays rent.', test: (b) => b.rentYears >= 2 },
  { card: 'efund_pro', why: 'A year of costs sat in savings for 5 years.', test: (b) => b.efundYears >= 5 },
  { card: 'frugal_genius', why: 'Your costs stayed under 60% of pay for 6 years, without starving yourself.', test: (b) => b.leanYears >= 6 },
  { card: 'networker', why: 'Three people you helped helped you back.', test: (b) => b.reciprocity >= 3 },
  { card: 'dividend', why: 'You kept money in the index fund for 10 years.', test: (b) => b.indexYears >= 10 },
  { card: 'manager_pro', why: 'You ran a managed business for 6 years.', test: (b) => b.managedYears >= 6 },
  { card: 'franchise', why: 'Your business grew to three years of pay.', test: (b) => b.bigBiz },
  { card: 'analyst', why: 'You owned shares in three different companies.', test: (b) => b.companies >= 3 },
  { card: 'tax_smart', why: 'Your money paid half your costs.', test: (b) => b.halfFree },
  { card: 'stoic', why: 'You came back from a low point to real happiness.', test: (b) => b.comeback },
  { card: 'side_hustle', why: 'You kept a side hustle going for 4 years.', test: (b) => b.sideYears >= 4 },
  { card: 'coach', why: 'You reached five goals.', test: (b) => b.goals >= 5 },
  { card: 'rate_watcher', why: 'You called the market well five times.', test: (b) => b.goodCalls >= 5 },
];

// ------------------------------------------------------------------ story events
//
// Fields, as in content.js, plus:
//   cast     who brings it (a CAST role); their face and name are shown
//   chapter  the chapters it belongs to (null = any)
//   tags     what it is about, so goals can tilt the draw
//   thread   only dealt as a follow-up of an earlier choice
// Effects call h.follow(id, years, payload) to schedule what happens next,
// and h.memory(...) to remember a moment for the life story.

const pct = (x) => `${Math.round(x * 100)}%`;

// Move money out of savings so a real-life start can invest what it already has.
function fromSavings(run, amt) {
  if (!run.custom || run.cash >= amt) return;
  const x = Math.min(run.h.save, amt - Math.max(0, run.cash));
  run.h.save -= x; run.cash += x;
}

export const STORY = [
  // ---- The first decision, dealt before the first year.
  {
    id: 'first_step', cat: 'Your first money', cast: 'ambitious', w: 0, thread: true,
    // A real-life start begins mid-life, so the spare money includes what is already in savings.
    setup: (run, h) => ({ amt: Math.max(0.1 * h.unit(), 0.4 * Math.max(0, run.cash + (run.custom ? run.h.save : 0))) }),
    title: (v, h, run) => (run && run.custom ? 'Where you are now' : 'Your first money'),
    text: (v, h, run) => (run.custom
      ? `You are ${run.age}. You have ${h.f(Math.max(0, run.cash))} in cash and ${h.f(run.h.save)} in savings, and your pay is ${h.f(run.salary / 12)} a month. ${h.name('ambitious')} says: "${run.h.index > 0 ? 'You already own a fund. Why not add to it and let it grow?' : 'There\'s a fund that owns a little of every big company. Put some in and forget about it.'}"`
      : `You have ${h.f(Math.max(0, run.cash))} and your job pays ${h.f(run.salary / 12)} a month. ${h.name('ambitious')} says: "There's a fund that owns a little of every big company. Put some in and forget about it."`),
    choices: [
      { label: (v, h) => `Put ${h.f(v.amt)} in the fund`, note: 'Grows with the market, can dip', tags: ['investment'], lesson: 'p_compound', fx: (run, h, v) => { fromSavings(run, v.amt); const put = h.invest('index', v.amt); h.rel('ambitious', { trust: 4 }); h.memory('investment', run.custom ? 'You put money to work' : 'Your first investment', `You put ${h.f(put)} into an index fund at ${run.age}.`, v.amt * 0.2, ['investment', 'first']); return 'Done. Your money now owns a sliver of hundreds of companies.'; } },
      { label: (v, h, run) => (run && run.custom ? 'Leave it in savings' : `Keep ${h.f(v.amt)} safe in the bank`), note: 'Safe, but prices rise faster', lesson: 'b_multiply', fx: (run, h, v) => { h.invest('save', run.custom ? Math.max(0, run.cash) * 0.4 : v.amt); return 'Safe and sound. The bank pays a little interest.'; } },
      { label: 'Treat yourself to a new phone', note: '+8 joy', lesson: 'r_doodads', fx: (run, h, v) => { h.cash(-Math.min(v.amt, 0.5 * v.amt + 0.02 * h.unit())); h.joy(8); h.memory('sacrifice', 'The shiny new phone', 'You spent your first spare money on a phone.', -v.amt * 0.2, ['spending']); return 'It is a very nice phone.'; } },
    ],
  },

  // ---- Career
  {
    id: 'promo_lead', cat: 'Career', cast: 'boss', chapter: ['build', 'big'], tags: ['career'], w: 2, cond: (run) => run.age < 55 && !run.flags.retired,
    title: 'Lead the new division?',
    text: (v, h) => `${h.name('boss')}: "We want you to lead the new division. The pay is 35% more. It means moving cities and longer days."`,
    choices: [
      { label: 'Accept', note: 'Pay +35%, −6 joy, a move', tags: ['career'], fx: (run, h) => { h.salary(1.35); h.joy(-6); h.skill(); h.cash(-0.05 * h.unit()); h.trust(-5); h.rel('boss', { trust: 8 }); h.memory('career', 'You led the new division', `A promotion at ${run.age}: 35% more pay, and a move.`, 0.35 * run.salary * 3, ['career', 'decision']); return 'New city, new title, new pay slip.'; } },
      {
        label: 'Negotiate for more', note: 'Could win 50%. Could lose the offer', lesson: 's_batna', tags: ['career'],
        fx: (run, h) => {
          // Bargaining power: the more you can afford to walk away, the more you win.
          if (h.r() < h.batna()) { h.salary(1.5); h.joy(-6); h.skill(); h.rel('boss', { trust: 2 }); h.memory('career', 'You negotiated a 50% raise', `You asked for more and got it: a 50% raise at ${run.age}.`, 0.5 * run.salary * 3, ['career', 'decision', 'win']); return 'They blink first. 50% more, and they respect you for asking.'; }
          h.rel('boss', { trust: -6 });
          if (h.r() < 0.5) { h.salary(1.35); h.joy(-6); return 'They hold at 35%. You take it.'; }
          h.memory('career', 'The promotion that got away', 'You pushed too hard and the job went to someone else.', -0.35 * run.salary * 2, ['career', 'decision', 'loss']);
          return 'They give the job to someone else. Ouch.';
        },
      },
      { label: 'Decline', note: 'Keep your evenings, +4 joy', fx: (run, h) => { h.joy(4); h.rel('boss', { trust: -3 }); h.flag('declinedPromo', (run.flags.declinedPromo || 0) + 1); h.memory('career', 'You chose your evenings', `You turned down a promotion at ${run.age}.`, 0, ['career', 'decision']); return 'You keep your life as it is.'; } },
    ],
  },
  {
    id: 'rival_offer', cat: 'Career', cast: 'rival', chapter: ['start', 'build', 'big'], tags: ['career'], w: 1.4, cond: (run) => run.age < 52 && !run.flags.retired,
    title: 'A job offer from a rival firm',
    text: () => 'A rival company offers 25% more pay. They are younger and riskier: if the market turns, they cut staff first.',
    choices: [
      { label: 'Take it', note: 'Pay +25%, more layoff risk', fx: (run, h) => { h.salary(1.25); h.flag('riskyJob', true); h.rel('boss', { trust: -8 }); h.memory('career', 'You jumped ship', `You moved to a rival firm for 25% more at ${run.age}.`, 0.25 * run.salary * 2, ['career', 'decision']); return 'New desk, new badge, bigger pay slip.'; } },
      { label: 'Use it to ask your boss for a raise', note: 'Your boss may match it', lesson: 's_batna', fx: (run, h) => { if (h.r() < 0.35 + h.rel('boss').trust / 300) { h.salary(1.15); h.rel('boss', { trust: -2 }); return 'Your boss matches most of it: +15%.'; } h.rel('boss', { trust: -6 }); return '"If you want to go, go." Awkward.'; } },
      { label: 'Stay loyal', note: 'Your boss remembers', fx: (run, h) => { h.rel('boss', { trust: 8, support: 1 }); return 'Your boss hears you turned it down. It is noticed.'; } },
    ],
  },
  {
    id: 'startup_job', cat: 'Career', cast: 'ambitious', chapter: ['start', 'build'], tags: ['career', 'opportunity'], w: 1.1, cond: (run) => run.age < 40 && !run.flags.startupJob,
    title: 'Salary or shares?',
    text: (v, h) => `${h.name('ambitious')}'s startup wants you. They can pay 30% less, but give you shares that could be worth a lot, or nothing.`,
    choices: [
      { label: 'Join for shares', note: '−30% pay now; 1 in 4 chance of a big payout later', lesson: 'p_tails', fx: (run, h) => { h.salary(0.7); h.flag('startupJob', true); h.rel('ambitious', { trust: 10, closeness: 8 }); h.follow('startup_exit', 5, {}); h.memory('career', 'You bet on a startup', `You swapped salary for shares at ${run.age}.`, 0, ['career', 'risk', 'decision']); return 'Your first day: bean bags and big dreams.'; } },
      { label: 'Keep your salary', note: 'Certainty', fx: (run, h) => { h.rel('ambitious', { closeness: -3 }); h.flag('startupJob', 'declined'); return '"Your loss," they joke. You hope so.'; } },
    ],
  },
  {
    id: 'startup_exit', cat: 'Career', cast: 'ambitious', thread: true, w: 0,
    title: 'The startup, five years on',
    text: (v, h) => `${h.name('ambitious')} calls a meeting about the company.`,
    choices: [
      {
        label: 'Hear the news', note: '',
        fx: (run, h) => {
          if (h.r() < 0.25 + 0.3 * h.skill('ambitious')) { const pay = 3 * run.salary; h.cash(pay); h.salary(1 / 0.7); h.memory('success', 'The startup sold', `Your shares paid ${h.f(pay)}.`, pay, ['career', 'win']); return `A big company bought it. Your shares pay ${h.f(pay)}!`; }
          h.salary(1 / 0.7);
          h.memory('failure', 'The startup folded', 'Your shares ended up worth nothing.', -0.3 * run.salary * 5, ['career', 'loss']);
          return 'The money ran out. Your shares are worth nothing, but you land a normal job again.';
        },
      },
    ],
  },
  {
    id: 'overtime', cat: 'Career', cast: 'boss', chapter: null, tags: ['career'], w: 1.2, cond: (run) => !run.flags.retired,
    title: 'Weekend overtime',
    text: (v, h) => `${h.name('boss')} needs people for weekend shifts all year. Double pay.`,
    setup: (run) => ({ extra: 0.15 * run.salary }),
    choices: [
      { label: (v, h) => `Work weekends (+${h.f(v.extra)})`, note: '−6 joy, partner trust −4', fx: (run, h, v) => { h.cash(v.extra); h.joy(-6); h.trust(-4); h.rel('boss', { trust: 4 }); return 'Saturdays belong to the office. The money is nice.'; } },
      { label: 'Keep your weekends', note: '+3 joy', fx: (run, h) => { h.joy(3); return 'You rest. It shows.'; } },
    ],
  },
  {
    id: 'boss_tension', cat: 'Career', cast: 'boss', thread: true, w: 0,
    title: 'Tension at work',
    text: (v, h) => `${h.name('boss')} has been cold since you asked for that raise. Rumours say they are "restructuring".`,
    choices: [
      { label: 'Clear the air over coffee', note: 'Trust can recover', lesson: 's_repeated', fx: (run, h) => { h.rel('boss', { trust: 10, conflict: -2 }); return 'An honest talk. Things thaw.'; } },
      { label: 'Start job hunting quietly', note: 'A better job, or none', fx: (run, h) => { if (h.r() < 0.55) { h.salary(1.12); return 'You land a better job: +12%.'; } h.salary(0.9); h.joy(-4); return 'Nothing good comes up, and your boss finds out. A pay cut follows.'; } },
    ],
  },

  // ---- Money and investing
  {
    id: 'crash_advice', cat: 'Market', cast: 'ambitious', w: 0, thread: true,
    setup: (run, h) => ({ risky: h.risky(), drop: run.lastResult ? run.lastResult.nw1 - run.lastResult.nw0 : 0 }),
    title: 'The market crashed',
    text: (v, h) => `Markets fell hard last year. ${h.name('ambitious')} texts: "Sell everything. This is going lower. I'm out."`,
    choices: [
      { label: 'Sell half your shares', note: 'Sleep better. Miss the rebound?', lesson: 's_herd', fx: (run, h) => { const got = h.sellRisky(0.5); h.flag('panicSold', true); h.memory('investment', 'You sold in the crash', `You sold ${h.f(got)} of shares after the crash at ${run.age}.`, -got * 0.2, ['investment', 'crash', 'decision']); return `You sold ${h.f(got)}. The panic eases.`; } },
      { label: 'Hold on', note: 'Do nothing. Wait it out', lesson: 'h_persist', fx: (run, h, v) => { h.beh('held'); h.memory('investment', 'You held through the crash', `You didn't sell when everyone else did, at ${run.age}.`, v.risky * 0.1, ['investment', 'crash', 'decision', 'calm']); return 'You turn off the news and wait.'; } },
      { label: 'Buy more while it\'s cheap', note: 'Half your cash into the index fund', lesson: 'g_mrmarket', need: (run) => run.cash > 0, fx: (run, h) => { const a = 0.5 * Math.max(0, run.cash); h.invest('index', a); h.beh('held'); h.beh('dipBuys'); h.memory('investment', 'You bought the crash', `You put ${h.f(a)} in when prices were low, at ${run.age}.`, a * 0.3, ['investment', 'crash', 'decision', 'calm']); return `You buy ${h.f(a)} of the index fund at crash prices.`; } },
    ],
  },
  {
    id: 'boom_fomo', cat: 'Market', cast: 'cautious', chapter: null, tags: ['investment'], w: 0, thread: true,
    title: 'Everyone is getting rich',
    text: (v, h) => `Prices are flying. Even ${h.name('cautious')} bought in last month. "It only goes up," they say, sounding unsure.`,
    choices: [
      { label: 'Go all in', note: '80% of your cash into the market', lesson: 's_herd', need: (run) => run.cash > 0, fx: (run, h) => { const a = 0.8 * Math.max(0, run.cash); h.invest('index', a); h.memory('investment', 'You bought at the top', `You piled ${h.f(a)} in during the boom at ${run.age}.`, -a * 0.15, ['investment', 'boom', 'decision']); return `${h.f(a)} in. It feels great, for now.`; } },
      { label: 'Stick to your plan', note: 'Your automatic plan keeps going', lesson: 'g_euphoria', fx: (run, h) => { h.joy(-2); return 'You feel left out, but you don\'t chase.'; } },
      { label: 'Take some profit', note: 'Move a quarter of your shares to savings', lesson: 'g_defensive', fx: (run, h) => { const got = h.sellRisky(0.25, 'save'); return `You move ${h.f(got)} to savings while prices are high.`; } },
    ],
  },
  {
    id: 'sale_day', cat: 'Spending', cast: 'cautious', chapter: null, tags: ['money'], w: 1.3,
    setup: (run) => ({ amt: 0.12 * run.salary }),
    title: 'The biggest sale of the year',
    text: (v, h) => `Everything is 40% off. The TV you wanted, new clothes, a weekend away: ${h.f(v.amt)} of "savings".`,
    choices: [
      {
        label: 'Buy it all', note: '+6 joy', lesson: 's_commit',
        fx: (run, h, v) => {
          // A commitment device: money already moved by the plan isn't there to spend.
          if (run.plan.pyf >= 0.1) { const spent = v.amt * 0.5; h.cash(-spent); h.joy(5); return `Your plan had already moved your savings, so you only spend ${h.f(spent)}. Still a good haul.`; }
          h.cash(-v.amt); h.joy(6); return 'Bags and boxes everywhere. Your savings took the hit.';
        },
      },
      { label: 'Just one thing', note: '+2 joy', fx: (run, h, v) => { h.cash(-v.amt * 0.25); h.joy(2); return 'One good buy. No regrets.'; } },
      { label: 'Walk past', note: '−1 joy', fx: (run, h) => { h.joy(-1); return 'The best purchase is the one you don\'t need.'; } },
    ],
  },
  {
    id: 'rate_hike', cat: 'Bank', cast: 'banker', w: 0, thread: true,
    title: 'Your mortgage rate is changing',
    text: (v, h, run) => `${h.name('banker')}: "The central bank raised rates. Your mortgage will cost ${pct(h.mortRate())} a year now."`,
    choices: [
      { label: 'Fix your rate for 5 years', note: 'Pay a 1% fee now', fx: (run, h) => { h.fixRate(); return 'Fixed. Whatever rates do next, your payment stays put.'; } },
      { label: 'Pay down some debt', note: 'Use half your cash', need: (run) => run.cash > 0, fx: (run, h) => { const a = h.repay(0.5 * Math.max(0, run.cash)); return `You pay off ${h.f(a)}. Less debt, less interest.`; } },
      { label: 'Keep the mortgage as it is', note: 'Rates may fall again', fx: () => 'You ride it out.' },
    ],
  },
  {
    id: 'infl_squeeze', cat: 'Economy', cast: 'cautious', w: 0, thread: true,
    title: 'Everything costs more',
    text: () => 'Food, rent and transport jumped this year. Your pay did not.',
    choices: [
      { label: 'Cut back', note: 'Everyday spending down a level, −4 joy', fx: (run, h) => { h.life(-1); h.joy(-4); return 'Home cooking and fewer outings. It works.'; } },
      { label: 'Ask for a raise', note: 'Better with savings behind you', lesson: 's_batna', fx: (run, h) => { if (h.r() < h.batna()) { h.salary(1.1); return 'Your boss agrees: +10%.'; } h.rel('boss', { trust: -3 }); return '"Not this year." Budgets are tight everywhere.'; } },
      { label: 'Start a side hustle', note: '+15% income, −3 joy a year', fx: (run, h) => { h.side(true); return 'Evenings and weekends: you are in business.'; } },
    ],
  },

  // ---- The ambitious friend's venture: signalling, sunk cost and bet size.
  {
    id: 'friend_venture', cat: 'Opportunity', cast: 'ambitious', chapter: ['start', 'build', 'big'], tags: ['business', 'opportunity', 'investment'], w: 1.6, cond: (run) => !run.flags.venture && run.age >= 23,
    setup: (run, h) => ({ big: 0.6 * run.salary, small: 0.2 * run.salary, skin: h.signal('ambitious') }),
    title: (v, h) => `${h.name('ambitious')} has a plan`,
    text: (v, h) => `${h.name('ambitious')} wants to open a restaurant and needs partners. ${v.skin ? '"I\'m putting in all my own savings too."' : '"The bank will lend me the rest, I just need a little from friends."'}`,
    choices: [
      { label: (v, h) => `Invest ${h.f(v.big)}`, note: 'Big stake, big upside', lesson: 's_signal', need: (run, v) => run.cash >= v.big, math: (run, v) => ({ kind: 'stake', stake: v.big, rows: [{ p: 0.55, m: 3, label: 'It works (about 3×)' }, { p: 0.45, m: 0, label: 'It fails' }] }), fx: (run, h, v) => { h.cash(-v.big); h.flag('venture', { stake: v.big }); h.rel('ambitious', { trust: 10, closeness: 8 }); h.follow('venture_year2', 2, {}); h.memory('business', `You backed ${h.name('ambitious')}'s restaurant`, `You invested ${h.f(v.big)} at ${run.age}.`, 0, ['business', 'risk', 'friend', 'decision']); return 'You shake on it. The sign goes up next month.'; } },
      { label: (v, h) => `Invest ${h.f(v.small)}`, note: 'A smaller slice', lesson: 'x_kelly', need: (run, v) => run.cash >= v.small, fx: (run, h, v) => { h.cash(-v.small); h.flag('venture', { stake: v.small }); h.rel('ambitious', { trust: 5, closeness: 4 }); h.follow('venture_year2', 2, {}); h.memory('business', `A small stake in ${h.name('ambitious')}'s restaurant`, `You invested ${h.f(v.small)} at ${run.age}.`, 0, ['business', 'friend', 'decision']); return 'A small slice of something new.'; } },
      { label: 'Wish them luck', note: 'Keep your cash', fx: (run, h) => { h.flag('venture', { stake: 0 }); h.rel('ambitious', { closeness: -3 }); h.follow('venture_news', 5, {}); return '"No hard feelings," they say. Mostly.'; } },
    ],
  },
  {
    id: 'venture_year2', cat: 'Business', cast: 'ambitious', thread: true, w: 0,
    setup: (run, h) => ({ good: h.r() < h.skill('ambitious'), more: 0.3 * run.salary }),
    title: 'How is the restaurant doing?',
    text: (v, h) => (v.good ? `${h.name('ambitious')}: "We're full every weekend! Thinking of a second site."` : `${h.name('ambitious')}: "It's been slow. If we can get through this year, we'll make it. Can you put in a bit more?"`),
    choices: (run, v) => (v.good ? [
      { label: 'Great, keep going', note: '', fx: (r2, h) => { h.follow('venture_end', 3, { good: true }); h.rel('ambitious', { trust: 4 }); return 'You leave them to it.'; } },
    ] : [
      { label: 'Put in more', note: 'Rescue it?', lesson: 's_sunk', need: (r2) => r2.cash >= v.more, math: (r2) => ({ kind: 'stake', stake: v.more, rows: [{ p: 0.3, m: 2.5, label: 'It turns around' }, { p: 0.7, m: 0, label: 'It closes anyway' }] }), fx: (r2, h) => { h.cash(-v.more); r2.flags.venture.stake += v.more; h.rel('ambitious', { trust: 6, support: 1 }); h.follow('venture_end', 3, { good: h.r() < 0.3 }); return 'You put in more. "I won\'t forget this."'; } },
      { label: 'Give advice, not money', note: '', lesson: 's_sunk', fx: (r2, h) => { h.rel('ambitious', { closeness: 2 }); h.follow('venture_end', 3, { good: h.r() < 0.2 }); return 'You help with the menu and the books.'; } },
      { label: 'Ask for your share back', note: 'Get a third of it now', fx: (r2, h) => { const back = r2.flags.venture.stake / 3; h.cash(back); r2.flags.venture.stake = 0; h.rel('ambitious', { trust: -12, conflict: 3 }); h.memory('business', 'You pulled out of the restaurant', `You took ${h.f(back)} back and walked away.`, -back * 2, ['business', 'friend']); return `They pay you ${h.f(back)}. It is frosty.`; } },
    ]),
  },
  {
    id: 'venture_end', cat: 'Business', cast: 'ambitious', thread: true, w: 0,
    title: 'The restaurant, five years on',
    text: (v, h) => (v.good ? `${h.name('ambitious')} is beaming: a chain wants to buy the restaurant.` : `${h.name('ambitious')} looks tired: the restaurant is closing.`),
    choices: (run, v) => [{
      label: 'Hear the details', note: '',
      fx: (r2, h) => {
        const stake = (r2.flags.venture && r2.flags.venture.stake) || 0;
        if (v.good) { const pay = stake * 3; h.cash(pay); h.rel('ambitious', { trust: 6 }); if (stake) h.memory('success', 'The restaurant sold', `Your stake paid ${h.f(pay)}.`, pay - stake, ['business', 'friend', 'win']); return stake ? `Your share pays ${h.f(pay)}. Cheers all round.` : 'You had no stake left, but you are happy for them.'; }
        h.rel('ambitious', { closeness: 4 });
        if (stake) h.memory('failure', 'The restaurant closed', `You lost ${h.f(stake)}.`, -stake, ['business', 'friend', 'loss']);
        return stake ? `Your ${h.f(stake)} is gone. You're still friends.` : 'You lost nothing. You help them move the tables out.';
      },
    }],
  },
  {
    id: 'venture_news', cat: 'Friends', cast: 'ambitious', thread: true, w: 0,
    title: 'Remember that restaurant?',
    setup: (run, h) => ({ good: h.r() < h.skill('ambitious') }),
    text: (v, h) => (v.good ? `${h.name('ambitious')}: "Remember the restaurant you passed on? I just sold it to a chain."` : `${h.name('ambitious')}: "The restaurant didn't make it. Good call staying out."`),
    choices: [{ label: 'Congratulate them', note: '', fx: (run, h, v) => { h.rel('ambitious', { closeness: 3 }); if (v.good) h.memory('opportunity', 'The one that got away', `${h.name('ambitious')}'s restaurant sold without you.`, 0, ['friend', 'opportunity']); return v.good ? 'Good for them. You wonder what might have been.' : 'You buy them a drink.'; } }],
  },

  // ---- Property: the winner's curse, and the value of waiting.
  {
    id: 'bidding_war', cat: 'Property', cast: 'agent', chapter: ['build', 'big', 'protect'], tags: ['property', 'opportunity'], w: 1.3, cond: (run) => run.cash > 0.8 * run.salary,
    setup: (run, h) => { const P = 4 * h.unit(); return { P, V: P * (0.8 + 0.4 * h.r()), rival: 0.92 + 0.16 * h.r() }; },
    title: 'A bidding war for a rental flat',
    text: (v, h) => `${h.name('agent')}: "A flat that rents out easily. Asking ${h.f(v.P)}. Two other buyers are circling." You'd pay 30% now and borrow the rest.`,
    choices: [
      { label: (v, h) => `Offer the asking price (${h.f(v.P)})`, note: 'You might lose it', lesson: 's_winners', need: (run, v) => run.cash >= 0.3 * v.P, fx: (run, h, v) => h.auction(v, 1) },
      { label: (v, h) => `Bid 10% over (${h.f(1.1 * v.P)})`, note: 'You will probably win', lesson: 's_winners', need: (run, v) => run.cash >= 0.33 * v.P, fx: (run, h, v) => h.auction(v, 1.1) },
      { label: 'Wait a year', note: 'See where prices go', lesson: 's_option', fx: (run, h, v) => { h.follow('bidding_again', 1, { P: v.P, V: v.V }); return `"Suit yourself," says ${h.name('agent')}.`; } },
    ],
  },
  {
    id: 'bidding_again', cat: 'Property', cast: 'agent', thread: true, w: 0,
    setup: (run, h, v) => { const k = 1 + (run.last.prop || 0); return { P: v.P * k, V: v.V * k, rival: 0.92 + 0.16 * h.r() }; },
    title: 'That flat is back on the market',
    text: (v, h) => `${h.name('agent')}: "The sale fell through. It's back at ${h.f(v.P)}, and now the survey is public: it's worth about ${h.f(v.V)}."`,
    choices: [
      { label: (v, h) => `Buy it at ${h.f(Math.min(v.P, v.V))}`, note: 'You know the value now', lesson: 's_option', need: (run, v) => run.cash >= 0.3 * Math.min(v.P, v.V), fx: (run, h, v) => h.buyRental(Math.min(v.P, v.V), v.V) },
      { label: 'Pass', note: '', fx: () => 'Plenty more flats in the sea.' },
    ],
  },
  {
    id: 'tenant_trouble', cat: 'Property', cast: 'agent', chapter: null, tags: ['property'], w: 1.2, cond: (run) => run.h.prop.v - (run.h.prop.home || 0) > 0,
    setup: (run) => ({ fix: 0.05 * (run.h.prop.v - (run.h.prop.home || 0)) }),
    title: 'Your tenant wants repairs',
    text: (v, h) => `Your tenant says the roof leaks. A good repair costs ${h.f(v.fix)}. They hint they might leave.`,
    choices: [
      { label: (v, h) => `Fix it properly (${h.f(v.fix)})`, note: 'Tenant stays and pays', lesson: 's_repeated', fx: (run, h, v) => { h.cash(-v.fix); h.flag('goodLandlord', (run.flags.goodLandlord || 0) + 1); return 'Fixed. Your tenant renews for three years.'; } },
      { label: 'Patch it cheaply', note: '30% of the cost, risky', fx: (run, h, v) => { h.cash(-0.3 * v.fix); if (h.r() < 0.5) { h.flag('vacancy', true); return 'The patch fails. Your tenant leaves; the flat will sit empty for a while.'; } return 'It holds, for now.'; } },
    ],
  },

  // ---- Business: the price war (repeated prisoner's dilemma) and managers.
  {
    id: 'price_war', cat: 'Business', cast: 'rival', w: 0, thread: true,
    setup: (run, h) => ({ them: h.rivalMove() }),
    title: (v) => (v.them === 'D' ? 'A price war' : 'Your rival calls a truce'),
    text: (v, h) => (v.them === 'D' ? `${h.name('rival')} has cut prices by 15% across the street. Customers are noticing.` : `${h.name('rival')} has kept prices steady this year, and says they'd like it to stay that way.`),
    choices: [
      { label: 'Hold your prices', note: 'Cooperate', lesson: 's_pd', fx: (run, h, v) => h.priceWar('C', v.them) },
      { label: 'Undercut them', note: 'Win customers, start a fight', lesson: 's_pd', fx: (run, h, v) => h.priceWar('D', v.them) },
    ],
  },
  {
    id: 'manager_deal', cat: 'Business', cast: 'mentor', chapter: ['build', 'big', 'protect'], tags: ['business'], w: 1.4, cond: (run) => run.h.biz.c > 0 && !run.h.biz.managed,
    title: 'A manager for your business',
    text: () => 'An experienced manager can run your business so you don\'t have to. How do you pay them?',
    choices: [
      { label: 'A fixed salary', note: 'Costs half your pay a year; they take 25% of profit', fx: (run, h) => h.hire('salary') },
      { label: 'A share of the profit', note: 'They take 35%, but work harder', lesson: 's_agent', fx: (run, h) => h.hire('share') },
      { label: 'Keep running it yourself', note: '−3 joy a year', fx: () => 'You keep your hands on the wheel.' },
    ],
  },
  {
    id: 'biz_offer', cat: 'Business', cast: 'rival', chapter: ['big', 'protect', 'free'], tags: ['business', 'opportunity'], w: 1.1, cond: (run) => run.h.biz.c > run.salary,
    setup: (run, h) => ({ price: run.h.biz.c * (1.3 + 0.5 * h.r()) }),
    title: 'Someone wants to buy your business',
    text: (v, h) => `${h.name('rival')} offers ${h.f(v.price)} for your business.`,
    choices: [
      { label: (v, h) => `Sell for ${h.f(v.price)}`, note: 'Cash now', fx: (run, h, v) => { h.sellBiz(v.price); h.memory('success', 'You sold your business', `${h.name('rival')} bought it for ${h.f(v.price)}.`, v.price - run.h.biz.c, ['business', 'win', 'decision']); return 'You sign. The cheque clears.'; } },
      { label: 'Keep building', note: 'The offer may come back higher, or not', lesson: 's_option', fx: (run, h) => { h.rel('rival', { conflict: 1 }); return '"Your call," they say.'; } },
    ],
  },
  {
    id: 'biz_fail', cat: 'Business', cast: 'mentor', thread: true, w: 0,
    title: 'Your business was hit hard',
    text: (v, h, run) => `A bad year hit the business. It lost ${h.f(v.lost || 0)}. But you still have your ${run.flags.retired ? 'savings' : 'job'}${run.home.own ? ', your house' : ''} and ${h.f(Math.max(0, run.cash) + run.h.save)} in cash and savings.`,
    choices: [
      { label: 'Rebuild', note: 'Put in cash to get it going', need: (run) => run.cash > 0.2 * run.salary, fx: (run, h) => { const a = 0.3 * Math.max(0, run.cash); h.addBiz(a); return `You put ${h.f(a)} back in. Onwards.`; } },
      { label: 'Start smaller', note: 'Keep it lean', fx: (run, h) => { h.bizOps(); return 'Fewer hours, lower costs, a tighter menu.'; } },
      { label: 'Sell what\'s left', note: 'Back to a steady job', fx: (run, h) => { h.sellBiz(run.h.biz.c * 0.6); return 'You close up and go back to a steady pay slip.'; } },
    ],
  },
  {
    id: 'first_business', cat: 'Opportunity', cast: 'mentor', chapter: ['start', 'build', 'big'], tags: ['business', 'opportunity'], w: 1.2, cond: (run) => run.h.biz.c <= 0 && run.cash > 0.5 * run.salary,
    setup: (run) => ({ amt: 0.5 * run.salary }),
    title: 'A shop comes up for rent',
    text: (v, h) => `${h.name('mentor')}: "A little shop on the high street is empty. ${h.f(v.amt)} gets you started. Most new shops struggle; the good ones pay for years."`,
    choices: [
      { label: (v, h) => `Open it (${h.f(v.amt)})`, note: 'Profit if you feed it', need: (run, v) => run.cash >= v.amt, fx: (run, h, v) => { h.cash(-v.amt); h.addBiz(v.amt); h.memory('business', 'You opened your first business', `A shop on the high street, at ${run.age}.`, 0, ['business', 'first', 'decision']); return 'The sign goes up. You are a business owner.'; } },
      { label: 'Not now', note: '', fx: () => 'Maybe another time.' },
    ],
  },

  // ---- Family and relationships
  {
    id: 'school_offer', cat: 'Family', cast: 'parent', chapter: ['big', 'protect'], tags: ['family'], w: 1.4, cond: (run) => run.kids.some((k) => run.age - k.born >= 5 && run.age - k.born < 14),
    setup: (run, h) => { const i = run.kids.findIndex((k) => run.age - k.born >= 5 && run.age - k.born < 14); return { i, fee: 0.6 * h.fee() }; },
    title: (v, h, run) => `${run.kids[v.i].name} got into an expensive school`,
    text: (v, h, run) => `${run.kids[v.i].name} has been offered a place at an international school. It costs ${h.f(v.fee)} a year.`,
    choices: [
      { label: 'Accept', note: 'The best school, the biggest bill', fx: (run, h, v) => { run.kids[v.i].school = 'intl'; h.joy(4); h.trust(4); h.memory('family', `${run.kids[v.i].name} went to an international school`, `You chose the best school at ${run.age}.`, 0, ['family', 'decision']); return 'Uniform bought. Fees paid.'; } },
      { label: 'Apply for a scholarship', note: 'Cheaper if it works', lesson: 'x_ev', fx: (run, h, v) => { if (h.r() < 0.35 + (run.kids[v.i].upSum || 0) / 3) { run.kids[v.i].school = 'good'; run.kids[v.i].scholar = true; h.joy(6); return 'Scholarship granted! Good school, half the fees.'; } return 'No scholarship this time. They stay where they are.'; } },
      { label: 'Choose a cheaper school', note: '', fx: (run, h, v) => { run.kids[v.i].school = 'budget'; h.trust(-2); return 'A decent school closer to home.'; } },
      { label: 'Delay a year', note: 'Decide with more information', lesson: 's_option', fx: (run, h, v) => { h.follow('school_offer', 1, v); return 'They hold the place for a year.'; } },
    ],
  },
  {
    id: 'parent_care', cat: 'Family', cast: 'parent', chapter: ['big', 'protect', 'free'], tags: ['family'], w: 1.2, cond: (run) => run.age >= 38 && !run.flags.parentCare,
    setup: (run) => ({ cost: 0.15 * run.salary }),
    title: (v, h) => `${h.name('parent')} needs care`,
    text: (v, h) => `${h.name('parent')} can't live alone any more. A carer costs ${h.f(v.cost)} a year.`,
    choices: [
      { label: 'Pay for a carer', note: 'For the next few years', fx: (run, h, v) => { h.flag('parentCare', 'paid'); h.costMult(1 + v.cost / Math.max(1, h.costs())); h.rel('parent', { closeness: 10 }); h.rep(4); h.memory('family', `You looked after ${h.name('parent')}`, 'You paid for a carer.', -v.cost * 3, ['family', 'decision']); return 'A kind carer visits every day.'; } },
      { label: 'Move them in', note: 'Cheaper, crowded', fx: (run, h) => { h.flag('parentCare', 'home'); h.joy(run.home && ['house', 'mansion'].includes(run.home.id) ? 2 : -6); h.trust(-3); h.rel('parent', { closeness: 12 }); h.rep(5); return 'The spare room has a new resident.'; } },
      { label: 'Ask siblings to share', note: 'Depends on your family', lesson: 's_repeated', fx: (run, h) => { h.flag('parentCare', 'shared'); if (h.r() < run.rep / 100) { h.rep(2); return 'The family splits it fairly.'; } h.rep(-6); h.costMult(1.04); return 'Nobody else steps up. You end up paying most of it.'; } },
    ],
  },
  {
    id: 'anniversary', cat: 'Partner', cast: null, chapter: null, tags: ['family'], w: (run) => (run.partner && !run.partner.legacy ? 1 : 0),
    setup: (run) => ({ trip: 0.2 * run.salary }),
    title: 'Your anniversary',
    text: (v, h, run) => `${run.partner.name} has been dropping hints about a trip.`,
    choices: [
      { label: (v, h) => `A trip away (${h.f(v.trip)})`, note: '+10 trust, +6 joy', fx: (run, h, v) => { h.cash(-v.trip); h.trust(10); h.joy(6); h.memory('family', 'The anniversary trip', `A trip with ${run.partner.name} at ${run.age}.`, 0, ['family']); return 'Sunsets and long dinners.'; } },
      { label: 'A home-cooked dinner', note: '+4 trust', fx: (run, h) => { h.trust(4); return 'Candles, your best cooking, no phones.'; } },
      { label: 'Forget', note: '−12 trust', fx: (run, h) => { h.trust(-12); return 'You forgot. They did not.'; } },
    ],
  },
  {
    id: 'kid_venture', cat: 'Family', cast: null, chapter: ['protect', 'free'], tags: ['family', 'business'], w: 1.1, cond: (run) => run.kids.some((k) => run.age - k.born >= 22),
    setup: (run) => { const k = run.kids.find((x) => run.age - x.born >= 22); return { name: k.name, amt: 0.5 * run.salary, good: k.outcome === 'helping' ? 0.6 : k.outcome === 'independent' ? 0.45 : 0.25 }; },
    title: (v) => `${v.name} wants to start a business`,
    text: (v, h) => `${v.name} has a plan and asks for ${h.f(v.amt)}.`,
    choices: [
      { label: (v, h) => `Back them (${h.f(v.amt)})`, note: '', need: (run, v) => run.cash >= v.amt, fx: (run, h, v) => { h.cash(-v.amt); if (h.r() < v.good) { h.cash(v.amt * 2); h.memory('family', `${v.name}'s business took off`, 'They paid you back twice over.', v.amt, ['family', 'win']); return 'It works! They pay you back twice over.'; } h.memory('family', `${v.name}'s business closed`, 'You lost the money, but they learned a lot.', -v.amt, ['family']); return 'It didn\'t work. They learned more than any school taught them.'; } },
      { label: 'Give advice and a smaller sum', note: '', fx: (run, h, v) => { h.cash(-v.amt * 0.2); h.joy(2); return 'You back them a little, and meet for coffee every month.'; } },
      { label: 'Say no', note: '', fx: (run, h) => { h.joy(-3); return 'They find another way. It stings a little.'; } },
    ],
  },
  {
    id: 'cautious_advice', cat: 'Friends', cast: 'cautious', chapter: null, tags: ['money'], w: 1,
    title: (v, h) => `${h.name('cautious')} has a question`,
    text: (v, h) => `${h.name('cautious')}: "Can you help me set up a savings plan? You seem to know what you're doing."`,
    choices: [
      { label: 'Spend an evening helping', note: '+4 joy', lesson: 's_repeated', fx: (run, h) => { h.joy(4); h.rel('cautious', { trust: 8, closeness: 6, support: 1 }); h.rep(3); return 'A good evening. They owe you one, they say.'; } },
      { label: 'Send them a link', note: '', fx: (run, h) => { h.rel('cautious', { closeness: -2 }); return 'They say thanks.'; } },
    ],
  },
  {
    id: 'mentor_meet', cat: 'Mentor', cast: 'mentor', chapter: ['start', 'build'], tags: ['career', 'money'], w: 1.2, cond: (run) => !run.flags.mentorMet,
    title: (v, h) => `Coffee with ${h.name('mentor')}`,
    text: (v, h) => `${h.name('mentor')} has seen a few booms and busts. "Want some advice from an old hand?"`,
    choices: [
      { label: 'Listen', note: 'Their tips pay off later', lesson: 'h_mastermind', fx: (run, h) => { h.flag('mentorMet', true); h.rel('mentor', { trust: 10, closeness: 8 }); h.skill(); h.salary(1.05); return '"Pay yourself first. Never sell in a panic. Know what is enough." You write it down.'; } },
      { label: 'Too busy', note: '', fx: (run, h) => { h.flag('mentorMet', 'busy'); return 'Maybe another time.'; } },
    ],
  },
  // ---- Money habits, asked as messages so nobody needs a dashboard to play well.
  {
    id: 'pay_first', cat: 'Money habit', cast: 'mentor', tags: ['money'], w: 0,
    title: 'Pay yourself first',
    text: (v, h) => `${h.name('mentor')}: "Before you spend anything, move a slice of your pay into investments. Set it once and it happens every year, even when you forget."`,
    choices: [
      { label: 'Save 10% of my pay, every year', note: 'Invested for you, automatically', tags: ['investment'], lesson: 'b_purse', fx: (run, h) => { run.plan.pyf = 0.1; h.rel('mentor', { trust: 5 }); h.memory('decision', 'You started paying yourself first', `At ${run.age} you set 10% of your pay to be invested every year.`, 0.1 * run.salary * 3, ['decision', 'investment']); return 'Done. From now on 10% of your pay goes to work before you see it.'; } },
      { label: 'Save 20% of my pay', note: '−3 joy now, grows much faster', tags: ['investment'], lesson: 'p_compound', fx: (run, h) => { run.plan.pyf = 0.2; h.joy(-3); h.rel('mentor', { trust: 8 }); h.memory('decision', 'You started paying yourself first', `At ${run.age} you set 20% of your pay to be invested every year.`, 0.2 * run.salary * 3, ['decision', 'investment']); return 'Bold. A fifth of every pay slip now builds your future.'; } },
      { label: 'Not yet', note: 'Keep all your pay for now', fx: (run, h) => { h.rel('mentor', { trust: -2 }); return '"Maybe next year," you say. Your mentor smiles. They have heard that before.'; } },
    ],
  },
  {
    id: 'idle_cash', cat: 'Your money', cast: 'banker', tags: ['money'], w: 0,
    setup: (run, h) => ({ amt: Math.max(0, run.cash - 0.5 * h.costs()) }),
    title: 'Money sitting idle',
    text: (v, h, run) => `You have ${h.f(run.cash)} in your current account. Prices rise every year, so idle money quietly shrinks. ${h.name('banker')}: "Keep six months of costs safe and put the rest to work?"`,
    choices: [
      { label: (v, h) => `Put ${h.f(v.amt)} in the index fund`, note: 'Grows with the market, can dip', tags: ['investment'], lesson: 'p_compound', fx: (run, h, v) => { const a = h.invest('index', v.amt); h.memory('investment', 'You put idle money to work', `You invested ${h.f(a)} at ${run.age}.`, a * 0.2, ['investment', 'decision']); return 'Your money has a job now.'; } },
      { label: 'Half safe savings, half the fund', note: 'Steadier, grows a bit slower', tags: ['investment'], lesson: 'g_defensive', fx: (run, h, v) => { h.invest('save', v.amt / 2); h.invest('index', v.amt / 2); return 'A cushion and a growth engine. Sensible.'; } },
      { label: 'Keep it as cash', note: 'Ready for anything, loses to rising prices', lesson: 'b_multiply', fx: () => 'It stays where it is. Next year it will buy a little less.' },
    ],
  },
  {
    id: 'raise_plan', cat: 'Money habit', cast: 'mentor', tags: ['money'], w: 1.4, chapter: ['build', 'big'],
    cond: (run) => run.plan.pyf > 0 && run.plan.pyf < 0.2 && !run.flags.retired,
    title: 'Your pay went up',
    text: (v, h, run) => `You now earn ${h.f(run.salary / 12)} a month. ${h.name('mentor')}: "Most people spend every raise. Raise your savings instead and you will not miss it."`,
    choices: [
      { label: 'Save 20% from now on', note: 'Freedom comes years sooner', tags: ['investment'], lesson: 'p_compound', fx: (run, h) => { run.plan.pyf = 0.2; h.memory('decision', 'You saved your raise', `At ${run.age} you raised your savings to 20% of pay.`, 0.1 * run.salary * 3, ['decision', 'investment']); return 'Your future self says thank you.'; } },
      { label: 'Enjoy it', note: '+5 joy', fx: (run, h) => { h.joy(5); return 'A nicer life today. That counts too.'; } },
    ],
  },
];

// Principles for the new ideas, credited to their sources (paraphrased).
export const STRATEGY_BOOK = {
  strategy: { title: 'Game theory and strategy', author: 'Axelrod, Schelling, Dixit & Nalebuff, Spence, Thaler, Kahneman', year: null, color: '#7fe3ff', blurb: 'How other people\'s choices shape yours: cooperation, signals, bargaining, auctions and incentives.' },
};
export const STRATEGY_PRINCIPLES = {
  s_repeated: { book: 'strategy', title: 'The long game', idea: 'When you deal with the same people again and again, be nice first, answer unkindness, and forgive quickly. It beats clever tricks over time. (Axelrod, The Evolution of Cooperation)', game: 'Everyone in your life remembers how you treated them. People you helped are the ones who help you back.' },
  s_signal: { book: 'strategy', title: 'Watch what they risk', idea: 'Words are cheap; putting your own money in is costly. People who believe in a plan are more willing to risk their own savings on it. (Spence, signalling)', game: 'Friends who put their own savings into a venture are more likely to be good at it. The clue is not perfect, but it counts.' },
  s_batna: { book: 'strategy', title: 'Your walk-away power', idea: 'In any negotiation, your strength is the deal you could get if you walked away. Build a good fallback before you ask. (Fisher & Ury, Getting to Yes)', game: 'Asking for a raise works more often when you have months of savings, recent training, and a good year behind you.' },
  s_winners: { book: 'strategy', title: 'The winner\'s curse', idea: 'In a bidding war, the winner is often the person who guessed the value highest, which means they probably overpaid. Decide your price before the auction.', game: 'When you win a bidding war easily, it is often because the flat is worth less than you thought.' },
  s_pd: { book: 'strategy', title: 'The price war trap', idea: 'Two rivals each gain by undercutting the other, but if both do it, both lose. Played again every year, holding steady and answering cuts with cuts keeps prices up. (The prisoner\'s dilemma)', game: 'Your rival remembers your last move. Undercut and they may hit back; hold steady and they often do too.' },
  s_agent: { book: 'strategy', title: 'Pay for results', idea: 'People work for what they are paid for. A manager on a fixed wage gets paid whether profits rise or not; a profit share lines up their interest with yours. (The principal-agent problem)', game: 'A manager on a profit share takes more of the profit, but grows the business more and lets it wear out less.' },
  s_commit: { book: 'strategy', title: 'Tie yourself to the mast', idea: 'Your future self is weaker than you think. Decide in advance and make the good choice automatic. (Thaler, Save More Tomorrow)', game: 'With "pay yourself first" on, your savings have already moved before sale day comes round.' },
  s_sunk: { book: 'strategy', title: 'Sunk costs', idea: 'Money already spent is gone whatever you do next. Decide on the future only: would you invest this sum today if you weren\'t already in?', game: 'Putting more into a struggling venture "to save it" rarely pays. The maths is shown before you choose.' },
  s_option: { book: 'strategy', title: 'The value of waiting', idea: 'Waiting keeps a choice open while you learn more. Sometimes the best move is not to decide yet. (Real options)', game: 'Delaying a purchase or a school choice brings new information next year: the true price, the survey, the scholarship.' },
  s_herd: { book: 'strategy', title: 'The crowd is loudest at the extremes', idea: 'Markets swing between greed and fear, and most people sell near the bottom and buy near the top. (Keynes; Kahneman)', game: 'When everyone around you is selling, prices are usually low, and when everyone is buying, they are usually high.' },
};
