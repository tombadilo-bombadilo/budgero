// Bench cases: single queries, P19 budget-engine detail, and end-to-end UI
// interactions modelled as "mutation + every query TanStack Query refetches on
// the mounted page + local persist".
//
// The app model below mirrors packages/app at 4dc2161 (`app: 'old'`) and the
// query fixes of audit/queries d77b957 (`app: 'new'`: aggregate future-balance and
// uncategorized-count queries, date-bounded Upcoming card, batch toolbar without
// a register refetch). `app: 'refetch'` adds perf/app-refetch on top of 'new':
// visible budget months only (P20), one RTA breakdown entry (P8), category picker
// figures loaded on open (P9), per-column cell-edit invalidation (P24), payee
// names query (P23), bounded uncategorized card and aggregated net worth (P25).
// `auto` picks the newest model the core supports.
// Invalidation sets come from shared/mutations/op-code-registry (see README).

const MONTH = (d) => d.slice(0, 7);
export function shiftMonth(month, delta) {
  let y = +month.slice(0, 4),
    m = +month.slice(5, 7) + delta;
  while (m > 12) {
    m -= 12;
    y++;
  }
  while (m < 1) {
    m += 12;
    y--;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}
// Same day one month earlier (the net-worth window start for the default 1 month).
const shiftDay = (day, months) => `${shiftMonth(day.slice(0, 7), months)}${day.slice(7)}`;
const addDays = (day, n) => {
  const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + n));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

export function makeContext({ services: s, adapter, info, today, app, runtime = {} }) {
  const budgetId = info.budgetId;
  const month = MONTH(today);
  const ids = info.accountIds;
  const appMode =
    app === 'auto'
      ? typeof s.transactions.getBalanceHistoryRows === 'function'
        ? 'refetch'
        : typeof s.transactions.getUncategorizedCountsByAccount === 'function'
          ? 'new'
          : 'old'
      : app;
  const accounts = s.accounts.listAccounts(budgetId);
  const goals = s.goals
    .getAllGoals()
    .filter((g) => g.Type === 'yearly' || g.Type === 'target-date');
  const rows = (sql, ...p) => adapter.prepare(sql).all(...p);
  const chk0Ids = rows(
    'SELECT ID FROM transactions WHERE AccountID=? AND TransferID IS NULL AND Date <= ? ORDER BY Date DESC, ID DESC',
    ids.chk0,
    today
  ).map((r) => r.ID);
  const oldIds = rows(
    'SELECT ID FROM transactions WHERE AccountID=? AND TransferID IS NULL AND Date LIKE ? ORDER BY ID',
    ids.chk0,
    `${shiftMonth(month, -60).slice(0, 4)}-%`
  ).map((r) => r.ID);
  // shorter histories: fall back to the oldest year on file
  if (!oldIds.length) {
    oldIds.push(
      ...rows(
        'SELECT ID FROM transactions WHERE AccountID=? AND TransferID IS NULL ORDER BY Date, ID LIMIT 200',
        ids.chk0
      ).map((r) => r.ID)
    );
  }
  return {
    s,
    adapter,
    info,
    budgetId,
    month,
    today,
    ids,
    appMode,
    runtime,
    accounts,
    goals,
    chk0Ids,
    oldIds,
    spendCats: info.spendCats,
    rows,
  };
}

// ---------------- refetch sets per mounted page ----------------
const q = (name, fn) => ({ name, fn });
const isRefetch = (c) => c.appMode === 'refetch';
// Which part of the register a transactions.updateColumn edit refreshes (P24).
const VALUE_COLUMNS = new Set(['amount', 'category', 'date', 'account']);

export function globalQueries(c, { column } = {}) {
  // memo/payee edits (refetch model) leave listAccounts alone; the counts sit
  // under the allTransactions root and still refresh.
  const skipAccounts = isRefetch(c) && column && !VALUE_COLUMNS.has(column);
  return [
    ...(skipAccounts ? [] : [q('listAccounts', () => c.s.accounts.listAccounts(c.budgetId))]),
    c.appMode !== 'old'
      ? q('uncategorizedCounts', () => c.s.transactions.getUncategorizedCountsByAccount(c.budgetId))
      : q('getAllTransactions(badge)', () => c.s.transactions.getAllTransactions(c.budgetId)),
  ];
}

