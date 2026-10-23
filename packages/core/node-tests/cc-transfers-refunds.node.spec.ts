/**
 * #69 (transfers between on-budget debt accounts are not card payments) and
 * #68 (a refund taken back out of a CC Payment category is cash for the
 * category that received it), in both RTA modes and on both read paths: every
 * read runs through the budget snapshot with verify on (recomputed by the full
 * queries and compared) and is compared again with the snapshot switched off.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  NodeSqlJsAdapter,
  ServiceManager,
  asMilli,
  configureBudgetSnapshot,
  getBudgetSnapshotStore,
  type DatabaseAdapter,
  type Services,
} from '../src';
import { firstDifference } from '../src/services/monthly-budgets/snapshot/compare.js';
import { checkZeroBasedIdentity } from '../parity/invariant.mjs';

type Mode = 'cumulative' | 'monthly';
const MONTHS = ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05'];

interface Ctx {
  adapter: DatabaseAdapter;
  s: Services;
  b: number;
  chk: number;
  card: number;
  card2: number;
  transfers: number;
  income: number;
  group: number;
}

async function setup(): Promise<Ctx> {
  const adapter = await NodeSqlJsAdapter.create();
  const sm = new ServiceManager();
  await sm.initialize(adapter);
  const s = sm.getServices();
  const b = await s.budgets.createBudget({
    name: 'CC',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: true,
  });
  const cats = s.categories.getAllCategories(b);
  const income = cats.find((c) => c.Name === 'Income')!.ID;
  const transfers = cats.find((c) => c.Name === 'Transfers')!.ID;
  const group = s.categories.addCategoryGroup('Spending', b);
  const mk = async (name: string, type: string, onBudget?: boolean) =>
    (await s.accounts.createAccount(name, b, type, 'USD', asMilli(0), undefined, onBudget)).ID;
  const chk = await mk('Checking', 'checking');
  const card = await mk('Card', 'credit');
  const card2 = await mk('Card 2', 'credit');
  await s.transactions.addTransaction(
    asMilli(1000),
    asMilli(0),
    chk,
    income,
    b,
    '2024-01-01',
    'pay'
  );
  return { adapter, s, b, chk, card, card2, transfers, income, group };
}

const category = (c: Ctx, name: string) => c.s.categories.addCategory(c.group, c.b, name);
const assign = (c: Ctx, cat: number, amount: number, month: string) =>
  c.s.monthlyBudgets.upsertMonthlyAssignment(cat, asMilli(amount), month, c.b);
const tx = (c: Ctx, account: number, cat: number, amount: number, date: string, tid = '') =>
  c.s.transactions.addTransaction(
    asMilli(Math.max(0, amount)),
    asMilli(Math.max(0, -amount)),
    account,
    cat,
    c.b,
    date,
    'memo',
    tid
  );
async function transfer(
  c: Ctx,
  from: number,
  to: number,
  amount: number,
  date: string,
  tid: string
) {
  await tx(c, from, c.transfers, -amount, date, tid);
  await tx(c, to, c.transfers, amount, date, tid);
}
const paymentCategoryOf = (c: Ctx, card: number) =>
  JSON.parse(c.s.accounts.getAccount(card).Metadata || '{}').cc_payment_category_id as number;
const idOf = (c: Ctx, sql: string) => (c.adapter.prepare(sql).get() as { ID: number }).ID;

function setMode(c: Ctx, mode: Mode) {
  c.adapter.exec(`UPDATE budgets SET RtaMode='${mode}' WHERE ID=${c.b}`);
}

function readAll(c: Ctx, mode: Mode) {
  setMode(c, mode);
  const budget: Record<string, ReturnType<Services['monthlyBudgets']['getMonthlyBudget']>> = {};
  const rta: Record<
    string,
    ReturnType<Services['monthlyBudgets']['getReadyToAssignBreakdown']>
  > = {};
  for (const m of MONTHS) {
    budget[m] = c.s.monthlyBudgets.getMonthlyBudget(m, c.b);
    rta[m] = c.s.monthlyBudgets.getReadyToAssignBreakdown(c.b, m);
  }
  return { mode, budget, rta };
}

/**
 * Reads of one mode through the snapshot (verify on), checked equal to the
 * full queries and against the zero-based identity.
 */
