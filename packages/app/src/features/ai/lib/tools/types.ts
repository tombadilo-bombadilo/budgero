import type { Services, ChartConfiguration } from '@budgero/core/browser';
import type { QueryResult } from '@shared/lib/sql/report-query-executor';
import type { AIClientConfig } from '../client';

/** A chart the assistant wants to render in the chat: a chart config + its data. */
export interface ChatChartSpec {
  config: ChartConfiguration;
  queryResult: QueryResult;
}

export interface ToolContext {
  budgetId: number;
  services: Services;
  categories: { ID: number; Name: string }[];
  accounts: { ID: number; Name: string; Type: string }[];
  executeMutation?: <T = unknown>(spec: {
    op: string;
    payload: Record<string, unknown>;
    invalidates?: string[][];
    meta?: {
      skipUndo?: boolean;
      label?: string;
      forceInvalidate?: boolean;
      origin?: 'local' | 'remote';
    };
  }) => Promise<T>;
  /** Run a read-only SQL query against the DuckDB analytics engine. */
  runReadOnlyQuery?: (sql: string, options?: { maxRows?: number }) => Promise<QueryResult>;
  /** Sink for charts the assistant generates this turn (rendered + persisted by the chat panel). */
  collectChart?: (spec: ChatChartSpec) => void;
  /** Live analytics schema summary, injected into the SQL/chart tool descriptions. */
  analyticsSchema?: string;
  /** Enabled chat tool keys. null/undefined means all tools are enabled. */
  enabledTools?: string[] | null;
  aiConfig: AIClientConfig;
  currencySymbol: string;
  /** Formats a DECIMAL currency amount (tools convert stored milliunits first). */
  formatCurrency: (amount: number) => string;
}

export interface ToolExecutionResult {
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
}

export interface PendingToolExecution {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  preview: string;
  status: 'pending' | 'confirmed' | 'rejected' | 'executed';
  result?: ToolExecutionResult;
}
