import { describe, it, expect } from 'vitest';
import {
  NodeSqlJsAdapter,
  ServiceManager,
  Services,
  DatabaseAdapter,
  Transaction,
  Category,
} from '../src';

describe('Transactions (additional coverage)', () => {
  it('off-budget mortgage transfers use Transfers category (like other off-budget transfers)', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'T',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    const checking = await services.accounts.createAccount(
      'Checking',
      budgetId,
      'checking',
      'USD',
      5000
    );
    // Mortgage is off-budget by default - uses Transfers category like other off-budget transfers
    const mortgage = await services.accounts.createAccount(
      'House Loan',
      budgetId,
      'mortgage',
      'USD',
      0,
      { debt_total: 200000 }
    );

    const today = '2024-01-10';
    const transferId = 'tr_mortgage_1';

    // First leg: inflow to mortgage account
    const t1 = await services.transactions.addTransaction(
      1500,
      0,
      mortgage.ID,
      0,
      budgetId,
      today,
      'Mortgage Pay (in)',
      transferId
    );

    // Second leg: outflow from checking
    const t2 = await services.transactions.addTransaction(
      0,
      1500,
      checking.ID,
      0,
      budgetId,
      today,
      'Mortgage Pay (out)',
      transferId
    );

    const tx1 = services.transactions.getTransactionByID(t1);
    const tx2 = services.transactions.getTransactionByID(t2);
    const cat1 = services.categories.getCategory(tx1.CategoryID);
    const cat2 = services.categories.getCategory(tx2.CategoryID);

    // Off-budget mortgage uses Transfers on both sides
    expect(cat1.Name).toBe('Transfers');
    expect(cat2.Name).toBe('Transfers');

    // Liabilities group exists with per-account linked category
    const liabilities = services.categories.getCategoryGroupByName('Liabilities', budgetId);
    expect(liabilities).toBeTruthy();

    // Per-account linked category was created
    const linkedCategory = services.categories.getCategoryByName('House Loan', budgetId);
    expect(linkedCategory).toBeTruthy();
  });

  it('on-budget mortgage uses per-account linked category like other debt accounts', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'On-Budget Mortgage Test',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    const checking = await services.accounts.createAccount(
      'Checking',
      budgetId,
      'checking',
      'USD',
      5000
    );

    // Create on-budget mortgage (override default off-budget behavior)
    const mortgage = await services.accounts.createAccount(
      'Home Loan',
      budgetId,
      'mortgage',
      'USD',
      0,
      { debt_total: 150000 },
      true // on-budget
    );

    const today = '2024-01-15';
    const transferId = 'tr_mortgage_onbudget';

    // First leg: inflow to mortgage
    const t1 = await services.transactions.addTransaction(
      2000,
      0,
      mortgage.ID,
      0,
      budgetId,
      today,
      'Mortgage Pay',
      transferId
    );

    // Second leg: outflow from checking - should use linked category
    const t2 = await services.transactions.addTransaction(
      0,
      2000,
      checking.ID,
      0,
      budgetId,
      today,
      'Mortgage Pay',
      transferId
    );

    const tx1 = services.transactions.getTransactionByID(t1);
    const tx2 = services.transactions.getTransactionByID(t2);
    const cat1 = services.categories.getCategory(tx1.CategoryID);
    const cat2 = services.categories.getCategory(tx2.CategoryID);

    // On-budget mortgage: source uses per-account linked category, dest uses Transfers
    expect(cat1.Name).toBe('Transfers'); // Destination side
    expect(cat2.Name).toBe('Home Loan'); // Source side uses per-account linked category
  });

  it('reconciles account up to date and sets flags', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'R',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    const account = await services.accounts.createAccount('A', budgetId, 'checking', 'USD', 0);
    const allCategories = services.categories.getAllCategories(budgetId);
    const foundCategory = allCategories.find((c: Category) => c.Name !== 'Income');
    if (!foundCategory) {
      throw new Error('No category found that is not Income');
    }
    const cat = foundCategory.ID;

    const tA = await services.transactions.addTransaction(
      0,
      10,
      account.ID,
      cat,
      budgetId,
      '2024-01-01',
      'x'
    );
    const tB = await services.transactions.addTransaction(
      0,
      5,
      account.ID,
      cat,
      budgetId,
      '2024-01-02',
      'y'
    );

    // Ensure Reconciled field is set to false to match query filter
    const stmt = adapter.prepare('UPDATE transactions SET Reconciled = 0 WHERE ID IN (?, ?)');
    stmt.run(tA, tB);
    stmt.finalize();

    services.transactions.reconcileAccount(account.ID, '2024-01-02');

    const rows = services.transactions.getTransactionsByAccount(account.ID);
    // Verify via direct query due to SQLite boolean representation
    const q = adapter.prepare(
      'SELECT COUNT(*) as c FROM transactions WHERE AccountID = ? AND Reconciled = 1'
    );
    const res = q.get(account.ID) as { c: number };
    q.finalize();
    expect(res.c).toBe(rows.length);
    const accRow = services.accounts.getAccount(account.ID);
    expect(accRow.ReconciledAt).toBeTruthy();
  });

  it('upserts transfer/category splits, enforces validation, and creates mirror rows', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'S',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    const acc1 = await services.accounts.createAccount('One', budgetId, 'checking', 'USD', 0);
    const acc2 = await services.accounts.createAccount('Two', budgetId, 'checking', 'USD', 0);
    const allCats = services.categories.getAllCategories(budgetId);
    const foundCat = allCats.find((c: Category) => c.Name !== 'Income');
    if (!foundCat) {
      throw new Error('No category found that is not Income');
    }
    const cat = foundCat.ID;

    const today = '2024-02-05';
    const parentId = await services.transactions.addTransaction(
      0,
      100,
      acc1.ID,
      cat,
      budgetId,
      today,
      'Parent'
    );

    // Invalid: both category and transfer set
    await expect(
      services.splits.upsertSplits(parentId, [
        {
          CategoryID: cat,
          TransferAccountID: acc2.ID,
          Memo: 'bad',
          Inflow: 0,
          Outflow: 100,
          OrderIndex: 0,
        },
      ])
    ).rejects.toThrow(/either CategoryID or TransferAccountID/);

    // Invalid: sum mismatch
    await expect(
      services.splits.upsertSplits(parentId, [
        { CategoryID: cat, Memo: 'x', Inflow: 0, Outflow: 30, OrderIndex: 0 },
        { TransferAccountID: acc2.ID, Memo: 'y', Inflow: 0, Outflow: 50, OrderIndex: 1 },
      ])
    ).rejects.toThrow(/must sum to parent total/);

    // Valid: Outflow 40 to category, 60 transfer to acc2
    await services.splits.upsertSplits(parentId, [
      { CategoryID: cat, Memo: 'part-cat', Inflow: 0, Outflow: 40, OrderIndex: 0 },
      { TransferAccountID: acc2.ID, Memo: 'part-tr', Inflow: 0, Outflow: 60, OrderIndex: 1 },
    ]);

    const splits = services.splits.getSplits(parentId);
    expect(splits).toHaveLength(2);
    expect(splits[0].OrderIndex).toBe(0);
    expect(splits[1].TransferAccountID).toBe(acc2.ID);

    // Mirror transaction should exist for transfer split with same date
    const parent = services.transactions.getTransactionByID(parentId);
    const transferId = `split_transfer_${parent.ID}_${parent.Date}`;
    const mirrorStmt = adapter.prepare(
      'SELECT COUNT(*) as c FROM transactions WHERE TransferID = ? AND AccountID = ?'
    );
    const mirrors = mirrorStmt.get(transferId, acc2.ID) as { c: number };
    mirrorStmt.finalize();
    expect(mirrors.c).toBe(1);
  });

  it('gets transactions by category and month', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();
    const budgetId = await services.budgets.createBudget({
      name: 'CMonth',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    const acc = await services.accounts.createAccount('A', budgetId, 'checking', 'USD', 0);
    const group = services.categories.addCategoryGroup('G', budgetId);
    const cat = services.categories.addCategory(group, budgetId, 'Cat');
    await services.transactions.addTransaction(0, 10, acc.ID, cat, budgetId, '2024-03-01', 'x');
    const rows = services.transactions.getTransactionsByCategoryAndMonth(
      budgetId,
      'Cat',
      '2024-03'
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].Category).toBe('Cat');
  });

  it('updates original amounts and recalculates converted via updateTransactionColumn', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'UTCO',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    const month = '2024-04';
    await services.currency.saveRate('EUR', 'USD', 1.2, month, budgetId);

    const eur = await services.accounts.createAccount('EUR', budgetId, 'checking', 'EUR', 0);
    const allCatsUtco = services.categories.getAllCategories(budgetId);
    const foundCatUtco = allCatsUtco.find((c: Category) => c.Name !== 'Income');
    if (!foundCatUtco) {
      throw new Error('No category found that is not Income');
    }
    const cat = foundCatUtco.ID;

    const date = `${month}-10`;
    const txId = await services.transactions.addTransaction(
      0,
      100,
      eur.ID,
      cat,
      budgetId,
      date,
      'euro'
    );
    let tx = services.transactions.getTransactionByID(txId);
    expect(tx.OutflowOriginal).toBe(100);
    expect(tx.Outflow).toBeCloseTo(120, 6);

    // Update original outflow to 200 EUR; converted should be 240 USD
    await services.transactions.updateTransactionColumn(txId, 'OutflowOriginal', 200);
    tx = services.transactions.getTransactionByID(txId);
    expect(tx.OutflowOriginal).toBeCloseTo(200, 6);
    expect(tx.Outflow).toBeCloseTo(240, 6);
  });

  it('updates converted amounts in budget currency and back-calculates originals', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'UTCB',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    const month = '2024-05';
    await services.currency.saveRate('EUR', 'USD', 1.25, month, budgetId);
    const eur = await services.accounts.createAccount('EUR', budgetId, 'checking', 'EUR', 0);
    const allCatsUtcb = services.categories.getAllCategories(budgetId);
    const foundCatUtcb = allCatsUtcb.find((c: Category) => c.Name !== 'Income');
    if (!foundCatUtcb) {
      throw new Error('No category found that is not Income');
    }
    const cat = foundCatUtcb.ID;
    const date = `${month}-11`;

    const txId = await services.transactions.addTransaction(
      0,
      100,
      eur.ID,
      cat,
      budgetId,
      date,
      'euro2'
    );
    let tx = services.transactions.getTransactionByID(txId);
    expect(tx.Outflow).toBeCloseTo(125, 6);

    // Now edit the converted amount to 250 USD; originals should back-calc to 200 EUR
    await services.transactions.updateTransactionColumn(txId, 'Outflow', 250);
    tx = services.transactions.getTransactionByID(txId);
    expect(tx.Outflow).toBeCloseTo(250, 6);
    expect(tx.OutflowOriginal).toBeCloseTo(200, 6);
  });

  it('overriding the exchange rate on a transfer leg keeps the converted amount and re-derives the original', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    // Budget displays in RSD; transfer RSD bank -> EUR brokerage (IBKR).
    const budgetId = await services.budgets.createBudget({
      name: 'XferRate',
      display_currency: 'RSD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    const month = '2024-07';
    // Market rate: 1 EUR = 100 RSD (kept round so the override math is easy to read).
    await services.currency.saveRate('EUR', 'RSD', 100, month, budgetId);

    const bank = await services.accounts.createAccount('Bank', budgetId, 'checking', 'RSD', 0);
    const ibkr = await services.accounts.createAccount('IBKR', budgetId, 'checking', 'EUR', 0);
    const date = `${month}-10`;
    const transferId = 'tr_fx_override';

    // Outgoing leg: 240,000 RSD leaves the bank (RSD == budget currency, no conversion).
    const outLeg = await services.transactions.addTransaction(
      0,
      240000,
      bank.ID,
      0,
      budgetId,
      date,
      'to IBKR',
      transferId
    );
    // Incoming leg: at the market rate this overstates EUR (2400 EUR == 240,000 RSD).
    const inLeg = await services.transactions.addTransaction(
      2400,
      0,
      ibkr.ID,
      0,
      budgetId,
      date,
      'from Bank',
      transferId
    );

    let incoming = services.transactions.getTransactionByID(inLeg);
    expect(incoming.InflowOriginal).toBeCloseTo(2400, 6); // EUR (native)
    expect(incoming.Inflow).toBeCloseTo(240000, 6); // RSD (budget/converted)

    // The bank's effective rate was worse: 240,000 RSD only bought 2,000 EUR (1 EUR = 120 RSD).
    // Overriding the rate must keep the incoming leg's converted (RSD) value put and correct
    // the original (EUR) amount down — not inflate the RSD value to preserve the EUR amount.
    await services.transactions.updateTransactionColumn(inLeg, 'ExchangeRate', 120);

    incoming = services.transactions.getTransactionByID(inLeg);
    expect(incoming.Inflow).toBeCloseTo(240000, 6); // unchanged — the transfer value is preserved
    expect(incoming.InflowOriginal).toBeCloseTo(2000, 6); // 240,000 / 120 — the EUR actually received
    expect(incoming.ExchangeRate).toBeCloseTo(120, 6);
    expect(!!incoming.ExchangeRateOverride).toBe(true);

    // The outgoing RSD leg is untouched, so both legs still balance at 240,000 RSD.
    const outgoing = services.transactions.getTransactionByID(outLeg);
    expect(outgoing.Outflow).toBeCloseTo(240000, 6);
    expect(outgoing.OutflowOriginal).toBeCloseTo(240000, 6);
  });

  it('syncing a transfer leg preserves a manual rate override on the partner leg', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'XferSync',
      display_currency: 'RSD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    const month = '2024-08';
    // Market rate: 1 EUR = 100 RSD.
    await services.currency.saveRate('EUR', 'RSD', 100, month, budgetId);

    const bank = await services.accounts.createAccount('Bank', budgetId, 'checking', 'RSD', 0);
    const ibkr = await services.accounts.createAccount('IBKR', budgetId, 'checking', 'EUR', 0);
    const date = `${month}-10`;
    const transferId = 'tr_fx_sync';

    const outLeg = await services.transactions.addTransaction(
      0,
      240000000, // RSD 240,000 in milliunits
      bank.ID,
      0,
      budgetId,
      date,
      'to IBKR',
      transferId
    );
    const inLeg = await services.transactions.addTransaction(
      2400000, // EUR 2,400 in milliunits
      0,
      ibkr.ID,
      0,
      budgetId,
      date,
      'from Bank',
      transferId
    );

    // Override the incoming leg with the bank's real rate (1 EUR = 120 RSD).
    await services.transactions.updateTransactionColumn(inLeg, 'ExchangeRate', 120);
    let incoming = services.transactions.getTransactionByID(inLeg);
    expect(incoming.InflowOriginal).toBe(240000000 / 120); // EUR 2,000 in milliunits

    // Editing the OUTGOING leg syncs the partner. The override must survive: the EUR original is
    // re-derived from the user's 120 rate (236,000,000 / 120 ≈ 1,966,666.67, rounded to integer
    // milliunits), not the market rate of 100.
    await services.transactions.updateTransactionColumn(outLeg, 'Outflow', 236000000);

    incoming = services.transactions.getTransactionByID(inLeg);
    expect(incoming.Inflow).toBe(236000000); // mirrors the new outgoing value
    expect(incoming.ExchangeRate).toBeCloseTo(120, 6); // override rate preserved
    expect(!!incoming.ExchangeRateOverride).toBe(true);
    expect(incoming.InflowOriginal).toBe(1966667); // ≈EUR 1,966.67, not market-rate 2,360,000
  });

  it('bulk reassigns categories and supports transfer ID queries and unsupported column path', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'Reassign',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    const acc = await services.accounts.createAccount('A', budgetId, 'checking', 'USD', 0);
    const g = services.categories.addCategoryGroup('GG', budgetId);
    const oldCat = services.categories.addCategory(g, budgetId, 'Old');
    const newCat = services.categories.addCategory(g, budgetId, 'New');
    const d = '2024-06-01';
    const t1 = await services.transactions.addTransaction(0, 10, acc.ID, oldCat, budgetId, d, 't1');
    const t2 = await services.transactions.addTransaction(0, 20, acc.ID, oldCat, budgetId, d, 't2');

    services.transactions.reassignTransactions(newCat, oldCat);
    expect(services.transactions.getTransactionByID(t1).CategoryID).toBe(newCat);
    expect(services.transactions.getTransactionByID(t2).CategoryID).toBe(newCat);

    // TransferID query
    const transferId = 'XFER1';
    const t3 = await services.transactions.addTransaction(
      0,
      5,
      acc.ID,
      newCat,
      budgetId,
      d,
      'x',
      transferId
    );
    const t4 = await services.transactions.addTransaction(
      5,
      0,
      acc.ID,
      newCat,
      budgetId,
      d,
      'y',
      transferId
    );
    const trs = services.transactions.getTransactionsByTransferID(transferId);
    expect(trs.map((t: Transaction) => t.ID).sort()).toEqual([t3, t4].sort());

    // Unsupported column path
    await expect(
      services.transactions.updateTransactionColumn(t3, 'not-supported', 1)
    ).rejects.toThrow(/Unsupported column/);
  });

  it('credit card initial debt uses Transfers category (excluded from budget)', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'CCDebt',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    // Create credit card with initial debt
    const cc = await services.accounts.createAccount('Chase CC', budgetId, 'credit', 'USD', 0, {
      liability: true,
      debt_total: 600,
      paid_so_far: 0,
    });

    // Verify account balance is -600
    const ccAccount = services.accounts.getAccount(cc.ID);
    expect(ccAccount.Balance).toBe(-600);

    // Verify the initial debt transaction uses Transfers category (excluded from budget)
    const ccTransactions = services.transactions.getTransactionsByAccount(cc.ID);
    expect(ccTransactions.length).toBe(1);
    const initialDebtTx = ccTransactions[0];
    const category = services.categories.getCategory(initialDebtTx.CategoryID);
    expect(category.Name).toBe('Transfers');

    // Credit cards do NOT get linked categories (unlike loans/mortgages)
    // because CC spending is categorized when you use the card, not when you pay it
    // BUT they DO get a CC Payment category for YNAB-style tracking
    const ccPaymentCategory = services.categories.getCategoryByName('Chase CC', budgetId);
    expect(ccPaymentCategory).toBeTruthy();

    // Verify the CC Payment category is under "Credit Card Payments" group
    const ccPaymentsGroup = services.categories.getCategoryGroupByName(
      'Credit Card Payments',
      budgetId
    );
    expect(ccPaymentsGroup).toBeTruthy();
    expect(ccPaymentCategory?.CategoryGroupID).toBe(ccPaymentsGroup?.ID);

    // Verify NO linked_category_id in metadata for credit cards (that's for loans)
    // BUT cc_payment_category_id should be set
    const metadata = JSON.parse(ccAccount.Metadata as string);
    expect(metadata.linked_category_id).toBeUndefined();
    expect(metadata.cc_payment_category_id).toBe(ccPaymentCategory?.ID);
  });

  it('transfer to credit card uses Transfers on both sides (CC payments are neutral)', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'CCPay',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    const checking = await services.accounts.createAccount(
      'Checking',
      budgetId,
      'checking',
      'USD',
      1000
    );

    const cc = await services.accounts.createAccount('Chase CC', budgetId, 'credit', 'USD', 0, {
      liability: true,
      debt_total: 600,
      paid_so_far: 0,
    });

    const today = '2024-02-15';
    const transferId = 'tr_cc_pay_1';

    // Pay $500 to credit card
    // CC payments are NEUTRAL transfers - spending was already categorized when you used the card
    // First leg: inflow to credit card
    const t1 = await services.transactions.addTransaction(
      500,
      0,
      cc.ID,
      0,
      budgetId,
      today,
      'CC Payment (in)',
      transferId
    );

    // Second leg: outflow from checking
    const t2 = await services.transactions.addTransaction(
      0,
      500,
      checking.ID,
      0,
      budgetId,
      today,
      'CC Payment (out)',
      transferId
    );

    // Verify: CC inflow should be "Transfers" category
    const tx1 = services.transactions.getTransactionByID(t1);
    const cat1 = services.categories.getCategory(tx1.CategoryID);
    expect(cat1.Name).toBe('Transfers');

    // Verify: Checking outflow should ALSO be "Transfers" (CC payments are neutral)
    const tx2 = services.transactions.getTransactionByID(t2);
    const cat2 = services.categories.getCategory(tx2.CategoryID);
    expect(cat2.Name).toBe('Transfers');

    // Verify CC balance is now -100 (600 debt - 500 payment)
    const ccUpdated = services.accounts.getAccount(cc.ID);
    expect(ccUpdated.Balance).toBe(-100);
  });

  it('overpayment to loan creates split transaction', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'LoanOverpay',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    const checking = await services.accounts.createAccount(
      'Checking',
      budgetId,
      'checking',
      'USD',
      1000
    );

    // Use loan type - overpayment logic only applies to loans/mortgages, not credit cards
    const loan = await services.accounts.createAccount('Car Loan', budgetId, 'loan', 'USD', 0, {
      liability: true,
      debt_total: 600,
      paid_so_far: 0,
    });

    const today = '2024-02-20';
    const transferId = 'tr_loan_overpay_1';

    // Pay $700 to loan (more than $600 debt = $100 overpayment)
    // First leg: inflow to loan
    const _t1 = await services.transactions.addTransaction(
      700,
      0,
      loan.ID,
      0,
      budgetId,
      today,
      'Loan Payment (in)',
      transferId
    );

    // Second leg: outflow from checking (this is where overpayment split happens)
    const t2 = await services.transactions.addTransaction(
      0,
      700,
      checking.ID,
      0,
      budgetId,
      today,
      'Loan Payment (out)',
      transferId
    );

    // Verify loan balance is now +100 (overpaid)
    const loanUpdated = services.accounts.getAccount(loan.ID);
    expect(loanUpdated.Balance).toBe(100);

    // Verify: Source transaction has splits
    const splits = services.splits.getSplits(t2);
    expect(splits.length).toBe(2);

    // Split 1: $600 to linked category (Car Loan)
    const debtSplit = splits.find((s) => s.Outflow === 600);
    expect(debtSplit).toBeTruthy();
    expect(debtSplit?.CategoryID).toBeTruthy();
    const debtCat = services.categories.getCategory(debtSplit?.CategoryID as number);
    expect(debtCat.Name).toBe('Car Loan');

    // Split 2: $100 to Transfers
    const overpaymentSplit = splits.find((s) => s.Outflow === 100);
    expect(overpaymentSplit).toBeTruthy();
    expect(overpaymentSplit?.CategoryID).toBeTruthy();
    const transferCat = services.categories.getCategory(overpaymentSplit?.CategoryID as number);
    expect(transferCat.Name).toBe('Transfers');
  });

  it('transfer to already positive credit card goes entirely to Transfers', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'CCPos',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    const checking = await services.accounts.createAccount(
      'Checking',
      budgetId,
      'checking',
      'USD',
      1000
    );

    // Create CC with no debt (starts at 0, then add a positive balance)
    const cc = await services.accounts.createAccount('Chase CC', budgetId, 'credit', 'USD', 0, {
      liability: true,
      debt_total: 0,
      paid_so_far: 0,
    });

    // Get Transfers category for the initial positive balance transaction
    const transfersCat = services.categories.getCategoryByName('Transfers', budgetId);
    if (!transfersCat) throw new Error('Transfers category not found');

    // First, simulate overpayment scenario - add 100 inflow to make balance positive
    await services.transactions.addTransaction(
      100,
      0,
      cc.ID,
      transfersCat.ID,
      budgetId,
      '2024-02-01',
      'Credit'
    );

    const ccBefore = services.accounts.getAccount(cc.ID);
    expect(ccBefore.Balance).toBe(100); // Positive balance (overpaid/credit)

    const today = '2024-02-20';
    const transferId = 'tr_cc_pos_1';

    // Transfer $50 to an already positive CC
    const t1 = await services.transactions.addTransaction(
      50,
      0,
      cc.ID,
      0,
      budgetId,
      today,
      'Transfer (in)',
      transferId
    );

    const t2 = await services.transactions.addTransaction(
      0,
      50,
      checking.ID,
      0,
      budgetId,
      today,
      'Transfer (out)',
      transferId
    );

    // Both should be Transfers since there's no debt to pay down
    const tx1 = services.transactions.getTransactionByID(t1);
    const tx2 = services.transactions.getTransactionByID(t2);
    const cat1 = services.categories.getCategory(tx1.CategoryID);
    const cat2 = services.categories.getCategory(tx2.CategoryID);

    expect(cat1.Name).toBe('Transfers');
    expect(cat2.Name).toBe('Transfers');

    // No splits should be created (spending amount is 0)
    const splits = services.splits.getSplits(t2);
    expect(splits.length).toBe(0);
  });

  it('renaming a debt account updates its linked category name', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'Rename Test',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    // Create a loan account (debt account with linked category)
    // Note: Credit cards don't get linked categories - only loans/mortgages do
    const loan = await services.accounts.createAccount(
      'Car Loan',
      budgetId,
      'loan',
      'USD',
      0,
      { debt_total: 10000 } // This creates the linked category
    );

    // Verify linked category was created with account name
    const linkedCategoryBefore = services.categories.getCategoryByName('Car Loan', budgetId);
    expect(linkedCategoryBefore).toBeTruthy();
    expect(linkedCategoryBefore?.Name).toBe('Car Loan');

    // Rename the account
    await services.accounts.updateAccount(loan.ID, 'Auto Loan', 'loan', 'USD');

    // Verify linked category name was updated
    const linkedCategoryAfter = services.categories.getCategory(linkedCategoryBefore?.ID as number);
    expect(linkedCategoryAfter.Name).toBe('Auto Loan');

    // Old name should no longer exist
    const oldNameCategory = services.categories.getCategoryByName('Car Loan', budgetId);
    expect(oldNameCategory).toBeNull();
  });

  it('renaming an account updates transfer memos', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'Memo Test',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    // Create two accounts
    const checking = await services.accounts.createAccount(
      'My Checking',
      budgetId,
      'checking',
      'USD',
      5000
    );
    const savings = await services.accounts.createAccount(
      'My Savings',
      budgetId,
      'savings',
      'USD',
      1000
    );

    const today = '2024-03-15';
    const transferId = 'tr_rename_test';

    // Create a transfer with memo containing account names
    await services.transactions.addTransaction(
      0,
      500,
      checking.ID,
      0,
      budgetId,
      today,
      'Transfer from My Checking to My Savings',
      transferId
    );

    const t2 = await services.transactions.addTransaction(
      500,
      0,
      savings.ID,
      0,
      budgetId,
      today,
      'Transfer from My Checking to My Savings',
      transferId
    );

    // Rename the checking account
    await services.accounts.updateAccount(checking.ID, 'Primary Checking', 'checking', 'USD');

    // Verify memos were updated
    const txAfterRename = services.transactions.getTransactionByID(t2);
    expect(txAfterRename.Memo).toBe('Transfer from Primary Checking to My Savings');

    // Rename the savings account
    await services.accounts.updateAccount(savings.ID, 'Emergency Fund', 'savings', 'USD');

    // Verify memos were updated again
    const txAfterSecondRename = services.transactions.getTransactionByID(t2);
    expect(txAfterSecondRename.Memo).toBe('Transfer from Primary Checking to Emergency Fund');
  });

  it('renaming account without name change does not modify anything', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'No Change Test',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    // Use loan type - credit cards don't get linked categories
    const loan = await services.accounts.createAccount('Student Loan', budgetId, 'loan', 'USD', 0, {
      debt_total: 5000,
    });

    const linkedCategoryBefore = services.categories.getCategoryByName('Student Loan', budgetId);
    expect(linkedCategoryBefore).toBeTruthy();

    // Update account without changing name (just metadata or other fields)
    await services.accounts.updateAccount(loan.ID, 'Student Loan', 'loan', 'USD');

    // Category name should still be the same
    const linkedCategoryAfter = services.categories.getCategory(linkedCategoryBefore?.ID as number);
    expect(linkedCategoryAfter.Name).toBe('Student Loan');
  });

  it('deleting one leg of a transfer deletes both legs', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'Transfer Delete Test',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    const checking = await services.accounts.createAccount(
      'Checking',
      budgetId,
      'checking',
      'USD',
      5000
    );
    const savings = await services.accounts.createAccount(
      'Savings',
      budgetId,
      'savings',
      'USD',
      1000
    );

    const today = '2024-04-01';
    const transferId = 'tr_delete_test';

    // Create a transfer (both legs)
    const t1 = await services.transactions.addTransaction(
      0,
      200,
      checking.ID,
      0,
      budgetId,
      today,
      'Transfer to Savings',
      transferId
    );

    const t2 = await services.transactions.addTransaction(
      200,
      0,
      savings.ID,
      0,
      budgetId,
      today,
      'Transfer from Checking',
      transferId
    );

    // Verify both transactions exist
    const tx1Before = services.transactions.getTransactionByID(t1);
    const tx2Before = services.transactions.getTransactionByID(t2);
    expect(tx1Before).toBeTruthy();
    expect(tx2Before).toBeTruthy();

    // Delete only the first leg
    services.transactions.deleteTransaction(t1);

    // Both legs should be deleted
    expect(() => services.transactions.getTransactionByID(t1)).toThrow();
    expect(() => services.transactions.getTransactionByID(t2)).toThrow();

    // Verify balances are correct after deletion
    const checkingAfter = services.accounts.getAccount(checking.ID);
    const savingsAfter = services.accounts.getAccount(savings.ID);
    expect(checkingAfter.Balance).toBe(5000); // Back to original
    expect(savingsAfter.Balance).toBe(1000); // Back to original
  });

  it('deleting the second leg of a transfer also deletes the first leg', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'Transfer Delete Test 2',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    const checking = await services.accounts.createAccount(
      'Checking',
      budgetId,
      'checking',
      'USD',
      3000
    );
    const savings = await services.accounts.createAccount(
      'Savings',
      budgetId,
      'savings',
      'USD',
      500
    );

    const today = '2024-04-02';
    const transferId = 'tr_delete_test_2';

    const t1 = await services.transactions.addTransaction(
      0,
      150,
      checking.ID,
      0,
      budgetId,
      today,
      'Transfer',
      transferId
    );

    const t2 = await services.transactions.addTransaction(
      150,
      0,
      savings.ID,
      0,
      budgetId,
      today,
      'Transfer',
      transferId
    );

    // Delete the second leg (inflow side)
    services.transactions.deleteTransaction(t2);

    // Both legs should be deleted
    expect(() => services.transactions.getTransactionByID(t1)).toThrow();
    expect(() => services.transactions.getTransactionByID(t2)).toThrow();

    // Verify balances are restored
    const checkingAfter = services.accounts.getAccount(checking.ID);
    const savingsAfter = services.accounts.getAccount(savings.ID);
    expect(checkingAfter.Balance).toBe(3000);
    expect(savingsAfter.Balance).toBe(500);
  });

  it('deleting a debt account also deletes its linked category', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'Delete Debt Account Test',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    // Create a loan account with linked category (credit cards don't get linked categories)
    const loan = await services.accounts.createAccount(
      'Personal Loan',
      budgetId,
      'loan',
      'USD',
      0,
      { debt_total: 2000 }
    );

    // Verify linked category was created
    const linkedCategory = services.categories.getCategoryByName('Personal Loan', budgetId);
    expect(linkedCategory).toBeTruthy();
    const linkedCategoryId = linkedCategory?.ID as number;

    // Verify the Liabilities group exists
    const liabilitiesGroup = services.categories.getCategoryGroupByName('Liabilities', budgetId);
    expect(liabilitiesGroup).toBeTruthy();

    // Delete the account
    services.accounts.deleteAccount(loan.ID);

    // Verify account is deleted
    expect(() => services.accounts.getAccount(loan.ID)).toThrow();

    // Verify linked category is also deleted
    expect(() => services.categories.getCategory(linkedCategoryId)).toThrow();

    // Verify the category is no longer findable by name
    const deletedCategory = services.categories.getCategoryByName('Personal Loan', budgetId);
    expect(deletedCategory).toBeNull();

    // Liabilities group should still exist (it may have other categories)
    const liabilitiesGroupAfter = services.categories.getCategoryGroupByName(
      'Liabilities',
      budgetId
    );
    expect(liabilitiesGroupAfter).toBeTruthy();
  });

  it('deleting an off-budget mortgage account also deletes its linked category', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'Delete Mortgage Test',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    // Create a mortgage account (off-budget by default)
    const mortgage = await services.accounts.createAccount(
      'Home Loan',
      budgetId,
      'mortgage',
      'USD',
      0,
      { debt_total: 250000 }
    );

    // Verify linked category was created with account name
    const linkedCategory = services.categories.getCategoryByName('Home Loan', budgetId);
    expect(linkedCategory).toBeTruthy();
    const linkedCategoryId = linkedCategory?.ID as number;

    // Verify account metadata contains linked_category_id
    const accountBefore = services.accounts.getAccount(mortgage.ID);
    const metadata = JSON.parse(accountBefore.Metadata as string);
    expect(metadata.linked_category_id).toBe(linkedCategoryId);

    // Delete the mortgage account
    services.accounts.deleteAccount(mortgage.ID);

    // Verify account is deleted
    expect(() => services.accounts.getAccount(mortgage.ID)).toThrow();

    // Verify linked category is also deleted
    expect(() => services.categories.getCategory(linkedCategoryId)).toThrow();

    // Verify the category is no longer findable by name
    const deletedCategory = services.categories.getCategoryByName('Home Loan', budgetId);
    expect(deletedCategory).toBeNull();
  });

  it('deleting a debt account without linked_category_id still deletes matching category in Liabilities', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'Legacy Debt Account Test',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    // Manually create a Liabilities group and category (simulating legacy account)
    const liabilitiesGroupId = services.categories.addCategoryGroup('Liabilities', budgetId);
    const legacyCategoryId = services.categories.addCategory(
      liabilitiesGroupId,
      budgetId,
      'Old Mortgage',
      ''
    );

    // Create a mortgage account WITHOUT going through normal flow (simulating legacy data)
    // We'll use the database directly to create account without linked_category_id
    const db = sm.getDatabase();
    const stmt = db.prepare(`
      INSERT INTO accounts (Name, Type, Currency, Balance, BudgetID, Metadata, OnBudget)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING ID
    `);
    const result = stmt.run('Old Mortgage', 'mortgage', 'USD', -100000, budgetId, '{}', 0);
    stmt.finalize();
    const mortgageId = result.lastInsertRowid as number;

    // Verify the category exists
    const categoryBefore = services.categories.getCategory(legacyCategoryId);
    expect(categoryBefore.Name).toBe('Old Mortgage');

    // Delete the mortgage account
    services.accounts.deleteAccount(mortgageId);

    // Verify account is deleted
    expect(() => services.accounts.getAccount(mortgageId)).toThrow();

    // Verify the matching category in Liabilities was also deleted (fallback behavior)
    expect(() => services.categories.getCategory(legacyCategoryId)).toThrow();
  });

  it('cannot delete a linked category while the debt account exists', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'Linked Category Protection Test',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    // Create a mortgage account with linked category (credit cards don't get linked categories)
    const mortgage = await services.accounts.createAccount(
      'Home Mortgage',
      budgetId,
      'mortgage',
      'USD',
      0,
      {
        debt_total: 200000,
      }
    );

    // Get the linked category
    const linkedCategory = services.categories.getCategoryByName('Home Mortgage', budgetId);
    expect(linkedCategory).toBeTruthy();

    // Attempting to delete the linked category should throw an error
    expect(() => services.categories.deleteCategory(linkedCategory?.ID as number)).toThrow(
      'Cannot delete category: it tracks payments for the active "Home Mortgage" debt account. Archive or delete the account first.'
    );

    // The category should still exist
    const categoryStillExists = services.categories.getCategory(linkedCategory?.ID as number);
    expect(categoryStillExists.Name).toBe('Home Mortgage');

    // After deleting the account, the category should be deletable (but it's auto-deleted)
    services.accounts.deleteAccount(mortgage.ID);

    // Category was auto-deleted with the account
    expect(() => services.categories.getCategory(linkedCategory?.ID as number)).toThrow();
  });

  it('deleting a non-debt account does not affect categories', async () => {
    const adapter: DatabaseAdapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    const budgetId = await services.budgets.createBudget({
      name: 'Delete Regular Account Test',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });

    // Create a regular checking account (no linked category)
    const checking = await services.accounts.createAccount(
      'Regular Checking',
      budgetId,
      'checking',
      'USD',
      1000
    );

    // Get category count before
    const categoriesBefore = services.categories.getAllCategories(budgetId);
    const categoryCountBefore = categoriesBefore.length;

    // Delete the account
    services.accounts.deleteAccount(checking.ID);

    // Verify account is deleted
    expect(() => services.accounts.getAccount(checking.ID)).toThrow();

    // Category count should be unchanged
    const categoriesAfter = services.categories.getAllCategories(budgetId);
    expect(categoriesAfter.length).toBe(categoryCountBefore);
  });
});
