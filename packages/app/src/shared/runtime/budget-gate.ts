import type { QueryClient } from '@tanstack/react-query';
import type { Budget } from '@budgero/core/browser';
import type { BudgetSpaceSummary } from '@shared/model/budget-spaces';
import type { AppRuntime } from '@shared/runtime/app-runtime';
import { useUiStore } from '@shared/store/useUiStore';
import {
  clearStoredDefaultBudgetId,
  getStoredDefaultBudgetId,
} from '@shared/runtime/workspace-preferences';
import { resolveSpaceKey } from '@shared/lib/query-utils';

export type BudgetGateStatus = 'loading' | 'required' | 'blocked' | 'ready';

export interface BudgetSelectionResolution {
  selectedBudget: Budget | null;
  clearStoredDefault: boolean;
}

export interface BudgetGateResolution extends BudgetSelectionResolution {
  status: BudgetGateStatus;
  alternativeWorkspaces: BudgetSpaceSummary[];
}

const BUDGETS_STALE_TIME_MS = 1000 * 60 * 5;

interface ResolveBudgetSelectionInput {
  budgets: Budget[];
  candidateSelectedBudget: Budget | null;
  storedDefaultBudgetId: number | null;
  preferredBudgetId?: number | null;
}

interface ResolveBudgetGateInput {
  budgets: Budget[] | undefined;
  candidateSelectedBudget: Budget | null;
  storedDefaultBudgetId: number | null;
  preferredBudgetId?: number | null;
  isPending: boolean;
  canManageBudgets: boolean;
  availableSpaces: BudgetSpaceSummary[];
  activeSpaceId: string | null;
}

interface SyncBudgetStateInput {
  runtime: Pick<AppRuntime, 'getActiveSpaceId' | 'services'>;
  queryClient: Pick<QueryClient, 'setQueryData'>;
  spaceId?: string | null;
  candidateSelectedBudget?: Budget | null;
  preferredBudgetId?: number | null;
}

export function getBudgetsQueryKey(spaceId: string | null) {
  return ['budgets', resolveSpaceKey(spaceId)] as const;
}

export function getBudgetsQueryOptions(
  runtime: Pick<AppRuntime, 'services'>,
  spaceId: string | null
) {
  return {
    queryKey: getBudgetsQueryKey(spaceId),
    queryFn: async () => {
      if (!spaceId) {
        throw new Error('No active budget space selected');
      }
      return readBudgetsForSpace(runtime, spaceId);
    },
    staleTime: BUDGETS_STALE_TIME_MS,
  };
}

export function readBudgetsForSpace(
  runtime: Pick<AppRuntime, 'services'>,
  spaceId: string
): Budget[] {
  const budgetService = runtime.services().budgets;
  const scopedBudgets = budgetService.getAllBudgets(spaceId);
  if (scopedBudgets.length > 0) {
    return scopedBudgets;
  }

  const allBudgets = budgetService.getAllBudgets();
  if (allBudgets.length === 0) {
    return scopedBudgets;
  }

  // Each workspace uses its own database file. Fall back to the full active DB
  // when legacy/shared data carries mismatched SpaceID values inside that DB.
  return allBudgets;
}

function isAccessibleWorkspace(space: BudgetSpaceSummary): boolean {
  return space.invitation_status === 'accepted' && space.is_accessible !== false;
}

export function getAlternativeWorkspaces(
  availableSpaces: BudgetSpaceSummary[],
  activeSpaceId: string | null
): BudgetSpaceSummary[] {
  return availableSpaces.filter(
    (space) => isAccessibleWorkspace(space) && space.space_id !== activeSpaceId
  );
}

export function budgetsEqual(
  left: Budget | null | undefined,
  right: Budget | null | undefined
): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    left.ID === right.ID &&
    left.Name === right.Name &&
    left.DisplayCurrency === right.DisplayCurrency &&
    left.NumberFormat === right.NumberFormat &&
    left.BadgeIcon === right.BadgeIcon
  );
}

