import { t, plural } from '@lingui/core/macro';
import { i18n } from '@lingui/core';
// Plain, React-free implementation of the onboarding "apply" pipeline —
// extracted verbatim from OnboardingFlow's `applyOnboarding` useCallback so
// it can be unit-tested by mocking `deps` instead of rendering the flow.
//
// The pipeline has to run in order: master password → workspace → runtime
// init → budget (or YNAB import, or the demo) → accounts/categories → intro
// acknowledged. The numbered step comments below are load-bearing — they document *why* the
// ordering can't be reshuffled, not just what each step does.
import type { QueryClient } from '@tanstack/react-query';
import type { NavigateFunction } from 'react-router-dom';
import { toast } from 'sonner';
import type {
  DatabaseAdapter,
  YNABImportProgressUpdate,
  YNABImportResult,
} from '@budgero/core/browser';
import { YNABImportService } from '@budgero/core/browser';
import { MasterPasswordManager } from '@shared/lib/crypto';
import { getErrorMessage } from '@shared/lib/errors';
import { startImportRun } from '@shared/lib/analytics/import-tracking';
import { authApi, spaceApi } from '@shared/api/api-client';
import type { AppRuntime } from '@shared/runtime/app-runtime';
import {
  decryptSpaceKeyFromInvite,
  hashInviteSecret,
  wrapSpaceKeyWithMaster,
} from '@budgero/runtime';
import type { UpdateOnboardingInput } from '@entities/user/api/useAuth';
import { writeIntroAcknowledged } from '@features/onboarding/lib/onboarding-intro';
import { fromDecimal } from '@shared/lib/currency/milli';
import {
  getBudgetsQueryKey,
  switchWorkspaceAndSyncBudgetState,
  syncBudgetStateFromRuntime,
} from '@shared/runtime/budget-gate';
import { BUDGET_SPACES_QUERY_KEY } from '@features/budget-sharing/lib/workspaces/queries';
import type { BudgetSpaceSummary } from '@shared/model/budget-spaces';
import { clearPendingSpaceInvite } from '@features/budget-sharing/lib/pending-space-invite';
import { startFirstSteps } from '@shared/lib/first-steps/first-steps';
import { getDemoSpaceId, setDemoSpaceId } from '@shared/lib/demo-space';
import { seedDemoBudget } from '@features/demo-budget/lib/seed-demo-budget';
import {
  guessDemoLocale,
  holdsOnlyDemoBudgets,
  removeDemoWorkspace,
  removeLeftoverDemoWorkspace,
} from '@features/demo-budget/lib/demo-workspace';
import {
  ACCOUNT_TYPES,
  CATEGORY_PRESETS,
  CATEGORY_TO_GROUP,
  CATEGORY_ITEM_LABELS,
  resolveHeardValue,
  type ActivePath,
  type OnboardingFormState,
} from './onboarding-data';
import {
  InviteCodeError,
  classifyInviteError,
  inviteProblemMessage,
  normalizeInviteCode,
} from './invite-code';

export interface OnboardingApplyDeps {
  activePath: ActivePath;
  runtime: AppRuntime;
  queryClient: QueryClient;
  navigate: NavigateFunction;
  profileId: string | undefined;
  updateOnboardingAsync: (input: UpdateOnboardingInput) => Promise<void>;
  onComplete: () => void;
  setApplyStatus: (status: 'idle' | 'running' | 'error') => void;
  setApplyError: (message: string | null) => void;
  onYnabProgress: (update: YNABImportProgressUpdate) => void | Promise<void>;
  onYnabResult: (result: YNABImportResult) => void;
  reviewYnabImport: (result: YNABImportResult) => Promise<'accept' | 'cancel'>;
  onYnabImportCancelled: () => void;
  waitForYnabContinue: () => Promise<boolean>;
  /** Kept by the flow across "Try again"; a one-off attempt when omitted. */
  attempt?: OnboardingAttempt;
}

/** What a setup run leaves for the next one ("Try again", "Back to the demo"). */
export interface OnboardingAttempt {
  /** Workspace created by a run that did not finish; removed before the next run. */
  spaceId: string | null;
  /** Leaving the demo: the demo workspace (the one open when setup started). */
  demoSpaceId: string | null;
  /** Leaving the demo: its own data proved it holds only the demo (null = not checked yet). */
  demoProven: boolean | null;
}

