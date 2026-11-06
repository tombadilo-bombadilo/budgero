import { describe, expect, it, vi } from 'vitest';
import { executeConfirmedAddTransaction, executeConfirmedEditTransaction } from './index';
import type { ToolContext } from './types';

function context() {
  const executeMutation = vi.fn(async () => 42);
  const ctx = {
    budgetId: 1,
    services: {},
    accounts: [{ ID: 7, Name: 'Checking', Type: 'checking' }],
    categories: [{ ID: 3, Name: 'Groceries' }],
    executeMutation,
    aiConfig: {},
    currencySymbol: '€',
  } as unknown as ToolContext;
  return { ctx, executeMutation };
}

describe('confirmed AI transaction tools', () => {
  it('adds a transaction when the model sends null for fields it leaves out', async () => {
    const { ctx, executeMutation } = context();
    const result = await executeConfirmedAddTransaction(
      {
        amount: '12.5',
        isExpense: true,
        accountId: 999, // made up
        accountName: 'checking',
        categoryId: null,
        categoryName: 'groceries',
        date: '2026-11-03',
        memo: null,
        payee: null,
      },
      ctx
    );
    expect(result.success).toBe(true);
    expect(executeMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'transactions.add',
        payload: expect.objectContaining({ accountId: 7, categoryId: 3, outflow: 12_500 }),
      })
    );
  });

  it('answers with what is wrong instead of throwing on bad arguments', async () => {
    const { ctx, executeMutation } = context();
    const result = await executeConfirmedAddTransaction(
      { isExpense: true, date: '2026-11-03' },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('amount');
    expect(executeMutation).not.toHaveBeenCalled();
  });

  it('leaves fields the model sends as null unchanged when editing', async () => {
    const { ctx, executeMutation } = context();
    const result = await executeConfirmedEditTransaction(
      { transactionId: 5, categoryName: 'Groceries', payee: null, memo: null, date: null },
      ctx
    );
    expect(result.success).toBe(true);
    expect(executeMutation).toHaveBeenCalledTimes(1);
    expect(executeMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { id: 5, columnName: 'CategoryID', newValue: 3 },
      })
    );
  });
});
