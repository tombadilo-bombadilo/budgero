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
    await services.currency.saveRate('EUR', 'RSD', EURRSD, dateA, budgetId);

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
    expect(tx.OutflowNative).toBe(100); // 100 EUR
    expect(tx.OutflowConverted).toBeCloseTo(100 * EURRSD, 4); // ~11,750 RSD
    expect(tx.InflowNative).toBe(0);
    expect(tx.InflowConverted).toBe(0);

    // TEST 1: Update DATE - amounts should NOT change
    await services.transactions.updateTransactionColumn(txId, 'Date', dateB);
    tx = services.transactions.getTransactionByID(txId);

    expect(tx.Date).toBe(dateB);
    // Critical: amounts must remain the same (bug would cause 100 EUR -> 11,750 EUR -> 1,380,625 RSD)
    expect(tx.OutflowNative).toBe(100);
    expect(tx.OutflowConverted).toBeCloseTo(100 * EURRSD, 4);
    expect(tx.InflowNative).toBe(0);
    expect(tx.InflowConverted).toBe(0);

    // TEST 2: Update MEMO - amounts should NOT change
    await services.transactions.updateTransactionColumn(txId, 'Memo', 'Updated memo');
    tx = services.transactions.getTransactionByID(txId);

    expect(tx.Memo).toBe('Updated memo');
    expect(tx.OutflowNative).toBe(100);
    expect(tx.OutflowConverted).toBeCloseTo(100 * EURRSD, 4);

    // TEST 3: Update PAYEE - amounts should NOT change
    await services.transactions.updateTransactionColumn(txId, 'Payee', 'Updated Payee');
    tx = services.transactions.getTransactionByID(txId);

    expect(tx.Payee).toBe('Updated Payee');
    expect(tx.OutflowNative).toBe(100);
    expect(tx.OutflowConverted).toBeCloseTo(100 * EURRSD, 4);

    // Verify account balance is still correct
    const account = services.accounts.getAccount(eurAccount.ID);
    expect(account.BalanceNative).toBe(-100); // -100 EUR
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
    await services.currency.saveRate('JPY', 'USD', JPYUSD, dateA, budgetId);
    await services.currency.saveRate('JPY', 'USD', JPYUSD, dateB, budgetId);

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
    expect(tx.InflowNative).toBe(10000); // 10000 JPY
    expect(tx.InflowConverted).toBeCloseTo(10000 * JPYUSD, 4); // ~67 USD
    expect(tx.OutflowNative).toBe(0);
    expect(tx.OutflowConverted).toBe(0);

    // Update date
    await services.transactions.updateTransactionColumn(txId, 'Date', dateB);
    tx = services.transactions.getTransactionByID(txId);

    expect(tx.Date).toBe(dateB);
    expect(tx.InflowNative).toBe(10000);
    expect(tx.InflowConverted).toBeCloseTo(10000 * JPYUSD, 4);

    // Update memo
    await services.transactions.updateTransactionColumn(txId, 'Memo', 'Updated salary');
    tx = services.transactions.getTransactionByID(txId);

    expect(tx.Memo).toBe('Updated salary');
    expect(tx.InflowNative).toBe(10000);
    expect(tx.InflowConverted).toBeCloseTo(10000 * JPYUSD, 4);
  });
});

