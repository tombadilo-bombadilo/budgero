import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { applyOpInvalidations } from '@shared/lib/query-utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';
import { Badge } from '@shared/ui/badge';
import { Checkbox } from '@shared/ui/checkbox';
import { Sparkles, CheckCircle2, XCircle, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { useAllTransactions } from '@entities/transaction/api/useTransactions';
import { useTransactionCellCommit } from '@features/transactions/api/useTransactionCellCommit';
import { useCategories, useCategoryGroups } from '@entities/category/api/useCategories';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useLLMSettings } from '@features/ai/api/useLLMSettings';
import { useUiStore } from '@shared/store/useUiStore';
import { getErrorMessage } from '@shared/lib/errors';
import { formatCurrency } from '@entities/currency/lib/currency-utils';
import { asMilli, toDecimal } from '@shared/lib/currency/milli';
import {
  categorizeTransactions,
  type AIClientConfig,
  type TransactionForCategorization,
  type CategorizationContext,
  type CategoryWithGroup,
} from '@features/ai/lib/client';
import { ScanProgress } from '@features/ai/ui/receipt-scanner';
import { AINotConfiguredWarning } from '@features/ai/ui/AINotConfiguredWarning';
import { createCategoryNameMap } from '@features/ai/lib/category-match';
import { buildHistoricalPatterns } from '@features/ai/lib/historical-patterns';

interface AICategorizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  budgetId: number;
}

type CategorizedTransaction = {
  transactionId: number;
  memo: string;
  payee: string;
  inflow: number;
  outflow: number;
  date: string;
  suggestedCategory: string;
  suggestedCategoryId: number | null;
  confidence: number;
  reasoning?: string;
  selected: boolean;
};

