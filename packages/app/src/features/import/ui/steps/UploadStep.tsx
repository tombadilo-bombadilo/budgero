import { ChangeEvent, RefObject } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Upload, AlertTriangle } from 'lucide-react';
import { SUPPORTED_IMPORT_FORMATS_LABEL } from '@features/import/lib/constants';

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
  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Import Transactions
        </CardTitle>
        <CardDescription>
          Upload a {SUPPORTED_IMPORT_FORMATS_LABEL} file to import your transactions into a budget
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!hasBudgetSelected && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Please select a budget from the sidebar before importing transactions.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="file-upload">Select File</Label>
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
            Supported formats: CSV, TSV, TXT, PDF (table data), OFX, QFX, QIF, CAMT.053 (XML)
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
