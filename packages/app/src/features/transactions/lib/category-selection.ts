type CategoryRef = { ID: number; Name: string };

/**
 * The category ID a form's selection refers to. Category names aren't unique
 * (per-card payment and loan categories are named after their accounts), so a
 * known ID wins: each candidate is used when it still exists under the name
 * the form shows. Only a name with no usable ID (legacy remembered values,
 * system defaults like "Income") falls back to the first category so named.
 */
export function resolveCategoryId(
  categories: readonly CategoryRef[],
  name: string,
  ...candidateIds: (number | null | undefined)[]
): number | null {
  for (const id of candidateIds) {
    if (id == null) continue;
    const match = categories.find((category) => category.ID === id);
    if (match && (!name || match.Name === name)) return match.ID;
  }
  if (!name) return null;
  return categories.find((category) => category.Name === name)?.ID ?? null;
}
