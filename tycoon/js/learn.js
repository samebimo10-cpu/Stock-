// The learning layer: the books behind the game, their principles, the moments
// in play that teach each one, the mentor quizzes, and the investment plans.
//
// Every principle here is paraphrased in our own words and credited to its
// book. The one short line quoted directly comes from The Richest Man in
// Babylon (1926), which is in the public domain.

export const BOOKS = {
  babylon: { title: 'The Richest Man in Babylon', author: 'George S. Clason', year: 1926, color: '#ffc53d', blurb: 'Parables about the "seven cures for a lean purse": save first, spend less, invest, avoid loss.' },
  richdad: { title: 'Rich Dad Poor Dad', author: 'Robert Kiyosaki', year: 1997, color: '#3ddc97', blurb: 'Assets feed you, liabilities eat you. Build income that doesn\'t need your hours and leave the rat race.' },
  graham: { title: 'The Intelligent Investor', author: 'Benjamin Graham', year: 1949, color: '#5cc8ff', blurb: 'Mr. Market, margin of safety, and the calm, rules-based defensive investor.' },
  hill: { title: 'Think and Grow Rich', author: 'Napoleon Hill', year: 1937, color: '#ff9f43', blurb: 'A definite aim, an organised plan, specialised knowledge and persistence.' },
  housel: { title: 'The Psychology of Money', author: 'Morgan Housel', year: 2020, color: '#ff7ad9', blurb: 'Behaviour beats brilliance: time, room for error, and knowing when you have enough.' },
  prob: { title: 'Thinking in probabilities', author: 'Bayes, Kelly, Tetlock (Superforecasting), Duke (Thinking in Bets), Kahneman', year: null, color: '#b69cff', blurb: 'Base rates, updating on evidence, calibration, expected value and bet sizing.' },
};

