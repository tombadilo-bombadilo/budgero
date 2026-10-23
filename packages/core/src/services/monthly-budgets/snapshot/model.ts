/**
 * Budget snapshot: pure data model and folds (no SQL).
 *
 * The snapshot keeps, per budget and per calendar month, the grouped sums the
 * budget reads used to recompute from all of history on every call
 * (store.ts fills them with `Month IN (...)` grouped queries and keeps them
 * current through TEMP triggers). Every derived figure is recomputed from these
 * per-month deltas in JS: cumulative sums per read, the monthly-mode
 * rollforward once per data version. Nothing path-dependent is stored, so a
 * back-dated edit costs one month's queries plus a JS refold.
 *
 * Each field mirrors exactly one of the queries in ../queries.ts (filters noted
 * per field); category-group filters are applied here, from live metadata, so a
 * category move or a group rename needs no SQL rebuild.
 */

export const GROUP_INCOME = 'Income';
export const GROUP_TRANSFERS = 'Transfers';
export const GROUP_UNCATEGORIZED = 'Uncategorized';
export const GROUP_CC_PAYMENTS = 'Credit Card Payments';

/** Category ID as SQL returns it: split lines may have none. */
export type CategoryKey = number | null;

/** Grouped transaction sums of one month (transactions + split lines). */
export interface TxMonth {
  /**
   * On-budget, non-credit accounts, split-aware (split lines, else the row):
   * SUM(Inflow - Outflow) per category. Cash = Amount on these accounts.
   */
  nonCredit: Map<CategoryKey, number>;
  /**
   * On-budget credit accounts, split-aware, every line in ledger order
   * (Date, parent Outflow DESC, TransactionID, PartIndex), the order of
   * MONTHLY_ACTIVITY_CTE's running balance and of credit funding.
   */
  creditAccount: number[];
  creditCategory: CategoryKey[];
  creditAmount: number[];
  /** SUM(creditAmount) per category (derived from the lines). */
  creditByCategory: Map<CategoryKey, number>;
  /**
   * getCCSpendingByCategoryAndAccount: outflows (> 0) on credit accounts of the
   * budget (any OnBudget), split-aware; total and row count per category, card.
   */
  ccSpend: Map<CategoryKey, Map<number, { total: number; count: number }>>;
  /** getCCRefundsByCategoryAndAccount: non-transfer card inflows per category, card. */
  ccRefund: Map<CategoryKey, Map<number, number>>;
  /** Credit accounts (rows, not split-aware): SUM(Inflow - Outflow) per account. */
  cardNet: Map<number, number>;
  /** Credit accounts: transfer inflows (TransferID set, Inflow > 0) per account. */
  cardPayments: Map<number, number>;
  /** Cumulative RTA income: on-budget, non-transfer rows (not split-aware) per category. */
  income: Map<CategoryKey, number>;
  /** Legs with an off-budget non-debt partner, on-budget account, not excluded from RTA. */
  offBudgetTransfers: Map<CategoryKey, number>;
  inBudgetTransfers: Map<CategoryKey, number>;
}

export function emptyTxMonth(): TxMonth {
  return {
    nonCredit: new Map(),
    creditAccount: [],
    creditCategory: [],
    creditAmount: [],
    creditByCategory: new Map(),
    ccSpend: new Map(),
    ccRefund: new Map(),
    cardNet: new Map(),
    cardPayments: new Map(),
    income: new Map(),
    offBudgetTransfers: new Map(),
    inBudgetTransfers: new Map(),
  };
}

export function isEmptyTxMonth(m: TxMonth): boolean {
  return (
    m.nonCredit.size === 0 &&
    m.creditAmount.length === 0 &&
    m.ccSpend.size === 0 &&
    m.ccRefund.size === 0 &&
    m.cardNet.size === 0 &&
    m.cardPayments.size === 0 &&
    m.income.size === 0 &&
    m.offBudgetTransfers.size === 0 &&
    m.inBudgetTransfers.size === 0
  );
}

/** Appends one credit line (lines must arrive in ledger order). */
export function addCreditLine(
  m: TxMonth,
  accountId: number,
  categoryId: CategoryKey,
  amount: number
): void {
  m.creditAccount.push(accountId);
  m.creditCategory.push(categoryId);
  m.creditAmount.push(amount);
  m.creditByCategory.set(categoryId, (m.creditByCategory.get(categoryId) ?? 0) + amount);
}

