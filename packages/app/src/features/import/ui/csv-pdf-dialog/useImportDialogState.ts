'use client';

import { useState, useRef, ChangeEvent, useEffect, useCallback } from 'react';
import { useBudgets } from '@entities/budget/api/useBudgets';
import {
  useAddCategoryGroup,
  useAddCategory,
  useCategories,
  useCategoryGroups,
} from '@entities/category/api/useCategories';
import { useAddAccount, useAccounts } from '@entities/account/api/useAccounts';
import { useAddTransaction } from '@entities/transaction/api/useTransactions';
import { useRecordImportRun } from '@features/import/api/useImportHistory';
import { useQueryClient } from '@tanstack/react-query';
import { useUiStore } from '@shared/store/useUiStore';
import { getErrorMessage } from '@shared/lib/errors';
import { invalidateRoots } from '@shared/lib/query-utils';
import { useRuntime } from '@shared/runtime/runtime-provider';

import {
  DEFAULT_IMPORT_CONFIG,
  type ImportStep,
  type ParsedData,
  type ColumnMapping,
  type ImportConfig,
  type ImportTemplate,
  type ImportProgress,
  type ImportSummary,
  type PreviewRow,
  type RawTableData,
} from '@features/import/model/types';
import {
  detectColumnMapping,
  parseDelimitedText,
  planImportRows,
  createImportNameMaps,
  resolveImportCategoryId,
} from '@budgero/core/browser';
import { toDecimal } from '@shared/lib/currency/milli';
import { trackImportedCsvPdf } from '@shared/lib/analytics/analytics';
import { parseImportFile } from '@features/import/lib/parse-import-file';
import { useImportTemplates } from './useImportTemplates';

export const STEPS: ImportStep[] = ['upload', 'configure', 'preview', 'import', 'complete'];

export interface ImportDialogState {
  currentStep: ImportStep;
  setCurrentStep: (step: ImportStep) => void;

  parsedData: ParsedData | null;
  columnMapping: ColumnMapping;
  setColumnMapping: (mapping: ColumnMapping) => void;
  importConfig: ImportConfig;
  setImportConfig: (config: ImportConfig) => void;
  previewData: PreviewRow[];
  previewTotalCount: number;
  previewImportableCount: number;
  previewSkippedCount: number;
  rawTableData: RawTableData | null;
  selectedHeaderIndex: number | null;
  skippedRowIndices: Set<number>;
  toggleSkippedRow: (parsedRowIndex: number) => void;
  setSkippedRowsInRange: (indices: number[], shouldSkip: boolean) => void;

  templates: ImportTemplate[];
  selectedTemplate: string;
  setSelectedTemplate: (id: string) => void;
  saveAsTemplate: boolean;
  setSaveAsTemplate: (save: boolean) => void;
  templateName: string;
  setTemplateName: (name: string) => void;

  progress: ImportProgress | null;
  importSummary: ImportSummary | null;
  error: string | null;

  fileInputRef: React.RefObject<HTMLInputElement | null>;

  accounts: { ID: number; Name: string; Currency: string }[] | undefined;
  hasBudgetSelected: boolean;

  handleFileChange: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleHeaderSelect: (index: number, headers: string[], rows: Record<string, string>[]) => void;
  applyTemplate: () => void;
  deleteTemplate: (id: string) => void;
  generatePreview: () => void;
  handleImport: () => Promise<void>;
  resetForm: () => void;
}

