import type { QueryClient } from '@tanstack/react-query';
import type { YNABApiPlanSnapshot, YNABImportResult } from '@budgero/core/browser';
import type { AppRuntime } from '@shared/runtime/app-runtime';
import type { NavigateFunction } from 'react-router-dom';

import { DEMO_ACCOUNT_METADATA_KEY, getDemoSpaceId, setDemoSpaceId } from '@shared/lib/demo-space';
import {
  newOnboardingAttempt,
  returnToDemo,
  runOnboardingApply,
  type OnboardingApplyDeps,
} from './apply-onboarding';
import { INITIAL_STATE, type OnboardingFormState } from './onboarding-data';

const mocks = vi.hoisted(() => ({
  storeMasterPassword: vi.fn(),
  createSpace: vi.fn(),
  deleteSpace: vi.fn(),
  listSpaces: vi.fn(),
  getState: vi.fn(),
  switchWorkspace: vi.fn(),
  seedDemoBudget: vi.fn(),
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
  blobApi: { getState: mocks.getState },
  spaceApi: {
    createSpace: mocks.createSpace,
    deleteSpace: mocks.deleteSpace,
    listSpaces: mocks.listSpaces,
  },
}));

vi.mock('@features/demo-budget/lib/seed-demo-budget', () => ({
  seedDemoBudget: mocks.seedDemoBudget,
}));

vi.mock('@features/onboarding/lib/onboarding-intro', () => ({
  writeIntroAcknowledged: mocks.writeIntroAcknowledged,
}));

