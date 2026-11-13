import { useUiStore } from '@shared/store/useUiStore';
import { budgetTargetColumnPreference, languagePreference } from './personal-preferences';

const saved = vi.hoisted(() => [] as [string, unknown][]);
vi.mock('@shared/lib/synced-state/synced-preferences', async (original) => ({
  ...(await original<object>()),
  saveSyncedPreference: (key: string, value: unknown) => saved.push([key, value]),
}));

beforeEach(() => {
  localStorage.clear();
  saved.length = 0;
  useUiStore.setState({ showBudgetTargetColumn: false });
});

it('tells a default target column from one the user set, and syncs only user toggles', () => {
  expect(budgetTargetColumnPreference.readLocal()).toEqual({ value: false, explicit: false });
  useUiStore.getState().toggleBudgetTargetColumn();
  useUiStore.getState().toggleBudgetTargetColumn();
  // Turned off by the user is still a choice: cached as '0', not removed.
  expect(localStorage.getItem('budgero:budget-target-column')).toBe('0');
  expect(budgetTargetColumnPreference.readLocal()).toEqual({ value: false, explicit: true });
  expect(saved).toEqual([
    ['budgetTargetColumn', true],
    ['budgetTargetColumn', false],
  ]);

  void budgetTargetColumnPreference.apply(true);
  expect(useUiStore.getState().showBudgetTargetColumn).toBe(true);
  expect(localStorage.getItem('budgero:budget-target-column')).toBe('1');
  expect(saved).toHaveLength(2);
});

it('treats only a language picked in settings as explicit', () => {
  expect(languagePreference.readLocal().explicit).toBe(false);
  localStorage.setItem('budgero_locale_v1', 'de');
  expect(languagePreference.readLocal()).toEqual({ value: 'de', explicit: true });
  expect(languagePreference.isValid('xx')).toBe(false);
});
