/**
 * "Backup" tab of CreateBudgetForm: restore a Budgero `.db`/`.sqlite` backup,
 * replacing all data in the current workspace.
 */

import type { ChangeEvent, RefObject } from 'react';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Field } from '@shared/ui/field';
import { Loader2, Upload, AlertTriangle } from 'lucide-react';

interface RestoreBackupTabProps {
  coreFileInputRef: RefObject<HTMLInputElement | null>;
  coreFile: File | null;
  coreStatus: string | null;
  isCoreImporting: boolean;
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onReset: () => void;
  onImport: () => void;
}

export function RestoreBackupTab({
  coreFileInputRef,
  coreFile,
  coreStatus,
  isCoreImporting,
  onFileChange,
  onReset,
  onImport,
}: RestoreBackupTabProps) {
  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs sm:text-sm text-amber-900 dark:text-amber-100 dark:bg-amber-500/5 dark:border-amber-400/40">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>
            Restoring a Budgero backup replaces all data in this workspace. Use it right after
            setting up Budgero Cloud or when you&apos;re ready to move your offline database into
            sync.
          </span>
        </div>
      </div>

      <Field
        label={<span className="text-xs sm:text-sm">Budgero Backup File (.db or .sqlite)</span>}
        htmlFor="coreFile"
        hint={
          <span className="sm:text-sm">
            Choose the database you exported as a Budgero backup. We&apos;ll import every budget,
            account, and transaction.
          </span>
        }
      >
        <Input
          id="coreFile"
          ref={coreFileInputRef}
          type="file"
          accept=".db,.sqlite"
          onChange={onFileChange}
          disabled={isCoreImporting}
          className="h-8 sm:h-9 text-xs sm:text-sm"
        />
      </Field>

      {coreStatus && <div className="text-xs sm:text-sm text-muted-foreground">{coreStatus}</div>}

      <div className="flex gap-2 w-full">
        <Button
          type="button"
          variant="outline"
          onClick={onReset}
          disabled={isCoreImporting}
          className="flex-1 h-8 sm:h-9"
        >
          Reset
        </Button>
        <Button
          type="button"
          onClick={onImport}
          disabled={!coreFile || isCoreImporting}
          className="flex-1 h-8 sm:h-9"
        >
          {isCoreImporting ? (
            <>
              <Loader2 className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
              <span className="text-xs sm:text-sm">Importing...</span>
            </>
          ) : (
            <>
              <Upload className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
              <span className="text-xs sm:text-sm">Restore Backup</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
