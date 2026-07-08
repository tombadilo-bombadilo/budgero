import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@shared/ui/alert-dialog';
import { buttonVariants } from '@shared/ui/button';
import { cn } from '@shared/lib/utils';

export interface FutureOverspendingMonth {
  month: string;
  /** Integer milliunits. */
  currentAvailable: number;
  /** Integer milliunits. */
  projectedAvailable: number;
}

interface FutureOverspendingWarningProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  affectedMonths: FutureOverspendingMonth[];
  onConfirm: () => void | Promise<void>;
  /** Formats a stored integer-milliunit amount for display. */
  formatAmount: (val: number) => string;
  formatMonth: (month: string) => string;
}

export function FutureOverspendingWarning({
  open,
  onOpenChange,
  affectedMonths,
  onConfirm,
  formatAmount,
  formatMonth,
}: FutureOverspendingWarningProps) {
  const handleConfirm = async () => {
    await onConfirm();
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>This will cause overspending</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>This change will cause negative Available in future months for this category:</p>
              <ul className="space-y-1 text-sm">
                {affectedMonths.map((m) => (
                  <li key={m.month} className="flex justify-between gap-4">
                    <span className="font-medium">{formatMonth(m.month)}</span>
                    <span className="text-destructive font-medium">
                      {formatAmount(m.projectedAvailable)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className={cn(buttonVariants({ variant: 'destructive' }))}
          >
            Proceed anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
