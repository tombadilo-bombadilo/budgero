import { useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { UnifiedReport } from '@budgero/core/browser';
import { useDeleteReport } from '@entities/report/api/useReports';
import { getErrorMessage } from '@shared/lib/errors';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';

/**
 * "Delete question" with its confirmation, for notebook and SQL questions
 * alike: ask(report) opens the dialog; render `dialog` once.
 */
export function useDeleteQuestion(onDeleted?: (report: UnifiedReport) => void) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const deleteReport = useDeleteReport();
  const [target, setTarget] = useState<UnifiedReport | null>(null);

  const remove = async () => {
    if (!target) return;
    try {
      await deleteReport.mutateAsync(target.id);
      await queryClient.invalidateQueries({ queryKey: ['reports'] });
      toast.success(t`Question deleted`);
      setTarget(null);
      onDeleted?.(target);
    } catch (error) {
      toast.error(getErrorMessage(error, t`Failed to delete the question`));
    }
  };

  const name = target?.name ?? '';
  const dialog = (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => !open && setTarget(null)}
      title={t`Delete this question?`}
      description={t`“${name}” will be deleted. Dashboard widgets that show it will stop working. This can’t be undone.`}
      confirmText={t`Delete`}
      cancelText={t`Cancel`}
      variant="destructive"
      onConfirm={remove}
      isLoading={deleteReport.isPending}
    />
  );

  return { ask: setTarget, dialog };
}
