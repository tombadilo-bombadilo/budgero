import { useLingui } from '@lingui/react/macro';
import { useState } from 'react';
import { toast } from 'sonner';
import { useCategories, useUpdateCategoryNote } from '@entities/category/api/useCategories';
import { Textarea } from '@shared/ui/textarea';

/** Free-text note for one category; saves when the field loses focus. */
export function CategoryNoteEditor({
  budgetId,
  categoryId,
}: {
  budgetId: number;
  categoryId: number;
}) {
  const { data: categories } = useCategories(budgetId);
  const savedNote = categories?.find((c) => c.ID === categoryId)?.Note ?? '';
  // Remount on category switch or when the stored note changes (save, undo, sync).
  return (
    <NoteField key={`${categoryId}:${savedNote}`} categoryId={categoryId} savedNote={savedNote} />
  );
}

function NoteField({ categoryId, savedNote }: { categoryId: number; savedNote: string }) {
  const { t } = useLingui();
  const updateNote = useUpdateCategoryNote();
  const [draft, setDraft] = useState(savedNote);

  const save = () => {
    if (draft.trim() === savedNote) return;
    updateNote.mutate(
      { id: categoryId, note: draft },
      { onError: () => toast.error(t`Failed to save note`) }
    );
  };

  return (
    <Textarea
      aria-label={t`Category note`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setDraft(savedNote);
          e.currentTarget.blur();
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.currentTarget.blur();
        }
      }}
      placeholder={t`Add a note…`}
      rows={3}
      className="resize-y text-sm"
    />
  );
}
