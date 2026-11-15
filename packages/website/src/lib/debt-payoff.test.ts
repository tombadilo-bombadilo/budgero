import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_MONTHS,
  minimumShortfalls,
  parseAmount,
  planPayoff,
  strategyOrder,
  type Debt,
  type PlanResult,
} from './debt-payoff.ts';

function ok(result: PlanResult) {
  assert.equal(result.status, 'ok');
  return result as Extract<PlanResult, { status: 'ok' }>;
}

test('a single debt matches a hand-computed amortisation', () => {
  // 1,000 at 12% APR (1% a month), 100 a month. Interest by month, rounded to
  // the cent: 10.00, 9.10, 8.19, 7.27, 6.35, 5.41, 4.46, 3.51, 2.54, 1.57,
  // 0.58. After ten payments 58.40 is left; month 11 adds 0.58 and the final
  // payment is 58.98. Closed form: 1000·1.01^10 − 100·(1.01^10 − 1)/0.01 = 58.40.
  const plan = ok(
    planPayoff([{ name: 'Loan', balance: 1000, apr: 12, minPayment: 100 }], 0, 'snowball')
  );
  assert.equal(plan.months, 11);
  assert.deepEqual(
    plan.schedule.map((m) => m.interest),
    [10, 9.1, 8.19, 7.27, 6.35, 5.41, 4.46, 3.51, 2.54, 1.57, 0.58]
  );
  assert.equal(plan.schedule[9].balance, 58.4);
  assert.equal(plan.schedule[10].payment, 58.98);
  assert.equal(plan.totalInterest, 58.98);
  assert.equal(plan.totalPaid, 1058.98);
  assert.deepEqual(plan.payoffOrder, [{ index: 0, name: 'Loan', month: 11 }]);
});

test('zero APR divides the balance by the payment and charges no interest', () => {
  const plan = ok(
    planPayoff([{ name: 'Phone', balance: 1050, apr: 0, minPayment: 100 }], 0, 'avalanche')
  );
  assert.equal(plan.months, 11);
  assert.equal(plan.totalInterest, 0);
  assert.equal(plan.schedule[10].payment, 50);
});

const three: Debt[] = [
  { name: 'Car loan', balance: 6000, apr: 7, minPayment: 180 },
  { name: 'Store card', balance: 800, apr: 22, minPayment: 25 },
  { name: 'Visa', balance: 3500, apr: 24.9, minPayment: 90 },
];

test('snowball targets the smallest balance and avalanche the highest APR', () => {
  assert.deepEqual(strategyOrder(three, 'snowball'), [1, 2, 0]);
  assert.deepEqual(strategyOrder(three, 'avalanche'), [2, 1, 0]);
  // Ties fall back to the other criterion, then to input order.
  const tied: Debt[] = [
    { name: 'A', balance: 500, apr: 10, minPayment: 10 },
    { name: 'B', balance: 500, apr: 20, minPayment: 10 },
    { name: 'C', balance: 300, apr: 20, minPayment: 10 },
    { name: 'D', balance: 300, apr: 20, minPayment: 10 },
  ];
  assert.deepEqual(strategyOrder(tied, 'snowball'), [2, 3, 1, 0]);
  assert.deepEqual(strategyOrder(tied, 'avalanche'), [2, 3, 1, 0]);

  const snowball = ok(planPayoff(three, 200, 'snowball'));
  const avalanche = ok(planPayoff(three, 200, 'avalanche'));
  assert.deepEqual(
    snowball.payoffOrder.map((e) => e.name),
    ['Store card', 'Visa', 'Car loan']
  );
  assert.deepEqual(
    avalanche.payoffOrder.map((e) => e.name),
    ['Visa', 'Store card', 'Car loan']
  );
  // Month 1 of snowball: the store card gets its minimum plus all the extra.
  assert.equal(snowball.schedule[0].debts[1].payment, 225);
  assert.equal(snowball.schedule[0].debts[2].payment, 90);
  assert.ok(avalanche.totalInterest < snowball.totalInterest);
});

test('a cleared debt rolls its minimum, and any leftover that month, to the next target', () => {
  const debts: Debt[] = [
    { name: 'Small', balance: 150, apr: 0, minPayment: 50 },
    { name: 'Big', balance: 1000, apr: 0, minPayment: 50 },
  ];
  const plan = ok(planPayoff(debts, 25, 'snowball'));
  // Month 1: Small gets 50 + 25, Big 50. Month 2: Small owes 75 and gets 75,
  // Big gets 50. Month 3: all 125 goes to Big.
  assert.deepEqual(
    plan.schedule.slice(0, 3).map((m) => m.debts.map((d) => d.payment)),
    [
      [75, 50],
      [75, 50],
      [0, 125],
    ]
  );
  // Leftover in the same month: Small owes 30 in month 1, so 45 of the 75
  // spills over to Big in that month.
  const spill = ok(planPayoff([{ ...debts[0], balance: 30 }, debts[1]], 25, 'snowball'));
  assert.deepEqual(
    spill.schedule[0].debts.map((d) => d.payment),
    [30, 95]
  );
  // Every month spends the whole budget except the last.
  for (const month of plan.schedule.slice(0, -1)) assert.equal(month.payment, 125);
  assert.equal(plan.totalPaid, 1150);
  assert.equal(plan.months, 10);
});

