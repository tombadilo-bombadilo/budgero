import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { YNABImportConfig, YNABImportResult } from '@budgero/core/browser';
import CreateBudgetForm from './CreateBudgetForm';

const mocks = vi.hoisted(() => {
  const deleteBudget = vi.fn();
  const save = vi.fn();
  const recordImportRun = vi.fn();
  const finalize = vi.fn();
  const runtime = {
    getActiveSpaceId: () => 'space-test',
    getDatabase: () => ({ saveToOPFSPublic: save }),
    services: () => ({ budgets: { deleteBudget }, importHistory: { recordImportRun } }),
    finalizeOutOfBandMutation: finalize,
  };
  return {
    runtime,
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
    track: vi.fn(),
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
vi.mock('@shared/lib/analytics/track', () => ({ track: mocks.track }));
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
    onCancelPending: () => void;
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
      {props.verification?.status === 'warning' && (
        <button onClick={props.onCancelPending}>Cancel and remove</button>
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
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
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

describe('YNAB import lifecycle', () => {
  it('cancels at the next progress boundary after unmount so the importer can roll back', async () => {
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
    expect(screen.getByRole('tab', { name: 'New' })).toBeDisabled();
    expect(mocks.setIsBudgetImporting).toHaveBeenLastCalledWith(true);
    view.unmount();
    const run = mocks.importSnapshot.mock.results[0].value as Promise<YNABImportResult>;
    const rejection = expect(run).rejects.toThrow('YNAB import cancelled');
    await act(async () => {
      batch.resolve();
      await rejection;
    });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.setIsBudgetImporting).toHaveBeenLastCalledWith(false);
  });

  it('removes a completed import that returns after the form has unmounted', async () => {
    const completion = deferred<YNABImportResult>();
    mocks.importSnapshot.mockReturnValue(completion.promise);
    const view = await startImport();
    view.unmount();
    await act(async () => {
      completion.resolve(warned);
    });
    expect(mocks.deleteBudget).toHaveBeenCalledOnce();
    expect(mocks.deleteBudget).toHaveBeenCalledWith(42);
    expect(mocks.recordImportRun).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('removes a warning import when its review is abandoned', async () => {
    mocks.importSnapshot.mockResolvedValue(warned);
    const view = await startImport();
    await screen.findByRole('button', { name: 'Import anyway' });
    view.unmount();
    expect(mocks.deleteBudget).toHaveBeenCalledOnce();
    expect(mocks.deleteBudget).toHaveBeenCalledWith(42);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('keeps the saved budget when publishing it unmounts first-budget onboarding', async () => {
    const completion = deferred<YNABImportResult>();
    mocks.importSnapshot.mockReturnValue(completion.promise);
    const view = await startImport();
    mocks.syncBudgetState.mockImplementation(() => view.unmount());
    await act(async () => {
      completion.resolve(imported);
    });
    await waitFor(() => expect(mocks.syncBudgetState).toHaveBeenCalled());
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.deleteBudget).not.toHaveBeenCalled();
    expect(mocks.setIsBudgetImporting).toHaveBeenLastCalledWith(false);
  });

  it('does not remove a saved budget if publishing its UI state fails', async () => {
    mocks.syncBudgetState.mockImplementation(() => {
      throw new Error('Synthetic UI refresh failure');
    });
    const view = await startImport();
    await screen.findByText('Synthetic UI refresh failure');
    view.unmount();
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.deleteBudget).not.toHaveBeenCalled();
  });

  it('cleans up the original database when a workspace change abandons review', async () => {
    mocks.importSnapshot.mockResolvedValue(warned);
    const view = await startImport();
    await screen.findByRole('button', { name: 'Import anyway' });
    const otherWorkspaceDelete = vi.fn();
    vi.spyOn(mocks.runtime, 'services').mockReturnValue({
      budgets: { deleteBudget: otherWorkspaceDelete },
      importHistory: { recordImportRun: mocks.recordImportRun },
    });
    view.unmount();
    expect(mocks.deleteBudget).toHaveBeenCalledWith(42);
    expect(otherWorkspaceDelete).not.toHaveBeenCalled();
  });

  it('lets an accepted save finish if navigation unmounts the form while persistence is pending', async () => {
    const persisted = deferred();
    mocks.save.mockReturnValue(persisted.promise);
    const view = await startImport();
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    view.unmount();
    expect(mocks.deleteBudget).not.toHaveBeenCalled();
    await act(async () => {
      persisted.resolve();
    });
    await waitFor(() => expect(mocks.finalize).toHaveBeenCalled());
    expect(mocks.deleteBudget).not.toHaveBeenCalled();
  });

  it('releases the busy state after a failed import and allows retry', async () => {
    mocks.importSnapshot.mockRejectedValue(new Error('Synthetic import failure'));
    await startImport();
    await screen.findByText('Synthetic import failure');
    expect(screen.getByRole('tab', { name: 'New' })).toBeEnabled();
    expect(mocks.setIsBudgetImporting).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'Back to import' }));
    mocks.importSnapshot.mockResolvedValue(imported);
    fireEvent.click(screen.getByRole('button', { name: 'Import source' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  });

  it('locks other creation tabs while saving an accepted warning import', async () => {
    const persisted = deferred();
    mocks.importSnapshot.mockResolvedValue(warned);
    mocks.save.mockReturnValue(persisted.promise);
    await startImport();
    fireEvent.click(await screen.findByRole('button', { name: 'Import anyway' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(screen.getByRole('tab', { name: 'Backup' })).toBeDisabled();
    expect(mocks.setIsBudgetImporting).toHaveBeenLastCalledWith(true);
    await act(async () => {
      persisted.resolve();
    });
    await waitFor(() => expect(mocks.setIsBudgetImporting).toHaveBeenLastCalledWith(false));
  });

  describe('review analytics', () => {
    const reviewEvents = () =>
      mocks.track.mock.calls.filter(([name]) => String(name).startsWith('ynab_import_review_'));

    it('reports the review shape and a keep decision from the app', async () => {
      mocks.importSnapshot.mockResolvedValue(warned);
      await startImport();
      fireEvent.click(await screen.findByRole('button', { name: 'Import anyway' }));
      await waitFor(() => expect(mocks.save).toHaveBeenCalled());
      expect(reviewEvents()).toEqual([
        [
          'ynab_import_review_shown',
          expect.objectContaining({ source: 'ynab_api', context: 'app', checks: 'category' }),
        ],
        [
          'ynab_import_review_decided',
          { source: 'ynab_api', context: 'app', decision: 'keep', duration_bucket: '<10s' },
        ],
      ]);
    });

    it('reports a remove decision once', async () => {
      mocks.importSnapshot.mockResolvedValue(warned);
      const view = await startImport();
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel and remove' }));
      view.unmount();
      expect(mocks.deleteBudget).toHaveBeenCalledWith(42);
      expect(reviewEvents().map(([name, props]) => [name, props?.decision])).toEqual([
        ['ynab_import_review_shown', undefined],
        ['ynab_import_review_decided', 'remove'],
      ]);
    });

    it('reports a review closed without a choice as left', async () => {
      mocks.importSnapshot.mockResolvedValue(warned);
      const view = await startImport();
      await screen.findByRole('button', { name: 'Import anyway' });
      view.unmount();
      expect(reviewEvents().at(-1)).toEqual([
        'ynab_import_review_decided',
        expect.objectContaining({ context: 'app', decision: 'left' }),
      ]);
    });

    it('sends nothing for an import without warnings', async () => {
      await startImport();
      await waitFor(() => expect(mocks.save).toHaveBeenCalled());
      expect(reviewEvents()).toEqual([]);
    });
  });

  it('does not publish or upload an import when local persistence rejects it', async () => {
    mocks.save.mockRejectedValue(new Error('Storage quota exceeded'));
    const view = await startImport();
    await screen.findByText('Storage quota exceeded');
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.syncBudgetState).not.toHaveBeenCalled();
    expect(mocks.setIsBudgetImporting).toHaveBeenLastCalledWith(false);
    view.unmount();
    expect(mocks.deleteBudget).toHaveBeenCalledWith(42);
  });

  it('passes the selected ZIP date order to the importer and refuses a missing choice', async () => {
    render(<CreateBudgetForm defaultTab="import" />);
    fireEvent.click(screen.getByRole('button', { name: 'Use ZIP' }));
    fireEvent.change(screen.getByLabelText('Budget name'), {
      target: { value: 'Synthetic dates' },
    });
    const file = new File(['synthetic'], 'dates.zip');
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(1) });
    fireEvent.change(screen.getByLabelText('ZIP source'), { target: { files: [file] } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Import source' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Import source' }));
    expect(mocks.importZip).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use month first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import source' }));
    await waitFor(() =>
      expect(mocks.importZip).toHaveBeenCalledWith(
        expect.any(ArrayBuffer),
        expect.objectContaining({ dateOrder: 'month-first' })
      )
    );
    await waitFor(() => expect(mocks.syncBudgetState).toHaveBeenCalled());
  });

  it('retains the currency selection when YNAB omits optional currency metadata', async () => {
    mocks.getPlan.mockResolvedValue({ plan: { name: 'Synthetic plan', currency_format: null } });
    const view = render(<CreateBudgetForm defaultTab="import" />);
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'synthetic-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Import source' })).toBeEnabled()
    );
    expect(screen.getByText('Currency: USD')).toBeInTheDocument();
    view.unmount();
  });
});

const creditMatching = {
  planId: 'plan-test',
  serverKnowledge: 42,
  accounts: ['a', 'b'].map((id) => ({
    accountId: `card-${id}`,
    name: 'Visa',
    balance: 0,
    closed: false,
    recentTransactions: [],
    candidateCategoryIds: ['cat-a', 'cat-b'],
  })),
  categories: ['a', 'b'].map((id) => ({
    categoryId: `cat-${id}`,
    name: 'Visa',
    available: 0,
    assigned: 0,
  })),
};

async function connectAmbiguousCards() {
  mocks.inspectSnapshot.mockReturnValue({
    accountCount: 2,
    categoryCount: 2,
    registerRowCount: 0,
    missingCategories: [],
    splitTransactions: [],
    creditPaymentMatching: creditMatching,
  });
  render(<CreateBudgetForm defaultTab="import" />);
  fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'test-token' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Import source' })).toBeEnabled());
}

it('blocks unmapped cards in the handler and forwards explicit mappings with their snapshot identity', async () => {
  await connectAmbiguousCards();
  fireEvent.click(screen.getByRole('button', { name: 'Import source' }));
  expect(mocks.importSnapshot).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Match cards' }));
  fireEvent.click(screen.getByRole('button', { name: 'Import source' }));
  await waitFor(() =>
    expect(mocks.importSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        creditPaymentMappings: {
          planId: 'plan-test',
          serverKnowledge: 42,
          byAccountId: { 'card-a': 'cat-b', 'card-b': 'cat-a' },
        },
      })
    )
  );
  await waitFor(() => expect(mocks.save).toHaveBeenCalled());
});

