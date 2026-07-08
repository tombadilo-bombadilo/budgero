import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useAuth as useClerkAuth } from '@clerk/clerk-react';
import { useConnectivity } from '@shared/hooks/useConnectivity';
import { ApiError } from '@shared/hooks/useApiClient';
import { useOptionalClerkAuth, useProfile } from '@entities/user/api/useAuth';
import { useSelfHostAuth } from '@shared/model/useSelfHostAuth';
import { getConnectivityService } from '@shared/runtime/connectivity-service';
import { offlineApi } from '@shared/api/api-client';
import { getBudgetSpacesQueryOptions } from '@features/budget-sharing/lib/workspaces/queries';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { buildAuthRedirect } from '@shared/lib/auth-redirect';
import { getErrorMessage } from '@shared/lib/errors';
import { MasterPasswordManager } from '@shared/lib/crypto';
import {
  readIntroAcknowledged,
  writeIntroAcknowledged,
} from '@features/onboarding/lib/onboarding-intro';
import { PASSWORD_CHANGED_REASON_KEY } from '@budgero/runtime';
import { useBudgets } from '@entities/budget/api/useBudgets';
import { useUiStore } from '@shared/store/useUiStore';
import {
  useActiveSpace,
  useActiveSpaceId,
  useAvailableSpaces,
  useRuntime,
} from '@shared/runtime/runtime-provider';
import { budgetsEqual, resolveBudgetGate } from '@shared/runtime/budget-gate';
import {
  canAccessApp,
  canCreateWorkspace,
  getUserAccessStatus,
  hasLockedSharedWorkspace,
  type AccessStatus,
} from '@shared/model/access';
import type { User } from '@shared/model/auth';
import type { BudgetSpaceSummary } from '@shared/model/budget-spaces';
import {
  getStoredDefaultBudgetId,
  clearStoredDefaultBudgetId,
} from '@shared/runtime/workspace-preferences';
import { handleAccountReset } from '@/app/service-guard/service-guard.utils';
import { isRecoveryRoute } from './policy';

import {
  OFFLINE_BOOT_GRACE_MS,
  OFFLINE_JWK_KEY,
  OFFLINE_ENTITLEMENT_KEY,
  ConnectivityMode,
  Jwk,
  readJSON,
  claimsGrantAccess,
  snapshotOnline,
  loadCachedSpaces,
  verifyOfflineEntitlement,
  isSetupOnlineSnapshot,
} from './offline-entitlement';

let cachedGateSnapshot: {
  resolved: boolean;
  isOffline: boolean;
  needsPassword: boolean;
  isFirstTimeSetup: boolean;
  profileId: string | null;
} | null = null;
let cachedInputs = { input: '', confirm: '' };

export interface AuthStartupSnapshot {
  status: 'loading' | 'auth_required' | 'access_blocked' | 'ready' | 'error';
  user: User | undefined;
  accessStatus: AccessStatus | null;
  canProceedOffline: boolean;
  accessBlockedMode?: 'shared-locked' | 'subscription-required';
  error?: string;
  redirectTo?: string;
}

export interface IntroStartupSnapshot {
  status: 'ready' | 'intro_required';
  acknowledgeIntro: () => void;
}

export interface MasterPasswordStartupSnapshot {
  status: 'loading' | 'required' | 'ready';
  isOffline: boolean;
  isFirstTimeSetup: boolean;
  inputPassword: string;
  setInputPassword: (value: string) => void;
  confirmPassword: string;
  setConfirmPassword: (value: string) => void;
  error: string;
  setError: (value: string) => void;
  submit: () => Promise<void>;
  promptForReentry: (message?: string) => void;
  showResetDialog: boolean;
  setShowResetDialog: (value: boolean) => void;
  resetConfirmation: string;
  setResetConfirmation: (value: string) => void;
  confirmReset: () => Promise<void>;
  isResetting: boolean;
  resetError: string | null;
  passwordChangedRemotely: boolean;
}

