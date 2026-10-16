import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { YNABImportConfig, YNABImportResult } from '@budgero/core/browser';
import CreateBudgetForm from './CreateBudgetForm';

const mocks = vi.hoisted(() => {
  const deleteBudget = vi.fn();
  const save = vi.fn();
  const recordImportRun = vi.fn();
  const finalize = vi.fn();
  const release = vi.fn();
  const holdSnapshotUploads = vi.fn();
  const runtime = {
    holdSnapshotUploads,
    getActiveSpaceId: () => 'space-test',
    getDatabase: () => ({ saveToOPFSPublic: save }),
    services: () => ({ budgets: { deleteBudget }, importHistory: { recordImportRun } }),
    finalizeOutOfBandMutation: finalize,
  };
  return {
    runtime,
    release,
    holdSnapshotUploads,
    deleteBudget,
    save,
    recordImportRun,
    finalize,
    importSnapshot: vi.fn(),
    inspectZip: vi.fn(),
    inspectSnapshot: vi.fn(),
    importZip: vi.fn(),
    getPlan: vi.fn(),
    syncBudgetState: vi.fn(),
    updateOnboarding: vi.fn(),
    setIsBudgetImporting: vi.fn(),
    invalidateQueries: vi.fn(),
  };
});

vi.mock('@budgero/core/browser', () => ({
  YNABApiClient: class {
    listPlans = async () => [{ id: 'plan-test' }];

    getPlan = mocks.getPlan;
  },
  YNABImportService: class {
    static inspectYNABApiSnapshot = mocks.inspectSnapshot;

    static inspectYNABZip = mocks.inspectZip;

    importYNABFromApiSnapshotWithSummary = mocks.importSnapshot;

    importYNABFromZipWithSummary = mocks.importZip;
  },
}));
vi.mock('@shared/runtime/runtime-provider', () => ({ useRuntime: () => mocks.runtime }));
vi.mock('@shared/store/useUiStore', () => ({
  useUiStore: () => ({ setIsBudgetImporting: mocks.setIsBudgetImporting }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock('@entities/budget/api/useBudgets', () => ({
  useAddBudget: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock('@entities/user/api/useAuth', () => ({
  useUpdateOnboarding: () => ({ mutateAsync: mocks.updateOnboarding }),
}));
vi.mock('@shared/runtime/budget-gate', () => ({
  getBudgetsQueryKey: () => ['budgets', 'space-test'],
  syncBudgetStateFromRuntime: mocks.syncBudgetState,
}));
vi.mock('@shared/lib/analytics/analytics', () => ({
  trackBudgetCreated: vi.fn(),
  trackImportedFromYnab: vi.fn(),
}));
vi.mock('@features/budget-management/ui/create-budget-form/ManualBudgetTab', () => ({
  ManualBudgetTab: () => <div>Manual form</div>,
}));
vi.mock('@features/budget-management/ui/create-budget-form/RestoreBackupTab', () => ({
  RestoreBackupTab: () => <div>Restore form</div>,
}));
vi.mock('@features/budget-management/ui/create-budget-form/YnabImportTab', () => ({
  YnabImportTab: (props: {
    onPersonalAccessTokenChange: (value: string) => void;
    onConnect: () => void;
    onImport: () => void;
    preview: import('@budgero/core/browser').YNABImportPreview | null;
    creditPaymentMappings?: YNABImportConfig['creditPaymentMappings'];
    onCreditPaymentMappingsChange: (
      value: NonNullable<YNABImportConfig['creditPaymentMappings']>
    ) => void;
    onSelectedPlanChange: (value: string) => void;
    onReset: () => void;
    currency: string;
    onSourceModeChange: (value: 'api' | 'zip') => void;
    onBudgetNameChange: (value: string) => void;
    onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onDateOrderChange: (value: NonNullable<YNABImportConfig['dateOrder']>) => void;
  }) => (
    <div>
      <input
        aria-label="Token"
        onChange={(event) => props.onPersonalAccessTokenChange(event.target.value)}
      />
      <button onClick={props.onConnect}>Connect</button>
      <button disabled={!props.preview} onClick={props.onImport}>
        Import source
      </button>
      <span>Currency: {props.currency}</span>
      <span>Mappings: {JSON.stringify(props.creditPaymentMappings)}</span>
      <button
        onClick={() => {
          const matching = props.preview?.creditPaymentMatching;
          if (matching)
            props.onCreditPaymentMappingsChange({
              planId: matching.planId,
              serverKnowledge: matching.serverKnowledge,
              byAccountId: { 'card-a': 'cat-b', 'card-b': 'cat-a' },
            });
        }}
      >
        Match cards
      </button>
      <button onClick={() => props.onSelectedPlanChange('other-plan')}>Select another plan</button>
      <button onClick={props.onReset}>Reset source</button>
      <button onClick={() => props.onSourceModeChange('zip')}>Use ZIP</button>
      <input
        aria-label="Budget name"
        onChange={(event) => props.onBudgetNameChange(event.target.value)}
      />
      <input aria-label="ZIP source" type="file" onChange={props.onFileChange} />
      <button onClick={() => props.onDateOrderChange('month-first')}>Use month first</button>
    </div>
  ),
}));
vi.mock('@features/budget-management/ui/create-budget-form/YnabImportStatus', () => ({
  YnabImportStatus: (props: {
    error: string | null;
    verification: YNABImportResult['verification'];
    isFinalizing: boolean;
    onBack: () => void;
    onAcceptWarnings: () => void;
  }) => (
    <div>
      {props.error && (
        <>
          <p>{props.error}</p>
          <button onClick={props.onBack}>Back to import</button>
        </>
      )}
      {props.verification?.status === 'warning' && (
        <button disabled={props.isFinalizing} onClick={props.onAcceptWarnings}>
          Import anyway
        </button>
      )}
    </div>
  ),
}));

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const imported: YNABImportResult = {
  budgetId: 42,
  summary: {
    registerRowsImported: 1,
    transactionsCreated: 1,
    missingCategoriesCreated: [],
    splitTransactionsImported: 0,
  },
};

const warned: YNABImportResult = {
  ...imported,
  verification: {
    status: 'warning',
    source: { transactions: 1, subtransactions: 0, registerRows: 1 },
    accounts: { checked: 1, matched: 1, debtBalanceAdjustments: [] },
    categories: { checked: 1, matched: 0, mismatches: [], omittedMismatches: 0 },
    readyToAssign: { checked: 0, matched: 0, mismatches: [] },
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getPlan.mockResolvedValue({
    plan: {
      name: 'Synthetic plan',
      currency_format: { iso_code: 'EUR', example_format: '1.234,56' },
    },
  });
  mocks.inspectSnapshot.mockReturnValue({
    accountCount: 1,
    categoryCount: 1,
    registerRowCount: 1,
    missingCategories: [],
    splitTransactions: [],
  });
  mocks.importSnapshot.mockResolvedValue(imported);
  mocks.importZip.mockResolvedValue(imported);
  mocks.inspectZip.mockResolvedValue({
    accountCount: 1,
    categoryCount: 1,
    registerRowCount: 1,
    missingCategories: [],
    splitTransactions: [],
    dateOrderAmbiguous: true,
  });
  mocks.save.mockResolvedValue(undefined);
  mocks.finalize.mockResolvedValue({});
  mocks.invalidateQueries.mockResolvedValue(undefined);
  mocks.updateOnboarding.mockResolvedValue(undefined);
  mocks.holdSnapshotUploads.mockReturnValue(mocks.release);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function startImport() {
  const view = render(<CreateBudgetForm defaultTab="import" />);
  fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'synthetic-token' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Import source' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Import source' }));
  await waitFor(() => expect(mocks.importSnapshot).toHaveBeenCalled());
  return view;
}

/** Order of the events that matter for what the server can see. */
function timeline() {
  const events: string[] = [];
  mocks.holdSnapshotUploads.mockImplementation(() => {
    events.push('hold');
    return mocks.release;
  });
  mocks.release.mockImplementation(() => events.push('release'));
  mocks.deleteBudget.mockImplementation((id: number) => events.push(`delete:${id}`));
  mocks.finalize.mockImplementation(async () => {
    events.push('upload');
    return {};
  });
  return events;
}

describe('YNAB import keeps uploads held until it is accepted or removed', () => {
  it('holds from the start and releases right before uploading an accepted import', async () => {
    const events = timeline();
    await startImport();
    await waitFor(() => expect(mocks.finalize).toHaveBeenCalled());
    expect(events).toEqual(['hold', 'release', 'upload']);
  });

  it('stays held through warning review and releases only after the discarded budget is gone', async () => {
    const events = timeline();
    mocks.importSnapshot.mockResolvedValue(warned);
    const view = await startImport();
    await screen.findByRole('button', { name: 'Import anyway' });
    expect(events).toEqual(['hold']);
    view.unmount();
    expect(events).toEqual(['hold', 'delete:42', 'release']);
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it('releases a failed import only after the importer rolled back, and never uploads it', async () => {
    const events = timeline();
    const failing = deferred();
    mocks.importSnapshot.mockImplementation(async (_snapshot, config: YNABImportConfig) => {
      config.onBudgetCreated?.(42);
      // The tab could die here: a marker remembers the half-written budget.
      expect(JSON.parse(localStorage.getItem('budgero_pending_import_v1') ?? '[]')).toEqual([
        { spaceId: 'space-test', budgetId: 42, name: 'Synthetic plan' },
      ]);
      await failing.promise;
      events.push('importer-rollback');
      throw new Error('Synthetic import failure');
    });
    await startImport();
    expect(events).toEqual(['hold']);
    await act(async () => {
      failing.resolve();
    });
    await screen.findByText('Synthetic import failure');
    // delete:42 is the idempotent re-check after the importer's own rollback.
    expect(events).toEqual(['hold', 'importer-rollback', 'delete:42', 'release']);
    expect(localStorage.getItem('budgero_pending_import_v1')).toBeNull();
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it('a running import that loses its form is released only after it rolls back', async () => {
    const events = timeline();
    const batch = deferred();
    mocks.importSnapshot.mockImplementation(async (_snapshot, config: YNABImportConfig) => {
      await batch.promise;
      await config.onProgress?.({
        stage: 'transactions',
        status: 'running',
        progress: 70,
        label: 'Importing',
      });
      return imported;
    });
    const view = await startImport();
    view.unmount();
    expect(events).toEqual(['hold']);
    const run = mocks.importSnapshot.mock.results[0].value as Promise<YNABImportResult>;
    const rejection = expect(run).rejects.toThrow('YNAB import cancelled');
    await act(async () => {
      batch.resolve();
      await rejection;
    });
    expect(events).toEqual(['hold', 'release']);
  });
});