export function budgetPageQueries(c, month = c.month) {
  const list = [];
  for (let k = 0; k < (isRefetch(c) ? 1 : 6); k++)
    list.push(
      q(`getMonthlyBudget(+${k})`, () =>
        c.s.monthlyBudgets.getMonthlyBudget(shiftMonth(month, k), c.budgetId)
      )
    );
  list.push(q('getAllGoals', () => c.s.goals.getAllGoals()));
  list.push(
    q('cycleFinancials', () =>
      c.goals.forEach((g) => c.s.goals.getCategoryFinancials(g.CategoryID, month))
    )
  );
  if (!isRefetch(c))
    list.push(q('getReadyToAssign', () => c.s.monthlyBudgets.getReadyToAssign(c.budgetId, month)));
  list.push(
    q('getReadyToAssignBreakdown', () =>
      c.s.monthlyBudgets.getReadyToAssignBreakdown(c.budgetId, month)
    )
  );
  list.push(q('getAllCategories', () => c.s.categories.getAllCategories(c.budgetId)));
  return list;
}

export function registerPageQueries(
  c,
  accountId = c.ids.chk0,
  { onlyInvalidated = false, column } = {}
) {
  if (isRefetch(c)) {
    // Picker figures load when a picker opens (P9); cell edits refresh by column (P24).
    const edit = onlyInvalidated ? column : undefined;
    const list = [
      q('register page 1', () =>
        c.s.transactions.getTransactionsByAccountPage(accountId, { limit: 200 })
      ),
      q('accountSummary', () => c.s.transactions.getAccountTransactionSummary(accountId)),
    ];
    if (!edit || edit === 'payee')
      list.push(q('payeeNames', () => c.s.payees.getPayeeNames(c.budgetId)));
    if (!edit || edit === 'label')
      list.push(q('labelsWithUsage', () => c.s.labels.getLabelsWithUsage(c.budgetId)));
    if (!onlyInvalidated) list.push(...registerStaticQueries(c, accountId));
    return list;
  }
  const list = [
    q('register page 1', () =>
      c.s.transactions.getTransactionsByAccountPage(accountId, { limit: 200 })
    ),
    q('accountSummary', () => c.s.transactions.getAccountTransactionSummary(accountId)),
    q('getMonthlyBudget(picker)', () => c.s.monthlyBudgets.getMonthlyBudget(c.month, c.budgetId)),
    q('getReadyToAssign(picker)', () => c.s.monthlyBudgets.getReadyToAssign(c.budgetId)),
    q('payeesWithUsage', () => c.s.payees.getPayeesWithUsage(c.budgetId)),
    q('labelsWithUsage', () => c.s.labels.getLabelsWithUsage(c.budgetId)),
  ];
  // The base app already passes a payee/label-free set for amount edits
  // (AMOUNT_UPDATE_INVALIDATIONS in entities/transaction/api/mutations.ts).
  if (onlyInvalidated && column === 'amount' && c.appMode === 'new')
    return list.filter((x) => !/payees|labels/.test(x.name));
  if (!onlyInvalidated) list.push(...registerStaticQueries(c, accountId));
  return list;
}

function registerStaticQueries(c, accountId) {
  const list = [];
  list.push(
    q('categories+groups', () => {
      c.s.categories.getAllCategories(c.budgetId);
      c.s.categories.getAllCategoryGroups(c.budgetId);
    })
  );
  list.push(
    q('postedOccurrences', () =>
      c.s.recurring.listOccurrences(c.budgetId, { status: ['ready'], accountId })
    )
  );
  list.push(
    q('projectedTransactions', () =>
      c.s.recurring.listProjectedTransactions(c.budgetId, { accountId })
    )
  );
  return list;
}

