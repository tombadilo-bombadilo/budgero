import type { QueryClient } from '@tanstack/react-query';
import type { YNABApiPlanSnapshot, YNABImportResult } from '@budgero/core/browser';
import type { AppRuntime } from '@shared/runtime/app-runtime';
import type { NavigateFunction } from 'react-router-dom';

import { runOnboardingApply } from './apply-onboarding';
import { INITIAL_STATE, type OnboardingFormState } from './onboarding-data';

const mocks = vi.hoisted(() => ({
  storeMasterPassword: vi.fn(),
  createSpace: vi.fn(),
  deleteSpace: vi.fn(),
  setMasterPasswordStatus: vi.fn(),
  writeIntroAcknowledged: vi.fn(),
  importFromApi: vi.fn(),
  importFromZip: vi.fn(),
  syncBudgetState: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@shared/lib/crypto', () => ({
  MasterPasswordManager: { store: mocks.storeMasterPassword },
}));

vi.mock('@shared/api/api-client', () => ({
  authApi: { setMasterPasswordStatus: mocks.setMasterPasswordStatus },
  spaceApi: {
    createSpace: mocks.createSpace,
    deleteSpace: mocks.deleteSpace,
  },
}));

vi.mock('@features/onboarding/lib/onboarding-intro', () => ({
  writeIntroAcknowledged: mocks.writeIntroAcknowledged,
}));

vi.mock('@shared/runtime/budget-gate', () => ({
  getBudgetsQueryKey: (spaceId: string | null) => ['budgets', spaceId],
  syncBudgetStateFromRuntime: mocks.syncBudgetState,
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

vi.mock('@budgero/core/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@budgero/core/browser')>();
  return {
    ...actual,
    YNABImportService: class {
      importYNABFromApiSnapshotWithSummary(...args: unknown[]) {
        return mocks.importFromApi(...args);
      }

      importYNABFromZipWithSummary(...args: unknown[]) {
        return mocks.importFromZip(...args);
      }
    },
  };
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const passedResult: YNABImportResult = {
  budgetId: 7,
  summary: {
    registerRowsImported: 15_000,
    transactionsCreated: 14_900,
    missingCategoriesCreated: [],
    splitTransactionsImported: 100,
    accountBalancesVerified: 8,
  },
  verification: {
    status: 'passed',
    source: { transactions: 14_900, subtransactions: 100, registerRows: 15_000 },
    accounts: { checked: 8, matched: 8, debtBalanceAdjustments: [] },
    categories: { checked: 240, matched: 240, mismatches: [], omittedMismatches: 0 },
    readyToAssign: { checked: 60, matched: 60, mismatches: [] },
  },
};

const ynabState: OnboardingFormState = {
  ...INITIAL_STATE,
  startMode: 'ynab',
  budgetName: "Aleksa's Plan",
  password: 'test-password',
  passwordConfirm: 'test-password',
  ynabCreditPaymentMappings: {
    planId: 'plan',
    serverKnowledge: 42,
    byAccountId: { 'card-a': 'cat-b', 'card-b': 'cat-a' },
  },
  ynabPreview: {
    registerRowCount: 0,
    accountCount: 2,
    categoryCount: 2,
    missingCategories: [],
    splitTransactions: [],
    creditPaymentMatching: { planId: 'plan', serverKnowledge: 42, accounts: [], categories: [] },
  },
  ynabApiSnapshot: {
    plan: {
      name: "Aleksa's Plan",
      currency_format: { iso_code: 'USD' },
    },
  } as YNABApiPlanSnapshot,
};

describe('runOnboardingApply YNAB completion gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storeMasterPassword.mockResolvedValue(undefined);
    mocks.createSpace.mockResolvedValue({ space_id: 'space-1' });
    mocks.deleteSpace.mockResolvedValue(undefined);
    mocks.setMasterPasswordStatus.mockResolvedValue(undefined);
    mocks.importFromApi.mockResolvedValue(passedResult);
  });

  it('does not release any startup gate until the user opens the verified import', async () => {
    const continueFromReport = deferred<boolean>();
    const reportReady = deferred<void>();
    const updateOnboardingAsync = vi.fn().mockResolvedValue(undefined);
    const onComplete = vi.fn();
    const onYnabProgress = vi.fn().mockResolvedValue(undefined);
    const recordImportRun = vi.fn();
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
      setQueryData: vi.fn(),
    } as unknown as QueryClient;
    const runtime = {
      isInitialized: () => true,
      refreshSpaces: vi.fn().mockResolvedValue(undefined),
      switchSpace: vi.fn().mockResolvedValue(undefined),
      getDatabase: () => ({}),
      finalizeOutOfBandMutation: vi.fn().mockResolvedValue(undefined),
      services: () => ({
        importHistory: { recordImportRun },
      }),
    } as unknown as AppRuntime;

    const applying = runOnboardingApply(ynabState, {
      activePath: 'ynab',
      runtime,
      queryClient,
      navigate: vi.fn() as unknown as NavigateFunction,
      profileId: 'profile-1',
      setThemeId: vi.fn(),
      updateOnboardingAsync,
      onComplete,
      setApplyStatus: vi.fn(),
      setApplyError: vi.fn(),
      onYnabProgress,
      onYnabResult: vi.fn(),
      reviewYnabImport: vi.fn(),
      onYnabImportCancelled: vi.fn(),
      waitForYnabContinue: () => {
        reportReady.resolve();
        return continueFromReport.promise;
      },
    });

    await reportReady.promise;
    expect(mocks.importFromApi).toHaveBeenCalledWith(
      ynabState.ynabApiSnapshot,
      expect.objectContaining({ creditPaymentMappings: ynabState.ynabCreditPaymentMappings })
    );

    expect(onYnabProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ stage: 'complete', status: 'passed', progress: 100 })
    );
    // The workspace exists, so the server already knows a master password is
    // set; other devices must not be sent into onboarding if this tab is
    // closed on the report.
    expect(mocks.setMasterPasswordStatus).toHaveBeenCalledWith(true);
    expect(updateOnboardingAsync).not.toHaveBeenCalled();
    expect(mocks.writeIntroAcknowledged).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    continueFromReport.resolve(true);
    await applying;

    expect(mocks.setMasterPasswordStatus).toHaveBeenCalledWith(true);
    expect(updateOnboardingAsync).toHaveBeenCalledWith({
      status: 'completed',
      snoozed_until: null,
      where_heard_about: '',
    });
    expect(mocks.writeIntroAcknowledged).toHaveBeenCalledWith('profile-1');
    expect(onComplete).toHaveBeenCalledOnce();
  });
});

