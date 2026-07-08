import { useState, useEffect, useRef, useCallback } from 'react';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import {
  getSeparators,
  normalizeForEval,
  isExpression,
  evaluateExpression,
  parseLocalizedNumericString,
  formatNumberForInput,
  evaluateTextToNumber,
} from './calculator-utils';

export interface UseCalculatorStateOptions {
  value: number;
  onCommit: (value: number) => void;
  localizer?: Intl.NumberFormat;
  zeroAsEmpty?: boolean;
  useFormatterForDisplay?: boolean;
  displayFormatter: (value: number) => string;
  autoFocus?: boolean;
  onEditingChange?: (editing: boolean) => void;
  focusSignal?: number;
  commitPrecision?: number;
}

export interface CalculatorState {
  inputText: string;
  setInputText: React.Dispatch<React.SetStateAction<string>>;
  isEditing: boolean;
  evaluatedValue: number | null;
  hasError: boolean;
  isMobile: boolean;

  mobileOpen: boolean;
  mobileText: string;
  setMobileText: React.Dispatch<React.SetStateAction<string>>;
  mobileError: string | null;
  setMobileError: React.Dispatch<React.SetStateAction<string | null>>;

  inputRef: React.RefObject<HTMLInputElement | null>;

  groupSep: string | undefined;
  decimalSep: string | undefined;

  startEditing: () => void;
  cancelEditing: () => void;
  saveChanges: () => void;
  closeMobile: () => void;
  commitValue: (text: string) => void;
  formatValueForInput: (val: number) => string;
  normalizeForEvalWithLocalizer: (raw: string) => string;
}

