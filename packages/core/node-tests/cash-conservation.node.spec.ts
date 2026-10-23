/**
 * Cash conservation (parity/cash-invariant.mjs) on the scenarios of GitHub
 * #67 / #68 / #69, and metamorphic tests: a transfer between two on-budget
 * accounts of the same kind (card <-> card, cash <-> cash) changes neither Ready
 * to Assign nor the CC Payment total; card -> cash (a cash advance) raises Ready
 * to Assign by exactly the amount and leaves the CC Payment total alone.
 *
 * Open issues are listed in parity/cash-known.mjs. A test that holds the model
 * to the reference for an open issue is expected to fail (it.fails); once the
 * fix merges, delete the key there and these tests become plain tests.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { NodeSqlJsAdapter, ServiceManager, asMilli, type DatabaseAdapter } from '../src';
import { checkCashConservation } from '../parity/cash-invariant.mjs';
import { KNOWN_DEVIATIONS } from '../parity/cash-known.mjs';

type Mode = 'cumulative' | 'monthly';
type Services = ReturnType<ServiceManager['getServices']>;
const MODES: Mode[] = ['cumulative', 'monthly'];

const open = (key: string) => KNOWN_DEVIATIONS.includes(key);
/** it.fails while `key` is an open deviation, it once it is fixed. */
const whileOpen = (key: string) => (open(key) ? it.fails : it);
/** Every open deviation except `key`. */
const allBut = (key: string) => KNOWN_DEVIATIONS.filter((k) => k !== key);

const shiftMonth = (month: string, delta: number) => {
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta;
  const y = Math.floor(total / 12);
  return `${y}-${String(total - y * 12 + 1).padStart(2, '0')}`;
};

interface World {
  adapter: NodeSqlJsAdapter;
  s: Services;
  b: number;
  income: number;
  transfers: number;
  shopping: number;
  other: number;
  checking: number;
  savings: number;
  cardA: number;
  cardB: number;
}

async function world(opts: { cardADebt?: number; income?: number } = {}): Promise<World> {
  const adapter = await NodeSqlJsAdapter.create();
  const sm = new ServiceManager();
  await sm.initialize(adapter as DatabaseAdapter);
  const s = sm.getServices();
  const b = await s.budgets.createBudget({
    name: 'Cash',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: true,
  });
  const cats = s.categories.getAllCategories(b);
  const income = cats.find((c: { Name: string }) => c.Name === 'Income')!.ID;
  const transfers = cats.find((c: { Name: string }) => c.Name === 'Transfers')!.ID;
  const group = s.categories.addCategoryGroup('Spending', b);
  const shopping = s.categories.addCategory(group, b, 'Shopping');
  const other = s.categories.addCategory(group, b, 'Other');
  const acc = (name: string, type: string, balance = 0) =>
    s.accounts
      .createAccount(
        name,
        b,
        type,
        'USD',
        asMilli(balance),
        undefined,
        undefined,
        'Initial Balance',
        '2024-01-01'
      )
      .then((a) => a.ID);
  const checking = await acc('Checking', 'checking');
  const savings = await acc('Savings', 'savings');
  const cardA = await acc('Card A', 'credit', -(opts.cardADebt ?? 0));
  const cardB = await acc('Card B', 'credit');
  await s.transactions.addTransaction(
    asMilli(opts.income ?? 2000),
    asMilli(0),
    checking,
    income,
    b,
    '2024-01-01',
    'pay'
  );
  return { adapter, s, b, income, transfers, shopping, other, checking, savings, cardA, cardB };
}

const spend = (w: World, acc: number, cat: number, amount: number, date: string) =>
  w.s.transactions.addTransaction(asMilli(0), asMilli(amount), acc, cat, w.b, date, 'buy');
const refund = (w: World, acc: number, cat: number, amount: number, date: string) =>
  w.s.transactions.addTransaction(asMilli(amount), asMilli(0), acc, cat, w.b, date, 'refund');
let tseq = 0;
async function transfer(w: World, from: number, to: number, amount: number, date: string) {
  const tid = `cash-test-${++tseq}`;
  await w.s.transactions.addTransaction(
    asMilli(0),
    asMilli(amount),
    from,
    w.transfers,
    w.b,
    date,
    'x',
    tid
  );
  await w.s.transactions.addTransaction(
    asMilli(amount),
    asMilli(0),
    to,
    w.transfers,
    w.b,
    date,
    'x',
    tid
  );
}
const assign = (w: World, cat: number, amount: number, month: string) =>
  w.s.monthlyBudgets.upsertMonthlyAssignment(cat, asMilli(amount), month, w.b);

