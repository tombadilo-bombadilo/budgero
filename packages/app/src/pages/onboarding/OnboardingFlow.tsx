import { Trans, useLingui } from '@lingui/react/macro';
// Post-signup onboarding — collects every setup choice, then fires the whole
// setup pipeline on the final click. The pipeline has to run in order:
// master password → workspace → runtime init → budget (or YNAB import, or
// the demo) → accounts/categories → intro acknowledged.
//
// We replace the simple IntroRequiredScreen as the first startup gate. Once
// acknowledgeIntro() fires at the tail of the pipeline, StartupController
// re-evaluates all downstream gates, finds them satisfied, and drops the
// user at the dashboard.
//
// The pipeline itself (the former ~440-line `applyOnboarding` body) lives in
// `runOnboardingApply` (./apply-onboarding.ts) — a plain, React-free function
// so it's unit-testable without rendering this component.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  YNABApiPlanSnapshot,
  YNABImportProgressUpdate,
  YNABImportResult,
} from '@budgero/core/browser';
import { YNABImportService } from '@budgero/core/browser';
import { Check } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { cn } from '@shared/lib/utils';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { useLogout, useProfile, useUpdateOnboarding } from '@entities/user/api/useAuth';
import { readPendingSpaceInvite } from '@features/budget-sharing/lib/pending-space-invite';
import { hasCompleteCreditPaymentMappings } from '@features/budget-management/ui/create-budget-form/ynab-credit-payment-matching';
import { YnabImportStatus } from '@features/budget-management/ui/create-budget-form/YnabImportStatus';
import { track, trackOnUnload } from '@shared/lib/analytics/track';
import { durationBucket, type OnboardingStepId } from '@shared/lib/analytics/events';
import { guessDemoLocale } from '@features/demo-budget/lib/demo-workspace';
import {
  INITIAL_STATE,
  ONBOARDING_STEPS,
  PATH_STEPS,
  type ActivePath,
  type OnboardingFormState,
} from './onboarding-data';
import { newOnboardingAttempt, returnToDemo, runOnboardingApply } from './apply-onboarding';
import {
  AccountsStep,
  CategoriesStep,
  CurrencyStep,
  DoneStep,
  InviteCodeStep,
  PasswordStep,
  StartModeStep,
  WelcomeStep,
  WhereHeardPicker,
  WhereHeardStep,
  YnabImportStep,
} from './steps';
import { classifyYnabZipError } from './steps/ynab-source-errors';
import { checkInviteCode, normalizeInviteCode } from './invite-code';