export function dashboardQueries(c) {
  const from = addDays(c.today, -30),
    prevFrom = addDays(c.today, -61),
    prevTo = addDays(c.today, -31);
  const monthsInRange = [MONTH(from), c.month].filter((m, i, a) => a.indexOf(m) === i);
  return [
    q('onBudgetBalance', () => c.s.analytics.getOnBudgetBalance(c.budgetId)),
    q('onBudgetBalanceByDates x2', () => {
      c.s.analytics.getOnBudgetBalanceByDates(from, c.today, c.budgetId);
      c.s.analytics.getOnBudgetBalanceByDates(prevFrom, prevTo, c.budgetId);
    }),
    q('spendingByDatesByCategories x2', () => {
      c.s.analytics.getSpendingByDatesByCategories(from, c.today, c.budgetId);
      c.s.analytics.getSpendingByDatesByCategories(prevFrom, prevTo, c.budgetId);
    }),
    q('totalAssignedForBudgetPace x2', () => {
      c.s.monthlyBudgets.getTotalAssignedForBudgetPace(monthsInRange, c.budgetId);
      c.s.monthlyBudgets.getTotalAssignedForBudgetPace([c.month], c.budgetId);
    }),
    q('incomeExpenseByPeriod', () =>
      c.s.analytics.getIncomeExpenseByPeriod(from, c.today, c.budgetId, 'week')
    ),
    q('allAccountsMonthlyTransactions', () => allAccountsMonthlyTransactions(c)),
    q('getMonthlyBudget(current)', () => c.s.monthlyBudgets.getMonthlyBudget(c.month, c.budgetId)),
    q('goals+cycleFinancials', () => {
      c.s.goals.getAllGoals();
      c.goals.forEach((g) => c.s.goals.getCategoryFinancials(g.CategoryID, c.month));
    }),
    isRefetch(c)
      ? q('readyToAssignBreakdown(current)', () =>
          c.s.monthlyBudgets.getReadyToAssignBreakdown(c.budgetId, c.month)
        )
      : q('getReadyToAssign(current)', () => c.s.monthlyBudgets.getReadyToAssign(c.budgetId)),
    c.appMode !== 'old'
      ? q('upcoming: getAllTransactionsDetailed(afterDate)', () =>
          c.s.transactions.getAllTransactionsDetailed(c.budgetId, c.today)
        )
      : q('upcoming: getAllTransactionsDetailed', () =>
          c.s.transactions.getAllTransactionsDetailed(c.budgetId)
        ),
    q('upcoming occurrences', () =>
      c.s.recurring.listOccurrences(c.budgetId, {
        status: ['scheduled', 'ready'],
        fromDate: c.today,
        toDate: addDays(c.today, 30),
      })
    ),
    isRefetch(c)
      ? q('uncategorized card: recent 6', () =>
          c.s.transactions.getRecentUncategorizedTransactions(c.budgetId, 6)
        )
      : q('uncategorized card: getAllTransactions', () =>
          c.s.transactions.getAllTransactions(c.budgetId)
        ),
  ];
}

export function accountsPageQueries(c) {
  return [
    q('listAccounts', () => c.s.accounts.listAccounts(c.budgetId)),
    isRefetch(c)
      ? q('netWorth+assetHistory: balance history rows (day 1 mo + month 24 mo)', () => {
          c.s.transactions.getBalanceHistoryRows(c.budgetId, shiftDay(c.today, -1), 'day');
          c.s.transactions.getBalanceHistoryRows(
            c.budgetId,
            `${shiftMonth(c.month, -23)}-01`,
            'month'
          );
        })
      : q('netWorth+assetHistory: getAllTransactions', () =>
          c.s.transactions.getAllTransactions(c.budgetId)
        ),
    q('budgetRevaluations', () => c.s.currency.getBudgetRevaluations(c.budgetId)),
    c.appMode !== 'old'
      ? q('futureBalanceAdjustments', () =>
          c.s.transactions.getFutureBalanceAdjustments(c.budgetId, c.today)
        )
      : q('futureBalance: getTransactionsByAccount x30', () =>
          c.accounts.forEach((a) => c.s.transactions.getTransactionsByAccount(a.ID))
        ),
  ];
}

