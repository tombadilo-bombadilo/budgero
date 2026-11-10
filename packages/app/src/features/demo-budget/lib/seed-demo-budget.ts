import { t } from '@lingui/core/macro';
import { AccountTypeEnum } from '@budgero/core/browser';
import type { AppRuntime } from '@shared/runtime/app-runtime';
import { DEMO_ACCOUNT_METADATA_KEY } from '@shared/lib/demo-space';
import type { DemoLocale } from './demo-workspace';

/**
 * Fills a new workspace with a lived-in budget: a year and a half of history
 * ending today, with a salary (a raise and a few bonuses), bills, weekly
 * groceries, a summer vacation, December gifts, a car repair, monthly card
 * payments and savings transfers, a few splits and refunds, goals with real
 * progress, and every coin assigned in every month.
 *
 * The data is the same for everyone: it depends only on the calendar months
 * it covers (a seeded generator per month), never on the user. Runs through
 * the normal mutation router (so sync and encryption behave as usual), with
 * undo and analytics turned off for these ops. Plain transactions go in
 * batches through `transactions.restoreBatch`, an op every app version
 * replays, so ~700 rows are a handful of ops instead of one op per row; only
 * splits and transfers, which need their own ops, go one at a time. The
 * caller refreshes every query once when the seed is done.
 */

export const DEMO_SEED_LABEL = 'demo.seed';
/** Months of history, the current month included. */
export const DEMO_MONTHS = 18;
/** Transactions per `transactions.restoreBatch` op. */
const BATCH_SIZE = 150;
/** Transactions older than this many days are cleared, like a bank would. */
const CLEARED_AFTER_DAYS = 4;

const M = 1000; // milliunits per unit

type CategoryKey =
  | 'rent'
  | 'utilities'
  | 'phone'
  | 'subscriptions'
  | 'groceries'
  | 'dining'
  | 'transport'
  | 'fun'
  | 'household'
  | 'car'
  | 'gifts'
  | 'emergency'
  | 'vacation';
type AccountKey = 'checking' | 'savings' | 'card';

interface PlannedTransaction {
  date: string;
  account: AccountKey;
  /** null = income. */
  category: CategoryKey | null;
  payee: string;
  memo?: string;
  /** Milliunits. */
  outflow: number;
  inflow: number;
  splits?: { category: CategoryKey; outflow: number }[];
}

interface PlannedTransfer {
  date: string;
  from: AccountKey;
  to: AccountKey;
  amount: number;
}

interface PlannedAssignment {
  month: string;
  category: CategoryKey | 'cardPayment';
  amount: number;
}

export interface DemoPlan {
  start: string;
  opening: Record<AccountKey, number>;
  transactions: PlannedTransaction[];
  transfers: PlannedTransfer[];
  assignments: PlannedAssignment[];
  /** The month the next vacation is planned for (first day, ISO). */
  nextVacation: string;
}

/** What each envelope gets in an ordinary month, in whole units. */
const MONTHLY_PLAN: Record<Exclude<CategoryKey, 'emergency'>, number> = {
  rent: 1_150,
  utilities: 150,
  phone: 80,
  subscriptions: 55,
  groceries: 430,
  dining: 200,
  transport: 110,
  fun: 100,
  household: 50,
  car: 60,
  gifts: 40,
  vacation: 150,
};

