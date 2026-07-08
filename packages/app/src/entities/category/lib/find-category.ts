import type { Category } from '@budgero/core/browser';

/**
 * Find a category by name, case-insensitively.
 *
 * Special categories ("Income", "Uncategorized", …) are looked up by name in
 * several places; case-insensitive matching is the deliberate, shared
 * behavior so lookups don't silently miss renamed-case categories.
 */
export function findCategoryByName(categories: Category[], name: string): Category | undefined {
  const target = name.toLowerCase();
  return categories.find((category) => category.Name.toLowerCase() === target);
}
