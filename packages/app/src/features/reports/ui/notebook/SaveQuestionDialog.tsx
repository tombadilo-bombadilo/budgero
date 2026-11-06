import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useId, useState, type FormEvent } from 'react';
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

export interface SaveQuestionInput {
  name: string;
  description?: string;
  /** Collection name (stored as the report's first tag); undefined = "My questions". */
  collection?: string;
}

interface SaveQuestionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initialName: string;
  initialDescription?: string;
  initialCollection?: string;
  /** Existing collection names, offered as suggestions. */
  collections: string[];
  onSave: (data: SaveQuestionInput) => Promise<UnifiedReport>;
  onSaveAndPin?: (report: UnifiedReport) => void;
}

/** Name, description and collection for a question; the query comes from the notebook. */
export function SaveQuestionDialog({
  open,
  onOpenChange,
  mode,
  initialName,
  initialDescription,
  initialCollection,
  collections,
  onSave,
  onSaveAndPin,
}: SaveQuestionDialogProps) {
  const { t } = useLingui();
  const id = useId();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [collection, setCollection] = useState(initialCollection ?? '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setDescription(initialDescription ?? '');
      setCollection(initialCollection ?? '');
    }
  }, [open, initialName, initialDescription, initialCollection]);

  const save = async (pin: boolean) => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t`Please enter a name`);
      return;
    }
    setIsSaving(true);
    try {
      const report = await onSave({
        name: trimmed,
        description: description.trim() || undefined,
        collection: collection.trim() || undefined,
      });
      toast.success(mode === 'create' ? t`Question saved` : t`Question updated`);
      onOpenChange(false);
      if (pin) onSaveAndPin?.(report);
    } catch (error) {
      toast.error(getErrorMessage(error, t`Failed to save the question`));
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
            <DialogTitle>{mode === 'create' ? t`Save question` : t`Update question`}</DialogTitle>
            <DialogDescription>
              <Trans>
                Saved questions appear on the Reports page and can be added to a dashboard. They
                reopen in the editor.
              </Trans>
            </DialogDescription>
          </DialogHeader>

          <Field label={t`Name`} htmlFor={`${id}-name`}>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={isSaving}
              autoFocus
              required
            />
          </Field>
          <Field label={t`Description`} htmlFor={`${id}-description`}>
            <Textarea
              id={`${id}-description`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t`Optional description...`}
              rows={2}
              disabled={isSaving}
            />
          </Field>
          <Field
            label={t`Collection`}
            htmlFor={`${id}-collection`}
            hint={t`Leave empty to keep it in My questions.`}
          >
            <Input
              id={`${id}-collection`}
              value={collection}
              list={`${id}-collections`}
              onChange={(event) => setCollection(event.target.value)}
              placeholder={t`My questions`}
              disabled={isSaving}
              maxLength={60}
            />
            <datalist id={`${id}-collections`}>
              {collections.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </datalist>
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
                <Trans>Save and add to dashboard</Trans>
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
