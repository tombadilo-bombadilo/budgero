import { useState, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@shared/ui/alert-dialog';
import { buttonVariants } from '@shared/ui/button';
import { Spinner } from '@shared/ui/spinner';
import { cn } from '@shared/lib/utils';

interface ConfirmDialogProps {
  /** Controlled open state; omit (with `trigger`) for uncontrolled usage. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional element that opens the dialog, rendered via AlertDialogTrigger. */
  trigger?: ReactNode;
  title: ReactNode;
  /** Omit to render a title-only dialog (no description element). */
  description?: ReactNode;
  /** Optional icon rendered before the title. */
  icon?: ReactNode;
  confirmText?: ReactNode;
  cancelText?: string;
  /** Confirm-button label while `isLoading`. */
  loadingText?: string;
  variant?: 'default' | 'destructive';
  onConfirm: () => void | Promise<void>;
  /**
   * While true the dialog stays open, both buttons are disabled, and the
   * confirm button shows a spinner + `loadingText`.
   */
  isLoading?: boolean;
  /** Extra disable condition for the confirm button. */
  confirmDisabled?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  icon,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  loadingText = 'Processing...',
  variant = 'default',
  onConfirm,
  isLoading = false,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = open !== undefined;
  const actualOpen = isControlled ? open : uncontrolledOpen;

  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const handleConfirm = async (event: React.MouseEvent<HTMLButtonElement>) => {
    // Prevent Radix from auto-closing so the dialog stays open while the
    // action is pending; close explicitly once it settles.
    event.preventDefault();
    await onConfirm();
    setOpen(false);
  };

  return (
    <AlertDialog open={actualOpen} onOpenChange={setOpen}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className={icon ? 'flex items-center gap-2' : undefined}>
            {icon}
            {title}
          </AlertDialogTitle>
          {description !== undefined && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>{cancelText}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isLoading || confirmDisabled}
            className={cn(variant === 'destructive' && buttonVariants({ variant: 'destructive' }))}
          >
            {isLoading ? (
              <>
                <Spinner size="sm" />
                {loadingText}
              </>
            ) : (
              confirmText
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
