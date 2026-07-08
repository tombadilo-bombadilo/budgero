import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { ConfirmDialog } from '@shared/ui/confirm-dialog';
import { Spinner } from '@shared/ui/spinner';
import { toastError } from '@shared/lib/errors';
import { DirectoryTable } from './DirectoryTable';
import type { DirectoryManagerConfig } from './types';

interface DirectoryManagerPageProps<
  TItem,
  TKey extends string | number,
  TDraft extends { name: string },
> {
  config: DirectoryManagerConfig<TItem, TKey, TDraft>;
  budgetId: number | null;
  items: TItem[];
  isLoading: boolean;
  isFetching: boolean;
  onAdd: (draft: TDraft) => Promise<void>;
  isAdding: boolean;
  onEdit: (key: TKey, draft: TDraft) => Promise<void>;
  isSaving: boolean;
  onDelete: (item: TItem) => Promise<void>;
  isDeleting: boolean;
}

export function DirectoryManagerPage<
  TItem,
  TKey extends string | number,
  TDraft extends { name: string },
>({
  config,
  budgetId,
  items,
  isLoading,
  isFetching,
  onAdd,
  isAdding,
  onEdit,
  isSaving,
  onDelete,
  isDeleting,
}: DirectoryManagerPageProps<TItem, TKey, TDraft>) {
  const [addDraft, setAddDraftState] = useState<TDraft>(config.emptyDraft);
  const [editingKey, setEditingKey] = useState<TKey | null>(null);
  const [editDraft, setEditDraftState] = useState<TDraft>(config.emptyDraft);
  const [pendingDelete, setPendingDelete] = useState<TItem | null>(null);

  const setAddDraft = (patch: Partial<TDraft>) =>
    setAddDraftState((prev) => ({ ...prev, ...patch }));
  const setEditDraft = (patch: Partial<TDraft>) =>
    setEditDraftState((prev) => ({ ...prev, ...patch }));

  const sortedItems = useMemo(
    () =>
      [...items].sort((a, b) =>
        config.getName(a).localeCompare(config.getName(b), undefined, { sensitivity: 'base' })
      ),
    [items, config]
  );

  const handleAdd = async () => {
    if (!budgetId) return;
    const prepared = config.prepareDraft(addDraft);
    if ('error' in prepared) {
      toast.error(prepared.error.title, { description: prepared.error.description });
      return;
    }
    try {
      await onAdd(prepared.draft);
      setAddDraftState(config.emptyDraft);
      const success = config.toasts.addSuccess(prepared.draft);
      toast.success(success.title, { description: success.description });
    } catch (error) {
      toastError(config.toasts.addErrorTitle, error);
    }
  };

  const startEdit = (item: TItem) => {
    setEditingKey(config.getKey(item));
    setEditDraftState(config.draftFromItem(item));
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditDraftState(config.emptyDraft);
  };

  const handleSave = async (item: TItem) => {
    if (!budgetId) return;
    const prepared = config.prepareDraft(editDraft);
    if ('error' in prepared) {
      toast.error(prepared.error.title, { description: prepared.error.description });
      return;
    }
    try {
      await onEdit(config.getKey(item), prepared.draft);
      const success = config.toasts.editSuccess(item, prepared.draft);
      toast.success(success.title, { description: success.description });
      cancelEdit();
    } catch (error) {
      toastError(config.toasts.editErrorTitle, error);
    }
  };

  const handleDelete = async () => {
    if (!budgetId || !pendingDelete) return;
    const target = pendingDelete;
    try {
      await onDelete(target);
      const success = config.toasts.deleteSuccess(target);
      toast.success(success.title, { description: success.description });
    } catch (error) {
      toastError(config.toasts.deleteErrorTitle, error);
    } finally {
      setPendingDelete(null);
    }
  };

  if (!budgetId) {
    return (
      <div className="container max-w-3xl mx-auto p-4 sm:p-6 pb-20 sm:pb-6">
        <Card>
          <CardHeader>
            <CardTitle>{config.pageTitle}</CardTitle>
            <CardDescription>{config.selectBudgetDescription}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl mx-auto p-4 sm:p-6 pb-20 sm:pb-6 space-y-6">
      {config.header}

      <Card>
        <CardHeader>
          <CardTitle>{config.addCardTitle}</CardTitle>
          <CardDescription>{config.addCardDescription}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3">
          <Input
            value={addDraft.name}
            placeholder={config.namePlaceholder}
            onChange={(e) => setAddDraft({ name: e.target.value } as Partial<TDraft>)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleAdd();
              }
            }}
            className="sm:flex-1"
          />
          {config.renderExtraAddFields?.(addDraft, setAddDraft)}
          <Button type="button" onClick={handleAdd} disabled={isAdding}>
            {isAdding ? <Spinner size="sm" /> : <Plus className="h-4 w-4" />}
            <span className="ml-2">{config.addButtonLabel}</span>
          </Button>
        </CardContent>
      </Card>

      <DirectoryTable
        config={config}
        items={sortedItems}
        isLoading={isLoading}
        isFetching={isFetching}
        editingKey={editingKey}
        editDraft={editDraft}
        setEditDraft={setEditDraft}
        isSaving={isSaving}
        onStartEdit={startEdit}
        onCancelEdit={cancelEdit}
        onSave={handleSave}
        onRequestDelete={setPendingDelete}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={pendingDelete ? config.deleteDialogTitle(pendingDelete) : ''}
        description={pendingDelete ? config.deleteDialogDescription(pendingDelete) : ''}
        confirmText="Remove"
        variant="destructive"
        isLoading={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