export function reportsPageQueries(c) {
  return [
    q('getAllTransactionsAnalytics', () =>
      c.s.transactions.getAllTransactionsAnalytics(c.budgetId)
    ),
    q('categories+groups+labels', () => {
      c.s.categories.getAllCategories(c.budgetId);
      c.s.categories.getAllCategoryGroups(c.budgetId);
      c.s.labels.getLabelsWithUsage(c.budgetId);
    }),
  ];
}

// ---------------- single-query cases ----------------
export function queryCases(c) {
  const mid = shiftMonth(c.month, -60);
  const page1 = c.s.transactions.getTransactionsByAccountPage(c.ids.chk0, { limit: 200 });
  let cursor = page1.nextCursor;
  for (let k = 0; k < 9 && cursor; k++)
    cursor = c.s.transactions.getTransactionsByAccountPage(c.ids.chk0, {
      limit: 200,
      cursor,
    }).nextCursor;
  const from = addDays(c.today, -30);
  const budget = [
    ['getMonthlyBudget current', () => c.s.monthlyBudgets.getMonthlyBudget(c.month, c.budgetId)],
    [
      'getMonthlyBudget mid-history (-60 mo)',
      () => c.s.monthlyBudgets.getMonthlyBudget(mid, c.budgetId),
    ],
    [
      'getMonthlyBudget month switch (alternating)',
      (i) =>
        c.s.monthlyBudgets.getMonthlyBudget(i % 2 ? shiftMonth(c.month, -1) : c.month, c.budgetId),
    ],
    ['getReadyToAssign', () => c.s.monthlyBudgets.getReadyToAssign(c.budgetId, c.month)],
    [
      'getReadyToAssignBreakdown',
      () => c.s.monthlyBudgets.getReadyToAssignBreakdown(c.budgetId, c.month),
    ],
  ];
  const other = [
    [
      'register page (200 rows, first)',
      () => c.s.transactions.getTransactionsByAccountPage(c.ids.chk0, { limit: 200 }),
    ],
    [
      'register page (200 rows, 10 pages deep)',
      () => c.s.transactions.getTransactionsByAccountPage(c.ids.chk0, { limit: 200, cursor }),
    ],
    [
      'full register getTransactionsByAccount (main checking)',
      () => c.s.transactions.getTransactionsByAccount(c.ids.chk0),
    ],
    ['listAccounts', () => c.s.accounts.listAccounts(c.budgetId)],
    ['getAllTransactionsDetailed', () => c.s.transactions.getAllTransactionsDetailed(c.budgetId)],
    ['getAllTransactionsAnalytics', () => c.s.transactions.getAllTransactionsAnalytics(c.budgetId)],
    ['getAllTransactions', () => c.s.transactions.getAllTransactions(c.budgetId)],
    ['payeesWithUsage', () => c.s.payees.getPayeesWithUsage(c.budgetId)],
    ...(typeof c.s.payees.getPayeeNames === 'function'
      ? [['payeeNames', () => c.s.payees.getPayeeNames(c.budgetId)]]
      : []),
    ...(typeof c.s.transactions.getBalanceHistoryRows === 'function'
      ? [
          [
            'recentUncategorized (6)',
            () => c.s.transactions.getRecentUncategorizedTransactions(c.budgetId, 6),
          ],
          [
            'balanceHistoryRows (day, 1 month)',
            () => c.s.transactions.getBalanceHistoryRows(c.budgetId, shiftDay(c.today, -1), 'day'),
          ],
          [
            'balanceHistoryRows (month, 24 months)',
            () =>
              c.s.transactions.getBalanceHistoryRows(
                c.budgetId,
                `${shiftMonth(c.month, -23)}-01`,
                'month'
              ),
          ],
        ]
      : []),
    ['labelsWithUsage', () => c.s.labels.getLabelsWithUsage(c.budgetId)],
    [
      'dash: onBudgetBalanceByDates (30d)',
      () => c.s.analytics.getOnBudgetBalanceByDates(from, c.today, c.budgetId),
    ],
    [
      'dash: spendingByDatesByCategories (30d)',
      () => c.s.analytics.getSpendingByDatesByCategories(from, c.today, c.budgetId),
    ],
    [
      'dash: incomeExpenseByPeriod (30d, week)',
      () => c.s.analytics.getIncomeExpenseByPeriod(from, c.today, c.budgetId, 'week'),
    ],
    ['dash: allAccountsMonthlyTransactions (30 accts)', () => allAccountsMonthlyTransactions(c)],
    ['dash: onBudgetBalance', () => c.s.analytics.getOnBudgetBalance(c.budgetId)],
  ];
  return { budget, other };
}