function reads(c: Ctx, mode: Mode) {
  const store = getBudgetSnapshotStore(c.adapter)!;
  const fallbacks = store.stats.fallbacks;
  const snap = readAll(c, mode);
  expect(store.stats.fallbacks, 'every read used the snapshot').toBe(fallbacks);
  configureBudgetSnapshot({ enabled: false });
  try {
    expect(firstDifference(readAll(c, mode), snap)).toBeNull();
  } finally {
    configureBudgetSnapshot({ enabled: true });
  }
  expect(checkZeroBasedIdentity(c, c.b, MONTHS, snap)).toEqual([]);
  const avail = (m: string, cat: number) =>
    snap.budget[m].find((r) => r.CategoryID === cat)?.Available ?? 0;
  return { ...snap, avail };
}

beforeAll(() => configureBudgetSnapshot({ enabled: true, verify: true }));
afterAll(() => configureBudgetSnapshot({ enabled: undefined, verify: undefined }));

describe('#69: transfers from another debt account are not card payments', () => {
  for (const mode of ['cumulative', 'monthly'] as Mode[]) {
    it(`[${mode}] card, loan and split-mirror balance transfers leave payment categories alone`, async () => {
      const c = await setup();
      const food = category(c, 'Food');
      const pay = paymentCategoryOf(c, c.card);
      const pay2 = paymentCategoryOf(c, c.card2);
      assign(c, food, 300, '2024-01');
      await tx(c, c.card, food, -300, '2024-01-10'); // funded: Card's payment category 300
      const loan = (await c.s.accounts.createAccount('Loan', c.b, 'loan', 'USD', asMilli(0))).ID;
      const offLoan = (
        await c.s.accounts.createAccount(
          'Old loan',
          c.b,
          'loan',
          'USD',
          asMilli(0),
          undefined,
          false
        )
      ).ID;
      const before = reads(c, mode);

      await transfer(c, c.card2, c.card, 100, '2024-02-05', 'bt-card'); // card -> card
      await transfer(c, loan, c.card, 50, '2024-02-06', 'bt-loan'); // on-budget loan -> card
      // split parent on Card 2 with a transfer line into Card (mirror on Card)
      await tx(c, c.card2, food, -40, '2024-02-07');
      const parent = idOf(c, `SELECT MAX(ID) AS ID FROM transactions WHERE AccountID=${c.card2}`);
      await c.s.splits.upsertSplits(parent, [
        {
          TransferAccountID: c.card,
          InflowConverted: asMilli(0),
          OutflowConverted: asMilli(40),
          OrderIndex: 0,
        },
      ]);
      const after = reads(c, mode);
      for (const m of ['2024-02', '2024-03', '2024-04']) {
        expect(after.avail(m, pay)).toBe(before.avail(m, pay));
        expect(after.avail(m, pay2)).toBe(before.avail(m, pay2));
        expect(after.rta[m].readyToAssign).toBe(before.rta[m].readyToAssign);
      }

      // Debt moved in from an off-budget loan is no payment either.
      await transfer(c, offLoan, c.card, 20, '2024-03-06', 'bt-offloan');
      expect(reads(c, mode).avail('2024-03', pay)).toBe(before.avail('2024-03', pay));
      // Real payments still count: checking and an unpaired leg.
      await transfer(c, c.chk, c.card, 100, '2024-03-05', 'pay-chk');
      await tx(c, c.card, c.transfers, 30, '2024-03-07', 'unpaired');
      const paid = reads(c, mode);
      expect(paid.avail('2024-03', pay)).toBe(before.avail('2024-03', pay) - 130);
    });
  }
});

