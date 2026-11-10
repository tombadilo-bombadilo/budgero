import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  executeConfirmedAddTransaction,
  executeConfirmedEditTransaction,
  failureText,
  generateAddTransactionPreview,
  generateEditTransactionPreview,
  prepareConfirmedTool,
} from './index';
import { addTransactionSchema, type AddTransactionArgs } from './add-transaction';
import { editTransactionSchema } from './edit-transaction';
import { queryBudgetSchema } from './query-budget';
import { queryTransactionsSchema } from './query-transactions';
import { renderChartSchema } from './query-chart';
import { resolveEntity } from './resolve-entity';
import { pickPendingTool } from '../chat-client';
import type { ToolContext } from './types';

function context(overrides: Partial<ToolContext> = {}) {
  const executeMutation = vi.fn(async (_spec: { payload: unknown }) => 42);
  const ctx = {
    budgetId: 1,
    services: {
      transactions: {
        getTransactionByID: () => {
          throw new Error('not loaded');
        },
      },
    },
    accounts: [{ ID: 7, Name: 'Checking', Type: 'checking' }],
    categories: [{ ID: 3, Name: 'Groceries' }],
    executeMutation,
    aiConfig: {},
    currencySymbol: '€',
    ...overrides,
  } as unknown as ToolContext;
  return { ctx, executeMutation };
}

const add = (extra: Record<string, unknown> = {}) => ({
  amount: 12.5,
  isExpense: true,
  accountName: 'Checking',
  date: '2026-11-03',
  ...extra,
});

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
    // The saved history line carries the field-level error for the model.
    expect(failureText(result)).toContain('amount: must be a positive number');
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

describe('argument coercion', () => {
  const amountOk = (amount: unknown) => addTransactionSchema.safeParse(add({ amount })).success;

  it('takes numbers and numeric strings as the amount', () => {
    expect(addTransactionSchema.parse(add({ amount: ' 12.50 ' })).amount).toBe(12.5);
    expect(amountOk(0.01)).toBe(true);
  });

  it.each([true, false, null, '', '  ', 'abc', '12abc', 0, -5, '-5', Number.NaN, Infinity, [], {}])(
    'rejects %j as the amount',
    (amount) => {
      expect(amountOk(amount)).toBe(false);
    }
  );

  it.each([true, '', 0, -1, 1.5, 'x'])('rejects %j as an ID', (id) => {
    expect(addTransactionSchema.safeParse(add({ accountId: id })).success).toBe(false);
    expect(addTransactionSchema.safeParse(add({ categoryId: id })).success).toBe(false);
    expect(editTransactionSchema.safeParse({ transactionId: id, memo: 'x' }).success).toBe(false);
  });

  it('rejects a null transaction ID but takes null optional IDs and numeric strings', () => {
    expect(editTransactionSchema.safeParse({ transactionId: null, memo: 'x' }).success).toBe(false);
    const parsed = addTransactionSchema.parse(add({ accountId: '7', categoryId: null }));
    expect(parsed.accountId).toBe(7);
    expect(parsed.categoryId).toBeNull();
    expect(editTransactionSchema.parse({ transactionId: '5', memo: 'x' }).transactionId).toBe(5);
  });

  it.each(['', '03/11/2026', '2026-13-01', '2026-02-30', '2026-11-03T10:00:00Z', 'today'])(
    'rejects %j as a date',
    (date) => {
      expect(addTransactionSchema.safeParse(add({ date })).success).toBe(false);
      expect(editTransactionSchema.safeParse({ transactionId: 5, date }).success).toBe(false);
    }
  );

  it('still describes every tool to the model as a JSON schema', () => {
    for (const schema of [
      addTransactionSchema,
      editTransactionSchema,
      queryBudgetSchema,
      queryTransactionsSchema,
      renderChartSchema,
    ]) {
      const json = z.toJSONSchema(schema, { io: 'input' }) as {
        type?: string;
        properties?: Record<string, { type?: string }>;
      };
      expect(json.type).toBe('object');
      expect(Object.keys(json.properties ?? {}).length).toBeGreaterThan(0);
    }
    const json = z.toJSONSchema(addTransactionSchema, { io: 'input' }) as {
      properties: Record<string, { type?: string }>;
    };
    expect(json.properties.amount.type).toBe('number');
  });

  it('reads null fields of the read-only tools as absent', () => {
    expect(
      queryBudgetSchema.parse({
        queryType: 'account_balances',
        categoryId: null,
        accountName: null,
        limit: null,
      })
    ).toEqual({ queryType: 'account_balances' });
    expect(
      queryTransactionsSchema.parse({
        aggregation: 'list',
        filters: { payee: 'Lidl', dateFrom: null, minAmount: null },
        orderBy: null,
        limit: null,
      })
    ).toMatchObject({ filters: { payee: 'Lidl' } });
    const tx = queryTransactionsSchema.parse({
      aggregation: 'sum',
      filters: null,
      limit: null,
    });
    expect(tx.filters).toBeUndefined();
    expect(tx.limit).toBeUndefined();
  });
});

