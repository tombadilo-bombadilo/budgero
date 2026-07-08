/**
 * Serializes query results to CSV.
 *
 * Shared between the admin SQL explorer and the Explorer page.
 *
 * The empty-cell coercion differs by caller (`cell ?? ''` vs `cell || ''`),
 * which changes how 0/false cells render, so it is exposed via `emptyValue`.
 */
export interface ResultsToCsvOptions {
  /**
   * Maps each cell to a string. Defaults to `cell ?? ''`, so only
   * null/undefined cells become empty strings.
   */
  emptyValue?: (cell: unknown) => string;
}

const defaultEmptyValue = (cell: unknown): string => String(cell ?? '');

export function resultsToCsv(
  columns: string[],
  rows: unknown[][],
  options?: ResultsToCsvOptions
): string {
  const coerce = options?.emptyValue ?? defaultEmptyValue;
  return [
    columns.join(','),
    ...rows.map((row) =>
      row
        .map((cell) => {
          const value = coerce(cell);
          return value.includes(',') || value.includes('"') || value.includes('\n')
            ? `"${value.replace(/"/g, '""')}"`
            : value;
        })
        .join(',')
    ),
  ].join('\n');
}
