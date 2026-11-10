import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { useImportDialogState } from './useImportDialogState';

const mocks = vi.hoisted(() => {
  const budget = { ID: 1 };
  const accounts = [{ ID: 10, Name: 'Checking', Currency: 'USD' }];
  return {
    budget,
    accounts,
    store: {
      selectedBudget: budget,
      setSelectedBudget: vi.fn(),
      pendingImportFile: null,
      setPendingImportFile: vi.fn(),
    },
    queryClient: { invalidateQueries: vi.fn() },
    record: vi.fn(),
    mutate: vi.fn(),
    addAccount: vi.fn(),
    addCategory: vi.fn(),
    addGroup: vi.fn(),
    plan: vi.fn(),
    parse: vi.fn(),
    save: vi.fn(),
    templates: {
      templates: [],
      selectedTemplate: '',
      setSelectedTemplate: vi.fn(),
      saveAsTemplate: false,
      setSaveAsTemplate: vi.fn(),
      templateName: '',
      setTemplateName: vi.fn(),
      applyTemplate: vi.fn(),
      deleteTemplate: vi.fn(),
      saveTemplate: vi.fn(),
    },
  };
});
vi.mock('@entities/budget/api/useBudgets', () => ({
  useBudgets: () => ({ data: [mocks.budget] }),
}));
vi.mock('@entities/account/api/useAccounts', () => ({
  useAccounts: () => ({ data: mocks.accounts }),
  useAddAccount: () => ({ mutateAsync: mocks.addAccount }),
}));
vi.mock('@entities/category/api/useCategories', () => ({
  useCategories: () => ({
    data: [
      { ID: 1, Name: 'Income' },
      { ID: 2, Name: 'Uncategorized' },
    ],
  }),
  useCategoryGroups: () => ({ data: [] }),
  useAddCategory: () => ({ mutateAsync: mocks.addCategory }),
  useAddCategoryGroup: () => ({ mutateAsync: mocks.addGroup }),
}));
vi.mock('@features/import/api/useImportHistory', () => ({
  useRecordImportRun: () => ({ mutateAsync: mocks.record }),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => mocks.queryClient }));