describe('Transfer partner sync', () => {
  it('keeps leg metadata and a cross-currency partner amount independent', async () => {
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

    // Keep the destination off-budget so transfer payees remain editable;
    // internal on-budget transfers intentionally clear them.
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
      0,
      {},
      false
    );

    const month = '2025-01';
    const dateA = `${month}-10`;
    const dateB = `${month}-11`;
    const EURUSD = 1.2; // 1 EUR = 1.2 USD
    const EURUSD_ON_DESTINATION_DATE = 1.25;
    await services.currency.saveRate('EUR', 'USD', EURUSD, dateA, budgetId);
    await services.currency.saveRate('EUR', 'USD', EURUSD_ON_DESTINATION_DATE, dateB, budgetId);

    // Create a paired transfer: USD outflow $100, stored as integer milliunits.
    const transferId = 'tr_sync_1';
    const usdOutflow = 100_000;
    const eurInflowOriginal = Math.round(usdOutflow / EURUSD);

    const allCategories = services.categories.getAllCategories(budgetId);
    const nonIncomeCategory = allCategories.find((c: Category) => c.Name !== 'Income');
    if (!nonIncomeCategory) {
      throw new Error('Expected non-income category to exist');
    }
    const catId = nonIncomeCategory.ID;
    const sourceLabelId = services.labels.addLabel(budgetId, 'Source', '#1155cc');
    const destinationLabelId = services.labels.addLabel(budgetId, 'Destination', '#22aa44');
    const editedSourceLabelId = services.labels.addLabel(budgetId, 'Edited source', '#cc5511');

    const usdTx = await services.transactions.addTransaction(
      0,
      usdOutflow,
      usd.ID,
      catId,
      budgetId,
      dateA,
      'xfer out',
      transferId,
      'EUR account',
      sourceLabelId
    );

    const eurTx = await services.transactions.addTransaction(
      eurInflowOriginal,
      0,
      eur.ID,
      catId,
      budgetId,
      dateA,
      'xfer in',
      transferId,
      'USD account',
      destinationLabelId
    );

    // Sanity: amounts are mirrored at creation
    let a = services.transactions.getTransactionByID(usdTx);
    let b = services.transactions.getTransactionByID(eurTx);
    expect(a.OutflowConverted).toBeCloseTo(usdOutflow, 6);
    expect(b.InflowConverted).toBeCloseTo(usdOutflow, 6);
    expect(b.InflowNative).toBeCloseTo(eurInflowOriginal, 6);

    // Leg metadata is independent: editing one side must not rewrite the other.
    await services.transactions.updateTransactionColumn(usdTx, 'Memo', 'updated memo');
    await services.transactions.updateTransactionColumn(usdTx, 'Payee', 'Updated payee');
    await services.transactions.updateTransactionColumn(usdTx, 'LabelID', editedSourceLabelId);
    await services.transactions.updateTransactionColumn(eurTx, 'Date', dateB);
    a = services.transactions.getTransactionByID(usdTx);
    b = services.transactions.getTransactionByID(eurTx);
    expect(a.Memo).toBe('updated memo');
    expect(a.Payee).toBe('Updated payee');
    expect(a.LabelID).toBe(editedSourceLabelId);
    expect(a.Date).toBe(dateA);
    expect(b.Memo).toBe('xfer in');
    expect(b.Payee).toBe('USD account');
    expect(b.LabelID).toBe(destinationLabelId);
    expect(b.Date).toBe(dateB);

    // Each leg of a cross-currency transfer holds its own bank amount: editing
    // one leg leaves the partner's amounts alone and changes the implied
    // direct rate instead, which is then marked as overridden (#138).
    const partnerBefore = b;
    await services.transactions.updateTransactionColumn(usdTx, 'OutflowConverted', 150_000);
    a = services.transactions.getTransactionByID(usdTx);
    b = services.transactions.getTransactionByID(eurTx);
    expect(a.OutflowConverted).toBe(150_000);
    expect(b.InflowConverted).toBe(partnerBefore.InflowConverted);
    expect(b.InflowNative).toBe(partnerBefore.InflowNative);
    expect(b.Memo).toBe('xfer in');
    expect(b.Payee).toBe('USD account');
    expect(b.LabelID).toBe(destinationLabelId);
    expect(b.Date).toBe(dateB);
    const details = services.transactions.getTransferRateDetails(transferId)!;
    expect(details.transferRateOverride).toBe(true);
    expect(details.rate).toBeCloseTo(Number(partnerBefore.InflowNative) / 150_000, 10);

    // Editing the destination native amount leaves the source amount alone.
    await services.transactions.updateTransactionColumn(eurTx, 'InflowNative', 200_000);
    a = services.transactions.getTransactionByID(usdTx);
    b = services.transactions.getTransactionByID(eurTx);
    expect(b.InflowNative).toBe(200_000);
    expect(b.InflowConverted).toBe(200_000 * EURUSD_ON_DESTINATION_DATE);
    expect(a.OutflowConverted).toBe(150_000);
    expect(a.Memo).toBe('updated memo');
    expect(a.Payee).toBe('Updated payee');
    expect(a.LabelID).toBe(editedSourceLabelId);
    expect(a.Date).toBe(dateA);
  });
});
