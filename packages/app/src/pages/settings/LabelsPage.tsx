import { Input } from '@shared/ui/input';
import { useLabels } from '@entities/label/api/useLabels';
import { useAddLabel, useDeleteLabel, useUpdateLabel } from '@entities/label/api/label-directory';
import { useUiStore } from '@shared/store/useUiStore';
import { Tag } from 'lucide-react';
import { DirectoryManagerPage } from '@features/settings/directory-manager';
import type { DirectoryColumn, DirectoryManagerConfig } from '@features/settings/directory-manager';
import { SettingsPageHeader } from '@pages/settings/SettingsPageHeader';
import type { LabelListItem } from '@budgero/core/browser';

interface LabelDraft {
  name: string;
  color: string;
}

const DEFAULT_LABEL_COLOR = '#6B7280';

function normalizeColor(value: string): string | null {
  const trimmed = (value || '').trim().toUpperCase();
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (!/^#[0-9A-F]{6}$/.test(withHash)) {
    return null;
  }
  return withHash;
}

const colorColumn: DirectoryColumn<LabelListItem, LabelDraft> = {
  key: 'color',
  header: 'Color',
  headerClassName: 'w-20',
  renderView: (item) => (
    <div className="inline-flex items-center gap-2">
      <span
        className="inline-block h-4 w-4 rounded-full border border-border"
        style={{ backgroundColor: item.Color }}
        aria-hidden
      />
      <span className="text-xs text-muted-foreground">{item.Color}</span>
    </div>
  ),
  renderEdit: (draft, setDraft) => (
    <div className="flex items-center gap-2">
      <Input
        type="color"
        value={draft.color}
        onChange={(e) => setDraft({ color: e.target.value })}
        className="h-9 w-11 p-1 cursor-pointer"
        aria-label="Edit label color"
      />
      <Input
        value={draft.color.toUpperCase()}
        onChange={(e) => setDraft({ color: e.target.value })}
        className="w-24 uppercase"
        aria-label="Edit label color hex"
      />
    </div>
  ),
};

const labelDirectoryConfig: DirectoryManagerConfig<LabelListItem, number, LabelDraft> = {
  header: (
    <SettingsPageHeader
      title="Manage Labels"
      description="Create labels with custom colors and reuse them across transactions."
    />
  ),
  pageTitle: 'Manage Labels',
  selectBudgetDescription: 'Select a budget to manage labels.',
  addCardTitle: 'Add Label',
  addCardDescription: 'Labels help add quick meaning to your transactions.',
  addButtonLabel: 'Add label',
  namePlaceholder: 'e.g. Vacation',
  listDescription: 'Rename, recolor, or remove labels from this budget.',
  countLabel: (count) => `Labels (${count})`,
  loadingLabel: 'Loading labels...',
  emptyStateText: 'No labels yet. Add one to get started.',
  columns: [colorColumn],
  renderNameIcon: () => <Tag className="h-3.5 w-3.5 text-muted-foreground" />,
  renderExtraAddFields: (draft, setDraft) => (
    <div className="flex items-center gap-2">
      <Input
        type="color"
        value={draft.color}
        onChange={(e) => setDraft({ color: e.target.value })}
        className="h-10 w-12 p-1 cursor-pointer"
        aria-label="Label color"
      />
      <Input
        value={draft.color.toUpperCase()}
        onChange={(e) => setDraft({ color: e.target.value })}
        className="w-28 uppercase"
        aria-label="Label color hex"
      />
    </div>
  ),
  getKey: (item) => item.ID,
  getName: (item) => item.Name,
  getUsageCount: (item) => item.UsageCount,
  emptyDraft: { name: '', color: DEFAULT_LABEL_COLOR },
  draftFromItem: (item) => ({ name: item.Name, color: item.Color }),
  prepareDraft: (draft) => {
    const name = draft.name.trim();
    const color = normalizeColor(draft.color);
    if (!name) {
      return { error: { title: 'Enter a label name', description: 'Label name cannot be empty.' } };
    }
    if (!color) {
      return {
        error: { title: 'Use a valid color', description: 'Color must be in #RRGGBB format.' },
      };
    }
    return { draft: { name, color } };
  },
  deleteDialogTitle: () => 'Remove this label?',
  deleteDialogDescription: (item) => (
    <>
      This will clear &ldquo;{item.Name}&rdquo; from all transactions in this budget. Transactions
      will remain.
    </>
  ),
  toasts: {
    addSuccess: (draft) => ({
      title: 'Label added',
      description: `"${draft.name}" is ready to use.`,
    }),
    addErrorTitle: 'Could not add label',
    editSuccess: (item, draft) => ({
      title: 'Label updated',
      description: `"${item.Name}" updated to "${draft.name}".`,
    }),
    editErrorTitle: 'Could not update label',
    deleteSuccess: (item) => ({
      title: 'Label removed',
      description: `"${item.Name}" was removed and cleared from transactions.`,
    }),
    deleteErrorTitle: 'Could not remove label',
  },
};

export default function LabelsPage() {
  const { selectedBudget } = useUiStore();
  const budgetId = selectedBudget?.ID ?? null;

  const { labels, isLoading, isFetching } = useLabels(budgetId);
  const addLabel = useAddLabel();
  const updateLabel = useUpdateLabel();
  const deleteLabel = useDeleteLabel();

  return (
    <DirectoryManagerPage
      config={labelDirectoryConfig}
      budgetId={budgetId}
      items={labels}
      isLoading={isLoading}
      isFetching={isFetching}
      onAdd={async (draft) => {
        await addLabel.mutateAsync({ budgetId: budgetId!, name: draft.name, color: draft.color });
      }}
      isAdding={addLabel.isPending}
      onEdit={async (key, draft) => {
        await updateLabel.mutateAsync({
          id: key,
          budgetId: budgetId!,
          name: draft.name,
          color: draft.color,
        });
      }}
      isSaving={updateLabel.isPending}
      onDelete={(item) => deleteLabel.mutateAsync({ id: item.ID, budgetId: budgetId! })}
      isDeleting={deleteLabel.isPending}
    />
  );
}