/** AtAGlance: one query for every account where the core has it (P16), else one per account. */
function allAccountsMonthlyTransactions(c) {
  if (typeof c.s.transactions.getTransactionsByAccountsAndMonth === 'function')
    return c.s.transactions.getTransactionsByAccountsAndMonth(
      c.accounts.map((a) => a.ID),
      c.month
    );
  return c.accounts.flatMap((a) =>
    c.s.transactions.getTransactionsByAccountAndMonth(a.ID, c.month)
  );
}

// ---------------- P19: getMonthlyBudget / RTA anatomy ----------------
const NO_SPLITS =
  'AND NOT EXISTS (SELECT 1 FROM transaction_splits s2 WHERE s2.TransactionID = t.ID)';
/** SQL fragments copied from monthly-budgets/queries.ts @4dc2161 so each CTE can be timed alone. */
export const MB_FRAGMENTS = {
  'cte activity_month (=M)': `SELECT category_id, SUM(net) FROM (
      SELECT s.CategoryID AS category_id, SUM(s.InflowConverted - s.OutflowConverted) AS net FROM transaction_splits s JOIN transactions t ON t.ID = s.TransactionID JOIN accounts a ON a.ID = t.AccountID WHERE t.BudgetID = ?2 AND t.Month = ?1 AND a.OnBudget = TRUE GROUP BY s.CategoryID
      UNION ALL SELECT t.CategoryID, SUM(t.InflowConverted - t.OutflowConverted) FROM transactions t JOIN accounts a ON a.ID = t.AccountID WHERE t.BudgetID = ?2 AND t.Month = ?1 AND a.OnBudget = TRUE ${NO_SPLITS} GROUP BY t.CategoryID) GROUP BY category_id`,
  'cte activity_prior (<M, all history)': `SELECT category_id, SUM(net) FROM (
      SELECT s.CategoryID AS category_id, SUM(s.InflowConverted - s.OutflowConverted) AS net FROM transaction_splits s JOIN transactions t ON t.ID = s.TransactionID JOIN accounts a ON a.ID = t.AccountID WHERE t.BudgetID = ?2 AND t.Month < ?1 AND a.OnBudget = TRUE GROUP BY s.CategoryID
      UNION ALL SELECT t.CategoryID, SUM(t.InflowConverted - t.OutflowConverted) FROM transactions t JOIN accounts a ON a.ID = t.AccountID WHERE t.BudgetID = ?2 AND t.Month < ?1 AND a.OnBudget = TRUE ${NO_SPLITS} GROUP BY t.CategoryID) GROUP BY category_id`,
  'cte transaction_counts (all-time, delete dialog only)': `SELECT category_id, SUM(count) FROM (
      SELECT t.CategoryID AS category_id, COUNT(*) AS count FROM transactions t WHERE t.BudgetID = ?2 ${NO_SPLITS} GROUP BY t.CategoryID
      UNION ALL SELECT s.CategoryID, COUNT(*) FROM transaction_splits s JOIN transactions t ON t.ID = s.TransactionID WHERE t.BudgetID = ?2 GROUP BY s.CategoryID) GROUP BY category_id`,
  'cte assignment_totals (assigned + assigned_prior)': `SELECT a.CategoryID, SUM(CASE WHEN a.Month = ?1 THEN a.Amount ELSE 0 END), SUM(CASE WHEN a.Month < ?1 THEN a.Amount ELSE 0 END) FROM assignments a WHERE a.BudgetID = ?2 AND a.Month <= ?1 GROUP BY a.CategoryID`,
};

