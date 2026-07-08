/**
 * useAutofillIntegration Hook
 *
 * Wires rule-based autofill (`useAutofillRules`) into the add-transaction
 * form: builds the match context, applies suggestions as they appear,
 * tracks user edits to auto-filled fields (clearing/rejecting them), and
 * logs which rules fired once the transaction is saved.
 */

import * as React from 'react';

import { useAutofillRules, type AutofillSuggestion } from '@features/rules/api/useAutofillRules';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { asMilli } from '@shared/lib/currency/milli';
import type { Category, Budget } from '@budgero/core/browser';
import type { useTransactionForm } from '@features/transactions/api/useTransactionForm';

/**
 * Clear the autofill indicator (and reject future autofills when the value is
 * emptied) once the user manually changes an auto-filled field.
 *
 * `prevRef` is owned by the caller: the suggestion-applying effect mutates it
 * BEFORE calling the field setter, so autofill's own writes don't trip this.
 */
function useAutofillFieldTracking(
  field: string,
  value: string,
  prevRef: React.MutableRefObject<string>,
  appliedFields: Set<string>,
  clearAppliedField: (field: string) => void,
  rejectField: (field: string) => void
) {
  React.useEffect(() => {
    // If the field changed and it was auto-filled, clear the indicator
    if (appliedFields.has(field) && prevRef.current !== value) {
      clearAppliedField(field);
      // If cleared completely, also reject future autofills for this field
      if (!value) {
        rejectField(field);
      }
    }
    prevRef.current = value;
  }, [field, value, prevRef, appliedFields, clearAppliedField, rejectField]);
}

function fieldToActionType(field: string): string {
  switch (field) {
    case 'category':
      return 'category.set';
    case 'payee':
      return 'payee.set';
    case 'memo':
      return 'memo.set';
    case 'amount':
      return 'amount.set';
    case 'account':
      return 'account.set';
    default:
      return field;
  }
}

export interface UseAutofillIntegrationOptions {
  form: ReturnType<typeof useTransactionForm>;
  categories: Category[];
  budgetId: number;
  selectedBudget: Budget | null;
  /** Only autofill for regular (non-transfer, non-split) transactions. */
  isSplit: boolean;
}

