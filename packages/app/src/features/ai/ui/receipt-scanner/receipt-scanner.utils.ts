import type { ExtractedTransactions } from '@features/ai/lib/client';

// Canonical generic helper lives in features/ai/lib; re-exported here so existing
// importers keep working.
export { createCategoryNameMap } from '@features/ai/lib/category-match';

export type ScanStep = 'upload' | 'camera' | 'scanning' | 'review' | 'importing' | 'done';

export interface ExtractedTransaction {
  id: string;
  date: string;
  payee: string;
  memo: string;
  /** DECIMAL currency amount (LLM-extracted); converted to milliunits at import. */
  amount: number;
  isExpense: boolean;
  categoryId: number | null;
  suggestedCategoryName?: string;
  selected: boolean;
}

export interface Category {
  ID: number;
  Name: string;
}

/**
 * Map AI-extracted transactions to our internal format with category matching
 */
export function mapExtractedTransactions(
  result: ExtractedTransactions,
  categoryByName: Map<string, Category>
): ExtractedTransaction[] {
  return result.transactions.map((t, i) => {
    let matchedCategoryId: number | null = null;
    if (t.suggestedCategory) {
      const match = categoryByName.get(t.suggestedCategory.toLowerCase());
      if (match) {
        matchedCategoryId = match.ID;
      }
    }

    return {
      id: `extracted-${i}`,
      date: t.date,
      payee: t.payee,
      memo: t.memo,
      amount: t.amount,
      isExpense: t.isExpense,
      categoryId: matchedCategoryId,
      suggestedCategoryName: t.suggestedCategory,
      selected: true,
    };
  });
}

/**
 * Convert an image file to base64 string (without data URL prefix)
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix
      const base64Data = result.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Read a file and create a preview data URL
 */
export function createImagePreview(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      resolve(e.target?.result as string);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function isValidImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}
