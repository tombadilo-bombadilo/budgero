/**
 * Mapping Tab
 *
 * "Column Mapping" tab of the configure step: column → field mapping, the
 * default-year escape hatch for yearless dates, skip-rows, manual header
 * selection (PDFs), and the raw-table / preview-table row-skip pickers.
 */

import * as React from 'react';

import { Checkbox } from '@shared/ui/checkbox';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { AlertTriangle } from 'lucide-react';
import type {
  ParsedData,
  ColumnMapping,
  ImportConfig,
  RawTableData,
} from '@features/import/model/types';
import { dateStringLacksYear } from '@budgero/core/browser';

interface SkipRowCheckboxProps {
  skipped: boolean;
  onClick: (e: React.MouseEvent) => void;
  onCheckedChange: (checked: boolean | 'indeterminate') => void;
}

function SkipRowCheckbox({ skipped, onClick, onCheckedChange }: SkipRowCheckboxProps) {
  return (
    <Checkbox
      className="mr-2 size-5 align-middle [&_svg]:size-4"
      aria-label={skipped ? 'Include this row in import' : 'Skip this row from import'}
      checked={!skipped}
      onClick={onClick}
      onCheckedChange={onCheckedChange}
    />
  );
}

interface MappingTabProps {
  parsedData: ParsedData | null;
  columnMapping: ColumnMapping;
  importConfig: ImportConfig;
  rawTableData: RawTableData | null;
  selectedHeaderIndex: number | null;
  skippedRowIndices: Set<number>;
  onColumnMappingChange: (mapping: ColumnMapping) => void;
  onImportConfigChange: (config: ImportConfig) => void;
  onToggleSkippedRow: (parsedRowIndex: number) => void;
  onSetSkippedRowsInRange: (indices: number[], shouldSkip: boolean) => void;
  onHeaderSelect: (index: number, headers: string[], rows: Record<string, string>[]) => void;
}

