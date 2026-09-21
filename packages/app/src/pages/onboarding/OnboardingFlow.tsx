import { Trans, useLingui } from '@lingui/react/macro';
// Post-signup onboarding — collects every setup choice, then fires the whole
// setup pipeline on the final click. The pipeline has to run in order:
// master password → workspace → runtime init → budget (or YNAB import) →
// accounts/categories/goal → invites → theme → intro acknowledged.
// Invites come after the workspace + master password because they encrypt
// the space key for each recipient.
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
import { useThemePreset } from '@shared/contexts/ThemePresetContext';
import { getTodayISO } from '@shared/lib/date-utils';
import { readPendingSpaceInvite } from '@features/budget-sharing/lib/pending-space-invite';
import { hasCompleteCreditPaymentMappings } from '@features/budget-management/ui/create-budget-form/ynab-credit-payment-matching';
import { YnabImportStatus } from '@features/budget-management/ui/create-budget-form/YnabImportStatus';
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
  GoalStep,
  PasswordStep,
  RulesStep,
  ShareStep,
  StartModeStep,
  ThemeStep,
  WelcomeStep,
  WhereHeardStep,
  WorkspaceStep,
  YnabImportStep,
  ZbbStep,
} from './steps';
import './onboarding.css';

interface OnboardingFlowProps {
  onComplete: () => void;
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

const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ onComplete }) => {
  const { t } = useLingui();

  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: profile } = useProfile();
  const logout = useLogout();
  const { setThemeId } = useThemePreset();
  const { mutateAsync: updateOnboardingAsync } = useUpdateOnboarding();

  const [state, setState] = useState<OnboardingFormState>(INITIAL_STATE);
  // Cross-tab invite handoff is encrypted in IndexedDB, so hydration is
  // asynchronous. Prime the invitee shortcut as soon as the vault resolves.
  useEffect(() => {
    let active = true;
    void readPendingSpaceInvite().then((pending) => {
      if (active && pending) {
        setState((current) => ({ ...current, joinSecret: pending }));
      }
    });
    return () => {
      active = false;
    };
  }, []);
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
  const activePath: ActivePath = state.joinSecret
    ? 'join'
    : state.startMode === 'ynab'
      ? 'ynab'
      : 'fresh';
  const pathIds = PATH_STEPS[activePath];
  const total = pathIds.length;
  const safeStep = Math.min(stepIndex, total - 1);
  const curId = pathIds[safeStep];
  const cur = ONBOARDING_STEPS.find((s) => s.id === curId) ?? ONBOARDING_STEPS[0];

  const canAdvance = useMemo(() => {
    switch (curId) {
      case 'start_mode':
        return state.startMode !== null;
      case 'rules':
        return state.acknowledgedRules;
      case 'workspace':
        return state.budgetName.trim().length > 0;
      case 'share': {
        // If the user added rows, every row must have a non-empty email
        // before we let them proceed. Otherwise the apply pipeline would
        // silently drop empty rows and the post-onboarding share panel
        // would never appear, leaving the user wondering what happened.
        // Empty list is fine — share is optional; they can use Skip.
        return state.invites.every((inv) => inv.email.trim().length > 0);
      }
      case 'goal': {
        // Custom goal needs a non-default name before we'll turn it into a
        // real envelope during apply.
        if (state.goal.id === 'custom') {
          const label = state.goal.label.trim();
          if (label.length === 0 || label.toLowerCase() === 'something else') {
            return false;
          }
        }
        // Target-date mode needs a date that's actually in the future so the
        // monthly amount maths out. Past dates would create goals that are
        // immediately "overdue" in the budget UI.
        if (state.goal.mode === 'target') {
          const today = getTodayISO();
          if (!state.goal.targetDate || state.goal.targetDate <= today) {
            return false;
          }
        }
        return true;
      }
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
    setStepIndex((s) => Math.min(s + 1, total - 1));
  }, [total]);
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
      } catch (err) {
        if (request !== ynabSourceRequestRef.current) return;
        console.error('[Onboarding] Failed to read YNAB file', err);
        toast.error(t`Could not read that file — try the raw YNAB export .zip.`);
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
      setThemeId,
      updateOnboardingAsync,
      onComplete,
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
    onComplete,
    profile?.id,
    queryClient,
    runtime,
    reviewYnabImport,
    returnToYnabSource,
    setThemeId,
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

  const primaryLabel = isFirst
    ? t`Let’s begin →`
    : launchesYnabImport
      ? t`Import my budget →`
      : isFinal
        ? activePath === 'join'
          ? t`Join workspace →`
          : t`Open my budget →`
        : t`Next →`;
  const primaryAction = isFinal
    ? () => {
        if (applyStatus === 'running') return;
        void applyOnboarding();
      }
    : launchesYnabImport
      ? () => {
          if (applyStatus === 'running') return;
          setStepIndex((current) => Math.min(current + 1, total - 1));
          void applyOnboarding();
        }
      : next;

  return (
    <div
      className="budgero-onboarding-font bo-page"
      style={{
        width: '100%',
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #fbf7eb 0%, #f6f1e3 100%)',
        color: '#141414',
        padding: '32px 24px 48px',
        boxSizing: 'border-box',
      }}
    >
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
        {curId === 'rules' && <RulesStep cur={cur} state={state} set={set} />}
        {curId === 'currency' && <CurrencyStep cur={cur} state={state} set={set} />}
        {curId === 'zbb' && <ZbbStep cur={cur} state={state} set={set} />}
        {curId === 'workspace' && <WorkspaceStep cur={cur} state={state} set={set} />}
        {curId === 'share' && <ShareStep cur={cur} state={state} set={set} />}
        {curId === 'ynab_import' && (
          <YnabImportStep
            cur={cur}
            state={state}
            set={set}
            onFileSelected={handleYnabFile}
            onApiSnapshotSelected={handleYnabApiSnapshot}
            isInspecting={isInspectingYnab}
          />
        )}
        {curId === 'accounts' && <AccountsStep cur={cur} state={state} set={set} />}
        {curId === 'categories' && <CategoriesStep cur={cur} state={state} set={set} />}
        {curId === 'goal' && <GoalStep cur={cur} state={state} set={set} />}
        {curId === 'where_heard' && <WhereHeardStep cur={cur} state={state} set={set} />}
        {curId === 'theme' && <ThemeStep cur={cur} state={state} set={set} />}
        {curId === 'password' && <PasswordStep cur={cur} state={state} set={set} />}
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
            <DoneStep cur={cur} state={state} applyState={applyStatus} applyError={applyError} />
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
              {/* Skip is only available on the educational ZBB demo, on Sharing
                  (invites are optional), and on the referral question (purely
                  informational). Every other step feeds a real value into the
                  apply pipeline and can't be skipped. */}
              {(curId === 'zbb' || curId === 'share' || curId === 'where_heard') && (
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
      </div>
    </div>
  );
};

export default OnboardingFlow;
