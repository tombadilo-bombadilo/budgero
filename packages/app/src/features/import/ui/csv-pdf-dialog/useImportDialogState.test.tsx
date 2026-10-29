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
});