/** Per-month sums of one budget, keyed by month index (see toMonthIndex). */
export interface BudgetData {
  tx: Map<number, TxMonth>;
  /** assignments.BudgetID = budget: SUM(Amount) per category. */
  assigned: Map<number, Map<number, number>>;
}

// ---------------------------------------------------------------- months

/** 'YYYY-MM' (month 01-12) -> year * 12 + month - 1; -1 for anything else. */
export function toMonthIndex(month: unknown): number {
  if (typeof month !== 'string' || month.length !== 7 || month[4] !== '-') return -1;
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  if (!/^\d{4}-\d{2}$/.test(month) || m < 1 || m > 12) return -1;
  return y * 12 + m - 1;
}

export function fromMonthIndex(index: number): string {
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/** Smallest and largest month index with any data (min > max when empty). */
export function dataMonthRange(data: BudgetData): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const k of data.tx.keys()) {
    if (k < min) min = k;
    if (k > max) max = k;
  }
  for (const k of data.assigned.keys()) {
    if (k < min) min = k;
    if (k > max) max = k;
  }
  return { min, max };
}

const add = <K>(map: Map<K, number>, key: K, v: number) => map.set(key, (map.get(key) ?? 0) + v);

// ---------------------------------------------------------------- cumulative reads

/**
 * Per category: assigned + activity of every month <= `monthIndex` (activity =
 * on-budget, split-aware lines). getMonthlyBudget's Available is exactly
 * `assigned_prior + activity_prior + assigned + activity`.
 */
export function availableThrough(data: BudgetData, monthIndex: number): Map<CategoryKey, number> {
  const out = new Map<CategoryKey, number>();
  for (const [m, byCat] of data.assigned) {
    if (m > monthIndex) continue;
    for (const [cat, v] of byCat) add(out, cat, v);
  }
  for (const [m, tx] of data.tx) {
    if (m > monthIndex) continue;
    for (const [cat, v] of tx.nonCredit) add(out, cat, v);
    for (const [cat, v] of tx.creditByCategory) add(out, cat, v);
  }
  return out;
}

/** Month-M activity per category (on-budget, split-aware), as activity_month. */
export function activityInMonth(data: BudgetData, monthIndex: number): Map<CategoryKey, number> {
  const out = new Map<CategoryKey, number>();
  const tx = data.tx.get(monthIndex);
  if (!tx) return out;
  for (const [cat, v] of tx.nonCredit) add(out, cat, v);
  for (const [cat, v] of tx.creditByCategory) add(out, cat, v);
  return out;
}

/** Sum of a per-account map over the months in [from, to] (inclusive). */
export function sumAccountsOver(
  data: BudgetData,
  pick: (m: TxMonth) => Map<number, number>,
  from: number,
  to: number
): Map<number, number> {
  const out = new Map<number, number>();
  for (const [m, tx] of data.tx) {
    if (m < from || m > to) continue;
    for (const [acc, v] of pick(tx)) add(out, acc, v);
  }
  return out;
}

/** Sum over months in [from, to] of a per-category map, restricted to `keep`. */
export function sumCategoriesOver(
  data: BudgetData,
  pick: (m: TxMonth) => Map<CategoryKey, number>,
  from: number,
  to: number,
  keep: (cat: CategoryKey) => boolean
): number {
  let total = 0;
  for (const [m, tx] of data.tx) {
    if (m < from || m > to) continue;
    for (const [cat, v] of pick(tx)) if (keep(cat)) total += v;
  }
  return total;
}

/** Sum of all assignments over months in [from, to]. */
export function sumAssignedOver(data: BudgetData, from: number, to: number): number {
  let total = 0;
  for (const [m, byCat] of data.assigned) {
    if (m < from || m > to) continue;
    for (const v of byCat.values()) total += v;
  }
  return total;
}

/**
 * getCCSpendingByCategoryAndAccount(M): per (category, card) the month-M and
 * prior totals of every pair with a row <= M, with the same Map insertion order
 * (pairs with month-M rows first, then prior-only pairs; each by CategoryID,
 * AccountID ascending).
 */
