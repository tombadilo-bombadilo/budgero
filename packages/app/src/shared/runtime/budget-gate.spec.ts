import { describe, expect, it } from 'vitest';
import type { Budget } from '@budgero/core/browser';
import type { BudgetSpaceSummary } from '@shared/model/budget-spaces';
import { readBudgetsForSpace, resolveBudgetGate, resolveBudgetSelection } from './budget-gate';

function createBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    ID: 1,
    SpaceID: 'space-a',
    Name: 'Main budget',
    DisplayCurrency: 'USD',
    BadgeIcon: 'Wallet',
    NumberFormat: '$1,096.56',
    ...overrides,
  };
}

function createSpace(overrides: Partial<BudgetSpaceSummary> = {}): BudgetSpaceSummary {
  return {
    space_id: 'space-a',
    display_name: 'Workspace A',
    owner_user_id: 'owner-1',
    role: 'owner',
    invitation_status: 'accepted',
    encrypted_space_key: 'encrypted-key',
    is_accessible: true,
    access_reason: 'active',
    created_at: '2026-03-16T10:00:00.000Z',
    updated_at: '2026-03-16T10:00:00.000Z',
    ...overrides,
  };
}

describe('resolveBudgetGate', () => {
  it('falls back to the active database budgets when scoped space rows are empty', () => {
    const legacyBudget = createBudget({
      ID: 7,
      SpaceID: 'legacy-space',
      Name: 'Imported shared budget',
    });
    const runtime = {
      services: () => ({
        budgets: {
          getAllBudgets: (spaceId?: string) => (spaceId ? [] : [legacyBudget]),
        },
      }),
    };

    expect(readBudgetsForSpace(runtime as never, 'space-a')).toEqual([legacyBudget]);
  });

  it('returns required for owners in a workspace with zero budgets', () => {
    const resolution = resolveBudgetGate({
      budgets: [],
      isPending: false,
      candidateSelectedBudget: null,
      storedDefaultBudgetId: null,
      canManageBudgets: true,
      availableSpaces: [createSpace()],
      activeSpaceId: 'space-a',
    });

    expect(resolution.status).toBe('required');
    expect(resolution.selectedBudget).toBeNull();
    expect(resolution.alternativeWorkspaces).toEqual([]);
  });

  it('returns blocked for non-owners in a workspace with zero budgets and lists alternatives', () => {
    const resolution = resolveBudgetGate({
      budgets: [],
      isPending: false,
      candidateSelectedBudget: null,
      storedDefaultBudgetId: null,
      canManageBudgets: false,
      availableSpaces: [
        createSpace({ space_id: 'space-a', role: 'viewer' }),
        createSpace({ space_id: 'space-b', display_name: 'Workspace B', role: 'editor' }),
        createSpace({
          space_id: 'space-c',
          display_name: 'Locked Workspace',
          role: 'viewer',
          is_accessible: false,
        }),
      ],
      activeSpaceId: 'space-a',
    });

    expect(resolution.status).toBe('blocked');
    expect(resolution.selectedBudget).toBeNull();
    expect(resolution.alternativeWorkspaces.map((space) => space.space_id)).toEqual(['space-b']);
  });

  it('uses the stored default budget when it exists in the active workspace', () => {
    const budgets = [
      createBudget({ ID: 1, Name: 'Household' }),
      createBudget({ ID: 2, Name: 'Business' }),
    ];
    const resolution = resolveBudgetGate({
      budgets,
      isPending: false,
      candidateSelectedBudget: null,
      storedDefaultBudgetId: 2,
      canManageBudgets: true,
      availableSpaces: [createSpace()],
      activeSpaceId: 'space-a',
    });

    expect(resolution.status).toBe('loading');
    expect(resolution.selectedBudget?.ID).toBe(2);
    expect(resolution.clearStoredDefault).toBe(false);
  });

  it('replaces a stale selected budget with the first valid budget when the default is invalid', () => {
    const budgets = [
      createBudget({ ID: 9, Name: 'Primary' }),
      createBudget({ ID: 10, Name: 'Secondary' }),
    ];
    const resolution = resolveBudgetSelection({
      budgets,
      candidateSelectedBudget: createBudget({ ID: 2, Name: 'Removed budget' }),
      storedDefaultBudgetId: 99,
    });

    expect(resolution.selectedBudget?.ID).toBe(9);
    expect(resolution.clearStoredDefault).toBe(true);
  });

  it('refreshes the selected budget object when switching workspaces with overlapping ids', () => {
    const staleBudget = createBudget({
      ID: 1,
      SpaceID: 'space-a',
      Name: 'Workspace A budget',
      BadgeIcon: 'Wallet',
    });
    const resolution = resolveBudgetSelection({
      budgets: [
        createBudget({
          ID: 1,
          SpaceID: 'space-b',
          Name: 'Workspace B budget',
          BadgeIcon: 'Sparkles',
        }),
      ],
      candidateSelectedBudget: staleBudget,
      storedDefaultBudgetId: null,
    });

    expect(resolution.selectedBudget).not.toBe(staleBudget);
    expect(resolution.selectedBudget).toMatchObject({
      ID: 1,
      SpaceID: 'space-b',
      Name: 'Workspace B budget',
      BadgeIcon: 'Sparkles',
    });
  });
});