const OPENING: Record<AccountKey, number> = {
  checking: 2_400 * M,
  savings: 6_000 * M,
  card: -420 * M,
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

/** Small seeded generator (mulberry32): the same months give the same data. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The whole demo as plain data. Pure: the same `today` always gives the same
 * plan. Kept apart from the ops so the numbers can be checked without a DB.
 */
export function planDemoBudget(today: Date): DemoPlan {
  const transactions: PlannedTransaction[] = [];
  const transfers: PlannedTransfer[] = [];
  const assignments: PlannedAssignment[] = [];
  const available: Record<string, number> = {};
  let cardOwed = -OPENING.card;

  // The latest July that is already over is the vacation month.
  let vacationOffset = -1;
  for (let offset = -1; offset > -DEMO_MONTHS; offset -= 1) {
    const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    if (d.getMonth() === 6) {
      vacationOffset = offset;
      break;
    }
  }
  const nextJuly = new Date(today.getFullYear(), 6, 1);
  if (today.getMonth() >= 4) nextJuly.setFullYear(today.getFullYear() + 1);

  for (let offset = -(DEMO_MONTHS - 1); offset <= 0; offset += 1) {
    const first = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const year = first.getFullYear();
    const month = first.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const lastDay = offset === 0 ? today.getDate() : days;
    const monthKey = `${year}-${pad(month + 1)}`;
    const index = offset + DEMO_MONTHS - 1; // 0 = oldest month
    const rnd = generator(0x51ed270b ^ (year * 12 + month));
    /** A price between min and max, to the cent. */
    const price = (min: number, max: number) => Math.round((min + rnd() * (max - min)) * 100) * 10;
    const pick = <T>(items: T[]): T => items[Math.floor(rnd() * items.length)]!;
    const winter = month <= 1 || month >= 10;
    const summer = month >= 5 && month <= 7;

    let income = 0;
    let cardSpent = 0;
    const spent: Record<string, number> = {};
    const spend = (category: CategoryKey, amount: number) => {
      spent[category] = (spent[category] ?? 0) + amount;
    };
    const add = (
      day: number,
      account: AccountKey,
      category: CategoryKey | null,
      payee: string,
      outflow: number,
      extra: Partial<PlannedTransaction> = {}
    ) => {
      // The current month stops at today: later days haven't happened yet.
      if (day > lastDay) return;
      const inflow = extra.inflow ?? 0;
      transactions.push({
        date: iso(year, month, Math.min(day, days)),
        account,
        category,
        payee,
        outflow,
        ...extra,
        inflow,
      });
      if (category === null) income += inflow;
      else if (extra.splits) for (const line of extra.splits) spend(line.category, line.outflow);
      else spend(category, outflow - inflow);
      if (account === 'card') cardSpent += outflow - inflow;
    };

    // Income: a raise after ten months, a year-end bonus, one mid-year bonus.
    const salary = (index >= 10 ? 3_150 : 2_900) * M;
    add(1, 'checking', null, t`Employer`, 0, { inflow: salary, memo: t`Salary` });
    if (month === 11)
      add(18, 'checking', null, t`Employer`, 0, { inflow: 900 * M, memo: t`Year-end bonus` });
    if (index === 6)
      add(15, 'checking', null, t`Employer`, 0, { inflow: 450 * M, memo: t`Project bonus` });

    // Bills.
    add(2, 'checking', 'rent', t`Landlord`, (index >= 12 ? 1_190 : 1_150) * M);
    add(
      6,
      'checking',
      'utilities',
      t`Power company`,
      winter ? price(96, 128) : summer ? price(48, 62) : price(62, 84)
    );
    add(25, 'checking', 'utilities', t`Water company`, price(31, 43));
    add(15, 'checking', 'phone', t`Phone company`, 44_990);
    add(15, 'checking', 'phone', t`Internet provider`, 34_990);
    add(8, 'card', 'subscriptions', t`Streaming service`, 12_990);
    add(12, 'card', 'subscriptions', t`Music service`, 9_990);
    add(3, 'checking', 'subscriptions', t`Gym`, 29_000);

    // Groceries: the weekly shop on Saturdays, plus a top-up or two.
    for (let day = 1; day <= days; day += 1) {
      if (new Date(year, month, day).getDay() === 6) {
        add(day, 'card', 'groceries', t`Supermarket`, price(62, 104));
      }
    }
    add(
      4 + Math.floor(rnd() * 3),
      'card',
      'groceries',
      pick([t`Bakery`, t`Corner shop`]),
      price(6, 19)
    );
    add(17 + Math.floor(rnd() * 4), 'card', 'groceries', t`Farmers market`, price(18, 42));

    // Eating out: coffee most weeks, lunch or dinner now and then.
    const meals = 9 + Math.floor(rnd() * 4);
    for (let i = 0; i < meals; i += 1) {
      const day = 1 + Math.floor(rnd() * days);
      const place = pick([
        t`Coffee shop`,
        t`Coffee shop`,
        t`Pizza place`,
        t`Noodle bar`,
        t`Burger place`,
        t`Bistro`,
      ]);
      add(day, 'card', 'dining', place, place === t`Coffee shop` ? price(4, 9) : price(13, 38));
    }

    // Getting around.
    add(1, 'checking', 'transport', t`Transit pass`, 49_000);
    add(9 + Math.floor(rnd() * 5), 'card', 'transport', t`Gas station`, price(38, 58));
    if (rnd() < 0.6)
      add(22 + Math.floor(rnd() * 5), 'card', 'transport', t`Gas station`, price(34, 55));

    // Fun and the household.
    const treats = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < treats; i += 1) {
      add(
        1 + Math.floor(rnd() * days),
        'card',
        'fun',
        pick([t`Cinema`, t`Bookshop`, t`Game store`, t`Concert tickets`, t`Climbing gym`]),
        price(9, 32)
      );
    }
    add(10 + Math.floor(rnd() * 12), 'card', 'household', t`Drugstore`, price(12, 34));

    // Splits: one receipt, two envelopes.
    if (index % 5 === 3) {
      const food = price(48, 70);
      const home = price(16, 30);
      add(14, 'card', 'groceries', t`Hypermarket`, food + home, {
        splits: [
          { category: 'groceries', outflow: food },
          { category: 'household', outflow: home },
        ],
      });
    }
    // A purchase that goes back: the refund lands in the same envelope.
    if (index % 7 === 4) {
      const headphones = price(49, 79);
      add(9, 'card', 'fun', t`Online shop`, headphones, { memo: t`Headphones` });
      add(16, 'card', 'fun', t`Online shop`, 0, { inflow: headphones, memo: t`Refund` });
    }

    // The irregular ones.
    if (offset === vacationOffset) {
      add(3, 'card', 'vacation', t`Airline`, 386_000, { memo: t`Flights` });
      add(11, 'card', 'vacation', t`Seaside hotel`, 540_000, { memo: t`6 nights` });
      add(12, 'card', 'vacation', t`Beach restaurant`, 64_500);
      add(13, 'card', 'vacation', t`Boat tour`, 78_000);
      add(14, 'card', 'vacation', t`Beach restaurant`, 52_800);
      add(15, 'card', 'vacation', t`Souvenir shop`, 31_400);
      add(16, 'card', 'vacation', t`Airport taxi`, 42_000);
    }
    if (month === 11) {
      add(9, 'card', 'gifts', t`Toy store`, price(45, 70));
      add(13, 'card', 'gifts', t`Bookshop`, price(28, 46));
      add(17, 'card', 'gifts', t`Department store`, price(80, 120));
    } else if (index % 6 === 2) {
      add(20, 'card', 'gifts', t`Florist`, price(24, 38), { memo: t`Birthday` });
    }
    if (index === 12)
      add(19, 'checking', 'car', t`Car repair shop`, 468_000, { memo: t`New brake pads` });
    if (index === 5)
      add(7, 'checking', 'car', t`Car repair shop`, 139_000, { memo: t`Annual service` });

    // Money between accounts: savings on the 5th, last month's card bill on the 20th.
    if (lastDay >= 5)
      transfers.push({
        date: iso(year, month, 5),
        from: 'checking',
        to: 'savings',
        amount: 300 * M,
      });
    const bill = cardOwed;
    if (lastDay >= 20 && bill > 0) {
      transfers.push({ date: iso(year, month, 20), from: 'checking', to: 'card', amount: bill });
      cardOwed -= bill;
    }
    cardOwed += cardSpent;

    // Assign the month: the plan, topped up where spending ran over it (the
    // way a budgeter covers overspending), and whatever income is left goes
    // to the emergency fund. Every month ends with nothing left to assign.
    let assigned = 0;
    for (const [category, units] of Object.entries(MONTHLY_PLAN)) {
      const planned = (category === 'rent' && index >= 12 ? 1_190 : units) * M;
      const after = (available[category] ?? 0) + planned - (spent[category] ?? 0);
      const amount = after < 0 ? planned - after : planned;
      available[category] = Math.max(after, 0);
      assignments.push({ month: monthKey, category: category as CategoryKey, amount });
      assigned += amount;
    }
    if (index === 0) {
      // The opening balances are income too; the card's opening debt gets covered.
      income += OPENING.checking + OPENING.savings;
      assignments.push({ month: monthKey, category: 'cardPayment', amount: -OPENING.card });
      assigned += -OPENING.card;
    }
    assignments.push({ month: monthKey, category: 'emergency', amount: income - assigned });
  }

  const startDate = new Date(today.getFullYear(), today.getMonth() - (DEMO_MONTHS - 1), 1);
  return {
    start: iso(startDate.getFullYear(), startDate.getMonth(), 1),
    opening: OPENING,
    transactions,
    transfers,
    assignments,
    nextVacation: iso(nextJuly.getFullYear(), 6, 1),
  };
}