describe('#69: snapshot invalidation follows the partner leg', () => {
  it('editing, moving, retyping or deleting the partner re-reads the other leg', async () => {
    const c = await setup();
    const food = category(c, 'Food');
    const pay = paymentCategoryOf(c, c.card);
    assign(c, food, 300, '2024-01');
    await tx(c, c.card, food, -300, '2024-01-10');
    await transfer(c, c.card2, c.card, 100, '2024-02-05', 'bt');
    const store = getBudgetSnapshotStore(c.adapter)!;
    const both = () => {
      reads(c, 'cumulative');
      return reads(c, 'monthly');
    };
    expect(both().avail('2024-02', pay)).toBe(300);
    const builds = store.stats.builds;

    // Partner in another month: only the partner trigger dirties February.
    const partner = idOf(
      c,
      `SELECT ID FROM transactions WHERE TransferID='bt' AND AccountID=${c.card2}`
    );
    c.adapter.exec(`UPDATE transactions SET Date='2024-04-02' WHERE ID=${partner}`);
    expect(both().avail('2024-02', pay)).toBe(300);
    c.adapter.exec(`UPDATE transactions SET AccountID=${c.chk} WHERE ID=${partner}`);
    expect(both().avail('2024-02', pay)).toBe(200); // now a payment
    c.adapter.exec(`UPDATE transactions SET AccountID=${c.card2} WHERE ID=${partner}`);
    expect(both().avail('2024-02', pay)).toBe(300);
    c.adapter.exec(`DELETE FROM transactions WHERE ID=${partner}`);
    expect(both().avail('2024-02', pay)).toBe(200); // unpaired leg: a payment
    expect(store.stats.builds, 'incremental, no rebuild').toBe(builds);

    // Partner account changes type / budget status: full rebuild, still equal.
    await transfer(c, c.card2, c.card, 50, '2024-03-05', 'bt2');
    expect(both().avail('2024-03', pay)).toBe(200);
    await c.s.accounts.updateAccount(c.card2, '', 'checking', '');
    expect(both().avail('2024-03', pay)).toBe(150);
    await c.s.accounts.updateAccount(c.card2, '', 'credit', '');
    expect(both().avail('2024-03', pay)).toBe(200);
  });

  it('moving or deleting a split parent re-reads its mirror, whatever its month', async () => {
    const c = await setup();
    const food = category(c, 'Food');
    const pay = paymentCategoryOf(c, c.card);
    assign(c, food, 300, '2024-01');
    await tx(c, c.card, food, -300, '2024-01-10');
    await tx(c, c.card2, food, -40, '2024-02-07');
    const parent = idOf(c, `SELECT MAX(ID) AS ID FROM transactions WHERE AccountID=${c.card2}`);
    await c.s.splits.upsertSplits(parent, [
      {
        TransferAccountID: c.card,
        InflowConverted: asMilli(0),
        OutflowConverted: asMilli(40),
        OrderIndex: 0,
      },
    ]);
    const mirror = idOf(
      c,
      `SELECT ID FROM transactions WHERE AccountID=${c.card} AND TransferID GLOB 'split_transfer_*'`
    );
    // a mirror dated in another month than its parent (old data, raw writes)
    c.adapter.exec(`UPDATE transactions SET Date='2024-03-03' WHERE ID=${mirror}`);
    const store = getBudgetSnapshotStore(c.adapter)!;
    expect(reads(c, 'monthly').avail('2024-03', pay)).toBe(300);
    const builds = store.stats.builds;
    c.adapter.exec(`UPDATE transactions SET AccountID=${c.chk} WHERE ID=${parent}`);
    expect(reads(c, 'monthly').avail('2024-03', pay)).toBe(260);
    expect(reads(c, 'cumulative').avail('2024-03', pay)).toBe(260);
    c.adapter.exec(`UPDATE transactions SET AccountID=${c.card2} WHERE ID=${parent}`);
    expect(reads(c, 'monthly').avail('2024-03', pay)).toBe(300);
    c.adapter.exec(`DELETE FROM transaction_splits WHERE TransactionID=${parent}`);
    c.adapter.exec(`DELETE FROM transactions WHERE ID=${parent}`);
    expect(reads(c, 'monthly').avail('2024-03', pay)).toBe(260); // orphaned mirror: a payment
    expect(store.stats.builds, 'incremental, no rebuild').toBe(builds);
  });
});

