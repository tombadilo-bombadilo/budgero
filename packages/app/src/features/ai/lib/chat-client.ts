import { streamText, stepCountIs, type ModelMessage } from 'ai';
import { capitalize } from '@shared/lib/utils';
import { getTodayISO } from '@shared/lib/date-utils';
import type { BudgetContext } from '@budgero/core/browser';
import { createAIClient, type AIClientConfig } from './client';
import { buildChatTools } from './tools';
import type { ToolContext } from './tools/types';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface PendingTool {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/** A tool the assistant invoked this turn, surfaced for transparency in the UI. */
export interface ToolEvent {
  toolName: string;
  args: Record<string, unknown>;
  resultPreview?: string;
}

export interface RunChatResult {
  text: string;
  pendingTool?: PendingTool;
  toolEvents?: ToolEvent[];
  usage?: TokenUsage;
}

/** Tools that have no execute() and require user confirmation before running. */
const CONFIRMATION_TOOLS = new Set(['add_transaction', 'edit_transaction']);

/** Max model<->tool round-trips per turn. High enough for multi-query analysis. */
const MAX_CHAT_STEPS = 20;

function stripThinkBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*/gi, '')
    .trim();
}

/**
 * Build the system prompt for chat (budget concepts + tool usage guidance)
 */
function buildSystemPrompt(budgetContext: BudgetContext): string {
  const todayStr = getTodayISO();

  return `You are a helpful budget assistant for Budgero, a zero-based budgeting app.

## Today's Date
${todayStr}

## Budgero Concepts (Zero-Based Budgeting)

**Ready to Assign**: The amount of unassigned cash that needs a job. It's static (doesn't change based on which month you view).
- Formula: Total Income - Total Assignments - Off-Budget Transfers
- Zero = ideal (every unit has a purpose)
- Positive = unassigned cash available
- Negative = assigned more than you have (overspent)

**Assigned (Allocated)**: Money intentionally allocated to a category for a specific month. User-controlled.

**Activity**: Actual spending/income in a category for a month. Negative = spending, Positive = income/refunds.
- Formula: Inflow - Outflow for transactions in that category

**Available**: Running balance available to spend in a category. Rolls over between months.
- Formula: Leftover from previous months + Current month's Assigned + Current month's Activity

**Category Groups**: Categories are organized into groups (e.g., "Fixed Expenses", "Savings", "Fun Money")

**On-Budget vs Off-Budget Accounts**:
- On-Budget: Checking, savings - contribute to Ready to Assign
- Off-Budget: Tracking accounts (investments, loans) - tracked but don't affect Ready to Assign

## Currency Formatting
IMPORTANT: When mentioning monetary amounts in your responses, ALWAYS use the budget's DISPLAY_CURRENCY (shown in the budget context). Never mix currency symbols and never invent exchange rates.
- Accounts may hold different currencies. Each account row lists its native_balance + currency AND a balance_in_<DISPLAY_CURRENCY> value already converted for you.
- For any total, net worth, or cross-account comparison, sum the balance_in_<DISPLAY_CURRENCY> values — NEVER add native balances of different currencies together.
- Only quote a native amount when talking about that single account, and label it with its own currency.

## Tool Usage Guidelines
- Use query_transactions for ANY question about transactions, spending amounts, comparisons, etc.
- Use query_budget for budget-specific data like ready to assign, account balances, category spending summaries, and monthly summaries.
- Use add_transaction ONLY when the user explicitly wants to add/record a transaction.
- Use edit_transaction to re-categorize or change the payee/memo/date of an EXISTING transaction. You can edit transactions — first find the transaction's id via query_transactions or run_analytics_sql, then call edit_transaction with that transactionId. Never tell the user you can't edit transactions.
- Use render_chart to SHOW a chart when a visualization helps (spending trends over time, category breakdowns, comparisons). You can draw charts — it renders inline for the user. Always also summarize the takeaway in text; the chart supports your answer.
- Use search_docs for ANY question about Budgero itself — privacy, data retention, security/encryption, how a feature works, imports, sharing, self-hosting, the API. You DO have access to Budgero's official docs and privacy policy through this tool; never tell the user you don't know Budgero's policy — search_docs first, then answer (cite the doc).
- ALWAYS set filters.type: When the user asks about expenses/spending/costs, set filters.type="expense". When they ask about income/earnings, set filters.type="income". This prevents mixing up expense and income transactions.
- ALWAYS set date filters: When the user mentions a time period ("this month", "last 30 days", "in January"), calculate the exact YYYY-MM-DD dates based on today (${todayStr}) and set filters.dateFrom and filters.dateTo. "yesterday" = calculate it, "this month" = ${todayStr.slice(0, 7)}-01 to ${todayStr}, etc.
- For add_transaction: always try to infer a category from context and always provide a descriptive memo.
- You can call multiple tools if needed (e.g., querying groceries AND dining to compare them).
- After getting tool results, summarize them naturally and concisely for the user. Don't repeat raw data — highlight the key insight.

## Recording changes — add_transaction / edit_transaction (CRITICAL)
- To add or edit a transaction you MUST actually call the add_transaction / edit_transaction tool. If you did NOT call the tool this turn, nothing happened — so NEVER write "Done", "I recorded it", "I've added it", or "I've updated it" from text alone. That is a lie to the user.
- These actions REQUIRE the user to confirm: calling the tool shows them a confirmation card, and the change is only saved AFTER they click Confirm. So after you call the tool, say something like "I've prepared that — confirm it above to save it." Do NOT claim it is already saved.
- Only state that something was saved/added/changed after you have actually called the tool (and, for add/edit, the user has confirmed).

## Accuracy — NEVER fabricate numbers
- Every specific figure (amounts, totals, balances, dates, payees, counts) you state MUST come from a tool result you actually received in THIS conversation. Never estimate, guess, assume, or invent a number — not even a "placeholder" or "example".
- If you don't yet have a number you need, call a tool to get it BEFORE writing your answer. If a query fails, fix it and retry; do not substitute a made-up value.
- Do not claim you "verified", "excluded transfers", or "checked" something unless a tool result actually shows it.

## Finishing the task — don't stop early
- Keep working until you can give a complete, data-backed answer. Run ALL the queries you need in sequence, THEN write the final answer.
- Do NOT pause mid-task to narrate "let me check..." and then stop, and do NOT ask the user for permission to continue with something they already asked for — just continue and deliver the result.
- Be efficient: gather what you need with as few queries as possible (aggregate in SQL) rather than many tiny steps.

## User's Budget Context
${budgetContext.summary}`;
}

