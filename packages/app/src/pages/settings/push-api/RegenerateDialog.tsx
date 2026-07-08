import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import { AlertTriangle } from 'lucide-react';
import type { PushApiState } from './usePushApiState';

interface RegenerateDialogProps {
  state: PushApiState;
}

export function RegenerateDialog({ state }: RegenerateDialogProps) {
  const {
    showRegenerateDialog,
    setShowRegenerateDialog,
    showKeyWarningDialog,
    setShowKeyWarningDialog,
    confirmRegenerate,
    confirmRevealKey,
  } = state;

  return (
    <>
      {/* Regenerate Confirmation Dialog */}
      <ConfirmDialog
        open={showRegenerateDialog}
        onOpenChange={setShowRegenerateDialog}
        title="Regenerate API Token?"
        description="This will create a new token and invalidate your current one. Any external services using the old token will need to be updated with the new token."
        confirmText="Regenerate Token"
        onConfirm={confirmRegenerate}
      />

      {/* Encryption Key Warning Dialog */}
      <ConfirmDialog
        open={showKeyWarningDialog}
        onOpenChange={setShowKeyWarningDialog}
        icon={<AlertTriangle className="h-5 w-5 text-yellow-500" />}
        title="Security Warning"
        description={
          <span className="block space-y-3">
            <p>
              You are about to reveal your <strong>encryption key</strong>. This key can decrypt all
              your budget data.
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>Never share this key publicly</li>
              <li>Store it in a secure password manager</li>
              <li>Anyone with this key can read your budget data</li>
              <li>The key will auto-hide after 60 seconds</li>
            </ul>
            <p className="font-medium">Are you sure you want to reveal the key?</p>
          </span>
        }
        confirmText="Reveal Key"
        onConfirm={confirmRevealKey}
      />
    </>
  );
}
