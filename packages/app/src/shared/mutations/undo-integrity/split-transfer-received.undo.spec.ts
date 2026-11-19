/**
 * Split transfer lines with an entered received amount (#148): the
 * originating device turns it into the mirror's exact amounts and the op
 * carries them (format 7), so every device writes the same mirror; undo and
 * redo put it back exactly, and later parent edits / copies keep it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asMilli } from '@budgero/core/browser';
import { mutationFormatVersion } from '@budgero/runtime';
import { executeMutationOp, prepareMutationArgs } from '@shared/mutations/op-code-registry';
import { useUndoStore } from '@shared/mutations/UndoStore';
import { createUndoHarness, resetUndoStore, type UndoHarness } from './harness';

const holder = vi.hoisted(() => ({ runtime: undefined as unknown }));
vi.mock('@shared/runtime/global', () => ({ getRuntime: () => holder.runtime }));

const DATE = '2026-03-10';

interface Setup {
  h: UndoHarness;
  eur: number;
  savings: number;
  parent: number;
}

async function setup(eurRate: number): Promise<Setup> {
  const h = await createUndoHarness();
  holder.runtime = h.runtime;
  const account = async (name: string, currency: string, onBudget = true) =>
    (
      await h.services.accounts.createAccount(
        name,
        h.budgetId,
        'checking',
        currency,
        asMilli(0),
        undefined,
        onBudget
      )
    ).ID;
  const eur = await account('Euro', 'EUR');
  const savings = await account('Savings', 'USD', false);
  await h.services.currency.saveRate('USD', 'EUR', eurRate, DATE, h.budgetId);
  await h.services.currency.saveRate('EUR', 'USD', 1 / eurRate, DATE, h.budgetId);
  const parent = await h.services.transactions.addTransaction(
    asMilli(0),
    asMilli(100_000),
    h.accountId,
    h.categoryId,
    h.budgetId,
    DATE,
    'parent',
    '',
    'Shop'
  );
  return { h, eur, savings, parent };
}

const mirrorsOf = (h: UndoHarness, parentId: number) =>
  h
    .rows('transactions')
    .filter((row) => String(row.TransferID ?? '').startsWith(`split_transfer_${parentId}_`));

const amounts = (row: Record<string, unknown>) => ({
  InflowNative: row.InflowNative,
  OutflowNative: row.OutflowNative,
  InflowConverted: row.InflowConverted,
  OutflowConverted: row.OutflowConverted,
  TransferRateOverride: row.TransferRateOverride,
});

/** Prepare (originating device) and run, returning the args that were sent. */
async function send(h: UndoHarness, op: string, args: Record<string, unknown>) {
  const prepared = await prepareMutationArgs(op, args);
  await h.run(op, prepared);
  return prepared;
}