function monthsOf(w: World): string[] {
  const r = w.adapter
    .prepare(
      `SELECT MIN(m) a, MAX(m) z FROM (SELECT Month m FROM transactions WHERE BudgetID = ?1
         UNION ALL SELECT Month FROM assignments WHERE BudgetID = ?1)`
    )
    .all(w.b)[0] as { a: string; z: string };
  const list: string[] = [];
  for (let m = shiftMonth(r.a, -1); m <= shiftMonth(r.z, 2); m = shiftMonth(m, 1)) list.push(m);
  return list;
}

function withMode<T>(w: World, mode: Mode, f: () => T): T {
  const saved = (
    w.adapter.prepare('SELECT RtaMode FROM budgets WHERE ID = ?').all(w.b)[0] as {
      RtaMode: string;
    }
  ).RtaMode;
  w.adapter.exec(`UPDATE budgets SET RtaMode='${mode}' WHERE ID=${w.b}`);
  try {
    return f();
  } finally {
    w.adapter.exec(`UPDATE budgets SET RtaMode='${saved}' WHERE ID=${w.b}`);
  }
}

function cashCheck(w: World, mode: Mode, known: string[], months = monthsOf(w)) {
  return withMode(w, mode, () => {
    const budget: Record<string, unknown[]> = {};
    for (const m of months) budget[m] = w.s.monthlyBudgets.getMonthlyBudget(m, w.b);
    const map = w.s.monthlyBudgets.getReadyToAssignBreakdownMap(w.b, months);
    const rta = Object.fromEntries(months.map((m) => [m, map.get(m)]));
    return checkCashConservation(
      { adapter: w.adapter },
      w.b,
      months,
      {
        mode,
        budget: budget as never,
        rta: rta as never,
      },
      { known }
    );
  });
}

/** RTA and the sum of CC Payment Available for every month, both modes. */
function observe(w: World, months: string[]) {
  const out: Record<string, { rta: number; pay: number }> = {};
  for (const mode of MODES)
    withMode(w, mode, () => {
      const map = w.s.monthlyBudgets.getReadyToAssignBreakdownMap(w.b, months);
      for (const m of months) {
        const pay = w.s.monthlyBudgets
          .getMonthlyBudget(m, w.b)
          .filter((r: { CategoryGroup: string }) => r.CategoryGroup === 'Credit Card Payments')
          .reduce((t: number, r: { Available: number }) => t + r.Available, 0);
        out[`${mode} ${m}`] = { rta: map.get(m)!.readyToAssign, pay };
      }
    });
  return out;
}

// ------------------------------------------------------------------ scenarios

/** #69: a card B -> card A balance transfer, A's debt from a purchase or an opening balance. */
const issue69 = (['purchase', 'opening'] as const).map((debtVia) => {
  const base = async () => {
    const w = await world({ cardADebt: debtVia === 'opening' ? 1000 : 0 });
    if (debtVia === 'purchase') await spend(w, w.cardA, w.shopping, 1000, '2024-01-10');
    return w;
  };
  const balanceTransfer = (w: World) => transfer(w, w.cardB, w.cardA, 1000, '2024-02-10');
  return {
    name: `#69 card-to-card balance transfer (debt via ${debtVia})`,
    base,
    balanceTransfer,
    build: async () => {
      const w = await base();
      await balanceTransfer(w);
      return w;
    },
  };
});

const issue68 = {
  // funded card purchase, refunded next month, then spent from checking
  B: async () => {
    const w = await world();
    assign(w, w.shopping, 100, '2024-01');
    await spend(w, w.cardA, w.shopping, 100, '2024-01-10');
    await refund(w, w.cardA, w.shopping, 100, '2024-02-10');
    await spend(w, w.checking, w.shopping, 100, '2024-03-10');
    return w;
  },
  // funded purchase refunded next month, then moved out by a negative assignment
  D: async () => {
    const w = await world();
    assign(w, w.shopping, 100, '2024-01');
    await spend(w, w.cardA, w.shopping, 100, '2024-01-10');
    await refund(w, w.cardA, w.shopping, 100, '2024-02-10');
    assign(w, w.shopping, -100, '2024-03');
    assign(w, w.other, 100, '2024-03');
    return w;
  },
  // funded purchase partly refunded in the same month, the rest paid from checking
  sameMonth: async () => {
    const w = await world();
    assign(w, w.shopping, 300, '2024-01');
    await spend(w, w.cardA, w.shopping, 300, '2024-01-10');
    await refund(w, w.cardA, w.shopping, 100, '2024-01-20');
    await transfer(w, w.checking, w.cardA, 200, '2024-02-05');
    return w;
  },
  // side finding: the refund alone (cumulative CC Payment keeps the funding)
  side: async () => {
    const w = await world();
    assign(w, w.shopping, 100, '2024-01');
    await spend(w, w.cardA, w.shopping, 100, '2024-01-10');
    await refund(w, w.cardA, w.shopping, 100, '2024-02-10');
    return w;
  },
};