describe('#68: refund taken out of a CC Payment category is category cash (monthly)', () => {
  it('funded purchase, later refund, spent from checking: no cash overspend', async () => {
    const c = await setup();
    const shop = category(c, 'Shopping');
    assign(c, shop, 100, '2024-01');
    await tx(c, c.card, shop, -100, '2024-01-10');
    await tx(c, c.card, shop, 100, '2024-02-10');
    await tx(c, c.chk, shop, -100, '2024-03-10');
    const r = reads(c, 'monthly');
    expect(r.rta['2024-05'].priorCashOverspend).toBe(0);
    expect(r.rta['2024-05'].readyToAssign).toBe(900); // checking 900 + card 0
    const cumulative = reads(c, 'cumulative');
    expect(cumulative.rta['2024-05'].readyToAssign).toBe(900);
  });

  it('refund past the card debt: the realized part and the positive balance are both cash', async () => {
    const c = await setup();
    const shop = category(c, 'Shopping');
    assign(c, shop, 100, '2024-01');
    await tx(c, c.card, shop, -100, '2024-01-10');
    await tx(c, c.card, shop, 150, '2024-02-10'); // card ends at +50
    await tx(c, c.chk, shop, -150, '2024-03-10');
    const r = reads(c, 'monthly');
    expect(r.rta['2024-05'].priorCashOverspend).toBe(0);
    expect(r.rta['2024-05'].readyToAssign).toBe(900); // checking 850 + card 50
  });

  it('several categories refund to one card: every refund comes back in full', async () => {
    const c = await setup();
    const x = category(c, 'X');
    const y = category(c, 'Y');
    const pay = paymentCategoryOf(c, c.card);
    assign(c, x, 60, '2024-01');
    await tx(c, c.card, x, -60, '2024-01-10'); // funded: payment category 60
    await tx(c, c.card, y, -40, '2024-01-11'); // unfunded: credit overspend
    await tx(c, c.card, x, 60, '2024-02-10');
    await tx(c, c.card, y, 40, '2024-02-11');
    await tx(c, c.chk, x, -60, '2024-03-10');
    await tx(c, c.chk, y, -40, '2024-03-10');
    const r = reads(c, 'monthly');
    // 100 refunded, the payment category held 60: it ends February at -40, which
    // is charged in March; both refunds are cash, so spending them is not.
    expect(r.avail('2024-02', pay)).toBe(-40);
    expect(r.rta['2024-05'].priorCashOverspendDetails).toEqual([
      expect.objectContaining({ categoryId: pay, month: '2024-02', amount: 40 }),
    ]);
    expect(r.rta['2024-05'].readyToAssign).toBe(900); // income 1000 - X 60 - overspend 40
  });

  it('control: a refund of unfunded credit overspend stays credit', async () => {
    const c = await setup();
    const shop = category(c, 'Shopping');
    await tx(c, c.card, shop, -50, '2024-01-10');
    await tx(c, c.card, shop, 50, '2024-02-10');
    await tx(c, c.chk, shop, -50, '2024-03-10');
    const r = reads(c, 'monthly');
    expect(r.rta['2024-05'].priorCashOverspend).toBe(50);
    expect(r.rta['2024-05'].readyToAssign).toBe(950);
  });
});