export function newOnboardingAttempt(demoSpaceId: string | null = null): OnboardingAttempt {
  return { spaceId: null, demoSpaceId, demoProven: null };
}

/**
 * Removes the workspace an unfinished run created (it holds only what that run
 * built), after reopening the demo when setup started from there.
 */
async function discardUnfinishedWorkspace(
  runtime: AppRuntime,
  queryClient: QueryClient,
  attempt: OnboardingAttempt
): Promise<void> {
  const leftover = attempt.spaceId;
  if (attempt.demoSpaceId && runtime.getActiveSpaceId() !== attempt.demoSpaceId) {
    try {
      await switchWorkspaceAndSyncBudgetState({
        runtime,
        queryClient,
        spaceId: attempt.demoSpaceId,
      });
    } catch (err) {
      console.warn('[Onboarding] Could not reopen the demo workspace', err);
    }
  }
  if (!leftover) return;
  attempt.spaceId = null;
  if (getDemoSpaceId() === leftover) setDemoSpaceId(null);
  try {
    await removeIncompleteWorkspace(runtime, queryClient, leftover);
  } catch (err) {
    console.warn('[Onboarding] Could not remove the unfinished workspace', err);
  }
}

/** "← Back to the demo": the demo opens again and a half-built workspace goes. */
export async function returnToDemo(
  runtime: AppRuntime,
  queryClient: QueryClient,
  attempt: OnboardingAttempt
): Promise<void> {
  await discardUnfinishedWorkspace(runtime, queryClient, attempt);
}

async function removeIncompleteWorkspace(
  runtime: AppRuntime,
  queryClient: QueryClient,
  spaceId: string,
  budgetId?: number
): Promise<void> {
  if (budgetId !== undefined) {
    runtime.services().budgets.deleteBudget(budgetId);
  }
  await spaceApi.deleteSpace(spaceId);
  await runtime.refreshSpaces();
  const activeSpaceId = runtime.getActiveSpaceId();
  if (!activeSpaceId || activeSpaceId === spaceId) {
    syncBudgetStateFromRuntime({
      runtime,
      queryClient,
      spaceId: null,
      candidateSelectedBudget: null,
    });
  }
  await queryClient.invalidateQueries({ queryKey: BUDGET_SPACES_QUERY_KEY });
}