const controls: { name: string; modes: Mode[]; build: () => Promise<World> }[] = [
  {
    name: '#69 control: card debt, no transfer',
    modes: MODES,
    build: async () => {
      const w = await world();
      await spend(w, w.cardA, w.shopping, 1000, '2024-01-10');
      return w;
    },
  },
  {
    name: '#68 A: refund onto a card owing nothing, spent from checking next month',
    modes: MODES,
    build: async () => {
      const w = await world();
      await refund(w, w.cardA, w.shopping, 100, '2024-01-15');
      await spend(w, w.checking, w.shopping, 100, '2024-02-10');
      return w;
    },
  },
  {
    name: '#68 C: refund onto a card owing nothing, moved out by a negative assignment',
    modes: MODES,
    build: async () => {
      const w = await world();
      await refund(w, w.cardA, w.shopping, 100, '2024-01-15');
      assign(w, w.shopping, -100, '2024-02');
      assign(w, w.other, 100, '2024-02');
      return w;
    },
  },
  {
    name: '#68 control: unfunded credit overspend refunded, then spent from checking',
    modes: ['monthly'],
    build: async () => {
      const w = await world();
      await spend(w, w.cardA, w.shopping, 50, '2024-01-10');
      await refund(w, w.cardA, w.shopping, 50, '2024-02-10');
      await spend(w, w.checking, w.shopping, 50, '2024-03-10');
      return w;
    },
  },
  {
    name: 'funded card purchase partly refunded in the same month, rest paid from checking',
    modes: ['monthly'],
    build: issue68.sameMonth,
  },
];

