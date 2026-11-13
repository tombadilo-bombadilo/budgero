import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { YNABImportService } from '@budgero/core/browser';
import type { YNABApiPlanSnapshot, YNABImportResult } from '@budgero/core/browser';

import OnboardingFlow from './OnboardingFlow';

const { mockRunOnboardingApply, mockReviewDecision, mockTrack, mockTrackOnUnload } = vi.hoisted(
  () => ({
    mockRunOnboardingApply: vi.fn(),
    mockReviewDecision: vi.fn(),
    mockTrack: vi.fn(),
    mockTrackOnUnload: vi.fn(),
  })
);

vi.mock('@shared/lib/analytics/track', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/lib/analytics/track')>()),
  track: mockTrack,
  trackOnUnload: mockTrackOnUnload,
}));

vi.mock('./apply-onboarding', () => ({
  runOnboardingApply: mockRunOnboardingApply,
  newOnboardingAttempt: () => ({ spaceId: null, demoSpaceId: null, demoProven: null }),
  returnToDemo: vi.fn(),
}));

vi.mock('./onboarding-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./onboarding-data')>();
  return {
    ...actual,
    INITIAL_STATE: {
      ...actual.INITIAL_STATE,
      startMode: 'ynab',
      budgetName: 'YNAB test plan',
      password: 'test-password',
      passwordConfirm: 'test-password',
      acknowledgedRules: true,
      ynabApiSnapshot: { plan: { name: 'YNAB test plan' } },
      ynabPreview: {
        registerRowCount: 10,
        accountCount: 1,
        categoryCount: 1,
        missingCategories: [],
        splitTransactions: [],
      },
    },
    PATH_STEPS: {
      ...actual.PATH_STEPS,
      ynab: ['ynab_import', 'password', 'done'],
    },
  };
});

vi.mock('./steps', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./steps')>();
  return {
    ...actual,
    YnabImportStep: ({
      set,
      state,
      onFileSelected,
      onApiSnapshotSelected,
    }: {
      set: (value: Record<string, unknown>) => void;
      state: {
        ynabFile: { name: string } | null;
        ynabApiSnapshot: YNABApiPlanSnapshot | null;
        ynabPreview: { creditPaymentMatching?: unknown } | null;
      };
      onFileSelected: (file: File) => void;
      onApiSnapshotSelected: (snapshot: YNABApiPlanSnapshot) => void;
    }) => (
      <div>
        YNAB source selection
        <span>Source: {state.ynabFile?.name || state.ynabApiSnapshot?.plan.id || 'none'}</span>
        <span>
          Requires card matching: {state.ynabPreview?.creditPaymentMatching ? 'yes' : 'no'}
        </span>
        <button
          onClick={() =>
            onFileSelected({
              name: 'late.zip',
              size: 1,
              arrayBuffer: async () => new ArrayBuffer(1),
            } as File)
          }
        >
          Inspect delayed ZIP
        </button>
        <button
          onClick={() =>
            onApiSnapshotSelected({
              plan: { id: 'api-source', name: 'Connected source', currency_format: null },
            } as YNABApiPlanSnapshot)
          }
        >
          Load API snapshot
        </button>
        <button
          onClick={() =>
            set({
              ynabApiSnapshot: null,
              ynabFile: { name: 'synthetic.zip', bytes: new ArrayBuffer(1), size: '1 B' },
              ynabPreview: { dateOrderAmbiguous: true },
              ynabDateOrder: undefined,
            })
          }
        >
          Load ambiguous ZIP
        </button>
        <button
          onClick={() =>
            set({
              ynabFile: null,
              ynabPreview: {
                creditPaymentMatching: {
                  planId: 'plan',
                  serverKnowledge: 1,
                  accounts: [{ accountId: 'card', candidateCategoryIds: ['category'] }],
                  categories: [{ categoryId: 'category' }],
                },
              },
              ynabCreditPaymentMappings: undefined,
            })
          }
        >
          Load unmatched cards
        </button>
        <button
          onClick={() =>
            set({
              ynabCreditPaymentMappings: {
                planId: 'plan',
                serverKnowledge: 1,
                byAccountId: { card: 'category' },
              },
            })
          }
        >
          Match cards
        </button>
        <button onClick={() => set({ ynabDateOrder: 'month-first' })}>Use month-first dates</button>
      </div>
    ),
    PasswordStep: () => <div>Master password</div>,
  };
});

