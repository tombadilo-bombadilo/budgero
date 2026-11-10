import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Two real databases stand in for two devices; production uses the browser entry.
// eslint-disable-next-line no-restricted-imports
import { asMilli, NodeSqlJsAdapter, ServiceManager, type Services } from '@budgero/core';
import { mutationFormatVersion } from '@budgero/runtime';
import { withLegacyFormat } from '@shared/mutations/legacy-format';
import * as registry from '@shared/mutations/op-code-registry';

const runtime = vi.hoisted(() => ({ services: undefined as Services | undefined }));
vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({ services: () => runtime.services }),
}));

type Device = { services: Services; adapter: NodeSqlJsAdapter };

async function openDevice(bytes?: Uint8Array): Promise<Device> {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(resolve(process.cwd(), '../core'));
  try {
    const adapter = await NodeSqlJsAdapter.create(bytes);
    const manager = new ServiceManager();
    await manager.initialize(adapter);
    return { adapter, services: manager.getServices() };
  } finally {
    cwd.mockRestore();
  }
}

function rows(device: Device, sql: string) {
  const stmt = device.adapter.prepare(sql);
  const out = stmt.all();
  stmt.finalize();
  return out;
}

/**
 * The op as the sync layer moves it: the originating device prepares and runs
 * it, the JSON args travel, the other device replays them as a receiver.
 */
async function originate(a: Device, b: Device, op: string, args: Record<string, unknown>) {
  runtime.services = a.services;
  // Older builds have no prepare step: the args go out as given.
  const prepare = (registry as { prepareMutationArgs?: typeof registry.prepareMutationArgs })
    .prepareMutationArgs;
  const sent = prepare ? await prepare(op, args) : args;
  const result = await registry.executeMutationOp(op, sent, {
    mutationId: `m-${op}`,
    isReceiver: false,
  });
  runtime.services = b.services;
  await registry.executeMutationOp(op, JSON.parse(JSON.stringify(sent)), {
    mutationId: `m-${op}`,
    isReceiver: true,
  });
  return result;
}

