import type { z } from 'zod';
import { tool } from 'ai';
import type { ToolContext, ToolExecutionResult } from './types';
import {
  addTransactionSchema,
  describeAddTransactionPlan,
  executeAddTransaction,
  pinAddTransactionArgs,
  planAddTransaction,
} from './add-transaction';
import {
  editTransactionSchema,
  executeEditTransaction,
  generateEditTransactionPreview,
  pinEditTransactionArgs,
  planEditTransaction,
} from './edit-transaction';
import { queryBudgetSchema, executeQueryBudget } from './query-budget';
import { queryTransactionsSchema, executeQueryTransactions } from './query-transactions';
import { querySqlSchema, executeQuerySql, buildSqlToolDescription } from './query-sql';
import { renderChartSchema, executeRenderChart, buildChartToolDescription } from './query-chart';
import { searchDocsSchema, executeSearchDocs } from './query-docs';
import { isToolEnabled } from './tool-registry';

export type {
  ToolContext,
  ToolExecutionResult,
  PendingToolExecution,
  ChatChartSpec,
} from './types';
export {
  generateAddTransactionPreview,
  failureText,
  type AddTransactionArgs,
} from './add-transaction';
export { generateEditTransactionPreview, type EditTransactionArgs } from './edit-transaction';
export { loadAnalyticsSchema } from './query-sql';
export { CHAT_TOOL_DEFS, ALL_TOOL_KEYS, isToolEnabled, type ChatToolDef } from './tool-registry';

/**
 * Build AI SDK tool definitions for chat, filtered by context.enabledTools
 * (null/undefined = all enabled).
 * query_budget, query_transactions and run_analytics_sql have execute functions
 * (auto-run, read-only). add_transaction has NO execute function — the SDK returns
 * it as a pending tool call so we can show the confirmation UI.
 */
export function buildChatTools(context: ToolContext) {
  const allTools = {
    query_transactions: tool({
      description:
        'Flexibly query transactions with filters, aggregations, and grouping. Use this for questions like "biggest transaction", "spending by category", "transactions from Amazon", etc.',
      inputSchema: queryTransactionsSchema,
      execute: async (args) => {
        const result = await executeQueryTransactions(args, context);
        return result.message;
      },
    }),

    query_budget: tool({
      description:
        'Query budget data including ready to assign, account balances, category spending, recent transactions, and monthly summaries. Read-only operation.',
      inputSchema: queryBudgetSchema,
      execute: async (args) => {
        const result = await executeQueryBudget(args, context);
        return result.message;
      },
    }),

    run_analytics_sql: tool({
      description: buildSqlToolDescription(context.budgetId, context.analyticsSchema),
      inputSchema: querySqlSchema,
      execute: async (args) => {
        const result = await executeQuerySql(args, context);
        return result.message;
      },
    }),

    render_chart: tool({
      description: buildChartToolDescription(context.budgetId, context.analyticsSchema),
      inputSchema: renderChartSchema,
      execute: async (args) => {
        const result = await executeRenderChart(args, context);
        return result.message;
      },
    }),

    search_docs: tool({
      description:
        "Search Budgero's official documentation and privacy policy. Use this whenever the user asks about Budgero itself — privacy, data retention, security/encryption, how a feature works, imports, sharing, self-hosting, the API, etc. Do NOT say you lack access to Budgero's policy or docs; search here first.",
      inputSchema: searchDocsSchema,
      execute: async (args) => {
        const result = await executeSearchDocs(args);
        return result.message;
      },
    }),

    add_transaction: tool({
      description:
        'Add a new transaction to the budget. Use when the user wants to record an expense or income. Do NOT call this tool unless the user explicitly wants to add/record a transaction.',
      inputSchema: addTransactionSchema,
      // NO execute — returned as pending tool call for confirmation UI
    }),

    edit_transaction: tool({
      description:
        'Edit an existing transaction: re-categorize it or change its payee, memo, or date. Requires the transactionId (find it first via query_transactions or run_analytics_sql). Do NOT call unless the user wants to change an existing transaction.',
      inputSchema: editTransactionSchema,
      // NO execute — returned as pending tool call for confirmation UI
    }),
  };

  // Filter to enabled tools only. Cast back to the full shape so the AI SDK's
  // tool-call type inference stays concrete (missing keys are simply absent at runtime).
  return Object.fromEntries(
    Object.entries(allTools).filter(([key]) => isToolEnabled(key, context.enabledTools))
  ) as typeof allTools;
}

/**
 * A tool call whose arguments don't fit the schema. `message` is what the user
 * reads; `error` names each bad field so the model can fix the call. Both are
 * saved to the chat history (see failureText).
 */
function invalidToolArgs(error: z.ZodError): ToolExecutionResult {
  const issues = error.issues
    .map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
    .join('; ');
  return {
    success: false,
    message: 'Those transaction details are incomplete or not valid',
    error: `${issues}. Nothing was changed.`,
  };
}

/** A confirmation tool call checked and resolved: either a card to confirm, or what is wrong. */
export type PreparedConfirmedTool =
  | { ok: true; preview: string; args: Record<string, unknown> }
  | { ok: false; result: ToolExecutionResult };

/**
 * Validate a pending add/edit call and build its confirm card. A call that
 * can't be carried out (bad arguments, no or ambiguous account, unknown
 * category on edit) never gets a card. The returned args have the resolved
 * account/category pinned by ID, so Confirm writes exactly what the card says.
 */
export function prepareConfirmedTool(
  toolName: string,
  args: unknown,
  context: ToolContext
): PreparedConfirmedTool {
  if (toolName === 'edit_transaction') {
    const parsed = editTransactionSchema.safeParse(args);
    if (!parsed.success) return { ok: false, result: invalidToolArgs(parsed.error) };
    const plan = planEditTransaction(parsed.data, context);
    if (!plan.ok) return plan;
    const pinned = pinEditTransactionArgs(parsed.data, plan);
    return { ok: true, preview: generateEditTransactionPreview(pinned, context), args: pinned };
  }
  const parsed = addTransactionSchema.safeParse(args);
  if (!parsed.success) return { ok: false, result: invalidToolArgs(parsed.error) };
  const plan = planAddTransaction(parsed.data, context);
  if (!plan.ok) return plan;
  return {
    ok: true,
    preview: describeAddTransactionPlan(parsed.data, plan, context),
    args: pinAddTransactionArgs(parsed.data, plan),
  };
}

/**
 * Execute the add_transaction tool after user confirmation.
 */
export async function executeConfirmedAddTransaction(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolExecutionResult> {
  const parsed = addTransactionSchema.safeParse(args);
  if (!parsed.success) return invalidToolArgs(parsed.error);
  return executeAddTransaction(parsed.data, context);
}

/**
 * Execute the edit_transaction tool after user confirmation.
 */
export async function executeConfirmedEditTransaction(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolExecutionResult> {
  const parsed = editTransactionSchema.safeParse(args);
  if (!parsed.success) return invalidToolArgs(parsed.error);
  return executeEditTransaction(parsed.data, context);
}