vi.mock('@shared/runtime/runtime-provider', () => ({
  useRuntime: () => ({}),
}));

vi.mock('@entities/user/api/useAuth', () => ({
  useLogout: () => ({ mutate: vi.fn() }),
  useProfile: () => ({ data: { id: 'profile-1' } }),
  useUpdateOnboarding: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@shared/contexts/ThemePresetContext', () => ({
  useThemePreset: () => ({ setThemeId: vi.fn() }),
}));

vi.mock('@features/budget-sharing/lib/pending-space-invite', () => ({
  readPendingSpaceInvite: () => Promise.resolve(null),
}));

/** The flow shows its first step once the pending-invite check resolves. */
async function flowReady() {
  await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
}

const warnedResult: YNABImportResult = {
  budgetId: 7,
  summary: {
    registerRowsImported: 10,
    transactionsCreated: 10,
    missingCategoriesCreated: [],
    splitTransactionsImported: 0,
  },
  verification: {
    status: 'warning',
    source: { transactions: 10, subtransactions: 0, registerRows: 10 },
    accounts: { checked: 1, matched: 1, debtBalanceAdjustments: [] },
    categories: { checked: 3, matched: 3, mismatches: [], omittedMismatches: 0 },
    readyToAssign: {
      checked: 1,
      matched: 0,
      mismatches: [
        {
          month: '2026-09',
          expectedReadyToAssign: 10_000,
          computedReadyToAssign: 9_000,
          difference: -1_000,
          breakdown: {
            income: 10_000,
            assignments: 1_000,
            offBudgetTransfers: 0,
            inBudgetTransfers: 0,
            revaluations: 0,
            priorCashOverspend: 0,
          },
        },
      ],
    },
  },
};

const passedResult: YNABImportResult = {
  ...warnedResult,
  verification: {
    ...warnedResult.verification!,
    status: 'passed',
    readyToAssign: { checked: 1, matched: 1, mismatches: [] },
  },
};

describe('OnboardingFlow YNAB import verification', () => {
  beforeEach(() => {
    mockRunOnboardingApply.mockReset();
    mockReviewDecision.mockReset();
  });

  it('shows live progress and pauses on warnings until the user removes the import', async () => {
    let continueImport: (() => void) | undefined;
    const importGate = new Promise<void>((resolve) => {
      continueImport = resolve;
    });

    mockRunOnboardingApply.mockImplementation(async (_state, deps) => {
      deps.setApplyStatus('running');
      await deps.onYnabProgress({
        stage: 'categories',
        status: 'running',
        progress: 42,
        label: 'Importing categories',
        detail: '1 category mapping',
      });
      await importGate;
      deps.onYnabResult(warnedResult);
      const reviewDecision = deps.reviewYnabImport(warnedResult);
      await deps.onYnabProgress({
        stage: 'complete',
        status: 'warning',
        progress: 99,
        label: 'Waiting for your review',
      });
      const decision = await reviewDecision;
      mockReviewDecision(decision);
      if (decision === 'cancel') {
        deps.setApplyStatus('idle');
        deps.onYnabImportCancelled();
      }
    });

    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <OnboardingFlow onComplete={vi.fn()} />
        </QueryClientProvider>
      </MemoryRouter>
    );
    await flowReady();

    fireEvent.click(screen.getByRole('button', { name: /Let’s begin/ }));
    expect(screen.getByText('Master password')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Import my budget/ }));

    expect(await screen.findByText('Importing from YNAB')).toBeInTheDocument();
    expect(await screen.findByText('42%')).toBeInTheDocument();
    expect(screen.getByText('1 category mapping')).toBeInTheDocument();

    await act(async () => continueImport?.());

    expect(await screen.findByText('Review YNAB differences')).toBeInTheDocument();
    expect(screen.getByText('10 rows exact')).toBeInTheDocument();
    expect(screen.getByText('1 of 1 exact')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import anyway' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel and remove' }));

    await waitFor(() => expect(mockReviewDecision).toHaveBeenCalledWith('cancel'));
    expect(await screen.findByText('YNAB source selection')).toBeInTheDocument();
  });

  it('keeps a successful verification report open until the user continues', async () => {
    const onComplete = vi.fn();
    mockRunOnboardingApply.mockImplementation(async (_state, deps) => {
      deps.setApplyStatus('running');
      deps.onYnabResult(passedResult);
      const continueFromReport = deps.waitForYnabContinue();
      await deps.onYnabProgress({
        stage: 'complete',
        status: 'passed',
        progress: 100,
        label: 'Imported budget saved',
      });
      if (await continueFromReport) deps.onComplete();
    });

    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <OnboardingFlow onComplete={onComplete} />
        </QueryClientProvider>
      </MemoryRouter>
    );
    await flowReady();

    fireEvent.click(screen.getByRole('button', { name: /Let’s begin/ }));
    expect(screen.getByText('Master password')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Import my budget/ }));

    expect(await screen.findByText('YNAB import verified')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Open imported budget' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
  });
});

