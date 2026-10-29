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
import { usePayeeCategoryMemory } from '@entities/payee/api/usePayeeCategoryMemory';
import { useSuggestCategoryFromPayee } from '@shared/hooks/useUserPreferences';
import { decidePayeeCategoryMemory } from '@features/transactions/lib/payee-category-memory';
import { resolveCategoryId } from '@features/transactions/lib/category-selection';
import type { Category, Budget, PayeeCategoryMemory } from '@budgero/core/browser';
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
    case 'label':
      return 'label.set';
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
  disabled?: boolean;
}

export function useAutofillIntegration({
  form,
  categories,
  budgetId,
  selectedBudget,
  isSplit,
  disabled = false,
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

  const selectedCategoryId = React.useMemo(
    () => resolveCategoryId(categories, form.selectedCategory, form.selectedCategoryId),
    [form.selectedCategory, form.selectedCategoryId, categories]
  );

  const autofillCurrentValues = React.useMemo(
    () => ({
      categoryId: selectedCategoryId,
      payee: form.payee,
      memo: form.memo,
      amount: form.amount,
      accountId: form.selectedFromAccount ? parseInt(form.selectedFromAccount, 10) : null,
      labelId: form.selectedLabelId,
    }),
    [
      selectedCategoryId,
      form.payee,
      form.memo,
      form.amount,
      form.selectedFromAccount,
      form.selectedLabelId,
    ]
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
    enabled: !disabled && !form.isTransfer && !isSplit, // Only autofill for regular transactions
  });

  // Track when user changes an auto-filled field (refs must be before effects that use them)
  const previousPayee = React.useRef(form.payee);
  const previousCategory = React.useRef(form.selectedCategory);
  const previousMemo = React.useRef(form.memo);
  const previousAccount = React.useRef(form.selectedFromAccount);
  const previousLabel = React.useRef(form.selectedLabelId ? String(form.selectedLabelId) : '');

  // Apply autofill suggestions when they appear
  React.useEffect(() => {
    for (const suggestion of autofillSuggestions) {
      if (autofillAppliedFields.has(suggestion.field)) continue;

      if (suggestion.field === 'category' && typeof suggestion.value === 'number') {
        const category = categories.find((c) => c.ID === suggestion.value);
        if (category) {
          // Update ref BEFORE setting value so the tracking effect doesn't clear it
          previousCategory.current = category.Name;
          setCategory(category.Name, category.ID);
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
      } else if (suggestion.field === 'label' && typeof suggestion.value === 'number') {
        // Update ref BEFORE setting value so the tracking effect doesn't clear it
        previousLabel.current = String(suggestion.value);
        form.setLabelId(suggestion.value);
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

  // ── Payee category memory ────────────────────────────────────────────────
  // Weaker than a rule: fills the category from the payee's last transaction.
  // Runs ONCE PER PAYEE — switching payees re-runs it for the new payee, and
  // the applied state is keyed to the payee it applied for, never a bare flag.
  const { data: suggestCategoryFromPayee = true } = useSuggestCategoryFromPayee();

  const normalizedPayee = form.payee.trim().toLowerCase();

  // Debounce the lookup the same way the rules engine debounces its context,
  // so typing a payee doesn't issue a DB query per keystroke. Initialized to
  // the mount value so an already-filled payee resolves without the delay.
  const [debouncedPayee, setDebouncedPayee] = React.useState(normalizedPayee);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedPayee(normalizedPayee), 300);
    return () => clearTimeout(timer);
  }, [normalizedPayee]);

  const payeeMemoryEnabled = !disabled && suggestCategoryFromPayee && !form.isTransfer && !isSplit;

  const { data: payeeCategoryMemory } = usePayeeCategoryMemory(budgetId, debouncedPayee, {
    enabled: payeeMemoryEnabled,
  });

  /**
   * What memory applied, keyed to the payee it applied FOR. The indicator and
   * the once-per-payee guard both derive from this — a plain boolean can't
   * say "that fill belonged to the previous payee".
   */
  const [appliedFor, setAppliedFor] = React.useState<{
    payee: string;
    categoryName: string;
    memory: PayeeCategoryMemory;
  } | null>(null);

  /**
   * The category "remember last" prefills — the last one used for ANY payee.
   * A payee-specific memory is strictly better information, so it may
   * overwrite this (exactly as autofill rules do via `ignoreCurrentValues`).
   */
  const rememberLastCategory =
    form.rememberLast && !form.isTransfer && !isSplit
      ? (form.lastUsed[form.transactionType]?.category ?? null)
      : null;

  const memoryCategory = React.useMemo(() => {
    if (!payeeCategoryMemory) return null;
    return categories.find((c) => c.ID === payeeCategoryMemory.CategoryID) ?? null;
  }, [payeeCategoryMemory, categories]);

  // Payee switched: the old payee's fill must not survive into the new one.
  // If the field still holds exactly what memory wrote, walk it back to the
  // remember-last prefill (or empty) so the new payee starts clean; a value
  // the user picked themselves is left alone.
  const lastPayeeRef = React.useRef(normalizedPayee);
  React.useEffect(() => {
    if (lastPayeeRef.current === normalizedPayee) return;
    lastPayeeRef.current = normalizedPayee;
    if (!appliedFor || appliedFor.payee === normalizedPayee) return;
    if (form.selectedCategory === appliedFor.categoryName) {
      const fallback = rememberLastCategory ?? '';
      previousCategory.current = fallback;
      setCategory(fallback);
    }
    setAppliedFor(null);
  }, [normalizedPayee, appliedFor, form.selectedCategory, rememberLastCategory, setCategory]);

  React.useEffect(() => {
    // Ignore lookups still in flight for a payee the user has typed past.
    if (debouncedPayee !== normalizedPayee) return;

    const decision = decidePayeeCategoryMemory({
      enabled: payeeMemoryEnabled,
      payee: debouncedPayee,
      memoryCategoryId: payeeCategoryMemory?.CategoryID ?? null,
      memoryCategoryExists: memoryCategory !== null,
      ruleFilledCategory: autofillAppliedFields.has('category'),
      appliedForPayee: appliedFor?.payee ?? null,
      currentCategory: form.selectedCategory,
      // Values memory may overwrite; anything else was the user's own pick.
      overwritableValues: ['', rememberLastCategory ?? '', appliedFor?.categoryName ?? ''],
    });
    if (!decision.apply || !memoryCategory || !payeeCategoryMemory) return;

    // Update the ref BEFORE setting so the rules' field tracking doesn't read
    // our own write as the user typing. Its ID travels as payeeCategorySource.
    previousCategory.current = memoryCategory.Name;
    setCategory(memoryCategory.Name);
    setAppliedFor({
      payee: debouncedPayee,
      categoryName: memoryCategory.Name,
      memory: payeeCategoryMemory,
    });
  }, [
    debouncedPayee,
    normalizedPayee,
    payeeMemoryEnabled,
    payeeCategoryMemory,
    memoryCategory,
    autofillAppliedFields,
    appliedFor,
    form.selectedCategory,
    rememberLastCategory,
    setCategory,
  ]);

  // Derived, not stored: the indicator is only truthful while the field still
  // holds memory's fill for the CURRENT payee. A rule overwriting the value,
  // the user picking something else, or a payee switch all turn it off with
  // no bookkeeping to forget.
  const payeeCategoryApplied =
    appliedFor !== null &&
    appliedFor.payee === normalizedPayee &&
    form.selectedCategory === appliedFor.categoryName &&
    !autofillAppliedFields.has('category');
  const payeeCategorySource = payeeCategoryApplied ? appliedFor.memory : null;

  const resetPayeeCategoryMemory = React.useCallback(() => {
    setAppliedFor(null);
  }, []);

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
  useAutofillFieldTracking(
    'label',
    form.selectedLabelId ? String(form.selectedLabelId) : '',
    previousLabel,
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

  const resetSession = React.useCallback(() => {
    resetAutofillSession();
    resetPayeeCategoryMemory();
  }, [resetAutofillSession, resetPayeeCategoryMemory]);

  return {
    autofillAppliedFields,
    autofillAppliedSuggestions,
    resetAutofillSession: resetSession,
    logAutofillApplications,
    /** True while the category shown came from the payee's last transaction. */
    payeeCategoryApplied,
    /** The memory row it applied (snapshotted at apply time), for the tooltip. */
    payeeCategorySource,
  };
}
