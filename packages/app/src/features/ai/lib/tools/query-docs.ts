import { z } from 'zod';
import type { ToolExecutionResult } from './types';
import type { KnowledgeDoc } from '../knowledge/knowledge-base.generated';

export const searchDocsSchema = z.object({
  query: z
    .string()
    .describe('What to look up in Budgero\'s docs/policy, e.g. "data retention", "self hosting".'),
});

export type SearchDocsArgs = z.infer<typeof searchDocsSchema>;

const MAX_DOCS = 3;
const SNIPPET_CHARS = 1800;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

function countOccurrences(haystack: string, term: string): number {
  if (!term) return 0;
  let count = 0;
  let idx = haystack.indexOf(term);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(term, idx + term.length);
  }
  return count;
}

function scoreDoc(doc: KnowledgeDoc, terms: string[]): number {
  const title = doc.title.toLowerCase();
  const summary = doc.summary.toLowerCase();
  const body = doc.body.toLowerCase();
  let score = 0;
  for (const term of terms) {
    score += countOccurrences(title, term) * 5;
    score += countOccurrences(summary, term) * 3;
    score += countOccurrences(body, term);
  }
  return score;
}

/** Return a snippet of the body around the first matching term. */
function snippet(doc: KnowledgeDoc, terms: string[]): string {
  const bodyLower = doc.body.toLowerCase();
  let firstIdx = -1;
  for (const term of terms) {
    const idx = bodyLower.indexOf(term);
    if (idx !== -1 && (firstIdx === -1 || idx < firstIdx)) firstIdx = idx;
  }
  if (firstIdx === -1 || doc.body.length <= SNIPPET_CHARS) {
    return doc.body.slice(0, SNIPPET_CHARS);
  }
  const start = Math.max(0, firstIdx - 200);
  return `${start > 0 ? '…' : ''}${doc.body.slice(start, start + SNIPPET_CHARS)}…`;
}

export async function executeSearchDocs(args: SearchDocsArgs): Promise<ToolExecutionResult> {
  const terms = tokenize(args.query);
  if (terms.length === 0) {
    return { success: false, message: 'Empty search query.', error: 'empty query' };
  }

  // Lazy-load the (large) knowledge bundle so it stays out of the main chunk.
  const { KNOWLEDGE_DOCS } = await import('../knowledge/knowledge-base.generated');

  const ranked = KNOWLEDGE_DOCS.map((doc) => ({ doc, score: scoreDoc(doc, terms) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_DOCS);

  if (ranked.length === 0) {
    const titles = KNOWLEDGE_DOCS.map((d) => d.title).join(', ');
    return {
      success: true,
      message: `No Budgero docs matched "${args.query}". Available docs: ${titles}. You can answer from general knowledge but say it's not from the official docs.`,
    };
  }

  const sections = ranked.map(
    ({ doc }) => `## ${doc.title} (${doc.section})\n${snippet(doc, terms)}`
  );

  return {
    success: true,
    message: `From Budgero's official docs/policy:\n\n${sections.join('\n\n---\n\n')}`,
    data: { matched: ranked.map((r) => r.doc.id) },
  };
}
