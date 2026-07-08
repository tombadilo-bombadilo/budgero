import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import SpaceInviteRedirect from '@features/budget-sharing/ui/SpaceInviteRedirect';
import { MasterPasswordManager } from '@shared/lib/crypto';
import { getErrorMessage } from '@shared/lib/errors';
import { useRuntime, useRuntimeState } from '@shared/runtime/runtime-provider';
import {
  getBudgetsQueryOptions,
  switchWorkspaceAndSyncBudgetState,
  syncBudgetStateFromRuntime,
} from '@shared/runtime/budget-gate';
import { BUDGET_SPACES_QUERY_KEY } from '@features/budget-sharing/lib/workspaces/queries';
import { toast } from 'sonner';
import BackupReminderManager from './BackupReminderManager';
import { isDecryptionFailure, isRecoveryRoute, isSecureContextFailure } from './policy';
import { hideStartupPreload } from './preload';
import { startupReducer, INITIAL_STARTUP_MACHINE_STATE } from './reducer';
import { resolveStartupResolution } from './resolve';
import {
  useAuthStartupSnapshot,
  useBudgetStartupSnapshot,
  useIntroStartupSnapshot,
  useMasterPasswordStartupSnapshot,
  useWorkspaceStartupSnapshot,
} from './hooks';
import { useAnalyticsIdentity } from './useAnalyticsIdentity';
import {
  AccessBlockedScreen,
  BudgetBlockedScreen,
  BudgetRequiredScreen,
  IntroRequiredScreen,
  MasterPasswordRequiredScreen,
  StartupErrorScreen,
  StartupSplashScreen,
  StartupSyncStatus,
  WorkspaceRequiredScreen,
} from './screens';

const RUNTIME_READY_STATES = new Set(['Ready', 'Degraded', 'Reconnecting']);
const NO_ACCEPTED_SPACES_ERROR = 'No accepted budget spaces available for this account';

function markStartup(name: string) {
  try {
    performance.mark(name);
  } catch {
    /* no-op */
  }
}

