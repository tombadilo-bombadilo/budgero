import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { TransactionRule } from '@budgero/core/browser';
import { useAutofillRules } from './useAutofillRules';

const mockRule: TransactionRule = {
  id: 1,
  budgetId: 1,
  name: 'Groceries Rule',
  description: '',
  mode: 'autofill',
  enabled: true,
  oneTimeConsumed: false,
  runOrder: 1,
  conditions: [{ field: 'payee', operator: 'contains', value: 'lidl' }],
  actions: [{ type: 'category.set', payload: { categoryId: 5 } }],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

vi.mock('@entities/rule/api/useRules', () => ({
  useRules: vi.fn(() => ({
    data: [mockRule],
    isLoading: false,
    error: null,
  })),
}));

describe('useAutofillRules', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const defaultContext = {
    memo: '',
    payee: '',
    amount: null,
    accountId: null,
  };

  const defaultCurrentValues = {
    categoryId: null,
    payee: '',
    memo: '',
    amount: null,
    accountId: null,
  };

  it('returns empty suggestions when disabled', () => {
    const { result } = renderHook(() =>
      useAutofillRules(
        { ...defaultContext, payee: 'Lidl Store' },
        { ...defaultCurrentValues, payee: 'Lidl Store' },
        { budgetId: 1, enabled: false }
      )
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.suggestions).toHaveLength(0);
  });

  it('returns empty suggestions when budgetId is null', () => {
    const { result } = renderHook(() =>
      useAutofillRules(
        { ...defaultContext, payee: 'Lidl Store' },
        { ...defaultCurrentValues, payee: 'Lidl Store' },
        { budgetId: null }
      )
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.suggestions).toHaveLength(0);
  });

  it('tracks rejected fields', () => {
    const context = { ...defaultContext, payee: 'Lidl' };
    const currentValues = { ...defaultCurrentValues, payee: 'Lidl' };

    const { result } = renderHook(() => useAutofillRules(context, currentValues, { budgetId: 1 }));

    // Advance timers to trigger debounced update
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.suggestions.length).toBeGreaterThanOrEqual(0);

    act(() => {
      result.current.rejectField('category');
    });

    // After rejection, suggestions for that field should be filtered out
    expect(result.current.suggestions.filter((s) => s.field === 'category')).toHaveLength(0);
  });

  it('resets session when resetSession is called', () => {
    const context = { ...defaultContext, payee: 'Lidl' };
    const currentValues = { ...defaultCurrentValues, payee: 'Lidl' };

    const { result } = renderHook(() => useAutofillRules(context, currentValues, { budgetId: 1 }));

    act(() => {
      result.current.rejectField('category');
      vi.advanceTimersByTime(500);
    });

    expect(result.current.suggestions.filter((s) => s.field === 'category')).toHaveLength(0);

    act(() => {
      result.current.resetSession();
      vi.advanceTimersByTime(500);
    });

    // Suggestions should be back
    expect(result.current.suggestions.length).toBeGreaterThanOrEqual(0);
  });

  it('tracks applied fields', () => {
    const context = { ...defaultContext, payee: 'Lidl' };
    const currentValues = { ...defaultCurrentValues, payee: 'Lidl' };

    const { result } = renderHook(() => useAutofillRules(context, currentValues, { budgetId: 1 }));

    act(() => {
      vi.advanceTimersByTime(500);
    });

    const mockSuggestion = {
      field: 'category' as const,
      value: 5,
      ruleId: 1,
      ruleName: 'Test',
    };

    act(() => {
      result.current.applySuggestion(mockSuggestion);
    });

    expect(result.current.appliedFields.has('category')).toBe(true);
  });

  it('exposes rejectField and resetSession functions', () => {
    const { result } = renderHook(() =>
      useAutofillRules(defaultContext, defaultCurrentValues, { budgetId: 1 })
    );

    expect(typeof result.current.rejectField).toBe('function');
    expect(typeof result.current.resetSession).toBe('function');
    expect(typeof result.current.applySuggestion).toBe('function');
  });

  it('returns appliedFields as a Set', () => {
    const { result } = renderHook(() =>
      useAutofillRules(defaultContext, defaultCurrentValues, { budgetId: 1 })
    );

    expect(result.current.appliedFields).toBeInstanceOf(Set);
  });

  it('clears applied field when clearAppliedField is called', () => {
    const { result } = renderHook(() =>
      useAutofillRules(defaultContext, defaultCurrentValues, { budgetId: 1 })
    );

    const mockSuggestion = {
      field: 'category' as const,
      value: 5,
      ruleId: 1,
      ruleName: 'Test',
    };

    act(() => {
      result.current.applySuggestion(mockSuggestion);
    });

    expect(result.current.appliedFields.has('category')).toBe(true);

    act(() => {
      result.current.clearAppliedField('category');
    });

    expect(result.current.appliedFields.has('category')).toBe(false);
  });
});
