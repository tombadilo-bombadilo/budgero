export type StartupState =
  | 'boot'
  | 'auth_required'
  | 'access_blocked'
  | 'intro_required'
  | 'master_password_required'
  | 'runtime_initializing'
  | 'workspace_required'
  | 'budget_required'
  | 'budget_blocked'
  | 'ready'
  | 'error';

export type StartupScreen =
  | 'splash'
  | 'redirect'
  | 'access_blocked'
  | 'intro'
  | 'master_password'
  | 'workspace'
  | 'budget'
  | 'budget_blocked'
  | 'app'
  | 'error';

export interface StartupResolution {
  state: StartupState;
  screen: StartupScreen;
  message?: string;
  detail?: string;
  error?: string;
  branch?: string;
}

export type StartupEvent =
  | {
      type: 'RESOLVE';
      resolution: StartupResolution;
    }
  | {
      type: 'RESET';
    };

export interface StartupMachineState {
  resolution: StartupResolution;
  stablePublished: boolean;
}
