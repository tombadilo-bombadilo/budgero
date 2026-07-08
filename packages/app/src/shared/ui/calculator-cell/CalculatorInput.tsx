import { Input } from '@shared/ui/input';
import { cn } from '@shared/lib/utils';
import { applyShortcut, isExpression } from './calculator-utils';

export interface CalculatorInputProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  inputText: string;
  setInputText: React.Dispatch<React.SetStateAction<string>>;
  evaluatedValue: number | null;
  hasError: boolean;
  isEditing: boolean;
  value: number;
  placeholder: string;
  autoFocus: boolean;
  shortcuts: boolean;
  inputAlign?: 'left' | 'center' | 'right';
  inputClassName?: string;
  className?: string;
  formatter: (value: number) => string;
  localizer?: Intl.NumberFormat;
  groupSep: string | undefined;
  decimalSep: string | undefined;
  normalizeForEvalWithLocalizer: (raw: string) => string;
  onSave: () => void;
  onCancel: () => void;
}

export function CalculatorInput({
  inputRef,
  inputText,
  setInputText,
  evaluatedValue,
  hasError,
  isEditing,
  value,
  placeholder,
  autoFocus,
  shortcuts,
  inputAlign,
  inputClassName,
  className,
  formatter,
  localizer,
  groupSep,
  decimalSep,
  normalizeForEvalWithLocalizer,
  onSave,
  onCancel,
}: CalculatorInputProps) {
  const handleChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const raw = e.target.value;
    if (!localizer || !raw) {
      setInputText(raw);
      return;
    }

    const normalized = normalizeForEvalWithLocalizer(raw);
    // If expression, don't reformat live
    if (isExpression(normalized)) {
      setInputText(raw);
      return;
    }

    // Numeric live formatting with caret preservation
    const inputEl = e.target;
    const oldCaret = inputEl.selectionStart ?? raw.length;

    // Preserve special cases: '-', trailing minus, ends with decimalSep
    const trimmed = raw.trim();
    const endsWithDecimal = decimalSep && trimmed.endsWith(decimalSep);

    // Extract sign
    const hasParens = trimmed.includes('(') && trimmed.includes(')');
    const hasLeadingMinus = /^-/.test(trimmed);
    const hasTrailingMinus = /-$/.test(trimmed);
    const negative = hasParens || hasLeadingMinus || hasTrailingMinus;

    // Strip non-digits except decimalSep and digits
    const stripGroup = (s: string) => (groupSep ? s.split(groupSep).join('') : s);
    const work = stripGroup(trimmed).replace(/[()]/g, '');
    // Split integer/decimal by decimalSep
    let intPart = work;
    let decPart = '';
    if (decimalSep && work.includes(decimalSep)) {
      const idx = work.lastIndexOf(decimalSep);
      intPart = work.slice(0, idx);
      decPart = work.slice(idx + decimalSep.length);
    }
    // Remove any non-digits from parts
    intPart = intPart.replace(/[^0-9]/g, '');
    decPart = decPart.replace(/[^0-9]/g, '');

    // Group integer every 3 digits
    const groupInteger = (digits: string) => {
      if (!digits) return '';
      const arr = digits.split('');
      let out = '';
      let count = 0;
      for (let i = arr.length - 1; i >= 0; i--) {
        out = arr[i] + out;
        count++;
        if (groupSep && i !== 0 && count % 3 === 0) out = groupSep + out;
      }
      return out;
    };

    let formatted = groupInteger(intPart);
    if (decimalSep) {
      if (endsWithDecimal) {
        formatted += decimalSep;
      } else if (decPart) {
        formatted += decimalSep + decPart;
      }
    }
    if (negative) {
      // Preserve user's minus placement; default to leading minus
      formatted = `-${formatted}`;
    }

    // Compute new caret based on digits count left of caret
    const countDigits = (s: string) => (s.match(/[0-9]/g) || []).length;
    const beforeCaret = raw.slice(0, oldCaret);
    const digitsBefore = countDigits(beforeCaret);
    // Check if user just typed the decimal separator
    const typedDecimal = decimalSep && beforeCaret.endsWith(decimalSep);

    let newCaret = 0;
    let seen = 0;
    const maxPos = formatted.length;
    for (let i = 0; i < maxPos; i++) {
      if (/[0-9]/.test(formatted[i])) seen++;
      if (seen >= digitsBefore) {
        newCaret = i + 1;
        break;
      }
      if (i === maxPos - 1) newCaret = maxPos;
    }

    // If user typed decimal separator, position caret after it
    if (typedDecimal) {
      const decimalIdx = formatted.indexOf(decimalSep);
      if (decimalIdx !== -1) {
        newCaret = decimalIdx + decimalSep.length;
      }
    }

    setInputText(formatted);
    // Restore caret after render
    requestAnimationFrame(() => {
      try {
        inputEl.setSelectionRange(newCaret, newCaret);
      } catch {
        // Selection range may fail on some input types - ignore
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Stop propagation to prevent parent handlers (like row selection or dnd)
    // from reacting to keys while typing in the cell.
    // We allow Tab to bubble so focus navigation works.
    // We allow Ctrl/Cmd/Alt keys to bubble for global shortcuts/browser actions.
    if (e.key !== 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.stopPropagation();
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      onSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (shortcuts && (e.ctrlKey || e.metaKey)) {
      const shortcut = applyShortcut(e.key.toLowerCase(), value);
      if (shortcut) {
        e.preventDefault();
        e.stopPropagation();
        setInputText(shortcut);
      }
    }
  };

  return (
    <div className={cn('relative', className)}>
      <Input
        autoFocus={autoFocus}
        type="text"
        inputMode="text"
        ref={inputRef}
        value={inputText}
        onChange={handleChange}
        onBlur={onSave}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn(
          'font-mono tabular-nums',
          hasError
            ? 'border-destructive focus-visible:ring-destructive'
            : 'border-muted focus-visible:ring-ring',
          'focus-visible:ring-1',
          inputAlign === 'center'
            ? 'text-center'
            : inputAlign === 'right'
              ? 'text-right'
              : 'text-left',
          inputClassName
        )}
      />

      {/* Show calculated result */}
      {isEditing &&
        evaluatedValue !== null &&
        isExpression(normalizeForEvalWithLocalizer(inputText)) &&
        !hasError && (
          <div className="absolute left-0 top-0 -translate-y-full text-xs sm:text-sm font-medium text-success font-mono bg-background/95 px-2 py-0.5 mb-1 rounded border shadow-sm pointer-events-none z-20">
            = {formatter(evaluatedValue)}
          </div>
        )}

      {/* Show error message */}
      {isEditing && hasError && (
        <div className="absolute left-0 top-0 -translate-y-full text-xs sm:text-sm font-medium text-destructive font-mono bg-background/95 px-2 py-0.5 mb-1 rounded border shadow-sm pointer-events-none z-20">
          Error
        </div>
      )}
    </div>
  );
}
