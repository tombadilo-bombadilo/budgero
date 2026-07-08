/**
 * Import Progress Step Component
 *
 * Fourth step of the import wizard - shows import progress.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Progress } from '@shared/ui/progress';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { AlertTriangle } from 'lucide-react';
import { Spinner } from '@shared/ui/spinner';
import type { ImportProgress } from '@features/import/model/types';

interface ImportProgressStepProps {
  progress: ImportProgress | null;
  error: string | null;
}

export function ImportProgressStep({ progress, error }: ImportProgressStepProps) {
  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Spinner className="h-5 w-5" />
          Importing Data
        </CardTitle>
        <CardDescription>Please wait while we import your transactions</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {progress && (
          <div className="space-y-4">
            <div className="flex justify-between text-sm">
              <span>{progress.step}</span>
              <span>{Math.floor(progress.progress)}%</span>
            </div>
            <Progress value={progress.progress} className="h-2" />
            {progress.currentItem && (
              <p className="text-sm text-muted-foreground">{progress.currentItem}</p>
            )}
          </div>
        )}

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