describe('account and category resolution', () => {
  const accounts = [
    { ID: 1, Name: 'Visa Card', Type: 'credit' },
    { ID: 2, Name: 'Debit Card', Type: 'checking' },
    { ID: 3, Name: 'Cash', Type: 'cash' },
    { ID: 4, Name: 'Old Cash Jar', Type: 'cash', Archived: true },
    { ID: 5, Name: '', Type: 'cash' },
  ];
  const categories = [
    { ID: 10, Name: 'Groceries' },
    { ID: 11, Name: 'Eating Out' },
    { ID: 12, Name: 'Eating In' },
  ];

  it('prefers a known ID, then an exact name, then a single substring match', () => {
    expect(resolveEntity(accounts, 2, 'Cash')).toMatchObject({ entity: { ID: 2 } });
    expect(resolveEntity(accounts, 999, 'cash')).toMatchObject({
      kind: 'found',
      entity: { ID: 3 },
    });
    expect(resolveEntity(accounts, null, 'visa')).toMatchObject({ entity: { ID: 1 } });
    expect(resolveEntity(accounts, null, 'my visa card')).toMatchObject({ entity: { ID: 1 } });
    expect(resolveEntity(accounts, null, 'savings')).toEqual({ kind: 'not_found' });
    expect(resolveEntity(accounts, 999, null)).toEqual({ kind: 'not_found' });
    expect(resolveEntity(accounts, null, '  ')).toEqual({ kind: 'unspecified' });
  });

  it('returns every candidate of an ambiguous name instead of picking one', () => {
    const result = resolveEntity(accounts, null, 'card');
    expect(result.kind).toBe('ambiguous');
    expect(result.kind === 'ambiguous' && result.candidates.map((a) => a.ID)).toEqual([1, 2]);
  });

  it('gives no confirm card for an ambiguous account and names the candidates', async () => {
    const { ctx, executeMutation } = context({ accounts, categories });
    const prepared = prepareConfirmedTool('add_transaction', add({ accountName: 'card' }), ctx);
    expect(prepared.ok).toBe(false);
    expect(!prepared.ok && failureText(prepared.result)).toBe(
      'More than one account matches "card". Which one: Visa Card, Debit Card?'
    );
    // Confirming such a call anyway writes nothing.
    const result = await executeConfirmedAddTransaction(add({ accountName: 'card' }), ctx);
    expect(result.success).toBe(false);
    expect(executeMutation).not.toHaveBeenCalled();
  });

  it('never targets an archived account', () => {
    const { ctx } = context({ accounts, categories });
    // "cash" is exact for the open account even though the archived one contains it.
    const exact = prepareConfirmedTool('add_transaction', add({ accountName: 'cash' }), ctx);
    expect(exact.ok && exact.args.accountId).toBe(3);
    for (const target of [{ accountId: 4, accountName: null }, { accountName: 'jar' }]) {
      const prepared = prepareConfirmedTool('add_transaction', add(target), ctx);
      expect(prepared.ok).toBe(false);
      expect(!prepared.ok && prepared.result.error).toBe(
        'Available accounts: Visa Card, Debit Card, Cash'
      );
    }
  });

  it('asks for an account when none is given', () => {
    const { ctx } = context({ accounts, categories });
    const prepared = prepareConfirmedTool(
      'add_transaction',
      add({ accountName: null, accountId: null }),
      ctx
    );
    expect(!prepared.ok && prepared.result.message).toBe('Please specify an account');
  });

  it('writes to the account and category the card showed, pinned by ID', async () => {
    const { ctx, executeMutation } = context({ accounts, categories });
    const prepared = prepareConfirmedTool(
      'add_transaction',
      add({ accountId: 999, accountName: 'visa', categoryName: 'grocer', payee: 'Lidl' }),
      ctx
    );
    if (!prepared.ok) throw new Error('expected a confirm card');
    expect(prepared.preview).toBe(
      'Expense: €12.50 • Date: 2026-11-03 • Account: Visa Card • Category: Groceries • Payee: Lidl • Memo: Lidl'
    );
    expect(prepared.args).toMatchObject({ accountId: 1, categoryId: 10 });

    // The budget changes between card and Confirm: a second "visa" account appears.
    ctx.accounts = [...accounts, { ID: 9, Name: 'Visa Gold', Type: 'credit' }];
    const result = await executeConfirmedAddTransaction(prepared.args, ctx);
    expect(result.success).toBe(true);
    expect(executeMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ accountId: 1, categoryId: 10, memo: 'Lidl' }),
      })
    );
  });

  it('gives no card for an ambiguous category', () => {
    const { ctx } = context({ accounts, categories });
    const prepared = prepareConfirmedTool(
      'add_transaction',
      add({ accountName: 'Cash', categoryName: 'eating' }),
      ctx
    );
    expect(!prepared.ok && failureText(prepared.result)).toBe(
      'More than one category matches "eating". Which one: Eating Out, Eating In?'
    );
    const edit = prepareConfirmedTool(
      'edit_transaction',
      { transactionId: 5, categoryName: 'eating' },
      ctx
    );
    expect(!edit.ok && edit.result.error).toBe('Which one: Eating Out, Eating In?');
  });

  it('says on the card that an unknown category will be left uncategorized', async () => {
    const { ctx, executeMutation } = context({ accounts, categories });
    const prepared = prepareConfirmedTool(
      'add_transaction',
      add({ accountName: 'Cash', categoryName: 'Coffee' }),
      ctx
    );
    if (!prepared.ok) throw new Error('expected a confirm card');
    expect(prepared.preview).toContain('Category: "Coffee" not found — will be uncategorized');
    // Memo on the card is the memo that gets written.
    expect(prepared.preview).toContain('Memo: Coffee');
    const result = await executeConfirmedAddTransaction(prepared.args, ctx);
    expect(result.message).toContain('category "Coffee" not found');
    expect(executeMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ accountId: 3, categoryId: 0, memo: 'Coffee' }),
      })
    );
  });

  it('always shows the account and the category state on the card', () => {
    const { ctx } = context({ accounts, categories });
    const preview = generateAddTransactionPreview(
      add({ accountName: 'debit', isExpense: false }) as AddTransactionArgs,
      ctx
    );
    expect(preview).toBe(
      'Income: €12.50 • Date: 2026-11-03 • Account: Debit Card • Category: none (uncategorized) • Memo: Transaction'
    );
  });
});