describe('ops replayed on another device create the same rows', () => {
  let a: Device;
  let b: Device;
  let budgetId: number;
  let checkingId: number;
  let savingsId: number;

  beforeEach(async () => {
    a = await openDevice();
    budgetId = await a.services.budgets.createBudget({
      name: 'Two devices',
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: true,
    });
    checkingId = (
      await a.services.accounts.createAccount('Checking', budgetId, 'checking', 'USD', asMilli(0))
    ).ID;
    savingsId = (
      await a.services.accounts.createAccount('Savings', budgetId, 'savings', 'USD', asMilli(0))
    ).ID;
    a.services.reports.saveReport({
      id: 'report-1',
      name: 'Spending',
      query: 'SELECT 1',
      charts: [
        {
          id: 'chart-1',
          chartType: 'bar',
          xAxisColumn: 'month',
          yAxisColumn: 'amount',
          aggregateFunction: 'SUM',
        },
      ],
    });
    b = await openDevice(a.adapter.backup() as Uint8Array);
  });

  it('dashboards and widgets: same IDs, so later edits by id reach both devices', async () => {
    const dashboard = (await originate(a, b, 'customDashboards.create', {
      budgetId,
      name: 'Main',
    })) as { id: string };
    const withWidget = (await originate(a, b, 'customDashboardWidgets.add', {
      dashboardId: dashboard.id,
      reportId: 'report-1',
      chartId: 'chart-1',
    })) as { widgets: { id: string }[] };
    // Later ops name the rows by the IDs device A saw.
    await originate(a, b, 'customDashboards.update', { id: dashboard.id, name: 'Renamed' });
    await originate(a, b, 'customDashboardWidgets.update', {
      id: withWidget.widgets[0].id,
      titleOverride: 'Mine',
    });

    for (const sql of [
      'SELECT ID, BudgetID, Name, SortOrder FROM custom_dashboards ORDER BY ID',
      'SELECT ID, DashboardID, ReportID, ChartID, TitleOverride FROM custom_dashboard_widgets ORDER BY ID',
    ]) {
      expect(rows(b, sql)).toEqual(rows(a, sql));
    }
    expect(rows(b, 'SELECT Name FROM custom_dashboards')).toEqual([{ Name: 'Renamed' }]);
    expect(rows(b, 'SELECT TitleOverride FROM custom_dashboard_widgets')).toEqual([
      { TitleOverride: 'Mine' },
    ]);
  });

  it('scenarios: a new scenario gets one ID everywhere, so deleting it works on both', async () => {
    const saved = (await originate(a, b, 'scenarios.save', {
      id: undefined,
      budgetId,
      name: 'What if',
      payload: '{"version":1}',
    })) as { ID: string };
    const sql = 'SELECT ID, BudgetID, Name, Payload FROM scenarios ORDER BY ID';
    expect(rows(b, sql)).toEqual(rows(a, sql));

    await originate(a, b, 'scenarios.delete', { id: saved.ID });
    expect(rows(a, sql)).toEqual([]);
    expect(rows(b, sql)).toEqual([]);
  });

  it('recurring transfer posting: both legs share one TransferID on every device', async () => {
    const template = (await originate(a, b, 'recurring.create', {
      input: {
        budgetId,
        accountId: checkingId,
        toAccountId: savingsId,
        name: 'Save',
        amount: 25_000,
        direction: 'outflow',
        schedule: { startDate: '2026-09-01', intervalUnit: 'month', intervalCount: 1 },
      },
    })) as { id: number };
    const occurrence = a.services.recurring
      .listOccurrences(budgetId, { status: 'scheduled' })
      .find((o) => o.recurringTransactionId === template.id)!;
    await originate(a, b, 'recurring.markReady', {
      options: {
        occurrenceId: occurrence.id,
        recurringTransactionId: template.id,
        dueDate: occurrence.dueDate,
      },
    });

    const sql = `SELECT ID, AccountID, TransferID, InflowConverted, OutflowConverted
                 FROM transactions WHERE TransferID IS NOT NULL AND TransferID != '' ORDER BY ID`;
    const legsA = rows(a, sql) as { TransferID: string }[];
    expect(legsA).toHaveLength(2);
    expect(rows(b, sql)).toEqual(legsA);

    // A transfer op keyed by that TransferID must hit the legs on device B too.
    await originate(a, b, 'transactions.deleteTransfer', { transferId: legsA[0].TransferID });
    expect(rows(a, sql)).toEqual([]);
    expect(rows(b, sql)).toEqual([]);
    const all = 'SELECT ID, AccountID, TransferID FROM transactions ORDER BY ID';
    expect(rows(b, all)).toEqual(rows(a, all));
  });

  describe('recurring.markReady payee (#127)', () => {
    const payeeRows = 'SELECT ID, BudgetID, Name FROM payees ORDER BY ID';
    const posted = 'SELECT ID, AccountID, Payee, OutflowConverted FROM transactions ORDER BY ID';

    async function template() {
      const categoryId = a.services.categories
        .getAllCategories(budgetId)
        .find((c) => !['Income', 'Uncategorized', 'Transfers'].includes(c.Name))!.ID;
      const created = (await originate(a, b, 'recurring.create', {
        input: {
          budgetId,
          accountId: checkingId,
          categoryId,
          name: 'Netflix',
          amount: 12_000,
          direction: 'outflow',
          schedule: { startDate: '2026-09-01', intervalUnit: 'month', intervalCount: 1 },
        },
      })) as { id: number };
      return { recurringTransactionId: created.id, dueDate: '2026-09-01' };
    }

    it('new ops carry the payee, in a format v1.20 builds reject, and both devices post it', async () => {
      const key = await template();
      runtime.services = a.services;
      const sent = await registry.prepareMutationArgs('recurring.markReady', { options: key });
      expect((sent.options as { payee?: string }).payee).toBe('Netflix');
      expect(mutationFormatVersion('recurring.markReady', sent)).toBe(5);

      await originate(a, b, 'recurring.markReady', { options: key });
      expect(rows(a, posted)).toEqual([expect.objectContaining({ Payee: 'Netflix' })]);
      expect(rows(b, posted)).toEqual(rows(a, posted));
      expect(rows(a, payeeRows)).toEqual([expect.objectContaining({ Name: 'Netflix' })]);
      expect(rows(b, payeeRows)).toEqual(rows(a, payeeRows));

      // The next payee gets the same ID on both, so ops naming it by ID agree.
      await originate(a, b, 'transactions.add', {
        budgetId,
        accountId: checkingId,
        categoryId: 0,
        date: '2026-09-02',
        inflow: 0,
        outflow: 1_000,
        memo: '',
        payee: 'Bakery',
      });
      expect(rows(b, payeeRows)).toEqual(rows(a, payeeRows));
    });

    it('ops logged by v1.20 (no payee) replay as v1.20 applied them: no payee, no payee entry', async () => {
      const key = await template();
      // What a v1.20 device sent: keyed, with a TransferID, format 3.
      const logged = { options: { ...key, transferId: 'legacy-transfer-id' } };
      expect(
        mutationFormatVersion(
          'recurring.markReady',
          withLegacyFormat('recurring.markReady', logged)
        )
      ).toBe(3);
      for (const device of [a, b]) {
        runtime.services = device.services;
        await registry.executeMutationOp(
          'recurring.markReady',
          JSON.parse(JSON.stringify(logged)),
          { mutationId: 'old-ready', isReceiver: true }
        );
      }
      const rowsA = rows(a, posted) as { Payee: string | null }[];
      expect(rowsA).toHaveLength(1);
      expect(rowsA[0].Payee ?? '').toBe('');
      expect(rows(a, payeeRows)).toEqual([]);
      expect(rows(b, posted)).toEqual(rowsA);
      expect(rows(b, payeeRows)).toEqual([]);
    });

    it('transfer templates carry no payee (their legs name the accounts)', async () => {
      const created = (await originate(a, b, 'recurring.create', {
        input: {
          budgetId,
          accountId: checkingId,
          toAccountId: savingsId,
          name: 'Save',
          amount: 25_000,
          direction: 'outflow',
          schedule: { startDate: '2026-09-01', intervalUnit: 'month', intervalCount: 1 },
        },
      })) as { id: number };
      runtime.services = a.services;
      const sent = await registry.prepareMutationArgs('recurring.markReady', {
        options: { recurringTransactionId: created.id, dueDate: '2026-09-01' },
      });
      expect((sent.options as { payee?: string }).payee).toBeUndefined();
      expect(mutationFormatVersion('recurring.markReady', sent)).toBe(3);
    });
  });

  describe('split lines that transfer to their own account (S5)', () => {
    const allTx =
      'SELECT ID, AccountID, CategoryID, OutflowConverted, InflowConverted FROM transactions ORDER BY ID';
    const allSplits =
      'SELECT ID, TransactionID, CategoryID, TransferAccountID, OutflowConverted FROM transaction_splits ORDER BY ID';
    const category = () =>
      a.services.categories
        .getAllCategories(budgetId)
        .find((c) => !['Income', 'Uncategorized', 'Transfers'].includes(c.Name))!.ID;
    const addArgs = (transferAccountId: number) => ({
      budgetId,
      accountId: checkingId,
      categoryId: 0,
      date: '2026-09-02',
      inflow: 0,
      outflow: 1_000,
      memo: '',
      payee: '',
      splits: [
        { categoryId: category(), outflow: 600 },
        { transferAccountId, outflow: 400 },
      ],
    });

    it('a new op is refused before it runs or goes out', async () => {
      runtime.services = a.services;
      await expect(
        registry.prepareMutationArgs('transactions.add', addArgs(checkingId))
      ).rejects.toThrow(/own account/);
      const sent = await registry.prepareMutationArgs('transactions.add', addArgs(savingsId));
      expect(sent.splits).toEqual(addArgs(savingsId).splits);
    });

    it('a logged op with one replays as before on every device', async () => {
      const logged = addArgs(checkingId);
      for (const device of [a, b]) {
        runtime.services = device.services;
        await registry.executeMutationOp('transactions.add', JSON.parse(JSON.stringify(logged)), {
          mutationId: 'old-own-split',
          isReceiver: true,
        });
      }
      expect(rows(a, allSplits)).toEqual([
        expect.objectContaining({ TransferAccountID: null }),
        expect.objectContaining({ TransferAccountID: checkingId }),
      ]);
      expect(rows(b, allTx)).toEqual(rows(a, allTx));
      expect(rows(b, allSplits)).toEqual(rows(a, allSplits));
    });

    it('editing a parent may keep a line it already has, not add one', async () => {
      runtime.services = a.services;
      const parent = (await registry.executeMutationOp('transactions.add', addArgs(checkingId), {
        mutationId: 'old-own-split',
        isReceiver: true,
      })) as number;
      const lines = (transferAccountId: number) => [
        { CategoryID: category(), OutflowConverted: 500 },
        { TransferAccountID: transferAccountId, OutflowConverted: 500 },
      ];
      for (const op of ['transactions.upsertSplits', 'transactions.saveSplits']) {
        await expect(
          registry.prepareMutationArgs(op, { transactionId: parent, splits: lines(checkingId) })
        ).resolves.toBeTruthy();
        await expect(
          registry.prepareMutationArgs(op, {
            transactionId: parent,
            splits: [...lines(checkingId), { TransferAccountID: checkingId, OutflowConverted: 0 }],
          })
        ).rejects.toThrow(/own account/);
      }
      const clean = (await registry.executeMutationOp(
        'transactions.add',
        await registry.prepareMutationArgs('transactions.add', addArgs(savingsId)),
        { mutationId: 'new-split', isReceiver: false }
      )) as number;
      await expect(
        registry.prepareMutationArgs('transactions.upsertSplits', {
          transactionId: clean,
          splits: lines(checkingId),
        })
      ).rejects.toThrow(/own account/);
    });
  });

  it('keeps old ops without IDs replayable', async () => {
    runtime.services = b.services;
    const legacy = (await registry.executeMutationOp(
      'customDashboards.create',
      { budgetId, name: 'Legacy' },
      { mutationId: 'old', isReceiver: true }
    )) as { id: string };
    expect(legacy.id).toEqual(expect.any(String));
    await registry.executeMutationOp(
      'scenarios.save',
      { budgetId, name: 'Legacy', payload: '{}' },
      { mutationId: 'old-2', isReceiver: true }
    );
    expect(rows(b, 'SELECT Name FROM scenarios')).toEqual([{ Name: 'Legacy' }]);
  });
});
