// Plain, React-free implementation of the onboarding "apply" pipeline —
// extracted verbatim from OnboardingFlow's `applyOnboarding` useCallback so
// it can be unit-tested by mocking `deps` instead of rendering the flow.
//
// The pipeline has to run in order: master password → workspace → runtime
// init → budget (or YNAB import) → accounts/categories/goal → invites →
// theme → intro acknowledged. Invites come after the workspace + master
// password because they encrypt the space key for each recipient. The
// numbered step comments below are load-bearing — they document *why* the
// ordering can't be reshuffled, not just what each step does.
import type { QueryClient } from '@tanstack/react-query';
import type { NavigateFunction } from 'react-router-dom';
import { toast } from 'sonner';
import type { DatabaseAdapter } from '@budgero/core/browser';
import { YNABImportService, GoalPurpose, GoalType } from '@budgero/core/browser';
import { MasterPasswordManager } from '@shared/lib/crypto';
import { getErrorMessage } from '@shared/lib/errors';
import { authApi, spaceApi } from '@shared/api/api-client';
import type { AppRuntime } from '@shared/runtime/app-runtime';
import {
  decryptSpaceKeyFromInvite,
  encryptSpaceKeyForInvite,
  generateInviteSecret,
  hashInviteSecret,
  wrapSpaceKeyWithMaster,
} from '@budgero/runtime';
import type { UpdateOnboardingInput } from '@entities/user/api/useAuth';
import { writeIntroAcknowledged } from '@features/onboarding/lib/onboarding-intro';
import { isAppThemeId, type AppThemeId } from '@shared/lib/theme/presets';
import { getTodayISO } from '@shared/lib/date-utils';
import { fromDecimal } from '@shared/lib/currency/milli';
import { getBudgetsQueryKey, syncBudgetStateFromRuntime } from '@shared/runtime/budget-gate';
import { BUDGET_SPACES_QUERY_KEY } from '@features/budget-sharing/lib/workspaces/queries';
import type { BudgetSpaceSummary } from '@shared/model/budget-spaces';
import { buildJoinUrl } from '@features/budget-sharing/lib/workspace-invites';
import {
  PENDING_ONBOARDING_INVITES_EVENT,
  PENDING_ONBOARDING_INVITES_KEY,
} from '@features/budget-sharing/ui/OnboardingInviteShareDialog';
import { clearPendingSpaceInvite } from '@features/budget-sharing/lib/pending-space-invite';
import {
  ACCOUNT_TYPES,
  CATEGORY_PRESETS,
  CATEGORY_TO_GROUP,
  resolveHeardValue,
  type ActivePath,
  type InviteFailure,
  type InviteResult,
  type OnboardingFormState,
} from './onboarding-data';