export function AICategorizeDialog({ open, onOpenChange, budgetId }: AICategorizeDialogProps) {
  const selectedBudget = useUiStore((s) => s.selectedBudget);
  const currencyCode = selectedBudget?.DisplayCurrency || 'USD';
  const { data: transactions = [] } = useAllTransactions(budgetId);
  const { data: categories = [] } = useCategories(budgetId);
  const { data: categoryGroups = [] } = useCategoryGroups(budgetId);
  const { data: accounts = [] } = useAccounts(budgetId);
  const { data: llmSettings } = useLLMSettings(budgetId);
  const cellCommit = useTransactionCellCommit();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<'ready' | 'analyzing' | 'review' | 'applying' | 'done'>('ready');
  const [categorizedTransactions, setCategorizedTransactions] = useState<CategorizedTransaction[]>(
    []
  );
  const [progress, setProgress] = useState(0);

  const categoryByName = useMemo(() => createCategoryNameMap(categories), [categories]);
  const categoryGroupById = useMemo(
    () => new Map(categoryGroups.map((g) => [g.ID, g.Name])),
    [categoryGroups]
  );
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.ID, a])), [accounts]);

  const categoriesWithGroups = useMemo((): CategoryWithGroup[] => {
    return categories
      .filter((c) => !c.Name.includes('[Archive]'))
      .map((c) => ({
        name: c.Name,
        groupName: categoryGroupById.get(c.CategoryGroupID) || 'Other',
      }));
  }, [categories, categoryGroupById]);

  const historicalPatterns = useMemo(() => buildHistoricalPatterns(transactions), [transactions]);

  const uncategorizedTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (!t) return false;
      if (t.Category === 'Split') return false;
      return !t.CategoryID || t.CategoryID === 0 || !t.Category || t.Category === 'Uncategorized';
    });
  }, [transactions]);

  const handleAnalyze = async () => {
    if (!llmSettings?.Enabled) {
      toast.error('AI not enabled', {
        description: 'Please configure AI settings first',
      });
      return;
    }

    if (uncategorizedTransactions.length === 0) {
      toast.info('No transactions to categorize');
      return;
    }

    setStep('analyzing');
    setProgress(0);

    try {
      const config: AIClientConfig = {
        provider: llmSettings.Provider,
        endpointURL: llmSettings.EndpointURL,
        apiKey: llmSettings.ApiKey,
        textModel: llmSettings.TextModel,
        visionModel: llmSettings.VisionModel,
      };

      const context: CategorizationContext = {
        categories: categoriesWithGroups,
        historicalPatterns,
        currencyCode,
      };

      const batchSize = 10;
      const batches: TransactionForCategorization[][] = [];

      for (let i = 0; i < uncategorizedTransactions.length; i += batchSize) {
        const batch = uncategorizedTransactions.slice(i, i + batchSize).map((t) => {
          const account = accountById.get(t.AccountId || 0);
          return {
            id: t.ID,
            memo: t.Memo || '',
            payee: t.Payee || '',
            // Stored milliunits → decimal at the LLM boundary (the prompt's
            // amount guidelines reason about decimal currency amounts).
            inflow: toDecimal(asMilli(t.Inflow || 0)),
            outflow: toDecimal(asMilli(t.Outflow || 0)),
            date: t.Date || '',
            accountName: account?.Name,
            accountType: account?.Type,
          };
        });
        batches.push(batch);
      }

      const allResults: CategorizedTransaction[] = [];

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        setProgress(Math.round((i / batches.length) * 100));

        const result = await categorizeTransactions(config, batch, context);

        for (const cat of result.categorizations) {
          const tx = batch.find((t) => t.id === cat.transactionId);
          if (!tx) continue;

          const matchedCategory = categoryByName.get(cat.categoryName.toLowerCase());

          const isUncategorized = cat.categoryName.toLowerCase() === 'uncategorized';
          const isValidCategory = matchedCategory !== undefined && !isUncategorized;

          allResults.push({
            transactionId: cat.transactionId,
            memo: tx.memo,
            payee: tx.payee,
            inflow: tx.inflow,
            outflow: tx.outflow,
            date: tx.date,
            suggestedCategory: cat.categoryName,
            suggestedCategoryId: isUncategorized ? null : matchedCategory?.ID || null,
            confidence: cat.confidence,
            reasoning: cat.reasoning,
            selected: cat.confidence >= 0.7 && isValidCategory,
          });
        }
      }

      setCategorizedTransactions(allResults);
      setProgress(100);
      setStep('review');
    } catch (err: unknown) {
      console.error('AI categorization failed:', err);
      const errMessage = getErrorMessage(err, 'Failed to analyze transactions');
      setStep('ready');
      toast.error('Analysis failed', {
        description: errMessage,
      });
    }
  };

  const handleToggleSelect = (transactionId: number) => {
    setCategorizedTransactions((prev) =>
      prev.map((t) => (t.transactionId === transactionId ? { ...t, selected: !t.selected } : t))
    );
  };

  const handleSelectAll = () => {
    const allSelected = categorizedTransactions.every((t) => t.selected);
    setCategorizedTransactions((prev) =>
      prev.map((t) => ({
        ...t,
        selected: !allSelected && t.suggestedCategoryId !== null,
      }))
    );
  };

  const handleApply = async () => {
    const toApply = categorizedTransactions.filter(
      (t) => t.selected && t.suggestedCategoryId !== null
    );

    if (toApply.length === 0) {
      toast.info('No categories to apply');
      return;
    }

    setStep('applying');
    setProgress(0);

    try {
      for (let i = 0; i < toApply.length; i++) {
        const t = toApply[i];
        setProgress(Math.round((i / toApply.length) * 100));

        const originalTx = transactions.find((tx) => tx.ID === t.transactionId);
        const accountId = originalTx?.AccountId || 0;

        // Suppress per-item invalidation; one invalidation pass runs after the batch.
        await cellCommit.mutateAsync(t.transactionId, 'CategoryID', t.suggestedCategoryId, {
          accountId,
          skipInvalidate: true,
        });
      }
      applyOpInvalidations(queryClient, 'transactions.updateColumn');

      setProgress(100);
      setStep('done');
      toast.success(`Applied ${toApply.length} categories`);
    } catch (err: unknown) {
      console.error('Failed to apply categories:', err);
      const errMessage = getErrorMessage(err, 'Failed to apply categories');
      setStep('review');
      toast.error('Failed to apply categories', {
        description: errMessage,
      });
    }
  };

  const handleClose = () => {
    setStep('ready');
    setCategorizedTransactions([]);
    setProgress(0);
    onOpenChange(false);
  };

  const selectedCount = categorizedTransactions.filter(
    (t) => t.selected && t.suggestedCategoryId !== null
  ).length;

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 0.8) {
      return (
        <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
          High
        </Badge>
      );
    }
    if (confidence >= 0.5) {
      return (
        <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
          Medium
        </Badge>
      );
    }
    return <Badge className="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">Low</Badge>;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI Auto-Categorize
          </DialogTitle>
          <DialogDescription>
            Use AI to automatically suggest categories for uncategorized transactions
          </DialogDescription>
        </DialogHeader>

        {step === 'ready' && (
          <div className="space-y-4 py-4">
            {!llmSettings?.Enabled ? (
              <AINotConfiguredWarning />
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Found <strong>{uncategorizedTransactions.length}</strong> uncategorized
                  transactions. The AI will analyze each transaction and suggest the best matching
                  category.
                </p>
                <div className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    Connected to: {llmSettings.EndpointURL}
                  </div>
                  <div className="mt-1 text-muted-foreground">Model: {llmSettings.TextModel}</div>
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleAnalyze}
                disabled={!llmSettings?.Enabled || uncategorizedTransactions.length === 0}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Analyze Transactions
              </Button>
            </div>
          </div>
        )}

        {step === 'analyzing' && (
          <ScanProgress progress={progress} message="Analyzing transactions with AI..." />
        )}

        {step === 'review' && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex items-center justify-between py-2">
              <p className="text-sm text-muted-foreground">
                {selectedCount} of {categorizedTransactions.length} selected to apply
              </p>
              <Button variant="ghost" size="sm" onClick={handleSelectAll}>
                {categorizedTransactions.every((t) => t.selected)
                  ? 'Deselect All'
                  : 'Select All Valid'}
              </Button>
            </div>

            <div className="h-[350px] overflow-y-auto border rounded-lg p-2 space-y-2">
              {categorizedTransactions.map((t) => (
                <div
                  key={t.transactionId}
                  className={`flex items-start gap-3 p-3 rounded-lg border ${
                    t.selected ? 'border-primary/50 bg-primary/5' : 'border-border'
                  }`}
                >
                  <Checkbox
                    checked={t.selected}
                    onCheckedChange={() => handleToggleSelect(t.transactionId)}
                    disabled={t.suggestedCategoryId === null}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{t.memo || t.payee || 'No description'}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span>{t.date}</span>
                      <span>•</span>
                      {t.outflow > 0 ? (
                        <span className="text-red-500">
                          -{formatCurrency(t.outflow, currencyCode)}
                        </span>
                      ) : (
                        <span className="text-green-500">
                          +{formatCurrency(t.inflow, currencyCode)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      {t.suggestedCategoryId !== null ? (
                        <Badge variant="secondary">{t.suggestedCategory}</Badge>
                      ) : (
                        <Badge variant="outline" className="text-red-500">
                          <XCircle className="h-3 w-3 mr-1" />
                          Unknown category
                        </Badge>
                      )}
                      {getConfidenceBadge(t.confidence)}
                    </div>
                    {t.reasoning && (
                      <p className="mt-1 text-xs text-muted-foreground italic">{t.reasoning}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleApply} disabled={selectedCount === 0}>
                Apply {selectedCount} Categories
              </Button>
            </div>
          </div>
        )}

        {step === 'applying' && (
          <ScanProgress progress={progress} message="Applying categories..." />
        )}

        {step === 'done' && (
          <div className="space-y-4 py-8">
            <div className="flex flex-col items-center gap-4">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="text-lg font-medium">Categories Applied!</p>
              <p className="text-sm text-muted-foreground text-center">
                Successfully categorized {selectedCount} transactions.
              </p>
            </div>
            <div className="flex justify-center pt-4">
              <Button onClick={handleClose}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
