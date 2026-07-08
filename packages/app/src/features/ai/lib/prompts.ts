import type { CategorizationContext, TransactionForCategorization } from '@features/ai/lib/client';

/**
 * Builds the transaction-categorization prompt: the category hierarchy, the
 * user's historical categorization patterns (top 20), and the transactions to
 * categorize, plus the response-format/confidence instructions.
 */
export function buildCategorizationPrompt(
  transactions: TransactionForCategorization[],
  context: CategorizationContext
): string {
  const categoryGroups = new Map<string, string[]>();
  for (const cat of context.categories) {
    const group = cat.groupName || 'Other';
    if (!categoryGroups.has(group)) {
      categoryGroups.set(group, []);
    }
    categoryGroups.get(group)?.push(cat.name);
  }

  const categoryHierarchy = Array.from(categoryGroups.entries())
    .map(([group, cats]) => `${group}:\n${cats.map((c) => `  - ${c}`).join('\n')}`)
    .join('\n\n');

  const patternsStr =
    context.historicalPatterns.length > 0
      ? context.historicalPatterns
          .slice(0, 20)
          .map((p) => {
            const display = p.payee && p.memo ? `${p.payee}: ${p.memo}` : p.memo;
            return `"${display}" → ${p.categoryName} (${p.count}x)`;
          })
          .join('\n')
      : 'No historical data available';

  const validCategoryNames = context.categories.map((c) => c.name);

  return `You are a financial transaction categorizer for a personal budget app. Analyze the transactions and assign each to the most appropriate category.

## Available Categories

Categories are organized by group. Pick from the INDENTED category names (prefixed with "-"), NOT the group headers.

${categoryHierarchy}

## Valid Category Names (use one of these exactly)

${validCategoryNames.join(', ')}

## User's Historical Categorization Patterns

These show how the user previously categorized similar transactions:
${patternsStr}

## Transactions to Categorize

Currency: ${context.currencyCode}

${transactions
  .map((t) => {
    const amount = t.outflow > 0 ? `-${t.outflow}` : `+${t.inflow}`;
    const account = t.accountName
      ? ` | Account: ${t.accountName}${t.accountType ? ` (${t.accountType})` : ''}`
      : '';
    return `ID: ${t.id} | ${t.date} | ${amount} ${context.currencyCode} | Payee: "${t.payee}" | Memo: "${t.memo}"${account}`;
  })
  .join('\n')}

## Instructions

1. Match each transaction to ONE category from the "Valid Category Names" list
2. Use the EXACT category name as shown (case-sensitive) - DO NOT use group names
3. Prioritize matching based on:
   - Payee/merchant name recognition (strongest signal - e.g., "Netflix" → subscription, "Wolt" → food delivery)
   - User's historical patterns for similar transactions
   - Memo/description keywords
   - **Transaction amount (CRITICAL)** - unusual amounts should override other signals
   - **Last resort**: If no clear match, and payee is a person's name matching a category (e.g., payee "Alexander" → "Alex - Shopping"), use that
4. For income (positive amounts), look for income-related categories
5. Never suggest "Uncategorized" - always pick the best matching category

## Amount Guidelines (CRITICAL - MUST FOLLOW)

- Food/meals/delivery: typically under 5,000 in local currency. Amounts over 10,000 are NEVER food.
- Large purchases (10,000+): shopping, electronics, clothing, sports gear, services
- Subscriptions: recurring fixed amounts (often round numbers)
- Unknown merchants with high amounts: likely retail stores (clothing, electronics, sports, etc.)

**HARD RULE**: If the amount clearly doesn't fit a category (e.g., 17,000 for "food"), DO NOT select that category regardless of keyword similarities. Choose a different category or set confidence below 0.3.

## Response Format

Respond with ONLY this JSON (no markdown, no explanation):
{
  "categorizations": [
    {
      "transactionId": <number>,
      "categoryName": "<exact category name>",
      "confidence": <0.0 to 1.0>,
      "reasoning": "<brief explanation>"
    }
  ]
}

Confidence guide:
- 0.9+: Exact payee match in history OR very clear merchant (e.g., "Netflix" → Entertainment)
- 0.7-0.9: Strong keyword match or similar pattern in history
- 0.5-0.7: Reasonable guess based on context
- <0.5: Weak match, user should review`;
}

/**
 * Builds the receipt/statement image-extraction prompt, listing the user's
 * available categories (if any) so the model's `suggestedCategory` matches an
 * exact existing name.
 */
export function buildExtractionPrompt(availableCategories: string[] = []): string {
  return `Analyze this image of a receipt, bank statement, or financial document.

${
  availableCategories.length > 0
    ? `The user has these categories in their budget - you MUST use one of these exact names for suggestedCategory:
${availableCategories.map((c) => `- ${c}`).join('\n')}`
    : 'No categories provided - suggest appropriate category names.'
}

Extract all transactions and for each provide:
- date: YYYY-MM-DD format (assume 2025 if year not visible)
- payee: The merchant/business name
- memo: Brief description of items purchased
- amount: Transaction amount as positive number
- isExpense: true for expense, false for income
- suggestedCategory: Pick the BEST MATCHING category from the list above (use exact spelling)

Respond with valid JSON only (no markdown), in this format:
{
  "transactions": [
    {"date": "YYYY-MM-DD", "payee": "string", "memo": "string", "amount": number, "isExpense": boolean, "suggestedCategory": "string"}
  ],
  "confidence": number between 0 and 1
}

If not a financial document, return {"transactions": [], "confidence": 0}.`;
}
