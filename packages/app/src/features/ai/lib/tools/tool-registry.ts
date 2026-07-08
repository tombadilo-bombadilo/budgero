/**
 * Canonical list of chat tools the assistant can use. Shared between the tool
 * builder (to filter by what's enabled) and the settings UI (to render toggles).
 * `key` must match the tool name returned by buildChatTools().
 */
export interface ChatToolDef {
  key: string;
  label: string;
  description: string;
  /** Mutating tools route through the mutation router and honor execution mode. */
  mutating: boolean;
}

export const CHAT_TOOL_DEFS: ChatToolDef[] = [
  {
    key: 'query_transactions',
    label: 'Query transactions',
    description: 'Structured transaction lookups with filters, grouping and aggregation.',
    mutating: false,
  },
  {
    key: 'query_budget',
    label: 'Query budget',
    description: 'Ready-to-assign, account balances, category spending and monthly summaries.',
    mutating: false,
  },
  {
    key: 'run_analytics_sql',
    label: 'Run analytics SQL',
    description:
      'Let the model write read-only SQL against the analytics database for open-ended questions. Very powerful — best with a capable model.',
    mutating: false,
  },
  {
    key: 'render_chart',
    label: 'Render charts',
    description: 'Let the assistant draw bar/line/pie/etc. charts inline from a SQL query.',
    mutating: false,
  },
  {
    key: 'search_docs',
    label: 'Search docs & policy',
    description:
      "Let the assistant look up Budgero's documentation and privacy policy to answer questions about the app.",
    mutating: false,
  },
  {
    key: 'add_transaction',
    label: 'Add transaction',
    description: 'Record an expense or income. Honors the execution mode (confirm / auto).',
    mutating: true,
  },
  {
    key: 'edit_transaction',
    label: 'Edit transaction',
    description: 'Re-categorize or change the payee, memo, or date of an existing transaction.',
    mutating: true,
  },
];

export const ALL_TOOL_KEYS: string[] = CHAT_TOOL_DEFS.map((t) => t.key);

/** null/undefined enabledTools means "all enabled" (not yet configured). */
export function isToolEnabled(key: string, enabledTools: string[] | null | undefined): boolean {
  if (enabledTools == null) return true;
  return enabledTools.includes(key);
}