export default function StartupController() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const runtime = useRuntime();
  const runtimeState = useRuntimeState();
  const [servicesReady, setServicesReady] = useState(
    () => runtime.isInitialized() && runtime.servicesReady()
  );
  const auth = useAuthStartupSnapshot();
  useAnalyticsIdentity(auth);
  const intro = useIntroStartupSnapshot(auth.status === 'ready', auth.user);
  const masterPassword = useMasterPasswordStartupSnapshot(
    auth.status === 'ready' && intro.status === 'ready',
    auth.user
  );
  const workspace = useWorkspaceStartupSnapshot(
    auth.status === 'ready' && intro.status === 'ready' && masterPassword.status === 'ready',
    auth.accessStatus,
    auth.canProceedOffline
  );
  const runtimeReady = RUNTIME_READY_STATES.has(runtimeState) && servicesReady;
  const budget = useBudgetStartupSnapshot(runtimeReady, workspace.accessibleSpaces);
  const { promptForReentry } = masterPassword;
  const [runtimeError, setRuntimeError] = useState('');
  const [runtimeRetryToken, setRuntimeRetryToken] = useState(0);
  const [switchingWorkspaceId, setSwitchingWorkspaceId] = useState<string | null>(null);
  const [syncPhase, setSyncPhase] = useState<'hidden' | 'syncing' | 'warning' | 'complete'>(
    'hidden'
  );
  const [syncMessage, setSyncMessage] = useState('');
  const [machineState, dispatch] = useReducer(startupReducer, INITIAL_STARTUP_MACHINE_STATE);
  const markedRef = useRef<Set<string>>(new Set());
  const postReadyStartedRef = useRef(false);
  const runtimeInitInFlightRef = useRef(false);
  const bypassStartupGuards = isRecoveryRoute(location.pathname) && auth.status === 'ready';

  const resolution = useMemo(
    () =>
      resolveStartupResolution({
        auth,
        intro,
        masterPassword,
        workspace,
        runtimeReady,
        runtimeError,
        budget,
      }),
    [auth, budget, intro, masterPassword, runtimeError, runtimeReady, workspace]
  );

  useEffect(() => {
    dispatch({ type: 'RESOLVE', resolution });
  }, [resolution]);

  useEffect(() => {
    if (machineState.stablePublished) {
      hideStartupPreload();
    }
  }, [machineState.stablePublished]);

  useEffect(() => {
    const markers: [boolean, string][] = [
      [auth.status === 'ready', 'auth_resolved'],
      [masterPassword.status === 'ready', 'master_password_resolved'],
      [runtimeReady, 'runtime_ready'],
      [workspace.status === 'ready', 'workspace_resolved'],
      [budget.status === 'ready', 'budget_resolved'],
      [resolution.state === 'ready', 'app_ready'],
    ];
    markers.forEach(([shouldMark, marker]) => {
      if (!shouldMark || markedRef.current.has(marker)) return;
      markedRef.current.add(marker);
      markStartup(marker);
    });
  }, [
    auth.status,
    budget.status,
    masterPassword.status,
    resolution.state,
    runtimeReady,
    workspace.status,
  ]);

  useEffect(() => {
    const canInitializeRuntime =
      auth.status === 'ready' &&
      !bypassStartupGuards &&
      intro.status === 'ready' &&
      masterPassword.status === 'ready' &&
      workspace.status === 'ready';

    if (!canInitializeRuntime || runtimeReady || runtimeInitInFlightRef.current) return;
    // Read state from the runtime directly rather than the React snapshot, and
    // do not subscribe this effect to runtimeState — that would re-fire init()
    // while the runtime is still in Error, producing an
    // Idle↔Initializing↔Error loop on wrong passwords.
    const liveRuntimeState = runtime.state();
    if (liveRuntimeState === 'SwitchingSpace' || liveRuntimeState === 'Initializing') return;
    if (runtime.isInitialized() && runtime.servicesReady()) {
      setServicesReady(true);
      return;
    }

    // NOTE: no `cancelled` teardown flag here, on purpose. runtime.init()
    // clears the query cache mid-flight (session.replace), which flips the
    // profile/spaces queries back to loading — auth.status/workspace.status
    // are deps of this effect, so it re-runs and would cancel the in-flight
    // run. The re-runs skip themselves (initInFlight), so nothing would ever
    // call setServicesReady(true) again → permanent startup splash. The
    // runtime is a deduped singleton, so completing the state updates from a
    // superseded effect run is always correct.
    runtimeInitInFlightRef.current = true;
    setRuntimeError('');
    setServicesReady(false);

    void (async () => {
      try {
        const masterPasswordValue = await MasterPasswordManager.get();
        if (!masterPasswordValue) {
          promptForReentry('Master password is required to open your data.');
          return;
        }

        await runtime.init({ masterPassword: masterPasswordValue, queryClient });
        const activeSpaceId = runtime.getActiveSpaceId();
        if (activeSpaceId) {
          await queryClient.ensureQueryData(getBudgetsQueryOptions(runtime, activeSpaceId));
          syncBudgetStateFromRuntime({
            runtime,
            queryClient,
            spaceId: activeSpaceId,
            candidateSelectedBudget: null,
          });
        } else {
          const fallbackSpaceId = workspace.accessibleSpaces[0]?.space_id;
          if (fallbackSpaceId) {
            await switchWorkspaceAndSyncBudgetState({
              runtime,
              queryClient,
              spaceId: fallbackSpaceId,
            });
          }
        }
        setServicesReady(true);
      } catch (error) {
        const message = getErrorMessage(error, 'Unknown startup error while initializing.');

        if (isDecryptionFailure(message)) {
          promptForReentry('Invalid master password - please try again');
          return;
        }

        if (isSecureContextFailure(message)) {
          setRuntimeError(
            'Your browser blocked the encryption features Budgero needs. Serve Budgero over HTTPS or install a trusted certificate.'
          );
          return;
        }

        if (message === NO_ACCEPTED_SPACES_ERROR) {
          // Returns WITHOUT setting an error or retrying — if the spaces
          // refetch yields the same result, the effect never re-runs and the
          // splash sits on 'runtime-initializing'. Warn so the dead-end is at
          // least visible in the console.
          console.warn('[Startup] No accepted spaces during init; refetching space list');
          await queryClient.invalidateQueries({ queryKey: BUDGET_SPACES_QUERY_KEY });
          return;
        }

        setRuntimeError(message);
      } finally {
        runtimeInitInFlightRef.current = false;
      }
    })();
  }, [
    auth.status,
    intro.status,
    masterPassword.status,
    promptForReentry,
    queryClient,
    runtime,
    runtimeReady,
    runtimeRetryToken,
    workspace.accessibleSpaces,
    workspace.status,
    bypassStartupGuards,
  ]);

  useEffect(() => {
    if (resolution.state !== 'ready' || postReadyStartedRef.current) return;
    if (!runtimeReady) return;
    if (auth.canProceedOffline) return;
    if (RUNTIME_READY_STATES.has(runtimeState) === false) return;

    postReadyStartedRef.current = true;
    let cancelled = false;
    let hideTimer: number | undefined;

    void (async () => {
      const connectivity = runtime.connectivityState();
      if (!connectivity.overall && !connectivity.apiReachable) {
        return;
      }

      setSyncPhase('syncing');
      setSyncMessage('Finishing initial sync…');

      try {
        const syncResult = await runtime.waitForInitialSync({ timeoutMs: 20_000 });
        if (cancelled) return;

        if (!syncResult.synced) {
          setSyncPhase('warning');
          setSyncMessage('Using local data while sync catches up in the background.');
          return;
        }

        try {
          const pushResult = await runtime.processPushQueue();
          if (cancelled) return;
          if (pushResult.failed > 0) {
            setSyncPhase('warning');
            setSyncMessage('Some queued changes still need retry.');
            return;
          }
        } catch (error) {
          console.warn('[Startup] Push queue processing failed', error);
          setSyncPhase('warning');
          setSyncMessage('Queued changes will retry automatically.');
          return;
        }

        setSyncPhase('complete');
        setSyncMessage('Budgero is fully synchronized.');
        hideTimer = window.setTimeout(() => {
          setSyncPhase('hidden');
          setSyncMessage('');
        }, 1500);
      } catch (error) {
        console.warn('[Startup] Background sync startup failed', error);
        if (cancelled) return;
        setSyncPhase('warning');
        setSyncMessage('Working from local data while sync reconnects.');
      }
    })();

    return () => {
      cancelled = true;
      if (hideTimer) {
        window.clearTimeout(hideTimer);
      }
    };
  }, [auth.canProceedOffline, resolution.state, runtime, runtimeReady, runtimeState]);

  const handleRetry = () => {
    setRuntimeError('');
    setServicesReady(runtime.isInitialized() && runtime.servicesReady());
    setSwitchingWorkspaceId(null);
    postReadyStartedRef.current = false;
    setSyncPhase('hidden');
    setSyncMessage('');
    setRuntimeRetryToken((current) => current + 1);
  };

  const handleSwitchWorkspace = async (spaceId: string) => {
    if (!spaceId || spaceId === switchingWorkspaceId) return;
    try {
      setSwitchingWorkspaceId(spaceId);
      await switchWorkspaceAndSyncBudgetState({
        runtime,
        queryClient,
        spaceId,
      });
      toast.success('Workspace switched', {
        description: 'You are now viewing this workspace.',
      });
    } catch (error) {
      const message = getErrorMessage(error, 'Unable to switch workspace. Please try again.');
      toast.error('Unable to switch workspace', {
        description: message,
      });
    } finally {
      setSwitchingWorkspaceId(null);
    }
  };

  if (machineState.resolution.state === 'auth_required') {
    return <Navigate to={auth.redirectTo ?? '/auth'} replace />;
  }

  if (bypassStartupGuards) {
    return (
      <>
        {auth.user ? <SpaceInviteRedirect user={auth.user} /> : null}
        <Outlet />
      </>
    );
  }

  let content: React.ReactNode;
  switch (machineState.resolution.screen) {
    case 'access_blocked':
      content = <AccessBlockedScreen mode={auth.accessBlockedMode ?? 'subscription-required'} />;
      break;
    case 'intro':
      content = <IntroRequiredScreen acknowledgeIntro={intro.acknowledgeIntro} />;
      break;
    case 'master_password':
      content = <MasterPasswordRequiredScreen snapshot={masterPassword} />;
      break;
    case 'workspace':
      content = (
        <WorkspaceRequiredScreen
          snapshot={workspace}
          profile={auth.user}
          accessStatus={auth.accessStatus}
        />
      );
      break;
    case 'budget':
      content = (
        <BudgetRequiredScreen
          alternativeWorkspaces={budget.alternativeWorkspaces}
          switchingWorkspaceId={switchingWorkspaceId}
          onSwitchWorkspace={(spaceId) => {
            void handleSwitchWorkspace(spaceId);
          }}
        />
      );
      break;
    case 'budget_blocked':
      content = (
        <BudgetBlockedScreen
          alternativeWorkspaces={budget.alternativeWorkspaces}
          switchingWorkspaceId={switchingWorkspaceId}
          onSwitchWorkspace={(spaceId) => {
            void handleSwitchWorkspace(spaceId);
          }}
        />
      );
      break;
    case 'error':
      content = (
        <StartupErrorScreen
          error={machineState.resolution.error ?? 'Startup failed unexpectedly.'}
          onRetry={handleRetry}
        />
      );
      break;
    case 'app':
      content = <Outlet />;
      break;
    case 'splash':
    default:
      content = (
        <StartupSplashScreen
          message={machineState.resolution.message}
          detail={machineState.resolution.detail}
        />
      );
      break;
  }

  return (
    <>
      {auth.user ? <SpaceInviteRedirect user={auth.user} /> : null}
      {content}
      {machineState.resolution.state === 'ready' ? (
        <>
          <BackupReminderManager />
          <StartupSyncStatus phase={syncPhase} message={syncMessage} />
        </>
      ) : null}
    </>
  );
}
