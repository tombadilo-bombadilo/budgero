import { describe, expect, it, vi } from 'vitest';
import {
  NodeSqlJsAdapter,
  YNABApiClient,
  YNABImportService,
  TransactionService,
  mapYNABAccountType,
  normalizeYNABApiSnapshot,
  normalizeYNABMilliunitPrecision,
  type YNABApiPlanSnapshot,
  type YNABImportProgressUpdate,
} from '../src/index.js';

const SPACE_ID = 'space_ynab_api_import';

function category(
  id: string,
  categoryGroupId: string,
  name: string,
  budgeted = 0,
  activity = 0,
  balance = budgeted + activity
) {
  return {
    id,
    category_group_id: categoryGroupId,
    name,
    hidden: false,
    deleted: false,
    internal: false,
    note: null,
    budgeted,
    activity,
    balance,
  };
}

function snapshotFixture(): YNABApiPlanSnapshot {
  const food = category('category-food', 'group-everyday', 'Food', 5_000, -95_000);
  const income = {
    ...category('category-income', 'group-income', 'Ready to Assign'),
    internal: true,
  };

  return {
    serverKnowledge: 42,
    moneyMovements: [
      {
        id: 'movement-food',
        month: '2026-09-01',
        from_category_id: null,
        to_category_id: 'category-food',
        amount: 5_000,
        deleted: false,
      },
    ],
    plan: {
      id: 'plan-edge-cases',
      name: 'YNAB API edge cases',
      last_modified_on: '2026-09-03T00:00:00Z',
      first_month: '2026-09-01',
      last_month: '2026-09-01',
      currency_format: {
        iso_code: 'USD',
        example_format: '123,456.78',
        decimal_digits: 2,
        decimal_separator: '.',
        symbol_first: true,
        group_separator: ',',
        currency_symbol: '$',
        display_symbol: true,
      },
      accounts: [
        {
          id: 'account-checking',
          name: 'Checking',
          type: 'checking',
          on_budget: true,
          closed: false,
          deleted: false,
          balance: -5_000,
          transfer_payee_id: 'payee-transfer-checking',
        },
        {
          id: 'account-savings',
          name: 'Tracking Savings',
          type: 'savings',
          on_budget: false,
          closed: true,
          deleted: false,
          balance: 10_000,
          transfer_payee_id: 'payee-transfer-savings',
        },
      ],
      category_groups: [
        {
          id: 'group-income',
          name: 'Internal Master Category',
          hidden: false,
          deleted: false,
          internal: true,
        },
        {
          id: 'group-everyday',
          name: 'Everyday',
          hidden: false,
          deleted: false,
          internal: false,
        },
      ],
      categories: [income, food],
      months: [
        {
          month: '2026-09-01',
          deleted: false,
          budgeted: 5_000,
          activity: -95_000,
          income: 100_000,
          // YNAB leaves a categoryless transfer inside a split out of RTA.
          to_be_budgeted: 95_000,
          categories: [income, food],
        },
      ],
      payees: [
        {
          id: 'payee-starting',
          name: 'Starting Balance',
          transfer_account_id: null,
          deleted: false,
        },
        {
          id: 'payee-store',
          name: 'Store',
          transfer_account_id: null,
          deleted: false,
        },
        {
          id: 'payee-transfer-checking',
          name: 'Transfer : Checking',
          transfer_account_id: 'account-checking',
          deleted: false,
        },
        {
          id: 'payee-transfer-savings',
          name: 'Transfer : Tracking Savings',
          transfer_account_id: 'account-savings',
          deleted: false,
        },
      ],
      transactions: [
        {
          id: 'transaction-start',
          account_id: 'account-checking',
          date: '2026-09-01',
          amount: 100_000,
          memo: null,
          cleared: 'cleared',
          approved: true,
          payee_id: 'payee-starting',
          category_id: 'category-income',
          transfer_account_id: null,
          transfer_transaction_id: null,
          deleted: false,
        },
        {
          id: 'transaction-transfer-split',
          account_id: 'account-checking',
          date: '2026-09-02',
          amount: -30_000,
          memo: 'Transfer plus groceries',
          cleared: 'cleared',
          approved: true,
          payee_id: 'payee-store',
          category_id: null,
          transfer_account_id: null,
          transfer_transaction_id: null,
          deleted: false,
        },
        {
          id: 'transaction-transfer-counterpart',
          account_id: 'account-savings',
          date: '2026-09-02',
          amount: 10_000,
          memo: 'Move to tracking',
          cleared: 'cleared',
          approved: true,
          payee_id: 'payee-transfer-checking',
          category_id: null,
          transfer_account_id: 'account-checking',
          transfer_transaction_id: null,
          deleted: false,
        },
        {
          id: 'transaction-mixed-split',
          account_id: 'account-checking',
          date: '2026-09-03',
          amount: -75_000,
          memo: 'Purchase with refund',
          cleared: 'uncleared',
          approved: true,
          payee_id: 'payee-store',
          category_id: null,
          transfer_account_id: null,
          transfer_transaction_id: null,
          deleted: false,
        },
      ],
      subtransactions: [
        {
          id: 'sub-transfer',
          transaction_id: 'transaction-transfer-split',
          amount: -10_000,
          memo: 'Move to tracking',
          payee_id: 'payee-transfer-savings',
          category_id: null,
          transfer_account_id: 'account-savings',
          deleted: false,
        },
        {
          id: 'sub-food',
          transaction_id: 'transaction-transfer-split',
          amount: -20_000,
          memo: 'Groceries',
          payee_id: 'payee-store',
          category_id: 'category-food',
          transfer_account_id: null,
          deleted: false,
        },
        {
          id: 'sub-purchase',
          transaction_id: 'transaction-mixed-split',
          amount: -100_000,
          memo: 'Purchase',
          payee_id: 'payee-store',
          category_id: 'category-food',
          transfer_account_id: null,
          deleted: false,
        },
        {
          id: 'sub-refund',
          transaction_id: 'transaction-mixed-split',
          amount: 25_000,
          memo: 'Refund',
          payee_id: 'payee-store',
          category_id: 'category-food',
          transfer_account_id: null,
          deleted: false,
        },
      ],
    },
  };
}