/**
 * Build an AI SDK image part from a `data:<mime>;base64,<data>` URL.
 *
 * Handing the SDK a data-URL *string* makes it parse the string as a URL and
 * `fetch()` it to download the bytes (the OpenAI provider only declares
 * `https?://` image URLs as supported, so anything else is "downloaded"). In
 * production that fetch hits CSP `connect-src` and is refused with
 * "Connecting to 'data:image/...'". Splitting the URL into raw base64 + an
 * explicit mediaType keeps the bytes inline, so the provider embeds them
 * directly in the request body instead of fetching.
 */
function imageToPart(image: string): { type: 'image'; image: string; mediaType?: string } {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(image);
  if (!match) {
    // Already a bare base64 string or a real http(s) URL — pass through.
    return { type: 'image', image };
  }
  const [, mediaType, base64] = match;
  return { type: 'image', image: base64, mediaType: mediaType || undefined };
}

function buildMessages(
  conversationHistory: ChatMessage[],
  userMessage: string,
  images: string[] = []
): ModelMessage[] {
  const messages: ModelMessage[] = [];

  // History is text-only (we don't resend old images). Skip empty-content rows
  // (e.g. image-only user messages) since some providers reject empty content.
  const recentHistory = conversationHistory.slice(-20).filter((m) => m.content.trim().length > 0);
  for (const msg of recentHistory) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({ role: msg.role, content: msg.content });
    } else if (msg.role === 'tool') {
      messages.push({ role: 'assistant', content: msg.content });
    }
  }

  // Current turn: attach images as multimodal parts when present.
  if (images.length > 0) {
    messages.push({
      role: 'user',
      content: [
        ...(userMessage ? [{ type: 'text' as const, text: userMessage }] : []),
        ...images.map(imageToPart),
      ],
    });
  } else {
    messages.push({ role: 'user', content: userMessage });
  }

  return messages;
}

/**
 * Stream a chat turn using the AI SDK's native tool calling.
 * Tool steps (query_transactions, query_budget) run automatically via stopWhen.
 * add_transaction has no execute, so the SDK returns it as a pending tool call.
 */