// game: where the idea lives in the rules, so the player can see it working.
export const PRINCIPLES = {
  b_purse: { book: 'babylon', title: 'Start thy purse to fattening', idea: '"A part of all you earn is yours to keep." Put aside at least a tenth of every payment before you pay anyone else.', game: 'Set "Pay yourself first". That share of your pay is invested before living costs are paid. Cure 1 lights up in any year you keep 10% or more.' },
  b_control: { book: 'babylon', title: 'Control thy expenditures', idea: 'Spending grows to swallow any income unless you budget. Separate what you need from what you merely want.', game: 'Cure 2 lights up while your living costs stay under 75% of your pay. Every lifestyle step raises costs and your Freedom Number.' },
  b_multiply: { book: 'babylon', title: 'Make thy gold multiply', idea: 'Saved money should be put to work, so each coin brings back more coins that also go to work.', game: 'Cure 3 lights up while at least 60% of your wealth sits in things that earn. Idle cash loses value to inflation.' },
  b_guard: { book: 'babylon', title: 'Guard thy treasures from loss', idea: 'Keeping your principal safe comes before chasing a big return. Take advice from people experienced with money, not from the eager.', game: 'Cure 4 goes dark in a year you lose money to a scam, run into debt, or have over 60% of your investments in one asset.' },
  b_home: { book: 'babylon', title: 'Make of thy dwelling a profitable investment', idea: 'Owning where you live, or property that pays rent, turns a cost into an asset.', game: 'Cure 5 lights up once you own property. Rent is paid to you every year.' },
  b_future: { book: 'babylon', title: 'Insure a future income', idea: 'Provide now for the years when you can no longer work, and for your family if you are gone.', game: 'Cure 6 lights up when passive income covers at least a fifth of your costs.' },
  b_earn: { book: 'babylon', title: 'Increase thy ability to earn', idea: 'Study and grow more skilful. The more you know, the more you can earn.', game: 'Cure 7 stays lit for 6 years after you upskill: a course, a promotion, a side hustle.' },

  r_assets: { book: 'richdad', title: 'Assets put money in your pocket', idea: 'An asset pays you; a liability costs you. The rich buy assets. Most people buy liabilities they think are assets.', game: 'Tap your net worth to see your statement: income, expenses, assets and liabilities.' },
  r_ratrace: { book: 'richdad', title: 'Get out of the rat race', idea: 'While your expenses need your salary, you run in the race. When passive income beats expenses, you are out.', game: 'This is the win condition: passive income at least as big as your living costs.' },
  r_house: { book: 'richdad', title: 'Your house may not be an asset', idea: 'If a property costs more each month than it brings in, it is a liability, whatever the bank calls it.', game: 'A property counts as an asset in your statement only when its rent beats its mortgage interest.' },
  r_quadrant: { book: 'richdad', title: 'The cashflow quadrant', idea: 'Income comes as an Employee, Self-employed, Business owner or Investor. Only B and I keep paying when you stop working.', game: 'Your statement shows your income split across E, S, B and I. Hire a manager to move a business from S to B.' },
  r_doodads: { book: 'richdad', title: 'Doodads', idea: 'Raises spent on bigger houses, cars and gadgets raise expenses, so you need the salary even more.', game: 'Lifestyle upgrades add joy but raise your costs, and with them the Freedom Number you have to reach.' },

  g_mrmarket: { book: 'graham', title: 'Mr. Market', idea: 'Picture the market as a moody partner who offers a price every day. You may ignore him. Use his panics; never catch them.', game: 'The Index card shows his price against fair value. After crashes he sells cheap; in manias he charges too much.' },
  g_margin: { book: 'graham', title: 'Margin of safety', idea: 'Buy well below what something is worth, so that errors and bad luck still leave you whole.', game: 'Returns in this game drift back toward fair value, so buying below value really does pay more later.' },
  g_investor: { book: 'graham', title: 'Investor or speculator', idea: 'Investing means careful analysis, safety of principal and a reasonable return. Anything else is speculation.', game: 'Crypto hype, "guaranteed" clubs and tips promise the return without the analysis or the safety.' },
  g_defensive: { book: 'graham', title: 'The defensive investor', idea: 'Keep between a quarter and three quarters in stocks, the rest in safe bonds, and rebalance back to your mix.', game: 'Choose a Defensive, Balanced or Growth plan (25%, 50% or 75% index) and switch on Rebalance.' },
  g_euphoria: { book: 'graham', title: 'Price is what you pay', idea: 'A great business bought at a silly price is a poor investment. Expensive markets deliver lower returns afterwards.', game: 'When Mr. Market asks more than 1.25× fair value, future index returns are lower on average.' },

  h_aim: { book: 'hill', title: 'A definite chief aim', idea: 'Decide exactly what you want and by when, write it down, and read it often.', game: 'You set a freedom age at the start. Reaching freedom by it earns a large bonus.' },
  h_plan: { book: 'hill', title: 'Organised planning', idea: 'A goal without a plan is a wish. Build a plan and follow it until it needs changing.', game: 'Your plan (pay yourself first, mix, rebalance) runs automatically every year, even when you are busy or scared.' },
  h_persist: { book: 'hill', title: 'Persistence', idea: 'Most people give up at the first setback. Those who keep going reach what quitters never see.', game: 'Holding your investments through crashes lets you collect the recoveries that follow.' },
  h_knowledge: { book: 'hill', title: 'Specialised knowledge', idea: 'General knowledge is common; organised, specialised knowledge, put to use, is what earns.', game: 'Courses and promotions raise your pay for the rest of the run.' },
  h_mastermind: { book: 'hill', title: 'The mastermind', idea: 'Surround yourself with people who share your aim and know more than you. Their minds add to yours.', game: 'Mentor quizzes and the mentor event reward you for learning from others.' },

  p_compound: { book: 'housel', title: 'Time is the engine', idea: 'Most of a fortune from compounding arrives late. The trick is to never interrupt it.', game: 'Watch the chart: net worth curves upwards in later years if you stay invested.' },
  p_room: { book: 'housel', title: 'Room for error', idea: 'Plan on some plans failing. A buffer of savings keeps you in the game long enough for the odds to work.', game: 'With a year of costs in savings, bills cost less and never push you into debt.' },
  p_enough: { book: 'housel', title: 'Enough', idea: 'If expectations rise with results, you never feel rich. Knowing what is enough is a skill.', game: 'Every lifestyle step moves the finish line further away.' },
  p_tails: { book: 'housel', title: 'Tails drive everything', idea: 'A few rare outcomes deliver most of the results. You can be wrong often and still win if the wins are big.', game: 'Startups mostly fail, but one hit can pay 12×. Size those bets so the misses don\'t hurt.' },

  x_base: { book: 'prob', title: 'Start with the base rate', idea: 'Before looking at the details, ask how often this kind of thing happens in general. Then adjust. (Superforecasting)', game: 'The lens shows how often each market mood followed the last one.' },
  x_bayes: { book: 'prob', title: 'Update on evidence', idea: 'New evidence should move your odds in proportion to how reliable it is. Weak evidence moves you a little, strong evidence a lot. (Bayes)', game: 'Each mood headline is right 80% of the time. The lens multiplies the base rate by that evidence.' },
  x_calib: { book: 'prob', title: 'Calibration', idea: 'When you say 70%, it should happen about 7 times in 10. The Brier score measures this: 0 is perfect, 0.25 is a coin flip. (Superforecasting)', game: 'Every forecast you make is scored. Your results show your calibration.' },
  x_bets: { book: 'prob', title: 'Decisions are not outcomes', idea: 'A good decision can turn out badly and a bad one well. Judge a choice by what you knew when you made it. (Thinking in Bets)', game: 'The review compares your forecast to the careful answer, not just to what happened.' },
  x_ev: { book: 'prob', title: 'Expected value', idea: 'Weigh every outcome by its chance and add them up. Take bets whose average beats their cost.', game: 'Tap "Show the maths" on risky choices to see the expected value.' },
  x_kelly: { book: 'prob', title: 'Size your bets (Kelly)', idea: 'Even a bet in your favour can ruin you if it is too big. The Kelly rule gives the share of wealth that grows fastest; many experts bet half of it.', game: 'The maths panel shows the Kelly share next to what the choice asks you to risk.' },
  x_overconf: { book: 'prob', title: 'Overconfidence', idea: 'Most people are too sure of themselves. Things they call 90% certain happen far less often. (Kahneman)', game: 'Forecasts of 10% or 90% that miss cost you a lot on the Brier score.' },
};

