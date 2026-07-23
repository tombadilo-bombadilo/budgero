import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type {
  AuthStartupSnapshot,
  BudgetStartupSnapshot,
  IntroStartupSnapshot,
  MasterPasswordStartupSnapshot,
  WorkspaceStartupSnapshot,
} from './hooks';
import StartupController from './StartupController';

const { mockSwitchWorkspaceAndSyncBudgetState } = vi.hoisted(() => ({
  mockSwitchWorkspaceAndSyncBudgetState: vi.fn(),
}));

let runtimeState = 'Ready';
let runtimeInitialized = true;
let runtimeServicesReady = true;
let authSnapshot: AuthStartupSnapshot;
let introSnapshot: IntroStartupSnapshot;
let masterPasswordSnapshot: MasterPasswordStartupSnapshot;
let workspaceSnapshot: WorkspaceStartupSnapshot;
let budgetSnapshot: BudgetStartupSnapshot;

const runtimeMock = {
  isInitialized: () => runtimeInitialized,
  servicesReady: () => runtimeServicesReady,
  state: () => runtimeState,
  init: vi.fn(),
  getActiveSpaceId: () => 'space-a',
  connectivityState: () => ({ overall: false, apiReachable: false }),
};

vi.mock('@shared/lib/crypto', () => ({
  MasterPasswordManager: {
    get: vi.fn().mockResolvedValue('test-master-password'),
  },
}));

vi.mock('./BackupReminderManager', () => ({
  default: () => null,
}));

vi.mock('./preload', () => ({
  hideStartupPreload: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@shared/runtime/runtime-provider', () => ({
  useRuntime: () => runtimeMock,
  useRuntimeState: () => runtimeState,
}));

vi.mock('@shared/runtime/budget-gate', () => ({
  getBudgetsQueryOptions: vi.fn(() => ({
    queryKey: ['budgets', 'space-a'],
    queryFn: async () => [],
    staleTime: 300000,
  })),
  switchWorkspaceAndSyncBudgetState: mockSwitchWorkspaceAndSyncBudgetState,
  syncBudgetStateFromRuntime: vi.fn(),
}));

vi.mock('./hooks', () => ({
  useAuthStartupSnapshot: () => authSnapshot,
  useIntroStartupSnapshot: () => introSnapshot,
  useMasterPasswordStartupSnapshot: () => masterPasswordSnapshot,
  useWorkspaceStartupSnapshot: () => workspaceSnapshot,
  useBudgetStartupSnapshot: () => budgetSnapshot,
}));

vi.mock('./screens', () => ({
  StartupSplashScreen: ({ message }: { message?: string }) => (
    <div data-testid="startup-splash">{message ?? 'splash'}</div>
  ),
  AccessBlockedScreen: () => <div data-testid="access-blocked-screen" />,
  IntroRequiredScreen: () => <div data-testid="intro-required-screen" />,
  MasterPasswordRequiredScreen: () => <div data-testid="master-password-screen" />,
  WorkspaceRequiredScreen: () => <div data-testid="workspace-required-screen" />,
  BudgetRequiredScreen: () => <div data-testid="budget-required-screen" />,
  BudgetBlockedScreen: ({
    alternativeWorkspaces,
    onSwitchWorkspace,
  }: {
    alternativeWorkspaces: { space_id: string; display_name: string }[];
    onSwitchWorkspace: (spaceId: string) => void;
  }) => (
    <div data-testid="budget-blocked-screen">
      {alternativeWorkspaces.map((workspace) => (
        <button
          key={workspace.space_id}
          type="button"
          onClick={() => onSwitchWorkspace(workspace.space_id)}
        >
          Switch {workspace.display_name}
        </button>
      ))}
    </div>
  ),
  StartupErrorScreen: ({ error }: { error: string }) => (
    <div data-testid="startup-error-screen">{error}</div>
  ),
  StartupSyncStatus: () => null,
}));

function createAuthSnapshot(overrides: Partial<AuthStartupSnapshot> = {}): AuthStartupSnapshot {
  return {
    status: 'ready',
    user: undefined,
    accessStatus: null,
    canProceedOffline: false,
    ...overrides,
  };
}

function createIntroSnapshot(overrides: Partial<IntroStartupSnapshot> = {}): IntroStartupSnapshot {
  return {
    status: 'ready',
    acknowledgeIntro: () => {
      /* no-op */
    },
    ...overrides,
  };
}

function createMasterPasswordSnapshot(
  overrides: Partial<MasterPasswordStartupSnapshot> = {}
): MasterPasswordStartupSnapshot {
  return {
    status: 'ready',
    isOffline: false,
    isFirstTimeSetup: false,
    inputPassword: '',
    setInputPassword: () => {
      /* no-op */
    },
    confirmPassword: '',
    setConfirmPassword: () => {
      /* no-op */
    },
    error: '',
    setError: () => {
      /* no-op */
    },
    submit: async () => {
      /* no-op */
    },
    promptForReentry: () => {
      /* no-op */
    },
    showResetDialog: false,
    setShowResetDialog: () => {
      /* no-op */
    },
    resetConfirmation: '',
    setResetConfirmation: () => {
      /* no-op */
    },
    confirmReset: async () => {
      /* no-op */
    },
    isResetting: false,
    resetError: null,
    passwordChangedRemotely: false,
    ...overrides,
  };
}

