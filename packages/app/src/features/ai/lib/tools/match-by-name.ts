/**
 * Fuzzy "find entity by name" lookup shared across AI transaction tools.
 *
 * Resolution order:
 *   1. case-insensitive exact match (`===`)
 *   2. bidirectional substring fallback (`entityName.includes(query) || query.includes(entityName)`)
 *
 * Returns the matched entity (callers read `.ID` / `.Name`), or `undefined`.
 */
export function matchByName<T>(
  entities: readonly T[],
  name: string,
  getName: (e: T) => string
): T | undefined {
  const query = name.toLowerCase();
  const exact = entities.find((e) => getName(e).toLowerCase() === query);
  if (exact) return exact;
  return entities.find((e) => {
    const entityName = getName(e).toLowerCase();
    return entityName.includes(query) || query.includes(entityName);
  });
}