export function useImportDialogState(): ImportDialogState {
  const [currentStep, setCurrentStep] = useState<ImportStep>('upload');
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({});
  const [importConfig, setImportConfig] = useState<ImportConfig>(DEFAULT_IMPORT_CONFIG);
  const [_isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<PreviewRow[]>([]);
  // Total number of rows that will actually be imported (post skip-rows and
  // post per-row exclusion). `previewData` is capped at 500, but the import
  // operates on the full set, so we track the count separately for the UI.
  const [previewTotalCount, setPreviewTotalCount] = useState(0);
  // Of the rows that will be processed, how many will actually import vs be
  // skipped (no/unparseable amount). Computed over the full set, not just the
  // 500-row preview, so the wizard reports the truth instead of "all rows".
  const [previewImportableCount, setPreviewImportableCount] = useState(0);
  const [previewSkippedCount, setPreviewSkippedCount] = useState(0);
  const [selectedHeaderIndex, setSelectedHeaderIndex] = useState<number | null>(null);
  const [rawTableData, setRawTableData] = useState<RawTableData | null>(null);
  // Indices into `parsedData.rows` that the user has marked to skip during
  // import. Reset whenever the underlying parsedData layout changes (new
  // file, PDF header re-pick, CSV re-parse on skipRows change).
  const [skippedRowIndices, setSkippedRowIndices] = useState<Set<number>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const processFileRef = useRef<((file: File) => Promise<void>) | null>(null);

  const queryClient = useQueryClient();
  const runtime = useRuntime();
  const recordImportRunMutation = useRecordImportRun();
  const { setSelectedBudget, selectedBudget, pendingImportFile, setPendingImportFile } =
    useUiStore();
  const { data: budgets } = useBudgets();
  const { data: accounts } = useAccounts(selectedBudget?.ID || 0);
  const { data: categories } = useCategories(selectedBudget?.ID || 0);
  const { data: categoryGroups } = useCategoryGroups(selectedBudget?.ID || 0);
  const addCategoryGroupMutation = useAddCategoryGroup();
  const addCategoryMutation = useAddCategory();
  const addAccountMutation = useAddAccount();
  const addTransactionMutation = useAddTransaction();

  const {
    templates,
    selectedTemplate,
    setSelectedTemplate,
    saveAsTemplate,
    setSaveAsTemplate,
    templateName,
    setTemplateName,
    applyTemplate,
    deleteTemplate,
    saveTemplate: saveTemplateHandler,
  } = useImportTemplates(setColumnMapping, setImportConfig);

  useEffect(() => {
    if (!pendingImportFile || !processFileRef.current) return;

    const fileToProcess = pendingImportFile;
    void (async () => {
      try {
        await processFileRef.current?.(fileToProcess);
      } finally {
        const currentPending = useUiStore.getState().pendingImportFile;
        if (currentPending === fileToProcess) {
          setPendingImportFile(null);
        }
      }
    })();
  }, [pendingImportFile, setPendingImportFile]);

  const resetForm = useCallback(() => {
    setCurrentStep('upload');
    setParsedData(null);
    setColumnMapping({});
    setImportConfig(DEFAULT_IMPORT_CONFIG);
    setSelectedTemplate('');
    setSaveAsTemplate(false);
    setTemplateName('');
    setIsImporting(false);
    setProgress(null);
    setImportSummary(null);
    setError(null);
    setPreviewData([]);
    setPreviewTotalCount(0);
    setPreviewImportableCount(0);
    setPreviewSkippedCount(0);
    setSelectedHeaderIndex(null);
    setRawTableData(null);
    setSkippedRowIndices(new Set());
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [setSelectedTemplate, setSaveAsTemplate, setTemplateName]);

  const processSelectedFile = useCallback(
    async (selectedFile: File) => {
      setError(null);
      setSkippedRowIndices(new Set());

      try {
        const result = await parseImportFile(selectedFile, importConfig.skipRows);

        if (result.configPatch) {
          setImportConfig((prev) => ({ ...prev, ...result.configPatch }));
        }
        if (result.pdfTable) {
          setRawTableData(result.pdfTable.rawTableData);
          setSelectedHeaderIndex(result.pdfTable.suggestedHeaderIndex);
        }

        setParsedData(result.data);
        setColumnMapping(detectColumnMapping(result.data.headers));
        setCurrentStep('configure');
      } catch (err) {
        console.error('File parsing error:', err);
        setError(getErrorMessage(err, 'Failed to parse file'));
      }
    },
    [importConfig.skipRows]
  );

  processFileRef.current = processSelectedFile;

  // Re-parse CSV when skipRows changes so the user can drop banner rows from
  // the configure step without re-uploading. We do this in a lightweight way
  // (only re-running parseDelimitedText) instead of calling processSelectedFile
  // so the user's column mapping and other configure state aren't reset. PDFs
  // are handled by the ConfigureStep view, which slices `rawTableData.allRows`
  // directly — no re-parse needed.
  //
  // Refs are used so the effect's only "trigger" dep is `importConfig.skipRows`.
  // If we listed `parsedData` and `currentStep` directly, the effect would
  // re-fire on every parse and infinite-loop, since each re-parse calls
  // setParsedData with a fresh object reference.
  const parsedDataRef = useRef(parsedData);
  const currentStepRef = useRef(currentStep);
  useEffect(() => {
    parsedDataRef.current = parsedData;
  }, [parsedData]);
  useEffect(() => {
    currentStepRef.current = currentStep;
  }, [currentStep]);

  useEffect(() => {
    if (currentStepRef.current !== 'configure') return;
    const data = parsedDataRef.current;
    if (!data) return;
    // Only CSV-style sources need a skipRows re-parse. OFX/QIF/PDF have
    // their own structured parsing and don't honor skipRows.
    if (data.source.type !== 'csv') return;
    const { file } = data.source;
    if (!file) return;

    let cancelled = false;
    void (async () => {
      try {
        const text = await file.text();
        const { headers, rows } = parseDelimitedText(text, importConfig.skipRows);
        if (cancelled) return;
        setParsedData((prev) =>
          prev
            ? {
                ...prev,
                headers,
                rows,
              }
            : prev
        );
        // Row indices shift after re-parse — drop any pending skip marks.
        setSkippedRowIndices(new Set());
      } catch (err) {
        if (cancelled) return;
        setError(getErrorMessage(err, 'Failed to re-parse file'));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [importConfig.skipRows]);

  const handleFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0];
      if (selectedFile) {
        await processSelectedFile(selectedFile);
      }
    },
    [processSelectedFile]
  );

  // Header selection handler for PDFs
  const handleHeaderSelect = useCallback(
    (index: number, headers: string[], rows: Record<string, string>[]) => {
      setSelectedHeaderIndex(index);
      setParsedData((prev) => (prev ? { ...prev, headers, rows } : null));
      // Re-picking the header invalidates any existing skipped-row indices
      // because parsedData.rows shifts.
      setSkippedRowIndices(new Set());
    },
    []
  );

  const toggleSkippedRow = useCallback((parsedRowIndex: number) => {
    setSkippedRowIndices((prev) => {
      const next = new Set(prev);
      if (next.has(parsedRowIndex)) next.delete(parsedRowIndex);
      else next.add(parsedRowIndex);
      return next;
    });
  }, []);

  /**
   * Bulk setter used by shift-click range selection: set every index in
   * `indices` to `shouldSkip` in a single state update (instead of calling
   * toggleSkippedRow N times in a loop, which would fire N re-renders and
   * could race with itself on large ranges).
   */
  const setSkippedRowsInRange = useCallback((indices: number[], shouldSkip: boolean) => {
    setSkippedRowIndices((prev) => {
      const next = new Set(prev);
      for (const i of indices) {
        if (shouldSkip) next.add(i);
        else next.delete(i);
      }
      return next;
    });
  }, []);

  const generatePreview = useCallback(() => {
    if (!parsedData) return;

    try {
      const includedRows = parsedData.rows.filter((_, index) => !skippedRowIndices.has(index));

      // Plan every row (cheap, pure) so the counts reflect the whole file, then
      // render only the first 500. The plan is the exact same logic the import
      // runs, so the preview can no longer disagree with what actually imports.
      const plans = planImportRows(includedRows, columnMapping, importConfig);
      const importableCount = plans.filter((plan) => plan.status === 'ready').length;

      const preview: PreviewRow[] = plans.slice(0, 500).map((plan) => {
        const row = includedRows[plan.index];
        const parsed: PreviewRow['parsed'] = { date: plan.date };

        if (columnMapping.amount) {
          // Only show a number for rows we could actually read. Planned rows
          // carry milliunits; the preview displays decimals.
          if (plan.status === 'ready') {
            parsed.amount = plan.inflow > 0 ? toDecimal(plan.inflow) : -toDecimal(plan.outflow);
          }
        } else if (columnMapping.inflow || columnMapping.outflow) {
          parsed.inflow = toDecimal(plan.inflow);
          parsed.outflow = toDecimal(plan.outflow);
        }

        if (plan.payee) parsed.payee = plan.payee;
        if (columnMapping.memo) parsed.memo = plan.memo;
        if (columnMapping.account && row[columnMapping.account]) {
          parsed.account = row[columnMapping.account];
        }

        return { original: row, parsed, errors: plan.errors };
      });

      setPreviewData(preview);
      setPreviewTotalCount(includedRows.length);
      setPreviewImportableCount(importableCount);
      setPreviewSkippedCount(includedRows.length - importableCount);
      setCurrentStep('preview');
    } catch (err) {
      console.error('Preview generation error:', err);
      setError(getErrorMessage(err, 'Failed to generate preview'));
    }
  }, [parsedData, columnMapping, importConfig, skippedRowIndices]);

  const resolveAccountId = useCallback(
    (row: Record<string, string>, defaultAccountId: number): number => {
      if (!columnMapping.account) return defaultAccountId;
      const accountName = row[columnMapping.account]?.trim();
      if (!accountName) return defaultAccountId;
      const matchingAccount = accounts?.find(
        (account) => account.Name.toLowerCase() === accountName.toLowerCase()
      );
      return matchingAccount?.ID ?? defaultAccountId;
    },
    [columnMapping.account, accounts]
  );

  const resolveCategoryId = useCallback(
    async (
      row: Record<string, string>,
      inflow: number,
      incomeId: number,
      uncategorizedId: number,
      categoryIdByName: Map<string, number>,
      categoryGroupIdByName: Map<string, number>,
      onCategoryCreated?: (categoryId: number) => void
    ): Promise<number> => {
      return resolveImportCategoryId({
        columnCategory: columnMapping.category,
        row,
        inflow,
        incomeId,
        uncategorizedId,
        selectedBudgetId: selectedBudget?.ID,
        categoryIdByName,
        categoryGroupIdByName,
        addCategoryGroup: async ({ name, budgetId }) =>
          addCategoryGroupMutation.mutateAsync({ name, budgetId }),
        addCategory: async ({ name, groupId, budgetId, note }) =>
          addCategoryMutation.mutateAsync({ name, groupId, budgetId, note }),
        onCategoryCreated,
      });
    },
    [columnMapping.category, selectedBudget, addCategoryGroupMutation, addCategoryMutation]
  );

  const handleImport = useCallback(async () => {
    if (!parsedData || !selectedBudget?.ID) return;

    setIsImporting(true);
    setCurrentStep('import');
    setError(null);

    try {
      if (saveAsTemplate && templateName.trim()) {
        saveTemplateHandler({
          name: templateName.trim(),
          columnMapping,
          numberFormat: importConfig.numberFormat,
          thousandSeparator: importConfig.thousandSeparator,
          decimalSeparator: importConfig.decimalSeparator,
          dateFormat: importConfig.dateFormat,
          skipRows: importConfig.skipRows,
          accountCurrency: importConfig.accountCurrency,
        });
      }

      const budgetId = selectedBudget.ID;
      let destinationAccountName = '';
      const createdAccountIds: number[] = [];
      const createdCategoryIds: number[] = [];
      const importedTransactionIds: number[] = [];
      const { categoryIdByName, categoryGroupIdByName } = createImportNameMaps({
        categories,
        categoryGroups,
      });

      setProgress({ step: 'Starting import...', progress: 5, currentItem: '', isComplete: false });

      // Find or create a special category (and its same-named group), reusing
      // existing ones from the name maps.
      const ensureCategoryWithGroup = async (name: string, note: string): Promise<number> => {
        const key = name.toLowerCase();
        const existingId = categoryIdByName.get(key);
        if (existingId) return existingId;

        let groupId = categoryGroupIdByName.get(key);
        if (typeof groupId !== 'number') {
          groupId = await addCategoryGroupMutation.mutateAsync({ name, budgetId });
          categoryGroupIdByName.set(key, groupId);
        }
        const categoryId = await addCategoryMutation.mutateAsync({ name, groupId, budgetId, note });
        categoryIdByName.set(key, categoryId);
        createdCategoryIds.push(categoryId);
        return categoryId;
      };

      let incomeId = categoryIdByName.get('income');
      let uncategorizedId = categoryIdByName.get('uncategorized');

      if (!incomeId || !uncategorizedId) {
        setProgress({
          step: 'Setting up categories...',
          progress: 15,
          currentItem: 'Income and Uncategorized',
          isComplete: false,
        });

        incomeId = await ensureCategoryWithGroup('Income', 'Income transactions');
        uncategorizedId = await ensureCategoryWithGroup(
          'Uncategorized',
          'Uncategorized transactions'
        );
      }

      setProgress({
        step: 'Setting up accounts...',
        progress: 25,
        currentItem: 'Account configuration',
        isComplete: false,
      });

      let defaultAccountId: number;
      if (typeof importConfig.defaultAccountId === 'number') {
        defaultAccountId = importConfig.defaultAccountId;
        const selectedAccount = accounts?.find(
          (account) => account.ID === importConfig.defaultAccountId
        );
        destinationAccountName = selectedAccount?.Name || 'Existing account';
      } else {
        const defaultAccount = await addAccountMutation.mutateAsync({
          name: 'Import Account',
          budget_id: budgetId,
          type: 'Checking',
          currency: importConfig.accountCurrency,
          balance: 0,
          on_budget: true,
        });
        defaultAccountId = defaultAccount.ID;
        destinationAccountName = defaultAccount.Name || 'Import Account';
        createdAccountIds.push(defaultAccount.ID);
      }

      // Process transactions (excluding any rows the user marked as skipped
      // in the configure step). The planner decides — using the exact same
      // logic the preview displayed — which rows produce a transaction and
      // which are skipped because their amount is missing or unparseable, so
      // the import can no longer silently disagree with the preview.
      const rowsToImport = parsedData.rows.filter((_, index) => !skippedRowIndices.has(index));
      const plans = planImportRows(rowsToImport, columnMapping, importConfig);
      const totalRows = rowsToImport.length;
      let processedCount = 0;
      let successCount = 0;

      // incomeId and uncategorizedId are guaranteed to be set by the
      // initialization block above.
      const resolvedIncomeId = incomeId ?? 0;
      const resolvedUncategorizedId = uncategorizedId ?? 0;

      for (const plan of plans) {
        const row = rowsToImport[plan.index];
        try {
          setProgress({
            step: 'Importing transactions...',
            progress: 25 + (processedCount / totalRows) * 70,
            currentItem: `${processedCount + 1}/${totalRows}`,
            isComplete: false,
          });

          if (plan.status !== 'ready') {
            // Missing or unparseable amount — already surfaced in the preview.
            processedCount++;
            continue;
          }

          const categoryId = await resolveCategoryId(
            row,
            plan.inflow,
            resolvedIncomeId,
            resolvedUncategorizedId,
            categoryIdByName,
            categoryGroupIdByName,
            (newCategoryId) => {
              createdCategoryIds.push(newCategoryId);
            }
          );

          const transactionId = await addTransactionMutation.mutateAsync({
            inflow: plan.inflow,
            outflow: plan.outflow,
            accountId: resolveAccountId(row, defaultAccountId),
            categoryId,
            budgetId,
            date: plan.date,
            memo: plan.memo.substring(0, 255),
            payee: plan.payee,
            transferId: '',
          });

          importedTransactionIds.push(transactionId);
          successCount++;
        } catch (rowError) {
          console.warn(`Failed to import row ${processedCount + 1}:`, rowError);
        }

        processedCount++;
      }

      const skippedCount = totalRows - successCount;

      setProgress({
        step: 'Finalizing import...',
        progress: 95,
        currentItem: 'Syncing to server',
        isComplete: false,
      });

      try {
        await runtime.save();
      } catch (syncError) {
        console.warn('Failed to sync to server:', syncError);
      }

      setProgress({
        step: 'Import completed!',
        progress: 100,
        currentItem:
          skippedCount > 0
            ? `${successCount} imported, ${skippedCount} skipped`
            : `${successCount} transactions imported`,
        isComplete: true,
      });

      setImportSummary({
        budgetId,
        transactionsImported: successCount,
        transactionsSkipped: skippedCount,
        accountsCreated: createdAccountIds.length,
        categoriesCreated: createdCategoryIds.length,
        destinationAccountName,
      });

      trackImportedCsvPdf();

      if (parsedData.source) {
        try {
          await recordImportRunMutation.mutateAsync({
            budgetId,
            input: {
              budgetId,
              sourceType: parsedData.source.type,
              sourceName: parsedData.source.fileName,
              summary: {
                transactionsImported: successCount,
                accountsCreated: createdAccountIds.length,
                categoriesCreated: createdCategoryIds.length,
              },
              transactionIds: importedTransactionIds,
              accountIds: createdAccountIds,
              categoryIds: createdCategoryIds,
            },
          });
        } catch (historyError) {
          console.warn('[CSVPDFImportDialog] Failed to record import history', historyError);
        }
      }

      if (budgets) {
        const newBudget = budgets.find((b) => b.ID === budgetId);
        if (newBudget) {
          setSelectedBudget(newBudget);
        }
      }

      void queryClient.invalidateQueries({ queryKey: ['budgets'] });
      void queryClient.invalidateQueries({ queryKey: ['categories', budgetId] });
      void queryClient.invalidateQueries({ queryKey: ['accounts', budgetId] });
      invalidateRoots(queryClient, 'transactions');

      setCurrentStep('complete');
    } catch (err) {
      console.error('Import error:', err);
      setError(getErrorMessage(err, 'Import failed'));
    } finally {
      setIsImporting(false);
    }
  }, [
    parsedData,
    skippedRowIndices,
    selectedBudget,
    saveAsTemplate,
    templateName,
    columnMapping,
    importConfig,
    categories,
    categoryGroups,
    accounts,
    budgets,
    saveTemplateHandler,
    addCategoryGroupMutation,
    addCategoryMutation,
    addAccountMutation,
    addTransactionMutation,
    resolveAccountId,
    resolveCategoryId,
    runtime,
    recordImportRunMutation,
    setSelectedBudget,
    queryClient,
  ]);

  return {
    currentStep,
    setCurrentStep,

    parsedData,
    columnMapping,
    setColumnMapping,
    importConfig,
    setImportConfig,
    previewData,
    previewTotalCount,
    previewImportableCount,
    previewSkippedCount,
    rawTableData,
    selectedHeaderIndex,
    skippedRowIndices,
    toggleSkippedRow,
    setSkippedRowsInRange,

    templates,
    selectedTemplate,
    setSelectedTemplate,
    saveAsTemplate,
    setSaveAsTemplate,
    templateName,
    setTemplateName,

    progress,
    importSummary,
    error,

    fileInputRef,

    accounts,
    hasBudgetSelected: !!selectedBudget,

    handleFileChange,
    handleHeaderSelect,
    applyTemplate,
    deleteTemplate,
    generatePreview,
    handleImport,
    resetForm,
  };
}
