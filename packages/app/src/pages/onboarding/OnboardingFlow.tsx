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
import { useRuntime } from '@shared/runtime/runtime-provider';
import { useLogout, useProfile, useUpdateOnboarding } from '@entities/user/api/useAuth';
import { readPendingSpaceInvite } from '@features/budget-sharing/lib/pending-space-invite';
import { hasCompleteCreditPaymentMappings } from '@features/budget-management/ui/create-budget-form/ynab-credit-payment-matching';
import { YnabImportStatus } from '@features/budget-management/ui/create-budget-form/YnabImportStatus';
import { track, trackOnUnload } from '@shared/lib/analytics/track';
import { durationBucket, type OnboardingStepId } from '@shared/lib/analytics/events';
import {
  INITIAL_STATE,
  ONBOARDING_STEPS,
  PATH_STEPS,
  type ActivePath,
  type OnboardingFormState,
} from './onboarding-data';
import { runOnboardingApply } from './apply-onboarding';
import {
  AccountsStep,
  CategoriesStep,
  CurrencyStep,
  DoneStep,
  PasswordStep,
  StartModeStep,
  WelcomeStep,
  WhereHeardPicker,
  WhereHeardStep,
  YnabImportStep,
} from './steps';
import { classifyYnabZipError } from './steps/ynab-source-errors';
import './onboarding.css';

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

  const [state, setState] = useState<OnboardingFormState>(() =>
    // Leaving the demo is a fresh start without the "how are you starting" step.
    mode === 'from_demo' ? { ...INITIAL_STATE, startMode: 'fresh' } : INITIAL_STATE
  );
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
  const [stepIndex, setStepIndex] = useState(0);
  const [applyStatus, setApplyStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [applyError, setApplyError] = useState<string | null>(null);
  const [isInspectingYnab, setIsInspectingYnab] = useState(false);
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
            : 'fresh';
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
  }, [curId, state]);

  const next = useCallback(() => {
    trackStepCompleted();
    setStepIndex((s) => Math.min(s + 1, total - 1));
  }, [total, trackStepCompleted]);
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
    });
  }, [
    activePath,
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
          : state.startMode === 'fresh'
            ? t`Set up my budget →`
            : t`Pick a way to start`
      : isFirst
        ? t`Let’s begin →`
        : launchesYnabImport
          ? t`Import my budget →`
          : isFinal
            ? activePath === 'join'
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
    : launchesYnabImport
      ? () => {
          if (applyStatus === 'running') return;
          trackStepCompleted();
          setStepIndex((current) => Math.min(current + 1, total - 1));
          void applyOnboarding();
        }
      : next;

  const pageStyle: React.CSSProperties = {
    width: '100%',
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #fbf7eb 0%, #f6f1e3 100%)',
    color: '#141414',
    padding: '32px 24px 48px',
    boxSizing: 'border-box',
  };
  // An invite link may still be loading: show the page, not a step.
  if (!inviteChecked) {
    return <div className="budgero-onboarding-font bo-page" style={pageStyle} aria-busy="true" />;
  }

  return (
    <div className="budgero-onboarding-font bo-page" style={pageStyle}>
      {mode === 'from_demo' && applyStatus !== 'running' && (
        <div style={{ maxWidth: 880, margin: '0 auto 12px' }}>
          <button
            type="button"
            onClick={() => navigate('/budgeting')}
            data-testid="back-to-demo"
            style={{
              background: 'transparent',
              border: '1px dashed rgba(57,57,57,0.5)',
              color: '#141414',
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: 0.3,
              padding: '8px 12px',
              cursor: 'pointer',
            }}
          >
            <Trans>← Back to the demo</Trans>
          </button>
        </div>
      )}
      {/* Header */}
      <div
        className="bo-header-stack"
        style={{
          maxWidth: isShowingYnabStatus ? 1240 : 880,
          margin: '0 auto 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img
            src="/logo_48.png"
            alt={t`Budgero logo`}
            width={28}
            height={28}
            style={{ display: 'block' }}
          />
          <span style={{ fontWeight: 700, letterSpacing: 1 }}>BUDGERO</span>
        </div>
        <div
          className="bo-header-step"
          style={{
            fontSize: 11,
            letterSpacing: 1.2,
            color: '#393939',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              background: '#c6392c',
              borderRadius: '50%',
            }}
          />
          STEP {String(safeStep + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </div>
      </div>

      {/* Progress */}
      <div
        style={{
          maxWidth: isShowingYnabStatus ? 1240 : 880,
          margin: '0 auto 28px',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div
          className="bo-progress-track"
          style={{ display: 'flex', gap: 6, alignItems: 'center' }}
        >
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              style={{
                width: 24,
                height: 2,
                background:
                  i < safeStep ? '#141414' : i === safeStep ? '#c6392c' : 'rgba(57,57,57,0.3)',
                transition: 'background 0.3s',
              }}
            />
          ))}
        </div>
      </div>

      {/* Card */}
      <div
        className="bo-card"
        style={{
          maxWidth: isShowingYnabStatus ? 1240 : 880,
          margin: '0 auto',
          background: '#fffdf8',
          border: '1px dashed rgba(57,57,57,0.55)',
          boxShadow: '0 14px 24px -8px rgba(20,20,20,0.18), 0 6px 12px -6px rgba(20,20,20,0.10)',
          padding: '44px 48px',
          position: 'relative',
          // Clip illustration bleed at the card boundary so the negative
          // margins on hero images can't escape past the dashed border on
          // mobile, where card padding is smaller than the bleed offset.
          overflow: 'hidden',
        }}
      >
        <div
          className="bo-card-stamp"
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            fontSize: 9,
            letterSpacing: 1.5,
            color: 'rgba(57,57,57,0.6)',
            border: '1px dashed rgba(57,57,57,0.4)',
            padding: '3px 8px',
          }}
        >
          {t(cur.hint).toUpperCase()}
        </div>

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
        {curId === 'accounts' && <AccountsStep cur={cur} state={state} set={set} />}
        {curId === 'categories' && <CategoriesStep cur={cur} state={state} set={set} />}
        {curId === 'where_heard' && <WhereHeardStep cur={cur} state={state} set={set} />}
        {curId === 'password' && (
          <>
            <PasswordStep cur={cur} state={state} set={set} forDemo={activePath === 'demo'} />
            {activePath !== 'join' && <WhereHeardPicker state={state} set={set} />}
            {activePath === 'demo' && applyStatus === 'running' && (
              <div role="status" style={{ marginTop: 16, fontSize: 13 }}>
                <Trans>Setting up the demo budget…</Trans>
              </div>
            )}
            {activePath === 'demo' && applyStatus === 'error' && applyError && (
              <div role="alert" style={{ marginTop: 16, fontSize: 13, color: '#c6392c' }}>
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
              passwordAlreadySet={activePath === 'from_demo'}
            />
          ))}

        {/* Footer */}
        {!isShowingYnabStatus && (
          <div
            style={{
              marginTop: 36,
              paddingTop: 22,
              borderTop: '1px dashed rgba(57,57,57,0.4)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              {!isFirst && applyStatus !== 'running' && (
                <button
                  type="button"
                  onClick={back}
                  style={{
                    background: 'transparent',
                    color: '#393939',
                    border: 'none',
                    padding: '12px 8px',
                    fontFamily: 'inherit',
                    fontSize: 13,
                    letterSpacing: 0.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Trans>← Back</Trans>
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {/* Skip is only available on the referral question (purely
                  informational). Every other step feeds a real value into the
                  apply pipeline and can't be skipped. */}
              {curId === 'where_heard' && (
                <button
                  type="button"
                  onClick={next}
                  style={{
                    background: 'transparent',
                    color: '#393939',
                    border: 'none',
                    padding: '12px 8px',
                    fontFamily: 'inherit',
                    fontSize: 13,
                    letterSpacing: 0.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Trans>Skip for now</Trans>
                </button>
              )}
              <button
                type="button"
                onClick={primaryAction}
                disabled={!canAdvance || applyStatus === 'running'}
                style={{
                  background: '#141414',
                  color: '#fbf7eb',
                  border: '1px solid #141414',
                  padding: '12px 24px',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  letterSpacing: 0.5,
                  fontWeight: 600,
                  cursor: !canAdvance || applyStatus === 'running' ? 'not-allowed' : 'pointer',
                  opacity: !canAdvance || applyStatus === 'running' ? 0.4 : 1,
                }}
              >
                {isFinal && applyStatus === 'running'
                  ? t`Working…`
                  : isFinal && applyStatus === 'error'
                    ? t`Try again →`
                    : primaryLabel}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footnote */}
      <div
        style={{
          maxWidth: 880,
          margin: '20px auto 0',
          fontSize: 10,
          color: 'rgba(57,57,57,0.7)',
          display: 'flex',
          justifyContent: 'space-between',
          letterSpacing: 0.5,
        }}
      >
        <span>
          <Trans>BUDGERO · ONBOARDING v1</Trans>
        </span>
        {mode !== 'from_demo' && (
          <button
            type="button"
            onClick={() => logout.mutate()}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(57,57,57,0.7)',
              fontFamily: 'inherit',
              fontSize: 10,
              letterSpacing: 0.5,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <Trans>SIGN OUT</Trans>
          </button>
        )}
      </div>
    </div>
  );
};

export default OnboardingFlow;
