import { useLingui } from '@lingui/react/macro';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import { useReconciledEditConfirmStore } from './reconciled-edit-confirm';

/** The one dialog behind confirmReconciledEdit; mounted once in the dashboard layout. */
export function ReconciledEditConfirmHost() {
  const { t } = useLingui();
  const pending = useReconciledEditConfirmStore((state) => state.pending);
  const settle = useReconciledEditConfirmStore((state) => state.settle);

  return (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
      title={t`Change a reconciled amount?`}
      description={
        pending?.kind === 'transfer'
          ? t`This transfer has a reconciled side. Saving marks each side whose amount changes as uncleared, so you'll need to reconcile that account again.`
          : t`This transaction is reconciled. Saving the new amount marks it as uncleared, so you'll need to reconcile the account again.`
      }
      confirmText={t`Save and mark uncleared`}
      cancelText={t`Cancel`}
      onConfirm={() => settle(true)}
    />
  );
}
