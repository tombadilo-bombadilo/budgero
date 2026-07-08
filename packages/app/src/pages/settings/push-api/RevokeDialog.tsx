import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import type { PushApiState } from './usePushApiState';

interface RevokeDialogProps {
  state: PushApiState;
}

export function RevokeDialog({ state }: RevokeDialogProps) {
  const { showRevokeDialog, setShowRevokeDialog, revokeTokenMutation } = state;

  return (
    <ConfirmDialog
      open={showRevokeDialog}
      onOpenChange={setShowRevokeDialog}
      title="Revoke API Token?"
      description="This will permanently delete your API token. Any external services using this token will no longer be able to send data to Budgero. This action cannot be undone."
      confirmText="Revoke Token"
      variant="destructive"
      onConfirm={() => revokeTokenMutation.mutate()}
    />
  );
}
