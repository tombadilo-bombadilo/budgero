import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import type { UnifiedReport } from '@budgero/core/browser';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Textarea } from '@shared/ui/textarea';
import { Field } from '@shared/ui/field';
import { getErrorMessage } from '@shared/lib/errors';

interface SaveBuilderReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initialName: string;
  initialDescription?: string;
  onSave: (data: { name: string; description?: string }) => Promise<UnifiedReport>;
  onSaveAndPin?: (report: UnifiedReport) => void;
}

/** Name + description for a builder report; the query and chart come from the builder. */
export function SaveBuilderReportDialog({
  open,
  onOpenChange,
  mode,
  initialName,
  initialDescription,
  onSave,
  onSaveAndPin,
}: SaveBuilderReportDialogProps) {
  const { t } = useLingui();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setDescription(initialDescription ?? '');
    }
  }, [open, initialName, initialDescription]);

  const save = async (pin: boolean) => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t`Please enter a report name`);
      return;
    }
    setIsSaving(true);
    try {
      const report = await onSave({ name: trimmed, description: description.trim() || undefined });
      toast.success(mode === 'create' ? t`Report saved` : t`Report updated`);
      onOpenChange(false);
      if (pin) onSaveAndPin?.(report);
    } catch (error) {
      toast.error(getErrorMessage(error, t`Failed to save report`));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void save(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !isSaving && onOpenChange(next)}>
      <DialogContent className="w-[95vw] sm:max-w-[480px]">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{mode === 'create' ? t`Save report` : t`Update report`}</DialogTitle>
            <DialogDescription>
              <Trans>
                Saved reports appear under Reports and can be pinned to a dashboard. You can reopen
                them in the builder at any time.
              </Trans>
            </DialogDescription>
          </DialogHeader>

          <Field label={t`Name`} htmlFor="builder-report-name">
            <Input
              id="builder-report-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={isSaving}
              autoFocus
              required
            />
          </Field>
          <Field label={t`Description`} htmlFor="builder-report-description">
            <Textarea
              id="builder-report-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t`Optional description...`}
              rows={2}
              disabled={isSaving}
            />
          </Field>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              <Trans>Cancel</Trans>
            </Button>
            {onSaveAndPin && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void save(true)}
                disabled={isSaving}
              >
                <Trans>Save and pin</Trans>
              </Button>
            )}
            <Button type="submit" disabled={isSaving}>
              {mode === 'create' ? t`Save` : t`Update`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
