import { useMemo } from 'react';
import type { LabelListItem } from '@budgero/core/browser';
import { useLabelDirectory } from './label-directory';

const EMPTY_LABELS: LabelListItem[] = [];

export function useLabels(budgetId: number | null | undefined) {
  const query = useLabelDirectory(budgetId);
  const labels = query.data ?? EMPTY_LABELS;

  const byId = useMemo(() => {
    return new Map<number, LabelListItem>(labels.map((label) => [label.ID, label]));
  }, [labels]);

  const byName = useMemo(() => {
    return new Map<string, LabelListItem>(labels.map((label) => [label.Name.toLowerCase(), label]));
  }, [labels]);

  return {
    ...query,
    labels,
    byId,
    byName,
  };
}
