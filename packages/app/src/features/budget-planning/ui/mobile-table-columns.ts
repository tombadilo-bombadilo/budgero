/**
 * Columns of the mobile "table" budget layout, shared by the header, the
 * group rows and the category rows.
 *
 * Every row is its own grid, so plain `auto` columns sized to each row's own
 * numbers and drifted out of line with the header and with each other. Each
 * amount cell therefore carries two invisible, zero-height lines: the column
 * label and the widest amount in the table (CSS variables set by
 * DraggableBudgetTable via `mobileTableColumnVars`). Every cell of a column
 * then has the same width, so the columns line up in every row.
 */

import type { CSSProperties } from 'react';

export const MOBILE_TABLE_GRID = 'grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 items-center';

// before: the label, styled like the header; after: the widest amount,
// styled like the boldest amount cell (group totals).
const SIZER_LINES =
  'before:block before:h-0 before:overflow-hidden before:invisible before:whitespace-nowrap before:text-[9px] before:font-medium before:uppercase before:tracking-wider after:block after:h-0 after:overflow-hidden after:invisible after:whitespace-nowrap after:text-[11px] after:font-semibold after:normal-case after:tracking-normal after:tabular-nums';

export const MOBILE_TABLE_ALLOCATED_CELL = `${SIZER_LINES} before:content-[var(--budget-col-allocated-label)] after:content-[var(--budget-col-allocated-value)]`;

// Category rows show an info icon after the available amount: reserve it.
export const MOBILE_TABLE_AVAILABLE_CELL = `${SIZER_LINES} before:content-[var(--budget-col-available-label)] after:content-[var(--budget-col-available-value)] after:pr-3.5`;

const cssString = (value: string) => JSON.stringify(value);

const longest = (values: string[]) =>
  values.reduce((widest, value) => (value.length > widest.length ? value : widest), '');

export function mobileTableColumnVars({
  allocatedLabel,
  availableLabel,
  allocatedValues,
  availableValues,
}: {
  allocatedLabel: string;
  availableLabel: string;
  allocatedValues: string[];
  availableValues: string[];
}): CSSProperties {
  return {
    '--budget-col-allocated-label': cssString(allocatedLabel),
    '--budget-col-available-label': cssString(availableLabel),
    '--budget-col-allocated-value': cssString(longest(allocatedValues)),
    '--budget-col-available-value': cssString(longest(availableValues)),
  } as CSSProperties;
}
