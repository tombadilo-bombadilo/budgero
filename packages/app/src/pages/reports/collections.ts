import type { UnifiedReport } from '@budgero/core/browser';

/** A saved question's collection: its first tag; undefined = "My questions". */
export function collectionOf(report: Pick<UnifiedReport, 'tags'>): string | undefined {
  const tag = report.tags?.[0]?.trim();
  return tag || undefined;
}

/** Distinct collection names across saved questions, sorted. */
export function listCollections(reports: Pick<UnifiedReport, 'tags'>[]): string[] {
  const names = new Set<string>();
  for (const report of reports) {
    const name = collectionOf(report);
    if (name) names.add(name);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

/** Tags with the collection as the first tag (other tags kept). */
export function withCollection(tags: string[] | undefined, collection: string | undefined) {
  const rest = (tags ?? []).slice(1);
  return collection ? [collection, ...rest] : rest;
}
