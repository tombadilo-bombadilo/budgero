import { Trans, useLingui } from '@lingui/react/macro';
/**
 * Complete Step Component
 *
 * Final step of the import wizard - shows import summary.
 */

import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { CheckCircle } from 'lucide-react';
import type { ImportSummary } from '@features/import/model/types';

interface CompleteStepProps {
  importSummary: ImportSummary | null;
  onReset: () => void;
}

export function CompleteStep({ importSummary, onReset }: CompleteStepProps) {
  const { t } = useLingui();

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trans>
            <CheckCircle className="h-5 w-5 text-green-600" />
            Import Complete!
          </Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Review the results below. Failed rows can be retried by importing the file again.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {importSummary && (
          <div className="bg-muted p-4 rounded-md">
            <h3 className="font-medium mb-2">
              <Trans>Import Summary</Trans>
            </h3>
            <ul className="space-y-1 text-sm">
              <li className="flex justify-between">
                <span>
                  <Trans>Transactions imported:</Trans>
                </span>
                <span className="font-medium">{importSummary.transactionsImported}</span>
              </li>
              {!!importSummary.transactionsMatched && (
                <li className="flex justify-between">
                  <span>
                    <Trans>Matched to existing (marked cleared):</Trans>
                  </span>
                  <span className="font-medium">{importSummary.transactionsMatched}</span>
                </li>
              )}
              {(
                [
                  ['Duplicates skipped', importSummary.duplicatesSkipped],
                  ['User skipped', importSummary.userSkipped],
                  ['Invalid rows', importSummary.invalidRows],
                  ['Failed rows', importSummary.failedRows],
                ] as const
              ).map(([label, count]) => (
                <li key={label} className="flex justify-between">
                  <span>{label}:</span>
                  <span>{count ?? 0}</span>
                </li>
              ))}
              {importSummary.failures?.map((failure) => (
                <li key={failure.index} className="text-destructive">
                  <Trans>
                    Row {failure.index + 1}: {failure.message}
                  </Trans>
                </li>
              ))}
              <li className="flex justify-between">
                <span>
                  <Trans>Destination account:</Trans>
                </span>
                <span className="font-medium">
                  {(importSummary.destinationAccountName || 'Existing account') +
                    (importSummary.accountsCreated > 0 ? ' (created)' : '')}
                </span>
              </li>
              <li className="flex justify-between">
                <span>
                  <Trans>New categories created:</Trans>
                </span>
                <span className="font-medium">
                  {importSummary.categoriesCreated > 0 ? importSummary.categoriesCreated : t`None`}
                </span>
              </li>
            </ul>
          </div>
        )}

        <Button className="w-full" onClick={onReset}>
          <Trans>Import Another File</Trans>
        </Button>
      </CardContent>
    </Card>
  );
}
