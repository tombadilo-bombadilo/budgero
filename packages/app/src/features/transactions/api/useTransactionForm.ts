/**
 * Transaction Form State Management Hook
 *
 * Consolidates the complex state management for the Add Transaction form.
 * Handles form fields, last-used preferences, currency conversion state, and UI state.
 */

import { useReducer, useCallback, useEffect, useMemo, useRef } from 'react';
import type { MilliUnits } from '@shared/lib/currency/milli';

export type TransactionType = 'inflow' | 'outflow' | 'transfer';

export interface LastUsedFields {
  category?: string;
  payee?: string;
  accountId?: string;
  // number = a real label, null = explicitly "No label", undefined = field
  // not part of this update (keep whatever was remembered).
  labelId?: number | null;
}

export type LastUsedState = Record<TransactionType, LastUsedFields>;

export interface PendingTransaction {
  date: Date | null;
  category: string;
  memo: string;
  payee: string;
  labelId: number | null;
  /** Milliunits. */
  outflow: number;
  /** Milliunits. */
  inflow: number;
  accountId: number;
  transferId: string | null;
}

export interface TransactionFormState {
  // Form fields
  transactionType: TransactionType;
  transactionDate: Date | null;
  selectedCategory: string;
  memo: string;
  payee: string;
  selectedLabelId: number | null;
  /** Entered amount in integer milliunits (CalculatorCell commits MilliUnits). */
  amount: MilliUnits | null;
  amountTouched: boolean;
  selectedFromAccount: string;
  selectedToAccount: string;

  // Amount input state
  amountInputNonce: number;
  isAmountEditing: boolean;
  amountFocusSignal: number;

  // Preferences
  rememberLast: boolean;
  lastUsed: LastUsedState;

  // UI state
  dateOpen: boolean;
  addAccountOpen: boolean;

  // Currency conversion state
  showRatePrompt: boolean;
  pendingRatePair: { from: string; to: string } | null;
  isCalculatingTransfer: boolean;
  /** Conversion preview in milliunits (rounded from rate math). */
  convertedAmount: number | null;
  isLoadingRate: boolean;
  pendingAdd: PendingTransaction | null;
}

type TransactionFormAction =
  | { type: 'SET_TRANSACTION_TYPE'; value: TransactionType }
  | { type: 'SET_DATE'; date: Date | null }
  | { type: 'SET_DATE_OPEN'; open: boolean }
  | { type: 'SET_CATEGORY'; category: string }
  | { type: 'SET_MEMO'; memo: string }
  | { type: 'SET_PAYEE'; payee: string }
  | { type: 'SET_LABEL_ID'; labelId: number | null }
  | { type: 'SET_AMOUNT'; amount: MilliUnits | null }
  | { type: 'SET_AMOUNT_TOUCHED'; touched: boolean }
  | { type: 'SET_FROM_ACCOUNT'; accountId: string }
  | { type: 'SET_TO_ACCOUNT'; accountId: string }
  | { type: 'INCREMENT_AMOUNT_NONCE' }
  | { type: 'SET_AMOUNT_EDITING'; editing: boolean }
  | { type: 'TRIGGER_AMOUNT_FOCUS' }
  | { type: 'SET_REMEMBER_LAST'; value: boolean }
  | { type: 'SET_LAST_USED'; lastUsed: LastUsedState }
  | { type: 'UPDATE_LAST_USED'; transactionType: TransactionType; fields: LastUsedFields }
  | { type: 'SET_ADD_ACCOUNT_OPEN'; open: boolean }
  | { type: 'SET_SHOW_RATE_PROMPT'; show: boolean }
  | { type: 'SET_PENDING_RATE_PAIR'; pair: { from: string; to: string } | null }
  | { type: 'SET_CALCULATING_TRANSFER'; calculating: boolean }
  | { type: 'SET_CONVERTED_AMOUNT'; amount: number | null }
  | { type: 'SET_LOADING_RATE'; loading: boolean }
  | { type: 'SET_PENDING_ADD'; pending: PendingTransaction | null }
  | { type: 'RESET_FORM' }
  | { type: 'RESET_AMOUNT' };

