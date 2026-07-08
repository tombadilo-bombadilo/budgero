import type {
  AuthStartupSnapshot,
  BudgetStartupSnapshot,
  IntroStartupSnapshot,
  MasterPasswordStartupSnapshot,
  WorkspaceStartupSnapshot,
} from './hooks';
import type { StartupResolution } from './types';

interface ResolveStartupInput {
  auth: AuthStartupSnapshot;
  intro: IntroStartupSnapshot;
  masterPassword: MasterPasswordStartupSnapshot;
  workspace: WorkspaceStartupSnapshot;
  runtimeReady: boolean;
  runtimeError: string;
  budget: BudgetStartupSnapshot;
}

export function resolveStartupResolution(input: ResolveStartupInput): StartupResolution {
  const { auth, intro, masterPassword, workspace, runtimeReady, runtimeError, budget } = input;

  if (auth.status === 'loading') {
    return {
      state: 'boot',
      screen: 'splash',
      message: 'Preparing your session…',
      detail: 'Checking authentication and connectivity',
      branch: 'auth-loading',
    };
  }

  if (auth.status === 'auth_required') {
    return {
      state: 'auth_required',
      screen: 'redirect',
      message: 'Redirecting to sign in…',
      branch: 'auth-required',
    };
  }

  if (auth.status === 'access_blocked') {
    return {
      state: 'access_blocked',
      screen: 'access_blocked',
      detail: auth.accessBlockedMode,
      branch: 'access-blocked',
    };
  }

  if (auth.status === 'error') {
    return {
      state: 'error',
      screen: 'error',
      error: auth.error ?? 'Unable to verify your session.',
      branch: 'auth-error',
    };
  }

  if (intro.status === 'intro_required') {
    return {
      state: 'intro_required',
      screen: 'intro',
      branch: 'intro-required',
    };
  }

  if (masterPassword.status === 'loading') {
    return {
      state: 'boot',
      screen: 'splash',
      message: 'Checking your encryption key…',
      detail: 'Preparing your secure workspace',
      branch: 'master-password-loading',
    };
  }

  if (masterPassword.status === 'required') {
    return {
      state: 'master_password_required',
      screen: 'master_password',
      branch: 'master-password-required',
    };
  }

  if (workspace.status === 'loading') {
    return {
      state: 'boot',
      screen: 'splash',
      message: 'Checking your workspaces…',
      detail: 'Loading accessible workspaces',
      branch: 'workspace-loading',
    };
  }

  if (workspace.status === 'required' || workspace.status === 'error') {
    return {
      state: 'workspace_required',
      screen: 'workspace',
      branch: workspace.status === 'error' ? 'workspace-error' : 'workspace-required',
    };
  }

  if (runtimeError) {
    return {
      state: 'error',
      screen: 'error',
      error: runtimeError,
      branch: 'runtime-error',
    };
  }

  if (!runtimeReady) {
    return {
      state: 'runtime_initializing',
      screen: 'splash',
      message: 'Starting Budgero…',
      detail: 'Opening your local workspace',
      branch: 'runtime-initializing',
    };
  }

  if (budget.status === 'loading') {
    return {
      state: 'runtime_initializing',
      screen: 'splash',
      message: 'Loading budgets…',
      detail: 'Selecting your default budget',
      branch: 'budget-loading',
    };
  }

  if (budget.status === 'required') {
    return {
      state: 'budget_required',
      screen: 'budget',
      branch: 'budget-required',
    };
  }

  if (budget.status === 'blocked') {
    return {
      state: 'budget_blocked',
      screen: 'budget_blocked',
      branch: 'budget-blocked',
    };
  }

  return {
    state: 'ready',
    screen: 'app',
    branch: 'ready',
  };
}
