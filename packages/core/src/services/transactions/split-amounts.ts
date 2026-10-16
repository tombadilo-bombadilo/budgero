/**
 * Keeping split lines in step with their parent's amounts.
 *
 * A split parent's lines must always sum to the parent, in both the account
 * currency (native) and the budget currency (converted). When the parent's
 * amount changes outside the split editor (a rule adjusting the amount, an
 * account move, a rate or date re-conversion), the lines are rescaled
 * proportionally. Rounding leftovers go to the largest line, the same rule
 * upsertSplits uses when it projects lines onto the parent.
 */

export interface SplitLineAmounts {
  ID: number;
  InflowConverted: number;
  OutflowConverted: number;
  InflowNative?: number | null;
  OutflowNative?: number | null;
}

export interface ParentAmounts {
  InflowConverted: number;
  OutflowConverted: number;
  InflowNative?: number | null;
  OutflowNative?: number | null;
}

const net = (inflow: number | null | undefined, outflow: number | null | undefined) =>
  (inflow ?? 0) - (outflow ?? 0);

const parentNativeNet = (parent: ParentAmounts) =>
  net(
    parent.InflowNative ?? parent.InflowConverted,
    parent.OutflowNative ?? parent.OutflowConverted
  );

/** Index of the line with the largest magnitude (first one on ties). */
function largestIndex(values: number[]): number {
  let index = 0;
  for (let i = 1; i < values.length; i++) {
    if (Math.abs(values[i]) > Math.abs(values[index])) index = i;
  }
  return index;
}

/** Scale `values` so they sum to `target`; unchanged when they already do. */
export function rescaleToTotal(values: number[], target: number): number[] {
  const sum = values.reduce((total, value) => total + value, 0);
  if (sum === target || values.length === 0) return [...values];
  const scaled =
    sum === 0 ? [...values] : values.map((value) => Math.round((value * target) / sum));
  const remainder = target - scaled.reduce((total, value) => total + value, 0);
  if (remainder !== 0) scaled[largestIndex(sum === 0 ? values : scaled)] += remainder;
  return scaled;
}

/**
 * Converted line amounts projected from native ones onto the parent's exact
 * conversion (the same projection upsertSplits applies to native editors).
 */
export function projectConverted(
  nativeNets: number[],
  nativeTotal: number,
  convertedTotal: number
) {
  if (nativeTotal === 0)
    return rescaleToTotal(
      nativeNets.map(() => 0),
      convertedTotal
    );
  const converted = nativeNets.map((amount) => Math.round((amount * convertedTotal) / nativeTotal));
  const remainder = convertedTotal - converted.reduce((total, value) => total + value, 0);
  if (remainder !== 0) converted[largestIndex(nativeNets)] += remainder;
  return converted;
}

const toFlows = (amount: number) => ({
  inflow: amount > 0 ? amount : 0,
  outflow: amount < 0 ? -amount : 0,
});

/**
 * The lines rescaled to `parent`, or an empty list when they already sum to
 * it in both currencies. Lines without native amounts (older rows) keep them
 * empty and are rescaled in the budget currency only.
 */
export function linesOutOfStep<T extends SplitLineAmounts>(lines: T[], parent: ParentAmounts): T[] {
  if (lines.length === 0) return [];
  const convertedTotal = net(parent.InflowConverted, parent.OutflowConverted);
  const nativeTotal = parentNativeNet(parent);
  const convertedNets = lines.map((line) => net(line.InflowConverted, line.OutflowConverted));
  const hasNative = lines.every((line) => line.InflowNative != null || line.OutflowNative != null);
  const nativeNets = hasNative
    ? lines.map((line) => net(line.InflowNative, line.OutflowNative))
    : [];
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const nativeInStep = !hasNative || sum(nativeNets) === nativeTotal;
  const convertedInStep = sum(convertedNets) === convertedTotal;
  if (nativeInStep && convertedInStep) return [];

  let nextNative = nativeNets;
  let nextConverted = convertedNets;
  if (hasNative) {
    nextNative = rescaleToTotal(nativeNets, nativeTotal);
    nextConverted = projectConverted(nextNative, nativeTotal, convertedTotal);
  } else {
    nextConverted = rescaleToTotal(convertedNets, convertedTotal);
  }

  return lines.map((line, index) => {
    const converted = toFlows(nextConverted[index]);
    const next = {
      ...line,
      InflowConverted: converted.inflow,
      OutflowConverted: converted.outflow,
    };
    if (hasNative) {
      const native = toFlows(nextNative[index]);
      next.InflowNative = native.inflow;
      next.OutflowNative = native.outflow;
    }
    return next;
  });
}