describe('split transfer lines carry the received amount', () => {
  let a: Setup;

  beforeEach(async () => {
    resetUndoStore();
    a = await setup(0.9);
  });

  const saveArgs = (s: Setup, received?: number) => ({
    transactionId: s.parent,
    splits: [
      {
        category_id: s.h.categoryId,
        transfer_account_id: null,
        memo: '',
        payee: '',
        inflow: 0,
        outflow: 20_000,
      },
      {
        category_id: null,
        transfer_account_id: s.eur,
        memo: '',
        payee: '',
        inflow: 0,
        outflow: 80_000,
        ...(received === undefined ? {} : { received_amount: received }),
      },
    ],
  });

  it('carries exact mirror amounts (format 7) that every device writes the same', async () => {
    const sent = await send(a.h, 'transactions.saveSplits', saveArgs(a, 70_000));
    const line = (sent.splits as Record<string, unknown>[])[1];
    expect(line.received_amount).toBeUndefined();
    // 70.00 EUR at 1 / 0.9 = 77.778 USD in the budget.
    expect(line.mirror).toEqual({
      InflowNative: 70_000,
      OutflowNative: 0,
      InflowConverted: 77_778,
      OutflowConverted: 0,
    });
    expect(mutationFormatVersion('transactions.saveSplits', sent)).toBe(7);
    const [mirror] = mirrorsOf(a.h, a.parent);
    expect(amounts(mirror)).toMatchObject({ InflowNative: 70_000, TransferRateOverride: 2 });

    // A receiver with another cached rate replays the sent args.
    const b = await setup(0.5);
    await executeMutationOp('transactions.saveSplits', sent, {
      mutationId: 'remote',
      isReceiver: true,
    });
    expect(amounts(mirrorsOf(b.h, b.parent)[0])).toEqual(amounts(mirror));
  });

  it('a save without a received amount keeps the old format and conversion', async () => {
    const sent = await send(a.h, 'transactions.saveSplits', saveArgs(a));
    expect(mutationFormatVersion('transactions.saveSplits', sent)).toBeLessThan(7);
    expect(mirrorsOf(a.h, a.parent)[0]).toMatchObject({
      InflowNative: 72_000,
      TransferRateOverride: 0,
    });
  });

  it('undo removes the line and its mirror; redo writes the same amounts again', async () => {
    await send(a.h, 'transactions.saveSplits', saveArgs(a, 70_000));
    const before = amounts(mirrorsOf(a.h, a.parent)[0]);

    await useUndoStore.getState().undo();
    expect(mirrorsOf(a.h, a.parent)).toHaveLength(0);
    expect(a.h.rows('transaction_splits')).toHaveLength(0);

    await useUndoStore.getState().redo();
    expect(amounts(mirrorsOf(a.h, a.parent)[0])).toEqual(before);
  });

  it('undo of a received-amount change puts the previous amount back', async () => {
    await send(a.h, 'transactions.saveSplits', saveArgs(a, 70_000));
    await send(a.h, 'transactions.saveSplits', saveArgs(a, 65_000));
    expect(mirrorsOf(a.h, a.parent)[0].InflowNative).toBe(65_000);
    await useUndoStore.getState().undo();
    expect(amounts(mirrorsOf(a.h, a.parent)[0])).toMatchObject({
      InflowNative: 70_000,
      TransferRateOverride: 2,
    });
    await useUndoStore.getState().redo();
    expect(mirrorsOf(a.h, a.parent)[0].InflowNative).toBe(65_000);
  });

  it('parent edits and copies of a pinned split ask for format 7; others do not', async () => {
    const plain = await setup(0.9);
    await send(plain.h, 'transactions.saveSplits', saveArgs(plain));
    const dateEdit = (s: Setup) => ({ id: s.parent, columnName: 'Date', newValue: '2026-03-12' });
    expect(
      mutationFormatVersion(
        'transactions.updateColumn',
        await prepareMutationArgs('transactions.updateColumn', dateEdit(plain))
      )
    ).toBeLessThan(7);

    holder.runtime = a.h.runtime;
    await send(a.h, 'transactions.saveSplits', saveArgs(a, 70_000));
    const sent = await send(a.h, 'transactions.updateColumn', dateEdit(a));
    expect(mutationFormatVersion('transactions.updateColumn', sent)).toBe(7);
    expect(mirrorsOf(a.h, a.parent)[0]).toMatchObject({ InflowNative: 70_000, Date: '2026-03-12' });

    const copy = await send(a.h, 'transactions.duplicate', { ids: [a.parent] });
    expect(mutationFormatVersion('transactions.duplicate', copy)).toBe(7);
    const copies = a.h
      .rows('transactions')
      .filter(
        (row) =>
          String(row.TransferID ?? '').startsWith('split_transfer_') &&
          !String(row.TransferID).startsWith(`split_transfer_${a.parent}_`)
      );
    expect(copies.map(amounts)).toEqual([amounts(mirrorsOf(a.h, a.parent)[0])]);
  });

  it('a line to an off-budget account keeps its category (format 7)', async () => {
    const args = {
      transactionId: a.parent,
      splits: [
        {
          category_id: a.h.categoryId,
          transfer_account_id: a.savings,
          memo: '',
          payee: '',
          inflow: 0,
          outflow: 100_000,
        },
      ],
    };
    const sent = await send(a.h, 'transactions.saveSplits', args);
    expect(mutationFormatVersion('transactions.saveSplits', sent)).toBe(7);
    expect(a.h.rows('transaction_splits')[0]).toMatchObject({
      CategoryID: a.h.categoryId,
      TransferAccountID: a.savings,
    });
  });

  it('a new split transaction carries the received amount too', async () => {
    const sent = await send(a.h, 'transactions.add', {
      budgetId: a.h.budgetId,
      accountId: a.h.accountId,
      categoryId: 0,
      date: DATE,
      memo: '',
      payee: 'Shop',
      inflow: 0,
      outflow: 50_000,
      transferId: '',
      splits: [
        {
          categoryId: null,
          transferAccountId: a.eur,
          memo: '',
          payee: '',
          inflow: 0,
          outflow: 50_000,
          receivedAmount: 44_000,
        },
      ],
    });
    expect(mutationFormatVersion('transactions.add', sent)).toBe(7);
    const [line] = sent.splits as Record<string, unknown>[];
    expect(line).not.toHaveProperty('receivedAmount');
    const eurRows = a.h.rows('transactions').filter((row) => row.AccountID === a.eur);
    expect(eurRows.at(-1)).toMatchObject({ InflowNative: 44_000, TransferRateOverride: 2 });
  });

  it('without a rate for the budget value the save is refused; the Push API converts instead', async () => {
    const gbp = (
      await a.h.services.accounts.createAccount(
        'Pound',
        a.h.budgetId,
        'checking',
        'GBP',
        asMilli(0)
      )
    ).ID;
    const args = saveArgs(a, 70_000);
    (args.splits[1] as Record<string, unknown>).transfer_account_id = gbp;
    await expect(prepareMutationArgs('transactions.saveSplits', args)).rejects.toThrow(
      /GBP to USD exchange rate/
    );

    const push = await prepareMutationArgs('transactions.add', {
      budgetId: a.h.budgetId,
      accountId: a.h.accountId,
      date: DATE,
      inflow: 0,
      outflow: 50_000,
      importIdentities: [{ operationId: 'push:1', sourceKey: 'push-api' }],
      splits: [
        {
          categoryId: null,
          transferAccountId: gbp,
          inflow: 0,
          outflow: 50_000,
          receivedAmount: 40_000,
          // A raw mirror in a pushed payload is never trusted.
          mirror: { InflowNative: 1, OutflowNative: 0, InflowConverted: 1, OutflowConverted: 0 },
        },
      ],
    });
    const [line] = push.splits as Record<string, unknown>[];
    expect(line).not.toHaveProperty('mirror');
    expect(line).not.toHaveProperty('receivedAmount');
  });

  it('refuses a category on a line to an on-budget account before anything runs', async () => {
    const args = saveArgs(a);
    (args.splits[1] as Record<string, unknown>).category_id = a.h.categoryId;
    await expect(prepareMutationArgs('transactions.saveSplits', args)).rejects.toThrow(
      /category or a transfer account/
    );
  });

  it('an unpinning save, a mirror-pair edit, a categorized copy and an on-budget switch ask for format 7', async () => {
    await send(a.h, 'transactions.saveSplits', saveArgs(a, 70_000));
    expect(
      mutationFormatVersion(
        'transactions.saveSplits',
        await prepareMutationArgs('transactions.saveSplits', saveArgs(a))
      )
    ).toBe(7);

    // Two mirrors under one parent: a direct edit of one.
    const gbp = (
      await a.h.services.accounts.createAccount(
        'Pound',
        a.h.budgetId,
        'checking',
        'GBP',
        asMilli(0)
      )
    ).ID;
    await a.h.services.currency.saveRate('USD', 'GBP', 0.8, DATE, a.h.budgetId);
    const pair = saveArgs(a);
    (pair.splits[0] as Record<string, unknown>).category_id = null;
    (pair.splits[0] as Record<string, unknown>).transfer_account_id = gbp;
    await send(a.h, 'transactions.saveSplits', pair);
    const [mirror] = mirrorsOf(a.h, a.parent);
    expect(
      mutationFormatVersion(
        'transactions.updateColumn',
        await prepareMutationArgs('transactions.updateColumn', {
          id: mirror.ID,
          columnName: 'InflowNative',
          newValue: 1_000,
        })
      )
    ).toBe(7);

    // A categorized line to an off-budget account.
    await send(a.h, 'transactions.saveSplits', {
      transactionId: a.parent,
      splits: [
        {
          category_id: a.h.categoryId,
          transfer_account_id: a.savings,
          memo: '',
          payee: '',
          inflow: 0,
          outflow: 100_000,
        },
      ],
    });
    expect(
      mutationFormatVersion(
        'transactions.duplicate',
        await prepareMutationArgs('transactions.duplicate', { ids: [a.parent] })
      )
    ).toBe(7);
    const savings = a.h.services.accounts.getAccount(a.savings);
    const flip = await send(a.h, 'accounts.update', {
      id: a.savings,
      name: savings.Name,
      type: savings.Type,
      currency: savings.Currency,
      onBudget: true,
    });
    expect(mutationFormatVersion('accounts.update', flip)).toBe(7);
    expect(a.h.rows('transaction_splits')[0]).toMatchObject({
      CategoryID: null,
      TransferAccountID: a.savings,
    });
    // Undo of the switch puts the category back with the account.
    await useUndoStore.getState().undo();
    expect(a.h.rows('transaction_splits')[0]).toMatchObject({ CategoryID: a.h.categoryId });
  });

  it('a rule run changing a pinned parent, and its undo / redo, ask for format 7', async () => {
    await send(a.h, 'transactions.saveSplits', saveArgs(a, 70_000));
    const rule = await a.h.run<{ id: number }>('rules.create', {
      input: {
        budgetId: a.h.budgetId,
        name: 'Double',
        conditions: [{ field: 'memo', operator: 'contains', value: 'parent' }],
        actions: [{ type: 'amount.set', payload: { amount: -200_000 } }],
        mode: 'one_time',
      },
    });
    const sent = await send(a.h, 'rules.execute', { ruleId: rule.id });
    expect(mutationFormatVersion('rules.execute', sent)).toBe(7);
    // The pinned amount doubled with the line (80 -> 160 USD).
    expect(mirrorsOf(a.h, a.parent)[0]).toMatchObject({
      InflowNative: 140_000,
      TransferRateOverride: 2,
    });
    const run = a.h.services.rules.listRuns(rule.id)[0];
    for (const op of ['rules.undoRun', 'rules.redoRun']) {
      expect(mutationFormatVersion(op, await prepareMutationArgs(op, { runId: run.id }))).toBe(7);
    }
  });

  it('rules, rate edits and custom rates on a two-mirror split, a pinned mirror rate edit and a categorized restore ask for format 7', async () => {
    const gbp = (
      await a.h.services.accounts.createAccount(
        'Pound',
        a.h.budgetId,
        'checking',
        'GBP',
        asMilli(0)
      )
    ).ID;
    await a.h.services.currency.saveRate('USD', 'GBP', 0.8, DATE, a.h.budgetId);
    await a.h.services.currency.saveRate('EUR', 'USD', 1 / 0.9, DATE, a.h.budgetId);
    const pair = saveArgs(a, 70_000);
    Object.assign(pair.splits[0] as Record<string, unknown>, {
      category_id: null,
      transfer_account_id: gbp,
      memo: 'mirror memo',
    });
    await send(a.h, 'transactions.saveSplits', pair);
    const [eurMirror] = mirrorsOf(a.h, a.parent).filter((row) => row.AccountID === a.eur);
    const key = String(eurMirror.TransferID);

    const rule = await a.h.run<{ id: number }>('rules.create', {
      input: {
        budgetId: a.h.budgetId,
        name: 'Memo',
        conditions: [{ field: 'memo', operator: 'contains', value: 'mirror memo' }],
        actions: [{ type: 'memo.set', payload: { memo: 'renamed' } }],
        mode: 'one_time',
      },
    });
    const ruleArgs = await prepareMutationArgs('rules.execute', { ruleId: rule.id });
    expect(mutationFormatVersion('rules.execute', ruleArgs)).toBe(7);

    for (const [op, args] of [
      ['transactions.updateTransferRate', { transferId: key, rate: 1.2 }],
      ['transactions.updateTransferAmounts', { transferId: key, sentAmount: 1, receivedAmount: 1 }],
      [
        'currency.customRates.add',
        { budgetId: a.h.budgetId, fromCurrency: 'EUR', toCurrency: 'GBP' },
      ],
      [
        'transactions.updateColumn',
        { id: eurMirror.ID, columnName: 'ExchangeRate', newValue: 1.2 },
      ],
    ] as const) {
      expect(mutationFormatVersion(op, await prepareMutationArgs(op, args)), op).toBe(7);
    }
    await expect(
      a.h.run('transactions.updateTransferRate', { transferId: key, rate: 1.2 })
    ).rejects.toThrow();

    // A restore holding a categorized transfer line.
    const snapshot = a.h.services.transactions.captureRestoreSnapshot([a.parent]);
    (snapshot.dependents ?? []).push({
      table: 'transaction_splits',
      rows: [{ ID: 999, TransactionID: a.parent, CategoryID: 1, TransferAccountID: a.savings }],
    } as never);
    expect(
      mutationFormatVersion(
        'transactions.restore',
        await prepareMutationArgs('transactions.restore', { snapshot })
      )
    ).toBe(7);
  });

  it('pushed split saves and adds never carry their own mirror amounts', async () => {
    const { asPushedArgs } = await import('@shared/runtime/push-identity');
    const raw = { InflowNative: 1, OutflowNative: 0, InflowConverted: 1, OutflowConverted: 0 };
    const pushed = asPushedArgs({
      transactionId: a.parent,
      splits: [
        { category_id: a.h.categoryId, inflow: 0, outflow: 20_000 },
        { transfer_account_id: a.eur, inflow: 0, outflow: 80_000, mirror: raw },
      ],
    });
    expect((pushed.splits as Record<string, unknown>[])[1]).not.toHaveProperty('mirror');
    // Even if a payload sneaks one past, a pushed save drops it in prepare.
    const sneaky = await prepareMutationArgs('transactions.saveSplits', {
      ...pushed,
      splits: [
        { category_id: a.h.categoryId, inflow: 0, outflow: 20_000 },
        { transfer_account_id: a.eur, inflow: 0, outflow: 80_000, mirror: raw },
      ],
    });
    expect((sneaky.splits as Record<string, unknown>[])[1]).not.toHaveProperty('mirror');
    await a.h.run('transactions.saveSplits', sneaky);
    expect(mirrorsOf(a.h, a.parent)[0]).toMatchObject({
      InflowNative: 72_000,
      TransferRateOverride: 0,
    });
  });

  it('a rate edit on a lone pinned mirror asks for format 7 and keeps its amount', async () => {
    await send(a.h, 'transactions.saveSplits', saveArgs(a, 70_000));
    const [mirror] = mirrorsOf(a.h, a.parent);
    const edit = { id: mirror.ID, columnName: 'ExchangeRate', newValue: 1.2 };
    const sent = await send(a.h, 'transactions.updateColumn', edit);
    expect(mutationFormatVersion('transactions.updateColumn', sent)).toBe(7);
    expect(mirrorsOf(a.h, a.parent)[0]).toMatchObject({
      InflowNative: 70_000,
      InflowConverted: 84_000,
      TransferRateOverride: 2,
    });
  });
});