const LAST_USED_KEY = 'budgero:add-transaction:last-used';
const REMEMBER_LAST_KEY = 'budgero:add-transaction:remember-last';

export function mergeLastUsedFields(base: LastUsedFields, fields: LastUsedFields): LastUsedFields {
  const next: LastUsedFields = { ...base };
  if (fields.category) next.category = fields.category;
  if (fields.payee) next.payee = fields.payee;
  if (fields.accountId) next.accountId = fields.accountId;
  // null means the user explicitly chose "No label" — clear the remembered
  // value. undefined means the field wasn't part of this update, so keep it.
  if (fields.labelId === null) {
    next.labelId = null;
  } else if (
    typeof fields.labelId === 'number' &&
    Number.isFinite(fields.labelId) &&
    fields.labelId > 0
  ) {
    next.labelId = fields.labelId;
  }
  return next;
}

const createInitialState = (selectedAccountId?: number): TransactionFormState => ({
  transactionType: 'outflow',
  transactionDate: new Date(),
  selectedCategory: '',
  memo: '',
  payee: '',
  selectedLabelId: null,
  amount: null,
  amountTouched: false,
  selectedFromAccount: selectedAccountId?.toString() || '',
  selectedToAccount: '',
  amountInputNonce: 0,
  isAmountEditing: false,
  amountFocusSignal: 0,
  rememberLast: true,
  lastUsed: {
    inflow: {},
    outflow: {},
    transfer: {},
  },
  dateOpen: false,
  addAccountOpen: false,
  showRatePrompt: false,
  pendingRatePair: null,
  isCalculatingTransfer: false,
  convertedAmount: null,
  isLoadingRate: false,
  pendingAdd: null,
});

function transactionFormReducer(
  state: TransactionFormState,
  action: TransactionFormAction
): TransactionFormState {
  switch (action.type) {
    case 'SET_TRANSACTION_TYPE':
      return { ...state, transactionType: action.value };

    case 'SET_DATE':
      return { ...state, transactionDate: action.date };

    case 'SET_DATE_OPEN':
      return { ...state, dateOpen: action.open };

    case 'SET_CATEGORY':
      return { ...state, selectedCategory: action.category };

    case 'SET_MEMO':
      return { ...state, memo: action.memo };

    case 'SET_PAYEE':
      return { ...state, payee: action.payee };

    case 'SET_LABEL_ID':
      return { ...state, selectedLabelId: action.labelId };

    case 'SET_AMOUNT':
      return { ...state, amount: action.amount };

    case 'SET_AMOUNT_TOUCHED':
      return { ...state, amountTouched: action.touched };

    case 'SET_FROM_ACCOUNT':
      return { ...state, selectedFromAccount: action.accountId };

    case 'SET_TO_ACCOUNT':
      return { ...state, selectedToAccount: action.accountId };

    case 'INCREMENT_AMOUNT_NONCE':
      return { ...state, amountInputNonce: state.amountInputNonce + 1 };

    case 'SET_AMOUNT_EDITING':
      return { ...state, isAmountEditing: action.editing };

    case 'TRIGGER_AMOUNT_FOCUS':
      return { ...state, amountFocusSignal: state.amountFocusSignal + 1 };

    case 'SET_REMEMBER_LAST':
      return { ...state, rememberLast: action.value };

    case 'SET_LAST_USED':
      return { ...state, lastUsed: action.lastUsed };

    case 'UPDATE_LAST_USED': {
      const nextEntry = mergeLastUsedFields(state.lastUsed[action.transactionType], action.fields);
      return {
        ...state,
        lastUsed: { ...state.lastUsed, [action.transactionType]: nextEntry },
      };
    }

    case 'SET_ADD_ACCOUNT_OPEN':
      return { ...state, addAccountOpen: action.open };

    case 'SET_SHOW_RATE_PROMPT':
      return { ...state, showRatePrompt: action.show };

    case 'SET_PENDING_RATE_PAIR':
      return { ...state, pendingRatePair: action.pair };

    case 'SET_CALCULATING_TRANSFER':
      return { ...state, isCalculatingTransfer: action.calculating };

    case 'SET_CONVERTED_AMOUNT':
      return { ...state, convertedAmount: action.amount };

    case 'SET_LOADING_RATE':
      return { ...state, isLoadingRate: action.loading };

    case 'SET_PENDING_ADD':
      return { ...state, pendingAdd: action.pending };

    case 'RESET_FORM':
      return {
        ...createInitialState(),
        rememberLast: state.rememberLast,
        lastUsed: state.lastUsed,
        selectedFromAccount: state.selectedFromAccount,
      };

    case 'RESET_AMOUNT':
      return {
        ...state,
        amount: null,
        amountTouched: false,
        amountInputNonce: state.amountInputNonce + 1,
      };

    default:
      return state;
  }
}

