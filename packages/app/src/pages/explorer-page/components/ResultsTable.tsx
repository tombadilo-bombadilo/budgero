import { memo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Badge } from '@shared/ui/badge';
import { SqlResultsGrid } from '@shared/ui/sql-results-grid';
import type { QueryResult } from '../types';

export interface ResultsTableProps {
  result: QueryResult;
}

export const ResultsTable = memo(
  ({ result }: ResultsTableProps) => {
    if (!result) return null;

    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <CardTitle className="text-base">Results</CardTitle>
            <div className="flex gap-2 text-xs">
              <Badge variant="secondary">{result.rowCount} rows</Badge>
              <Badge variant="secondary">{result.executionTime.toFixed(1)}ms</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <SqlResultsGrid
            columns={result.columns}
            rows={result.rows}
            cellWidthClassName="w-[80px] sm:w-[120px]"
            headerPaddingClassName="px-1 sm:px-3 py-1 sm:py-2"
            cellPaddingClassName="py-1 sm:py-2 px-1 sm:px-3"
            showTruncated={result.rowCount > result.rows.length}
            truncatedFooter={
              <div className="p-2 sm:p-3 text-center text-xs text-muted-foreground bg-muted/20 border-t">
                Showing {result.rows.length.toLocaleString()} of {result.rowCount.toLocaleString()}{' '}
                total rows
              </div>
            }
            emptyMessage="Query executed successfully - no results returned"
          />
        </CardContent>
      </Card>
    );
  },
  (prev, next) => prev.result === next.result
);

ResultsTable.displayName = 'ResultsTable';