// Moments: what just happened, the lesson it teaches, and which principle it
// comes from. {x} and {y} are filled in by the engine.
export const MOMENTS = {
  held_crash: { p: 'g_mrmarket', text: 'A crash hit and you held on. Mr. Market was panicking and offering low prices. You simply didn\'t sell to him, so your losses are still only on paper.' },
  sold_panic: { p: 'g_mrmarket', text: 'You sold close to a crash, when Mr. Market was at his most fearful. That turned a temporary fall into a permanent loss.' },
  mos_buy: { p: 'g_margin', text: 'You bought while prices were {x} below fair value. That gap is your margin of safety, and it tends to pay you back as prices return to value.' },
  euphoric_buy: { p: 'g_euphoria', text: 'You bought at {x} above fair value while Mr. Market was euphoric. Expensive starting prices mean lower returns afterwards.' },
  pyf_on: { p: 'b_purse', text: 'You paid yourself {x} before paying for anything else. "A part of all you earn is yours to keep."' },
  pyf_off: { p: 'b_purse', text: 'Nothing went to you first this year. Arkad\'s first rule is to keep at least a tenth before paying anyone else. Set "Pay yourself first" in your plan.' },
  pyf_short: { p: 'b_control', text: 'Your plan wanted {x} more than was left after living costs, so it invested less. Pay yourself first means living on the rest: cut your lifestyle until the plan fits.' },
  life_up: { p: 'r_doodads', text: 'You raised your lifestyle. Enjoy it, but know the cost: your Freedom Number just rose to {x}.' },
  idle_cash: { p: 'b_multiply', text: '{x} sat idle in cash and inflation ate {y} of it. Gold that is not working does not grow.' },
  scam_loss: { p: 'b_guard', text: 'Money went to a scam. Guard your treasure: if a return is guaranteed and high, walk away and ask someone who has handled money well.' },
  house_asset: { p: 'r_house', text: 'Your property brings in {x} a year more than its mortgage costs. By Rich Dad\'s test, it is an asset.' },
  house_liab: { p: 'r_house', text: 'Your mortgage interest is {x} a year more than the rent. By Rich Dad\'s test this property is a liability, for now.' },
  manager: { p: 'r_quadrant', text: 'With a manager, your business moved from the S quadrant (you work it) to B (it works for you).' },
  half_free: { p: 'r_ratrace', text: 'Passive income now covers half your costs. You are halfway out of the rat race.' },
  conc_loss: { p: 'p_room', text: 'A single asset took a big bite out of your wealth. Spread your money so that no one loss can sink you.' },
  overconf: { p: 'x_overconf', text: 'You were {x} sure and it went the other way. Extreme forecasts should be rare, and saved for strong evidence.' },
  good_calib: { p: 'x_calib', text: 'Your forecast was within 10 points of the careful answer. That is calibrated thinking.' },
  good_call_bad_luck: { p: 'x_bets', text: 'Your forecast matched the evidence, but the unlikely side came up. That was a good decision with a bad outcome. Keep making it.' },
  lucky_call: { p: 'x_bets', text: 'You got the direction right, but the evidence pointed the other way. Don\'t learn from luck. Learn from the reasoning.' },
  rare_crash: { p: 'x_base', text: 'A crash came when the base rate gave it only {x}. Unlikely is not impossible, which is why you keep room for error.' },
  compound: { p: 'p_compound', text: 'Your investments are now worth more than {x} years of pay. From here, growth starts to outrun your savings.' },
  persist: { p: 'h_persist', text: 'You have held through {x} crashes without selling. That persistence is what collects the recoveries.' },
  rebalance: { p: 'g_defensive', text: 'Your plan rebalanced: it sold {x} of index after the rise and parked it safely, keeping you inside your mix.' },
  rebalance_buy: { p: 'g_defensive', text: 'Your plan rebalanced: it bought {x} of index after the fall, buying low without having to be brave.' },
  debt: { p: 'r_assets', text: 'You are borrowing at {x} a year. Debt is a liability that grows faster than almost any asset.' },
  aim_near: { p: 'h_aim', text: 'Five years to your chief aim of freedom by {x}. You are {y} of the way there.' },
  base_intro: { p: 'x_base', text: 'Before reading headlines, ask how often each mood happens. That is the base rate, shown in the lens.' },
  bayes_intro: { p: 'x_bayes', text: 'Headlines moved the odds. A mood headline is right 80% of the time, so the lens multiplies each base rate by how well it fits the headlines.' },
  plan_started: { p: 'h_plan', text: 'Your plan now runs by itself every year. Good plans work because they don\'t depend on your mood.' },
  all_cures: { p: 'b_future', text: 'All seven cures are lit at once. Arkad would call your purse fat. (+10 joy)' },
};

