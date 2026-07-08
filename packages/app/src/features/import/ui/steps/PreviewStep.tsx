/**
 * Preview Step Component
 *
 * Third step of the import wizard - preview parsed transactions.
 */

import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Badge } from '@shared/ui/badge';
import { CheckCircle, ArrowRight } from 'lucide-react';
import type { PreviewRow, ColumnMapping, ImportConfig } from '@features/import/model/types';

interface PreviewStepProps {
  previewData: PreviewRow[];
  previewTotalCount: number;
  previewImportableCount: number;
  previewSkippedCount: number;
  columnMapping: ColumnMapping;
  importConfig: ImportConfig;
  hasBudgetSelected: boolean;
  onBack: () => void;
  onStartImport: () => void;
}

export function PreviewStep({
  previewData,
  previewTotalCount,
  previewImportableCount,
  previewSkippedCount,
  columnMapping,
  importConfig,
  hasBudgetSelected,
  onBack,
  onStartImport,
}: PreviewStepProps) {
  const canImport = hasBudgetSelected && (columnMapping.account || importConfig.defaultAccountId);
  const errorCount = previewData.filter((row) => row.errors.length > 0).length;
  const isPreviewCapped = previewTotalCount > previewData.length;

  return (
    <Card className="mx-auto w-full max-w-4xl overflow-x-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle className="h-5 w-5" />
          Preview Import
        </CardTitle>
        <CardDescription>Review how your data will be imported before proceeding</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 overflow-x-hidden">
        {previewData.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-medium">
              {previewImportableCount}{' '}
              {previewImportableCount === 1 ? 'transaction' : 'transactions'} will be imported
            </span>
            {previewSkippedCount > 0 && (
              <Badge variant="secondary">
                {previewSkippedCount} {previewSkippedCount === 1 ? 'row' : 'rows'} will be skipped
                (no/unreadable amount)
              </Badge>
            )}
            {isPreviewCapped && (
              <span className="text-muted-foreground">
                (showing first {previewData.length} below)
              </span>
            )}
            {errorCount > 0 && (
              <Badge variant="destructive">{errorCount} of the previewed rows have issues</Badge>
            )}
          </div>
        )}

        {previewData.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Amount</th>
                    <th className="px-3 py-2 text-left">Memo</th>
                    <th className="px-3 py-2 text-left">Payee</th>
                    <th className="px-3 py-2 text-left">Account</th>
                    <th className="px-3 py-2 text-left">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {previewData.map((item, index) => (
                    <tr key={index} className="border-t">
                      <td className="px-3 py-2">{item.parsed.date || '—'}</td>
                      <td className="px-3 py-2">
                        {item.parsed.amount !== undefined
                          ? `${item.parsed.amount >= 0 ? '+' : ''}${item.parsed.amount}`
                          : `+${item.parsed.inflow || 0} / -${item.parsed.outflow || 0}`}
                      </td>
                      <td className="px-3 py-2 max-w-48 truncate">{item.parsed.memo || '—'}</td>
                      <td className="px-3 py-2">{item.parsed.payee || '—'}</td>
                      <td className="px-3 py-2">{item.parsed.account || 'Default Account'}</td>
                      <td className="px-3 py-2">
                        {item.errors.length > 0 && (
                          <ul className="space-y-0.5 text-xs text-destructive">
                            {item.errors.map((message, errorIndex) => (
                              <li key={errorIndex}>{message}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button variant="outline" onClick={onBack} className="w-full sm:w-auto">
            Back to Configuration
          </Button>
          <Button onClick={onStartImport} disabled={!canImport} className="w-full sm:w-auto">
            Start Import
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