describe('cumulative: card refunds take funding back out of the CC Payment category', () => {
  const run = async (
    build: (c: Ctx, shop: number, other: number) => Promise<void>
  ): Promise<{ pay: number; shop: number; other: number; refunded: number | undefined }> => {
    const c = await setup();
    const shop = category(c, 'Shopping');
    const other = category(c, 'Other');
    await build(c, shop, other);
    const r = reads(c, 'cumulative');
    const pc = paymentCategoryOf(c, c.card);
    const row = r.budget['2024-05'].find((x) => x.CategoryID === pc)!;
    return {
      pay: row.Available,
      shop: r.avail('2024-05', shop),
      other: r.avail('2024-05', other),
      refunded: row.totalRefunded,
    };
  };

  it('funded purchase refunded later: card owes 0, payment category 0', async () => {
    const out = await run(async (c, shop) => {
      assign(c, shop, 100, '2024-01');
      await tx(c, c.card, shop, -100, '2024-01-10');
      await tx(c, c.card, shop, 100, '2024-02-10');
    });
    expect(out).toMatchObject({ pay: 0, shop: 100 });
  });

  it('partly funded purchase, partial refund: the refund cancels the purchase first', async () => {
    const out = await run(async (c, shop) => {
      assign(c, shop, 60, '2024-01');
      await tx(c, c.card, shop, -100, '2024-01-10');
      await tx(c, c.card, shop, 30, '2024-02-10');
    });
    // card owes 70: 60 funded, the category is 10 overspent
    expect(out).toMatchObject({ pay: 60, shop: -10 });
  });

  it('unfunded purchase refunded: nothing to give back', async () => {
    const out = await run(async (c, shop) => {
      await tx(c, c.card, shop, -50, '2024-01-10');
      await tx(c, c.card, shop, 50, '2024-02-10');
    });
    expect(out).toMatchObject({ pay: 0, shop: 0, refunded: undefined });
  });

  it('refund in another category takes back what the payment category holds', async () => {
    const out = await run(async (c, shop, other) => {
      assign(c, shop, 100, '2024-01');
      await tx(c, c.card, shop, -100, '2024-01-10');
      await tx(c, c.card, other, 100, '2024-02-10'); // card back to 0
    });
    expect(out).toMatchObject({ pay: 0, shop: 0, other: 100, refunded: 100 });
  });

  it('refund past the card debt: the part that puts the card in credit is cash', async () => {
    const out = await run(async (c, shop, other) => {
      assign(c, shop, 100, '2024-01');
      await tx(c, c.card, shop, -100, '2024-01-10');
      await tx(c, c.card, other, 150, '2024-02-10'); // card ends at +50
    });
    expect(out).toMatchObject({ pay: 0, other: 150, refunded: 100 });
  });

  it('refund onto a card in credit leaves money assigned to the payment category', async () => {
    const out = await run(async (c, _shop, other) => {
      assign(c, paymentCategoryOf(c, c.card), 100, '2024-01');
      await tx(c, c.card, other, 100, '2024-02-10'); // card +100, owes nothing
    });
    expect(out).toMatchObject({ pay: 100, other: 100, refunded: undefined });
  });
});

