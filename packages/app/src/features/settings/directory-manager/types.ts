import type { ReactNode } from 'react';

export interface DirectoryColumn<TItem, TDraft> {
  key: string;
  header: ReactNode;
  headerClassName?: string;
  cellClassName?: string;
  renderView: (item: TItem) => ReactNode;
  renderEdit: (draft: TDraft, setDraft: (patch: Partial<TDraft>) => void) => ReactNode;
}

export type DirectoryDraftResult<TDraft> =
  | { draft: TDraft }
  | { error: { title: string; description: string } };

export interface DirectoryToastCopy<TItem, TDraft> {
  addSuccess: (draft: TDraft) => { title: string; description: string };
  addErrorTitle: string;
  editSuccess: (item: TItem, draft: TDraft) => { title: string; description: string };
  editErrorTitle: string;
  deleteSuccess: (item: TItem) => { title: string; description: string };
  deleteErrorTitle: string;
}

export interface DirectoryManagerConfig<
  TItem,
  TKey extends string | number,
  TDraft extends { name: string },
> {
  /** Rendered above the form when a budget is selected (SettingsPageHeader et al). */
  header: ReactNode;
  /** Used for the "select a budget" fallback card's title. */
  pageTitle: string;
  selectBudgetDescription: string;
  addCardTitle: string;
  addCardDescription: string;
  addButtonLabel: string;
  namePlaceholder: string;
  listDescription: string;
  countLabel: (count: number) => string;
  loadingLabel: string;
  emptyStateText: string;
  /** Extra columns rendered before the built-in Name/Usage/Actions columns. */
  columns: DirectoryColumn<TItem, TDraft>[];
  renderNameIcon?: (item: TItem) => ReactNode;
  /** Extra add-form fields rendered after the built-in name input. */
  renderExtraAddFields?: (draft: TDraft, setDraft: (patch: Partial<TDraft>) => void) => ReactNode;
  getKey: (item: TItem) => TKey;
  getName: (item: TItem) => string;
  getUsageCount: (item: TItem) => number;
  emptyDraft: TDraft;
  draftFromItem: (item: TItem) => TDraft;
  prepareDraft: (draft: TDraft) => DirectoryDraftResult<TDraft>;
  deleteDialogTitle: (item: TItem) => ReactNode;
  deleteDialogDescription: (item: TItem) => ReactNode;
  toasts: DirectoryToastCopy<TItem, TDraft>;
}
