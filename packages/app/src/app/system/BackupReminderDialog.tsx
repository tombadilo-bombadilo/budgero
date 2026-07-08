import { useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@shared/ui/alert-dialog';
import { Button } from '@shared/ui/button';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { useRecordBackup } from '@entities/user/api/useAuth';
import { toast } from 'sonner';
import { Database, ShieldAlert } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getTodayISO } from '@shared/lib/date-utils';
import { getErrorMessage } from '@shared/lib/errors';
import type { User } from '@shared/model/auth';

type BackupReminderDialogProps = {
  open?: boolean;
  blockClose?: boolean;
  onBackupRecorded?: (timestamp: string) => void;
  description?: string;
};

function downloadFile(data: Uint8Array | string | Blob, filename: string, mimeType: string) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function BackupReminderDialog(props: BackupReminderDialogProps) {
  const runtime = useRuntime();
  const recordBackup = useRecordBackup();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(Boolean(props.open));
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    setDialogOpen(Boolean(props.open));
  }, [props.open]);

  const handleOpenChange = (open: boolean) => {
    if (props.blockClose && !open) {
      setDialogOpen(true);
      return;
    }
    setDialogOpen(open);
  };

  const handleDownloadBackup = async () => {
    setIsExporting(true);
    try {
      const services = runtime.services();
      const dbData = await services.export.exportDatabase();
      const timestamp = getTodayISO();
      const filename = `budgero-backup-${timestamp}.db`;
      const recordedAt = new Date().toISOString();

      downloadFile(dbData, filename, 'application/x-sqlite3');
      toast.success('Database backup downloaded');

      let recordedOnServer = false;
      try {
        await recordBackup.mutateAsync();
        recordedOnServer = true;
      } catch (recordError) {
        console.warn('Failed to record backup timestamp', recordError);
      }
      if (!recordedOnServer) {
        queryClient.setQueryData<User | undefined>(['profile'], (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            last_user_db_backup: recordedAt,
          };
        });
      }
      props.onBackupRecorded?.(recordedAt);
      setDialogOpen(false);
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to create backup');
      toast.error(message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <AlertDialog open={dialogOpen} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            Back up your data
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <p>
              {props.description ||
                'You need a fresh backup to recover quickly if the database ever corrupts or you lose your master password.'}
            </p>
            <p className="font-medium text-foreground">
              This reminder isn&apos;t skippable—download a backup now to stay protected.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-row justify-end gap-2">
          <Button
            onClick={handleDownloadBackup}
            disabled={isExporting || recordBackup.isPending}
            className="w-full sm:w-auto"
          >
            {isExporting ? (
              'Preparing backup…'
            ) : (
              <>
                <Database className="h-4 w-4 mr-2" />
                Download backup
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
