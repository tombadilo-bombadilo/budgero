import { t } from '@lingui/core/macro';
import type { AppRuntime } from '@shared/runtime/app-runtime';

/**
 * Fills a new workspace with a realistic budget: last month and this month,
 * with income, bills, everyday spending, two goals and every coin assigned.
 * Dates are relative to today so the demo never looks stale. Runs through
 * the normal mutation router (so sync and encryption behave as usual), with
 * undo and analytics turned off for these ops.
 */

export const DEMO_SEED_LABEL = 'demo.seed';

const M = 1000; // milliunits per unit

function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function monthKey(d: Date): string {
  return isoDate(d).slice(0, 7);
}

/** Day `day` of the month `offset` months from today, never after today. */
function dayOf(today: Date, offset: number, day: number): string {
  const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return isoDate(d > today ? today : d);
}

export async function seedDemoBudget(
  runtime: AppRuntime,
  spaceId: string,
  currency: string,
  today = new Date()
): Promise<number> {
  const op = async <T>(name: string, payload: Record<string, unknown>): Promise<T> =>
    (
      await runtime.mutationsRouter().execute<T>({
        op: name,
        payload,
        spaceId,
        meta: { label: DEMO_SEED_LABEL, skipUndo: true },
      })
    ).result;

  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const start = dayOf(today, -1, 1);

  const budgetId = await op<number>('budgets.create', {
    name: t`Demo budget`,
    displayCurrency: currency,
    badgeIcon: '🧪',
    numberFormat: '$1,096.56',
    createDefaultCategories: false,
    spaceId,
  });

  const account = async (name: string, type: string, balance: number) =>
    (
      await op<{ ID: number }>('accounts.create', {
        name,
        budgetId,
        type,
        currency,
        balance,
        metadata: {},
        onBudget: true,
        initialBalanceDate: start,
      })
    ).ID;
  const checking = await account(t`Everyday checking`, 'checking', 1_850 * M);
  await account(t`Savings`, 'savings', 4_200 * M);
  const card = await account(t`Credit card`, 'credit', -320 * M);

  const group = (name: string) => op<number>('categoryGroups.create', { name, budgetId });
  const category = (parentId: number, name: string) =>
    op<number>('categories.create', { parentId, budgetId, name, note: '' });

  const bills = await group(t`Bills`);
  const rent = await category(bills, t`Rent`);
  const utilities = await category(bills, t`Utilities`);
  const phone = await category(bills, t`Phone & internet`);
  const everyday = await group(t`Everyday`);
  const groceries = await category(everyday, t`Groceries`);
  const dining = await category(everyday, t`Dining out`);
  const transport = await category(everyday, t`Transport`);
  const fun = await category(everyday, t`Fun money`);
  const goalsGroup = await group(t`Savings goals`);
  const emergency = await category(goalsGroup, t`Emergency fund`);
  const vacation = await category(goalsGroup, t`Vacation`);

  const plan: [number, number][] = [
    [rent, 1_100],
    [utilities, 140],
    [phone, 60],
    [groceries, 450],
    [dining, 150],
    [transport, 120],
    [fun, 100],
    [emergency, 300],
    [vacation, 200],
  ];
  const income = 2_650;

  // The cash openings and the two paychecks are all the money there is (a
  // card's opening debt doesn't come out of Ready to Assign). Both months
  // assign the plan; the rest goes to the emergency fund last month, so
  // every coin has a job.
  const assignments = [
    ...plan.map(([categoryId, amount]) => ({
      categoryId,
      amount: amount * M,
      month: monthKey(lastMonth),
      budgetId,
    })),
    ...plan.map(([categoryId, amount]) => ({
      categoryId,
      amount: amount * M,
      month: monthKey(today),
      budgetId,
    })),
  ];
  // Cover the card's starting debt so its payment envelope matches what's owed.
  const cardPayment = runtime.services().categories.getCategoryByName(t`Credit card`, budgetId);
  if (cardPayment) {
    assignments.push({
      categoryId: cardPayment.ID,
      amount: 320 * M, // the card's opening balance
      month: monthKey(lastMonth),
      budgetId,
    });
  }
  const planned = plan.reduce((sum, [, amount]) => sum + amount, 0);
  const cardCover = cardPayment ? 320 : 0;
  const openingCash = 1_850 + 4_200;
  const spare = openingCash + income * 2 - planned * 2 - cardCover;
  if (spare > 0) {
    const toEmergency = assignments.find(
      (a) => a.categoryId === emergency && a.month === monthKey(lastMonth)
    );
    if (toEmergency) toEmergency.amount += spare * M;
  }
  await op('monthlyBudgets.batchUpsertAssignments', { assignments });

  const incomeCategory = runtime.services().categories.getCategoryByName('Income', budgetId);
  type Tx = [
    offset: number,
    day: number,
    account: number,
    category: number | null,
    payee: string,
    out: number,
    inflow?: number,
  ];
  const txs: Tx[] = [
    [-1, 1, checking, incomeCategory?.ID ?? null, t`Employer`, 0, income],
    [-1, 2, checking, rent, t`Landlord`, 1_100],
    [-1, 4, card, groceries, t`Supermarket`, 86.4],
    [-1, 6, checking, utilities, t`Power company`, 72.15],
    [-1, 8, card, dining, t`Pizza place`, 34.5],
    [-1, 11, card, groceries, t`Supermarket`, 112.8],
    [-1, 12, checking, transport, t`Transit pass`, 89],
    [-1, 15, checking, phone, t`Phone company`, 60],
    [-1, 18, card, fun, t`Cinema`, 24],
    [-1, 19, card, groceries, t`Farmers market`, 41.25],
    [-1, 22, card, dining, t`Coffee shop`, 18.6],
    [-1, 25, checking, utilities, t`Water company`, 38.4],
    [-1, 26, card, groceries, t`Supermarket`, 97.3],
    [0, 1, checking, incomeCategory?.ID ?? null, t`Employer`, 0, income],
    [0, 2, checking, rent, t`Landlord`, 1_100],
    [0, 3, card, groceries, t`Supermarket`, 74.9],
    [0, 4, card, dining, t`Coffee shop`, 9.8],
    [0, 5, checking, transport, t`Transit pass`, 89],
  ];
  for (const [offset, day, accountId, categoryId, payee, out, inflow = 0] of txs) {
    await op('transactions.add', {
      budgetId,
      accountId,
      categoryId,
      date: dayOf(today, offset, day),
      memo: '',
      payee,
      inflow: Math.round(inflow * M),
      outflow: Math.round(out * M),
    });
  }

  await op('goals.create', {
    goalType: 'monthly-savings',
    categoryId: emergency,
    target: 300 * M,
    startDate: start,
    endDate: '',
    purpose: 'savings',
    recurring: false,
    cycleMonths: null,
  });
  const trip = new Date(today.getFullYear(), today.getMonth() + 8, 1);
  await op('goals.create', {
    goalType: 'target-date',
    categoryId: vacation,
    target: 2_000 * M,
    startDate: start,
    endDate: isoDate(trip),
    purpose: 'savings',
    recurring: false,
    cycleMonths: null,
  });

  return budgetId;
}