export function ccSpendingAt(
  data: BudgetData,
  monthIndex: number,
  keepCategory: (cat: CategoryKey) => boolean
): Map<number, Map<number, { current: number; prior: number }>> {
  const pairs = new Map<number, Map<number, { current: number; prior: number; rows: number }>>();
  for (const [m, tx] of data.tx) {
    if (m > monthIndex) continue;
    const isCurrent = m === monthIndex;
    for (const [cat, byCard] of tx.ccSpend) {
      if (cat === null || !keepCategory(cat)) continue;
      let p = pairs.get(cat);
      if (!p) pairs.set(cat, (p = new Map()));
      for (const [card, s] of byCard) {
        let e = p.get(card);
        if (!e) p.set(card, (e = { current: 0, prior: 0, rows: 0 }));
        if (isCurrent) {
          e.current += s.total;
          e.rows += s.count;
        } else e.prior += s.total;
      }
    }
  }
  const sorted: [number, number, { current: number; prior: number; rows: number }][] = [];
  for (const [cat, p] of pairs) for (const [card, e] of p) sorted.push([cat, card, e]);
  sorted.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const result = new Map<number, Map<number, { current: number; prior: number }>>();
  const ensure = (cat: number, card: number) => {
    let byAccount = result.get(cat);
    if (!byAccount) result.set(cat, (byAccount = new Map()));
    let entry = byAccount.get(card);
    if (!entry) byAccount.set(card, (entry = { current: 0, prior: 0 }));
    return entry;
  };
  for (const [cat, card, e] of sorted) if (e.rows > 0) ensure(cat, card).current = e.current;
  for (const [cat, card, e] of sorted) ensure(cat, card).prior = e.prior;
  return result;
}

/** Every month's card refunds as flat (month, category, card, amount) rows, for ccRefundsThrough. */
export interface RefundRows {
  month: number[];
  category: number[];
  card: number[];
  amount: number[];
}

export function ccRefundsFlat(
  data: BudgetData,
  keepCategory: (cat: CategoryKey) => boolean
): RefundRows {
  const out: RefundRows = { month: [], category: [], card: [], amount: [] };
  for (const [m, tx] of data.tx) {
    for (const [cat, byCard] of tx.ccRefund) {
      if (cat === null || !keepCategory(cat)) continue;
      for (const [card, v] of byCard) {
        out.month.push(m);
        out.category.push(cat);
        out.card.push(card);
        out.amount.push(v);
      }
    }
  }
  return out;
}

/** getCCRefundsByCategoryAndAccount(M): refunds of every month <= M per (category, card). */
export function ccRefundsThrough(
  rows: RefundRows,
  monthIndex: number
): Map<number, Map<number, number>> {
  const out = new Map<number, Map<number, number>>();
  for (let i = 0; i < rows.month.length; i++) {
    if (rows.month[i] > monthIndex) continue;
    let o = out.get(rows.category[i]);
    if (!o) out.set(rows.category[i], (o = new Map()));
    add(o, rows.card[i], rows.amount[i]);
  }
  return out;
}

// ---------------------------------------------------------------- monthly fold

export interface OverspendEvent {
  categoryId: number;
  month: number;
  amount: number;
  /** true for a CC Payment category (overpaid card), false for a spending category. */
  payment: boolean;
}

export interface PaymentSeries {
  previousAvailable: Float64Array;
  funded: Float64Array;
  payments: Float64Array;
  refunds: Float64Array;
  activity: Float64Array;
  raw: Float64Array;
}

/**
 * computeMonthlyRollforward for every month at once. The base fold runs over
 * the months with data up to the requested month; months without data leave
 * every carry unchanged (all carries are floored at 0 and carryCash <=
 * carryTotal), so folding every calendar month from the first data month to one
 * past the last gives the base's values at any requested month.
 */
export interface MonthlyFold {
  /** Folded months [first, last]; first > last when the budget has no data. */
  first: number;
  last: number;
  /** Spending category -> first month with a series row (assignment or ledger line). */
  presence: Map<number, number>;
  /** Spending category -> displayed available per month (index - first). */
  displayed: Map<number, Float64Array>;
  /** Overspend in every folded month, in the base's order. */
  overspend: OverspendEvent[];
  /** Per month: funding events (payment category, source category, amount) in order. */
  funding: Map<number, { paymentCategoryId: number; categoryId: number; amount: number }[]>;
  /** Payment category -> 'category|month' -> unfunded credit spend (merged). */
  debt: Map<number, Map<string, { categoryId: number; month: number; amount: number }>>;
  /** Payment category (cardToPaymentCat order) -> per-month series. */
  payment: Map<number, PaymentSeries>;
  /** Per month: credit lines' Cash per category (MONTHLY_ACTIVITY_CTE). */
  creditCash: Map<number, Map<CategoryKey, number>>;
  /** Per month: monthly-mode income (Income lines; credit lines also Transfers). */
  income: Map<number, number>;
}

