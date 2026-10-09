import { describe, expect, it, vi } from 'vitest';
import { getUndoSpec } from '@shared/mutations/op-code-registry';

const mocks = vi.hoisted(() => ({
  budgets: {
    getBudget: vi.fn(() => ({
      Name: 'Home',
      BadgeIcon: 'house',
      NumberFormat: '123,456.78',
      RtaMode: 'cumulative',
    })),
  },
  userMeta: {
    getWeekStartsOn: vi.fn(() => 0),
    getAllowOverAssignment: vi.fn(() => false),
    getDuplicateHintSettings: vi.fn(() => ({ enabled: true, windowDays: 3 })),
    getHideZeroAmounts: vi.fn(() => false),
    getInlineTransactionEntry: vi.fn(() => false),
  },
}));

vi.mock('@shared/runtime/global', () => ({
  getRuntime: () => ({
    services: () => mocks,
    mutationsRouter: () => ({ execute: vi.fn() }),
  }),
}));

async function undoFor(op: string, args: Record<string, unknown>) {
  const spec = getUndoSpec(op)!;
  return spec.build(args, undefined, await spec.capture?.(args));
}

describe('settings undo', () => {
  it('restores budget name, icon, number format and RTA mode', async () => {
    expect(await undoFor('budgets.updateName', { id: 1, name: 'Flat' })).toEqual([
      { op: 'budgets.updateName', args: { id: 1, name: 'Home' } },
    ]);
    expect(await undoFor('budgets.updateIcon', { id: 1, icon: 'car' })).toEqual([
      { op: 'budgets.updateIcon', args: { id: 1, icon: 'house' } },
    ]);
    expect(await undoFor('budgets.updateNumberFormat', { id: 1, format: '1 000,00' })).toEqual([
      { op: 'budgets.updateNumberFormat', args: { id: 1, format: '123,456.78' } },
    ]);
    expect(await undoFor('budgets.updateRtaMode', { id: 1, mode: 'monthly' })).toEqual([
      { op: 'budgets.updateRtaMode', args: { id: 1, mode: 'cumulative' } },
    ]);
  });

  it('restores falsy preference values', async () => {
    expect(await undoFor('userPreferences.setWeekStartsOn', { value: 1 })).toEqual([
      { op: 'userPreferences.setWeekStartsOn', args: { value: 0 } },
    ]);
    expect(await undoFor('userPreferences.setAllowOverAssignment', { value: true })).toEqual([
      { op: 'userPreferences.setAllowOverAssignment', args: { value: false } },
    ]);
    expect(await undoFor('userPreferences.setHideZeroAmounts', { value: true })).toEqual([
      { op: 'userPreferences.setHideZeroAmounts', args: { value: false } },
    ]);
    expect(await undoFor('userPreferences.setInlineTransactionEntry', { value: true })).toEqual([
      { op: 'userPreferences.setInlineTransactionEntry', args: { value: false } },
    ]);
    expect(
      await undoFor('userPreferences.setDuplicateHintSettings', { settings: { enabled: false } })
    ).toEqual([
      {
        op: 'userPreferences.setDuplicateHintSettings',
        args: { settings: { enabled: true, windowDays: 3 } },
      },
    ]);
  });
});
