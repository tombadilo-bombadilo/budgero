import { Trans, useLingui } from '@lingui/react/macro';
import { ChangeEvent, RefObject } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Upload, AlertTriangle } from 'lucide-react';
import { SUPPORTED_IMPORT_FORMATS_LABEL } from '@features/import/lib/constants';

/** Import templates shipped in public/templates (served next to the app). */
const TEMPLATE_BASE = `${import.meta.env.BASE_URL}templates/`;

interface UploadStepProps {
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  error: string | null;
  hasBudgetSelected: boolean;
}

export function UploadStep({
  fileInputRef,
  onFileChange,
  error,
  hasBudgetSelected,
}: UploadStepProps) {
  const { t } = useLingui();
  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trans>
            <Upload className="h-5 w-5" />
            Import Transactions
          </Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Upload a {t(SUPPORTED_IMPORT_FORMATS_LABEL)} file to import your transactions into a
            budget
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!hasBudgetSelected && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <Trans>Please select a budget from the sidebar before importing transactions.</Trans>
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="file-upload">
            <Trans>Select File</Trans>
          </Label>
          <Input
            id="file-upload"
            type="file"
            ref={fileInputRef}
            onChange={onFileChange}
            accept=".csv,.tsv,.pdf,.txt,.ofx,.qfx,.qif,.xml"
            className="cursor-pointer"
            disabled={!hasBudgetSelected}
          />
          <p className="text-sm text-muted-foreground">
            <Trans>
              Supported formats: CSV, TSV, TXT, PDF (table data), OFX, QFX, QIF, CAMT.053 (XML)
            </Trans>
          </p>
          <p className="text-sm text-muted-foreground" data-testid="import-templates">
            <Trans>
              Need a template?{' '}
              <a
                href={`${TEMPLATE_BASE}budgero-import-template.xlsx`}
                download
                className="font-medium text-primary underline underline-offset-2"
              >
                Spreadsheet template (.xlsx)
              </a>{' '}
              ·{' '}
              <a
                href={`${TEMPLATE_BASE}budgero-import-template.csv`}
                download
                className="font-medium text-primary underline underline-offset-2"
              >
                CSV template
              </a>
            </Trans>
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