export function useAutofillIntegration({
  form,
  categories,
  budgetId,
  selectedBudget,
  isSplit,
}: UseAutofillIntegrationOptions) {
  const runtime = useRuntime();
  const { setPayee, setCategory, setFromAccount } = form;

  const autofillContext = React.useMemo(
    () => ({
      memo: form.memo,
      payee: form.payee,
      amount: form.amount,
      accountId: form.selectedFromAccount ? parseInt(form.selectedFromAccount, 10) : null,
    }),
    [form.memo, form.payee, form.amount, form.selectedFromAccount]
  );

  const selectedCategoryId = React.useMemo(() => {
    if (!form.selectedCategory) return null;
    const cat = categories.find((c) => c.Name === form.selectedCategory);
    return cat?.ID ?? null;
  }, [form.selectedCategory, categories]);

  const autofillCurrentValues = React.useMemo(
    () => ({
      categoryId: selectedCategoryId,
      payee: form.payee,
      memo: form.memo,
      amount: form.amount,
      accountId: form.selectedFromAccount ? parseInt(form.selectedFromAccount, 10) : null,
    }),
    [selectedCategoryId, form.payee, form.memo, form.amount, form.selectedFromAccount]
  );

  const {
    suggestions: autofillSuggestions,
    rejectField: rejectAutofillField,
    resetSession: resetAutofillSession,
    applySuggestion: applyAutofillSuggestion,
    appliedFields: autofillAppliedFields,
    appliedSuggestions: autofillAppliedSuggestions,
    clearAppliedField: clearAutofillAppliedField,
  } = useAutofillRules(autofillContext, autofillCurrentValues, {
    budgetId: budgetId ?? null,
    enabled: !form.isTransfer && !isSplit, // Only autofill for regular transactions
  });

  // Track when user changes an auto-filled field (refs must be before effects that use them)
  const previousPayee = React.useRef(form.payee);
  const previousCategory = React.useRef(form.selectedCategory);
  const previousMemo = React.useRef(form.memo);
  const previousAccount = React.useRef(form.selectedFromAccount);

  // Apply autofill suggestions when they appear
  React.useEffect(() => {
    for (const suggestion of autofillSuggestions) {
      if (autofillAppliedFields.has(suggestion.field)) continue;

      if (suggestion.field === 'category' && typeof suggestion.value === 'number') {
        const category = categories.find((c) => c.ID === suggestion.value);
        if (category) {
          // Update ref BEFORE setting value so the tracking effect doesn't clear it
          previousCategory.current = category.Name;
          setCategory(category.Name);
          applyAutofillSuggestion(suggestion);
        }
      } else if (suggestion.field === 'payee' && typeof suggestion.value === 'string') {
        // Update ref BEFORE setting value so the tracking effect doesn't clear it
        previousPayee.current = suggestion.value;
        setPayee(suggestion.value);
        applyAutofillSuggestion(suggestion);
      } else if (suggestion.field === 'memo' && typeof suggestion.value === 'string') {
        // Update ref BEFORE setting value so the tracking effect doesn't clear it
        previousMemo.current = suggestion.value;
        form.setMemo(suggestion.value);
        applyAutofillSuggestion(suggestion);
      } else if (suggestion.field === 'amount' && typeof suggestion.value === 'number') {
        // Rule amount actions are stored in integer milliunits
        form.setAmount(asMilli(suggestion.value));
        applyAutofillSuggestion(suggestion);
      } else if (suggestion.field === 'account' && typeof suggestion.value === 'number') {
        // Update ref BEFORE setting value so the tracking effect doesn't clear it
        const accountIdStr = suggestion.value.toString();
        previousAccount.current = accountIdStr;
        setFromAccount(accountIdStr);
        applyAutofillSuggestion(suggestion);
      }
    }
  }, [
    autofillSuggestions,
    autofillAppliedFields,
    applyAutofillSuggestion,
    categories,
    setCategory,
    setPayee,
    setFromAccount,
    form,
  ]);

  useAutofillFieldTracking(
    'payee',
    form.payee,
    previousPayee,
    autofillAppliedFields,
    clearAutofillAppliedField,
    rejectAutofillField
  );
  useAutofillFieldTracking(
    'category',
    form.selectedCategory,
    previousCategory,
    autofillAppliedFields,
    clearAutofillAppliedField,
    rejectAutofillField
  );
  useAutofillFieldTracking(
    'memo',
    form.memo,
    previousMemo,
    autofillAppliedFields,
    clearAutofillAppliedField,
    rejectAutofillField
  );
  useAutofillFieldTracking(
    'account',
    form.selectedFromAccount,
    previousAccount,
    autofillAppliedFields,
    clearAutofillAppliedField,
    rejectAutofillField
  );

  // Log autofill rule applications after transaction is saved
  const logAutofillApplications = React.useCallback(
    (transactionId: number, suggestions: AutofillSuggestion[]) => {
      if (suggestions.length === 0) return;
      if (!selectedBudget?.ID) return;

      try {
        const changes = suggestions.map((s) => ({
          ruleId: s.ruleId,
          ruleName: s.ruleName,
          field: s.field,
          value: s.value,
          actionType: fieldToActionType(s.field),
        }));

        void runtime
          .mutationsRouter()
          .execute({
            op: 'rules.logAutofillApplication',
            payload: {
              budgetId: selectedBudget.ID,
              transactionId,
              changes,
            },
            invalidates: [
              ['rules', '*'],
              ['ruleRuns', '*'],
              ['ruleRunChanges', '*'],
            ],
            meta: { skipUndo: true, label: 'rules.logAutofillApplication', forceInvalidate: true },
          })
          .catch((error) => {
            console.warn('[Autofill] Failed to log autofill application:', error);
          });
      } catch (error) {
        // Don't fail the transaction save if logging fails
        console.warn('[Autofill] Failed to log autofill application:', error);
      }
    },
    [runtime, selectedBudget]
  );

  return {
    autofillAppliedFields,
    autofillAppliedSuggestions,
    resetAutofillSession,
    logAutofillApplications,
  };
}