export interface FoldMeta {
  /** Category ID -> its group's name (every category of every budget). */
  groupOf: Map<number, string>;
  /** Credit account -> CC payment category (getCCAccountPaymentCategoryMap order). */
  cardToPaymentCat: Map<number, number>;
}

const isSpendingGroup = (name: string | undefined) =>
  name !== undefined &&
  name !== GROUP_INCOME &&
  name !== GROUP_TRANSFERS &&
  name !== GROUP_CC_PAYMENTS;

export function foldMonthly(data: BudgetData, meta: FoldMeta): MonthlyFold {
  const { min, max } = dataMonthRange(data);
  const empty = !(min <= max);
  const first = empty ? 0 : min;
  const last = empty ? -1 : max + 1;
  const months = empty ? 0 : last - first + 1;
  const { groupOf, cardToPaymentCat } = meta;
  const spending = (cat: CategoryKey): cat is number =>
    cat !== null && isSpendingGroup(groupOf.get(cat));

  // 1. Credit ledger replay: running balance per credit account in ledger order.
  const balance = new Map<number, number>();
  const creditCash = new Map<number, Map<CategoryKey, number>>();
  const income = new Map<number, number>();
  // purchases[month][category] -> { card, spend } in funding order
  const purchases = new Map<number, Map<number, { card: number; spend: number }[]>>();
  for (let m = first; m <= last; m++) {
    const tx = data.tx.get(m);
    if (!tx) continue;
    let monthIncome = 0;
    let hasIncome = false;
    for (const [cat, v] of tx.nonCredit) {
      if (cat !== null && groupOf.get(cat) === GROUP_INCOME) {
        monthIncome += v;
        hasIncome = true;
      }
    }
    const cashByCat = new Map<CategoryKey, number>();
    let monthPurchases: Map<number, { card: number; spend: number }[]> | undefined;
    for (let i = 0; i < tx.creditAmount.length; i++) {
      const acc = tx.creditAccount[i];
      const cat = tx.creditCategory[i];
      const amount = tx.creditAmount[i];
      const after = (balance.get(acc) ?? 0) + amount;
      balance.set(acc, after);
      const cash = Math.max(0, after) - Math.max(0, after - amount);
      add(cashByCat, cat, cash);
      if (cat !== null) {
        const group = groupOf.get(cat);
        if (group === GROUP_INCOME || group === GROUP_TRANSFERS) {
          monthIncome += cash;
          hasIncome = true;
        }
        if (isSpendingGroup(group)) {
          const spend = cash - amount;
          if (spend !== 0) {
            monthPurchases ??= new Map();
            let list = monthPurchases.get(cat);
            if (!list) monthPurchases.set(cat, (list = []));
            list.push({ card: acc, spend });
          }
        }
      }
    }
    if (cashByCat.size > 0) creditCash.set(m, cashByCat);
    if (monthPurchases) purchases.set(m, monthPurchases);
    if (hasIncome) income.set(m, monthIncome);
  }

  // 2. Series presence of spending categories (base: assignments + ledger lines,
  // joined to an existing category in a spending group).
  const presence = new Map<number, number>();
  const mark = (cat: CategoryKey, m: number) => {
    if (!spending(cat)) return;
    const seen = presence.get(cat);
    if (seen === undefined || m < seen) presence.set(cat, m);
  };
  for (const [m, byCat] of data.assigned) for (const cat of byCat.keys()) mark(cat, m);
  for (const [m, tx] of data.tx) {
    for (const cat of tx.nonCredit.keys()) mark(cat, m);
    for (const cat of tx.creditByCategory.keys()) mark(cat, m);
  }

  // 3. Spending-category pass.
  const displayed = new Map<number, Float64Array>();
  const overspend: OverspendEvent[] = [];
  const funding = new Map<
    number,
    { paymentCategoryId: number; categoryId: number; amount: number }[]
  >();
  const fundedByPc = new Map<number, Float64Array>();
  const refundsByPc = new Map<number, Float64Array>();
  // payment category -> month -> refunds per spending category (#68)
  const refundRequests = new Map<number, Map<number, { categoryId: number; amount: number }[]>>();
  // spending category -> per month: assigned + cash activity, for the cash pass
  const cashBase = new Map<number, Float64Array>();
  const realizedRefunds = new Map<number, Float64Array>();
  const debt = new Map<
    number,
    Map<string, { categoryId: number; month: number; amount: number }>
  >();
  const series = (map: Map<number, Float64Array>, key: number) => {
    let arr = map.get(key);
    if (!arr) map.set(key, (arr = new Float64Array(months)));
    return arr;
  };

  const categories = [...presence.keys()].sort((a, b) => a - b);
  for (const categoryId of categories) {
    const values = new Float64Array(months);
    displayed.set(categoryId, values);
    const base = new Float64Array(months);
    cashBase.set(categoryId, base);
    let carryTotal = 0;
    for (let m = presence.get(categoryId)!; m <= last; m++) {
      const tx = data.tx.get(m);
      const assigned = data.assigned.get(m)?.get(categoryId) ?? 0;
      const creditAmount = tx?.creditByCategory.get(categoryId) ?? 0;
      const cashOfCredit = creditCash.get(m)?.get(categoryId) ?? 0;
      const cash = (tx?.nonCredit.get(categoryId) ?? 0) + cashOfCredit;
      const credit = creditAmount - cashOfCredit;

      const availableToCover = carryTotal + assigned + cash;
      const cards = purchases.get(m)?.get(categoryId) ?? [];
      const refunds = new Map<number, number>();
      for (const c of cards) {
        if (c.spend < 0) refunds.set(c.card, (refunds.get(c.card) ?? 0) - c.spend);
      }
      const bought = cards
        .filter((c) => c.spend > 0)
        .map((c) => {
          const refunded = Math.min(c.spend, refunds.get(c.card) ?? 0);
          refunds.set(c.card, (refunds.get(c.card) ?? 0) - refunded);
          return { card: c.card, spend: c.spend - refunded };
        });
      let remaining = Math.max(
        0,
        availableToCover + [...refunds.values()].reduce((sum, value) => sum + value, 0)
      );
      for (const c of bought) {
        const paymentCatId = cardToPaymentCat.get(c.card);
        if (!paymentCatId) continue;
        const funded = Math.min(c.spend, remaining);
        remaining -= funded;
        if (funded > 0) {
          let list = funding.get(m);
          if (!list) funding.set(m, (list = []));
          list.push({ paymentCategoryId: paymentCatId, categoryId, amount: funded });
          series(fundedByPc, paymentCatId)[m - first] += funded;
        }
        if (c.spend > funded) {
          let byKey = debt.get(paymentCatId);
          if (!byKey) debt.set(paymentCatId, (byKey = new Map()));
          const key = `${categoryId}|${m}`;
          const existing = byKey.get(key);
          if (existing) existing.amount += c.spend - funded;
          else byKey.set(key, { categoryId, month: m, amount: c.spend - funded });
        }
      }
      for (const [card, refund] of refunds) {
        const paymentCatId = cardToPaymentCat.get(card);
        if (!paymentCatId || refund === 0) continue;
        series(refundsByPc, paymentCatId)[m - first] += refund;
        let requests = refundRequests.get(paymentCatId);
        if (!requests) refundRequests.set(paymentCatId, (requests = new Map()));
        let list = requests.get(m);
        if (!list) requests.set(m, (list = []));
        list.push({ categoryId, amount: refund });
      }

      const shown = carryTotal + assigned + cash + credit;
      values[m - first] = shown;
      base[m - first] = assigned + cash;
      carryTotal = Math.max(0, shown);
    }
  }

  // 4. CC Payment-category pass. Payment overspend is listed after every
  // spending category's (the base's order).
  const paymentOverspend: OverspendEvent[] = [];
  const payment = new Map<number, PaymentSeries>();
  const paymentsByPc = new Map<number, Float64Array>();
  for (const [m, tx] of data.tx) {
    for (const [card, v] of tx.cardPayments) {
      const paymentCatId = cardToPaymentCat.get(card);
      if (!paymentCatId) continue;
      series(paymentsByPc, paymentCatId)[m - first] += v;
    }
  }
  for (const paymentCatId of new Set(cardToPaymentCat.values())) {
    const s: PaymentSeries = {
      previousAvailable: new Float64Array(months),
      funded: new Float64Array(months),
      payments: new Float64Array(months),
      refunds: new Float64Array(months),
      activity: new Float64Array(months),
      raw: new Float64Array(months),
    };
    payment.set(paymentCatId, s);
    const isPaymentGroup = groupOf.get(paymentCatId) === GROUP_CC_PAYMENTS;
    const fundedArr = fundedByPc.get(paymentCatId);
    const refundsArr = refundsByPc.get(paymentCatId);
    const paymentsArr = paymentsByPc.get(paymentCatId);
    let carry = 0;
    for (let m = first; m <= last; m++) {
      const i = m - first;
      const assigned = isPaymentGroup ? (data.assigned.get(m)?.get(paymentCatId) ?? 0) : 0;
      const funded = fundedArr ? fundedArr[i] : 0;
      const payments = paymentsArr ? paymentsArr[i] : 0;
      const refunded = Math.min(
        refundsArr ? refundsArr[i] : 0,
        Math.max(0, carry + assigned + funded)
      );
      // Realized refund back to the categories: ascending CategoryID, each up
      // to its own refund (as computeMonthlyRollforward).
      const requests = refunded > 0 ? refundRequests.get(paymentCatId)?.get(m) : undefined;
      if (requests) {
        let left = refunded;
        for (const r of [...requests].sort((a, b) => a.categoryId - b.categoryId)) {
          const share = Math.min(r.amount, left);
          if (share <= 0) break;
          left -= share;
          series(realizedRefunds, r.categoryId)[i] += share;
        }
      }
      const activity = funded - payments - refunded;
      const raw = carry + assigned + activity;
      s.previousAvailable[i] = carry;
      s.funded[i] = funded;
      s.payments[i] = payments;
      s.refunds[i] = refunded;
      s.activity[i] = activity;
      s.raw[i] = raw;
      if (raw < 0)
        paymentOverspend.push({ categoryId: paymentCatId, month: m, amount: -raw, payment: true });
      carry = Math.max(0, raw);
    }
  }

  // 5. Spending-category cash pass: carried cash + assigned + cash activity +
  // the refund that came back out of a CC Payment category (#68).
  for (const categoryId of categories) {
    const values = displayed.get(categoryId)!;
    const base = cashBase.get(categoryId)!;
    const refunds = realizedRefunds.get(categoryId);
    let carryCash = 0;
    for (let m = presence.get(categoryId)!; m <= last; m++) {
      const i = m - first;
      const rawCash = carryCash + base[i] + (refunds ? refunds[i] : 0);
      if (rawCash < 0) overspend.push({ categoryId, month: m, amount: -rawCash, payment: false });
      carryCash = Math.max(0, Math.min(rawCash, values[i]));
    }
  }
  overspend.push(...paymentOverspend);

  return {
    first,
    last,
    presence,
    displayed,
    overspend,
    funding,
    debt,
    payment,
    creditCash,
    income,
  };
}

