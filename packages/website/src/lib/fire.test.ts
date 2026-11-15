import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_YEARS,
  coastCrossing,
  coastNumber,
  fireNumber,
  monthlyRate,
  planFire,
  project,
  type FireResult,
} from './fire.ts';

function ok(result: FireResult) {
  assert.equal(result.status, 'ok');
  return result as Extract<FireResult, { status: 'ok' }>;
}

const close = (actual: number, expected: number, within = 0.05) =>
  assert.ok(
    Math.abs(actual - expected) <= within,
    `${actual} is not within ${within} of ${expected}`
  );

test('the FIRE number is yearly spending divided by the withdrawal rate', () => {
  assert.equal(fireNumber(40000, 4), 1000000);
  assert.equal(fireNumber(30000, 3), 1000000);
  close(fireNumber(40000, 3.5), 1142857.14, 0.01);
  assert.equal(fireNumber(0, 4), 0);
});

test('the monthly rate compounds to the yearly return', () => {
  close(Math.pow(1 + monthlyRate(5), 12), 1.05, 1e-12);
  assert.equal(monthlyRate(0), 0);
  assert.ok(monthlyRate(-2) < 0);
});

test('with a 0% return the balance only grows by the contributions', () => {
  // 10,000 plus 500 a month reaches 40,000 after 30,000 / 500 = 60 months.
  const plan = ok(planFire(10000, 500, 0, 40000));
  assert.equal(plan.months, 60);
  assert.deepEqual(
    plan.years.map((y) => [y.year, y.contributed, y.growth, y.balance]),
    [
      [1, 6000, 0, 16000],
      [2, 6000, 0, 22000],
      [3, 6000, 0, 28000],
      [4, 6000, 0, 34000],
      [5, 6000, 0, 40000],
    ]
  );
});

test('one year of contributions matches the annuity formula', () => {
  // 1,000 a month at 6% a year. The monthly rate is 1.06^(1/12) - 1 = 0.00486755,
  // and twelve end-of-month payments grow to 1000 · (1.06 - 1) / 0.00486755 =
  // 12,326.53.
  const [year] = project(0, 1000, 6, 1);
  close(year.balance, 12326.53);
  assert.equal(year.contributed, 12000);
  close(year.growth, 326.53);
});

test('a lump sum grows by the yearly return each year', () => {
  const rows = project(100000, 0, 10, 2);
  close(rows[0].balance, 110000);
  close(rows[1].balance, 121000);
});

test('the default example: 35, 80,000 saved, 2,000 a month, 40,000 a year', () => {
  const target = fireNumber(40000, 4);
  const plan = ok(planFire(80000, 2000, 5, target));
  // 19 years and 9 months, so age 54.
  assert.equal(plan.months, 237);
  assert.equal(plan.years.length, 20);
  const last = plan.years[plan.years.length - 1];
  assert.ok(last.balance >= target);
  assert.ok(plan.years[18].balance < target);
  // Coast FIRE at 65: 1,000,000 / 1.05^30.
  close(coastNumber(target, 5, 30), 231377.45, 0.01);
  // The balance passes the shrinking Coast FIRE number in month 91, at 42.
  assert.equal(coastCrossing(80000, 2000, 5, target, 30), 91);
});

test('the table adds up to the headline result', () => {
  const plan = ok(planFire(25000, 1250, 4.5, 600000));
  let balance = 25000;
  for (const year of plan.years) {
    balance = Math.round((balance + year.contributed + year.growth) * 100) / 100;
    assert.equal(year.balance, balance);
  }
  // The number is reached inside the last row's year, not before it.
  assert.equal(plan.years.length, Math.ceil(plan.months / 12));
  assert.ok(plan.years[plan.years.length - 2].balance < 600000);
});

test('savings already at the FIRE number need no plan', () => {
  assert.deepEqual(planFire(1000000, 0, 5, 1000000), { status: 'reached' });
  assert.deepEqual(planFire(500, 100, 5, 0), { status: 'reached' });
});

test('nothing invested and nothing added never reaches the number', () => {
  assert.deepEqual(planFire(0, 0, 5, 1000000), { status: 'never', reason: 'nothing' });
});

test('no contributions and no growth never reaches the number', () => {
  assert.deepEqual(planFire(50000, 0, 0, 1000000), { status: 'never', reason: 'flat' });
  assert.deepEqual(planFire(50000, 0, -1, 1000000), { status: 'never', reason: 'flat' });
});

test('a negative return caps the balance where losses equal contributions', () => {
  const result = planFire(0, 1000, -2, 1000000);
  assert.equal(result.status, 'never');
  assert.equal(result.status === 'never' && result.reason, 'ceiling');
  // 1,000 a month / 0.168% a month ≈ 595,000.
  if (result.status === 'never' && result.reason === 'ceiling') {
    close(result.ceiling, 1000 / -monthlyRate(-2), 0.001);
    assert.ok(result.ceiling > 590000 && result.ceiling < 600000);
  }
  // With a ceiling above the target, the target is still reached.
  assert.equal(planFire(0, 1000, -2, 300000).status, 'ok');
});

test(`plans longer than ${MAX_YEARS} years are cut off`, () => {
  const result = planFire(0, 50, 1, 1000000);
  assert.equal(result.status, 'too-long');
  if (result.status === 'too-long') {
    const [last] = project(0, 50, 1, MAX_YEARS).slice(-1);
    assert.equal(result.balanceAfter, last.balance);
  }
  // A plan of exactly 80 years still counts.
  assert.equal(ok(planFire(0, 100, 0, 96000)).months, MAX_YEARS * 12);
});

test('coast crossing gives the first month, or null when it never happens', () => {
  // Savings already above the Coast FIRE number pass it in the first month.
  assert.equal(coastCrossing(300000, 0, 5, 1000000, 30), 1);
  // No contributions and too little saved never catch up.
  assert.equal(coastCrossing(100000, 0, 5, 1000000, 30), null);
});