it('requires a date-order choice before advancing an ambiguous ZIP through onboarding', async () => {
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <OnboardingFlow onComplete={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>
  );
  await flowReady();
  fireEvent.click(screen.getByRole('button', { name: 'Load ambiguous ZIP' }));
  expect(screen.getByRole('button', { name: /Let’s begin/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Use month-first dates' }));
  expect(screen.getByRole('button', { name: /Let’s begin/ })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: /Let’s begin/ }));
  expect(screen.getByText('Master password')).toBeInTheDocument();
});

it('requires card payment mappings before advancing through onboarding', async () => {
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <OnboardingFlow onComplete={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>
  );
  await flowReady();
  fireEvent.click(screen.getByRole('button', { name: 'Load unmatched cards' }));
  expect(screen.getByRole('button', { name: /Let’s begin/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Match cards' }));
  expect(screen.getByRole('button', { name: /Let’s begin/ })).toBeEnabled();
});

it('ignores late ZIP inspection after the source changes to an API plan with unmatched cards', async () => {
  let resolve!: (preview: Awaited<ReturnType<typeof YNABImportService.inspectYNABZip>>) => void;
  const inspectZip = vi.spyOn(YNABImportService, 'inspectYNABZip').mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const inspectApi = vi.spyOn(YNABImportService, 'inspectYNABApiSnapshot').mockReturnValue({
    accountCount: 2,
    categoryCount: 2,
    registerRowCount: 0,
    missingCategories: [],
    splitTransactions: [],
    creditPaymentMatching: {
      planId: 'api-source',
      serverKnowledge: 1,
      accounts: [],
      categories: [],
    },
  });
  try {
    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <OnboardingFlow onComplete={vi.fn()} />
        </QueryClientProvider>
      </MemoryRouter>
    );
    await flowReady();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect delayed ZIP' }));
    await waitFor(() => expect(inspectZip).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Load API snapshot' }));
    expect(screen.getByText('Source: api-source')).toBeInTheDocument();
    await act(async () =>
      resolve({
        accountCount: 1,
        categoryCount: 1,
        registerRowCount: 0,
        missingCategories: [],
        splitTransactions: [],
      })
    );
    expect(screen.getByText('Source: api-source')).toBeInTheDocument();
    expect(screen.getByText('Requires card matching: yes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Let’s begin/ })).toBeDisabled();
  } finally {
    inspectZip.mockRestore();
    inspectApi.mockRestore();
  }
});

it('reports going back a step and leaving onboarding mid-way', async () => {
  mockTrack.mockReset();
  mockTrackOnUnload.mockReset();
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <OnboardingFlow onComplete={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>
  );
  await flowReady();
  fireEvent.click(screen.getByRole('button', { name: 'Load ambiguous ZIP' }));
  fireEvent.click(screen.getByRole('button', { name: 'Use month-first dates' }));
  fireEvent.click(screen.getByRole('button', { name: /Let’s begin/ }));
  expect(mockTrack).toHaveBeenCalledWith('onboarding_step_completed', {
    step: 'ynab_import',
    path: 'ynab',
    duration_bucket: '<10s',
  });
  fireEvent.click(screen.getByRole('button', { name: /Back/ }));
  expect(mockTrack).toHaveBeenCalledWith('onboarding_step_back', {
    from: 'password',
    to: 'ynab_import',
    path: 'ynab',
  });
  window.dispatchEvent(new Event('pagehide'));
  window.dispatchEvent(new Event('pagehide'));
  expect(mockTrackOnUnload).toHaveBeenCalledTimes(1);
  expect(mockTrackOnUnload).toHaveBeenCalledWith('onboarding_left', {
    step: 'ynab_import',
    path: 'ynab',
    duration_bucket: '<10s',
  });
});