export function p19Cases(c, Q) {
  // Q = new MonthlyBudgetQueries(adapter) of the core under test (null if not exported)
  const m = c.month,
    b = c.budgetId;
  const list = [];
  for (const [name, sql] of Object.entries(MB_FRAGMENTS))
    list.push([`[old SQL] ${name}`, () => c.adapter.prepare(sql).all(m, b)]);
  if (Q) {
    const has = (k) => typeof Q[k] === 'function';
    list.push(['queries.getMonthlyBudget (main SQL)', () => Q.getMonthlyBudget(m, b)]);
    if (has('getActivityByAccountKind')) {
      list.push([
        'getActivityByAccountKind (cumulative)',
        () => Q.getActivityByAccountKind(m, b, false),
      ]);
      list.push([
        'getActivityByAccountKind (monthly: ledger window)',
        () => Q.getActivityByAccountKind(m, b, true),
      ]);
    }
    if (has('getCCPaymentAdjustments'))
      list.push([
        'CC: getCCPaymentAdjustments (2 sums per card)',
        () => Q.getCCPaymentAdjustments(m, b),
      ]);
    if (has('getCCSpendingByCategoryAndAccount'))
      list.push([
        'CC: getCCSpendingByCategoryAndAccount (=M and <M)',
        () => Q.getCCSpendingByCategoryAndAccount(m, b),
      ]);
    if (has('getCCAccountBalances'))
      list.push(['CC: getCCAccountBalances', () => Q.getCCAccountBalances(m, b)]);
    if (has('getCCAccountPaymentCategoryMap'))
      list.push(['CC: getCCAccountPaymentCategoryMap', () => Q.getCCAccountPaymentCategoryMap(b)]);
    if (has('getAssignedPriorToMonth'))
      list.push([
        'CC: getAssignedPriorToMonth x cards',
        () => c.info.cards.forEach(() => Q.getAssignedPriorToMonth(c.spendCats[0], m)),
      ]);
    if (has('computeMonthlyRollforward'))
      list.push([
        'computeMonthlyRollforward (monthly mode, from first month)',
        () => Q.computeMonthlyRollforward(b, m),
      ]);
    if (has('readyToAssign'))
      list.push(['readyToAssign (cumulative, 5 sums)', () => Q.readyToAssign(b, c.today)]);
    if (has('readyToAssignMonthlyBatch'))
      list.push([
        'readyToAssignMonthlyBatch (monthly, incl. rollforward)',
        () => Q.readyToAssignMonthlyBatch(b, [m]),
      ]);
  }
  return list;
}

/** Mutations that run (untimed) before a timed budget read, for "right after an edit" cases. */
export function p19Mutations(c) {
  let k = 0;
  return {
    'after current-month tx edit': async () => {
      const id = c.chk0Ids[(k++ * 7) % 50];
      await c.s.transactions.updateTransactionColumn(id, 'OutflowNative', 1000 * (10 + (k % 50)));
    },
    'after assignment': async () => {
      c.s.monthlyBudgets.upsertMonthlyAssignment(
        c.spendCats[k++ % 40],
        1000 * (100 + (k % 13)),
        c.month,
        c.budgetId
      );
    },
    'after back-dated (5y) edit': async () => {
      const id = c.oldIds[(k++ * 13) % c.oldIds.length];
      await c.s.transactions.updateTransactionColumn(id, 'OutflowNative', 1000 * (10 + (k % 50)));
    },
  };
}

// ---------------- interactions ----------------
/**
 * Each interaction returns { mutation: async fn, refetch: [{name, fn}], persists: n }.
 * persists = number of local DB persists (export + LZ4 + AES + OPFS) the runtime does.
 */