describe('cash conservation (parity/cash-invariant.mjs)', () => {
  it('catches a perturbed read', async () => {
    const w = await world();
    assign(w, w.shopping, 100, '2024-01');
    await spend(w, w.cardA, w.shopping, 60, '2024-01-10');
    const months = monthsOf(w);
    for (const mode of MODES) {
      expect(cashCheck(w, mode, []).violations).toEqual([]);
      const res = withMode(w, mode, () => {
        const budget: Record<string, { Available: number; CategoryID: number }[]> = {};
        for (const m of months) budget[m] = w.s.monthlyBudgets.getMonthlyBudget(m, w.b);
        const map = w.s.monthlyBudgets.getReadyToAssignBreakdownMap(w.b, months);
        const rta = Object.fromEntries(months.map((m) => [m, map.get(m)]));
        budget[months[1]].find((r) => r.CategoryID === w.shopping)!.Available += 10;
        return checkCashConservation({ adapter: w.adapter }, w.b, months, {
          mode,
          budget: budget as never,
          rta: rta as never,
        });
      });
      expect(
        res.violations.map((v: { month: string; residual: number }) => [v.month, v.residual])
      ).toEqual([[months[1], 10]]);
    }
  });

  for (const c of controls)
    for (const mode of c.modes)
      it(`holds with no tolerated deviation: ${c.name} (${mode})`, async () => {
        const w = await c.build();
        expect(cashCheck(w, mode, []).violations).toEqual([]);
      });

  const failing: { name: string; mode: Mode; key: string; build: () => Promise<World> }[] = [
    ...issue69.flatMap((sc) => MODES.map((mode) => ({ ...sc, mode, key: '#69' }))),
    ...MODES.map((mode) => ({
      name: '#67 cash advance: card -> checking transfer',
      mode,
      key: '#67',
      build: async () => {
        const w = await world();
        await transfer(w, w.cardA, w.checking, 300, '2024-02-10');
        return w;
      },
    })),
    {
      name: '#68 B: funded purchase refunded, then spent from checking',
      mode: 'monthly',
      key: '#68',
      build: issue68.B,
    },
    {
      name: '#68 D: funded purchase refunded, then moved out',
      mode: 'monthly',
      key: '#68',
      build: issue68.D,
    },
    {
      name: '#68 B: funded purchase refunded, then spent from checking',
      mode: 'cumulative',
      key: '#68-cumulative',
      build: issue68.B,
    },
    {
      name: '#68 side: funded purchase refunded',
      mode: 'cumulative',
      key: '#68-cumulative',
      build: issue68.side,
    },
    {
      name: '#68 side: funded purchase partly refunded in the same month',
      mode: 'cumulative',
      key: '#68-cumulative',
      build: issue68.sameMonth,
    },
  ];
  for (const f of failing) {
    whileOpen(f.key)(`holds: ${f.name} (${f.mode}) [${f.key}]`, async () => {
      const w = await f.build();
      expect(cashCheck(w, f.mode, allBut(f.key)).violations).toEqual([]);
    });
    it.runIf(open(f.key))(`the ${f.key} mirror explains ${f.name} (${f.mode})`, async () => {
      const w = await f.build();
      const res = cashCheck(w, f.mode, KNOWN_DEVIATIONS);
      expect(res.violations).toEqual([]);
      expect(res.known.map((k: { key: string }) => k.key)).toContain(f.key);
    });
  }

  // #67, YNAB's documented cash advance ("Inflow from Debt Account"): the money
  // that leaves the card raises RTA, the card's CC Payment stays unfunded.
  for (const mode of MODES)
    whileOpen('#67')(`#67 cash advance follows YNAB (${mode}) [#67]`, async () => {
      const w = await world({ income: 1000 });
      const paypal = (
        await w.s.accounts.createAccount('PayPal', w.b, 'checking', 'USD', asMilli(0))
      ).ID;
      const payA = JSON.parse((w.s.accounts.getAccount(w.cardA).Metadata as string) || '{}')
        .cc_payment_category_id as number;
      const read = () =>
        withMode(w, mode, () => ({
          rta: w.s.monthlyBudgets.getReadyToAssign(w.b, '2024-02'),
          cc: w.s.monthlyBudgets
            .getMonthlyBudget('2024-02', w.b)
            .find((r: { CategoryID: number }) => r.CategoryID === payA)!.Available,
        }));
      await transfer(w, w.cardA, paypal, 100, '2024-02-05');
      expect(read()).toEqual({ rta: asMilli(1100), cc: 0 });
      await spend(w, paypal, w.shopping, 100, '2024-02-06');
      assign(w, w.shopping, 100, '2024-02');
      expect(read().rta).toBe(asMilli(1000));
      assign(w, payA, 100, '2024-02');
      expect(read()).toEqual({ rta: asMilli(900), cc: asMilli(100) });
      expect(cashCheck(w, mode, allBut('#67')).violations).toEqual([]);
    });
});

// ------------------------------------------------------------------ metamorphic

