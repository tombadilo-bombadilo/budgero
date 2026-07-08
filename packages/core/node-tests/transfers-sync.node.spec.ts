import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, Services, Category } from '../src';

describe('Multi-currency updateTransactionColumn preserves amounts', () => {
  it('updating date/memo/payee should NOT double-convert amounts (high exchange rate)', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    // Budget in RSD (Serbian Dinar)
    const budgetId = await services.budgets.createBudget({
      name: 'RSD Budget',
      display_currency: 'RSD',
      badge_icon: 'dollar',
      number_format: 'dollar',
      create_default_categories: true,
    });

    // EUR account (foreign currency)
    const eurAccount = await services.accounts.createAccount(
      'EUR Checking',
      budgetId,
      'checking',
      'EUR',
      0
    );

    const month = '2025-01';
    const dateA = `${month}-10`;
    const dateB = `${month}-15`;
    const EURRSD = 117.5; // 1 EUR = ~117.5 RSD (realistic rate)
    await services.currency.saveRate('EUR', 'RSD', EURRSD, month, budgetId);

    const allCategories = services.categories.getAllCategories(budgetId);
    const nonIncomeCategory = allCategories.find((c: Category) => c.Name !== 'Income');
    if (!nonIncomeCategory) {
      throw new Error('Expected non-income category to exist');
    }
    const catId = nonIncomeCategory.ID;

    // Add 100 EUR outflow
    const txId = await services.transactions.addTransaction(
      0,
      100, // 100 EUR original
      eurAccount.ID,
      catId,
      budgetId,
      dateA,
      'Initial memo',
      '',
      'Initial Payee'
    );

    // Verify initial state
    let tx = services.transactions.getTransactionByID(txId);
    expect(tx.OutflowOriginal).toBe(100); // 100 EUR
    expect(tx.Outflow).toBeCloseTo(100 * EURRSD, 4); // ~11,750 RSD
    expect(tx.InflowOriginal).toBe(0);
    expect(tx.Inflow).toBe(0);

    // TEST 1: Update DATE - amounts should NOT change
    await services.transactions.updateTransactionColumn(txId, 'Date', dateB);
    tx = services.transactions.getTransactionByID(txId);

    expect(tx.Date).toBe(dateB);
    // Critical: amounts must remain the same (bug would cause 100 EUR -> 11,750 EUR -> 1,380,625 RSD)
    expect(tx.OutflowOriginal).toBe(100);
    expect(tx.Outflow).toBeCloseTo(100 * EURRSD, 4);
    expect(tx.InflowOriginal).toBe(0);
    expect(tx.Inflow).toBe(0);

    // TEST 2: Update MEMO - amounts should NOT change
    await services.transactions.updateTransactionColumn(txId, 'Memo', 'Updated memo');
    tx = services.transactions.getTransactionByID(txId);

    expect(tx.Memo).toBe('Updated memo');
    expect(tx.OutflowOriginal).toBe(100);
    expect(tx.Outflow).toBeCloseTo(100 * EURRSD, 4);

    // TEST 3: Update PAYEE - amounts should NOT change
    await services.transactions.updateTransactionColumn(txId, 'Payee', 'Updated Payee');
    tx = services.transactions.getTransactionByID(txId);

    expect(tx.Payee).toBe('Updated Payee');
    expect(tx.OutflowOriginal).toBe(100);
    expect(tx.Outflow).toBeCloseTo(100 * EURRSD, 4);

    // Verify account balance is still correct
    const account = services.accounts.getAccount(eurAccount.ID);
    expect(account.Balance).toBe(-100); // -100 EUR
    expect(account.BalanceConverted).toBeCloseTo(-100 * EURRSD, 4); // ~-11,750 RSD
  });

  it('updating date/memo/payee preserves INFLOW amounts correctly', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    // Budget in USD
    const budgetId = await services.budgets.createBudget({
      name: 'USD Budget',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: 'dollar',
      create_default_categories: true,
    });

    // JPY account (high exchange rate in reverse)
    const jpyAccount = await services.accounts.createAccount(
      'JPY Checking',
      budgetId,
      'checking',
      'JPY',
      0
    );

    const month = '2025-01';
    const dateA = `${month}-05`;
    const dateB = `${month}-20`;
    const JPYUSD = 0.0067; // 1 JPY = ~0.0067 USD (realistic rate)
    await services.currency.saveRate('JPY', 'USD', JPYUSD, month, budgetId);

    const allCategories = services.categories.getAllCategories(budgetId);
    const incomeCategory = allCategories.find((c: Category) => c.Name === 'Income');
    if (!incomeCategory) {
      throw new Error('Expected income category to exist');
    }

    // Add 10000 JPY inflow (income)
    const txId = await services.transactions.addTransaction(
      10000, // 10000 JPY original inflow
      0,
      jpyAccount.ID,
      incomeCategory.ID,
      budgetId,
      dateA,
      'Salary'
    );

    // Verify initial state
    let tx = services.transactions.getTransactionByID(txId);
    expect(tx.InflowOriginal).toBe(10000); // 10000 JPY
    expect(tx.Inflow).toBeCloseTo(10000 * JPYUSD, 4); // ~67 USD
    expect(tx.OutflowOriginal).toBe(0);
    expect(tx.Outflow).toBe(0);

    // Update date
    await services.transactions.updateTransactionColumn(txId, 'Date', dateB);
    tx = services.transactions.getTransactionByID(txId);

    expect(tx.Date).toBe(dateB);
    expect(tx.InflowOriginal).toBe(10000);
    expect(tx.Inflow).toBeCloseTo(10000 * JPYUSD, 4);

    // Update memo
    await services.transactions.updateTransactionColumn(txId, 'Memo', 'Updated salary');
    tx = services.transactions.getTransactionByID(txId);

    expect(tx.Memo).toBe('Updated salary');
    expect(tx.InflowOriginal).toBe(10000);
    expect(tx.Inflow).toBeCloseTo(10000 * JPYUSD, 4);
  });
});