export interface OnboardingApplyDeps {
  activePath: ActivePath;
  runtime: AppRuntime;
  queryClient: QueryClient;
  navigate: NavigateFunction;
  profileId: string | undefined;
  setThemeId: (id: AppThemeId) => void;
  updateOnboardingAsync: (input: UpdateOnboardingInput) => Promise<void>;
  onComplete: () => void;
  setApplyStatus: (status: 'idle' | 'running' | 'error') => void;
  setApplyError: (message: string | null) => void;
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
    setThemeId,
    updateOnboardingAsync,
    onComplete,
    setApplyStatus,
    setApplyError,
  } = deps;

  setApplyStatus('running');
  setApplyError(null);
  // Referral source from the optional "How did you hear about us?" step.
  // Empty when skipped — the server leaves the field untouched in that case.
  const whereHeard = resolveHeardValue(state.heardSource, state.heardOther);
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
    if (activePath === 'join' && state.joinSecret) {
      const token = await hashInviteSecret(state.joinSecret);
      const inspection = await spaceApi.inspectInvite(token);
      if (!inspection.encrypted_bundle) {
        throw new Error(
          'This invite is missing its encrypted bundle. Ask the workspace owner to resend.'
        );
      }
      const spaceKey = await decryptSpaceKeyFromInvite(
        inspection.encrypted_bundle,
        state.joinSecret
      );
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
      clearPendingSpaceInvite();
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
    await MasterPasswordManager.store(state.password);

    // 2. Workspace. createSpace returns a fresh BudgetSpaceSummary; the
    // space row exists server-side from this point on.
    const summary = await spaceApi.createSpace(state.budgetName.trim() || 'My budget');
    const spaceId = summary.space_id;

    // 3. Initialise the runtime so services + opcodes have a DB to talk to.
    // Pull the space list so refreshSpaces picks up the new one, then
    // switchSpace activates it (which also wires service-level fixtures).
    if (!runtime.isInitialized()) {
      await runtime.init({ masterPassword: state.password, queryClient });
    }
    await runtime.refreshSpaces();
    await runtime.switchSpace(spaceId);

    // 4. Budget. Fresh path uses the budgets.create op; YNAB path runs the
    // core YNAB importer which creates its own budget record (out-of-band,
    // bypasses the router).
    let budgetId: number;
    const isYnab = state.startMode === 'ynab' && state.ynabFile;
    if (isYnab && state.ynabFile) {
      const db = runtime.getDatabase();
      if (!db) {
        throw new Error('Database not ready — try again in a moment.');
      }
      const importService = new YNABImportService(db as unknown as DatabaseAdapter);
      budgetId = await importService.importYNABFromZip(state.ynabFile.bytes, {
        budgetName: state.budgetName.trim() || 'My budget',
        currency: state.currency,
        numberFormat: '$1,096.56',
        badgeIcon: '💰',
      });
    } else {
      const result = await runtime.mutationsRouter().execute<number>({
        op: 'budgets.create',
        payload: {
          name: state.budgetName.trim() || 'My budget',
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

    // 5. Fresh path only — accounts, categories, goals.
    let goalCategoryId: number | null = null;
    if (state.startMode === 'fresh') {
      for (const a of state.accounts) {
        const typeDef = ACCOUNT_TYPES.find((t) => t.id === a.type) ?? ACCOUNT_TYPES[0];
        const name = a.name.trim() || typeDef.name;
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

      // Category groups + categories. Track group ids by label so the goal
      // step below can drop a goal envelope into SAVINGS without creating
      // a duplicate group.
      const groupBuckets = new Map<string, string[]>();
      for (const cat of state.selectedCats) {
        const groupKey = CATEGORY_TO_GROUP[cat] ?? 'needs';
        const { label } = CATEGORY_PRESETS[groupKey];
        const bucket = groupBuckets.get(label) ?? [];
        bucket.push(cat);
        groupBuckets.set(label, bucket);
      }
      const groupIdByLabel = new Map<string, number>();
      for (const [groupLabel, cats] of groupBuckets) {
        try {
          const groupRes = await runtime.mutationsRouter().execute<number>({
            op: 'categoryGroups.create',
            payload: { name: groupLabel, budgetId },
            spaceId,
            meta: { label: 'onboarding.createGroup' },
          });
          const parentId = groupRes.result;
          groupIdByLabel.set(groupLabel, parentId);
          for (const cat of cats) {
            const catRes = await runtime.mutationsRouter().execute<number>({
              op: 'categories.create',
              payload: { name: cat, parentId, budgetId, note: '' },
              spaceId,
              meta: { label: 'onboarding.createCategory' },
            });
            if (goalCategoryId == null && cat.toLowerCase() === state.goal.label.toLowerCase()) {
              goalCategoryId = catRes.result;
            }
          }
        } catch (err) {
          console.warn('[Onboarding] Group/category create failed', groupLabel, err);
        }
      }

      // Materialize the picked goal as a real envelope under SAVINGS when
      // the user's selected envelopes didn't already include one by that
      // name. Every goal template the user can pick is savings-oriented, so
      // SAVINGS is always the right home. Skip the placeholder "Something
      // else" label — that means the user picked Custom but didn't rename.
      const goalLabel = state.goal.label.trim();
      const goalIsUsable = goalLabel.length > 0 && goalLabel.toLowerCase() !== 'something else';
      if (state.goal.target > 0 && goalIsUsable && goalCategoryId == null) {
        const savingsLabel = CATEGORY_PRESETS.savings.label;
        try {
          let savingsGroupId = groupIdByLabel.get(savingsLabel);
          if (savingsGroupId == null) {
            const groupRes = await runtime.mutationsRouter().execute<number>({
              op: 'categoryGroups.create',
              payload: { name: savingsLabel, budgetId },
              spaceId,
              meta: { label: 'onboarding.createGoalGroup' },
            });
            savingsGroupId = groupRes.result;
            groupIdByLabel.set(savingsLabel, savingsGroupId);
          }
          const catRes = await runtime.mutationsRouter().execute<number>({
            op: 'categories.create',
            payload: {
              name: goalLabel,
              parentId: savingsGroupId,
              budgetId,
              note: '',
            },
            spaceId,
            meta: { label: 'onboarding.createGoalCategory' },
          });
          goalCategoryId = catRes.result;
        } catch (err) {
          console.warn('[Onboarding] Goal category create failed', err);
        }
      }

      if (state.goal.target > 0 && goalCategoryId != null) {
        const today = getTodayISO();
        // Map the onboarding mode to Budgero's two savings shapes:
        //   monthly → MONTHLY_SAVINGS  (set aside X each month, no end date)
        //   target  → TARGET_DATE      (allocate X total by YYYY-MM-DD)
        // Matches GoalForm.tsx's 'monthly-allocation' and 'yearly-allocation'
        // presets so goals created here look native in the budget UI.
        const isMonthly = state.goal.mode === 'monthly';
        const goalType = isMonthly ? GoalType.MONTHLY_SAVINGS : GoalType.TARGET_DATE;
        const endDate = isMonthly ? today : state.goal.targetDate;
        try {
          await runtime.mutationsRouter().execute({
            op: 'goals.create',
            payload: {
              goalType,
              purpose: GoalPurpose.SAVINGS,
              categoryId: goalCategoryId,
              // User-typed decimal → integer milliunits at the op boundary.
              target: fromDecimal(state.goal.target),
              startDate: today,
              endDate,
              recurring: false,
              budgetId,
            },
            spaceId,
            meta: { label: 'onboarding.createGoal' },
          });
        } catch (err) {
          console.warn('[Onboarding] Goal create failed', err);
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

    // 7. Invites. Invite bundle encrypts the space key with the invite
    // secret, so we need the active space + master password first. The
    // secret never leaves this client — we hand it to the owner on the
    // Done screen as a /join#code=... URL, and they route it to the
    // recipient however they want. Nothing server- or Resend-side sees it.
    // Failures are tracked alongside successes so the user always sees
    // *some* outcome rather than a silent drop to the dashboard.
    const results: InviteResult[] = [];
    const failures: InviteFailure[] = [];
    const validInvites = state.invites.filter((inv) => inv.email.trim().length > 0);
    if (validInvites.length > 0) {
      try {
        const spaceKey = await runtime.requireSpaceKey(spaceId);
        for (const inv of validInvites) {
          const email = inv.email.trim();
          try {
            const secret = generateInviteSecret();
            const token = await hashInviteSecret(secret);
            const invite = await spaceApi.createInvite(spaceId, email, token, undefined);
            const bundle = await encryptSpaceKeyForInvite(spaceKey, secret);
            await spaceApi.attachInviteBundle(spaceId, invite.id, bundle);
            results.push({
              email,
              secret,
              url: buildJoinUrl(secret),
            });
          } catch (err) {
            console.warn('[Onboarding apply] Invite create failed for', email, err);
            failures.push({
              email,
              reason: getErrorMessage(err, 'unknown error'),
            });
          }
        }
      } catch (err) {
        console.warn('[Onboarding apply] Could not resolve space key for invites', err);
        for (const inv of validInvites) {
          failures.push({
            email: inv.email.trim(),
            reason:
              err instanceof Error
                ? `Encryption setup failed: ${err.message}`
                : 'Encryption setup failed.',
          });
        }
      }
    }

    // 8. Theme. Preset is ignored if the id doesn't match what the theme
    // system knows about; fall back to default silently.
    if (isAppThemeId(state.theme)) {
      setThemeId(state.theme);
    }

    // 9. Persist invite payload to sessionStorage so the dashboard-mounted
    // OnboardingInviteShareDialog can pick it up and surface the share
    // links there. Hosting that UI here is fragile because flipping the
    // server-side "you're done" flags causes StartupController to unmount
    // the entire onboarding tree mid-render — sessionStorage survives.
    if (results.length > 0) {
      try {
        sessionStorage.setItem(PENDING_ONBOARDING_INVITES_KEY, JSON.stringify(results));
        // Wake any already-mounted dashboard dialog that pre-rendered
        // before this write landed.
        window.dispatchEvent(new Event(PENDING_ONBOARDING_INVITES_EVENT));
      } catch (err) {
        console.warn('[Onboarding] Failed to stash invite payload for dialog', err);
      }
    }

    // 10. Tell the server master password is set so future signs-in skip
    // onboarding. Then mark onboarding completed + intro acknowledged so
    // the StartupController gates pass and we route to the dashboard.
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

    // 11. Refresh every cached query so the dashboard lands on real data,
    // then release the intro gate.
    await queryClient.invalidateQueries();
    onComplete();
  } catch (err) {
    const message = getErrorMessage(err, 'Setup failed. Try again or contact support.');
    console.error('[Onboarding] Apply failed', err);
    setApplyError(message);
    setApplyStatus('error');
    toast.error('Setup failed', {
      description: message,
    });
  }
}
