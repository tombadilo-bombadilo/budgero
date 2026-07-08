import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  Check,
  Lock,
  Mail,
  PencilLine,
  Plus,
  Settings,
  Star,
  Users,
  Wallet,
} from 'lucide-react';
import { Spinner } from '@shared/ui/spinner';
import { Button } from '@shared/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@shared/ui/collapsible';
import { Skeleton } from '@shared/ui/skeleton';
import { useBudgets } from '@entities/budget/api/useBudgets';
import { useUiStore } from '@shared/store/useUiStore';
import { getBudgetIconComponent } from '@features/budget-management/model/icon-options';
import type { Budget } from '@budgero/core/browser';
import type { BudgetSpaceSummary } from '@shared/model/budget-spaces';
import { cn } from '@shared/lib/utils';
import { buttonizeProps } from '@shared/lib/a11y';
import { toast } from 'sonner';
import {
  clearStoredDefaultBudgetId,
  getStoredDefaultBudgetId,
  setStoredDefaultBudgetId,
} from '@shared/runtime/workspace-preferences';
import { useActiveSpaceId, useAvailableSpaces, useRuntime } from '@shared/runtime/runtime-provider';
import { switchWorkspaceAndSyncBudgetState } from '@shared/runtime/budget-gate';
import { getErrorMessage } from '@shared/lib/errors';

type Variant = 'sidebar' | 'popover';

interface WorkspaceBudgetListProps {
  variant: Variant;
  onItemSelected?: () => void;
  onEditBudget: (budget: Budget) => void;
  onCreateBudget: () => void;
}

