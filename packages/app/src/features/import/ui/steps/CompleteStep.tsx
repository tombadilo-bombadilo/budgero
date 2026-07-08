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
  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle className="h-5 w-5 text-green-600" />
          Import Complete!
        </CardTitle>
        <CardDescription>Your data has been successfully imported</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {importSummary && (
          <div className="bg-muted p-4 rounded-md">
            <h3 className="font-medium mb-2">Import Summary</h3>
            <ul className="space-y-1 text-sm">
              <li className="flex justify-between">
                <span>Transactions imported:</span>
                <span className="font-medium">{importSummary.transactionsImported}</span>
              </li>
              {(importSummary.transactionsSkipped ?? 0) > 0 && (
                <li className="flex justify-between">
                  <span>Rows skipped (no/unreadable amount):</span>
                  <span className="font-medium">{importSummary.transactionsSkipped}</span>
                </li>
              )}
              <li className="flex justify-between">
                <span>Destination account:</span>
                <span className="font-medium">
                  {(importSummary.destinationAccountName || 'Existing account') +
                    (importSummary.accountsCreated > 0 ? ' (created)' : '')}
                </span>
              </li>
              <li className="flex justify-between">
                <span>New categories created:</span>
                <span className="font-medium">
                  {importSummary.categoriesCreated > 0 ? importSummary.categoriesCreated : 'None'}
                </span>
              </li>
            </ul>
          </div>
        )}

        <Button className="w-full" onClick={onReset}>
          Import Another File
        </Button>
      </CardContent>
    </Card>
  );
}