/** Live names for the overspend details (categories of the budget). */
export type CategoryNames = Map<number, { name: string; groupName: string }>;

export interface RollforwardAt {
  availableByCategory: Map<number, number>;
  paymentAvailableByCategory: Map<number, number>;
  paymentActivityByCategory: Map<number, number>;
  paymentCalculationByCategory: Map<
    number,
    { previousAvailable: number; funded: number; payments: number; refunds: number }
  >;
  currentFundingByPaymentCategory: Map<number, Map<number, number>>;
  debtBreakdownByPaymentCat: Map<number, { categoryId: number; month: string; amount: number }[]>;
  priorCashOverspend: number;
  priorCashOverspendDetails: {
    categoryId: number;
    categoryName: string;
    categoryGroupName: string;
    month: string;
    amount: number;
  }[];
}

/** Overspend charged before `monthIndex`, with the base's names and order. */
export function overspendBefore(
  fold: MonthlyFold,
  monthIndex: number,
  names: CategoryNames
): RollforwardAt['priorCashOverspendDetails'] {
  const out: RollforwardAt['priorCashOverspendDetails'] = [];
  for (const e of fold.overspend) {
    if (e.month >= monthIndex) continue;
    const meta = names.get(e.categoryId);
    out.push({
      categoryId: e.categoryId,
      categoryName:
        meta?.name ??
        (e.payment ? `Payment Category #${e.categoryId}` : `Category #${e.categoryId}`),
      categoryGroupName: meta?.groupName ?? (e.payment ? GROUP_CC_PAYMENTS : 'Unknown Group'),
      month: fromMonthIndex(e.month),
      amount: e.amount,
    });
  }
  return out;
}