describe('Transfer partner sync (date/memo/amount)', () => {
  it('mirrors date, memo and amounts for simple two-leg transfers (multi-currency)', async () => {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter);
    const services: Services = sm.getServices();

    // Budget in USD
    const budgetId = await services.budgets.createBudget({
      name: 'TSync',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: 'dollar',
      create_default_categories: true,
    });

    // Accounts: USD and EUR
    const usd = await services.accounts.createAccount(
      'USD Checking',
      budgetId,
      'checking',
      'USD',
      0
    );
    const eur = await services.accounts.createAccount(
      'EUR Checking',
      budgetId,
      'checking',
      'EUR',
      0
    );

    const month = '2025-01';
    const dateA = `${month}-10`;
    const dateB = `${month}-11`;
    const EURUSD = 1.2; // 1 EUR = 1.2 USD
    await services.currency.saveRate('EUR', 'USD', EURUSD, month, budgetId);

    // Create a paired transfer: USD outflow $100, EUR inflow €(100 / 1.2)
    const transferId = 'tr_sync_1';
    const usdOutflow = 100;
    const eurInflowOriginal = usdOutflow / EURUSD; // ≈ 83.3333 EUR

    const allCategories = services.categories.getAllCategories(budgetId);
    const nonIncomeCategory = allCategories.find((c: Category) => c.Name !== 'Income');
    if (!nonIncomeCategory) {
      throw new Error('Expected non-income category to exist');
    }
    const catId = nonIncomeCategory.ID;

    const usdTx = await services.transactions.addTransaction(
      0,
      usdOutflow,
      usd.ID,
      catId,
      budgetId,
      dateA,
      'xfer out',
      transferId
    );

    const eurTx = await services.transactions.addTransaction(
      eurInflowOriginal,
      0,
      eur.ID,
      catId,
      budgetId,
      dateA,
      'xfer in',
      transferId
    );

    // Sanity: amounts are mirrored at creation
    let a = services.transactions.getTransactionByID(usdTx);
    let b = services.transactions.getTransactionByID(eurTx);
    expect(a.Outflow).toBeCloseTo(usdOutflow, 6);
    expect(b.Inflow).toBeCloseTo(usdOutflow, 6);
    expect(b.InflowOriginal).toBeCloseTo(eurInflowOriginal, 6);

    // 1) Update USD memo; partner memo should mirror
    await services.transactions.updateTransactionColumn(usdTx, 'Memo', 'updated memo');
    a = services.transactions.getTransactionByID(usdTx);
    b = services.transactions.getTransactionByID(eurTx);
    expect(a.Memo).toBe('updated memo');
    expect(b.Memo).toBe('updated memo');

    // 2) Update EUR date; USD date should mirror
    await services.transactions.updateTransactionColumn(eurTx, 'Date', dateB);
    a = services.transactions.getTransactionByID(usdTx);
    b = services.transactions.getTransactionByID(eurTx);
    expect(a.Date).toBe(dateB);
    expect(b.Date).toBe(dateB);

    // 3) Update USD converted amount (budget currency): Outflow 150 USD
    await services.transactions.updateTransactionColumn(usdTx, 'Outflow', 150);
    a = services.transactions.getTransactionByID(usdTx);
    b = services.transactions.getTransactionByID(eurTx);
    // USD side reflects 150 outflow
    expect(a.Outflow).toBeCloseTo(150, 6);
    // EUR partner mirrors converted inflow 150 and recalculates originals (≈ 125 EUR)
    expect(b.Inflow).toBeCloseTo(150, 6);
    expect(b.InflowOriginal).toBeCloseTo(150 / EURUSD, 6);

    // 4) Update EUR original amount: set inflow_original to 200 EUR -> partner should mirror 240 USD outflow
    await services.transactions.updateTransactionColumn(eurTx, 'InflowOriginal', 200);
    a = services.transactions.getTransactionByID(usdTx);
    b = services.transactions.getTransactionByID(eurTx);
    // EUR side converted inflow becomes 240 USD, partner USD outflow becomes 240
    expect(b.Inflow).toBeCloseTo(200 * EURUSD, 6);
    expect(a.Outflow).toBeCloseTo(200 * EURUSD, 6);
  });
});