vi.mock('@shared/store/useUiStore', () => ({ useUiStore: () => mocks.store }));
vi.mock('@shared/runtime/runtime-provider', () => ({
  useRuntime: () => ({
    services: () => ({
      accounts: { listAccounts: () => mocks.accounts },
      importHistory: { duplicates: { plan: mocks.plan } },
    }),
    save: mocks.save,
  }),
}));
vi.mock('@shared/runtime/mutation-router', () => ({
  executeSpaceMutation: (...args: unknown[]) => mocks.mutate(...args),
}));
vi.mock('@features/import/lib/parse-import-file', () => ({ parseImportFile: mocks.parse }));
vi.mock('@shared/lib/analytics/analytics', () => ({ trackImportedCsvPdf: vi.fn() }));
vi.mock('./useImportTemplates', () => ({ useImportTemplates: () => mocks.templates }));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('crypto', webcrypto);
  mocks.plan.mockImplementation((rows) =>
    rows.map((row: { index: number }) => ({
      index: row.index,
      status: 'new',
      candidates: [],
      reason: '',
    }))
  );
  mocks.mutate.mockImplementation(async (_runtime, spec) => ({
    transactionId: (spec.payload.importIdentities?.[0].index ?? 0) + 100,
    created: true,
  }));
  mocks.record.mockResolvedValue(1);
  const file = {
    arrayBuffer: async () => new TextEncoder().encode('statement bytes').buffer,
  } as File;
  mocks.parse.mockResolvedValue({
    data: {
      source: { file, fileName: 'statement.csv', type: 'csv' },
      headers: ['Date', 'Amount'],
      rows: [
        { Date: '2026-09-01', Amount: '-10' },
        { Date: '2026-09-02', Amount: '-20' },
      ],
    },
  });
});
async function preview() {
  const hook = renderHook(() => useImportDialogState());
  await act(async () => {
    await hook.result.current.handleFileChange({ target: { files: [{}] } } as never);
  });
  act(() => {
    hook.result.current.setImportConfig({
      ...hook.result.current.importConfig,
      defaultAccountId: 10,
    });
  });
  await act(async () => {
    await hook.result.current.generatePreview();
  });
  expect(hook.result.current.currentStep).toBe('preview');
  return hook;
}
describe('import wizard execution', () => {
  const candidate = (id: number, date: string) => ({
    id,
    date,
    inflow: 0,
    outflow: 10000,
    payee: 'Coffee',
    memo: 'typed by hand',
  });
  const reviewWithMatch = (suggest: (index: number) => boolean) =>
    mocks.plan.mockImplementation((rows) =>
      rows.map((row: { index: number }) => ({
        index: row.index,
        status: 'needs-review',
        candidates: [candidate(row.index + 50, '2026-08-30')],
        reason: 'Similar amount and date in this account',
        ...(suggest(row.index) ? { suggestMatch: true } : {}),
      }))
    );

  it('defaults a single hand-entered candidate to Match, then keeps it and marks it cleared', async () => {
    reviewWithMatch((index) => index === 0);
    const { result } = await preview();
    // The statement tolerance comes from the duplicate-hint settings (defaults here).
    expect(mocks.plan.mock.calls.at(-1)?.[1]).toEqual({
      tolerance: { toleranceBps: 100, dayWindow: 7 },
    });
    expect(result.current.previewData.map((r) => r.decision)).toEqual(['match', undefined]);
    act(() => result.current.setRowDecision(1, 'match'));
    await act(async () => {
      await result.current.handleImport();
    });
    const ops = mocks.mutate.mock.calls.map((call) => [call[1].op, call[1].payload]);
    expect(ops).toEqual([
      ['importHistory.match', expect.objectContaining({ transactionId: 50 })],
      ['transactions.setCleared', expect.objectContaining({ ids: [50], cleared: true })],
      ['importHistory.match', expect.objectContaining({ transactionId: 51 })],
      ['transactions.setCleared', expect.objectContaining({ ids: [51], cleared: true })],
    ]);
    expect(result.current.importSummary).toMatchObject({
      transactionsImported: 0,
      transactionsMatched: 2,
      duplicatesSkipped: 0,
    });
    expect(mocks.addAccount).not.toHaveBeenCalled();
  });

  it('matches some rows and imports the rest in one run', async () => {
    reviewWithMatch(() => true);
    const { result } = await preview();
    act(() => result.current.setRowDecision(1, 'import'));
    await act(async () => {
      await result.current.handleImport();
    });
    const ops = mocks.mutate.mock.calls.map((call) => call[1].op);
    expect(ops.filter((op) => op === 'transactions.import')).toHaveLength(1);
    expect(ops.filter((op) => op === 'transactions.setCleared')).toHaveLength(1);
    expect(result.current.importSummary).toMatchObject({
      transactionsImported: 1,
      transactionsMatched: 1,
    });
  });

  it('Match all unresolved only applies to rows with a candidate', async () => {
    mocks.plan.mockImplementation((rows) =>
      rows.map((row: { index: number }) => ({
        index: row.index,
        status: 'needs-review',
        candidates: row.index === 0 ? [candidate(50, '2026-09-01')] : [],
        reason: '',
        ...(row.index === 1 ? { sameFileIndex: 0 } : {}),
      }))
    );
    const { result } = await preview();
    act(() => result.current.resolveAll('match'));
    expect(result.current.previewData.map((r) => r.decision)).toEqual(['match', undefined]);
  });

  it('finishes an all-duplicate file without creating accounts, categories, or transactions', async () => {
    mocks.plan.mockImplementation((rows) =>
      rows.map((row: { index: number }) => ({
        index: row.index,
        status: 'already-imported',
        candidates: [
          {
            id: row.index + 50,
            date: '2026-09-01',
            inflow: 0,
            outflow: 10000,
            payee: '',
            memo: '',
          },
        ],
        reason: 'Already imported',
      }))
    );
    const { result } = await preview();
    await act(async () => {
      await result.current.handleImport();
    });
    expect(result.current.currentStep).toBe('complete');
    expect(result.current.importSummary).toMatchObject({
      transactionsImported: 0,
      duplicatesSkipped: 2,
    });
    expect(mocks.addAccount).not.toHaveBeenCalled();
    expect(mocks.addCategory).not.toHaveBeenCalled();
    expect(mocks.mutate.mock.calls.every((call) => call[1].op === 'importHistory.match')).toBe(
      true
    );
  });
  it('refreshes the space-keyed account balance and register queries after import', async () => {
    const { result } = await preview();
    await act(async () => {
      await result.current.handleImport();
    });
    const predicates = mocks.queryClient.invalidateQueries.mock.calls
      .map((call) => call[0]?.predicate)
      .filter(Boolean);
    const refreshed = (queryKey: unknown[]) => predicates.some((p) => p({ queryKey }));
    expect(refreshed(['accounts', 'space-1', 1])).toBe(true);
    expect(refreshed(['accountTransactionSummary', 'space-1', 10, '', ''])).toBe(true);
    expect(refreshed(['accountTransactionPages', 'space-1', 10, '', '', 50])).toBe(true);
    expect(refreshed(['categories', 'space-1', 1])).toBe(true);
  });
  it('returns changed ledger matches to review before any write', async () => {
    const { result } = await preview();
    mocks.plan.mockImplementation((rows) =>
      rows.map((row: { index: number }) => ({
        index: row.index,
        status: 'needs-review',
        candidates: [],
        reason: 'Changed',
      }))
    );
    await act(async () => {
      await result.current.handleImport();
    });
    expect(result.current.currentStep).toBe('preview');
    expect(result.current.error).toContain('changed');
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it('checkpoints successful rows and exposes failures separately', async () => {
    const { result } = await preview();
    mocks.mutate
      .mockRejectedValueOnce(new Error('Storage unavailable'))
      .mockResolvedValueOnce({ transactionId: 101, created: true });
    await act(async () => {
      await result.current.handleImport();
    });
    expect(result.current.currentStep).toBe('complete');
    expect(result.current.importSummary).toMatchObject({
      transactionsImported: 1,
      failedRows: 1,
      invalidRows: 0,
    });
    expect(mocks.record.mock.calls.at(-1)?.[0].input).toMatchObject({
      transactionIds: [101],
      summary: { failedRows: 1 },
      status: 'completed_with_warnings',
    });
  });
  it('invalidates previous decisions when configuration changes', async () => {
    const { result } = await preview();
    act(() => {
      result.current.setRowDecision(0, 'skip');
    });
    act(() => {
      result.current.setColumnMapping({ date: 'Date', outflow: 'Amount' });
    });
    expect(result.current.currentStep).toBe('configure');
    expect(result.current.previewData).toEqual([]);
  });
  it('gives an explicit extra import its own stable retry identity', async () => {
    mocks.plan.mockImplementation((rows) =>
      rows.map((row: { index: number }) => ({
        index: row.index,
        status: 'already-imported',
        candidates: [],
        reason: 'Already imported',
      }))
    );
    const { result } = await preview();
    const initial = result.current.previewData[0].input.operationId;
    act(() => {
      result.current.setRowDecision(0, 'import');
    });
    const override = result.current.previewData[0].input.operationId;
    expect(override).not.toBe(initial);
    act(() => {
      result.current.setRowDecision(0, 'import');
    });
    expect(result.current.previewData[0].input.operationId).toBe(override);
    await act(async () => {
      await result.current.handleImport();
    });
    expect(mocks.mutate.mock.calls[0][1].payload.importIdentities[0].operationId).toBe(override);
  });

  it('imports oldest first, keeping file order within a day', async () => {
    const file = { arrayBuffer: async () => new TextEncoder().encode('desc').buffer } as File;
    mocks.parse.mockResolvedValue({
      data: {
        source: { file, fileName: 'newest-first.csv', type: 'csv' },
        headers: ['Date', 'Amount'],
        rows: [
          { Date: '2026-09-03', Amount: '-30' },
          { Date: '2026-09-02', Amount: '-21' },
          { Date: '2026-09-02', Amount: '-22' },
          { Date: '2026-09-01', Amount: '-10' },
        ],
      },
    });
    const { result } = await preview();
    await act(async () => {
      await result.current.handleImport();
    });
    const imported = mocks.mutate.mock.calls
      .map(([, spec]) => spec)
      .filter((spec) => spec.op === 'transactions.import')
      .map((spec) => [spec.payload.date, spec.payload.outflow]);
    expect(imported).toEqual([
      ['2026-09-01', 10000],
      ['2026-09-02', 21000],
      ['2026-09-02', 22000],
      ['2026-09-03', 30000],
    ]);
  });

  it('saves the run record in batches carrying only the new transactions', async () => {
    const file = { arrayBuffer: async () => new TextEncoder().encode('big').buffer } as File;
    mocks.parse.mockResolvedValue({
      data: {
        source: { file, fileName: 'big.csv', type: 'csv' },
        headers: ['Date', 'Amount'],
        rows: Array.from({ length: 250 }, (_, i) => ({
          Date: `2026-0${1 + Math.floor(i / 28)}-${String(1 + (i % 28)).padStart(2, '0')}`,
          Amount: `-${i + 1}`,
        })),
      },
    });
    const { result } = await preview();
    await act(async () => {
      await result.current.handleImport();
    });
    const calls = mocks.record.mock.calls.map(([arg]) => arg.input);
    // Opening record, two full batches of 100, and the final record.
    expect(calls.length).toBeLessThanOrEqual(5);
    expect(Math.max(...calls.map((c) => c.transactionIds.length))).toBeLessThanOrEqual(100);
    const all = calls.flatMap((c) => c.transactionIds);
    expect(new Set(all).size).toBe(250);
    expect(all).toHaveLength(250);
    expect(calls.at(-1)?.status).toBe('completed');
  });

  it('creates one account per new route, never sends a placeholder id, and remembers routes', async () => {
    localStorage.clear();
    const file = { arrayBuffer: async () => new TextEncoder().encode('multi').buffer } as File;
    mocks.parse.mockResolvedValue({
      data: {
        source: { file, fileName: 'multi.csv', type: 'csv' },
        headers: ['Date', 'Amount', 'Account', 'Currency'],
        rows: [
          { Date: '2026-09-01', Amount: '-10', Account: 'Card', Currency: 'EUR' },
          { Date: '2026-09-02', Amount: '-20', Account: 'checking' },
          { Date: '2026-09-03', Amount: '-30', Account: 'Old' },
          { Date: '2026-09-04', Amount: '-40', Account: 'Cash' },
        ],
      },
    });
    Object.assign(mocks.budget, { DisplayCurrency: 'GBP' });
    mocks.addAccount.mockImplementation(async ({ name }: { name: string }) => ({
      ID: name === 'Card' ? 77 : 78,
      Name: name,
    }));
    const hook = renderHook(() => useImportDialogState());
    await act(async () => {
      await hook.result.current.handleFileChange({ target: { files: [{}] } } as never);
    });
    expect(hook.result.current.columnMapping.account).toBe('Account');
    act(() => {
      hook.result.current.setImportConfig({
        ...hook.result.current.importConfig,
        accountRoutes: { Old: { kind: 'skip' } },
      });
    });
    await act(async () => {
      await hook.result.current.generatePreview();
    });
    const { result } = hook;
    expect(result.current.previewData.map((r) => r.parsed.account)).toEqual([
      'Card (new)',
      'Checking',
      'Old',
      'Cash (new)',
    ]);
    await act(async () => {
      await result.current.handleImport();
    });
    Object.assign(mocks.budget, { DisplayCurrency: undefined });

    expect(mocks.addAccount.mock.calls.map(([arg]) => [arg.name, arg.currency])).toEqual([
      ['Card', 'EUR'],
      ['Cash', 'GBP'],
    ]);
    const imports = mocks.mutate.mock.calls
      .map(([, spec]) => spec)
      .filter((spec) => spec.op === 'transactions.import');
    expect(imports.map((spec) => spec.payload.accountId)).toEqual([77, 10, 78]);
    expect(imports.map((spec) => spec.payload.importIdentities[0].accountId)).toEqual([77, 10, 78]);
    expect(result.current.importSummary).toMatchObject({
      transactionsImported: 3,
      accountsCreated: 2,
      userSkipped: 1,
      invalidRows: 0,
      destinationAccountName: '3 accounts',
    });
    expect(JSON.parse(localStorage.getItem('budgero:import-account-routes:1')!)).toEqual({
      Card: 77,
      checking: 10,
      Cash: 78,
    });
  });

  describe('transfers between accounts of one file', () => {
    async function qifImport(
      decide?: (result: { current: ReturnType<typeof useImportDialogState> }) => void
    ) {
      localStorage.clear();
      const file = { arrayBuffer: async () => new TextEncoder().encode('qif').buffer } as File;
      mocks.parse.mockResolvedValue({
        data: {
          source: { file, fileName: 'quicken.qif', type: 'qif' },
          headers: ['Account', 'AccountType', 'Date', 'Amount', 'Payee', 'TransferAccount'],
          rows: [
            {
              Account: 'Checking',
              AccountType: 'Checking',
              Date: '2026-09-01',
              Amount: '-100',
              Payee: 'To savings',
              TransferAccount: 'Savings',
            },
            {
              Account: 'Savings',
              AccountType: 'Savings',
              Date: '2026-09-01',
              Amount: '100',
              Payee: 'From checking',
              TransferAccount: 'Checking',
            },
            {
              Account: 'Checking',
              AccountType: 'Checking',
              Date: '2026-09-02',
              Amount: '-20',
              Payee: 'Card payment',
              TransferAccount: 'Card',
            },
            {
              Account: 'Card',
              AccountType: 'Credit',
              Date: '2026-09-03',
              Amount: '-5',
              Payee: 'Cafe',
              TransferAccount: '',
            },
          ],
        },
      });
      mocks.addAccount.mockImplementation(async ({ name }: { name: string }) => ({
        ID: name === 'Savings' ? 20 : 30,
        Name: name,
      }));
      let nextId = 500;
      mocks.mutate.mockImplementation(async (_runtime, spec) =>
        spec.op === 'transactions.addTransfer'
          ? { sourceId: nextId++, destinationId: nextId++ }
          : { transactionId: nextId++, created: true }
      );
      const hook = renderHook(() => useImportDialogState());
      await act(async () => {
        await hook.result.current.handleFileChange({ target: { files: [{}] } } as never);
      });
      await act(async () => {
        await hook.result.current.generatePreview();
      });
      decide?.(hook.result);
      await act(async () => {
        await hook.result.current.handleImport();
      });
      return hook.result;
    }
    const specs = () => mocks.mutate.mock.calls.map(([, spec]) => spec);

    it('creates a pair once and a one-sided transfer with its mirror leg', async () => {
      const result = await qifImport();
      expect(
        result.current.previewData.map(
          (r) => r.transfer?.partnerIndex ?? r.transfer?.counterpartName
        )
      ).toEqual([1, 0, 'Card', undefined]);
      expect(
        mocks.addAccount.mock.calls.map(([arg]) => [arg.name, arg.type, arg.on_budget])
      ).toEqual([
        ['Savings', 'Savings', true],
        ['Card', 'Credit', true],
      ]);
      const transfers = specs().filter((spec) => spec.op === 'transactions.addTransfer');
      expect(transfers).toHaveLength(2);
      expect(transfers[0].payload.source).toMatchObject({
        accountId: 10,
        outflow: 100000,
        categoryId: 0,
        cleared: true,
      });
      expect(transfers[0].payload.destination).toMatchObject({
        accountId: 20,
        inflow: 100000,
        cleared: true,
      });
      expect(transfers[0].payload.source.importIdentities[0]).toMatchObject({
        index: 0,
        accountId: 10,
      });
      expect(transfers[0].payload.destination.importIdentities[0]).toMatchObject({
        index: 1,
        accountId: 20,
      });
      // One side only: Card gets the mirror leg, which no file row stands for.
      expect(transfers[1].payload.source).toMatchObject({ accountId: 10, outflow: 20000 });
      expect(transfers[1].payload.destination).toEqual(
        expect.objectContaining({ accountId: 30, inflow: 20000, outflow: 0 })
      );
      expect(transfers[1].payload.destination.importIdentities).toBeUndefined();
      expect(new Set(transfers.map((t) => t.payload.transferId)).size).toBe(2);
      const plain = specs().filter((spec) => spec.op === 'transactions.import');
      expect(plain.map((spec) => spec.payload.payee)).toEqual(['Cafe']);
      expect(result.current.importSummary).toMatchObject({
        transactionsImported: 4,
        failedRows: 0,
      });
    });

    it('keeps a pair plain when the user skips one side', async () => {
      await qifImport((result) => act(() => result.current.setRowDecision(1, 'skip')));
      const ops = specs();
      expect(ops.filter((spec) => spec.op === 'transactions.addTransfer')).toHaveLength(1);
      expect(
        ops.filter((spec) => spec.op === 'transactions.import').map((spec) => spec.payload.payee)
      ).toEqual(['To savings', 'Cafe']);
    });
  });

  it('forgets account choices when another file is loaded', async () => {
    const hook = renderHook(() => useImportDialogState());
    await act(async () => {
      await hook.result.current.handleFileChange({ target: { files: [{}] } } as never);
    });
    act(() =>
      hook.result.current.setImportConfig({
        ...hook.result.current.importConfig,
        defaultAccountId: 10,
        accountRoutes: { A: { kind: 'skip' } },
      })
    );
    await act(async () => {
      await hook.result.current.handleFileChange({ target: { files: [{}] } } as never);
    });
    expect(hook.result.current.importConfig.accountRoutes).toBeUndefined();
    expect(hook.result.current.importConfig.defaultAccountId).toBe(10);
  });
});