describe('#67: card -> on-budget cash account transfers are cash advances', () => {
  for (const mode of ['cumulative', 'monthly'] as Mode[]) {
    it(`[${mode}] the debt-growing part raises RTA; positive balances, debt and off-budget moves do not`, async () => {
      const c = await setup();
      const shop = category(c, 'Shopping');
      const pay = paymentCategoryOf(c, c.card);
      const sav = (await c.s.accounts.createAccount('Savings', c.b, 'savings', 'USD', asMilli(0)))
        .ID;
      const off = (
        await c.s.accounts.createAccount(
          'Tracking',
          c.b,
          'savings',
          'USD',
          asMilli(0),
          undefined,
          false
        )
      ).ID;
      const base = reads(c, mode).rta['2024-05'].readyToAssign;
      const rtaDelta = () => reads(c, mode).rta['2024-05'].readyToAssign - base;

      await transfer(c, c.card, c.chk, 100, '2024-02-05', 'adv1'); // plain advance
      expect(rtaDelta()).toBe(100);
      expect(reads(c, mode).avail('2024-05', pay)).toBe(0);

      // Card 2 holds +50 of refund money: moving 80 out only borrows 30.
      await tx(c, c.card2, shop, 50, '2024-02-10');
      const before = rtaDelta();
      await transfer(c, c.card2, sav, 80, '2024-02-11', 'adv2');
      expect(rtaDelta() - before).toBe(30);

      // split-transfer mirror on the card (parent on checking, a line from the card)
      await tx(c, c.chk, shop, 60, '2024-03-01');
      const parent = idOf(c, `SELECT MAX(ID) AS ID FROM transactions WHERE AccountID=${c.chk}`);
      await c.s.splits.upsertSplits(parent, [
        {
          CategoryID: shop,
          InflowConverted: asMilli(20),
          OutflowConverted: asMilli(0),
          OrderIndex: 0,
        },
        {
          TransferAccountID: c.card,
          InflowConverted: asMilli(40),
          OutflowConverted: asMilli(0),
          OrderIndex: 1,
        },
      ]);
      expect(rtaDelta() - before).toBe(30 + 40);

      // card split line transferring to checking (parent on the card)
      await tx(c, c.card, shop, -70, '2024-03-05');
      const cardParent = idOf(
        c,
        `SELECT MAX(ID) AS ID FROM transactions WHERE AccountID=${c.card}`
      );
      await c.s.splits.upsertSplits(cardParent, [
        {
          CategoryID: shop,
          InflowConverted: asMilli(0),
          OutflowConverted: asMilli(45),
          OrderIndex: 0,
        },
        {
          TransferAccountID: c.chk,
          InflowConverted: asMilli(0),
          OutflowConverted: asMilli(25),
          OrderIndex: 1,
        },
      ]);
      expect(rtaDelta() - before).toBe(30 + 40 + 25);
      const mid = rtaDelta();

      // Not advances: card -> card, card -> off-budget, unpaired, excluded from RTA.
      await transfer(c, c.card, c.card2, 10, '2024-03-10', 'bt');
      await transfer(c, c.card, off, 15, '2024-03-11', 'offb');
      await tx(c, c.card, c.transfers, -5, '2024-03-12', 'unpaired');
      expect(rtaDelta() - mid).toBe(-15); // off-budget leaves RTA as before
      await transfer(c, c.card, c.chk, 12, '2024-03-13', 'excl');
      c.adapter.exec(
        `UPDATE transactions SET ExcludeFromReadyToAssign = 1 WHERE TransferID='excl'`
      );
      expect(rtaDelta() - mid).toBe(-15);
    });
  }

  it('snapshot follows the partner leg and the split line target', async () => {
    const c = await setup();
    await transfer(c, c.card, c.card2, 100, '2024-02-05', 'x');
    const rta = (mode: Mode) => reads(c, mode).rta['2024-05'].readyToAssign;
    const start = { cumulative: rta('cumulative'), monthly: rta('monthly') };
    const store = getBudgetSnapshotStore(c.adapter)!;
    const builds = store.stats.builds;
    const partner = idOf(
      c,
      `SELECT ID FROM transactions WHERE TransferID='x' AND AccountID=${c.card2}`
    );
    c.adapter.exec(`UPDATE transactions SET Date='2024-04-02' WHERE ID=${partner}`);
    c.adapter.exec(`UPDATE transactions SET AccountID=${c.chk} WHERE ID=${partner}`); // now an advance
    // checking 1000 + 100, card -100: an advance of 100 in both modes (monthly
    // had counted Card 2's +100 credit balance as cash before)
    expect(start).toEqual({ cumulative: 1000, monthly: 1100 });
    expect(rta('cumulative')).toBe(1100);
    expect(rta('monthly')).toBe(1100);
    c.adapter.exec(`DELETE FROM transactions WHERE ID=${partner}`); // unpaired again
    expect(rta('cumulative')).toBe(1000);
    expect(rta('monthly')).toBe(1000);
    expect(store.stats.builds, 'incremental, no rebuild').toBe(builds);
  });
});

