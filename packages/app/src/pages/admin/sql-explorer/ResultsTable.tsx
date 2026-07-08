import { memo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Badge } from '@shared/ui/badge';
import { SqlResultsGrid } from '@shared/ui/sql-results-grid';
import { Shield } from 'lucide-react';
import type { ResultsTableProps } from './types';
import { shouldShowTruncatedWarning } from './sql-explorer.utils';

export const ResultsTable = memo(
  ({ result }: ResultsTableProps) => {
    if (!result) return null;

    return (
      <Card className={result.isDryRun ? 'border-green-600/50 bg-green-50/5' : ''}>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                Results
                {result.isDryRun && (
                  <Badge variant="outline" className="text-green-600 border-green-600">
                    <Shield className="h-3 w-3 mr-1" />
                    Dry Run
                  </Badge>
                )}
              </CardTitle>
              {result.message && (
                <CardDescription className="mt-1 text-xs text-muted-foreground">
                  {result.message}
                </CardDescription>
              )}
            </div>
            <div className="flex gap-2 text-xs">
              <Badge variant="secondary">{result.rowCount.toLocaleString()} total rows</Badge>
              <Badge variant="secondary">{result.executionTime.toFixed(1)}ms</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <SqlResultsGrid
            columns={result.columns}
            rows={result.rows}
            cellWidthClassName="w-[100px] sm:w-[140px]"
            headerPaddingClassName="px-2 py-1.5"
            cellPaddingClassName="py-1.5 px-2"
            showTruncated={shouldShowTruncatedWarning(result)}
            truncatedFooter={
              <div className="p-2 text-center text-xs text-muted-foreground bg-muted/20 border-t">
                Showing {result.fetchedRows.toLocaleString()} of {result.rowCount.toLocaleString()}{' '}
                total rows
              </div>
            }
            emptyMessage="Query executed successfully - no rows returned."
          />
        </CardContent>
      </Card>
    );
  },
  (prev, next) => prev.result === next.result
);

ResultsTable.displayName = 'ResultsTable';
