import { Trans, useLingui } from '@lingui/react/macro';
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
  const { t } = useLingui();

  const selectedBudget = useUiStore((s) => s.selectedBudget);
  const currencyCode = selectedBudget?.DisplayCurrency || 'USD';
  // The whole ledger (for the uncategorized list and the payee history) loads
  // only while the dialog is open; the dashboard card mounts it closed.
  const { data: transactions = [], isLoading: transactionsLoading } = useAllTransactions(budgetId, {
    enabled: open,
  });
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
    return transactions.filter((txn) => {
      if (!txn) return false;
      if (txn.Category === 'Split') return false;
      return (
        !txn.CategoryID || txn.CategoryID === 0 || !txn.Category || txn.Category === 'Uncategorized'
      );
    });
  }, [transactions]);

  const handleAnalyze = async () => {
    if (!llmSettings?.Enabled) {
      toast.error(t`AI not enabled`, {
        description: t`Please configure AI settings first`,
      });
      return;
    }

    if (uncategorizedTransactions.length === 0) {
      toast.info(t`No transactions to categorize`);
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
        const batch = uncategorizedTransactions.slice(i, i + batchSize).map((txn) => {
          const account = accountById.get(txn.AccountId || 0);
          return {
            id: txn.ID,
            memo: txn.Memo || '',
            payee: txn.Payee || '',
            // Stored milliunits → decimal at the LLM boundary (the prompt's
            // amount guidelines reason about decimal currency amounts).
            inflow: toDecimal(asMilli(txn.InflowConverted || 0)),
            outflow: toDecimal(asMilli(txn.OutflowConverted || 0)),
            date: txn.Date || '',
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
          const tx = batch.find((txn) => txn.id === cat.transactionId);
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
      const errMessage = getErrorMessage(err, t`Failed to analyze transactions`);
      setStep('ready');
      toast.error(t`Analysis failed`, {
        description: errMessage,
      });
    }
  };

  const handleToggleSelect = (transactionId: number) => {
    setCategorizedTransactions((prev) =>
      prev.map((txn) =>
        txn.transactionId === transactionId ? { ...txn, selected: !txn.selected } : txn
      )
    );
  };

  const handleSelectAll = () => {
    const allSelected = categorizedTransactions.every((txn) => txn.selected);
    setCategorizedTransactions((prev) =>
      prev.map((txn) => ({
        ...txn,
        selected: !allSelected && txn.suggestedCategoryId !== null,
      }))
    );
  };

  const handleApply = async () => {
    const toApply = categorizedTransactions.filter(
      (txn) => txn.selected && txn.suggestedCategoryId !== null
    );

    if (toApply.length === 0) {
      toast.info(t`No categories to apply`);
      return;
    }

    setStep('applying');
    setProgress(0);

    try {
      for (let i = 0; i < toApply.length; i++) {
        const txn = toApply[i];
        setProgress(Math.round((i / toApply.length) * 100));

        const originalTx = transactions.find((tx) => tx.ID === txn.transactionId);
        const accountId = originalTx?.AccountId || 0;

        // Suppress per-item invalidation; one invalidation pass runs after the batch.
        await cellCommit.mutateAsync(txn.transactionId, 'CategoryID', txn.suggestedCategoryId, {
          accountId,
          skipInvalidate: true,
        });
      }
      applyOpInvalidations(queryClient, 'transactions.updateColumn');

      setProgress(100);
      setStep('done');
      toast.success(t`Applied ${toApply.length} categories`);
    } catch (err: unknown) {
      console.error('Failed to apply categories:', err);
      const errMessage = getErrorMessage(err, t`Failed to apply categories`);
      setStep('review');
      toast.error(t`Failed to apply categories`, {
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
    (txn) => txn.selected && txn.suggestedCategoryId !== null
  ).length;

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 0.8) {
      return (
        <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
          <Trans>High</Trans>
        </Badge>
      );
    }
    if (confidence >= 0.5) {
      return (
        <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
          <Trans>Medium</Trans>
        </Badge>
      );
    }
    return (
      <Badge className="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
        <Trans>Low</Trans>
      </Badge>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trans>
              <Sparkles className="h-5 w-5" />
              AI Auto-Categorize
            </Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Use AI to automatically suggest categories for uncategorized transactions</Trans>
          </DialogDescription>
        </DialogHeader>

        {step === 'ready' && (
          <div className="space-y-4 py-4">
            {!llmSettings?.Enabled ? (
              <AINotConfiguredWarning />
            ) : transactionsLoading ? (
              <div className="flex justify-center py-6">
                <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary" />
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    Found <strong>{uncategorizedTransactions.length}</strong>uncategorized
                    transactions. The AI will analyze each transaction and suggest the best matching
                    category.
                  </Trans>
                </p>
                <div className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Trans>
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      Connected to: {llmSettings.EndpointURL}
                    </Trans>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    <Trans>Model: {llmSettings.TextModel}</Trans>
                  </div>
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={handleClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                onClick={handleAnalyze}
                disabled={
                  !llmSettings?.Enabled ||
                  transactionsLoading ||
                  uncategorizedTransactions.length === 0
                }
              >
                <Trans>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Analyze Transactions
                </Trans>
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
                <Trans>
                  {selectedCount} of {categorizedTransactions.length} selected to apply
                </Trans>
              </p>
              <Button variant="ghost" size="sm" onClick={handleSelectAll}>
                {categorizedTransactions.every((txn) => txn.selected)
                  ? t`Deselect All`
                  : t`Select All Valid`}
              </Button>
            </div>

            <div className="h-[350px] overflow-y-auto border rounded-lg p-2 space-y-2">
              {categorizedTransactions.map((txn) => (
                <div
                  key={txn.transactionId}
                  className={`flex items-start gap-3 p-3 rounded-lg border ${
                    txn.selected ? 'border-primary/50 bg-primary/5' : 'border-border'
                  }`}
                >
                  <Checkbox
                    checked={txn.selected}
                    onCheckedChange={() => handleToggleSelect(txn.transactionId)}
                    disabled={txn.suggestedCategoryId === null}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{txn.memo || txn.payee || t`No description`}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span>{txn.date}</span>
                      <span>•</span>
                      {txn.outflow > 0 ? (
                        <span className="text-red-500">
                          -{formatCurrency(txn.outflow, currencyCode)}
                        </span>
                      ) : (
                        <span className="text-green-500">
                          +{formatCurrency(txn.inflow, currencyCode)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      {txn.suggestedCategoryId !== null ? (
                        <Badge variant="secondary">{txn.suggestedCategory}</Badge>
                      ) : (
                        <Badge variant="outline" className="text-red-500">
                          <Trans>
                            <XCircle className="h-3 w-3 mr-1" />
                            Unknown category
                          </Trans>
                        </Badge>
                      )}
                      {getConfidenceBadge(txn.confidence)}
                    </div>
                    {txn.reasoning && (
                      <p className="mt-1 text-xs text-muted-foreground italic">{txn.reasoning}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={handleClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Button onClick={handleApply} disabled={selectedCount === 0}>
                <Trans>Apply {selectedCount} Categories</Trans>
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
              <p className="text-lg font-medium">
                <Trans>Categories Applied!</Trans>
              </p>
              <p className="text-sm text-muted-foreground text-center">
                <Trans>Successfully categorized {selectedCount} transactions.</Trans>
              </p>
            </div>
            <div className="flex justify-center pt-4">
              <Button onClick={handleClose}>
                <Trans>Done</Trans>
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