export async function streamChat(
  config: AIClientConfig,
  userMessage: string,
  budgetContext: BudgetContext,
  toolContext: ToolContext,
  conversationHistory: ChatMessage[] = [],
  onTextUpdate?: (accumulatedText: string) => void,
  images: string[] = [],
  onActivity?: (events: ToolEvent[]) => void
): Promise<RunChatResult> {
  const provider = createAIClient(config);
  const tools = buildChatTools(toolContext);
  const systemPrompt = buildSystemPrompt(budgetContext);
  const messages = buildMessages(conversationHistory, userMessage, images);

  // Images need a vision-capable model; fall back to the text model if none configured.
  const modelId = images.length > 0 && config.visionModel ? config.visionModel : config.textModel;

  // Tool calls captured as they happen, surfaced live (onActivity) and returned.
  const toolEvents: ToolEvent[] = [];

  const result = streamText({
    model: provider.chat(modelId),
    system: systemPrompt,
    messages,
    tools,
    // Agentic analytical tasks chain many queries (income, spending, balances,
    // per-period, chart, synthesis). Too low a cap cuts the model off mid-task
    // before it can give a final answer.
    stopWhen: stepCountIs(MAX_CHAT_STEPS),
    onStepFinish: (step) => {
      const results = (step.toolResults ?? []) as { toolCallId: string; output?: unknown }[];
      for (const tc of step.toolCalls) {
        if (CONFIRMATION_TOOLS.has(tc.toolName)) continue;
        const output = results.find((r) => r.toolCallId === tc.toolCallId)?.output;
        toolEvents.push({
          toolName: tc.toolName,
          args: tc.input as Record<string, unknown>,
          resultPreview: output != null ? String(output).slice(0, 500) : undefined,
        });
      }
      if (toolEvents.length > 0) onActivity?.([...toolEvents]);
    },
  });

  let accumulated = '';
  for await (const delta of result.textStream) {
    accumulated += delta;
    onTextUpdate?.(accumulated);
  }

  const steps = await result.steps;

  // Build token usage — use the LAST step's input tokens (peak context, not cumulative)
  // and sum output tokens across all steps
  let tokenUsage: TokenUsage | undefined;
  const lastStep = steps[steps.length - 1];
  const peakPromptTokens = lastStep?.usage?.inputTokens ?? 0;
  const totalCompletionTokens = steps.reduce((sum, s) => sum + (s.usage?.outputTokens ?? 0), 0);
  if (peakPromptTokens > 0 || totalCompletionTokens > 0) {
    tokenUsage = {
      promptTokens: peakPromptTokens,
      completionTokens: totalCompletionTokens,
      totalTokens: peakPromptTokens + totalCompletionTokens,
    };
  }

  // Check for a pending confirmation tool (add/edit) — last one wins.
  // (Auto-run tool calls were already collected live in onStepFinish.)
  let pendingTool: PendingTool | undefined;
  for (const step of steps) {
    for (const toolCall of step.toolCalls) {
      if (CONFIRMATION_TOOLS.has(toolCall.toolName)) {
        pendingTool = {
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          args: toolCall.input as Record<string, unknown>,
        };
      }
    }
  }

  // If we stopped on a tool-call step, the model was cut off before answering.
  const cutOff = lastStep?.finishReason === 'tool-calls';

  let cleanText = stripThinkBlocks(accumulated);

  if (cutOff && !pendingTool) {
    const note =
      '_(I hit my tool-step limit before finishing. Ask me to continue and I’ll pick up where I left off.)_';
    cleanText = cleanText ? `${cleanText}\n\n${note}` : note;
  }

  return {
    text: cleanText,
    pendingTool,
    toolEvents,
    usage: tokenUsage,
  };
}

/**
 * Generate a short title for a conversation based on the first message
 */
export async function generateConversationTitle(
  config: AIClientConfig,
  userMessage: string,
  assistantResponse: string
): Promise<string> {
  try {
    const provider = createAIClient(config);

    const result = streamText({
      model: provider.chat(config.textModel),
      messages: [
        {
          role: 'user',
          content: `Generate a short, descriptive title (3-5 words) summarizing what this conversation is about.

User message: "${userMessage}"
Assistant response: "${assistantResponse.slice(0, 200)}"

Rules:
- Return ONLY the title text, nothing else
- No quotes, no punctuation, no explanations
- Make it specific to the topic discussed (e.g. "Monthly grocery spending", "Adding coffee expense", "Budget category balance")
- Do NOT use generic titles like "New Chat", "Budget Question", or "Conversation"

Title:`,
        },
      ],
    });

    let text = '';
    for await (const delta of result.textStream) {
      text += delta;
    }

    const title = stripThinkBlocks(text || '')
      .replace(/^["']|["']$/g, '')
      .replace(/^Title:\s*/i, '')
      .slice(0, 50);

    if (!title || /^(new chat|budget question|conversation|chat|untitled)$/i.test(title)) {
      return generateLocalTitle(userMessage);
    }

    return title;
  } catch (error) {
    console.error('[AI] generateConversationTitle failed:', error);
    return generateLocalTitle(userMessage);
  }
}

function generateLocalTitle(userMessage: string): string {
  let title = userMessage
    .trim()
    .replace(/[?!.,;:]+$/g, '')
    .replace(/\s+/g, ' ');

  title = capitalize(title);

  if (title.length > 40) {
    title = title.substring(0, 40);
    const lastSpace = title.lastIndexOf(' ');
    if (lastSpace > 20) {
      title = title.substring(0, lastSpace);
    }
    title += '...';
  }

  return title || 'Chat';
}
