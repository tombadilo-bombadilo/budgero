import { describe, expect, it } from 'vitest';
import { resolveStartupResolution } from './resolve';
import {
  INITIAL_STARTUP_MACHINE_STATE,
  INITIAL_STARTUP_RESOLUTION,
  startupReducer,
} from './reducer';
import type {
  AuthStartupSnapshot,
  BudgetStartupSnapshot,
  IntroStartupSnapshot,
  MasterPasswordStartupSnapshot,
  WorkspaceStartupSnapshot,
} from './hooks';

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

describe('resolveStartupResolution', () => {
  it('routes unauthenticated users to auth', () => {
    const resolution = resolveStartupResolution({
      auth: createAuthSnapshot({
        status: 'auth_required',
        redirectTo: '/auth?mode=signin&next=%2Fdashboard',
      }),
      intro: createIntroSnapshot(),
      masterPassword: createMasterPasswordSnapshot(),
      workspace: createWorkspaceSnapshot(),
      runtimeReady: false,
      runtimeError: '',
      budget: createBudgetSnapshot(),
    });

    expect(resolution.state).toBe('auth_required');
    expect(resolution.screen).toBe('redirect');
  });

  it('requires intro before master password when onboarding is still pending', () => {
    const resolution = resolveStartupResolution({
      auth: createAuthSnapshot(),
      intro: createIntroSnapshot({ status: 'intro_required' }),
      masterPassword: createMasterPasswordSnapshot({ status: 'required' }),
      workspace: createWorkspaceSnapshot(),
      runtimeReady: false,
      runtimeError: '',
      budget: createBudgetSnapshot(),
    });

    expect(resolution.state).toBe('intro_required');
    expect(resolution.screen).toBe('intro');
  });

  it('shows the master password screen before runtime initialization', () => {
    const resolution = resolveStartupResolution({
      auth: createAuthSnapshot(),
      intro: createIntroSnapshot(),
      masterPassword: createMasterPasswordSnapshot({ status: 'required' }),
      workspace: createWorkspaceSnapshot(),
      runtimeReady: false,
      runtimeError: '',
      budget: createBudgetSnapshot(),
    });

    expect(resolution.state).toBe('master_password_required');
    expect(resolution.screen).toBe('master_password');
  });

  it('routes to workspace setup when no workspace exists', () => {
    const resolution = resolveStartupResolution({
      auth: createAuthSnapshot(),
      intro: createIntroSnapshot(),
      masterPassword: createMasterPasswordSnapshot(),
      workspace: createWorkspaceSnapshot({ status: 'required' }),
      runtimeReady: false,
      runtimeError: '',
      budget: createBudgetSnapshot(),
    });

    expect(resolution.state).toBe('workspace_required');
    expect(resolution.screen).toBe('workspace');
  });

  it('keeps startup in runtime initialization until runtime is ready', () => {
    const resolution = resolveStartupResolution({
      auth: createAuthSnapshot(),
      intro: createIntroSnapshot(),
      masterPassword: createMasterPasswordSnapshot(),
      workspace: createWorkspaceSnapshot(),
      runtimeReady: false,
      runtimeError: '',
      budget: createBudgetSnapshot(),
    });

    expect(resolution.state).toBe('runtime_initializing');
    expect(resolution.screen).toBe('splash');
  });

  it('routes to budget setup when runtime is ready but no budgets exist', () => {
    const resolution = resolveStartupResolution({
      auth: createAuthSnapshot(),
      intro: createIntroSnapshot(),
      masterPassword: createMasterPasswordSnapshot(),
      workspace: createWorkspaceSnapshot(),
      runtimeReady: true,
      runtimeError: '',
      budget: createBudgetSnapshot({ status: 'required' }),
    });

    expect(resolution.state).toBe('budget_required');
    expect(resolution.screen).toBe('budget');
  });

  it('routes non-owners without budgets to the blocked budget screen', () => {
    const resolution = resolveStartupResolution({
      auth: createAuthSnapshot(),
      intro: createIntroSnapshot(),
      masterPassword: createMasterPasswordSnapshot(),
      workspace: createWorkspaceSnapshot(),
      runtimeReady: true,
      runtimeError: '',
      budget: createBudgetSnapshot({ status: 'blocked', canManageBudgets: false }),
    });

    expect(resolution.state).toBe('budget_blocked');
    expect(resolution.screen).toBe('budget_blocked');
  });

  it('returns ready once all startup prerequisites settle', () => {
    const resolution = resolveStartupResolution({
      auth: createAuthSnapshot(),
      intro: createIntroSnapshot(),
      masterPassword: createMasterPasswordSnapshot(),
      workspace: createWorkspaceSnapshot(),
      runtimeReady: true,
      runtimeError: '',
      budget: createBudgetSnapshot(),
    });

    expect(resolution.state).toBe('ready');
    expect(resolution.screen).toBe('app');
  });
});

describe('startupReducer', () => {
  it('publishes stable state after leaving boot', () => {
    const state = startupReducer(INITIAL_STARTUP_MACHINE_STATE, {
      type: 'RESOLVE',
      resolution: {
        state: 'runtime_initializing',
        screen: 'splash',
        message: 'Starting Budgero…',
      },
    });

    expect(state.stablePublished).toBe(true);
    expect(state.resolution.state).toBe('runtime_initializing');
  });

  it('ignores redundant resolve events', () => {
    const first = startupReducer(INITIAL_STARTUP_MACHINE_STATE, {
      type: 'RESOLVE',
      resolution: INITIAL_STARTUP_RESOLUTION,
    });
    const second = startupReducer(first, {
      type: 'RESOLVE',
      resolution: INITIAL_STARTUP_RESOLUTION,
    });

    expect(second).toBe(first);
  });
});