describe('metamorphic: transfers between on-budget accounts', () => {
  const unchanged = (before: ReturnType<typeof observe>, after: ReturnType<typeof observe>) => {
    for (const k of Object.keys(before)) {
      expect(after[k].rta, `${k} Ready to Assign`).toBe(before[k].rta);
      expect(after[k].pay, `${k} sum of CC Payment Available`).toBe(before[k].pay);
    }
  };

  for (const sc of issue69)
    whileOpen('#69')(`${sc.name}: RTA and the CC Payment total stay put [#69]`, async () => {
      const w = await sc.base();
      const months = Array.from({ length: 6 }, (_, i) => shiftMonth('2023-12', i));
      const before = observe(w, months);
      await sc.balanceTransfer(w);
      unchanged(before, observe(w, months));
    });

  // Random small ledgers; the inserted transfer must not move a card's balance
  // above zero (a card's positive balance counts as cash in monthly mode, so
  // moving it to pay another card's debt rightly lowers the envelopes).
  const opArb = fc.oneof(
    fc.record({
      k: fc.constant('spend' as const),
      acc: fc.integer({ min: 0, max: 3 }),
      cat: fc.boolean(),
      m: fc.integer({ min: 0, max: 4 }),
      amt: fc.integer({ min: 1, max: 900 }),
    }),
    fc.record({
      k: fc.constant('assign' as const),
      cat: fc.boolean(),
      m: fc.integer({ min: 0, max: 4 }),
      amt: fc.integer({ min: 0, max: 900 }),
    }),
    fc.record({
      k: fc.constant('pay' as const),
      card: fc.boolean(),
      m: fc.integer({ min: 0, max: 4 }),
      amt: fc.integer({ min: 1, max: 900 }),
    }),
    fc.record({
      k: fc.constant('refund' as const),
      card: fc.boolean(),
      cat: fc.boolean(),
      m: fc.integer({ min: 0, max: 4 }),
      amt: fc.integer({ min: 1, max: 300 }),
    })
  );
  const insertArb = fc.record({
    m: fc.integer({ min: 0, max: 5 }),
    d: fc.integer({ min: 1, max: 28 }),
    amt: fc.integer({ min: 1, max: 600 }),
    forward: fc.boolean(),
  });
  const month = (i: number) => shiftMonth('2024-01', i);
  type Op = typeof opArb extends fc.Arbitrary<infer T> ? T : never;
  async function build(ops: Op[]) {
    const w = await world({ cardADebt: 3000 });
    await spend(w, w.cardB, w.other, 2000, '2024-01-02');
    const accs = [w.checking, w.savings, w.cardA, w.cardB];
    for (const op of ops) {
      const cat = 'cat' in op && op.cat ? w.shopping : w.other;
      if (op.k === 'spend') await spend(w, accs[op.acc], cat, op.amt, `${month(op.m)}-12`);
      else if (op.k === 'assign') assign(w, cat, op.amt, month(op.m));
      else if (op.k === 'pay')
        await transfer(w, w.checking, op.card ? w.cardA : w.cardB, op.amt, `${month(op.m)}-20`);
      else if (op.k === 'refund')
        await refund(w, op.card ? w.cardA : w.cardB, cat, op.amt, `${month(op.m)}-25`);
    }
    return w;
  }
  const maxCardBalance = (w: World) =>
    (
      w.adapter
        .prepare(
          `SELECT MAX(RunningBalanceConverted) v FROM transactions WHERE AccountID IN (?, ?)`
        )
        .all(w.cardA, w.cardB)[0] as { v: number }
    ).v;
  const MONTHS = Array.from({ length: 8 }, (_, i) => shiftMonth('2023-12', i));

  it('cash <-> cash: RTA and the CC Payment total stay put', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { maxLength: 6 }), insertArb, async (ops, ins) => {
        const w = await build(ops);
        try {
          const before = observe(w, MONTHS);
          const [from, to] = ins.forward ? [w.checking, w.savings] : [w.savings, w.checking];
          await transfer(w, from, to, ins.amt, `${month(ins.m)}-${String(ins.d).padStart(2, '0')}`);
          unchanged(before, observe(w, MONTHS));
        } finally {
          w.adapter.close();
        }
      }),
      { numRuns: 15, seed: 6901 }
    );
  }, 60_000);

  whileOpen('#67')(
    'card -> cash: RTA rises by exactly the amount, the CC Payment total stays put [#67]',
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(opArb, { maxLength: 6 }), insertArb, async (ops, ins) => {
          const w = await build(ops);
          try {
            const before = observe(w, MONTHS);
            const from = ins.forward ? w.cardA : w.cardB;
            const to = ins.forward ? w.checking : w.savings;
            const date = `${month(ins.m)}-${String(ins.d).padStart(2, '0')}`;
            await transfer(w, from, to, ins.amt, date);
            fc.pre(maxCardBalance(w) <= 0);
            const after = observe(w, MONTHS);
            for (const k of Object.keys(before)) {
              // monthly RTA moves from the transfer's month on; cumulative is as of today
              const counts = k.startsWith('cumulative') || k.slice(-7) >= month(ins.m);
              expect(after[k].rta, `${k} Ready to Assign`).toBe(
                before[k].rta + (counts ? asMilli(ins.amt) : 0)
              );
              expect(after[k].pay, `${k} sum of CC Payment Available`).toBe(before[k].pay);
            }
          } finally {
            w.adapter.close();
          }
        }),
        { numRuns: 15, seed: 6703 }
      );
    },
    60_000
  );

  whileOpen('#69')(
    'card <-> card: RTA and the CC Payment total stay put [#69]',
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(opArb, { maxLength: 6 }), insertArb, async (ops, ins) => {
          const w = await build(ops);
          try {
            fc.pre(maxCardBalance(w) <= 0);
            const before = observe(w, MONTHS);
            const [from, to] = ins.forward ? [w.cardA, w.cardB] : [w.cardB, w.cardA];
            await transfer(
              w,
              from,
              to,
              ins.amt,
              `${month(ins.m)}-${String(ins.d).padStart(2, '0')}`
            );
            fc.pre(maxCardBalance(w) <= 0);
            unchanged(before, observe(w, MONTHS));
          } finally {
            w.adapter.close();
          }
        }),
        { numRuns: 15, seed: 6902 }
      );
    },
    60_000
  );
});