export function MappingTab({
  parsedData,
  columnMapping,
  importConfig,
  rawTableData,
  selectedHeaderIndex,
  skippedRowIndices,
  onColumnMappingChange,
  onImportConfigChange,
  onToggleSkippedRow,
  onSetSkippedRowsInRange,
  onHeaderSelect,
}: MappingTabProps) {
  const handleColumnChange = (field: keyof ColumnMapping, value: string) => {
    onColumnMappingChange({
      ...columnMapping,
      [field]: value === 'none' ? undefined : value,
    });
  };

  // The raw table view (for PDFs) is sliced locally by `importConfig.skipRows`
  // so the user can drop garbage rows from the top without re-uploading.
  // For CSVs the parent re-parses on skipRows change, so `parsedData.rows`
  // is already post-skip — we don't slice it again here.
  const skipRows = Math.max(0, importConfig.skipRows ?? 0);
  const visibleRawRows = rawTableData?.allRows?.slice(skipRows) ?? [];

  // Suggested header index, remapped into the visible (post-skip) view.
  const visibleSuggestedHeaderIndex =
    typeof rawTableData?.suggestedHeaderIndex === 'number'
      ? Math.max(0, rawTableData.suggestedHeaderIndex - skipRows)
      : null;

  const handleHeaderRowSelect = (visibleIndex: number) => {
    if (!rawTableData?.allRows) return;

    // Translate the click index from the visible (post-skip) view back to the
    // absolute index in `rawTableData.allRows`, which is what the parent
    // state tracks.
    const absoluteIndex = visibleIndex + skipRows;

    const row = rawTableData.allRows[absoluteIndex];
    if (!row) return;

    // Build a header label for EVERY column the parser detected, not just the
    // ones that have a non-empty title in the chosen header row. Bank PDFs
    // sometimes have summary blocks at the top that introduce phantom columns,
    // or use headers that span multiple physical lines so a column ends up
    // unlabeled. Auto-naming unlabeled columns "Column N" lets the user pick
    // them in the mapping dropdowns instead of silently losing the data.
    const seenLabels = new Set<string>();
    const headers: string[] = row.map((cell: string, i: number) => {
      const trimmed = (cell || '').trim();
      const base = trimmed.length > 0 ? trimmed : `Column ${i + 1}`;
      // Disambiguate accidental duplicate header labels by suffixing the
      // column index, otherwise the row object below would collapse them.
      let label = base;
      let suffix = 2;
      while (seenLabels.has(label)) {
        label = `${base} (${suffix})`;
        suffix++;
      }
      seenLabels.add(label);
      return label;
    });

    const newRows = rawTableData.allRows.slice(absoluteIndex + 1).map((dataRow: string[]) => {
      const rowObj: Record<string, string> = {};
      headers.forEach((header, i) => {
        rowObj[header] = dataRow[i] || '';
      });
      return rowObj;
    });

    onHeaderSelect(absoluteIndex, headers, newRows);
  };

  const handleSkipRowsChange = (value: number) => {
    onImportConfigChange({
      ...importConfig,
      skipRows: Math.max(0, value | 0),
    });
  };

  // Shift-click range selection for the row-skip checkboxes. Separate
  // anchors per table (raw table vs. preview table) so ranges don't leak
  // across them.
  const rawAnchorRef = React.useRef<number | null>(null);
  const previewAnchorRef = React.useRef<number | null>(null);
  const shiftHeldRef = React.useRef(false);

  const handleSkipCheckboxClick = (e: React.MouseEvent) => {
    // Capture the shift state on the raw click event. Radix's
    // onCheckedChange doesn't give us the modifier keys, so we stash it
    // here and read it back a moment later in onCheckedChange.
    e.stopPropagation();
    shiftHeldRef.current = e.shiftKey;
  };

  const handleSkipCheckboxCheckedChange = (
    parsedIndex: number,
    checked: boolean | 'indeterminate',
    anchorRef: React.MutableRefObject<number | null>
  ) => {
    const shouldSkip = checked === false;
    const anchor = anchorRef.current;

    if (shiftHeldRef.current && anchor !== null && anchor !== parsedIndex) {
      const from = Math.min(anchor, parsedIndex);
      const to = Math.max(anchor, parsedIndex);
      const range: number[] = [];
      for (let i = from; i <= to; i++) range.push(i);
      onSetSkippedRowsInRange(range, shouldSkip);
    } else {
      onToggleSkippedRow(parsedIndex);
    }

    anchorRef.current = parsedIndex;
    shiftHeldRef.current = false;
  };

  // Detect whether the currently-mapped date column carries yearless dates
  // like "Oct 25" (typical for CIBC-style credit card statements). If so,
  // we surface a "Default year" input so the user can pin those imports to
  // the correct year.
  const dateColumnLacksYear = React.useMemo(() => {
    if (!columnMapping.date || !parsedData?.rows || parsedData.rows.length === 0) {
      return false;
    }
    const samples = parsedData.rows
      .slice(0, 10)
      .map((row) => (row[columnMapping.date as string] ?? '').trim())
      .filter((s) => s.length > 0);
    if (samples.length === 0) return false;
    // Show the input if MOST samples look yearless (tolerates a handful of
    // mixed or empty rows).
    const yearless = samples.filter((s) => dateStringLacksYear(s)).length;
    return yearless / samples.length >= 0.6;
  }, [columnMapping.date, parsedData]);

  const handleDefaultYearChange = (value: string) => {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      onImportConfigChange({ ...importConfig, defaultYear: undefined });
      return;
    }
    if (parsed < 1900 || parsed > 2999) return;
    onImportConfigChange({ ...importConfig, defaultYear: parsed });
  };

  return (
    <>
      <Alert className="mb-4">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription className="break-words">
          <strong>Required:</strong> Date column + Amount column (or Inflow/Outflow columns)
          <br />
          <strong>Optional:</strong> Payee, Account, Category, Memo (will use account selection
          below if not mapped)
        </AlertDescription>
      </Alert>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {['date', 'amount', 'inflow', 'outflow', 'payee', 'memo', 'account', 'category'].map(
          (field) => (
            <div key={field} className="space-y-2">
              <Label htmlFor={field} className="capitalize">
                {field}{' '}
                {field === 'date'
                  ? '(Required)'
                  : field === 'amount'
                    ? '(Required - or use Inflow/Outflow)'
                    : '(Optional)'}
              </Label>
              <Select
                value={columnMapping[field as keyof ColumnMapping] || 'none'}
                onValueChange={(value) => handleColumnChange(field as keyof ColumnMapping, value)}
              >
                <SelectTrigger className="w-full min-w-0">
                  <SelectValue placeholder={`Select ${field} column`} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {parsedData?.headers
                    .filter((header) => header && header.trim())
                    .map((header) => (
                      <SelectItem key={header} value={header}>
                        {header}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )
        )}
      </div>

      {/* Default year — shown when the mapped Date column contains
          "Mon DD" style values without a year (typical of credit
          card statements). */}
      {dateColumnLacksYear && (
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-amber-300/60 bg-amber-50/60 p-3 dark:border-amber-700/40 dark:bg-amber-950/20">
          <div className="space-y-1">
            <Label htmlFor="configure-default-year" className="text-xs font-medium">
              Default year
            </Label>
            <Input
              id="configure-default-year"
              type="number"
              min={1900}
              max={2999}
              className="h-9 w-28"
              value={importConfig.defaultYear ?? new Date().getFullYear()}
              onChange={(e) => handleDefaultYearChange(e.target.value)}
            />
          </div>
          <p className="flex-1 min-w-[12rem] text-xs text-muted-foreground">
            The selected date column has no year (e.g. "Oct 25"). All transactions will be imported
            using this year. Change it if the statement covers a different year.
          </p>
        </div>
      )}

      {/* Skip-rows escape hatch — useful when the start of the file
          contains banner text, blank rows, or anything else that
          shouldn't be part of the table. */}
      {(rawTableData?.allRows || (parsedData && parsedData.rows.length > 0)) && (
        <div className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
          <div className="space-y-1">
            <Label htmlFor="configure-skip-rows" className="text-xs font-medium">
              Skip first N rows
            </Label>
            <Input
              id="configure-skip-rows"
              type="number"
              min={0}
              className="h-9 w-24"
              value={skipRows}
              onChange={(e) => handleSkipRowsChange(parseInt(e.target.value, 10) || 0)}
            />
          </div>
          <p className="flex-1 min-w-[12rem] text-xs text-muted-foreground">
            Drop garbage rows from the top of the file (titles, blank lines, page banners). Header
            detection and the previews below update automatically.
          </p>
        </div>
      )}

      {/* Manual Header Selection for PDFs */}
      {rawTableData && rawTableData.allRows && Array.isArray(rawTableData.allRows) && (
        <div className="mt-6">
          <h4 className="font-medium mb-2">Select Header Row:</h4>
          <p className="text-sm text-muted-foreground mb-4">
            Click on the row that contains your table headers.{' '}
            {visibleSuggestedHeaderIndex !== null &&
              visibleSuggestedHeaderIndex < visibleRawRows.length &&
              `Row ${visibleSuggestedHeaderIndex + 1} is suggested.`}{' '}
            Showing {visibleRawRows.length} of {rawTableData.allRows.length} detected rows
            {skipRows > 0 ? ` (first ${skipRows} skipped)` : ''}
            {skippedRowIndices.size > 0 ? `, ${skippedRowIndices.size} excluded from import` : ''}.
            Once a header is selected, uncheck the box in any data row to exclude it. Hold Shift and
            click to toggle a range.
          </p>
          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-auto max-h-96">
              <table className="w-full text-sm border-collapse">
                {selectedHeaderIndex !== null && rawTableData.allRows[selectedHeaderIndex] && (
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-primary/15 border-b-2 border-primary">
                      <th className="px-2 py-1 text-xs text-muted-foreground border-r whitespace-nowrap text-left bg-primary/15">
                        {selectedHeaderIndex + 1} (header)
                      </th>
                      {rawTableData.allRows[selectedHeaderIndex].map(
                        (cell: string, cellIndex: number) => (
                          <th
                            key={cellIndex}
                            className="px-3 py-2 max-w-32 truncate border-r last:border-r-0 text-left font-semibold bg-primary/15"
                          >
                            {cell || '—'}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {visibleRawRows.slice(0, 500).map((row: string[], visibleIndex: number) => {
                    const absoluteIndex = visibleIndex + skipRows;
                    const isHeaderSelected = selectedHeaderIndex !== null;
                    const parsedRowIndex = isHeaderSelected
                      ? absoluteIndex - (selectedHeaderIndex as number) - 1
                      : -1;
                    const isDataRow = isHeaderSelected && parsedRowIndex >= 0;
                    const isSkipped = isDataRow && skippedRowIndices.has(parsedRowIndex);
                    return (
                      <tr
                        key={absoluteIndex}
                        className={`border-t cursor-pointer hover:bg-muted/50 ${
                          selectedHeaderIndex === absoluteIndex
                            ? 'bg-primary/10 border-primary'
                            : absoluteIndex === rawTableData.suggestedHeaderIndex
                              ? 'bg-yellow-50 border-yellow-200'
                              : ''
                        } ${isSkipped ? 'opacity-50 line-through' : ''}`}
                        onClick={() => handleHeaderRowSelect(visibleIndex)}
                      >
                        <td className="px-2 py-1 text-xs text-muted-foreground border-r whitespace-nowrap">
                          {isDataRow && (
                            <SkipRowCheckbox
                              skipped={isSkipped}
                              onClick={handleSkipCheckboxClick}
                              onCheckedChange={(checked) =>
                                handleSkipCheckboxCheckedChange(
                                  parsedRowIndex,
                                  checked,
                                  rawAnchorRef
                                )
                              }
                            />
                          )}
                          {absoluteIndex + 1}
                          {absoluteIndex === rawTableData.suggestedHeaderIndex && ' (suggested)'}
                          {selectedHeaderIndex === absoluteIndex && ' (selected)'}
                        </td>
                        {row.map((cell: string, cellIndex: number) => (
                          <td
                            key={cellIndex}
                            className="px-3 py-2 max-w-32 truncate border-r last:border-r-0"
                          >
                            {cell || '—'}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {parsedData && parsedData.headers.length > 0 && parsedData.rows.length > 0 && (
        <div className="mt-6">
          <h4 className="font-medium mb-2">Preview of your data:</h4>
          <p className="text-xs text-muted-foreground mb-2">
            Showing {Math.min(parsedData.rows.length, 500)} of {parsedData.rows.length} rows
            {skipRows > 0 ? ` (first ${skipRows} skipped)` : ''}
            {skippedRowIndices.size > 0 ? `, ${skippedRowIndices.size} excluded` : ''}. Uncheck the
            box to exclude a row from import. Hold Shift and click to toggle a range.
          </p>
          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-auto max-h-96">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-muted sticky top-0 z-10">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium bg-muted">#</th>
                    {parsedData.headers
                      .filter((header) => header && header.trim())
                      .map((header) => (
                        <th key={header} className="px-3 py-2 text-left font-medium bg-muted">
                          {header}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {parsedData.rows.slice(0, 500).map((row, index) => {
                    const isSkipped = skippedRowIndices.has(index);
                    return (
                      <tr
                        key={index}
                        className={`border-t ${isSkipped ? 'opacity-50 line-through' : ''}`}
                      >
                        <td className="px-2 py-1 text-xs text-muted-foreground border-r whitespace-nowrap">
                          <SkipRowCheckbox
                            skipped={isSkipped}
                            onClick={handleSkipCheckboxClick}
                            onCheckedChange={(checked) =>
                              handleSkipCheckboxCheckedChange(index, checked, previewAnchorRef)
                            }
                          />
                          {index + 1}
                        </td>
                        {parsedData.headers
                          .filter((header) => header && header.trim())
                          .map((header) => (
                            <td key={header} className="px-3 py-2 max-w-32 truncate">
                              {row[header] || '—'}
                            </td>
                          ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