export const PLANS = {
  defensive: { name: 'Defensive', index: 0.25, blurb: '25% index, 75% savings. Graham\'s most cautious mix.' },
  balanced: { name: 'Balanced', index: 0.5, blurb: '50% index, 50% savings. Graham\'s default.' },
  growth: { name: 'Growth', index: 0.75, blurb: '75% index, 25% savings. Graham\'s upper limit.' },
};

export const AIMS = [40, 45, 50, 55];

// Mentor quizzes: one every few years in the Wisdom Journey.
export const QUIZ = [
  { p: 'b_purse', q: 'Arkad\'s first rule says to keep what share of your earnings before spending?', opts: ['Nothing, invest what is left', 'At least a tenth', 'Half', 'Whatever is left at the end of the month'], a: 1, why: 'At least one coin in ten goes to you first. Saving what is "left over" usually means saving nothing.' },
  { p: 'r_assets', q: 'By Rich Dad\'s definition, what is an asset?', opts: ['Anything expensive you own', 'Something that puts money in your pocket', 'Your car', 'Your house, always'], a: 1, why: 'Assets pay you. A car or an expensive house usually takes money out every month.' },
  { p: 'g_mrmarket', q: 'Mr. Market offers to buy your index fund 30% below its fair value, in a panic. Graham would...', opts: ['Sell before it falls further', 'Ignore him, or buy more from him', 'Borrow money to sell', 'Switch to crypto'], a: 1, why: 'His price is an offer, not an order. Panics are when a patient investor buys.' },
  { p: 'g_margin', q: 'What is a margin of safety?', opts: ['Insurance on your property', 'Buying well below estimated value', 'Keeping cash in two banks', 'A limit on daily losses'], a: 1, why: 'The gap between price and value absorbs your mistakes and bad luck.' },
  { p: 'x_calib', q: 'You said "90% likely" ten times and it happened six times. You are...', opts: ['Well calibrated', 'Overconfident', 'Underconfident', 'Just unlucky'], a: 1, why: 'Things you call 90% should happen about 9 times in 10. Six means your 90s were really about 60s.' },
  { p: 'x_calib', q: 'Someone always forecasts 50%. What is their Brier score?', opts: ['0', '0.25', '0.5', '1'], a: 1, why: 'Every outcome is 0.5 away, and 0.5² = 0.25. Beating 0.25 means you know more than a coin.' },
  { p: 'x_ev', q: 'A bet: 50% chance your stake doubles, 50% you lose it. What is the expected gain on ₦100?', opts: ['₦0', '₦50', '−₦100', '₦25'], a: 0, why: '0.5 × ₦200 + 0.5 × ₦0 = ₦100, exactly what you paid. Expected gain: zero.' },
  { p: 'x_kelly', q: 'An even-money bet (win doubles your stake) with a 60% chance to win. Kelly says bet what share of your wealth?', opts: ['60%', '20%', '10%', 'Nothing'], a: 1, why: 'For even money, Kelly = 2p − 1 = 2 × 0.6 − 1 = 20%. Many pros bet half that.' },
  { p: 'x_base', q: 'In this game, how often does an Overheating period lead straight into a Crash?', opts: ['About 10%', 'About 25%', 'About 55%', 'About 90%'], a: 2, why: 'Overheating ends in a crash 55% of the time. That is why buying at euphoric prices is dangerous.' },
  { p: 'h_aim', q: 'Think and Grow Rich puts which step first?', opts: ['Waiting for a lucky break', 'A definite aim with a date', 'Borrowing capital', 'Quitting your job'], a: 1, why: 'Hill starts with a clear, written goal with a deadline. Everything else serves it.' },
  { p: 'g_defensive', q: 'Graham\'s defensive investor keeps stocks between...', opts: ['0% and 10%', '25% and 75%', '90% and 100%', 'Exactly 60%'], a: 1, why: 'Never below a quarter, never above three quarters, and rebalance back to your mix.' },
  { p: 'b_multiply', q: 'Inflation is 18% and your savings pay 13%. Your real return is roughly...', opts: ['+13%', '+5%', '−5%', '0%'], a: 2, why: 'Real return ≈ interest − inflation = 13% − 18% = −5%. Your money is quietly shrinking.' },
  { p: 'r_ratrace', q: 'Under the 4% rule, investments of how many years of costs set you free?', opts: ['4', '10', '25', '100'], a: 2, why: '4% of 25 × costs = 1 × costs. That is the Freedom Number.' },
  { p: 'x_bets', q: 'You researched a sound investment carefully and it lost money anyway. Thinking in Bets says...', opts: ['It was a bad decision', 'Judge it by what you knew at the time', 'Never invest again', 'Double your stake to win it back'], a: 1, why: 'Outcomes include luck. A good process sometimes loses; repeated, it wins.' },
  { p: 'b_guard', q: 'Which is the strongest sign of a scam?', opts: ['Returns that go up and down', 'Guaranteed high returns and pressure to act now', 'A regulated broker', 'Fees shown upfront'], a: 1, why: 'Real investments carry risk. "Guaranteed", "high" and "today only" together is the classic pattern.' },
  { p: 'p_compound', q: 'Housel says the biggest driver of compounding is...', opts: ['Very high returns', 'Time, without interruption', 'Luck', 'Borrowed money'], a: 1, why: 'Modest returns over a long, unbroken stretch beat high returns that get interrupted.' },
  { p: 'r_doodads', q: 'Rich Dad\'s word for raises spent on toys and upgrades is...', opts: ['Assets', 'Doodads', 'Dividends', 'Equity'], a: 1, why: 'Doodads feel like rewards but raise your expenses and keep you in the rat race.' },
  { p: 'p_room', q: 'Why keep a year of costs in savings?', opts: ['It earns the highest return', 'So a surprise bill doesn\'t force you to sell or borrow', 'Banks require it', 'To pay less tax'], a: 1, why: 'Room for error keeps you from selling at the bottom or borrowing at high rates.' },
  { p: 'x_overconf', q: 'Most people who say they are 90% sure turn out right about...', opts: ['99% of the time', '90% of the time', 'Much less often, often 70–80%', 'Half the time'], a: 2, why: 'Overconfidence is one of the most reliable findings in psychology. Widen your ranges.' },
  { p: 'h_persist', q: 'Your index fund fell 30% in a crash. Historically in this game, holding on has...', opts: ['Usually led to a recovery', 'Always meant more losses', 'Made no difference', 'Only worked with crypto'], a: 0, why: 'Crashes are followed by Recovery about 68% of the time here. Persistence collects the rebound.' },
];