it.each(['', '1.234,567'])(
  'passes ZIP date order and source format %s independently of display format',
  async (sourceNumberFormat) => {
    vi.clearAllMocks();
    mocks.createSpace.mockResolvedValue({ space_id: 'space-1' });
    const bytes = new ArrayBuffer(1);
    mocks.importFromZip.mockResolvedValue({ ...passedResult, verification: undefined });
    const runtime = {
      isInitialized: () => true,
      refreshSpaces: vi.fn().mockResolvedValue(undefined),
      switchSpace: vi.fn().mockResolvedValue(undefined),
      getDatabase: () => ({}),
      finalizeOutOfBandMutation: vi.fn().mockResolvedValue(undefined),
      services: () => ({ importHistory: { recordImportRun: vi.fn() } }),
    } as unknown as AppRuntime;
    await runOnboardingApply(
      {
        ...ynabState,
        ynabApiSnapshot: null,
        ynabFile: { name: 'synthetic.zip', size: '1 B', bytes },
        ynabDateOrder: 'month-first',
        ynabSourceNumberFormat: sourceNumberFormat,
      },
      {
        activePath: 'ynab',
        runtime,
        queryClient: {
          invalidateQueries: vi.fn().mockResolvedValue(undefined),
          setQueryData: vi.fn(),
        } as unknown as QueryClient,
        navigate: vi.fn() as unknown as NavigateFunction,
        profileId: 'profile-1',
        setThemeId: vi.fn(),
        updateOnboardingAsync: vi.fn().mockResolvedValue(undefined),
        onComplete: vi.fn(),
        setApplyStatus: vi.fn(),
        setApplyError: vi.fn(),
        onYnabProgress: vi.fn(),
        onYnabResult: vi.fn(),
        reviewYnabImport: vi.fn(),
        onYnabImportCancelled: vi.fn(),
        waitForYnabContinue: async () => true,
      }
    );
    expect(mocks.importFromZip.mock.calls[0][1]).not.toHaveProperty('creditPaymentMappings');
    expect(mocks.importFromZip).toHaveBeenCalledWith(
      bytes,
      expect.objectContaining({
        dateOrder: 'month-first',
        sourceNumberFormat,
        numberFormat: '$1,096.56',
      })
    );
  }
);
