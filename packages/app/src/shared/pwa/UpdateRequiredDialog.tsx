import { useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@shared/ui/alert-dialog';
import { subscribeUpdateRequired } from '@shared/lib/update-required';
import { useServiceWorkerUpdate } from './ServiceWorkerUpdateProvider';

/**
 * Blocking prompt shown when this build is too old for the data it met (see
 * update-required.ts). Not dismissible: syncing has already been refused by
 * the server/runtime, so the only way forward is updating the app.
 */
export function UpdateRequiredDialog() {
  const [reason, setReason] = useState<string | null>(null);
  const { applyUpdate, checkForUpdates, isSupported } = useServiceWorkerUpdate();

  useEffect(() => subscribeUpdateRequired(({ reason: r }) => setReason(r)), []);

  if (!reason) return null;

  const handleUpdate = async () => {
    if (isSupported) {
      await checkForUpdates();
      applyUpdate();
    }
    // Fallback (and self-host without SW): a plain reload fetches the new build
    window.location.reload();
  };

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Update required</AlertDialogTitle>
          <AlertDialogDescription>
            Your budget was modified by a newer version of Budgero. To keep your data safe, this
            device has stopped syncing until the app is updated.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={handleUpdate}>Update now</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