describe('edit previews', () => {
  it('lists exactly the changes that will be written', async () => {
    const { ctx, executeMutation } = context();
    const args = { transactionId: 5, categoryName: 'grocer', payee: null, memo: '', date: null };
    const prepared = prepareConfirmedTool('edit_transaction', args, ctx);
    if (!prepared.ok) throw new Error('expected a confirm card');
    expect(prepared.preview).toBe('Edit #5: category → Groceries • memo → ""');
    expect(prepared.preview).not.toContain('null');
    expect(prepared.args.categoryId).toBe(3);

    await executeConfirmedEditTransaction(prepared.args, ctx);
    expect(executeMutation.mock.calls.map(([spec]) => spec.payload)).toEqual([
      { id: 5, columnName: 'CategoryID', newValue: 3 },
      { id: 5, columnName: 'Memo', newValue: '' },
    ]);
  });

  it('gives no card when nothing would change or the category is unknown', () => {
    const { ctx } = context();
    const nothing = prepareConfirmedTool(
      'edit_transaction',
      { transactionId: 5, payee: null, memo: null, date: null, categoryId: null },
      ctx
    );
    expect(!nothing.ok && nothing.result.message).toBe('No changes specified');
    const unknown = prepareConfirmedTool(
      'edit_transaction',
      { transactionId: 5, categoryName: 'Rent' },
      ctx
    );
    expect(!unknown.ok && failureText(unknown.result)).toBe(
      'Category "Rent" not found. Available categories: Groceries'
    );
    expect(
      generateEditTransactionPreview({ transactionId: 5, categoryName: 'Rent' }, ctx)
    ).toContain('not found');
  });
});

describe('invalid calls', () => {
  it.each([
    ['add_transaction', { isExpense: true, date: '2026-11-03' }],
    ['add_transaction', add({ amount: true })],
    ['add_transaction', add({ date: '' })],
    ['add_transaction', 'not even an object'],
    ['add_transaction', undefined],
    ['edit_transaction', { transactionId: 5, date: '' }],
    ['edit_transaction', { memo: 'x' }],
  ])('gives no confirm card for %s %j', (toolName, args) => {
    const { ctx } = context();
    const prepared = prepareConfirmedTool(toolName, args, ctx);
    expect(prepared.ok).toBe(false);
    expect(!prepared.ok && prepared.result.error).toBeTruthy();
  });

  it('names each bad field for the model', () => {
    const { ctx } = context();
    const prepared = prepareConfirmedTool(
      'add_transaction',
      add({ amount: '', date: '3 Nov' }),
      ctx
    );
    expect(!prepared.ok && failureText(prepared.result)).toBe(
      'Those transaction details are incomplete or not valid. amount: must be a positive number; date: must be a date in YYYY-MM-DD format. Nothing was changed.'
    );
  });

  it('skips calls the SDK marked invalid when looking for a pending tool', () => {
    const invalid = {
      toolCallId: 'a',
      toolName: 'add_transaction',
      input: '{"amount":',
      invalid: true,
    };
    const valid = { toolCallId: 'b', toolName: 'add_transaction', input: add() };
    const query = { toolCallId: 'c', toolName: 'query_budget', input: {} };
    expect(pickPendingTool([{ toolCalls: [invalid] }, { toolCalls: [query] }])).toBeUndefined();
    expect(pickPendingTool([{ toolCalls: [invalid] }, { toolCalls: [valid] }])).toMatchObject({
      toolCallId: 'b',
    });
  });
});
