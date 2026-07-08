import type { GetAllTransactions } from '@budgero/core/browser';
import type { HistoricalPattern } from '@features/ai/lib/client';

/**
 * Derives the user's historical categorization patterns from their past
 * transactions: for each distinct payee+memo (or memo alone), find the most
 * common category they were assigned to. Feeds the AI categorization prompt
 * so the model can learn from prior manual categorization.
 *
 * Skips uncategorized/split transactions, transfers, and memo-less rows.
 * Returns the top 50 patterns by occurrence count.
 */
export function buildHistoricalPatterns(transactions: GetAllTransactions[]): HistoricalPattern[] {
  const patternMap = new Map<
    string,
    {
      payee: string;
      memo: string;
      categoryCounts: Map<string, number>;
    }
  >();

  for (const t of transactions) {
    if (!t || !t.Category || t.Category === 'Uncategorized' || t.Category === 'Split') continue;
    if (!t.CategoryID || t.CategoryID === 0) continue;
    if (!t.Memo || !t.Memo.trim()) continue;
    if (t.Category.toLowerCase().includes('transfer')) continue;

    // Create a key based on memo + payee combined for specificity
    const memo = t.Memo.toLowerCase().trim();
    const payee = (t.Payee || '').toLowerCase().trim();
    const key = payee ? `${payee}|${memo}` : memo;
    if (!key) continue;

    let existing = patternMap.get(key);
    if (!existing) {
      existing = {
        payee: t.Payee || '',
        memo: t.Memo || '',
        categoryCounts: new Map(),
      };
      patternMap.set(key, existing);
    }

    const currentCount = existing.categoryCounts.get(t.Category) || 0;
    existing.categoryCounts.set(t.Category, currentCount + 1);
  }

  const patterns: HistoricalPattern[] = [];
  for (const [, data] of patternMap) {
    let bestCategory = '';
    let bestCount = 0;
    for (const [category, count] of data.categoryCounts) {
      if (count > bestCount) {
        bestCount = count;
        bestCategory = category;
      }
    }

    if (bestCategory) {
      patterns.push({
        payee: data.payee,
        memo: data.memo,
        categoryName: bestCategory,
        count: bestCount,
      });
    }
  }

  return patterns.sort((a, b) => b.count - a.count).slice(0, 50);
}