export function WorkspaceBudgetList({
  variant,
  onItemSelected,
  onEditBudget,
  onCreateBudget,
}: WorkspaceBudgetListProps) {
  const navigate = useNavigate();
  const runtime = useRuntime();
  const queryClient = useQueryClient();

  const selectedBudget = useUiStore((s) => s.selectedBudget);
  const setSelectedBudget = useUiStore((s) => s.setSelectedBudget);
  const { data: budgets = [], isLoading: budgetsLoading } = useBudgets();

  const spaces = useAvailableSpaces();
  const activeSpaceId = useActiveSpaceId();

  const [defaultBudgetId, setDefaultBudgetId] = useState<number | null>(() =>
    getStoredDefaultBudgetId()
  );
  const [switchingSpaceId, setSwitchingSpaceId] = useState<string | null>(null);

  const { activeSpace, otherSpaces, lockedSpaces, pendingSpaces } = useMemo(() => {
    const accepted = spaces.filter((s) => s.invitation_status === 'accepted');
    const accessible = accepted.filter((s) => s.is_accessible !== false);
    const locked = accepted.filter((s) => s.is_accessible === false);
    const active = accessible.find((s) => s.space_id === activeSpaceId) ?? null;
    const others = accessible.filter((s) => s.space_id !== activeSpaceId);
    const pending = spaces.filter((s) => s.invitation_status !== 'accepted');
    return {
      activeSpace: active,
      otherSpaces: others,
      lockedSpaces: locked,
      pendingSpaces: pending,
    };
  }, [spaces, activeSpaceId]);

  // Keep stored default in sync with the active workspace's budgets.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const storedId = getStoredDefaultBudgetId();
      if (storedId != null && !budgets.some((b) => b.ID === storedId)) {
        clearStoredDefaultBudgetId();
        if (defaultBudgetId !== null) setDefaultBudgetId(null);
        return;
      }
      const normalizedStored = storedId ?? null;
      if (normalizedStored !== defaultBudgetId) setDefaultBudgetId(normalizedStored);
    });
    return () => cancelAnimationFrame(id);
  }, [budgets, defaultBudgetId]);

  const getBudgetIcon = (badgeIcon: string) => {
    const Icon = getBudgetIconComponent(badgeIcon);
    return Icon ? <Icon className="h-4 w-4" /> : null;
  };

  const handleChangeBudget = (budget: Budget) => {
    if (selectedBudget?.ID !== budget.ID) {
      setSelectedBudget(budget);
      toast.success('Budget switched', { description: `Switched to "${budget.Name}".` });
      void navigate('/', { replace: true });
    }
    onItemSelected?.();
  };

  const handleToggleDefault = (budget: Budget) => {
    const nextId = defaultBudgetId === budget.ID ? null : budget.ID;
    setDefaultBudgetId(nextId);
    setStoredDefaultBudgetId(nextId);
    if (nextId) {
      toast.success('Default budget set', {
        description: `${budget.Name} will open automatically next time.`,
      });
    } else {
      toast.success('Default budget cleared', {
        description: 'Budgets will open in list order.',
      });
    }
  };

  const handleSwitchSpace = async (space: BudgetSpaceSummary) => {
    if (space.space_id === activeSpaceId || switchingSpaceId) return;
    try {
      setSwitchingSpaceId(space.space_id);
      await switchWorkspaceAndSyncBudgetState({
        runtime,
        queryClient,
        spaceId: space.space_id,
      });
      toast.success('Workspace switched', {
        description: `You are now in "${space.display_name}".`,
      });
      void navigate('/', { replace: true });
    } catch (error) {
      const message = getErrorMessage(error, 'Unable to switch workspace. Please try again.');
      toast.error('Unable to switch workspace', { description: message });
    } finally {
      setSwitchingSpaceId(null);
    }
  };

  const handleOpenWorkspaceSettings = () => {
    void navigate('/settings/workspaces');
    onItemSelected?.();
  };

  const rowBaseClass =
    'flex cursor-pointer items-center justify-between gap-2 rounded-lg p-2 text-sm transition-colors';
  const rowHoverClass =
    variant === 'sidebar'
      ? 'hover:bg-sidebar-accent hover:text-foreground'
      : 'hover:bg-accent hover:text-accent-foreground';

  return (
    <div className="space-y-3" data-testid="workspace-budget-list">
      {/* Active workspace + its budgets */}
      <section className="space-y-1">
        <div className="flex items-center gap-2 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          <span className="truncate">{activeSpace?.display_name ?? 'Workspace'}</span>
        </div>

        {budgetsLoading ? (
          <div className="space-y-2 px-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : budgets.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">No budgets yet</div>
        ) : (
          <div className="space-y-0.5">
            {budgets.map((budget) => {
              const isSelected = selectedBudget?.ID === budget.ID;
              const isDefault = defaultBudgetId === budget.ID;
              const canEdit = activeSpace?.role === 'owner';
              return (
                <div
                  key={budget.ID}
                  className={cn(
                    rowBaseClass,
                    rowHoverClass,
                    'ml-4',
                    // Default is indicated by the filled star only — a row
                    // highlight here would compete with the selected state.
                    isSelected && 'bg-sidebar-accent text-sidebar-accent-foreground'
                  )}
                  {...buttonizeProps(() => handleChangeBudget(budget))}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex aspect-square h-5 items-center justify-center rounded-sm bg-muted p-1">
                      {getBudgetIcon(budget.BadgeIcon) || <Wallet className="h-3.5 w-3.5" />}
                    </div>
                    <span className="truncate">{budget.Name}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={isDefault ? 'Clear default budget' : 'Set as default budget'}
                      className={cn(
                        'h-6 w-6 text-muted-foreground',
                        isDefault && 'text-amber-500 dark:text-amber-300'
                      )}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleToggleDefault(budget);
                      }}
                    >
                      <Star className={cn('h-3.5 w-3.5', isDefault && 'fill-current')} />
                    </Button>
                    {isSelected && canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Manage budget"
                        data-testid="manage-budget-button"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onEditBudget(budget);
                        }}
                      >
                        <PencilLine className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeSpace?.role === 'owner' && (
          <div
            className={cn(rowBaseClass, rowHoverClass, 'ml-4 text-muted-foreground')}
            {...buttonizeProps(() => {
              onCreateBudget();
              onItemSelected?.();
            })}
          >
            <span className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Create New Budget
            </span>
          </div>
        )}
      </section>

      {/* Other accessible workspaces */}
      {otherSpaces.length > 0 && (
        <section className="space-y-1 border-t border-border pt-3">
          <div className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Other workspaces
          </div>
          <div className="space-y-0.5">
            {otherSpaces.map((space) => {
              const isSwitching = switchingSpaceId === space.space_id;
              return (
                <div
                  key={space.space_id}
                  className={cn(rowBaseClass, rowHoverClass, isSwitching && 'opacity-70')}
                  {...buttonizeProps(() => {
                    void handleSwitchSpace(space);
                  })}
                  aria-disabled={isSwitching}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{space.display_name}</span>
                  </div>
                  {isSwitching ? (
                    <Spinner className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <span className="text-xs text-muted-foreground">Switch</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Locked workspaces (subscription expired etc.) */}
      {lockedSpaces.length > 0 && (
        <section className="space-y-1 border-t border-border pt-3">
          <Collapsible defaultOpen={false}>
            <CollapsibleTrigger asChild>
              <div
                className={cn(
                  rowBaseClass,
                  rowHoverClass,
                  'text-xs font-medium uppercase tracking-wide text-muted-foreground'
                )}
              >
                <span className="flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5" />
                  Locked ({lockedSpaces.length})
                </span>
                <ChevronDown className="h-3.5 w-3.5 transition-transform [[data-state=open]_&]:rotate-180" />
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-0.5 space-y-0.5">
              {lockedSpaces.map((space) => (
                <div
                  key={space.space_id}
                  className={cn(
                    rowBaseClass,
                    'cursor-not-allowed text-muted-foreground opacity-60'
                  )}
                  aria-disabled
                  title="This workspace is currently inaccessible"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Lock className="h-4 w-4 shrink-0" />
                    <span className="truncate">{space.display_name}</span>
                  </div>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        </section>
      )}

      {/* Pending invitations */}
      {pendingSpaces.length > 0 && (
        <section className="space-y-1 border-t border-border pt-3">
          <div className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Pending invitations
          </div>
          <div className="space-y-0.5">
            {pendingSpaces.map((space) => (
              <div
                key={space.space_id}
                className={cn(rowBaseClass, rowHoverClass)}
                {...buttonizeProps(handleOpenWorkspaceSettings)}
                title="Open workspace settings to complete the invitation"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{space.display_name}</span>
                </div>
                <span className="text-xs text-muted-foreground capitalize">
                  {space.invitation_status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Footer: Manage workspaces */}
      <div className="border-t border-border pt-2">
        <div
          className={cn(rowBaseClass, rowHoverClass, 'text-muted-foreground')}
          {...buttonizeProps(handleOpenWorkspaceSettings)}
        >
          <span className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Manage workspaces
          </span>
        </div>
      </div>
    </div>
  );
}
