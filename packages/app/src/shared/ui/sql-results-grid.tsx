import { memo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';

export interface SqlResultsGridProps {
  columns: string[];
  rows: unknown[][];
  /** Column/cell width classes, e.g. `w-[100px] sm:w-[140px]`. */
  cellWidthClassName: string;
  /** Header cell padding classes, e.g. `px-2 py-1.5`. */
  headerPaddingClassName: string;
  /** Body cell padding classes, e.g. `py-1.5 px-2`. */
  cellPaddingClassName: string;
  /** When true, renders the truncation footer below the grid. */
  showTruncated: boolean;
  /** Footer node shown when `showTruncated` is true (page supplies the wording/counts). */
  truncatedFooter?: React.ReactNode;
  /** Message rendered when the query returned no columns/rows. */
  emptyMessage: string;
}

/**
 * Shared results grid for SQL query output: a horizontally/vertically scrollable
 * table with a sticky header, NULL-aware cell rendering, an optional truncation
 * footer, and an empty-state message. The surrounding card chrome (title, badges,
 * dry-run indicators) stays per-page since it diverges between consumers.
 */
export const SqlResultsGrid = memo(
  ({
    columns,
    rows,
    cellWidthClassName,
    headerPaddingClassName,
    cellPaddingClassName,
    showTruncated,
    truncatedFooter,
    emptyMessage,
  }: SqlResultsGridProps) => {
    if (columns.length === 0) {
      return (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
          {emptyMessage}
        </div>
      );
    }

    return (
      <div className="w-full overflow-hidden">
        <div className="relative max-h-96 overflow-auto">
          <div className="w-max min-w-full">
            <Table className="w-max min-w-full">
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  {columns.map((column, index) => (
                    <TableHead
                      key={index}
                      className={`font-mono text-xs ${cellWidthClassName} bg-muted/50 whitespace-nowrap ${headerPaddingClassName}`}
                    >
                      {column}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, rowIndex) => (
                  <TableRow key={rowIndex} className="text-xs hover:bg-muted/50">
                    {row.map((cell, cellIndex) => (
                      <TableCell
                        key={cellIndex}
                        className={`font-mono text-xs ${cellPaddingClassName} ${cellWidthClassName}`}
                      >
                        {cell === null ? (
                          <span className="text-muted-foreground italic">NULL</span>
                        ) : (
                          <span className="break-words text-xs truncate block">{String(cell)}</span>
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
        {showTruncated && truncatedFooter}
      </div>
    );
  }
);

SqlResultsGrid.displayName = 'SqlResultsGrid';