export function interactions(c) {
  let k = 0;
  const nextId = () => c.chk0Ids[(k++ * 7) % Math.min(400, c.chk0Ids.length)];
  const cat = () => c.spendCats[(k * 3) % 60];
  const reg = (opts) => [...registerPageQueries(c, c.ids.chk0, opts)];
  const regInv = (column) => () => [
    ...reg({ onlyInvalidated: true, column }),
    ...globalQueries(c, { column }),
  ];
  const continuousRules = () =>
    c.s.rules.listRules(c.budgetId).filter((r) => r.enabled && r.mode === 'continuous');
  const runContinuous = async (txId) => {
    for (const r of continuousRules())
      await c.s.rules.executeRule(r.id, { trigger: 'continuous', transactionIds: [txId] });
  };
  // P10: bank sync runs each continuous rule once over the batch it created
  const runContinuousBatch = async (txIds) => {
    for (const r of continuousRules())
      await c.s.rules.executeRule(r.id, { trigger: 'continuous', transactionIds: txIds });
  };
  let delPool = null;
  return {
    'open budget page': {
      refetch: () => [...globalQueries(c), ...budgetPageQueries(c)],
      persists: 0,
    },
    'switch month (uncached month)': {
      refetch: () => {
        const m = shiftMonth(c.month, -1 - (k++ % 24));
        return [
          q('getMonthlyBudget(new month)', () =>
            c.s.monthlyBudgets.getMonthlyBudget(m, c.budgetId)
          ),
          ...(isRefetch(c)
            ? []
            : [
                q('getReadyToAssign(new month)', () =>
                  c.s.monthlyBudgets.getReadyToAssign(c.budgetId, m)
                ),
              ]),
          q('getReadyToAssignBreakdown(new month)', () =>
            c.s.monthlyBudgets.getReadyToAssignBreakdown(c.budgetId, m)
          ),
          q('cycleFinancials', () =>
            c.goals.forEach((g) => c.s.goals.getCategoryFinancials(g.CategoryID, m))
          ),
        ];
      },
      persists: 0,
    },
    'assign money in a category': {
      mutation: async () => {
        c.s.monthlyBudgets.getMonthlyAssignmentValues([
          { categoryId: cat(), month: c.month, budgetId: c.budgetId },
        ]);
        c.s.monthlyBudgets.upsertMonthlyAssignment(
          cat(),
          1000 * (50 + (k++ % 40)),
          c.month,
          c.budgetId
        );
      },
      refetch: () =>
        budgetPageQueries(c).filter(
          (x) => x.name !== 'getAllGoals' && x.name !== 'getAllCategories'
        ),
      persists: 1,
    },
    'open account register': { refetch: () => [...globalQueries(c), ...reg()], persists: 0 },
    'scroll register (next page)': {
      refetch: () => {
        let cur = null;
        const n = 1 + (k++ % 5);
        for (let j = 0; j < n; j++)
          cur = c.s.transactions.getTransactionsByAccountPage(c.ids.chk0, {
            limit: 200,
            cursor: cur,
          }).nextCursor;
        return [
          q('next page', () =>
            c.s.transactions.getTransactionsByAccountPage(c.ids.chk0, { limit: 200, cursor: cur })
          ),
        ];
      },
      persists: 0,
    },
    'edit amount cell': {
      mutation: async () => {
        const id = nextId();
        c.s.transactions.getTransactionByID(id);
        await c.s.transactions.updateTransactionColumn(id, 'OutflowNative', 1000 * (5 + (k % 90)));
      },
      refetch: regInv('amount'),
      persists: 1,
    },
    'edit memo cell': {
      mutation: async () => {
        const id = nextId();
        c.s.transactions.getTransactionByID(id);
        await c.s.transactions.updateTransactionColumn(id, 'Memo', `bench memo ${k % 97}`);
      },
      refetch: regInv('memo'),
      persists: 1,
    },
    'edit payee cell': {
      mutation: async () => {
        const id = nextId();
        c.s.transactions.getTransactionByID(id);
        await c.s.transactions.updateTransactionColumn(id, 'Payee', `Payee ${k % 50}`);
      },
      refetch: regInv('payee'),
      persists: 1,
    },
    'open category picker in register': {
      // Before P9 the register had these loaded already; now the picker loads them on open.
      refetch: () =>
        isRefetch(c)
          ? [
              q('getMonthlyBudget(picker)', () =>
                c.s.monthlyBudgets.getMonthlyBudget(c.month, c.budgetId)
              ),
              q('readyToAssignBreakdown(picker)', () =>
                c.s.monthlyBudgets.getReadyToAssignBreakdown(c.budgetId, c.month)
              ),
            ]
          : [],
      persists: 0,
    },
    'edit category cell': {
      mutation: async () => {
        const id = nextId();
        c.s.transactions.getTransactionByID(id);
        await c.s.transactions.updateTransactionColumn(id, 'CategoryID', String(cat()));
      },
      refetch: regInv('category'),
      persists: 1,
    },
    'add transaction (+3 continuous rules)': {
      mutation: async () => {
        const id = await c.s.transactions.addTransaction(
          0,
          1000 * (3 + (k++ % 50)),
          c.ids.chk0,
          cat(),
          c.budgetId,
          c.today,
          'bench add',
          '',
          `Payee ${k % 50}`
        );
        await runContinuous(id);
        c.s.transactions.getTransactionForAccountRegister(id);
      },
      // plain add patches the register caches and refetches the rest in the background
      refetch: () => [
        ...reg({ onlyInvalidated: true }).filter(
          (x) => !/register page|accountSummary/.test(x.name)
        ),
        ...globalQueries(c).filter((x) => x.name !== 'listAccounts'),
      ],
      persists: 4,
    },
    'delete transaction': {
      mutation: async () => {
        delPool ??= c
          .rows(
            'SELECT ID FROM transactions WHERE AccountID=? AND TransferID IS NULL AND Date <= ? ORDER BY Date DESC LIMIT 600',
            c.ids.chk0,
            c.today
          )
          .map((r) => r.ID);
        const id = delPool.shift();
        c.s.transactions.getTransactionByID(id);
        c.s.transactions.deleteTransaction(id);
      },
      refetch: regInv(),
      persists: 1,
    },
    'bulk-categorize 50 rows': {
      mutation: async () => {
        if (c.appMode === 'old') c.s.transactions.getTransactionsByAccount(c.ids.chk0); // P7: toolbar refetches the register
        const base = (k++ * 50) % Math.max(1, c.chk0Ids.length - 50);
        for (const id of c.chk0Ids.slice(base, base + 50)) {
          c.s.transactions.getTransactionByID(id);
          c.s.transactions.moveTransactionToNewCategory(id, cat());
        }
      },
      refetch: () => [
        ...reg({ onlyInvalidated: true }).filter((x) => !/ReadyToAssign|payee/i.test(x.name)),
        globalQueries(c)[1],
      ],
      persists: 50,
    },
    'bank-sync import 200 rows + 3 continuous rules': {
      mutation: async () => {
        const base = k++;
        const created = [];
        for (let j = 0; j < 200; j++) {
          const id = await c.s.transactions.addTransaction(
            0,
            1000 * (2 + (j % 70)),
            c.ids.chk1,
            c.info.categoriesUncategorized ?? 0,
            c.budgetId,
            addDays(c.today, -(j % 5)),
            `BANK ${base}-${j}`,
            '',
            `Payee ${j % 60}`,
            null,
            null,
            false,
            [],
            true
          );
          if (c.runtime.batchedRules) created.push(id);
          else await runContinuous(id);
        }
        if (c.runtime.batchedRules) await runContinuousBatch(created);
      },
      refetch: () => [
        ...registerPageQueries(c, c.ids.chk1, { onlyInvalidated: true }),
        ...globalQueries(c),
      ],
      // 200 imports + one rules.execute per (row x rule), or per rule with P10
      persists: c.runtime.batchedRules ? 203 : 800,
    },
    'open dashboard': { refetch: () => [...globalQueries(c), ...dashboardQueries(c)], persists: 0 },
    'open accounts page (net worth)': {
      refetch: () => [...globalQueries(c).slice(1), ...accountsPageQueries(c)],
      persists: 0,
    },
    'open reports (analytics)': {
      refetch: () => [...globalQueries(c), ...reportsPageQueries(c)],
      persists: 0,
    },
  };
}