export function resolveBudgetSelection({
  budgets,
  candidateSelectedBudget,
  storedDefaultBudgetId,
  preferredBudgetId = null,
}: ResolveBudgetSelectionInput): BudgetSelectionResolution {
  const preferredBudget =
    preferredBudgetId != null
      ? (budgets.find((budget) => budget.ID === preferredBudgetId) ?? null)
      : null;
  const storedBudget =
    storedDefaultBudgetId != null
      ? (budgets.find((budget) => budget.ID === storedDefaultBudgetId) ?? null)
      : null;
  const clearStoredDefault = storedDefaultBudgetId != null && storedBudget == null;

  if (budgets.length === 0) {
    return {
      selectedBudget: null,
      clearStoredDefault,
    };
  }

  if (preferredBudget) {
    return {
      selectedBudget: preferredBudget,
      clearStoredDefault,
    };
  }

  if (candidateSelectedBudget) {
    const matchingBudget =
      budgets.find((budget) => budget.ID === candidateSelectedBudget.ID) ?? null;
    if (matchingBudget) {
      return {
        selectedBudget: matchingBudget,
        clearStoredDefault,
      };
    }
  }

  return {
    selectedBudget: storedBudget ?? budgets[0] ?? null,
    clearStoredDefault,
  };
}

export function resolveBudgetGate({
  budgets,
  isPending,
  candidateSelectedBudget,
  storedDefaultBudgetId,
  preferredBudgetId = null,
  canManageBudgets,
  availableSpaces,
  activeSpaceId,
}: ResolveBudgetGateInput): BudgetGateResolution {
  const alternativeWorkspaces = getAlternativeWorkspaces(availableSpaces, activeSpaceId);

  if (isPending || budgets == null) {
    return {
      status: 'loading',
      selectedBudget: candidateSelectedBudget,
      clearStoredDefault: false,
      alternativeWorkspaces,
    };
  }

  const selection = resolveBudgetSelection({
    budgets,
    candidateSelectedBudget,
    storedDefaultBudgetId,
    preferredBudgetId,
  });

  if (budgets.length === 0) {
    return {
      status: canManageBudgets ? 'required' : 'blocked',
      selectedBudget: null,
      clearStoredDefault: selection.clearStoredDefault,
      alternativeWorkspaces,
    };
  }

  if (!selection.selectedBudget) {
    return {
      status: 'loading',
      selectedBudget: null,
      clearStoredDefault: selection.clearStoredDefault,
      alternativeWorkspaces,
    };
  }

  return {
    status: budgetsEqual(candidateSelectedBudget, selection.selectedBudget) ? 'ready' : 'loading',
    selectedBudget: selection.selectedBudget,
    clearStoredDefault: selection.clearStoredDefault,
    alternativeWorkspaces,
  };
}

export function syncBudgetStateFromRuntime({
  runtime,
  queryClient,
  spaceId = runtime.getActiveSpaceId(),
  candidateSelectedBudget = useUiStore.getState().selectedBudget,
  preferredBudgetId = null,
}: SyncBudgetStateInput): BudgetSelectionResolution {
  if (!spaceId) {
    const currentSelection = useUiStore.getState().selectedBudget;
    if (currentSelection) {
      useUiStore.getState().setSelectedBudget(null);
    }
    return {
      selectedBudget: null,
      clearStoredDefault: false,
    };
  }

  const budgets = readBudgetsForSpace(runtime, spaceId);
  queryClient.setQueryData(getBudgetsQueryKey(spaceId), budgets);

  const selection = resolveBudgetSelection({
    budgets,
    candidateSelectedBudget,
    storedDefaultBudgetId: getStoredDefaultBudgetId(),
    preferredBudgetId,
  });

  if (selection.clearStoredDefault) {
    clearStoredDefaultBudgetId();
  }

  const currentSelection = useUiStore.getState().selectedBudget;
  if (!budgetsEqual(currentSelection, selection.selectedBudget)) {
    useUiStore.getState().setSelectedBudget(selection.selectedBudget);
  }

  return selection;
}

export async function switchWorkspaceAndSyncBudgetState({
  runtime,
  queryClient,
  spaceId,
  forceSnapshotDownload = true,
}: {
  runtime: Pick<AppRuntime, 'switchSpace' | 'services' | 'getActiveSpaceId'>;
  queryClient: Pick<QueryClient, 'setQueryData'>;
  spaceId: string;
  forceSnapshotDownload?: boolean;
}): Promise<BudgetSelectionResolution> {
  await runtime.switchSpace(spaceId, { forceSnapshotDownload });
  return syncBudgetStateFromRuntime({
    runtime,
    queryClient,
    spaceId,
    candidateSelectedBudget: null,
  });
}
