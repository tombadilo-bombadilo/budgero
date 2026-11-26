import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { toast } from 'sonner';
import { Database, RefreshCw } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@shared/ui/alert-dialog';
import { Button } from '@shared/ui/button';
import { useRuntime } from '@shared/runtime/runtime-provider';
import { useRecordBackup } from '@entities/user/api/useAuth';
import { downloadBlob } from '@shared/lib/download';
import { getTodayISO } from '@shared/lib/date-utils';
import { getErrorMessage } from '@shared/lib/errors';
import { track } from '@shared/lib/analytics/track';

interface CurrencyChangeConfirmDialogProps {
  open: boolean;
  fromCurrency: string;
  toCurrency: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * A budget currency change re-converts every transaction, balance, assignment
 * and goal target. Say so, offer a backup first, and ask once more.
 */
export function CurrencyChangeConfirmDialog({
  open,
  fromCurrency,
  toCurrency,
  onCancel,
  onConfirm,
}: CurrencyChangeConfirmDialogProps) {
  const { t } = useLingui();
  const runtime = useRuntime();
  const recordBackup = useRecordBackup();
  const [isExporting, setIsExporting] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const handleDownload = async () => {
    setIsExporting(true);
    try {
      const data = await runtime.services().export.exportDatabase();
      downloadBlob(
        data,
        `budgero-backup-${getTodayISO()}-before-${toCurrency.toLowerCase()}.db`,
        'application/x-sqlite3'
      );
      track('backup_downloaded', { format: 'sqlite' });
      setDownloaded(true);
      toast.success(t`Database backup downloaded`);
      recordBackup.mutate(undefined, {
        onError: (error) => console.warn('Failed to record backup timestamp', error),
      });
    } catch (error) {
      toast.error(getErrorMessage(error, t`Failed to export database`));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            <Trans>
              Change the budget currency from {fromCurrency} to {toCurrency}?
            </Trans>
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                <Trans>
                  Every transaction, account balance, assigned amount and goal target in this budget
                  is converted to {toCurrency}, using the exchange rate of each transaction&apos;s
                  date. Amounts in each account&apos;s own currency stay the same.
                </Trans>
              </p>
              <p>
                <Trans>
                  This touches the whole budget and syncs to your other devices. Download a backup
                  first, so you can restore it if something looks wrong.
                </Trans>
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel onClick={onCancel}>
            <Trans>Cancel</Trans>
          </AlertDialogCancel>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleDownload()}
            disabled={isExporting}
          >
            <Database className="mr-2 h-4 w-4" />
            {downloaded ? <Trans>Backup downloaded</Trans> : <Trans>Download backup</Trans>}
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isExporting}>
            <RefreshCw className="mr-2 h-4 w-4" />
            <Trans>Change currency</Trans>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