export async function runOnboardingApply(
  state: OnboardingFormState,
  deps: OnboardingApplyDeps
): Promise<void> {
  const {
    activePath,
    runtime,
    queryClient,
    navigate,
    profileId,
    updateOnboardingAsync,
    onComplete,
    setApplyStatus,
    setApplyError,
    onYnabProgress,
    onYnabResult,
    reviewYnabImport,
    onYnabImportCancelled,
    waitForYnabContinue,
  } = deps;

  setApplyStatus('running');
  setApplyError(null);
  // Referral source from the optional "How did you hear about us?" step.
  // Empty when skipped — the server leaves the field untouched in that case.
  const whereHeard = resolveHeardValue(state.heardSource, state.heardOther);
  const isJoinPath = activePath === 'join' || activePath === 'join_code';
  try {
    // INVITEE PATH — short-circuit before workspace creation. We don't
    // create our own space; we redeem the invite, attach to theirs, then
    // flip the same server flags as the regular path.
    //
    // Critical ordering: the local MasterPasswordManager.store(...) call
    // (which sets the localStorage "master_password_status" marker) is
    // deferred until AFTER the redeem succeeds. Setting it earlier and
    // then having a later step fail puts the user into a half-state where
    // StartupController sees hasLocalMasterPassword=true but the server
    // has no membership/no master password recorded — the workspace gate
    // then traps them on the "Create Workspace" required screen.
    //
    // Both join paths land here: the /join link ('join', secret captured
    // from the link) and "Join with an invite code" ('join_code', typed).
    // Neither may fall through to the workspace creation below.
    if (isJoinPath) {
      const joinSecret =
        activePath === 'join' ? state.joinSecret : normalizeInviteCode(state.inviteCode);
      if (!joinSecret) throw new InviteCodeError('not_found');
      const token = await hashInviteSecret(joinSecret);
      const inspection = await spaceApi.inspectInvite(token);
      if (!inspection.encrypted_bundle) {
        throw new InviteCodeError('incomplete');
      }
      const spaceKey = await decryptSpaceKeyFromInvite(inspection.encrypted_bundle, joinSecret);
      const wrapped = await wrapSpaceKeyWithMaster(spaceKey, state.password);
      const joined = await spaceApi.redeemInvite(token, wrapped);

      // Server-side membership now exists. Commit local state.
      await MasterPasswordManager.store(state.password);
      if (!runtime.isInitialized()) {
        await runtime.init({ masterPassword: state.password, queryClient });
      }
      await runtime.refreshSpaces();
      await runtime.switchSpace(joined.space_id);

      // Seed budgets + selected budget from the now-active services — same
      // deterministic hand-off the fresh path does below. Without it the
      // invitee's budget gate races the reactive budgets query across the
      // switch and can spin on "Loading budgets…" until a full reload.
      syncBudgetStateFromRuntime({
        runtime,
        queryClient,
        spaceId: joined.space_id,
        candidateSelectedBudget: null,
      });

      // Seed the budget-spaces cache with the joined summary before
      // flipping the intro gate. Otherwise StartupController re-evaluates
      // the workspace gate with the still-cached pre-redeem space list
      // and shows the "Create Workspace" required screen for an instant
      // (or longer, depending on refetch timing).
      queryClient.setQueryData<BudgetSpaceSummary[]>(BUDGET_SPACES_QUERY_KEY, (prev) => {
        const existing = prev ?? [];
        if (existing.some((s) => s.space_id === joined.space_id)) return existing;
        return [...existing, joined];
      });
      await queryClient.refetchQueries({ queryKey: BUDGET_SPACES_QUERY_KEY });

      // Tear down every trace of /join BEFORE flipping any server-side
      // flag that could cascade the startup gates to "ready". The order
      // matters: setMasterPasswordStatus(true) refetches the profile,
      // which makes the intro/master-password/workspace snapshots all
      // resolve to ready while the URL is still /join#code=… — at that
      // moment the Outlet briefly mounts JoinWorkspacePage, whose
      // useState initializer would re-write the secret back to storage
      // from the URL fragment, undoing our cleanup. So we:
      //
      //   1. wipe the secret from storage,
      //   2. strip the URL fragment via history.replaceState (silent —
      //      doesn't trip SpaceInviteRedirect's location effect),
      //   3. swap the pathname to "/" so any post-flip Outlet mount lands
      //      on the user's home page (via the index redirect), not on
      //      JoinWorkspacePage.
      //
      // OnboardingFlow itself stays mounted across the URL change —
      // the intro gate is the thing that holds it on screen, and that
      // doesn't unblock until acknowledgeIntro fires below.
      await clearPendingSpaceInvite();
      if (typeof window !== 'undefined' && window.location.hash) {
        try {
          window.history.replaceState(null, '', window.location.pathname);
        } catch {
          /* no-op */
        }
      }
      await navigate('/', { replace: true });

      // Same server flags + home hand-off as the regular path.
      try {
        await authApi.setMasterPasswordStatus(true);
      } catch (err) {
        console.warn('[Onboarding] Failed to mark master password set on server', err);
      }
      try {
        await updateOnboardingAsync({
          status: 'completed',
          snoozed_until: null,
          where_heard_about: whereHeard,
        });
      } catch (err) {
        console.warn('[Onboarding] Failed to mark onboarding completed', err);
      }
      writeIntroAcknowledged(profileId ?? null);
      await queryClient.invalidateQueries();
      onComplete();
      return;
    }

    // FRESH/YNAB path — store master password before workspace creation.
    // Same caveat about the local marker exists here, but the next call
    // (spaceApi.createSpace) is server-authoritative so a failure there
    // is recoverable on reload (the StartupController workspace gate
    // would then route them through normal workspace setup).
    // Leaving the demo: the password and the runtime already exist.
    const fromDemo = activePath === 'from_demo';
    const attempt =
      deps.attempt ?? newOnboardingAttempt(fromDemo ? runtime.getActiveSpaceId() : null);
    // "Try again": the workspace the failed run created goes first, so a retry
    // doesn't leave a second, half-built one.
    await discardUnfinishedWorkspace(runtime, queryClient, attempt);

    // The demo is deleted at the end only if its own data proves it is just
    // the demo (checked while it is open). The device's cached id isn't enough:
    // it is set before the seed runs, so a workspace whose seed never ran (and
    // where a real budget was set up since) carries it too.
    let demoSpaceId: string | null = null;
    if (fromDemo) {
      if (
        attempt.demoProven === null &&
        attempt.demoSpaceId &&
        runtime.getActiveSpaceId() === attempt.demoSpaceId
      ) {
        try {
          attempt.demoProven = holdsOnlyDemoBudgets(runtime.services());
        } catch (err) {
          console.warn('[Onboarding] Could not read the demo workspace', err);
          attempt.demoProven = false;
        }
      }
      if (attempt.demoProven) {
        demoSpaceId = attempt.demoSpaceId;
      } else if (attempt.demoSpaceId && getDemoSpaceId() === attempt.demoSpaceId) {
        setDemoSpaceId(null);
      }
    }
    if (!fromDemo) await MasterPasswordManager.store(state.password);

    // A demo left half-filled by an earlier attempt (tab closed mid-seed, or
    // the seed failed) goes first, so trying again doesn't leave two. Setup
    // only runs before onboarding is completed, so any demo marked on this
    // device at this point is such a leftover.
    if (!fromDemo) await removeLeftoverDemoWorkspace(runtime, queryClient);

    // 2. Workspace. createSpace returns a fresh BudgetSpaceSummary; the
    // space row exists server-side from this point on.
    const summary = await spaceApi.createSpace(
      activePath === 'demo' ? t`Demo budget` : state.budgetName.trim() || t`My budget`
    );
    const spaceId = summary.space_id;
    attempt.spaceId = spaceId;
    // Marked before it holds anything, so an interrupted seed is recognised.
    if (activePath === 'demo') setDemoSpaceId(spaceId);

    // Record the master password on the server as soon as the workspace
    // exists. Waiting until the end left accounts with a working budget but
    // the flag unset whenever a later step was interrupted (e.g. a reload on
    // the YNAB report), so other devices were sent back into onboarding.
    // Step 8 repeats this, and StartupController heals it on next launch.
    if (!fromDemo) {
      try {
        await authApi.setMasterPasswordStatus(true);
      } catch (err) {
        console.warn('[Onboarding] Failed to mark master password set on server', err);
      }
    }

    // 3. Initialise the runtime so services + opcodes have a DB to talk to.
    // Pull the space list so refreshSpaces picks up the new one, then
    // switchSpace activates it (which also wires service-level fixtures).
    if (!runtime.isInitialized()) {
      await runtime.init({ masterPassword: state.password, queryClient });
    }
    await runtime.refreshSpaces();
    await runtime.switchSpace(spaceId);

    // DEMO PATH — fill the new workspace with sample data and open it. The
    // banner in the app offers "Start my own budget" (the from_demo path).
    if (activePath === 'demo') {
      let demoBudgetId: number;
      try {
        demoBudgetId = await seedDemoBudget(runtime, spaceId, guessDemoLocale());
      } catch (error) {
        // Nothing half-filled stays behind; trying again starts clean.
        try {
          await removeDemoWorkspace(runtime, queryClient, spaceId);
          attempt.spaceId = null;
        } catch (cleanupError) {
          console.warn('[Onboarding] Could not remove the incomplete demo', cleanupError);
        }
        throw error;
      }
      syncBudgetStateFromRuntime({
        runtime,
        queryClient,
        spaceId,
        preferredBudgetId: demoBudgetId,
      });
      try {
        await updateOnboardingAsync({
          status: 'completed',
          snoozed_until: null,
          where_heard_about: whereHeard,
        });
      } catch (err) {
        console.warn('[Onboarding] Failed to mark onboarding completed', err);
      }
      writeIntroAcknowledged(profileId ?? null);
      attempt.spaceId = null;
      await queryClient.invalidateQueries();
      await navigate('/budgeting', { replace: true });
      onComplete();
      return;
    }

    // 4. Budget. Fresh path uses the budgets.create op; YNAB path runs the
    // core YNAB importer which creates its own budget record (out-of-band,
    // bypasses the router).
    let budgetId: number;
    const isYnab = Boolean(state.startMode === 'ynab' && (state.ynabFile || state.ynabApiSnapshot));
    let ynabImportResult: YNABImportResult | null = null;
    let ynabSummaryDescription = '';
    if (isYnab) {
      const db = runtime.getDatabase();
      if (!db) {
        throw new Error('Database not ready — try again in a moment.');
      }
      const importService = new YNABImportService(db as unknown as DatabaseAdapter);
      const importConfig = {
        spaceId,
        budgetName: state.budgetName.trim() || t`My budget`,
        currency: state.currency,
        numberFormat: '$1,096.56',
        ...(!state.ynabApiSnapshot
          ? { sourceNumberFormat: state.ynabSourceNumberFormat ?? '' }
          : {}),
        badgeIcon: '💰',
        ...(!state.ynabApiSnapshot && state.ynabDateOrder
          ? { dateOrder: state.ynabDateOrder }
          : {}),
        ...(state.ynabApiSnapshot &&
        state.ynabPreview?.creditPaymentMatching &&
        state.ynabCreditPaymentMappings
          ? { creditPaymentMappings: state.ynabCreditPaymentMappings }
          : {}),
        onProgress: onYnabProgress,
      };
      let importResult: YNABImportResult;
      const importRun = startImportRun(
        state.ynabApiSnapshot ? 'ynab_api' : 'ynab_zip',
        'onboarding'
      );
      try {
        importResult = state.ynabApiSnapshot
          ? await importService.importYNABFromApiSnapshotWithSummary(
              state.ynabApiSnapshot,
              importConfig
            )
          : await importService.importYNABFromZipWithSummary(state.ynabFile!.bytes, importConfig);
      } catch (error) {
        importRun.error(error);
        try {
          await removeIncompleteWorkspace(runtime, queryClient, spaceId);
          attempt.spaceId = null;
        } catch (cleanupError) {
          console.warn('[Onboarding] Failed to remove an incomplete YNAB workspace', cleanupError);
        }
        throw error;
      }
      ynabImportResult = importResult;
      onYnabResult(importResult);
      budgetId = importResult.budgetId;

      if (importResult.verification?.status === 'warning') {
        // Register the decision resolver before painting the review screen so
        // even an immediate click cannot race ahead of the suspended pipeline.
        const reviewDecision = reviewYnabImport(importResult);
        await onYnabProgress({
          stage: 'complete',
          status: 'warning',
          progress: 99,
          label: t`Waiting for your review`,
          detail: 'The imported budget has not been saved or synced yet.',
        });
        const decision = await reviewDecision;
        if (decision === 'cancel') {
          importRun.cancelled();
          try {
            await removeIncompleteWorkspace(runtime, queryClient, spaceId, budgetId);
            attempt.spaceId = null;
          } catch (cleanupError) {
            throw new Error(
              `The import was cancelled, but Budgero could not completely remove its temporary workspace: ${getErrorMessage(cleanupError, 'unknown cleanup error')}`
            );
          }
          setApplyStatus('idle');
          setApplyError(null);
          onYnabImportCancelled();
          return;
        }
      }

      await onYnabProgress({
        stage: 'complete',
        status: 'running',
        progress: 99,
        label:
          importResult.verification?.status === 'warning'
            ? t`Saving imported budget with accepted warnings`
            : t`Saving imported budget`,
      });

      importRun.ok(importResult.summary.transactionsCreated);

      runtime.services().importHistory.recordImportRun({
        budgetId,
        sourceType: state.ynabApiSnapshot ? 'ynab-api' : 'ynab-zip',
        sourceName: state.ynabApiSnapshot?.plan.name || state.ynabFile?.name || 'YNAB import',
        summary: {
          transactionsImported: importResult.summary.transactionsCreated,
          accountsCreated:
            importResult.verification?.accounts.checked ?? state.ynabPreview?.accountCount ?? 0,
          categoriesCreated: state.ynabPreview?.categoryCount ?? 0,
          ...(importResult.verification ? { verification: importResult.verification } : {}),
          ...(importResult.verification?.status === 'warning'
            ? { acceptedWithWarnings: true }
            : {}),
        },
        transactionIds: [],
        accountIds: [],
        categoryIds: [],
        status:
          importResult.verification?.status === 'warning' ? 'completed_with_warnings' : 'completed',
      });

      const createdCategories = importResult.summary.missingCategoriesCreated.map(
        (category) => `${category.categoryGroup} › ${category.category}`
      );
      const summaryParts: string[] = [];
      if (createdCategories.length > 0) {
        summaryParts.push(
          plural(createdCategories.length, {
            one: `Created # category missing from Plan.csv: ${createdCategories.join(', ')}.`,
            other: `Created # categories missing from Plan.csv: ${createdCategories.join(', ')}.`,
          })
        );
      }
      if (importResult.summary.splitTransactionsImported > 0) {
        summaryParts.push(
          plural(importResult.summary.splitTransactionsImported, {
            one: `Imported # split transaction.`,
            other: `Imported # split transactions.`,
          })
        );
      }
      if (importResult.summary.accountBalancesVerified !== undefined) {
        summaryParts.push(
          plural(importResult.summary.accountBalancesVerified, {
            one: `Verified # account balance against YNAB.`,
            other: `Verified # account balances against YNAB.`,
          })
        );
      } else {
        summaryParts.push(t`Review imported account types before budgeting.`);
      }
      ynabSummaryDescription = summaryParts.join(' ');
    } else {
      const result = await runtime.mutationsRouter().execute<number>({
        op: 'budgets.create',
        payload: {
          name: state.budgetName.trim() || t`My budget`,
          displayCurrency: state.currency,
          badgeIcon: '💰',
          numberFormat: '$1,096.56',
          createDefaultCategories: false,
          spaceId,
        },
        spaceId,
        meta: { label: 'onboarding.addBudget' },
      });
      budgetId = result.result;
      startFirstSteps(spaceId, profileId);
    }

    // Tell the UI store which budget we just made — otherwise the
    // BudgetRequired gate would re-show because useUiStore.selectedBudget
    // stays null and resolveBudgetGate doesn't auto-settle on the first
    // pass. Matches what useAddBudget does on success.
    syncBudgetStateFromRuntime({
      runtime,
      queryClient,
      spaceId,
      preferredBudgetId: budgetId,
    });
    await queryClient.invalidateQueries({ queryKey: getBudgetsQueryKey(spaceId) });

    // 5. Fresh path only — accounts and categories. No goal: a goal is the
    // user's own decision, made in the budget.
    if (state.startMode === 'fresh') {
      for (const a of state.accounts) {
        const typeDef = ACCOUNT_TYPES.find((t) => t.id === a.type) ?? ACCOUNT_TYPES[0];
        const name = a.name.trim() || i18n._(typeDef.name);
        // For a credit card the field asks for the amount OWED (a positive
        // magnitude); the account balance for a debt is negative. Assets take
        // the entered balance as-is. abs() keeps it correct even if a user
        // types the minus sign themselves.
        const enteredAmount = Number(a.balance || 0);
        const signedBalance = typeDef.isDebt ? -Math.abs(enteredAmount) : enteredAmount;
        try {
          await runtime.mutationsRouter().execute({
            op: 'accounts.create',
            payload: {
              name,
              budgetId,
              type: typeDef.coreType,
              currency: state.currency,
              // User-typed decimal → integer milliunits at the op boundary.
              balance: fromDecimal(signedBalance),
              metadata: {},
              onBudget: typeDef.onBudget,
            },
            spaceId,
            meta: { label: 'onboarding.createAccount' },
          });
        } catch (err) {
          console.warn('[Onboarding] Account create failed', name, err);
        }
      }

      // Category groups + categories.
      const groupBuckets = new Map<string, string[]>();
      for (const cat of state.selectedCats) {
        const groupKey = CATEGORY_TO_GROUP[cat] ?? 'needs';
        const groupName = i18n._(CATEGORY_PRESETS[groupKey].label);
        const bucket = groupBuckets.get(groupName) ?? [];
        bucket.push(cat);
        groupBuckets.set(groupName, bucket);
      }
      for (const [groupLabel, cats] of groupBuckets) {
        try {
          const groupRes = await runtime.mutationsRouter().execute<number>({
            op: 'categoryGroups.create',
            payload: { name: groupLabel, budgetId },
            spaceId,
            meta: { label: 'onboarding.createGroup' },
          });
          const parentId = groupRes.result;
          for (const cat of cats) {
            const name = CATEGORY_ITEM_LABELS[cat] ? i18n._(CATEGORY_ITEM_LABELS[cat]) : cat;
            await runtime.mutationsRouter().execute<number>({
              op: 'categories.create',
              payload: {
                name,
                parentId,
                budgetId,
                note: '',
              },
              spaceId,
              meta: { label: 'onboarding.createCategory' },
            });
          }
        } catch (err) {
          console.warn('[Onboarding] Group/category create failed', groupLabel, err);
        }
      }
    }

    // 6. Snapshot finalize — only needed for YNAB import, which bypasses
    // the mutation router and writes straight to the DB. Router-created
    // objects (accounts/categories/goal in the fresh path) already get
    // synced by the mutation flow, so calling finalize here would
    // unnecessarily reseed the sync cursor.
    if (isYnab) {
      try {
        await runtime.finalizeOutOfBandMutation({ uploadSnapshot: true });
      } catch (err) {
        console.warn('[Onboarding] Snapshot finalize failed (non-fatal)', err);
      }
    }

    // 7. Keep the YNAB verification report inside the onboarding gate until
    // the user explicitly opens the imported budget. None of the completion
    // flags below may move ahead of this wait: each can make
    // StartupController replace OnboardingFlow with the dashboard.
    if (ynabImportResult) {
      // Register the continuation before painting the completed state so an
      // immediate click cannot race ahead of the suspended pipeline.
      const continueFromYnabReport = waitForYnabContinue();
      await onYnabProgress({
        stage: 'complete',
        status: 'passed',
        progress: 100,
        label:
          ynabImportResult.verification?.status === 'warning'
            ? t`Imported budget saved with warnings`
            : t`Imported budget saved`,
        detail: ynabSummaryDescription || undefined,
      });
      toast.success(t`YNAB import complete`, { description: ynabSummaryDescription });
      if (!(await continueFromYnabReport)) return;
    }

    // The new workspace is complete: a later error must not discard it.
    attempt.spaceId = null;

    // The real budget exists now, so the demo can go (only when proven to be
    // the demo, see above). If deleting it fails it stays as an ordinary
    // workspace the owner can delete in Settings.
    if (fromDemo && demoSpaceId && demoSpaceId !== spaceId) {
      try {
        await removeDemoWorkspace(runtime, queryClient, demoSpaceId);
      } catch (err) {
        console.warn('[Onboarding] Could not delete the demo workspace', err);
      }
    }

    // 8. Tell the server master password is set so future sign-ins skip
    // onboarding. Then mark onboarding completed + intro acknowledged so
    // the StartupController gates pass and we route to the dashboard. For a
    // YNAB import this runs only after "Open imported budget" is clicked.
    try {
      await authApi.setMasterPasswordStatus(true);
    } catch (err) {
      console.warn('[Onboarding] Failed to mark master password set on server', err);
    }
    // Leaving the demo: onboarding was completed when the demo opened, and
    // repeating it would move onboarding_completed_at on the server.
    if (!fromDemo) {
      try {
        await updateOnboardingAsync({
          status: 'completed',
          snoozed_until: null,
          where_heard_about: whereHeard,
        });
      } catch (err) {
        console.warn('[Onboarding] Failed to mark onboarding completed', err);
      }
    }
    writeIntroAcknowledged(profileId ?? null);

    // 9. Refresh every cached query so the dashboard lands on real data,
    // then release the intro gate.
    await queryClient.invalidateQueries();
    onComplete();
  } catch (err) {
    // Invite failures (expired, cancelled, no seat…) get a message the
    // invitee can act on instead of the raw server reply.
    const inviteProblem = isJoinPath ? classifyInviteError(err) : null;
    const message = inviteProblem
      ? inviteProblemMessage(inviteProblem)
      : getErrorMessage(err, t`Setup failed. Try again or contact support.`);
    console.error('[Onboarding] Apply failed', err);
    setApplyError(message);
    setApplyStatus('error');
    toast.error(t`Setup failed`, {
      description: message,
    });
  }
}