interface UseTransactionFormOptions {
  selectedAccountId?: number;
}

export function useTransactionForm(options: UseTransactionFormOptions = {}) {
  const { selectedAccountId } = options;

  const [state, dispatch] = useReducer(
    transactionFormReducer,
    selectedAccountId,
    createInitialState
  );

  const previousTransactionType = useRef<TransactionType>(state.transactionType);
  const hasHydratedRef = useRef(false);

  // Load preferences from localStorage on mount
  useEffect(() => {
    if (hasHydratedRef.current) return;
    hasHydratedRef.current = true;

    if (typeof window === 'undefined') return;

    try {
      const saved = localStorage.getItem(LAST_USED_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as LastUsedState;
        dispatch({ type: 'SET_LAST_USED', lastUsed: { ...state.lastUsed, ...parsed } });

        // Seed account from last used if nothing preselected
        const lastAccount = parsed[state.transactionType]?.accountId;
        if (!state.selectedFromAccount && lastAccount) {
          dispatch({ type: 'SET_FROM_ACCOUNT', accountId: lastAccount });
        }
      }

      const savedRemember = localStorage.getItem(REMEMBER_LAST_KEY);
      if (savedRemember !== null) {
        dispatch({ type: 'SET_REMEMBER_LAST', value: savedRemember === 'true' });
      }
    } catch (e) {
      console.warn('Failed to load last-used transaction defaults', e);
    }
  }, [state.lastUsed, state.transactionType, state.selectedFromAccount]);

  const setTransactionType = useCallback((value: TransactionType) => {
    dispatch({ type: 'SET_TRANSACTION_TYPE', value });
  }, []);

  const setDate = useCallback((date: Date | null) => {
    dispatch({ type: 'SET_DATE', date });
  }, []);

  const setDateOpen = useCallback((open: boolean) => {
    dispatch({ type: 'SET_DATE_OPEN', open });
  }, []);

  const setCategory = useCallback((category: string) => {
    dispatch({ type: 'SET_CATEGORY', category });
  }, []);

  const setMemo = useCallback((memo: string) => {
    dispatch({ type: 'SET_MEMO', memo });
  }, []);

  const setPayee = useCallback((payee: string) => {
    dispatch({ type: 'SET_PAYEE', payee });
  }, []);

  const setLabelId = useCallback((labelId: number | null) => {
    dispatch({ type: 'SET_LABEL_ID', labelId });
  }, []);

  const setAmount = useCallback((amount: MilliUnits | null) => {
    dispatch({ type: 'SET_AMOUNT', amount });
  }, []);

  const setAmountTouched = useCallback((touched: boolean) => {
    dispatch({ type: 'SET_AMOUNT_TOUCHED', touched });
  }, []);

  const setFromAccount = useCallback((accountId: string) => {
    dispatch({ type: 'SET_FROM_ACCOUNT', accountId });
  }, []);

  const setToAccount = useCallback((accountId: string) => {
    dispatch({ type: 'SET_TO_ACCOUNT', accountId });
  }, []);

  const incrementAmountNonce = useCallback(() => {
    dispatch({ type: 'INCREMENT_AMOUNT_NONCE' });
  }, []);

  const setAmountEditing = useCallback((editing: boolean) => {
    dispatch({ type: 'SET_AMOUNT_EDITING', editing });
  }, []);

  const triggerAmountFocus = useCallback(() => {
    dispatch({ type: 'TRIGGER_AMOUNT_FOCUS' });
  }, []);

  const setRememberLast = useCallback((value: boolean) => {
    dispatch({ type: 'SET_REMEMBER_LAST', value });
    if (typeof window !== 'undefined') {
      localStorage.setItem(REMEMBER_LAST_KEY, value ? 'true' : 'false');
    }
  }, []);

  const persistLastUsed = useCallback(
    (transactionType: TransactionType, fields: LastUsedFields) => {
      if (!state.rememberLast) return;

      dispatch({ type: 'UPDATE_LAST_USED', transactionType, fields });

      if (typeof window !== 'undefined') {
        const nextEntry = mergeLastUsedFields(state.lastUsed[transactionType], fields);
        const next = { ...state.lastUsed, [transactionType]: nextEntry };
        localStorage.setItem(LAST_USED_KEY, JSON.stringify(next));
      }
    },
    [state.rememberLast, state.lastUsed]
  );

  const setAddAccountOpen = useCallback((open: boolean) => {
    dispatch({ type: 'SET_ADD_ACCOUNT_OPEN', open });
  }, []);

  const setShowRatePrompt = useCallback((show: boolean) => {
    dispatch({ type: 'SET_SHOW_RATE_PROMPT', show });
  }, []);

  const setPendingRatePair = useCallback((pair: { from: string; to: string } | null) => {
    dispatch({ type: 'SET_PENDING_RATE_PAIR', pair });
  }, []);

  const setCalculatingTransfer = useCallback((calculating: boolean) => {
    dispatch({ type: 'SET_CALCULATING_TRANSFER', calculating });
  }, []);

  const setConvertedAmount = useCallback((amount: number | null) => {
    dispatch({ type: 'SET_CONVERTED_AMOUNT', amount });
  }, []);

  const setLoadingRate = useCallback((loading: boolean) => {
    dispatch({ type: 'SET_LOADING_RATE', loading });
  }, []);

  const setPendingAdd = useCallback((pending: PendingTransaction | null) => {
    dispatch({ type: 'SET_PENDING_ADD', pending });
  }, []);

  const resetForm = useCallback(() => {
    dispatch({ type: 'RESET_FORM' });
  }, []);

  const resetAmount = useCallback(() => {
    dispatch({ type: 'RESET_AMOUNT' });
  }, []);

  const isTransfer = state.transactionType === 'transfer';
  const isInflow = state.transactionType === 'inflow';
  const isOutflow = state.transactionType === 'outflow';

  const canSubmit = useMemo(() => {
    const hasAccount = state.selectedFromAccount !== '';
    const hasAmount = state.amount !== null && state.amount > 0;

    if (isTransfer) {
      return hasAccount && state.selectedToAccount !== '' && hasAmount;
    }

    return hasAccount && hasAmount;
  }, [state.selectedFromAccount, state.selectedToAccount, state.amount, isTransfer]);

  return {
    // State
    ...state,

    // Refs
    previousTransactionType,

    // Derived state
    isTransfer,
    isInflow,
    isOutflow,
    canSubmit,

    // Actions
    setTransactionType,
    setDate,
    setDateOpen,
    setCategory,
    setMemo,
    setPayee,
    setLabelId,
    setAmount,
    setAmountTouched,
    setFromAccount,
    setToAccount,
    incrementAmountNonce,
    setAmountEditing,
    triggerAmountFocus,
    setRememberLast,
    persistLastUsed,
    setAddAccountOpen,
    setShowRatePrompt,
    setPendingRatePair,
    setCalculatingTransfer,
    setConvertedAmount,
    setLoadingRate,
    setPendingAdd,
    resetForm,
    resetAmount,
  };
}