function debtSnapshotFixture(): YNABApiPlanSnapshot {
  const snapshot = snapshotFixture();
  const paymentCategory = category(
    'category-mortgage-payment',
    'group-bills',
    'Mortgage Payment',
    0,
    -1_850_000
  );
  snapshot.plan.category_groups.push({
    id: 'group-bills',
    name: 'Bills',
    hidden: false,
    deleted: false,
    internal: false,
  });
  snapshot.plan.categories.push(paymentCategory);
  snapshot.plan.months[0].categories.push(paymentCategory);
  snapshot.plan.months[0].activity -= 1_850_000;
  snapshot.plan.accounts[0].balance -= 1_850_000;
  snapshot.plan.accounts.push({
    id: 'account-mortgage',
    name: 'Mortgage',
    type: 'mortgage',
    on_budget: false,
    closed: false,
    deleted: false,
    balance: -249_426_040,
    transfer_payee_id: 'payee-transfer-mortgage',
    debt_interest_rates: { '2026-09-01': 6_125 },
    debt_minimum_payments: { '2026-09-01': 1_850_000 },
  });
  snapshot.plan.payees.push({
    id: 'payee-transfer-mortgage',
    name: 'Transfer : Mortgage',
    transfer_account_id: 'account-mortgage',
    deleted: false,
  });
  snapshot.plan.transactions.push(
    {
      id: 'transaction-mortgage-opening',
      account_id: 'account-mortgage',
      date: '2026-09-01',
      amount: -250_000_000,
      memo: null,
      cleared: 'cleared',
      approved: true,
      payee_id: 'payee-starting',
      category_id: null,
      transfer_account_id: null,
      transfer_transaction_id: null,
      deleted: false,
    },
    {
      id: 'transaction-mortgage-payment-source',
      account_id: 'account-checking',
      date: '2026-09-03',
      amount: -1_850_000,
      memo: 'Mortgage payment',
      cleared: 'cleared',
      approved: true,
      payee_id: 'payee-transfer-mortgage',
      category_id: 'category-mortgage-payment',
      transfer_account_id: 'account-mortgage',
      transfer_transaction_id: 'transaction-mortgage-payment-debt',
      deleted: false,
    },
    {
      id: 'transaction-mortgage-payment-debt',
      account_id: 'account-mortgage',
      date: '2026-09-03',
      amount: 1_850_000,
      memo: 'Mortgage payment',
      cleared: 'uncleared',
      approved: true,
      payee_id: 'payee-transfer-checking',
      category_id: null,
      transfer_account_id: 'account-checking',
      transfer_transaction_id: 'transaction-mortgage-payment-source',
      debt_transaction_type: 'payment',
      deleted: false,
    }
  );
  return snapshot;
}

