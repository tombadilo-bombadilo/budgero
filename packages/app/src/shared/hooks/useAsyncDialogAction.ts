import { useState } from 'react';
import { toast } from 'sonner';
import { getErrorMessage } from '@shared/lib/errors';

/**
 * Wrap an async dialog action with running state and error toasting.
 *
 * `run` awaits the action, invokes `onSuccess` (e.g. closing the dialog) when
 * it resolves, and toasts `errorMessage` (refined via getErrorMessage) when it
 * rejects. Create one instance per action so each gets its own running flag.
 */
export function useAsyncDialogAction({
  errorMessage,
  onSuccess,
}: {
  errorMessage: string;
  onSuccess?: () => void;
}) {
  const [isRunning, setIsRunning] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setIsRunning(true);
    try {
      await action();
      onSuccess?.();
    } catch (error) {
      toast.error(getErrorMessage(error, errorMessage));
    } finally {
      setIsRunning(false);
    }
  };

  return { isRunning, run };
}
