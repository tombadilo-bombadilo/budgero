import { withEditPrecision } from '@shared/lib/number-format';

/**
 * Safe expression evaluator for basic math operations.
 * Supports: +, -, *, /, parentheses
 */
export function evaluateExpression(expression: string): number | null {
  try {
    const sanitized = expression.replace(/\s+/g, '');

    if (!/^[0-9+\-*/().]+$/.test(sanitized)) {
      return null;
    }

    if (
      sanitized.includes('//') || // prevent comment parsing
      sanitized.includes('/*') ||
      sanitized.includes('*/') ||
      /[+\-*/]$/.test(sanitized) // trailing operator
    ) {
      return null;
    }

    // Prevent division by zero and other unsafe operations
    if (/\/0(?![.\d])/.test(sanitized)) {
      return null;
    }

    // Use Function constructor for safe evaluation (safer than eval)
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- sandboxed calculator eval of sanitized numeric input
    const result = new Function(`return ${sanitized}`)();

    if (typeof result === 'number' && isFinite(result)) {
      return result;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check if string contains operators (is an expression)
 */
export function isExpression(str: string): boolean {
  return /[+\-*/]/.test(str);
}

/**
 * Apply keyboard shortcuts for common calculations.
 * Shortcuts: Ctrl+H (half), Ctrl+D (double), Ctrl+Z (zero), Ctrl+T (10%)
 */
export function applyShortcut(key: string, currentValue: number): string | null {
  switch (key) {
    case 'h': // Half
      return `${currentValue} / 2`;
    case 'd': // Double
      return `${currentValue} * 2`;
    case 'z': // Zero
      return '0';
    case 't': // Ten percent
      return `${currentValue} * 0.1`;
    default:
      return null;
  }
}

/**
 * Escape special regex characters in a string
 */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Get separator characters from a localizer
 */
export function getSeparators(localizer?: Intl.NumberFormat): {
  groupSep: string | undefined;
  decimalSep: string | undefined;
} {
  let groupSep: string | undefined;
  let decimalSep: string | undefined;
  try {
    if (localizer && typeof localizer.formatToParts === 'function') {
      const parts = localizer.formatToParts(12345.6);
      groupSep = parts.find((p) => p.type === 'group')?.value;
      decimalSep = parts.find((p) => p.type === 'decimal')?.value;
      if (!decimalSep) {
        // A zero-decimal display format emits no decimal part, but users must
        // still be able to type fractional amounts — derive the separator
        // from the full-precision variant of the same locale.
        const editParts = withEditPrecision(localizer).formatToParts(1.1);
        decimalSep = editParts.find((p) => p.type === 'decimal')?.value;
      }
    }
  } catch {
    // formatToParts may fail - use defaults
  }
  return { groupSep, decimalSep };
}

/**
 * Normalize a string for evaluation by removing locale-specific formatting
 */
export function normalizeForEval(
  raw: string,
  groupSep: string | undefined,
  decimalSep: string | undefined
): string {
  let s = raw;
  s = s.replace(/[\u202F\u00A0\s]/g, '');
  if (groupSep) {
    try {
      const re = new RegExp(escapeRegExp(groupSep), 'g');
      s = s.replace(re, '');
    } catch {
      // Invalid regex - ignore
    }
  }
  if (decimalSep && decimalSep !== '.') {
    try {
      const re = new RegExp(escapeRegExp(decimalSep), 'g');
      s = s.replace(re, '.');
    } catch {
      // Invalid regex - ignore
    }
  }
  // Strip any remaining non-numeric/operator characters (e.g., currency symbols)
  s = s.replace(/[^0-9+\-*/().]/g, '');
  return s;
}

/**
 * Parse a localized numeric string into a number
 */
export function parseLocalizedNumericString(
  raw: string,
  groupSep: string | undefined,
  decimalSep: string | undefined
): number {
  if (!raw) return NaN;
  const trimmed = raw.trim();
  const hasParens = trimmed.includes('(') && trimmed.includes(')');
  const hasLeadingMinus = /^-/.test(trimmed);
  const hasTrailingMinus = /-$/.test(trimmed);
  const negative = hasParens || hasLeadingMinus || hasTrailingMinus;
  let s = trimmed.replace(/[()]/g, '').replace(/-$/, '');
  s = normalizeForEval(s, groupSep, decimalSep);
  const num = parseFloat(s);
  if (isNaN(num)) return NaN;
  return negative ? -Math.abs(num) : num;
}

/**
 * Format a number for input display using locale-specific formatting
 */
export function formatNumberForInput(
  val: number,
  localizer: Intl.NumberFormat | undefined,
  groupSep: string | undefined,
  decimalSep: string | undefined
): string {
  // Prefer formatToParts reconstruction without currency. Always seed edit
  // text at full precision — a zero-decimal display format must not silently
  // truncate the value being edited.
  try {
    if (localizer && typeof localizer.formatToParts === 'function') {
      const parts = withEditPrecision(localizer).formatToParts(val);
      const filtered = parts
        .filter(
          (p) =>
            p.type === 'integer' ||
            p.type === 'group' ||
            p.type === 'decimal' ||
            p.type === 'fraction' ||
            p.type === 'minusSign' ||
            p.type === 'plusSign'
        )
        .map((p) => p.value)
        .join('');
      if (filtered) return filtered;
    }
  } catch {
    // formatToParts may fail - use fallback
  }

  // Fallback: build with separators
  const negative = val < 0;
  const abs = Math.abs(val);
  const [intStr, fracStr] = abs.toFixed(2).replace(/0+$/, '').split('.');

  const groupInteger = (digits: string) => {
    if (!digits) return '0';
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

  let s = groupInteger(intStr || '0');
  if (fracStr && fracStr.length > 0) {
    s += (decimalSep || '.') + fracStr;
  }
  if (negative) s = `-${s}`;
  return s;
}

/**
 * Evaluate text to a number, handling both expressions and plain numbers
 */
export function evaluateTextToNumber(
  text: string,
  groupSep: string | undefined,
  decimalSep: string | undefined
): number | null {
  const normalized = normalizeForEval(text, groupSep, decimalSep);
  if (!text.trim()) return null;
  if (isExpression(normalized)) {
    const result = evaluateExpression(normalized);
    return result !== null ? result : null;
  }
  const num = parseLocalizedNumericString(text, groupSep, decimalSep);
  return isNaN(num) ? null : num;
}