export function useCalculatorState({
  value,
  onCommit,
  localizer,
  zeroAsEmpty = false,
  useFormatterForDisplay = false,
  displayFormatter,
  autoFocus = false,
  onEditingChange,
  focusSignal = 0,
  commitPrecision = 2,
}: UseCalculatorStateOptions): CalculatorState {
  const { groupSep, decimalSep } = getSeparators(localizer);

  const normalizeForEvalWithLocalizer = useCallback(
    (raw: string) => normalizeForEval(raw, groupSep, decimalSep),
    [groupSep, decimalSep]
  );

  const parseLocalizedValue = useCallback(
    (raw: string) => parseLocalizedNumericString(raw, groupSep, decimalSep),
    [groupSep, decimalSep]
  );

  const formatValueForInput = useCallback(
    (val: number) => formatNumberForInput(val, localizer, groupSep, decimalSep),
    [localizer, groupSep, decimalSep]
  );

  const evaluateText = useCallback(
    (text: string) => evaluateTextToNumber(text, groupSep, decimalSep),
    [groupSep, decimalSep]
  );

  const roundForCommit = useCallback(
    (rawValue: number): number => {
      if (!Number.isFinite(rawValue)) return 0;
      if (!Number.isFinite(commitPrecision)) return rawValue;
      if (commitPrecision <= 0) return Math.round(rawValue);

      const factor = 10 ** commitPrecision;
      return Math.round((rawValue + Number.EPSILON) * factor) / factor;
    },
    [commitPrecision]
  );

  const getInitialInputText = () => {
    if (value === 0 && zeroAsEmpty) return '';
    if (useFormatterForDisplay) return displayFormatter(value);
    return value.toString();
  };

  const [inputText, setInputText] = useState(getInitialInputText);
  const [isEditing, setIsEditing] = useState(false);
  const [evaluatedValue, setEvaluatedValue] = useState<number | null>(null);
  const [hasError, setHasError] = useState(false);
  const isSavingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const shouldFocusInputRef = useRef(false);
  const hasAutoFocusedRef = useRef(false);

  const isMobileBreakpoint = useIsMobile();
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const isMobile = isMobileBreakpoint || isCoarsePointer;

  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileText, setMobileText] = useState('');
  const [mobileError, setMobileError] = useState<string | null>(null);

  // Detect coarse pointer (touch devices) - defer initial update to avoid synchronous cascade
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(pointer: coarse)');
    const update = () => setIsCoarsePointer(mql.matches);
    const id = requestAnimationFrame(update);
    mql.addEventListener?.('change', update);
    return () => {
      cancelAnimationFrame(id);
      mql.removeEventListener?.('change', update);
    };
  }, []);

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
    setIsEditing(false);
    onEditingChange?.(false);
    setMobileError(null);
  }, [onEditingChange]);

  // Cleanup: close mobile sheet on unmount to prevent orphaned overlays
  useEffect(() => {
    return () => {
      setMobileOpen(false);
    };
  }, []);

  // Update input when value changes - defer to avoid synchronous cascade
  useEffect(() => {
    if (!isEditing) {
      const id = requestAnimationFrame(() => {
        if (value === 0 && zeroAsEmpty) {
          setInputText('');
        } else if (useFormatterForDisplay) {
          setInputText(displayFormatter(value));
        } else {
          try {
            setInputText(localizer ? formatValueForInput(value) : value.toString());
          } catch {
            setInputText(value.toString());
          }
        }
        setEvaluatedValue(null);
        setHasError(false);
      });
      return () => cancelAnimationFrame(id);
    }
  }, [
    value,
    isEditing,
    zeroAsEmpty,
    useFormatterForDisplay,
    displayFormatter,
    localizer,
    formatValueForInput,
  ]);

  // Evaluate expression as user types - defer to avoid synchronous cascade
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (isEditing && inputText.trim()) {
        const normalized = normalizeForEvalWithLocalizer(inputText);
        if (isExpression(normalized)) {
          const result = evaluateExpression(normalized);
          if (result !== null) {
            setEvaluatedValue(result);
            setHasError(false);
          } else {
            setEvaluatedValue(null);
            setHasError(true);
          }
        } else {
          const num = parseLocalizedValue(inputText);
          if (!isNaN(num)) {
            setEvaluatedValue(num);
            setHasError(false);
          } else {
            setEvaluatedValue(null);
            setHasError(inputText.trim() !== '');
          }
        }
      } else {
        setEvaluatedValue(null);
        setHasError(false);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [inputText, isEditing, normalizeForEvalWithLocalizer, parseLocalizedValue]);

  const saveChanges = useCallback(() => {
    // Prevent double-saving when blur and Enter are triggered together
    if (isSavingRef.current) {
      return;
    }

    isSavingRef.current = true;

    if (hasError) {
      setIsEditing(false);
      setInputText(value.toString());
      isSavingRef.current = false;
      return;
    }

    let finalValue: number;
    if (evaluatedValue !== null) {
      finalValue = evaluatedValue;
    } else {
      const parsed = parseLocalizedValue(inputText);
      finalValue = isNaN(parsed) ? 0 : parsed;
    }

    finalValue = roundForCommit(finalValue);

    if (finalValue !== value) {
      onCommit(finalValue);
    }

    setIsEditing(false);
    onEditingChange?.(false);
    isSavingRef.current = false;
  }, [
    hasError,
    evaluatedValue,
    inputText,
    value,
    onCommit,
    onEditingChange,
    parseLocalizedValue,
    roundForCommit,
  ]);

  const startEditing = useCallback(() => {
    isSavingRef.current = false;
    if (isMobile) {
      const seed =
        value === 0
          ? ''
          : (() => {
              try {
                return localizer ? formatValueForInput(value) : value.toString();
              } catch {
                return value.toString();
              }
            })();
      setMobileText(seed);
      setInputText(seed);
      setMobileOpen(true);
      setIsEditing(true);
      onEditingChange?.(true);
      return;
    }
    // Seed the input with localized formatting on first open
    if (value === 0) {
      setInputText('');
    } else {
      try {
        const initial = localizer ? formatValueForInput(value) : value.toString();
        setInputText(initial);
      } catch {
        setInputText(value.toString());
      }
    }
    setIsEditing(true);
    onEditingChange?.(true);
    shouldFocusInputRef.current = true;
    setEvaluatedValue(null);
    setHasError(false);
  }, [value, localizer, isMobile, onEditingChange, formatValueForInput]);

  const cancelEditing = useCallback(() => {
    const resetValue = (() => {
      if (value === 0 && zeroAsEmpty) return '';
      try {
        return localizer ? formatValueForInput(value) : value.toString();
      } catch {
        return value.toString();
      }
    })();
    setInputText(resetValue);
    setEvaluatedValue(null);
    setHasError(false);
    setIsEditing(false);
    onEditingChange?.(false);
  }, [value, zeroAsEmpty, localizer, onEditingChange, formatValueForInput]);

  // Auto-focus on mount when requested
  useEffect(() => {
    if (autoFocus && !isEditing && !hasAutoFocusedRef.current) {
      hasAutoFocusedRef.current = true;
      // Defer to avoid synchronous setState in effect
      requestAnimationFrame(() => {
        startEditing();
      });
    }
  }, [autoFocus, isEditing, startEditing]);

  // Focus the input once editing state is active
  useEffect(() => {
    if (!isMobile && isEditing && shouldFocusInputRef.current && inputRef.current) {
      try {
        inputRef.current.focus();
        // Place caret at end instead of select-all so users can append formulas quickly
        const len = inputRef.current.value.length;
        inputRef.current.setSelectionRange?.(len, len);
      } catch {
        // Focus may fail if element is not focusable - ignore
      }
      shouldFocusInputRef.current = false;
    }
  }, [isEditing, isMobile]);

  // Imperative focus via signal
  const lastProcessedFocusSignal = useRef(focusSignal);

  useEffect(() => {
    if (!focusSignal || focusSignal === lastProcessedFocusSignal.current) return;
    lastProcessedFocusSignal.current = focusSignal;

    if (isMobile) {
      if (!mobileOpen) {
        // Defer to avoid synchronous setState in effect
        requestAnimationFrame(() => {
          startEditing();
        });
      }
      return;
    }
    if (inputRef.current) {
      try {
        inputRef.current.focus();
        const len = inputRef.current.value.length;
        inputRef.current.setSelectionRange?.(len, len);
      } catch {
        // Focus may fail if element is not focusable - ignore
      }
    }
  }, [focusSignal, startEditing, isMobile, mobileOpen]);

  const commitValue = useCallback(
    (text: string) => {
      const rawValue = evaluateText(text);
      if (rawValue === null) {
        setMobileError('Invalid value');
        return;
      }
      const finalValue = roundForCommit(rawValue);
      onCommit(finalValue);
      setInputText(text);
      setIsEditing(false);
      onEditingChange?.(false);
      setMobileError(null);
      closeMobile();
    },
    [evaluateText, onCommit, onEditingChange, closeMobile, roundForCommit]
  );

  return {
    inputText,
    setInputText,
    isEditing,
    evaluatedValue,
    hasError,
    isMobile,

    mobileOpen,
    mobileText,
    setMobileText,
    mobileError,
    setMobileError,

    inputRef,

    groupSep,
    decimalSep,

    startEditing,
    cancelEditing,
    saveChanges,
    closeMobile,
    commitValue,
    formatValueForInput,
    normalizeForEvalWithLocalizer,
  };
}
