import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
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
// Compared against Error.message thrown in the runtime — locale-stable by design.
const NO_ACCEPTED_SPACES_ERROR = 'No accepted budget spaces available for this account';

function markStartup(name: string) {
  try {
    performance.mark(name);
  } catch {
    /* no-op */
  }
}

export default function StartupController() {
  const { t } = useLingui();

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
  // Runtime initialization replaces/refetches the session query cache. During
  // first-user onboarding that can temporarily make the normal startup
  // resolver move through splash/app states while OnboardingFlow is still
  // importing. Latch the intro screen once it has been entered and release it
  // only when OnboardingFlow explicitly calls its completion callback.
  const [introFlowPinned, setIntroFlowPinned] = useState(false);
  const introCompletionRequestedRef = useRef(false);
  const [syncPhase, setSyncPhase] = useState<'hidden' | 'syncing' | 'warning' | 'complete'>(
    'hidden'
  );
  const [syncMessage, setSyncMessage] = useState('');
  const [machineState, dispatch] = useReducer(startupReducer, INITIAL_STARTUP_MACHINE_STATE);
  const markedRef = useRef<Set<string>>(new Set());
  const postReadyStartedRef = useRef(false);
  const runtimeInitInFlightRef = useRef(false);
  // Intro must be done before bypassing: a brand-new user landing on /join
  // belongs in the onboarding invitee path (which sets up their master
  // password), not on the bare join page.
  const bypassStartupGuards =
    isRecoveryRoute(location.pathname) && auth.status === 'ready' && intro.status === 'ready';

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

  // Self-heal the server master-password flag. A device that reached the app
  // with a working master password proves one is set; if the server still
  // says otherwise (onboarding interrupted before its last step), every new
  // device would land in onboarding instead of the master password prompt.
  const masterPasswordFlagHealedRef = useRef(false);
  useEffect(() => {
    if (resolution.state !== 'ready' || masterPasswordFlagHealedRef.current) return;
    if (auth.canProceedOffline || !auth.user || auth.user.is_master_password_set) return;
    masterPasswordFlagHealedRef.current = true;
    void (async () => {
      try {
        const { authApi } = await import('@shared/api/api-client');
        await authApi.setMasterPasswordStatus(true);
        await queryClient.invalidateQueries({ queryKey: ['profile'] });
      } catch (err) {
        masterPasswordFlagHealedRef.current = false;
        console.warn('[Startup] Failed to mark master password set on server', err);
      }
    })();
  }, [auth.canProceedOffline, auth.user, queryClient, resolution.state]);

  useEffect(() => {
    if (resolution.screen === 'intro' && !introCompletionRequestedRef.current) {
      setIntroFlowPinned(true);
    }
  }, [resolution.screen]);

  const completeIntroFlow = useCallback(() => {
    introCompletionRequestedRef.current = true;
    intro.acknowledgeIntro();
    setIntroFlowPinned(false);
  }, [intro]);

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
        const message = getErrorMessage(error, t`Unknown startup error while initializing.`);

        if (isDecryptionFailure(message)) {
          promptForReentry('Invalid master password - please try again');
          return;
        }

        if (isSecureContextFailure(message)) {
          setRuntimeError(
            t`Your browser blocked the encryption features Budgero needs. Serve Budgero over HTTPS or install a trusted certificate.`
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
    t,
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
      setSyncMessage(t`Finishing initial sync…`);

      try {
        const syncResult = await runtime.waitForInitialSync({ timeoutMs: 20_000 });
        if (cancelled) return;

        if (!syncResult.synced) {
          setSyncPhase('warning');
          setSyncMessage(t`Using local data while sync catches up in the background.`);
          return;
        }

        try {
          const pushResult = await runtime.processPushQueue();
          if (cancelled) return;
          if (pushResult.failed > 0) {
            setSyncPhase('warning');
            setSyncMessage(t`Some queued changes still need retry.`);
            return;
          }
        } catch (error) {
          console.warn('[Startup] Push queue processing failed', error);
          setSyncPhase('warning');
          setSyncMessage(t`Queued changes will retry automatically.`);
          return;
        }

        setSyncPhase('complete');
        setSyncMessage(t`Budgero is fully synchronized.`);
        hideTimer = window.setTimeout(() => {
          setSyncPhase('hidden');
          setSyncMessage('');
        }, 1500);
      } catch (error) {
        console.warn('[Startup] Background sync startup failed', error);
        if (cancelled) return;
        setSyncPhase('warning');
        setSyncMessage(t`Working from local data while sync reconnects.`);
      }
    })();

    return () => {
      cancelled = true;
      if (hideTimer) {
        window.clearTimeout(hideTimer);
      }
    };
  }, [auth.canProceedOffline, resolution.state, runtime, runtimeReady, runtimeState, t]);

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
      toast.success(t`Workspace switched`, {
        description: t`You are now viewing this workspace.`,
      });
    } catch (error) {
      const message = getErrorMessage(error, t`Unable to switch workspace. Please try again.`);
      toast.error(t`Unable to switch workspace`, {
        description: message,
      });
    } finally {
      setSwitchingWorkspaceId(null);
    }
  };

  if (machineState.resolution.state === 'auth_required') {
    return <Navigate to={auth.redirectTo ?? '/auth'} replace />;
  }

  if (bypassStartupGuards && !introFlowPinned) {
    return (
      <>
        {auth.user ? <SpaceInviteRedirect user={auth.user} /> : null}
        <Outlet />
      </>
    );
  }

  let content: React.ReactNode;
  if (introFlowPinned) {
    content = <IntroRequiredScreen acknowledgeIntro={completeIntroFlow} />;
  } else if (introCompletionRequestedRef.current && machineState.resolution.screen === 'intro') {
    // The explicit completion callback releases the pin synchronously. Keep
    // the old intro resolution from remounting a fresh OnboardingFlow during
    // the one render before the startup reducer publishes the ready screen.
    content = <StartupSplashScreen message={msg`Opening your budget…`} />;
  } else {
    switch (machineState.resolution.screen) {
      case 'access_blocked':
        content = <AccessBlockedScreen mode={auth.accessBlockedMode ?? 'subscription-required'} />;
        break;
      case 'intro':
        content = <IntroRequiredScreen acknowledgeIntro={completeIntroFlow} />;
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