export async function seedDemoBudget(
  runtime: AppRuntime,
  spaceId: string,
  { currency, numberFormat }: DemoLocale,
  today = new Date()
): Promise<number> {
  const op = async <T>(
    name: string,
    payload: Record<string, unknown>,
    skipInvalidate = false
  ): Promise<T> =>
    (
      await runtime.mutationsRouter().execute<T>({
        op: name,
        payload,
        spaceId,
        meta: {
          label: DEMO_SEED_LABEL,
          skipUndo: true,
          ...(skipInvalidate ? { skipInvalidate } : {}),
        },
      })
    ).result;

  const plan = planDemoBudget(today);

  const budgetId = await op<number>('budgets.create', {
    name: t`Demo budget`,
    displayCurrency: currency,
    badgeIcon: '🧪',
    numberFormat,
    createDefaultCategories: false,
    spaceId,
  });

  // The accounts carry the demo marker: it lives in the workspace's own
  // encrypted data, so it follows the budget to every device.
  const account = async (name: string, type: AccountTypeEnum, balance: number) =>
    (
      await op<{ ID: number }>('accounts.create', {
        name,
        budgetId,
        type,
        currency,
        balance,
        metadata: { [DEMO_ACCOUNT_METADATA_KEY]: true },
        onBudget: true,
        initialBalanceDate: plan.start,
      })
    ).ID;
  const accounts: Record<AccountKey, number> = {
    checking: await account(t`Everyday checking`, AccountTypeEnum.CHECKING, plan.opening.checking),
    savings: await account(t`Savings`, AccountTypeEnum.SAVINGS, plan.opening.savings),
    card: await account(t`Credit card`, AccountTypeEnum.CREDIT, plan.opening.card),
  };

  const group = (name: string) => op<number>('categoryGroups.create', { name, budgetId });
  const category = (parentId: number, name: string) =>
    op<number>('categories.create', { parentId, budgetId, name, note: '' });

  const bills = await group(t`Bills`);
  const everyday = await group(t`Everyday`);
  const sometimes = await group(t`Now and then`);
  const goalsGroup = await group(t`Savings goals`);
  const categories: Record<CategoryKey, number> = {
    rent: await category(bills, t`Rent`),
    utilities: await category(bills, t`Utilities`),
    phone: await category(bills, t`Phone & internet`),
    subscriptions: await category(bills, t`Subscriptions`),
    groceries: await category(everyday, t`Groceries`),
    dining: await category(everyday, t`Dining out`),
    transport: await category(everyday, t`Transport`),
    fun: await category(everyday, t`Fun money`),
    household: await category(everyday, t`Household`),
    car: await category(sometimes, t`Car & repairs`),
    gifts: await category(sometimes, t`Gifts`),
    emergency: await category(goalsGroup, t`Emergency fund`),
    vacation: await category(goalsGroup, t`Vacation`),
  };

  // A card gets its own payment category, named after the account.
  const cardPayment = runtime.services().categories.getCategoryByName(t`Credit card`, budgetId);
  const incomeCategory = runtime.services().categories.getCategoryByName('Income', budgetId);

  const clearedBefore = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - CLEARED_AFTER_DAYS
  );
  const clearedBeforeIso = iso(
    clearedBefore.getFullYear(),
    clearedBefore.getMonth(),
    clearedBefore.getDate()
  );
  const categoryOf = (tx: PlannedTransaction) =>
    tx.category === null ? (incomeCategory?.ID ?? null) : categories[tx.category];

  // Plain rows in batches, in date order.
  const plain = plan.transactions.filter((tx) => !tx.splits);
  for (let start = 0; start < plain.length; start += BATCH_SIZE) {
    await op(
      'transactions.restoreBatch',
      {
        snapshots: plain.slice(start, start + BATCH_SIZE).map((tx) => ({
          Date: tx.date,
          Memo: tx.memo ?? '',
          Payee: tx.payee,
          inflow: tx.inflow,
          outflow: tx.outflow,
          accountId: accounts[tx.account],
          categoryId: categoryOf(tx),
          budgetId,
          Cleared: tx.date < clearedBeforeIso,
        })),
      },
      true
    );
  }
  // A split needs its own op: parent and lines are written together.
  for (const tx of plan.transactions) {
    if (!tx.splits) continue;
    await op(
      'transactions.add',
      {
        budgetId,
        accountId: accounts[tx.account],
        categoryId: null,
        date: tx.date,
        memo: tx.memo ?? '',
        payee: tx.payee,
        inflow: tx.inflow,
        outflow: tx.outflow,
        cleared: tx.date < clearedBeforeIso,
        splits: tx.splits.map((line) => ({
          categoryId: categories[line.category],
          inflow: 0,
          outflow: line.outflow,
          memo: '',
        })),
      },
      true
    );
  }
  for (const [i, transfer] of plan.transfers.entries()) {
    const leg = { date: transfer.date, memo: '', categoryId: null };
    await op(
      'transactions.addTransfer',
      {
        budgetId,
        // Fixed ids: the demo's transfers are the same rows on every run.
        transferId: `demo-transfer-${i + 1}`,
        source: {
          ...leg,
          accountId: accounts[transfer.from],
          payee: '',
          inflow: 0,
          outflow: transfer.amount,
        },
        destination: {
          ...leg,
          accountId: accounts[transfer.to],
          payee: '',
          inflow: transfer.amount,
          outflow: 0,
        },
      },
      true
    );
  }

  await op('monthlyBudgets.batchUpsertAssignments', {
    assignments: plan.assignments.flatMap((a) => {
      const categoryId = a.category === 'cardPayment' ? cardPayment?.ID : categories[a.category];
      return categoryId === undefined
        ? []
        : [{ categoryId, amount: a.amount, month: a.month, budgetId }];
    }),
  });

  const goal = (payload: Record<string, unknown>) =>
    op('goals.create', { purpose: 'savings', recurring: false, cycleMonths: null, ...payload });
  await goal({
    goalType: 'monthly-savings',
    categoryId: categories.emergency,
    target: 250 * M,
    startDate: plan.start,
    endDate: '',
  });
  await goal({
    goalType: 'target-date',
    categoryId: categories.vacation,
    target: 1_800 * M,
    startDate: plan.start,
    endDate: plan.nextVacation,
  });
  await goal({
    goalType: 'monthly-savings',
    categoryId: categories.car,
    target: 60 * M,
    startDate: plan.start,
    endDate: '',
  });

  return budgetId;
}
