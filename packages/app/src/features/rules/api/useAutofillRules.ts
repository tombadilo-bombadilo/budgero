import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRules } from '@entities/rule/api/useRules';
import {
  computeAutofillSuggestions,
  type AutofillContext,
  type AutofillSuggestion,
} from '@budgero/core/browser';

const DEBOUNCE_MS = 300;

export interface UseAutofillRulesOptions {
  budgetId: number | null;
  enabled?: boolean;
}

export interface UseAutofillRulesReturn {
  suggestions: AutofillSuggestion[];
  rejectField: (field: string) => void;
  resetSession: () => void;
  applySuggestion: (suggestion: AutofillSuggestion) => void;
  appliedFields: Set<string>;
  appliedSuggestions: AutofillSuggestion[];
  clearAppliedField: (field: string) => void;
  hasRunThisSession: boolean;
}

export function useAutofillRules(
  context: AutofillContext,
  currentValues: {
    categoryId: number | null;
    payee: string;
    memo: string;
    amount: number | null;
    accountId: number | null;
  },
  options: UseAutofillRulesOptions
): UseAutofillRulesReturn {
  const { budgetId, enabled = true } = options;

  const { data: allRules = [] } = useRules(budgetId ?? 0);

  const autofillRules = useMemo(
    () => allRules.filter((r) => r.mode === 'autofill' && r.enabled),
    [allRules]
  );

  // Session flag: once a suggestion is applied, autofill stops suggesting.
  // Reset to false on form submit/reset.
  const [hasRunThisSession, setHasRunThisSession] = useState(false);

  const [rejectedFields, setRejectedFields] = useState<Set<string>>(new Set());

  const [appliedFields, setAppliedFields] = useState<Set<string>>(new Set());

  // Track full details of applied suggestions for audit logging
  const [appliedSuggestions, setAppliedSuggestions] = useState<AutofillSuggestion[]>([]);

  const [debouncedContext, setDebouncedContext] = useState(context);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedContext(context);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [context]);

  // Compute suggestions - only if autofill hasn't run this session
  const suggestions = useMemo(() => {
    if (hasRunThisSession) return [];
    if (!enabled || !budgetId || autofillRules.length === 0) return [];
    return computeAutofillSuggestions(
      autofillRules,
      debouncedContext,
      currentValues,
      rejectedFields,
      { ignoreCurrentValues: true }
    );
  }, [
    enabled,
    budgetId,
    autofillRules,
    debouncedContext,
    currentValues,
    rejectedFields,
    hasRunThisSession,
  ]);

  const rejectField = useCallback((field: string) => {
    setRejectedFields((prev) => new Set([...prev, field]));
  }, []);

  // Reset session (for new form session after submit/add another)
  const resetSession = useCallback(() => {
    setHasRunThisSession(false);
    setRejectedFields(new Set());
    setAppliedFields(new Set());
    setAppliedSuggestions([]);
  }, []);

  // Track when a suggestion is applied - also marks session as "ran"
  const applySuggestion = useCallback((suggestion: AutofillSuggestion) => {
    setHasRunThisSession(true);
    setAppliedFields((prev) => new Set([...prev, suggestion.field]));
    setAppliedSuggestions((prev) => [...prev, suggestion]);
  }, []);

  const clearAppliedField = useCallback((field: string) => {
    setAppliedFields((prev) => {
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
    setAppliedSuggestions((prev) => prev.filter((s) => s.field !== field));
  }, []);

  return {
    suggestions,
    rejectField,
    resetSession,
    applySuggestion,
    appliedFields,
    appliedSuggestions,
    clearAppliedField,
    hasRunThisSession,
  };
}

export type { AutofillContext, AutofillSuggestion } from '@budgero/core/browser';
