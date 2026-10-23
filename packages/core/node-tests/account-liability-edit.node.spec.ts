import { describe, it, expect } from 'vitest';
import { NodeSqlJsAdapter, ServiceManager, DatabaseAdapter, asMilli } from '../src';

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') return JSON.parse(raw || '{}');
  return (raw as Record<string, unknown>) || {};
}

describe('AccountService.updateAccount — liability edits', () => {
  async function setup() {
    const adapter = await NodeSqlJsAdapter.create();
    const sm = new ServiceManager();
    await sm.initialize(adapter as DatabaseAdapter);
    const services = sm.getServices();
    const budgetId = await services.budgets.createBudget({
      name: 'LiabilityEdit',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: false,
    });
    const transfersId = () => services.categories.getCategoryByName('Transfers', budgetId)?.ID;
    const rowsOf = (accountId: number) => services.transactions.getTransactionsByAccount(accountId);
    return { services, budgetId, transfersId, rowsOf };
  }

  it('renaming a credit card keeps its metadata and its Initial Debt row', async () => {
    const { services, budgetId, transfersId, rowsOf } = await setup();
    const { accounts, categories } = services;
    const card = await accounts.createAccount('Chase', budgetId, 'credit', 'USD', asMilli(0), {
      liability: true,
      liability_type: 'credit',
      debt_total: asMilli(1_500_000),
      min_payment_monthly: asMilli(35_000),
      payment_frequency: 'monthly',
    });
    const before = rowsOf(card.ID);
    expect(before).toHaveLength(1);

    // What the edit dialog now sends for a rename: stored metadata, merged.
    const stored = parseMetadata(accounts.getAccount(card.ID).Metadata);
    await accounts.updateAccount(card.ID, 'Chase Sapphire', 'credit', 'USD', { ...stored });

    const md = parseMetadata(accounts.getAccount(card.ID).Metadata);
    expect(md.min_payment_monthly).toBe(35_000);
    expect(md.debt_total).toBe(1_500_000);
    expect(md.cc_payment_category_id).toBe(stored.cc_payment_category_id);

    const after = rowsOf(card.ID);
    expect(after).toHaveLength(1);
    expect(after[0].ID).toBe(before[0].ID);
    expect(after[0].Memo).toBe('Initial Debt');
    expect(after[0].CategoryID).toBe(transfersId());
    expect(after[0].OutflowConverted).toBe(1_500_000);
    // No budget category named after the account type is created.
    expect(categories.getCategoryByName('Credit', budgetId)).toBeFalsy();
  });

  it('changing a loan’s starting debt updates the one Initial Debt row in Transfers', async () => {
    const { services, budgetId, transfersId, rowsOf } = await setup();
    const { accounts } = services;
    const loan = await accounts.createAccount(
      'Car loan',
      budgetId,
      'loan',
      'USD',
      asMilli(0),
      {
        liability: true,
        liability_type: 'loan',
        debt_total: asMilli(20_000_000),
        paid_so_far: asMilli(2_000_000),
        term_years: 5,
      },
      true,
      'Initial Balance',
      '2025-01-15'
    );
    const debtRow = rowsOf(loan.ID).find((r) => r.Memo === 'Initial Debt')!;

    const stored = parseMetadata(accounts.getAccount(loan.ID).Metadata);
    await accounts.updateAccount(loan.ID, 'Car loan', 'loan', 'USD', {
      ...stored,
      debt_total: asMilli(18_000_000),
    });

    const rows = rowsOf(loan.ID);
    const debtRows = rows.filter((r) => r.Memo === 'Initial Debt');
    expect(debtRows).toHaveLength(1);
    expect(debtRows[0].ID).toBe(debtRow.ID);
    expect(debtRows[0].OutflowConverted).toBe(18_000_000);
    expect(debtRows[0].Date).toBe('2025-01-15');
    expect(debtRows[0].CategoryID).toBe(transfersId());
    // Prior payments untouched; balance = 18,000 - 2,000.
    expect(rows.filter((r) => r.Memo === 'Prior payments')).toHaveLength(1);
    expect(accounts.getAccount(loan.ID).BalanceNative).toBe(-16_000_000);

    const md = parseMetadata(accounts.getAccount(loan.ID).Metadata);
    expect(md.term_years).toBe(5);
    expect(md.paid_so_far).toBe(2_000_000);
    expect(md.linked_category_id).toBe(stored.linked_category_id);
  });

  it('never adds a second debt row to an account opened with a plain balance', async () => {
    const { services, budgetId, rowsOf } = await setup();
    const { accounts } = services;
    const card = await accounts.createAccount('Visa', budgetId, 'credit', 'USD', asMilli(-500_000));
    expect(rowsOf(card.ID)).toHaveLength(1);

    const stored = parseMetadata(accounts.getAccount(card.ID).Metadata);
    await accounts.updateAccount(card.ID, 'Visa', 'credit', 'USD', {
      ...stored,
      liability: true,
      debt_total: asMilli(500_000),
    });
    // Replay of the legacy op from an older client.
    await accounts.upsertLiabilityStarts(card.ID, asMilli(500_000), null);

    expect(rowsOf(card.ID)).toHaveLength(1);
    expect(accounts.getAccount(card.ID).BalanceNative).toBe(-500_000);
  });

  it('creates the Initial Debt row for a liability with no transactions yet', async () => {
    const { services, budgetId, transfersId, rowsOf } = await setup();
    const { accounts } = services;
    const loan = await accounts.createAccount('Mortgage', budgetId, 'mortgage', 'USD', asMilli(0), {
      liability: true,
    });
    expect(rowsOf(loan.ID)).toHaveLength(0);

    const stored = parseMetadata(accounts.getAccount(loan.ID).Metadata);
    await accounts.updateAccount(loan.ID, 'Mortgage', 'mortgage', 'USD', {
      ...stored,
      debt_total: asMilli(300_000_000),
    });
    await accounts.upsertLiabilityStarts(loan.ID, asMilli(300_000_000), null);

    const rows = rowsOf(loan.ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].Memo).toBe('Initial Debt');
    expect(rows[0].CategoryID).toBe(transfersId());
    expect(rows[0].OutflowConverted).toBe(300_000_000);
  });

  it('legacy replay moves a mis-categorized Initial Debt row back to Transfers', async () => {
    const { services, budgetId, transfersId, rowsOf } = await setup();
    const { accounts, categories, transactions } = services;
    const loan = await accounts.createAccount('Student loan', budgetId, 'loan', 'USD', asMilli(0), {
      liability: true,
      debt_total: asMilli(9_000_000),
    });
    const row = rowsOf(loan.ID)[0];
    // What the old app-side op did: move it into a "Loan" budget category.
    const groupId = categories.getCategoryGroupByName('Liabilities', budgetId)!.ID;
    const loanCategoryId = categories.addCategory(groupId, budgetId, 'Loan', '');
    await transactions.updateTransaction(
      row.ID,
      asMilli(0),
      asMilli(9_000_000),
      loan.ID,
      loanCategoryId,
      row.Date,
      row.Memo
    );

    await accounts.upsertLiabilityStarts(loan.ID, asMilli(9_000_000), null);

    const rows = rowsOf(loan.ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].CategoryID).toBe(transfersId());
    expect(rows[0].OutflowConverted).toBe(9_000_000);
  });
});