describe('split-transfer legs to and from off-budget accounts move RTA', () => {
  for (const mode of ['cumulative', 'monthly'] as Mode[]) {
    it(`[${mode}] a split line to off-budget savings leaves RTA; the reverse adds to it`, async () => {
      const c = await setup();
      const shop = category(c, 'Shopping');
      const off = (
        await c.s.accounts.createAccount(
          'Tracking',
          c.b,
          'savings',
          'USD',
          asMilli(0),
          undefined,
          false
        )
      ).ID;
      assign(c, shop, 60, '2024-02');
      const base = reads(c, mode).rta['2024-05'].readyToAssign;
      // 100 from checking: 60 Shopping + 40 to off-budget savings
      await tx(c, c.chk, shop, -100, '2024-02-05');
      const parent = idOf(c, `SELECT MAX(ID) AS ID FROM transactions WHERE AccountID=${c.chk}`);
      await c.s.splits.upsertSplits(parent, [
        {
          CategoryID: shop,
          InflowConverted: asMilli(0),
          OutflowConverted: asMilli(60),
          OrderIndex: 0,
        },
        {
          TransferAccountID: off,
          InflowConverted: asMilli(0),
          OutflowConverted: asMilli(40),
          OrderIndex: 1,
        },
      ]);
      expect(reads(c, mode).rta['2024-05'].readyToAssign).toBe(base - 40);
      // an off-budget transaction split partly into checking: 25 comes onto the budget
      await tx(c, off, shop, -70, '2024-03-05');
      const offParent = idOf(c, `SELECT MAX(ID) AS ID FROM transactions WHERE AccountID=${off}`);
      await c.s.splits.upsertSplits(offParent, [
        {
          CategoryID: shop,
          InflowConverted: asMilli(0),
          OutflowConverted: asMilli(45),
          OrderIndex: 0,
        },
        {
          TransferAccountID: c.chk,
          InflowConverted: asMilli(0),
          OutflowConverted: asMilli(25),
          OrderIndex: 1,
        },
      ]);
      expect(reads(c, mode).rta['2024-05'].readyToAssign).toBe(base - 40 + 25);
      // excluded from Ready to Assign
      c.adapter.exec(`UPDATE transactions SET ExcludeFromReadyToAssign = 1 WHERE ID=${parent}`);
      expect(reads(c, mode).rta['2024-05'].readyToAssign).toBe(base + 25);
    });
  }
});

describe('monthly: a card sending its positive balance off budget', () => {
  it('takes the amount off RTA once', async () => {
    const c = await setup();
    const shop = category(c, 'Shopping');
    const off = (
      await c.s.accounts.createAccount(
        'Tracking',
        c.b,
        'savings',
        'USD',
        asMilli(0),
        undefined,
        false
      )
    ).ID;
    await tx(c, c.card, shop, 50, '2024-01-10'); // card +50 (refund money in Shopping)
    const base = reads(c, 'monthly').rta['2024-05'].readyToAssign;
    await transfer(c, c.card, off, 80, '2024-02-10', 'off'); // 50 from the balance, 30 borrowed
    expect(reads(c, 'monthly').rta['2024-05'].readyToAssign).toBe(base - 80);
  });
});

describe('card refunds always come out of the CC Payment category (YNAB-observed)', () => {
  for (const later of ['purchase', 'none'] as const)
    it(`[monthly] refund of an unfunded purchase is charged next month (later: ${later})`, async () => {
      const c = await setup();
      const shop = category(c, 'Shopping');
      const pay = paymentCategoryOf(c, c.card);
      await tx(c, c.card, shop, -50, '2024-01-10'); // unfunded
      await tx(c, c.card, shop, 50, '2024-02-10'); // refund: Shopping +50, CC Payment -50
      if (later === 'purchase') {
        await tx(c, c.card, shop, -50, '2024-03-10'); // funded from the refund money
        await transfer(c, c.chk, c.card, 50, '2024-04-10', 'pay');
      }
      const r = reads(c, 'monthly');
      expect(r.avail('2024-02', pay)).toBe(-50);
      expect(r.rta['2024-02'].readyToAssign).toBe(1000);
      expect(r.rta['2024-03'].readyToAssign).toBe(950);
      expect(r.rta['2024-05'].readyToAssign).toBe(950);
      expect(r.rta['2024-05'].priorCashOverspendDetails).toEqual([
        expect.objectContaining({ categoryId: pay, month: '2024-02', amount: 50 }),
      ]);
    });

  it('[cumulative] the CC Payment category goes negative and stays', async () => {
    const c = await setup();
    const shop = category(c, 'Shopping');
    const pay = paymentCategoryOf(c, c.card);
    await tx(c, c.card, shop, -50, '2024-01-10');
    await tx(c, c.card, shop, 30, '2024-02-10'); // nets against the purchase: no draw
    const other = category(c, 'Other');
    await tx(c, c.card, other, 20, '2024-02-12'); // leftover refund in another category
    const r = reads(c, 'cumulative');
    expect(r.avail('2024-05', pay)).toBe(-20);
  });
});