vi.mock('@shared/runtime/budget-gate', () => ({
  getBudgetsQueryKey: (spaceId: string | null) => ['budgets', spaceId],
  syncBudgetStateFromRuntime: mocks.syncBudgetState,
  switchWorkspaceAndSyncBudgetState: mocks.switchWorkspace,
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

type Call = { op: string; payload: Record<string, unknown> };

function freshRuntime() {
  let nextId = 1;
  const execute = vi.fn(async (_call: Call) => ({ result: nextId++ }));
  const runtime = {
    isInitialized: () => true,
    refreshSpaces: vi.fn().mockResolvedValue(undefined),
    switchSpace: vi.fn().mockResolvedValue(undefined),
    getActiveSpaceId: () => 'space-1',
    getDatabase: () => ({}),
    finalizeOutOfBandMutation: vi.fn().mockResolvedValue(undefined),
    mutationsRouter: () => ({ execute }),
    services: () => ({}),
  } as unknown as AppRuntime;
  return { runtime, execute };
}

/** A runtime with the demo open; `seeded` = its accounts carry the demo marker. */
function demoRuntime(seeded: boolean) {
  let nextId = 1;
  const active = { id: 'demo-space' };
  const execute = vi.fn(async (_call: Call) => ({ result: nextId++ }));
  const metadata = seeded ? JSON.stringify({ [DEMO_ACCOUNT_METADATA_KEY]: true }) : '{}';
  mocks.switchWorkspace.mockImplementation(async ({ spaceId }: { spaceId: string }) => {
    active.id = spaceId;
  });
  const runtime = {
    isInitialized: () => true,
    refreshSpaces: vi.fn().mockResolvedValue(undefined),
    switchSpace: vi.fn(async (spaceId: string) => {
      active.id = spaceId;
    }),
    getActiveSpaceId: () => active.id,
    getDatabase: () => ({}),
    finalizeOutOfBandMutation: vi.fn().mockResolvedValue(undefined),
    mutationsRouter: () => ({ execute }),
    services: () => ({
      budgets: { getAllBudgets: () => (active.id === 'demo-space' ? [{ ID: 1 }] : []) },
      accounts: { listAccounts: () => [{ Metadata: metadata }] },
    }),
  } as unknown as AppRuntime;
  return { runtime, execute, active };
}

function deps(path: OnboardingApplyDeps['activePath'], runtime: AppRuntime) {
  return {
    activePath: path,
    runtime,
    queryClient: {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
      removeQueries: vi.fn(),
      setQueryData: vi.fn(),
    } as unknown as QueryClient,
    navigate: vi.fn() as unknown as NavigateFunction,
    profileId: 'profile-1',
    updateOnboardingAsync: vi.fn().mockResolvedValue(undefined),
    onComplete: vi.fn(),
    setApplyStatus: vi.fn(),
    setApplyError: vi.fn(),
    onYnabProgress: vi.fn(),
    onYnabResult: vi.fn(),
    reviewYnabImport: vi.fn(),
    onYnabImportCancelled: vi.fn(),
    waitForYnabContinue: async () => true,
  } satisfies OnboardingApplyDeps;
}

const freshState: OnboardingFormState = {
  ...INITIAL_STATE,
  startMode: 'fresh',
  budgetName: 'Home',
  password: 'pw',
  passwordConfirm: 'pw',
};

describe('runOnboardingApply fresh, demo and leaving the demo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.createSpace.mockResolvedValue({ space_id: 'space-1' });
    mocks.deleteSpace.mockResolvedValue(undefined);
    mocks.listSpaces.mockResolvedValue([]);
    mocks.seedDemoBudget.mockResolvedValue(42);
  });

  it('creates the picked envelopes and no goal', async () => {
    const { runtime, execute } = freshRuntime();
    await runOnboardingApply(freshState, deps('fresh', runtime));

    const calls = execute.mock.calls.map(([call]) => call);
    const emergency = calls.filter(
      (c) => c.op === 'categories.create' && c.payload.name === 'Emergency fund'
    );
    expect(emergency).toHaveLength(1);
    expect(calls.some((c) => c.op === 'goals.create')).toBe(false);
    // A blank account name falls back to the type's label as a plain string.
    const account = calls.find((c) => c.op === 'accounts.create');
    expect(account?.payload.name).toBe('Checking');
  });

  it('names an unnamed workspace in the app language', async () => {
    const { runtime } = freshRuntime();
    await runOnboardingApply({ ...freshState, budgetName: '  ' }, deps('fresh', runtime));
    expect(mocks.createSpace).toHaveBeenCalledWith('My budget');
  });

  it('seeds the demo into a workspace marked before the seed runs', async () => {
    const { runtime } = freshRuntime();
    const d = deps('demo', runtime);
    mocks.seedDemoBudget.mockImplementation(async () => {
      expect(getDemoSpaceId()).toBe('space-1');
      return 42;
    });
    await runOnboardingApply({ ...freshState, startMode: 'demo' }, d);

    expect(mocks.createSpace).toHaveBeenCalledWith('Demo budget');
    expect(mocks.seedDemoBudget).toHaveBeenCalledWith(
      runtime,
      'space-1',
      expect.objectContaining({ currency: expect.any(String), numberFormat: expect.any(String) })
    );
    expect(mocks.syncBudgetState).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: 'space-1', preferredBudgetId: 42 })
    );
    expect(d.updateOnboardingAsync).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' })
    );
    expect(d.onComplete).toHaveBeenCalledOnce();
    expect(getDemoSpaceId()).toBe('space-1');
  });

  it('removes a demo whose seed failed, so trying again starts clean', async () => {
    const { runtime } = freshRuntime();
    const d = deps('demo', runtime);
    mocks.seedDemoBudget.mockRejectedValueOnce(new Error('offline'));
    await runOnboardingApply({ ...freshState, startMode: 'demo' }, d);

    expect(mocks.deleteSpace).toHaveBeenCalledWith('space-1');
    expect(getDemoSpaceId()).toBeNull();
    expect(d.setApplyStatus).toHaveBeenLastCalledWith('error');
    expect(d.onComplete).not.toHaveBeenCalled();
  });

  it('deletes an empty demo left by an interrupted attempt before trying again', async () => {
    setDemoSpaceId('old-demo');
    mocks.listSpaces.mockResolvedValue([{ space_id: 'old-demo', role: 'owner' }]);
    mocks.getState.mockResolvedValue({ version: 0, mutation_version: 0 });
    mocks.createSpace.mockResolvedValue({ space_id: 'new-demo' });
    const { runtime } = freshRuntime();
    await runOnboardingApply({ ...freshState, startMode: 'demo' }, deps('demo', runtime));

    expect(mocks.deleteSpace).toHaveBeenCalledWith('old-demo');
    expect(mocks.deleteSpace).not.toHaveBeenCalledWith('new-demo');
    expect(mocks.deleteSpace.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createSpace.mock.invocationCallOrder[0]!
    );
    expect(getDemoSpaceId()).toBe('new-demo');
  });

  it('keeps a leftover marked workspace that holds data, and stops calling it the demo', async () => {
    setDemoSpaceId('old-demo');
    mocks.listSpaces.mockResolvedValue([{ space_id: 'old-demo', role: 'owner' }]);
    mocks.getState.mockResolvedValue({ version: 3, mutation_version: 12 });
    const { runtime } = freshRuntime();
    await runOnboardingApply(freshState, deps('fresh', runtime));
    expect(mocks.deleteSpace).not.toHaveBeenCalled();
    expect(getDemoSpaceId()).toBeNull();
  });

  it("leaves a demo id alone that isn't this user's workspace", async () => {
    setDemoSpaceId('someone-elses');
    mocks.listSpaces.mockResolvedValue([{ space_id: 'someone-elses', role: 'member' }]);
    const { runtime } = freshRuntime();
    await runOnboardingApply(freshState, deps('fresh', runtime));
    expect(mocks.deleteSpace).not.toHaveBeenCalled();
    expect(getDemoSpaceId()).toBeNull();
  });

  it('leaving the demo builds the real budget, keeps password and theme, then deletes the demo', async () => {
    setDemoSpaceId('demo-space');
    localStorage.setItem('budgero_default_space_v1', 'demo-space');
    mocks.createSpace.mockResolvedValue({ space_id: 'space-1' });
    const { runtime, execute } = demoRuntime(true);
    const d = { ...deps('from_demo', runtime), attempt: newOnboardingAttempt('demo-space') };
    await runOnboardingApply({ ...INITIAL_STATE, startMode: 'fresh', currency: 'EUR' }, d);

    expect(mocks.storeMasterPassword).not.toHaveBeenCalled();
    const calls = execute.mock.calls.map(([call]) => call);
    expect(calls.find((c) => c.op === 'budgets.create')?.payload).toEqual(
      expect.objectContaining({ displayCurrency: 'EUR' })
    );
    expect(calls.some((c) => c.op === 'goals.create')).toBe(false);
    expect(mocks.deleteSpace).toHaveBeenCalledWith('demo-space');
    expect(mocks.deleteSpace).not.toHaveBeenCalledWith('space-1');
    expect(getDemoSpaceId()).toBeNull();
    // Same cleanup as deleting it in Settings → Workspaces.
    expect(localStorage.getItem('budgero_default_space_v1')).toBeNull();
    expect(d.queryClient.removeQueries).toHaveBeenCalledWith({
      queryKey: ['space-members', 'demo-space'],
    });
    // Onboarding was completed when the demo opened; it isn't completed again.
    expect(d.updateOnboardingAsync).not.toHaveBeenCalled();
    expect(d.onComplete).toHaveBeenCalledOnce();
  });

  it('never deletes a marked workspace whose seed never ran and that now holds a real budget', async () => {
    // The tab closed after the demo workspace was created, before the seed;
    // the user then set up their own budget in it.
    setDemoSpaceId('demo-space');
    mocks.createSpace.mockResolvedValue({ space_id: 'space-1' });
    const { runtime } = demoRuntime(false);
    const d = { ...deps('from_demo', runtime), attempt: newOnboardingAttempt('demo-space') };
    await runOnboardingApply({ ...INITIAL_STATE, startMode: 'fresh' }, d);

    expect(mocks.deleteSpace).not.toHaveBeenCalled();
    expect(getDemoSpaceId()).toBeNull();
    expect(d.onComplete).toHaveBeenCalledOnce();
  });

  it('a retry after a failed start removes the half-built workspace and still deletes the demo', async () => {
    setDemoSpaceId('demo-space');
    mocks.createSpace
      .mockResolvedValueOnce({ space_id: 'half-built' })
      .mockResolvedValueOnce({ space_id: 'space-2' });
    const { runtime, execute, active } = demoRuntime(true);
    execute.mockRejectedValueOnce(new Error('offline'));
    const attempt = newOnboardingAttempt('demo-space');
    const d = { ...deps('from_demo', runtime), attempt };

    await runOnboardingApply({ ...INITIAL_STATE, startMode: 'fresh' }, d);
    expect(d.setApplyStatus).toHaveBeenLastCalledWith('error');
    expect(mocks.deleteSpace).not.toHaveBeenCalled();
    expect(active.id).toBe('half-built');

    await runOnboardingApply({ ...INITIAL_STATE, startMode: 'fresh' }, d);
    // The demo is reopened before the half-built workspace goes.
    expect(mocks.switchWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: 'demo-space' })
    );
    expect(mocks.deleteSpace.mock.calls.map(([id]) => id)).toEqual(['half-built', 'demo-space']);
    expect(mocks.createSpace).toHaveBeenCalledTimes(2);
    expect(d.onComplete).toHaveBeenCalledOnce();
  });

  it('back to the demo after a failed start reopens the demo, not the half-built workspace', async () => {
    setDemoSpaceId('demo-space');
    mocks.createSpace.mockResolvedValueOnce({ space_id: 'half-built' });
    const { runtime, execute, active } = demoRuntime(true);
    execute.mockRejectedValueOnce(new Error('offline'));
    const attempt = newOnboardingAttempt('demo-space');
    await runOnboardingApply(
      { ...INITIAL_STATE, startMode: 'fresh' },
      { ...deps('from_demo', runtime), attempt }
    );
    expect(active.id).toBe('half-built');

    await returnToDemo(runtime, deps('from_demo', runtime).queryClient, attempt);
    expect(active.id).toBe('demo-space');
    expect(mocks.deleteSpace).toHaveBeenCalledWith('half-built');
    expect(mocks.deleteSpace).not.toHaveBeenCalledWith('demo-space');
    expect(getDemoSpaceId()).toBe('demo-space');
  });
});