describe('YNAB API import', () => {
  it('calls the current plans API with a bearer token', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: { plans: [snapshotFixture().plan], server_knowledge: 1 } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );
    const client = new YNABApiClient('  secret-token  ', fetchMock, 'https://example.test/v1');

    const plans = await client.listPlans();

    expect(plans[0].name).toBe('YNAB API edge cases');
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/v1/plans', {
      method: 'GET',
      headers: { Authorization: 'Bearer secret-token', Accept: 'application/json' },
    });
  });

  it('reads the plan and Money Movements at the same YNAB revision', async () => {
    const fixture = snapshotFixture();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const data = url.endsWith('/money_movements')
        ? { money_movements: fixture.moneyMovements, server_knowledge: 42 }
        : { plan: fixture.plan, server_knowledge: 42 };
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const snapshot = await new YNABApiClient(
      'secret-token',
      fetchMock,
      'https://example.test/v1'
    ).getPlan('plan-edge-cases');

    expect(snapshot.serverKnowledge).toBe(42);
    expect(snapshot.moneyMovements).toEqual(fixture.moneyMovements);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invokes the default fetch with the browser global as its receiver', async () => {
    const fetchMock = vi.fn(function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(
        new Response(JSON.stringify({ data: { plans: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      await new YNABApiClient('secret-token', undefined, 'https://example.test/v1').listPlans();
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('maps YNAB account types to Budgero account semantics', () => {
    expect(mapYNABAccountType('creditCard')).toBe('Credit');
    expect(mapYNABAccountType('mortgage')).toBe('Mortgage');
    expect(mapYNABAccountType('otherLiability')).toBe('Loan');
    expect(mapYNABAccountType('otherAsset')).toBe('Other Asset');
    expect(normalizeYNABMilliunitPrecision(-12_345, 2)).toBe(-12_350);
    expect(normalizeYNABMilliunitPrecision(-9_876, 2)).toBe(-9_880);
  });

  it('warns when a source snapshot Money Movements disagree with monthly assignments', () => {
    const snapshot = snapshotFixture();
    snapshot.moneyMovements![0].amount = 4_000;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const normalized = normalizeYNABApiSnapshot(snapshot);
    expect(normalized.categoryMonthSpecs[0].expectedAssigned).toBe(5_000);
    expect(normalized.source.categoryAssignmentsVerified).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/YNAB Money Movements warning.*Money Movements disagree/i)
    );
    warnSpy.mockRestore();
  });

  it.each(['2026-04-01', '2026-08-01', '2026-10-01'])(
    'preserves assignments in %s without counting missing movement history as verified',
    (month) => {
      const snapshot = snapshotFixture();
      const sourceMonth = snapshot.plan.months[0];
      snapshot.plan.months.push({ ...sourceMonth, month: '2026-05-01' }, { ...sourceMonth, month });
      snapshot.moneyMovements!.push({
        ...snapshot.moneyMovements![0],
        id: 'movement-food-may',
        month: '2026-05-01',
      });

      const normalized = normalizeYNABApiSnapshot(snapshot);

      expect(normalized.budgetRows).toContainEqual(
        expect.objectContaining({ Month: month, Category: 'Food', Assigned: '5.000' })
      );
      expect(normalized.categoryMonthSpecs).toHaveLength(3);
      expect(normalized.source).toMatchObject({
        moneyMovements: 2,
        categoryAssignmentsVerified: 2,
      });
    }
  );

  it.each(['empty', 'deleted-only'])(
    'does not verify assignments against %s Money Movement history',
    (history) => {
      const snapshot = snapshotFixture();
      snapshot.moneyMovements =
        history === 'empty' ? [] : [{ ...snapshot.moneyMovements![0], deleted: true }];

      const normalized = normalizeYNABApiSnapshot(snapshot);

      expect(normalized.categoryMonthSpecs).toHaveLength(1);
      expect(normalized.source).toMatchObject({
        moneyMovements: 0,
        categoryAssignmentsVerified: 0,
      });
    }
  );

  it('does not report movement verification when Money Movements were not supplied', () => {
    const snapshot = snapshotFixture();
    delete snapshot.moneyMovements;

    expect(normalizeYNABApiSnapshot(snapshot).source).toEqual({
      transactions: 4,
      subtransactions: 4,
      registerRows: 6,
    });
  });

  it('warns but does not reject when Money Movements disagree with category assignments', () => {
    const snapshot = snapshotFixture();
    const rent = category('category-rent', 'group-everyday', 'Rent', 2_000);
    snapshot.plan.categories.push(rent);
    snapshot.plan.months[0].categories.push(rent);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const normalized = normalizeYNABApiSnapshot(snapshot);
    expect(normalized.categoryMonthSpecs).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /YNAB Money Movements warning: Money Movements disagree with 1 monthly category assignment/i
      )
    );
    warnSpy.mockRestore();
  });

  it('verifies zero assignments in a covered month, including movements that cancel out', () => {
    const snapshot = snapshotFixture();
    snapshot.plan.months[0].categories.find((item) => item.id === 'category-food')!.budgeted = 0;
    const rent = category('category-rent', 'group-everyday', 'Rent');
    snapshot.plan.categories.push(rent);
    snapshot.plan.months[0].categories.push(rent);
    snapshot.moneyMovements!.push({
      ...snapshot.moneyMovements![0],
      id: 'movement-food-returned',
      from_category_id: 'category-food',
      to_category_id: null,
    });

    expect(normalizeYNABApiSnapshot(snapshot).source.categoryAssignmentsVerified).toBe(2);
  });

  it('rejects a source split whose active parts do not equal its parent amount', () => {
    const snapshot = snapshotFixture();
    snapshot.plan.subtransactions[0].amount = -9_000;

    expect(() => normalizeYNABApiSnapshot(snapshot)).toThrow(
      /source integrity check failed.*split transaction transaction-transfer-split.*parent amount -30000.*total -29000/i
    );
  });

  it('normalizes API splits while marking only ordinary splits for preservation', () => {
    const snapshot = snapshotFixture();
    const normalized = normalizeYNABApiSnapshot(snapshot);
    const preview = YNABImportService.inspectYNABApiSnapshot(snapshot);

    expect(normalized.registerRows).toHaveLength(6);
    expect(normalized.accountSpecs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Checking', type: 'Checking', onBudget: true }),
        expect.objectContaining({
          name: 'Tracking Savings',
          type: 'Savings',
          onBudget: false,
          archived: true,
        }),
      ])
    );
    expect(preview.splitTransactions).toEqual([
      expect.objectContaining({ date: '2026-09-03', partCount: 2 }),
    ]);
  });

  it('infers a managed-debt payment category from a transfer inside a split', () => {
    const snapshot = debtSnapshotFixture();
    const source = snapshot.plan.transactions.find(
      (transaction) => transaction.id === 'transaction-mortgage-payment-source'
    );
    if (!source) throw new Error('Mortgage payment source fixture is missing');
    source.category_id = null;
    source.transfer_account_id = null;
    snapshot.plan.subtransactions.push({
      id: 'sub-mortgage-payment',
      transaction_id: source.id,
      amount: source.amount,
      memo: source.memo,
      payee_id: source.payee_id,
      category_id: 'category-mortgage-payment',
      transfer_account_id: 'account-mortgage',
      deleted: false,
    });

    expect(
      normalizeYNABApiSnapshot(snapshot).accountSpecs.find(
        (account) => account.ynabAccountId === 'account-mortgage'
      )
    ).toMatchObject({
      linkedCategoryGroup: 'Bills',
      linkedCategory: 'Mortgage Payment',
    });
  });

  it('pairs an empty-memo split transfer with its empty-memo counterpart', async () => {
    const snapshot = snapshotFixture();
    snapshot.plan.subtransactions.find((part) => part.id === 'sub-transfer')!.memo = '';
    snapshot.plan.transactions.find(
      (transaction) => transaction.id === 'transaction-transfer-counterpart'
    )!.memo = '';
    const adapter = await NodeSqlJsAdapter.create();
    try {
      const result = await new YNABImportService(adapter).importYNABFromApiSnapshotWithSummary(
        snapshot,
        {
          spaceId: SPACE_ID,
          budgetName: 'Empty transfer memo',
          currency: 'USD',
          numberFormat: '123,456.78',
          badgeIcon: 'HelpCircle',
        }
      );
      const pairs = adapter
        .prepare(
          `
        SELECT COUNT(*) AS legs, SUM(InflowNative - OutflowNative) AS net
        FROM transactions WHERE BudgetID = ? AND TransferID <> '' GROUP BY TransferID
      `
        )
        .all(result.budgetId);
      expect(pairs).toEqual([{ legs: 2, net: 0 }]);
    } finally {
      adapter.close();
    }
  });

  it('imports accounts, assignments, transfer splits, and mixed-direction splits', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    try {
      const importer = new YNABImportService(adapter);
      const progress: string[] = [];
      let callbackInFlight = false;
      let callbacksOverlapped = false;
      const result = await importer.importYNABFromApiSnapshotWithSummary(snapshotFixture(), {
        spaceId: SPACE_ID,
        budgetName: 'Direct API import',
        currency: 'USD',
        numberFormat: '123,456.78',
        badgeIcon: 'HelpCircle',
        onProgress: async (update) => {
          if (callbackInFlight) callbacksOverlapped = true;
          callbackInFlight = true;
          progress.push(`${update.stage}:${update.status}`);
          await Promise.resolve();
          callbackInFlight = false;
        },
      });

      expect(result.summary).toMatchObject({
        registerRowsImported: 6,
        transactionsCreated: 5,
        splitTransactionsImported: 1,
        accountBalancesVerified: 2,
        readyToAssignMonthsVerified: 1,
        sourceRowsVerified: 6,
        categoryMonthsVerified: 3,
        moneyMovementAssignmentsVerified: 1,
      });
      expect(result.verification).toMatchObject({
        status: 'passed',
        source: { registerRows: 6, categoryAssignmentsVerified: 1 },
        accounts: { checked: 2, matched: 2 },
        categories: { checked: 3, matched: 3, mismatches: [] },
        readyToAssign: { checked: 1, matched: 1, mismatches: [] },
      });
      expect(progress).toEqual([
        'preparing:running',
        'source-verification:passed',
        'preparing:passed',
        'categories:running',
        'categories:passed',
        'accounts:running',
        'accounts:passed',
        'assignments:running',
        'assignments:passed',
        'transactions:running',
        'transactions:passed',
        'account-verification:running',
        'account-verification:passed',
        'category-verification:running',
        'category-verification:running',
        'category-verification:passed',
        'rta-verification:running',
        'rta-verification:running',
        'rta-verification:passed',
      ]);
      expect(callbacksOverlapped).toBe(false);

      const accounts = adapter
        .prepare(
          `SELECT Name, Type, OnBudget, Archived, BalanceNative
           FROM accounts WHERE BudgetID = ? ORDER BY Name`
        )
        .all(result.budgetId);
      expect(accounts).toEqual([
        {
          Name: 'Checking',
          Type: 'Checking',
          OnBudget: 1,
          Archived: 0,
          BalanceNative: -5_000,
        },
        {
          Name: 'Tracking Savings',
          Type: 'Savings',
          OnBudget: 0,
          Archived: 1,
          BalanceNative: 10_000,
        },
      ]);

      const assignment = adapter
        .prepare(
          `SELECT a.Amount
           FROM assignments a
           JOIN categories c ON c.ID = a.CategoryId
           WHERE a.BudgetId = ? AND c.Name = 'Food' AND a.Month = '2026-09'`
        )
        .get(result.budgetId);
      expect(assignment).toEqual({ Amount: 5_000 });

      const transferPairs = adapter
        .prepare(
          `SELECT TransferID, COUNT(*) AS LegCount,
                  SUM(InflowNative) AS TotalInflow, SUM(OutflowNative) AS TotalOutflow
           FROM transactions
           WHERE BudgetID = ? AND TransferID IS NOT NULL AND TransferID != ''
           GROUP BY TransferID`
        )
        .all(result.budgetId);
      expect(transferPairs).toEqual([
        expect.objectContaining({ LegCount: 2, TotalInflow: 10_000, TotalOutflow: 10_000 }),
      ]);

      const rtaExcludedTransfer = adapter
        .prepare(
          `SELECT ExcludeFromReadyToAssign
           FROM transactions
           WHERE BudgetID = ? AND OutflowNative = 10000`
        )
        .get(result.budgetId);
      expect(rtaExcludedTransfer).toEqual({ ExcludeFromReadyToAssign: 1 });

      const mixedLines = adapter
        .prepare(
          `SELECT s.Memo, s.InflowNative, s.OutflowNative
           FROM transaction_splits s
           JOIN transactions t ON t.ID = s.TransactionID
           WHERE t.BudgetID = ? ORDER BY s.OrderIndex`
        )
        .all(result.budgetId);
      expect(mixedLines).toEqual([
        { Memo: 'Purchase', InflowNative: 0, OutflowNative: 100_000 },
        { Memo: 'Refund', InflowNative: 25_000, OutflowNative: 0 },
      ]);
    } finally {
      adapter.close();
    }
  });

  it.each([
    ['duplicate names', 'Checking', 'Checking'],
    ['trailing whitespace', 'Checking ', 'Tracking Savings '],
    ['names that collide after trimming', 'Checking', ' Checking '],
    ['nonbreaking spaces', '\u00a0Checking\u00a0', '\u00a0Tracking Savings\u00a0'],
    ['object property names', '__proto__', 'constructor'],
  ])('imports every account by source ID with %s', async (_, checkingName, savingsName) => {
    const adapter = await NodeSqlJsAdapter.create();
    try {
      const snapshot = snapshotFixture();
      snapshot.plan.accounts[0].name = checkingName;
      snapshot.plan.accounts[1].name = savingsName;
      snapshot.plan.accounts.push({
        ...snapshot.plan.accounts[1],
        id: 'empty-account',
        balance: 0,
      });
      const progress: YNABImportProgressUpdate[] = [];
      expect(YNABImportService.inspectYNABApiSnapshot(snapshot).accountCount).toBe(3);

      const result = await new YNABImportService(adapter).importYNABFromApiSnapshotWithSummary(
        snapshot,
        {
          spaceId: SPACE_ID,
          budgetName: 'Account identity import',
          currency: 'USD',
          numberFormat: '123,456.78',
          badgeIcon: 'HelpCircle',
          onProgress: (update) => {
            progress.push(update);
          },
        }
      );
      expect(result.summary).toMatchObject({
        sourceRowsVerified: 6,
        transactionsCreated: 5,
        accountBalancesVerified: 3,
        splitTransactionsImported: 1,
      });
      expect(result.verification?.status).toBe('passed');
      expect(progress).toContainEqual(
        expect.objectContaining({
          stage: 'accounts',
          status: 'passed',
          detail: '3 accounts',
        })
      );

      const accounts = adapter
        .prepare(
          `
        SELECT json_extract(a.Metadata, '$.ynab_account_id') AS SourceId,
               a.Name, a.BalanceNative, a.Archived, COUNT(t.ID) AS Transactions
        FROM accounts a LEFT JOIN transactions t ON t.AccountID = a.ID
        WHERE a.BudgetID = ? GROUP BY a.ID ORDER BY SourceId
      `
        )
        .all(result.budgetId);
      expect(accounts).toEqual([
        {
          SourceId: 'account-checking',
          Name: checkingName,
          BalanceNative: -5_000,
          Archived: 0,
          Transactions: 4,
        },
        {
          SourceId: 'account-savings',
          Name: savingsName,
          BalanceNative: 10_000,
          Archived: 1,
          Transactions: 1,
        },
        {
          SourceId: 'empty-account',
          Name: savingsName,
          BalanceNative: 0,
          Archived: 1,
          Transactions: 0,
        },
      ]);
      expect(
        adapter
          .prepare(
            `
        SELECT COUNT(*) AS Legs, COUNT(DISTINCT AccountID) AS Accounts,
               SUM(InflowNative - OutflowNative) AS Net
        FROM transactions WHERE BudgetID = ? AND TransferID <> '' GROUP BY TransferID
      `
          )
          .all(result.budgetId)
      ).toEqual([{ Legs: 2, Accounts: 2, Net: 0 }]);
    } finally {
      adapter.close();
    }
  });

  it('uses API parent IDs for splits and preserves memo text that resembles CSV markers', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    try {
      const snapshot = snapshotFixture();
      const ordinaryMemos = ['Split (1/2): ordinary one', 'Split (2/2): ordinary two'];
      ordinaryMemos.forEach((memo, index) => {
        snapshot.plan.transactions.push({
          ...snapshot.plan.transactions[0],
          id: `ordinary-${index}`,
          date: '2026-09-05',
          amount: 0,
          memo,
          payee_id: 'payee-store',
        });
      });
      snapshot.plan.subtransactions[2].memo = 'Split (1/2): literal child memo';
      snapshot.plan.subtransactions[3].memo = 'Split (2/2): another literal child memo';

      const result = await new YNABImportService(adapter).importYNABFromApiSnapshotWithSummary(
        snapshot,
        {
          spaceId: SPACE_ID,
          budgetName: 'Explicit API split identities',
          currency: 'USD',
          numberFormat: '123,456.78',
          badgeIcon: 'HelpCircle',
        }
      );
      expect(result.summary).toMatchObject({
        sourceRowsVerified: 8,
        transactionsCreated: 7,
        splitTransactionsImported: 1,
      });
      expect(result.verification?.status).toBe('passed');
      expect(
        adapter
          .prepare(
            `
        SELECT t.Memo, COUNT(s.ID) AS Parts FROM transactions t
        LEFT JOIN transaction_splits s ON s.TransactionID = t.ID
        WHERE t.BudgetID = ? AND t.Date = '2026-09-05' GROUP BY t.ID ORDER BY t.ID
      `
          )
          .all(result.budgetId)
      ).toEqual(ordinaryMemos.map((Memo) => ({ Memo, Parts: 0 })));
      expect(
        adapter
          .prepare(
            `
        SELECT s.Memo FROM transaction_splits s JOIN transactions t ON t.ID = s.TransactionID
        WHERE t.BudgetID = ? ORDER BY s.OrderIndex
      `
          )
          .all(result.budgetId)
      ).toEqual([
        { Memo: snapshot.plan.subtransactions[2].memo },
        { Memo: snapshot.plan.subtransactions[3].memo },
      ]);
    } finally {
      adapter.close();
    }
  });

  it('does not classify an ordinary API payee as a transfer based on its name', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    try {
      const snapshot = snapshotFixture();
      snapshot.plan.payees.find((payee) => payee.id === 'payee-store')!.name =
        'Transfer : Tracking Savings';
      const result = await new YNABImportService(adapter).importYNABFromApiSnapshotWithSummary(
        snapshot,
        {
          spaceId: SPACE_ID,
          budgetName: 'API transfer identities',
          currency: 'USD',
          numberFormat: '123,456.78',
          badgeIcon: 'HelpCircle',
        }
      );
      expect(result.summary).toMatchObject({ sourceRowsVerified: 6, splitTransactionsImported: 1 });
      expect(result.verification?.status).toBe('passed');
      expect(
        adapter
          .prepare(
            `
        SELECT COUNT(*) AS Count FROM transactions WHERE BudgetID = ? AND TransferID <> ''
      `
          )
          .get(result.budgetId)
      ).toEqual({ Count: 2 });
    } finally {
      adapter.close();
    }
  });

  it('pairs split transfers by child relationships despite different memos and dates', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    try {
      const snapshot = snapshotFixture();
      const child = snapshot.plan.subtransactions[0];
      const receiver = snapshot.plan.transactions[2];
      child.transfer_transaction_id = receiver.id;
      receiver.transfer_transaction_id = child.transaction_id;
      child.memo = 'Sending memo';
      receiver.memo = 'Receiving memo';
      receiver.date = '2026-09-04';
      const result = await new YNABImportService(adapter).importYNABFromApiSnapshotWithSummary(
        snapshot,
        {
          spaceId: SPACE_ID,
          budgetName: 'API split transfer relationship',
          currency: 'USD',
          numberFormat: '123,456.78',
          badgeIcon: 'HelpCircle',
        }
      );
      expect(result.summary.sourceRowsVerified).toBe(6);
      expect(result.verification?.status).toBe('passed');
      expect(
        adapter
          .prepare(
            `
        SELECT COUNT(*) AS Legs, COUNT(DISTINCT AccountID) AS Accounts,
               SUM(InflowNative - OutflowNative) AS Net
        FROM transactions WHERE BudgetID = ? AND TransferID <> '' GROUP BY TransferID
      `
          )
          .all(result.budgetId)
      ).toEqual([{ Legs: 2, Accounts: 2, Net: 0 }]);
    } finally {
      adapter.close();
    }
  });

  it('isolates transfer groups when the same YNAB plan is imported twice', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    try {
      const snapshot = snapshotFixture();
      snapshot.plan.subtransactions[0].transfer_transaction_id = snapshot.plan.transactions[2].id;
      snapshot.plan.transactions[2].transfer_transaction_id = snapshot.plan.transactions[1].id;
      const config = {
        spaceId: SPACE_ID,
        budgetName: 'Repeated import',
        currency: 'USD',
        numberFormat: '123,456.78',
        badgeIcon: 'HelpCircle',
      };
      const importer = new YNABImportService(adapter);
      const first = await importer.importYNABFromApiSnapshotWithSummary(snapshot, config);
      const second = await importer.importYNABFromApiSnapshotWithSummary(snapshot, config);
      const secondRows = adapter
        .prepare('SELECT * FROM transactions WHERE BudgetID = ? ORDER BY ID')
        .all(second.budgetId);
      const secondAccounts = adapter
        .prepare('SELECT * FROM accounts WHERE BudgetID = ? ORDER BY ID')
        .all(second.budgetId);
      const firstTransfer = adapter
        .prepare("SELECT ID FROM transactions WHERE BudgetID = ? AND TransferID <> '' LIMIT 1")
        .get(first.budgetId) as { ID: number };

      new TransactionService(adapter).deleteTransaction(firstTransfer.ID);

      expect(
        adapter
          .prepare('SELECT * FROM transactions WHERE BudgetID = ? ORDER BY ID')
          .all(second.budgetId)
      ).toEqual(secondRows);
      expect(
        adapter
          .prepare('SELECT * FROM accounts WHERE BudgetID = ? ORDER BY ID')
          .all(second.budgetId)
      ).toEqual(secondAccounts);
      expect(
        adapter
          .prepare('SELECT COUNT(*) AS Count FROM transactions WHERE BudgetID = ?')
          .get(first.budgetId)
      ).toEqual({ Count: 3 });
    } finally {
      adapter.close();
    }
  });

  it('preserves API split parent details, transfer notes, and reconciled history', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    try {
      const snapshot = snapshotFixture();
      snapshot.plan.transactions[0].memo = 'Opening amount checked against statement';
      snapshot.plan.transactions[0].cleared = 'reconciled';
      snapshot.plan.transactions[2].memo = 'Savings for the deposit';
      snapshot.plan.transactions[2].cleared = 'reconciled';
      snapshot.plan.transactions[3].cleared = 'reconciled';
      const result = await new YNABImportService(adapter).importYNABFromApiSnapshotWithSummary(
        snapshot,
        {
          spaceId: SPACE_ID,
          budgetName: 'Preserved source details',
          currency: 'USD',
          numberFormat: '123,456.78',
          badgeIcon: 'HelpCircle',
        }
      );
      expect(result.verification?.status).toBe('passed');
      expect(
        adapter
          .prepare(
            `
        SELECT t.Memo, t.Reconciled FROM transactions t
        JOIN accounts a ON a.ID = t.AccountID
        WHERE t.BudgetID = ? AND json_extract(a.Metadata, '$.ynab_account_id') = 'account-savings'
      `
          )
          .get(result.budgetId)
      ).toEqual({ Memo: 'Savings for the deposit', Reconciled: 1 });
      expect(
        adapter
          .prepare(
            `
        SELECT Memo, Reconciled FROM transactions WHERE BudgetID = ? AND Date = '2026-09-01'
      `
          )
          .get(result.budgetId)
      ).toEqual({ Memo: 'Opening amount checked against statement', Reconciled: 1 });
      expect(
        adapter
          .prepare(
            `
        SELECT Memo, Payee, Reconciled FROM transactions WHERE BudgetID = ? AND Date = '2026-09-03'
      `
          )
          .get(result.budgetId)
      ).toEqual({ Memo: 'Purchase with refund', Payee: 'Store', Reconciled: 1 });
      expect(
        adapter
          .prepare(
            `
        SELECT Memo, Reconciled FROM transactions WHERE BudgetID = ? AND OutflowNative = 20000
      `
          )
          .get(result.budgetId)
      ).toEqual({ Memo: 'Groceries\nYNAB split memo: Transfer plus groceries', Reconciled: 0 });
    } finally {
      adapter.close();
    }
  });

  it('retains a single-child API split and its parent-only note', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    try {
      const snapshot = snapshotFixture();
      snapshot.plan.subtransactions = snapshot.plan.subtransactions.filter(
        (child) => child.id !== 'sub-refund'
      );
      snapshot.plan.subtransactions.find((child) => child.id === 'sub-purchase')!.amount = -75_000;
      const result = await new YNABImportService(adapter).importYNABFromApiSnapshotWithSummary(
        snapshot,
        {
          spaceId: SPACE_ID,
          budgetName: 'Single-child split',
          currency: 'USD',
          numberFormat: '123,456.78',
          badgeIcon: 'HelpCircle',
        }
      );
      expect(result.summary).toMatchObject({ sourceRowsVerified: 5, splitTransactionsImported: 1 });
      expect(
        adapter
          .prepare(
            `
        SELECT t.Memo AS ParentMemo, t.Payee AS ParentPayee, s.Memo AS ChildMemo, s.OutflowNative
        FROM transaction_splits s JOIN transactions t ON t.ID = s.TransactionID
        WHERE t.BudgetID = ?
      `
          )
          .all(result.budgetId)
      ).toEqual([
        {
          ParentMemo: 'Purchase with refund',
          ParentPayee: 'Store',
          ChildMemo: 'Purchase',
          OutflowNative: 75_000,
        },
      ]);
    } finally {
      adapter.close();
    }
  });

  it('reports transaction batch progress for large imports', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    try {
      const snapshot = snapshotFixture();
      const template = snapshot.plan.transactions[0];
      snapshot.plan.transactions.push(
        ...Array.from({ length: 60 }, (_, index) => ({
          ...template,
          id: `transaction-zero-${index}`,
          amount: 0,
          memo: `No-op fixture ${index}`,
          payee_id: 'payee-store',
          category_id: 'category-food',
        }))
      );
      const updates: YNABImportProgressUpdate[] = [];

      await new YNABImportService(adapter).importYNABFromApiSnapshotWithSummary(snapshot, {
        spaceId: SPACE_ID,
        budgetName: 'Batched direct API import',
        currency: 'USD',
        numberFormat: '123,456.78',
        badgeIcon: 'HelpCircle',
        onProgress: (update) => updates.push(update),
      });

      expect(updates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stage: 'transactions',
            status: 'running',
            detail: expect.stringMatching(/^50 of \d+ entries processed/),
          }),
        ])
      );
    } finally {
      adapter.close();
    }
  });

  it.each([true, false])(
    'imports historical assignments when recent Money Movement history is available: %s',
    async (hasRecentMovements) => {
      const adapter = await NodeSqlJsAdapter.create();
      try {
        const snapshot = snapshotFixture();
        snapshot.plan.first_month = '2026-04-01';
        snapshot.plan.months.unshift({
          month: '2026-04-01',
          deleted: false,
          budgeted: 10_000,
          activity: 0,
          income: 0,
          to_be_budgeted: -10_000,
          categories: [category('category-food', 'group-everyday', 'Food', 10_000)],
        });
        snapshot.plan.months[1].categories.find((item) => item.id === 'category-food')!.balance +=
          10_000;
        snapshot.plan.months[1].to_be_budgeted -= 10_000;
        if (!hasRecentMovements) snapshot.moneyMovements = [];

        const result = await new YNABImportService(adapter).importYNABFromApiSnapshotWithSummary(
          snapshot,
          {
            spaceId: SPACE_ID,
            budgetName: 'Historical API import',
            currency: 'USD',
            numberFormat: '123,456.78',
            badgeIcon: 'HelpCircle',
          }
        );

        expect(result.summary.moneyMovementAssignmentsVerified).toBe(hasRecentMovements ? 1 : 0);
        expect(result.verification).toMatchObject({
          status: 'passed',
          source: { categoryAssignmentsVerified: hasRecentMovements ? 1 : 0 },
          accounts: { checked: 2, matched: 2 },
          categories: { checked: 6, matched: 6, mismatches: [] },
          readyToAssign: { checked: 2, matched: 2, mismatches: [] },
        });
        expect(
          adapter
            .prepare(
              `SELECT a.Month, a.Amount
               FROM assignments a
               JOIN categories c ON c.ID = a.CategoryId
               WHERE a.BudgetId = ? AND c.Name = 'Food'
               ORDER BY a.Month`
            )
            .all(result.budgetId)
        ).toEqual([
          { Month: '2026-04', Amount: 10_000 },
          { Month: '2026-09', Amount: 5_000 },
        ]);
      } finally {
        adapter.close();
      }
    }
  );

  it('removes the incomplete budget when an account balance does not reconcile', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    try {
      const snapshot = snapshotFixture();
      snapshot.plan.accounts[0].balance = -4_000;
      const importer = new YNABImportService(adapter);

      await expect(
        importer.importYNABFromApiSnapshotWithSummary(snapshot, {
          spaceId: SPACE_ID,
          budgetName: 'Failed direct API import',
          currency: 'USD',
          numberFormat: '123,456.78',
          badgeIcon: 'HelpCircle',
        })
      ).rejects.toThrow(
        /account balance integrity check failed.*Checking: YNAB -4000, Budgero -5000.*incomplete budget was removed/i
      );

      expect(adapter.prepare('SELECT COUNT(*) AS Count FROM budgets').get()).toEqual({ Count: 0 });
    } finally {
      adapter.close();
    }
  });

  it('returns a reviewable warning when Ready to Assign does not reconcile', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    try {
      const snapshot = snapshotFixture();
      snapshot.plan.months[0].to_be_budgeted = 94_000;
      // Missing movement history must not bypass post-import reconciliation.
      snapshot.moneyMovements![0].amount = 4_000;
      const importer = new YNABImportService(adapter);

      const result = await importer.importYNABFromApiSnapshotWithSummary(snapshot, {
        spaceId: SPACE_ID,
        budgetName: 'Warned RTA import',
        currency: 'USD',
        numberFormat: '123,456.78',
        badgeIcon: 'HelpCircle',
      });

      expect(result.verification).toMatchObject({
        status: 'warning',
        readyToAssign: {
          checked: 1,
          matched: 0,
          mismatches: [
            {
              month: '2026-09',
              expectedReadyToAssign: 94_000,
              computedReadyToAssign: 95_000,
              difference: 1_000,
            },
          ],
        },
      });
      expect(adapter.prepare('SELECT COUNT(*) AS Count FROM budgets').get()).toEqual({ Count: 1 });
    } finally {
      adapter.close();
    }
  });

  it('materializes YNAB-managed debt interest as a visible adjustment', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    try {
      const result = await new YNABImportService(adapter).importYNABFromApiSnapshotWithSummary(
        debtSnapshotFixture(),
        {
          spaceId: SPACE_ID,
          budgetName: 'Mortgage import',
          currency: 'USD',
          numberFormat: '123,456.78',
          badgeIcon: 'HelpCircle',
        }
      );

      expect(result.summary.debtBalanceAdjustmentsCreated).toBe(1);
      expect(result.verification).toMatchObject({
        status: 'passed',
        accounts: {
          checked: 3,
          matched: 3,
          debtBalanceAdjustments: [
            {
              accountName: 'Mortgage',
              date: '2026-09-03',
              amount: -1_276_040,
              balanceBefore: -248_150_000,
              expectedBalance: -249_426_040,
            },
          ],
        },
      });
      const mortgageMetadata = JSON.parse(
        (
          adapter
            .prepare(`SELECT Metadata FROM accounts WHERE BudgetID = ? AND Name = 'Mortgage'`)
            .get(result.budgetId) as { Metadata: string }
        ).Metadata
      ) as { linked_category_id: number };
      expect(
        adapter
          .prepare(
            `SELECT c.Name AS Category, cg.Name AS CategoryGroup
             FROM categories c
             JOIN category_groups cg ON cg.ID = c.CategoryGroupID
             WHERE c.ID = ?`
          )
          .get(mortgageMetadata.linked_category_id)
      ).toEqual({ Category: 'Mortgage Payment', CategoryGroup: 'Bills' });
      expect(
        adapter
          .prepare(
            `SELECT COUNT(*) AS Count
             FROM categories c
             JOIN category_groups cg ON cg.ID = c.CategoryGroupID
             WHERE c.BudgetID = ? AND cg.Name = 'Liabilities' AND c.Name = 'Mortgage'`
          )
          .get(result.budgetId)
      ).toEqual({ Count: 0 });
      expect(
        adapter
          .prepare(
            `SELECT a.BalanceNative, t.Memo, t.InflowNative, t.OutflowNative
             FROM accounts a
             JOIN transactions t ON t.AccountID = a.ID
             WHERE a.BudgetID = ? AND a.Name = 'Mortgage'
               AND t.Memo = 'Imported YNAB debt interest adjustment'`
          )
          .get(result.budgetId)
      ).toEqual({
        BalanceNative: -249_426_040,
        Memo: 'Imported YNAB debt interest adjustment',
        InflowNative: 0,
        OutflowNative: 1_276_040,
      });
    } finally {
      adapter.close();
    }
  });

  it('removes the incomplete budget when a normalized source row is skipped', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    try {
      const snapshot = snapshotFixture();
      snapshot.plan.transactions[0].date = 'not-a-date';

      await expect(
        new YNABImportService(adapter).importYNABFromApiSnapshotWithSummary(snapshot, {
          spaceId: SPACE_ID,
          budgetName: 'Incomplete source import',
          currency: 'USD',
          numberFormat: '123,456.78',
          badgeIcon: 'HelpCircle',
        })
      ).rejects.toThrow(/source completeness check failed: imported 5 of 6 register rows/i);
      expect(adapter.prepare('SELECT COUNT(*) AS Count FROM budgets').get()).toEqual({ Count: 0 });
    } finally {
      adapter.close();
    }
  });

  it('removes the incomplete budget when an import stage fails', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    try {
      const importer = new YNABImportService(adapter);

      await expect(
        importer.importYNABFromApiSnapshotWithSummary(snapshotFixture(), {
          spaceId: SPACE_ID,
          budgetName: 'Interrupted direct API import',
          currency: 'USD',
          numberFormat: '123,456.78',
          badgeIcon: 'HelpCircle',
          onProgress: (update) => {
            if (update.stage === 'categories' && update.status === 'running') {
              throw new Error('Synthetic category import failure');
            }
          },
        })
      ).rejects.toThrow('Synthetic category import failure');

      expect(adapter.prepare('SELECT COUNT(*) AS Count FROM budgets').get()).toEqual({ Count: 0 });
    } finally {
      adapter.close();
    }
  });
});