export interface WorkspaceStartupSnapshot {
  status: 'loading' | 'required' | 'ready' | 'error';
  spacesQuery: UseQueryResult<BudgetSpaceSummary[]>;
  accessibleSpaces: BudgetSpaceSummary[];
  allowWorkspaceCreation: boolean;
  error?: string;
}

export interface BudgetStartupSnapshot {
  status: 'loading' | 'required' | 'blocked' | 'ready';
  canManageBudgets: boolean;
  alternativeWorkspaces: BudgetSpaceSummary[];
}

export function useAuthStartupSnapshot(): AuthStartupSnapshot {
  const location = useLocation();
  const profileQuery = useProfile();
  const user = profileQuery.data;
  const { error } = profileQuery;
  const { isLoading } = profileQuery;
  const { isError } = profileQuery;
  const clerkAuth = useOptionalClerkAuth() as ReturnType<typeof useClerkAuth> | null;
  const isLoaded = clerkAuth?.isLoaded ?? true;
  const isSignedIn = clerkAuth?.isSignedIn ?? false;
  const selfHostToken = useSelfHostAuth((state) => state.token);
  const clearSelfHostSession = useSelfHostAuth((state) => state.clearSession);
  const [offlineAllowed, setOfflineAllowed] = useState<boolean | null>(IS_SELF_HOSTABLE_BUILD);
  const [connectivity, setConnectivity] = useState<ConnectivityMode>('unknown');
  const [authLoadTimeout, setAuthLoadTimeout] = useState(false);
  const tokenInvalidRef = useRef(false);
  const sessionExpired =
    error instanceof ApiError && (error.status === 401 || error.status === 403);

  // The connectivity probe itself is started app-wide by RuntimeProvider;
  // this only samples its snapshot on an interval.
  useEffect(() => {
    let cancelled = false;
    const update = () => {
      if (cancelled) return;
      setConnectivity(snapshotOnline() ? 'online' : 'offline');
    };
    update();
    const interval = window.setInterval(update, OFFLINE_BOOT_GRACE_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (IS_SELF_HOSTABLE_BUILD) return;
    let cancelled = false;
    void (async () => {
      try {
        const jwk = readJSON<Jwk>(OFFLINE_JWK_KEY);
        const token = localStorage.getItem(OFFLINE_ENTITLEMENT_KEY);
        if (!jwk || !token) {
          if (!cancelled) setOfflineAllowed(false);
          return;
        }
        const claims = await verifyOfflineEntitlement(token, jwk);
        if (!cancelled) {
          setOfflineAllowed(Boolean(claims && claimsGrantAccess(claims)));
        }
      } catch {
        if (!cancelled) setOfflineAllowed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (IS_SELF_HOSTABLE_BUILD) return;
    const timer = window.setTimeout(() => setAuthLoadTimeout(true), 1500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (
      IS_SELF_HOSTABLE_BUILD ||
      !isError ||
      !error ||
      !clerkAuth?.signOut ||
      tokenInvalidRef.current
    ) {
      return;
    }
    if (sessionExpired) {
      tokenInvalidRef.current = true;
      void clerkAuth.signOut().catch((err) => {
        console.warn('[Startup] Failed to sign out after auth error', err);
      });
    }
  }, [clerkAuth, error, isError, sessionExpired]);

  useEffect(() => {
    if (IS_SELF_HOSTABLE_BUILD || !user) return;
    void (async () => {
      try {
        const [jwk, entitlement] = await Promise.all([
          offlineApi.getPubKey(),
          offlineApi.issueEntitlement(),
        ]);
        localStorage.setItem(OFFLINE_JWK_KEY, JSON.stringify(jwk));
        localStorage.setItem(OFFLINE_ENTITLEMENT_KEY, entitlement.token);
      } catch {
        /* no-op */
      }
    })();
  }, [user]);

  useEffect(() => {
    if (!IS_SELF_HOSTABLE_BUILD || !isError) return;
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      clearSelfHostSession();
    }
  }, [clearSelfHostSession, error, isError]);

  if (IS_SELF_HOSTABLE_BUILD) {
    if (!selfHostToken) {
      return {
        status: 'auth_required',
        user,
        accessStatus: null,
        canProceedOffline: false,
        redirectTo: buildAuthRedirect(location),
      };
    }

    if (connectivity === 'unknown') {
      return {
        status: 'loading',
        user,
        accessStatus: null,
        canProceedOffline: false,
      };
    }

    if (
      connectivity === 'offline' ||
      (typeof navigator !== 'undefined' && navigator.onLine === false)
    ) {
      return {
        status: 'ready',
        user,
        accessStatus: null,
        canProceedOffline: true,
      };
    }

    if (isLoading) {
      return {
        status: 'loading',
        user,
        accessStatus: null,
        canProceedOffline: false,
      };
    }

    if (isError) {
      const connectivityState = getConnectivityService().getState();
      if (sessionExpired) {
        return {
          status: 'auth_required',
          user,
          accessStatus: null,
          canProceedOffline: false,
          redirectTo: buildAuthRedirect(location),
        };
      }
      if (connectivityState.lastChecked > 0 && !connectivityState.apiReachable) {
        return {
          status: 'ready',
          user,
          accessStatus: null,
          canProceedOffline: true,
        };
      }
      return {
        status: 'error',
        user,
        accessStatus: null,
        canProceedOffline: false,
        error: getErrorMessage(error, 'Failed to load profile.'),
      };
    }

    return {
      status: 'ready',
      user,
      accessStatus: null,
      canProceedOffline: false,
    };
  }

  const canProceedOffline =
    offlineAllowed === true &&
    (connectivity === 'offline' ||
      (typeof navigator !== 'undefined' && navigator.onLine === false));

  if (sessionExpired && isSignedIn) {
    return {
      status: 'loading',
      user,
      accessStatus: null,
      canProceedOffline: false,
    };
  }

  if (canProceedOffline) {
    return {
      status: 'ready',
      user,
      accessStatus: user ? getUserAccessStatus(user) : null,
      canProceedOffline: true,
    };
  }

  if (!isLoaded) {
    if (authLoadTimeout && !snapshotOnline()) {
      return {
        status: 'error',
        user,
        accessStatus: null,
        canProceedOffline: false,
        error: "You're offline. Reconnect to verify your session.",
      };
    }
    return {
      status: 'loading',
      user,
      accessStatus: null,
      canProceedOffline: false,
    };
  }

  if (!isSignedIn) {
    return {
      status: 'auth_required',
      user,
      accessStatus: null,
      canProceedOffline: false,
      redirectTo: buildAuthRedirect(location, { mode: 'signin' }),
    };
  }

  if (isLoading) {
    return {
      status: 'loading',
      user,
      accessStatus: null,
      canProceedOffline: false,
    };
  }

  if (isError || !user) {
    const state = getConnectivityService().getState();
    const networkIssue = state.lastChecked > 0 && !state.apiReachable;
    if (offlineAllowed === true && networkIssue) {
      return {
        status: 'ready',
        user,
        accessStatus: null,
        canProceedOffline: true,
      };
    }
    return {
      status: 'error',
      user,
      accessStatus: null,
      canProceedOffline: false,
      error:
        networkIssue && !offlineAllowed
          ? "You're offline. Reconnect to verify your session."
          : getErrorMessage(error, 'Unable to load user profile.'),
    };
  }

  const accessStatus = getUserAccessStatus(user);
  if (!canAccessApp(accessStatus) && !isRecoveryRoute(location.pathname)) {
    return {
      status: 'access_blocked',
      user,
      accessStatus,
      canProceedOffline: false,
      accessBlockedMode: hasLockedSharedWorkspace(accessStatus)
        ? 'shared-locked'
        : 'subscription-required',
    };
  }

  return {
    status: 'ready',
    user,
    accessStatus,
    canProceedOffline: false,
  };
}

export function useIntroStartupSnapshot(
  enabled: boolean,
  profile: User | undefined
): IntroStartupSnapshot {
  const profileId = profile?.id ?? null;
  const introSessionKey = `${enabled ? 'enabled' : 'disabled'}:${profileId ?? 'anon'}`;
  const [acknowledgedSessionKey, setAcknowledgedSessionKey] = useState<string | null>(null);

  const introAcknowledged = useMemo(() => {
    if (!enabled) {
      return true;
    }
    return acknowledgedSessionKey === introSessionKey || readIntroAcknowledged(profileId);
  }, [acknowledgedSessionKey, enabled, introSessionKey, profileId]);

  const hasLocalMasterPassword = useMemo(() => {
    try {
      return MasterPasswordManager.hasPassword();
    } catch {
      return false;
    }
  }, []);

  const acknowledgeIntro = useCallback(() => {
    writeIntroAcknowledged(profileId);
    setAcknowledgedSessionKey(introSessionKey);
  }, [introSessionKey, profileId]);

  if (
    enabled &&
    !hasLocalMasterPassword &&
    !introAcknowledged &&
    !profile?.is_master_password_set
  ) {
    return {
      status: 'intro_required',
      acknowledgeIntro,
    };
  }

  return {
    status: 'ready',
    acknowledgeIntro,
  };
}

export function useMasterPasswordStartupSnapshot(
  enabled: boolean,
  profile: User | undefined
): MasterPasswordStartupSnapshot {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const connectivity = useConnectivity();
  const setupConnectivity = useMemo(
    () => ({
      apiReachable: connectivity.apiReachable,
      clerkToken: connectivity.clerkToken,
      lastChecked: connectivity.lastChecked,
      selfHostable: connectivity.selfHostable,
    }),
    [
      connectivity.apiReachable,
      connectivity.clerkToken,
      connectivity.lastChecked,
      connectivity.selfHostable,
    ]
  );
  const [status, setStatus] = useState<'loading' | 'required' | 'ready'>(
    enabled && !cachedGateSnapshot
      ? 'loading'
      : cachedGateSnapshot?.needsPassword
        ? 'required'
        : 'ready'
  );
  const [isOffline, setIsOffline] = useState(cachedGateSnapshot?.isOffline ?? false);
  const [isFirstTimeSetup, setIsFirstTimeSetup] = useState(
    cachedGateSnapshot?.isFirstTimeSetup ?? false
  );
  const [inputPassword, setInputPasswordState] = useState(cachedInputs.input);
  const [confirmPassword, setConfirmPasswordState] = useState(cachedInputs.confirm);
  const [error, setError] = useState('');
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const gateResolvedRef = useRef(Boolean(cachedGateSnapshot?.resolved));
  const gateAttemptRef = useRef(0);
  const prevProfileIdRef = useRef<string | null>(cachedGateSnapshot?.profileId ?? null);
  const [passwordChangedRemotely] = useState(() => {
    try {
      return localStorage.getItem(PASSWORD_CHANGED_REASON_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!passwordChangedRemotely) return;
    try {
      localStorage.removeItem(PASSWORD_CHANGED_REASON_KEY);
    } catch {
      /* no-op */
    }
  }, [passwordChangedRemotely]);

  useEffect(() => {
    if (!enabled) return;
    const currentProfileId = profile?.id ?? null;
    if (prevProfileIdRef.current === currentProfileId) return;

    prevProfileIdRef.current = currentProfileId;
    gateResolvedRef.current = false;
    cachedGateSnapshot = null;
    cachedInputs = { input: '', confirm: '' };
    setStatus('loading');
    setIsOffline(false);
    setIsFirstTimeSetup(false);
    setInputPasswordState('');
    setConfirmPasswordState('');
    setError('');
  }, [enabled, profile?.id]);

  useEffect(() => {
    if (!enabled) {
      setStatus('ready');
      return;
    }
    if (gateResolvedRef.current) return;
    if (!setupConnectivity.lastChecked) {
      setStatus('loading');
      return;
    }

    let cancelled = false;
    const attempt = gateAttemptRef.current + 1;
    gateAttemptRef.current = attempt;
    setStatus('loading');

    void (async () => {
      try {
        const [onlineForSetup, cachedKey] = await Promise.all([
          isSetupOnlineSnapshot(setupConnectivity),
          (async () => {
            const timeoutPromise = new Promise<null>((_, reject) => {
              window.setTimeout(() => reject(new Error('mpw-get-timeout')), 1500);
            });
            try {
              return (await Promise.race([MasterPasswordManager.get(), timeoutPromise])) as
                | string
                | null;
            } catch {
              return null;
            }
          })(),
        ]);

        if (cancelled || attempt !== gateAttemptRef.current) return;

        const snapshotProfileId = profile?.id ?? null;
        if (cachedKey) {
          cachedGateSnapshot = {
            resolved: true,
            isOffline: false,
            needsPassword: false,
            isFirstTimeSetup: false,
            profileId: snapshotProfileId,
          };
          setStatus('ready');
          setIsOffline(false);
          setIsFirstTimeSetup(false);
          setError('');
          gateResolvedRef.current = true;
          return;
        }

        let hasLocalState = false;
        try {
          hasLocalState = MasterPasswordManager.hasPassword();
        } catch {
          hasLocalState = false;
        }

        if (!onlineForSetup) {
          cachedGateSnapshot = {
            resolved: true,
            isOffline: true,
            needsPassword: true,
            isFirstTimeSetup: false,
            profileId: snapshotProfileId,
          };
          setIsOffline(true);
          setIsFirstTimeSetup(false);
          setStatus('required');
          gateResolvedRef.current = true;
          return;
        }

        if (hasLocalState || profile?.is_master_password_set) {
          cachedGateSnapshot = {
            resolved: true,
            isOffline: false,
            needsPassword: true,
            isFirstTimeSetup: false,
            profileId: snapshotProfileId,
          };
          setIsOffline(false);
          setIsFirstTimeSetup(false);
          setStatus('required');
          gateResolvedRef.current = true;
          return;
        }

        cachedGateSnapshot = {
          resolved: true,
          isOffline: false,
          needsPassword: true,
          isFirstTimeSetup: true,
          profileId: snapshotProfileId,
        };
        setIsOffline(false);
        setIsFirstTimeSetup(true);
        setStatus('required');
        gateResolvedRef.current = true;
      } finally {
        if (
          !cancelled &&
          attempt === gateAttemptRef.current &&
          cachedGateSnapshot &&
          !cachedGateSnapshot.needsPassword
        ) {
          setStatus('ready');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, setupConnectivity, profile?.id, profile?.is_master_password_set]);

  const setInputPassword = useCallback((value: string) => {
    cachedInputs.input = value;
    setInputPasswordState(value);
  }, []);

  const setConfirmPassword = useCallback((value: string) => {
    cachedInputs.confirm = value;
    setConfirmPasswordState(value);
  }, []);

  const promptForReentry = useCallback(
    (message?: string) => {
      MasterPasswordManager.clearSessionOnly();
      cachedGateSnapshot = {
        resolved: true,
        isOffline,
        needsPassword: true,
        isFirstTimeSetup: false,
        profileId: profile?.id ?? null,
      };
      gateResolvedRef.current = true;
      setIsFirstTimeSetup(false);
      setStatus('required');
      setError(message ?? '');
    },
    [isOffline, profile?.id]
  );

  const submit = useCallback(async () => {
    setError('');

    if (!inputPassword.trim()) {
      setError('Master password is required');
      return;
    }

    if (!isOffline && isFirstTimeSetup) {
      if (!confirmPassword.trim()) {
        setError('Please confirm your master password');
        return;
      }
      if (inputPassword !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
      if (inputPassword.length < 12) {
        setError('Master password must be at least 12 characters long');
        return;
      }
      if (!/[A-Z]/.test(inputPassword)) {
        setError('Master password must contain at least one uppercase letter');
        return;
      }
      if (!/[a-z]/.test(inputPassword)) {
        setError('Master password must contain at least one lowercase letter');
        return;
      }
      if (!/\d/.test(inputPassword)) {
        setError('Master password must contain at least one number');
        return;
      }
      if (!/[^A-Za-z0-9]/.test(inputPassword)) {
        setError('Master password must contain at least one special character');
        return;
      }
    }

    const hasLocalState = (() => {
      try {
        return MasterPasswordManager.hasPassword();
      } catch {
        return false;
      }
    })();

    if (!isFirstTimeSetup && hasLocalState && MasterPasswordManager.canVerifyLocally()) {
      const valid = await MasterPasswordManager.verify(inputPassword);
      if (!valid) {
        setError('Invalid master password - please try again');
        return;
      }
    }

    try {
      await MasterPasswordManager.store(inputPassword);
      cachedGateSnapshot = {
        resolved: true,
        isOffline,
        needsPassword: false,
        isFirstTimeSetup,
        profileId: profile?.id ?? null,
      };
      if (!isOffline && isFirstTimeSetup) {
        const { authApi } = await import('@shared/api/api-client');
        await authApi.setMasterPasswordStatus(true);
      }
      setStatus('ready');
      setError('');
    } catch (submissionError) {
      const message = String(getErrorMessage(submissionError, ''));
      setError(
        message.toLowerCase().includes('invalid master password')
          ? 'Invalid master password - please try again'
          : 'Failed to store master password'
      );
    }
  }, [confirmPassword, inputPassword, isFirstTimeSetup, isOffline, profile?.id]);

  const confirmReset = useCallback(async () => {
    setShowResetDialog(false);
    setResetConfirmation('');
    setResetError(null);
    setIsResetting(true);

    try {
      await handleAccountReset(runtime, queryClient);
    } catch (resetErr) {
      setResetError(getErrorMessage(resetErr, 'Failed to reset Budgero.'));
      setIsResetting(false);
    }
  }, [queryClient, runtime]);

  return {
    status,
    isOffline,
    isFirstTimeSetup,
    inputPassword,
    setInputPassword,
    confirmPassword,
    setConfirmPassword,
    error,
    setError,
    submit,
    promptForReentry,
    showResetDialog,
    setShowResetDialog,
    resetConfirmation,
    setResetConfirmation,
    confirmReset,
    isResetting,
    resetError,
    passwordChangedRemotely,
  };
}

export function useWorkspaceStartupSnapshot(
  enabled: boolean,
  accessStatus: AccessStatus | null,
  canProceedOffline: boolean
): WorkspaceStartupSnapshot {
  const cachedSpaces = useMemo(() => loadCachedSpaces(), []);
  const accessibleCachedSpaces = useMemo(
    () =>
      cachedSpaces.filter(
        (space) => space.invitation_status === 'accepted' && space.is_accessible !== false
      ),
    [cachedSpaces]
  );

  const spacesQuery = useQuery({
    ...getBudgetSpacesQueryOptions(),
    enabled: enabled && !canProceedOffline,
    retry: 1,
  });

  const liveAccessibleSpaces = useMemo(
    () =>
      (spacesQuery.data ?? []).filter(
        (space) => space.invitation_status === 'accepted' && space.is_accessible !== false
      ),
    [spacesQuery.data]
  );

  const allowWorkspaceCreation = IS_SELF_HOSTABLE_BUILD || canCreateWorkspace(accessStatus);
  const accessibleSpaces = spacesQuery.data ? liveAccessibleSpaces : accessibleCachedSpaces;

  if (!enabled || canProceedOffline) {
    return {
      status: 'ready',
      spacesQuery,
      accessibleSpaces,
      allowWorkspaceCreation,
    };
  }

  if (spacesQuery.isLoading) {
    return {
      status: 'loading',
      spacesQuery,
      accessibleSpaces,
      allowWorkspaceCreation,
    };
  }

  if (spacesQuery.isError && accessibleSpaces.length === 0) {
    return {
      status: 'error',
      spacesQuery,
      accessibleSpaces,
      allowWorkspaceCreation,
      error: getErrorMessage(spacesQuery.error, 'Failed to load workspaces.'),
    };
  }

  if (accessibleSpaces.length === 0) {
    return {
      status: 'required',
      spacesQuery,
      accessibleSpaces,
      allowWorkspaceCreation,
    };
  }

  return {
    status: 'ready',
    spacesQuery,
    accessibleSpaces,
    allowWorkspaceCreation,
  };
}

export function useBudgetStartupSnapshot(
  enabled: boolean,
  workspaceAccessibleSpaces: BudgetSpaceSummary[] = []
): BudgetStartupSnapshot {
  const { data: budgets, isLoading, isFetching, error, refetch } = useBudgets();

  // A failed budgets query otherwise dead-ends the gate: react-query stops
  // after its retries, the error never surfaces (nothing reads it), and the
  // splash spins forever ("Loading budgets…"). Log it and keep retrying —
  // transient causes (e.g. a service re-init window during a workspace
  // switch) heal on the next attempt.
  useEffect(() => {
    if (!enabled || !error || isFetching) return undefined;
    console.warn('[BudgetGate] budgets query failed; retrying', error);
    const timer = window.setTimeout(() => {
      void refetch();
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [enabled, error, isFetching, refetch]);

  const activeSpace = useActiveSpace();
  const activeSpaceId = useActiveSpaceId();
  const availableSpaces = useAvailableSpaces();
  const { selectedBudget, setSelectedBudget } = useUiStore();
  const canManageBudgets = activeSpace?.role === 'owner';
  const spacesForResolution =
    workspaceAccessibleSpaces.length > 0 ? workspaceAccessibleSpaces : availableSpaces;
  const resolution = useMemo(
    () =>
      resolveBudgetGate({
        budgets,
        isPending: enabled && budgets == null && (isLoading || isFetching),
        candidateSelectedBudget: selectedBudget,
        storedDefaultBudgetId: getStoredDefaultBudgetId(),
        canManageBudgets: Boolean(canManageBudgets),
        availableSpaces: spacesForResolution,
        activeSpaceId,
      }),
    [
      activeSpaceId,
      budgets,
      canManageBudgets,
      enabled,
      isFetching,
      isLoading,
      selectedBudget,
      spacesForResolution,
    ]
  );

  useEffect(() => {
    if (!enabled || budgets == null) return;
    if (resolution.clearStoredDefault) {
      clearStoredDefaultBudgetId();
    }
    if (!budgetsEqual(selectedBudget, resolution.selectedBudget)) {
      setSelectedBudget(resolution.selectedBudget);
    }
  }, [
    budgets,
    enabled,
    resolution.clearStoredDefault,
    resolution.selectedBudget,
    selectedBudget,
    setSelectedBudget,
  ]);

  useEffect(() => {
    if (!enabled || budgets == null || budgets.length > 0) return;
    window.setTimeout(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }, 0);
  }, [budgets, enabled]);

  if (!enabled) {
    return {
      status: 'ready',
      canManageBudgets: false,
      alternativeWorkspaces: [],
    };
  }

  return {
    status: resolution.status,
    canManageBudgets: Boolean(canManageBudgets),
    alternativeWorkspaces: resolution.alternativeWorkspaces,
  };
}