/** computeMonthlyRollforward(budget, month) read from a fold. */
export function rollforwardAt(
  fold: MonthlyFold,
  monthIndex: number,
  names: CategoryNames
): RollforwardAt {
  const before = monthIndex < fold.first || fold.first > fold.last;
  const i = before ? -1 : Math.min(monthIndex, fold.last) - fold.first;

  const availableByCategory = new Map<number, number>();
  if (!before) {
    for (const [cat, values] of fold.displayed) {
      if (fold.presence.get(cat)! <= monthIndex) availableByCategory.set(cat, values[i]);
    }
  }

  const paymentAvailableByCategory = new Map<number, number>();
  const paymentActivityByCategory = new Map<number, number>();
  const paymentCalculationByCategory: RollforwardAt['paymentCalculationByCategory'] = new Map();
  for (const [pc, s] of fold.payment) {
    const at = (arr: Float64Array) => (before ? 0 : arr[i]);
    paymentAvailableByCategory.set(pc, at(s.raw));
    paymentActivityByCategory.set(pc, at(s.activity));
    paymentCalculationByCategory.set(pc, {
      previousAvailable: at(s.previousAvailable),
      funded: at(s.funded),
      payments: at(s.payments),
      refunds: at(s.refunds),
    });
  }

  const currentFundingByPaymentCategory = new Map<number, Map<number, number>>();
  for (const e of fold.funding.get(monthIndex) ?? []) {
    let sources = currentFundingByPaymentCategory.get(e.paymentCategoryId);
    if (!sources) currentFundingByPaymentCategory.set(e.paymentCategoryId, (sources = new Map()));
    sources.set(e.categoryId, (sources.get(e.categoryId) ?? 0) + e.amount);
  }

  const debtBreakdownByPaymentCat: RollforwardAt['debtBreakdownByPaymentCat'] = new Map();
  for (const [pc, byKey] of fold.debt) {
    const events = [...byKey.values()]
      .filter((e) => e.month <= monthIndex && e.amount > 0)
      .map((e) => ({ categoryId: e.categoryId, month: fromMonthIndex(e.month), amount: e.amount }))
      .sort((a, b) => a.month.localeCompare(b.month));
    if (events.length > 0) debtBreakdownByPaymentCat.set(pc, events);
  }

  const priorCashOverspendDetails = overspendBefore(fold, monthIndex, names);
  const priorCashOverspend = priorCashOverspendDetails.reduce((sum, o) => sum + o.amount, 0);

  return {
    availableByCategory,
    paymentAvailableByCategory,
    paymentActivityByCategory,
    paymentCalculationByCategory,
    currentFundingByPaymentCategory,
    debtBreakdownByPaymentCat,
    priorCashOverspend,
    priorCashOverspendDetails,
  };
}

/** Month-M cash / credit activity per category (getActivityByAccountKind). */
export function activityByKindAt(
  data: BudgetData,
  fold: MonthlyFold | null,
  monthIndex: number
): Map<number, { cash: number; credit: number }> {
  const out = new Map<number, { cash: number; credit: number }>();
  const tx = data.tx.get(monthIndex);
  if (!tx) return out;
  const credits = fold?.creditCash.get(monthIndex);
  for (const [cat, v] of tx.nonCredit) {
    if (cat === null) continue;
    out.set(cat, { cash: v, credit: 0 });
  }
  for (const [cat, amount] of tx.creditByCategory) {
    if (cat === null) continue;
    // cumulative mode: credit = the whole credit amount; monthly: split by balance
    const cash = fold ? (credits?.get(cat) ?? 0) : 0;
    const e = out.get(cat) ?? { cash: 0, credit: 0 };
    e.cash += cash;
    e.credit += amount - cash;
    out.set(cat, e);
  }
  return out;
}