function createWorkspaceSnapshot(
  overrides: Partial<WorkspaceStartupSnapshot> = {}
): WorkspaceStartupSnapshot {
  return {
    status: 'ready',
    spacesQuery: {} as WorkspaceStartupSnapshot['spacesQuery'],
    accessibleSpaces: [],
    allowWorkspaceCreation: true,
    ...overrides,
  };
}

function createBudgetSnapshot(
  overrides: Partial<BudgetStartupSnapshot> = {}
): BudgetStartupSnapshot {
  return {
    status: 'ready',
    canManageBudgets: true,
    alternativeWorkspaces: [],
    ...overrides,
  };
}

function TestHarness({ path, queryClient }: { path: string; queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<StartupController />}>
            <Route path="*" element={<div data-testid="app-route">App route</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderController(initialPath = '/dashboard') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return {
    queryClient,
    ...render(<TestHarness path={initialPath} queryClient={queryClient} />),
  };
}

describe('StartupController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeState = 'Ready';
    runtimeInitialized = true;
    runtimeServicesReady = true;
    runtimeMock.init.mockResolvedValue(undefined);
    authSnapshot = createAuthSnapshot();
    introSnapshot = createIntroSnapshot();
    masterPasswordSnapshot = createMasterPasswordSnapshot();
    workspaceSnapshot = createWorkspaceSnapshot();
    budgetSnapshot = createBudgetSnapshot();
    mockSwitchWorkspaceAndSyncBudgetState.mockResolvedValue({
      selectedBudget: null,
      clearStoredDefault: false,
    });
  });

  it('shows the budget setup screen when the active workspace has zero budgets', async () => {
    budgetSnapshot = createBudgetSnapshot({ status: 'required' });

    renderController();

    expect(await screen.findByTestId('budget-required-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('app-route')).not.toBeInTheDocument();
  });

  it('renders the intended route once the budget gate becomes ready', async () => {
    budgetSnapshot = createBudgetSnapshot({ status: 'required' });
    const view = renderController('/reports/prebuilt');

    expect(await screen.findByTestId('budget-required-screen')).toBeInTheDocument();

    budgetSnapshot = createBudgetSnapshot({ status: 'ready' });
    view.rerender(<TestHarness path="/reports/prebuilt" queryClient={view.queryClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('app-route')).toBeInTheDocument();
    });
  });

  it('re-enters the budget setup screen after the app was already ready', async () => {
    const view = renderController();

    expect(await screen.findByTestId('app-route')).toBeInTheDocument();

    budgetSnapshot = createBudgetSnapshot({ status: 'required' });
    view.rerender(<TestHarness path="/dashboard" queryClient={view.queryClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('budget-required-screen')).toBeInTheDocument();
    });
  });

  it('recovers to workspace setup when runtime reports there are no accepted spaces', async () => {
    runtimeInitialized = false;
    runtimeServicesReady = false;
    runtimeMock.init.mockRejectedValueOnce(
      new Error('No accepted budget spaces available for this account')
    );
    const view = renderController('/dashboard');
    const invalidateSpy = vi.spyOn(view.queryClient, 'invalidateQueries');

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['budget-spaces'] })
      );
    });

    workspaceSnapshot = createWorkspaceSnapshot({ status: 'required', accessibleSpaces: [] });
    view.rerender(<TestHarness path="/dashboard" queryClient={view.queryClient} />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-required-screen')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('startup-error-screen')).not.toBeInTheDocument();
  });

  it('shows the blocked budget screen for non-owners and lets them switch workspaces', async () => {
    budgetSnapshot = createBudgetSnapshot({
      status: 'blocked',
      canManageBudgets: false,
      alternativeWorkspaces: [
        {
          space_id: 'space-b',
          display_name: 'Shared workspace',
          owner_user_id: 'owner-2',
          role: 'editor',
          invitation_status: 'accepted',
          encrypted_space_key: 'encrypted-key',
          is_accessible: true,
          access_reason: 'active',
          created_at: '2026-03-16T10:00:00.000Z',
          updated_at: '2026-03-16T10:00:00.000Z',
        },
      ],
    });

    renderController();

    const switchButton = await screen.findByRole('button', {
      name: 'Switch Shared workspace',
    });
    fireEvent.click(switchButton);

    await waitFor(() => {
      expect(mockSwitchWorkspaceAndSyncBudgetState).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: runtimeMock,
          spaceId: 'space-b',
        })
      );
    });
  });

  it('allows recovery routes through even when there is no accessible workspace', async () => {
    workspaceSnapshot = createWorkspaceSnapshot({ status: 'required', accessibleSpaces: [] });

    renderController('/settings/subscription');

    expect(await screen.findByTestId('app-route')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-required-screen')).not.toBeInTheDocument();
    expect(runtimeMock.init).not.toHaveBeenCalled();
  });

  it('allows /join through the startup guards so lapsed users can redeem invites', async () => {
    workspaceSnapshot = createWorkspaceSnapshot({ status: 'required', accessibleSpaces: [] });

    renderController('/join');

    expect(await screen.findByTestId('app-route')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-required-screen')).not.toBeInTheDocument();
    expect(runtimeMock.init).not.toHaveBeenCalled();
  });

  it('keeps new users on the onboarding flow when landing on /join before intro', async () => {
    introSnapshot = createIntroSnapshot({ status: 'intro_required' });

    renderController('/join');

    expect(await screen.findByTestId('intro-required-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('app-route')).not.toBeInTheDocument();
  });
});