it.each(['Connect', 'Select another plan', 'Reset source', 'Use ZIP'])(
  'clears mappings when the source changes through %s, including a failed reload',
  async (button) => {
    await connectAmbiguousCards();
    fireEvent.click(screen.getByRole('button', { name: 'Match cards' }));
    expect(screen.getByText(/^Mappings:/)).toHaveTextContent('card-a');
    mocks.getPlan.mockRejectedValue(new Error('Could not reload'));
    fireEvent.click(screen.getByRole('button', { name: button }));
    await waitFor(() => expect(screen.getByText(/^Mappings:/)).not.toHaveTextContent('card-a'));
    expect(screen.getByRole('button', { name: 'Import source' })).toBeDisabled();
  }
);

it('invalidates prior mappings when the token changes', async () => {
  await connectAmbiguousCards();
  fireEvent.click(screen.getByRole('button', { name: 'Match cards' }));
  fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'different-token' } });
  expect(screen.getByText(/^Mappings:/)).not.toHaveTextContent('card-a');
  expect(screen.getByRole('button', { name: 'Import source' })).toBeDisabled();
});

it('ignores an API snapshot that returns after switching to ZIP', async () => {
  const response = deferred<unknown>();
  mocks.getPlan.mockReturnValue(response.promise);
  render(<CreateBudgetForm defaultTab="import" />);
  fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'test-token' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  await waitFor(() => expect(mocks.getPlan).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Use ZIP' }));
  await act(async () => response.resolve({ plan: { name: 'Late plan', currency_format: null } }));
  expect(screen.getByRole('button', { name: 'Import source' })).toBeDisabled();
  expect(mocks.inspectSnapshot).not.toHaveBeenCalled();
});
