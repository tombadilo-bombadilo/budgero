import type { QuestionSpec } from '@features/reports/lib/question';

/**
 * Unsaved notebook questions of this tab, by budget and question ("new" for
 * an unsaved one). In memory only: budget content never goes to web storage.
 * Leaving the editor in-app keeps the draft; a reload is guarded by the
 * browser's "leave site?" prompt instead.
 */
const drafts = new Map<string, QuestionSpec>();
const MAX_DRAFTS = 20;

const draftKey = (budgetId: number, reportId: string | null) => `${budgetId}:${reportId ?? 'new'}`;

export function loadQuestionDraft(budgetId: number, reportId: string | null): QuestionSpec | null {
  return drafts.get(draftKey(budgetId, reportId)) ?? null;
}

export function saveQuestionDraft(
  budgetId: number,
  reportId: string | null,
  spec: QuestionSpec
): void {
  const key = draftKey(budgetId, reportId);
  drafts.delete(key);
  drafts.set(key, spec);
  while (drafts.size > MAX_DRAFTS) {
    const oldest = drafts.keys().next().value;
    if (oldest === undefined) break;
    drafts.delete(oldest);
  }
}

export function clearQuestionDraft(budgetId: number, reportId: string | null): void {
  drafts.delete(draftKey(budgetId, reportId));
}

/** For tests. */
export function clearAllQuestionDrafts(): void {
  drafts.clear();
}