test('a debt whose payments do not cover the interest is never paid off', () => {
  // 10,000 at 24% adds 200 of interest in the first month; 150 falls 50 short.
  const debts: Debt[] = [{ name: 'Card', balance: 10000, apr: 24, minPayment: 150 }];
  assert.deepEqual(planPayoff(debts, 0, 'avalanche'), {
    status: 'never',
    monthlyPayment: 150,
    monthlyInterest: 200,
    shortBy: 50,
  });
  // Paying exactly the interest never lowers the balance either.
  const flat = planPayoff(debts, 50, 'avalanche');
  assert.equal(flat.status, 'never');
  assert.equal(flat.status === 'never' && flat.shortBy, 0);
  assert.deepEqual(minimumShortfalls(debts), [
    { index: 0, name: 'Card', interest: 200, minPayment: 150, shortBy: 50 },
  ]);
  // Extra money can still clear it, and the shortfall stays a warning.
  assert.equal(planPayoff(debts, 300, 'avalanche').status, 'ok');
});

test('plans longer than fifty years stop at the limit', () => {
  // 100,000 at 6% (500 a month interest) paid at 501 a month.
  const result = planPayoff(
    [{ name: 'Mortgage', balance: 100000, apr: 6, minPayment: 501 }],
    0,
    'snowball'
  );
  assert.equal(result.status, 'too-long');
  assert.ok(result.status === 'too-long' && result.balanceAfter > 0);
  assert.equal(MAX_MONTHS, 600);
});

test('empty, zero, negative and invalid rows are left out of the plan', () => {
  assert.deepEqual(planPayoff([], 100, 'snowball'), { status: 'empty' });
  const bad: Debt[] = [
    { name: 'Blank', balance: Number.NaN, apr: 10, minPayment: 10 },
    { name: 'Paid', balance: 0, apr: 10, minPayment: 10 },
    { name: 'Negative', balance: -50, apr: 10, minPayment: 10 },
    { name: 'Negative APR', balance: 50, apr: -1, minPayment: 10 },
  ];
  assert.deepEqual(planPayoff(bad, 100, 'snowball'), { status: 'empty' });
  const mixed = ok(
    planPayoff([...bad, { name: 'Real', balance: 100, apr: 0, minPayment: 10 }], 0, 'snowball')
  );
  assert.deepEqual(mixed.payoffOrder, [{ index: 4, name: 'Real', month: 10 }]);
  // A negative extra amount counts as no extra.
  assert.equal(
    ok(planPayoff([{ name: 'Real', balance: 100, apr: 0, minPayment: 10 }], -40, 'snowball'))
      .months,
    10
  );
  assert.deepEqual(
    planPayoff([{ name: 'Free', balance: 100, apr: 0, minPayment: 0 }], 0, 'snowball'),
    {
      status: 'no-payment',
      balance: 100,
    }
  );
});

test('avalanche never costs more interest than snowball', () => {
  let seed = 42;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  let compared = 0;
  for (let run = 0; run < 400; run++) {
    const debts: Debt[] = Array.from({ length: 2 + Math.floor(random() * 5) }, (_, i) => {
      const balance = Math.round(100 + random() * 20000);
      return {
        name: `Debt ${i + 1}`,
        balance,
        apr: Math.round(random() * 3000) / 100,
        minPayment: Math.round(balance * (0.01 + random() * 0.04)),
      };
    });
    const extra = Math.round(random() * 500);
    const snowball = planPayoff(debts, extra, 'snowball');
    const avalanche = planPayoff(debts, extra, 'avalanche');
    if (snowball.status !== 'ok' || avalanche.status !== 'ok') continue;
    compared += 1;
    assert.ok(
      avalanche.totalInterest <= snowball.totalInterest,
      `run ${run}: avalanche ${avalanche.totalInterest} > snowball ${snowball.totalInterest}`
    );
    assert.ok(avalanche.months <= snowball.months + 1);
  }
  assert.ok(compared > 300);
});

test('typed amounts accept either decimal separator', () => {
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('  '), null);
  assert.equal(parseAmount('1250'), 1250);
  assert.equal(parseAmount('1250.5'), 1250.5);
  assert.equal(parseAmount('1250,5'), 1250.5);
  assert.equal(parseAmount('1,250.50'), 1250.5);
  assert.equal(parseAmount('1.250,50'), 1250.5);
  assert.equal(parseAmount('1 250,50'), 1250.5);
  assert.equal(parseAmount("1'250.50"), 1250.5);
  assert.equal(parseAmount('1,000,000'), 1000000);
  assert.equal(parseAmount('19.9%'), 19.9);
  // One separator and three digits after it follows the visitor's locale.
  assert.equal(parseAmount('1,250', '.'), 1250);
  assert.equal(parseAmount('1,250', ','), 1.25);
  assert.equal(parseAmount('1.250', ','), 1250);
  assert.equal(parseAmount('-20'), -20);
  assert.ok(Number.isNaN(parseAmount('abc')));
  assert.ok(Number.isNaN(parseAmount('12a')));
  assert.ok(Number.isNaN(parseAmount('1.2.3,4.5')));
  assert.ok(Number.isNaN(parseAmount('.')));
});