interface OnboardingFlowProps {
  onComplete: () => void;
  /** 'from_demo': set up a real budget after trying the demo (no password step). */
  mode?: 'intro' | 'from_demo';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function yieldAfterPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (
      typeof document === 'undefined' ||
      document.visibilityState !== 'visible' ||
      typeof requestAnimationFrame !== 'function'
    ) {
      setTimeout(resolve, 0);
      return;
    }
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ onComplete, mode = 'intro' }) => {
  const { t } = useLingui();

  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: profile } = useProfile();
  const logout = useLogout();
  const { mutateAsync: updateOnboardingAsync } = useUpdateOnboarding();

  const [state, setState] = useState<OnboardingFormState>(() => {
    // Preselect the currency the browser's region uses (euro for de-DE, …).
    const initial = { ...INITIAL_STATE, currency: guessDemoLocale().currency };
    // Leaving the demo is a fresh start without the "how are you starting" step.
    return mode === 'from_demo' ? { ...initial, startMode: 'fresh' } : initial;
  });
  // Cross-tab invite handoff is encrypted in IndexedDB, so hydration is
  // asynchronous. Nothing is shown (or reported) until it resolves, so an
  // invitee never sees the start-mode screen flash by. Leaving the demo
  // can't be a join, so that path doesn't wait.
  const [inviteChecked, setInviteChecked] = useState(mode === 'from_demo');
  useEffect(() => {
    if (mode === 'from_demo') return;
    let active = true;
    void readPendingSpaceInvite()
      .catch(() => null)
      .then((pending) => {
        if (!active) return;
        if (pending) setState((current) => ({ ...current, joinSecret: pending }));
        setInviteChecked(true);
      });
    return () => {
      active = false;
    };
  }, [mode]);
  // Survives "Try again" so a retry reuses what the failed run left: the demo
  // being left (open when this page mounted) and any half-built workspace.
  const [attempt] = useState(() =>
    newOnboardingAttempt(mode === 'from_demo' ? runtime.getActiveSpaceId() : null)
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [applyStatus, setApplyStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [applyError, setApplyError] = useState<string | null>(null);
  const [isInspectingYnab, setIsInspectingYnab] = useState(false);
  const [isCheckingInvite, setIsCheckingInvite] = useState(false);
  const [ynabImportUpdates, setYnabImportUpdates] = useState<YNABImportProgressUpdate[]>([]);
  const [ynabImportResult, setYnabImportResult] = useState<YNABImportResult | null>(null);
  const [isFinalizingYnab, setIsFinalizingYnab] = useState(false);
  const ynabSourceRequestRef = useRef(0);
  const ynabReviewResolverRef = useRef<((decision: 'accept' | 'cancel') => void) | null>(null);
  const ynabContinueResolverRef = useRef<((shouldContinue: boolean) => void) | null>(null);

  useEffect(
    () => () => {
      ynabSourceRequestRef.current += 1;
      // If onboarding is torn down while a warned import is awaiting a
      // decision, release the pipeline so it can remove the pending data.
      ynabReviewResolverRef.current?.('cancel');
      ynabReviewResolverRef.current = null;
      ynabContinueResolverRef.current?.(false);
      ynabContinueResolverRef.current = null;
    },
    []
  );

  const set = useCallback((patch: Partial<OnboardingFormState>) => {
    if ('ynabFile' in patch || 'ynabApiSnapshot' in patch) {
      ynabSourceRequestRef.current += 1;
      setIsInspectingYnab(false);
    }
    setState((s) => ({ ...s, ...patch }));
  }, []);

  // Invitee shortcut path takes precedence when a /join secret was captured
  // before mount — those users are joining an existing workspace, not
  // setting up their own. Otherwise pick fresh/ynab as before.
  const activePath: ActivePath =
    mode === 'from_demo'
      ? 'from_demo'
      : state.joinSecret
        ? 'join'
        : state.startMode === 'ynab'
          ? 'ynab'
          : state.startMode === 'demo'
            ? 'demo'
            : state.startMode === 'join'
              ? 'join_code'
              : 'fresh';
  const joining = activePath === 'join' || activePath === 'join_code';
  const pathIds = PATH_STEPS[activePath];
  const total = pathIds.length;
  const safeStep = Math.min(stepIndex, total - 1);
  const curId = pathIds[safeStep];
  const cur = ONBOARDING_STEPS.find((s) => s.id === curId) ?? ONBOARDING_STEPS[0];

  const startedAtRef = useRef<number | null>(null);
  const analyticsStep = curId as OnboardingStepId;
  const lastViewedStepRef = useRef<OnboardingStepId | null>(null);
  const stepViewedAtRef = useRef(0);
  /** onboarding_left was sent for this visit (the page may come back from bfcache). */
  const finishedRef = useRef(false);
  /** Setup finished: nothing more to report, even if the page comes back. */
  const completedRef = useRef(false);
  const leftRef = useRef({ step: analyticsStep, path: activePath });
  leftRef.current = { step: analyticsStep, path: activePath };
  useEffect(() => {
    if (!inviteChecked) return;
    // Once per step: picking a start mode changes the path, not the step.
    startedAtRef.current ??= Date.now();
    const prev = lastViewedStepRef.current;
    if (prev === analyticsStep) return;
    lastViewedStepRef.current = analyticsStep;
    stepViewedAtRef.current = Date.now();
    const from = PATH_STEPS[activePath].indexOf(prev ?? '');
    if (prev && from > PATH_STEPS[activePath].indexOf(analyticsStep)) {
      track('onboarding_step_back', { from: prev, to: analyticsStep, path: activePath });
    }
    track('onboarding_step_viewed', { step: analyticsStep, path: activePath });
  }, [analyticsStep, activePath, inviteChecked]);
  useEffect(() => {
    // Closing the tab mid-setup: where, and after how long.
    const onPageHide = () => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      trackOnUnload('onboarding_left', {
        ...leftRef.current,
        duration_bucket: durationBucket(Date.now() - (startedAtRef.current ?? Date.now())),
      });
    };
    // Back from the back/forward cache: still mid-setup, so leaving again counts.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted && !completedRef.current) finishedRef.current = false;
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);
  const trackStepCompleted = useCallback(() => {
    track('onboarding_step_completed', {
      step: analyticsStep,
      path: activePath,
      duration_bucket: durationBucket(Date.now() - stepViewedAtRef.current),
    });
  }, [analyticsStep, activePath]);
  const completeOnboarding = useCallback(() => {
    finishedRef.current = true;
    completedRef.current = true;
    track('onboarding_finished', {
      path: activePath,
      duration_bucket: durationBucket(Date.now() - (startedAtRef.current ?? Date.now())),
    });
    onComplete();
  }, [activePath, onComplete]);

  const canAdvance = useMemo(() => {
    switch (curId) {
      case 'start_mode':
        return state.startMode !== null;
      case 'invite_code':
        return (
          normalizeInviteCode(state.inviteCode).length > 0 &&
          !state.inviteCodeProblem &&
          !isCheckingInvite
        );
      case 'password': {
        const pw = state.password;
        return pw.length >= 8 && pw === state.passwordConfirm;
      }
      case 'ynab_import':
        return (
          Boolean(state.ynabFile || state.ynabApiSnapshot) &&
          (!state.ynabApiSnapshot ||
            hasCompleteCreditPaymentMappings(
              state.ynabPreview?.creditPaymentMatching,
              state.ynabCreditPaymentMappings
            )) &&
          (!state.ynabFile ||
            !state.ynabPreview?.dateOrderAmbiguous ||
            Boolean(state.ynabDateOrder))
        );
      default:
        return true;
    }
  }, [curId, isCheckingInvite, state]);

  const next = useCallback(() => {
    trackStepCompleted();
    setStepIndex((s) => Math.min(s + 1, total - 1));
  }, [total, trackStepCompleted]);
  // Invite-code step: check the code before asking for a password, so a
  // mistyped or expired code is caught where it can be fixed.
  const checkCodeAndContinue = useCallback(async () => {
    const code = normalizeInviteCode(state.inviteCode);
    if (!code || isCheckingInvite || state.inviteCodeProblem) return;
    setIsCheckingInvite(true);
    try {
      const result = await checkInviteCode(code);
      if (!result.ok) {
        track('onboarding_invite_code_rejected', { reason: result.reason });
        set({ inviteCodeProblem: result.reason, inviteSpaceName: null });
        return;
      }
      set({ inviteCode: code, inviteSpaceName: result.spaceName });
      next();
    } finally {
      setIsCheckingInvite(false);
    }
  }, [isCheckingInvite, next, set, state.inviteCode, state.inviteCodeProblem]);

  const back = useCallback(() => {
    setStepIndex((s) => Math.max(s - 1, 0));
  }, []);

  const handleYnabFile = useCallback(
    async (file: File) => {
      set({
        ynabFile: null,
        ynabApiSnapshot: null,
        ynabPreview: null,
        ynabDateOrder: undefined,
        ynabCreditPaymentMappings: undefined,
        ynabSourceNumberFormat: undefined,
      });
      const request = ynabSourceRequestRef.current;
      setIsInspectingYnab(true);
      try {
        const bytes = await file.arrayBuffer();
        const preview = await YNABImportService.inspectYNABZip(bytes);
        if (request !== ynabSourceRequestRef.current) return;
        set({
          ynabFile: {
            name: file.name,
            size: formatFileSize(file.size),
            bytes,
          },
          ynabPreview: preview,
          budgetName: state.budgetName || file.name.replace(/\.(zip|json)$/i, ''),
        });
        track('ynab_import_source_loaded', { method: 'zip' });
      } catch (err) {
        if (request !== ynabSourceRequestRef.current) return;
        console.error('[Onboarding] Failed to read YNAB file', err);
        const reason = classifyYnabZipError(err);
        track('ynab_import_validation_failed', { method: 'zip', reason });
        toast.error(
          reason === 'not_zip'
            ? t`That file isn’t a ZIP. Upload the .zip YNAB downloads when you export, without unpacking it.`
            : reason === 'not_ynab_export'
              ? t`That ZIP isn’t a YNAB export: its register and plan files are missing. Export again from the YNAB web app.`
              : t`Could not read that file — try the raw YNAB export .zip.`
        );
      } finally {
        if (request === ynabSourceRequestRef.current) setIsInspectingYnab(false);
      }
    },
    [set, state.budgetName, t]
  );

  const handleYnabApiSnapshot = useCallback(
    (snapshot: YNABApiPlanSnapshot) => {
      set({
        ynabFile: null,
        ynabDateOrder: undefined,
        ynabCreditPaymentMappings: undefined,
        ynabSourceNumberFormat: undefined,
        ynabApiSnapshot: snapshot,
        ynabPreview: YNABImportService.inspectYNABApiSnapshot(snapshot),
        budgetName: state.budgetName || snapshot.plan.name,
        currency: snapshot.plan.currency_format?.iso_code ?? state.currency,
      });
    },
    [set, state.budgetName, state.currency]
  );

  // Escape from the YNAB step: same as going back to "How are you starting?"
  // and picking Fresh start, without walking back through every step.
  const startFreshInstead = useCallback(() => {
    set({
      startMode: 'fresh',
      ynabFile: null,
      ynabApiSnapshot: null,
      ynabPreview: null,
      ynabDateOrder: undefined,
      ynabCreditPaymentMappings: undefined,
      ynabSourceNumberFormat: undefined,
    });
    setStepIndex(PATH_STEPS.fresh.indexOf('currency'));
  }, [set]);

  const handleYnabProgress = useCallback(async (update: YNABImportProgressUpdate) => {
    setYnabImportUpdates((current) => [...current, update]);
    await yieldAfterPaint();
  }, []);

  const reviewYnabImport = useCallback(
    (result: YNABImportResult) =>
      new Promise<'accept' | 'cancel'>((resolve) => {
        setYnabImportResult(result);
        ynabReviewResolverRef.current = resolve;
      }),
    []
  );

  const resolveYnabReview = useCallback((decision: 'accept' | 'cancel') => {
    const resolve = ynabReviewResolverRef.current;
    if (!resolve) return;
    ynabReviewResolverRef.current = null;
    setIsFinalizingYnab(true);
    resolve(decision);
  }, []);

  const waitForYnabContinue = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        ynabContinueResolverRef.current = resolve;
        setIsFinalizingYnab(false);
      }),
    []
  );

  const continueFromYnabReport = useCallback(() => {
    const resolve = ynabContinueResolverRef.current;
    if (!resolve) return;
    ynabContinueResolverRef.current = null;
    resolve(true);
  }, []);

  const returnToYnabSource = useCallback(() => {
    ynabReviewResolverRef.current = null;
    ynabContinueResolverRef.current?.(false);
    ynabContinueResolverRef.current = null;
    setYnabImportUpdates([]);
    setYnabImportResult(null);
    setIsFinalizingYnab(false);
    setApplyStatus('idle');
    setApplyError(null);
    setStepIndex(PATH_STEPS.ynab.indexOf('ynab_import'));
  }, []);

  const applyOnboarding = useCallback(async () => {
    if (activePath === 'ynab') {
      setYnabImportUpdates([]);
      setYnabImportResult(null);
      setIsFinalizingYnab(false);
      // Commit the status screen before any expensive import work begins.
      // Without a paint boundary React may batch these state updates with the
      // importer and the user never sees the progress view.
      await yieldAfterPaint();
    }
    await runOnboardingApply(state, {
      activePath,
      runtime,
      queryClient,
      navigate,
      profileId: profile?.id,
      updateOnboardingAsync,
      onComplete: completeOnboarding,
      setApplyStatus,
      setApplyError,
      onYnabProgress: handleYnabProgress,
      onYnabResult: setYnabImportResult,
      reviewYnabImport,
      onYnabImportCancelled: returnToYnabSource,
      waitForYnabContinue,
      attempt,
    });
  }, [
    activePath,
    attempt,
    handleYnabProgress,
    navigate,
    completeOnboarding,
    profile?.id,
    queryClient,
    runtime,
    reviewYnabImport,
    returnToYnabSource,
    state,
    updateOnboardingAsync,
    waitForYnabContinue,
  ]);

  const stepLabel = String(safeStep + 1).padStart(2, '0');
  const totalLabel = String(total).padStart(2, '0');
  const isFinal = safeStep === total - 1;
  const isFirst = safeStep === 0;
  const launchesYnabImport = activePath === 'ynab' && curId === 'password';
  // The YNAB path has no generic Done summary. Its final step is always the
  // live import/reconciliation report and it owns the explicit hand-off into
  // the dashboard.
  const isShowingYnabStatus = curId === 'done' && activePath === 'ynab';

  const primaryLabel =
    curId === 'start_mode'
      ? state.startMode === 'demo'
        ? t`Try the demo →`
        : state.startMode === 'ynab'
          ? t`Import from YNAB →`
          : state.startMode === 'join'
            ? t`Enter my code →`
            : state.startMode === 'fresh'
              ? t`Set up my budget →`
              : t`Pick a way to start`
      : curId === 'invite_code'
        ? isCheckingInvite
          ? t`Checking…`
          : t`Check code →`
        : isFirst
          ? t`Let’s begin →`
          : launchesYnabImport
            ? t`Import my budget →`
            : isFinal
              ? joining
                ? t`Join workspace →`
                : activePath === 'demo'
                  ? t`Open the demo →`
                  : t`Open my budget →`
              : t`Next →`;
  const primaryAction = isFinal
    ? () => {
        if (applyStatus === 'running') return;
        trackStepCompleted();
        void applyOnboarding();
      }
    : curId === 'invite_code'
      ? () => void checkCodeAndContinue()
      : launchesYnabImport
        ? () => {
            if (applyStatus === 'running') return;
            trackStepCompleted();
            setStepIndex((current) => Math.min(current + 1, total - 1));
            void applyOnboarding();
          }
        : next;

  // An invite link may still be loading: show the page, not a step.
  if (!inviteChecked) {
    return <OnboardingFrame aria-busy="true" />;
  }

  const stepCounter = t`STEP ${stepLabel} / ${totalLabel}`;
  const showBackToDemo = mode === 'from_demo' && applyStatus !== 'running';

  return (
    <OnboardingFrame wide={isShowingYnabStatus}>
      {/* Desktop: the steps of this path down the side, so the window reads
          as a short, finite setup rather than a stretched phone screen. */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-muted/40 px-6 py-7 md:flex">
        <div className="flex items-center gap-2.5">
          <img src="/logo_48.png" alt={t`Budgero logo`} width={28} height={28} />
          <span className="font-semibold tracking-wide">Budgero</span>
        </div>
        <ol className="mt-8 space-y-1" aria-label={stepCounter}>
          {pathIds.map((id, i) => {
            const def = ONBOARDING_STEPS.find((step) => step.id === id);
            if (!def) return null;
            const status = i < safeStep ? 'done' : i === safeStep ? 'current' : 'todo';
            return (
              <li
                key={id}
                aria-current={status === 'current' ? 'step' : undefined}
                className={cn(
                  'flex items-start gap-2.5 rounded-md px-2 py-1.5 text-sm leading-snug',
                  status === 'current' && 'bg-background font-medium text-foreground shadow-xs',
                  status === 'done' && 'text-muted-foreground',
                  status === 'todo' && 'text-muted-foreground/70'
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px]',
                    status === 'done' && 'border-primary bg-primary text-primary-foreground',
                    status === 'current' && 'border-primary text-primary'
                  )}
                >
                  {status === 'done' ? <Check className="size-3" /> : i + 1}
                </span>
                <span>{t(def.title)}</span>
              </li>
            );
          })}
        </ol>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Top bar: brand on phones, the step count, and the way out. */}
        <div className="flex shrink-0 items-center gap-3 px-4 pt-3 group-data-[compact]/onb:pt-1.5 md:px-10 md:pt-6">
          <img src="/logo_48.png" alt="" width={22} height={22} className="md:hidden" aria-hidden />
          {showBackToDemo && (
            <button
              type="button"
              onClick={() => {
                void returnToDemo(runtime, queryClient, attempt)
                  .catch((err: unknown) =>
                    console.warn('[Onboarding] Back to the demo failed', err)
                  )
                  .finally(() => void navigate('/budgeting'));
              }}
              data-testid="back-to-demo"
              className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <Trans>← Back to the demo</Trans>
            </button>
          )}
          <span className="ml-auto text-[11px] tracking-wider text-muted-foreground tabular-nums">
            {stepCounter}
          </span>
          {mode !== 'from_demo' && (
            <button
              type="button"
              onClick={() => logout.mutate()}
              className="text-[11px] tracking-wider text-muted-foreground hover:text-foreground"
            >
              <Trans>SIGN OUT</Trans>
            </button>
          )}
        </div>
        <div
          className="mx-4 mt-2.5 flex shrink-0 gap-1 group-data-[compact]/onb:hidden md:mx-10 md:mt-4"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={safeStep + 1}
          aria-label={stepCounter}
        >
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                i <= safeStep ? 'bg-primary' : 'bg-muted'
              )}
            />
          ))}
        </div>

        {/* The step. Long lists scroll here; the buttons below never move. */}
        <main
          data-onboarding-step
          onFocus={() => setTimeout(keepFocusInView, 60)}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-4 group-data-[compact]/onb:pb-2 group-data-[compact]/onb:pt-2 md:px-10 md:pt-7"
        >
          {curId === 'welcome' && <WelcomeStep cur={cur} state={state} set={set} />}
          {curId === 'start_mode' && <StartModeStep cur={cur} state={state} set={set} />}
          {curId === 'currency' && <CurrencyStep cur={cur} state={state} set={set} />}
          {curId === 'ynab_import' && (
            <YnabImportStep
              cur={cur}
              state={state}
              set={set}
              onFileSelected={handleYnabFile}
              onApiSnapshotSelected={handleYnabApiSnapshot}
              isInspecting={isInspectingYnab}
              onStartFresh={startFreshInstead}
            />
          )}
          {curId === 'invite_code' && (
            <InviteCodeStep
              cur={cur}
              state={state}
              set={set}
              onSubmit={() => void checkCodeAndContinue()}
              isChecking={isCheckingInvite}
            />
          )}
          {curId === 'accounts' && <AccountsStep cur={cur} state={state} set={set} />}
          {curId === 'categories' && <CategoriesStep cur={cur} state={state} set={set} />}
          {curId === 'where_heard' && <WhereHeardStep cur={cur} state={state} set={set} />}
          {curId === 'password' && (
            <>
              <PasswordStep
                cur={cur}
                state={state}
                set={set}
                forDemo={activePath === 'demo'}
                forJoin={joining}
              />
              {activePath !== 'join' && <WhereHeardPicker state={state} set={set} />}
              {activePath === 'demo' && applyStatus === 'running' && (
                <div role="status" className="mt-4 text-sm">
                  <Trans>Setting up the demo budget…</Trans>
                </div>
              )}
              {activePath === 'demo' && applyStatus === 'error' && applyError && (
                <div role="alert" className="mt-4 text-sm text-destructive">
                  {applyError}
                </div>
              )}
            </>
          )}
          {curId === 'done' &&
            (isShowingYnabStatus ? (
              <YnabImportStatus
                sourceMode={state.ynabApiSnapshot ? 'api' : 'zip'}
                updates={ynabImportUpdates}
                error={applyError}
                summary={ynabImportResult?.summary ?? null}
                verification={ynabImportResult?.verification ?? null}
                currency={state.currency}
                isFinalizing={isFinalizingYnab}
                onBack={returnToYnabSource}
                onContinue={continueFromYnabReport}
                onAcceptWarnings={() => resolveYnabReview('accept')}
                onCancelPending={() => resolveYnabReview('cancel')}
              />
            ) : (
              <DoneStep
                cur={cur}
                state={state}
                applyState={applyStatus}
                applyError={applyError}
                fromDemo={activePath === 'from_demo'}
                joining={joining}
              />
            ))}
        </main>

        {!isShowingYnabStatus && (
          <div className="flex shrink-0 items-center gap-2 border-t bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 group-data-[compact]/onb:py-2 md:bg-transparent md:px-10 md:py-4">
            {!isFirst && applyStatus !== 'running' && (
              <Button type="button" variant="ghost" onClick={back} className="px-2">
                <Trans>← Back</Trans>
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              {/* Skip is only available on the referral question (purely
                  informational). Every other step feeds a real value into the
                  apply pipeline and can't be skipped. */}
              {curId === 'where_heard' && (
                <Button type="button" variant="ghost" onClick={next}>
                  <Trans>Skip for now</Trans>
                </Button>
              )}
              <Button
                type="button"
                onClick={primaryAction}
                disabled={!canAdvance || applyStatus === 'running'}
                className="min-w-32"
              >
                {isFinal && applyStatus === 'running'
                  ? t`Working…`
                  : isFinal && applyStatus === 'error'
                    ? t`Try again →`
                    : primaryLabel}
              </Button>
            </div>
          </div>
        )}
      </div>
    </OnboardingFrame>
  );
};

