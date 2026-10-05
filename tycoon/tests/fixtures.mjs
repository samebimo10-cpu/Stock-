// Shared test fixtures: a plan and a tiny market.
import { emptyMarket } from '../js/market.js';
import { newState } from '../js/model.js';


export function demoMarket() {
  return { ...emptyMarket(), fx: 1500, prices: { 'NGX:DEMO': { p: 50, c: 'NGN', n: 'Demo' } }, closes: {} };
}

export function demoState() {
  const st = newState('NGN');
  st.born = '1994-01';
  st.income = [{ id: 'i', name: 'Salary', amount: 500000 }];
  st.spending = [{ id: 's', name: 'Living', amount: 300000 }];
  st.accounts = [
    { id: 'a', type: 'current', name: 'GTB', value: 200000 },
    { id: 'b', type: 'savings', name: 'T-bills', value: 1000000 },
    { id: 'c', type: 'stock', name: 'Demo', key: 'NGX:DEMO', ex: 'NGX', sym: 'DEMO', shares: 100 },
    { id: 'd', type: 'usd', name: 'Dom account', value: 1000 },
  ];
  st.debts = [{ id: 'x', name: 'Car loan', balance: 800000, rate: 0.25, payment: 40000 }];
  return st;
}
