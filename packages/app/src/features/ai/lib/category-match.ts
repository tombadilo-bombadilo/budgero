/**
 * Build a map of lowercased category name -> category object for quick lookup.
 *
 * Generic over any object with a `Name` field so it can serve both the
 * receipt scanner and the AI categorize dialog.
 */
export function createCategoryNameMap<T extends { Name: string }>(
  categories: readonly T[]
): Map<string, T> {
  return new Map(categories.map((c) => [c.Name.toLowerCase(), c]));
}
