import { asMilli, ZERO_MILLI } from '@shared/lib/currency/milli';
import type { SplitLine } from './SplitEditor';

export function newSplitLine(): SplitLine {
  return {
    id: crypto.randomUUID(),
    categoryId: undefined,
    memo: '',
    payee: '',
    inflow: ZERO_MILLI,
    outflow: ZERO_MILLI,
  };
}

/**
 * Puts the unassigned amount on the last line, or on a new line when there are
 * none. Exact integer milliunit arithmetic throughout.
 */
export function assignRemainingToSplit(
  splitLines: SplitLine[],
  remaining: number,
  parentAmount: number
): SplitLine[] {
  if (splitLines.length === 0) {
    return [
      {
        ...newSplitLine(),
        inflow: parentAmount > 0 ? asMilli(parentAmount) : ZERO_MILLI,
        outflow: parentAmount < 0 ? asMilli(-parentAmount) : ZERO_MILLI,
      },
    ];
  }
  return splitLines.map((l, i) =>
    i !== splitLines.length - 1 || remaining === 0
      ? l
      : remaining > 0
        ? { ...l, inflow: asMilli((l.inflow || 0) + remaining), outflow: ZERO_MILLI }
        : {
            ...l,
            inflow: ZERO_MILLI,
            outflow: asMilli((l.outflow || 0) + Math.abs(remaining)),
          }
  );
}
