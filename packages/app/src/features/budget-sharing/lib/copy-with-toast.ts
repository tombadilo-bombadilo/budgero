import { toast } from 'sonner';

interface CopyWithToastOptions {
  successTitle: string;
  successDescription?: string;
  errorTitle: string;
  errorDescription?: string;
  /** Runs only after a successful copy, before the toast (e.g. a "Copied!" flash). */
  onCopied?: () => void;
}

/**
 * Copy a value to the clipboard and toast the outcome.
 *
 * Centralizes the try/writeText/toast dance used by the invite-sharing UIs.
 */
export async function copyWithToast(value: string, options: CopyWithToastOptions): Promise<void> {
  const { successTitle, successDescription, errorTitle, errorDescription, onCopied } = options;
  try {
    await navigator.clipboard.writeText(value);
    onCopied?.();
    toast.success(
      successTitle,
      successDescription ? { description: successDescription } : undefined
    );
  } catch {
    toast.error(errorTitle, errorDescription ? { description: errorDescription } : undefined);
  }
}