/**
 * The full-window frame. On a phone it is exactly the visible viewport (it
 * shrinks with the on-screen keyboard, so the buttons stay in view); from md
 * up it is a centred panel of a fixed height.
 */
function OnboardingFrame({
  children,
  wide = false,
  ...rest
}: { children?: React.ReactNode; wide?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  const viewport = useVisualViewportBox();
  // A phone with the keyboard open (~350 px left): the step's intro and the
  // progress bar fold away so the fields and the buttons fit.
  const compact = Boolean(viewport && viewport.height < 500 && viewport.width < 768);
  return (
    <div
      {...rest}
      data-compact={compact || undefined}
      className="group/onb fixed inset-x-0 top-0 flex h-dvh flex-col bg-background text-foreground md:items-center md:justify-center md:bg-muted/50 md:p-8"
      style={viewport ? { top: viewport.top, height: viewport.height } : undefined}
    >
      <div
        className={cn(
          'flex min-h-0 w-full flex-1 flex-col md:flex-none md:flex-row md:overflow-hidden md:rounded-xl md:border md:bg-card md:shadow-sm',
          wide ? 'md:h-full md:max-w-7xl' : 'md:h-[min(46rem,100%)] md:max-w-4xl'
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Scrolls the focused field into view inside the step, together with what
 * belongs to it (the nearest `data-keep-in-view` block: both password fields
 * and their messages, one account row).
 */
function keepFocusInView(): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.closest('[data-onboarding-step]')) return;
  if (!active.matches('input, select, textarea')) return;
  const block = active.closest('[data-keep-in-view]') ?? active;
  block.scrollIntoView?.({ block: 'nearest' });
}

/** The visual viewport (what is left above the on-screen keyboard), where supported. */
function useVisualViewportBox(): { top: number; height: number; width: number } | null {
  const [box, setBox] = useState<{ top: number; height: number; width: number } | null>(null);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const update = () => {
      setBox({ top: vv.offsetTop, height: vv.height, width: vv.width });
      // The keyboard opened or closed: the field being typed in stays visible.
      requestAnimationFrame(keepFocusInView);
    };
    const frame = requestAnimationFrame(update);
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return box;
}

export default OnboardingFlow;
