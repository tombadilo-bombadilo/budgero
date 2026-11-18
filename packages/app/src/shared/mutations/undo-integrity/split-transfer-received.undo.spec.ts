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
    expect(amounts(mirror)).toMatchObject({ InflowNative: 70_000, TransferRateOverride: 1 });

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
      TransferRateOverride: 1,
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
    expect(eurRows.at(-1)).toMatchObject({ InflowNative: 44_000, TransferRateOverride: 1 });
  });
});
