'use client';

import { useLingui } from '@lingui/react/macro';

import { useState, useRef, ChangeEvent, useEffect, useCallback } from 'react';
import { useBudgets } from '@entities/budget/api/useBudgets';
import {
  useAddCategoryGroup,
  useAddCategory,
  useCategories,
  useCategoryGroups,
} from '@entities/category/api/useCategories';
import { useAddAccount, useAccounts } from '@entities/account/api/useAccounts';
import { executeSpaceMutation } from '@shared/runtime/mutation-router';
import { useUndoStore } from '@shared/mutations/UndoStore';
import { useRecordImportRun } from '@features/import/api/useImportHistory';
import { useQueryClient } from '@tanstack/react-query';
import { useUiStore } from '@shared/store/useUiStore';
import { getErrorMessage } from '@shared/lib/errors';
import { applyOpInvalidations, invalidateRoots } from '@shared/lib/query-utils';
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
  type ImportDecision,
  type RawTableData,
} from '@features/import/model/types';
import {
  detectColumnMapping,
  parseDelimitedText,
  createImportNameMaps,
  resolveImportCategoryId,
  defaultOnBudgetForType,
  AccountTypeEnum,
  type DuplicateInput,
} from '@budgero/core/browser';
import {
  IMPORT_ACCOUNT_PLACEHOLDER,
  isPlaceholderAccountId,
  planAccountRoutes,
  readRememberedRoutes,
  rememberRoutes,
} from '@features/import/lib/account-routes';
import { buildFileImportPreview, importTolerance } from '@features/import/lib/plan-file-import';
import { trackImportedCsvPdf } from '@shared/lib/analytics/analytics';
import { startImportRun } from '@shared/lib/analytics/import-tracking';
import { parseImportFile } from '@features/import/lib/parse-import-file';
import { useImportTemplates } from './useImportTemplates';

/** Run record batch size (rows) and maximum age (ms) between saves. */
const CHECKPOINT_ROWS = 100;
const CHECKPOINT_MS = 2000;

/**
 * Rows in date order, oldest first, keeping file order within a day. Each
 * new transaction updates the running balance of every later one in its
 * account, so a newest-first bank export imported as-is did that for every
 * row (quadratic: ~265M row updates for 23k rows). Oldest-first makes each
 * insert an append. File order within a day keeps same-day rows in the order
 * they were imported before, and keeps a same-file duplicate after the row it
 * duplicates.
 */
export function inDateOrder<T extends { input: { date: string; index: number } }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => a.input.date.localeCompare(b.input.date) || a.input.index - b.input.index
  );
}

export const STEPS: ImportStep[] = ['upload', 'configure', 'preview', 'import', 'complete'];

export interface ImportDialogState {
  /** The budget the file is imported into (0 when none is selected). */
  budgetId: number;
  /** Currency of accounts the import creates when the file states none. */
  newAccountCurrency: string;
  currentStep: ImportStep;
  setCurrentStep: (step: ImportStep) => void;

  parsedData: ParsedData | null;
  columnMapping: ColumnMapping;
  setColumnMapping: (mapping: ColumnMapping) => void;
  importConfig: ImportConfig;
  setImportConfig: (config: ImportConfig) => void;
  previewData: PreviewRow[];
  setRowDecision: (index: number, decision: ImportDecision) => void;
  resolveAll: (decision: ImportDecision) => void;
  isChecking: boolean;
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

  accounts: { ID: number; Name: string; Currency: string; Archived?: boolean }[] | undefined;
  hasBudgetSelected: boolean;

  handleFileChange: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleHeaderSelect: (index: number, headers: string[], rows: Record<string, string>[]) => void;
  applyTemplate: () => void;
  deleteTemplate: (id: string) => void;
  generatePreview: () => void;
  handleImport: () => Promise<void>;
  resetForm: () => void;
}

function withDecision(row: PreviewRow, decision: ImportDecision): PreviewRow {
  if (row.decision === decision) return row;
  return {
    ...row,
    decision,
    input:
      decision === 'import' && row.duplicate.status !== 'new'
        ? { ...row.input, operationId: `${row.input.operationId}:override:${crypto.randomUUID()}` }
        : row.input,
  };
}

export function useImportDialogState(): ImportDialogState {
  const { t } = useLingui();

  const [currentStep, setCurrentStep] = useState<ImportStep>('upload');
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({});
  const [importConfig, setImportConfig] = useState<ImportConfig>(DEFAULT_IMPORT_CONFIG);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<PreviewRow[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const importLock = useRef(false);
  const runKey = useRef(crypto.randomUUID());
  const previewGeneration = useRef(0);
  const setRowDecision = (index: number, decision: ImportDecision) =>
    setPreviewData((rows) =>
      rows.map((row) => (row.input.index === index ? withDecision(row, decision) : row))
    );
  const resolveAll = (decision: ImportDecision) =>
    setPreviewData((rows) =>
      rows.map((row) =>
        row.duplicate.status === 'needs-review' &&
        !row.decision &&
        (decision !== 'match' || row.duplicate.candidates.length > 0)
          ? withDecision(row, decision)
          : row
      )
    );
  // Counts cover the full statement, independently of preview pagination.
  const [previewTotalCount, setPreviewTotalCount] = useState(0);

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
  // OFX/CAMT state their currency (parse-import-file puts it in accountCurrency);
  // otherwise accountCurrency is only the 'USD' default, so new accounts take
  // the budget's currency.
  const statesCurrency = parsedData?.source.type === 'ofx' || parsedData?.source.type === 'camt';
  const newAccountCurrency =
    (!statesCurrency && selectedBudget?.DisplayCurrency) || importConfig.accountCurrency;
  const { data: categories } = useCategories(selectedBudget?.ID || 0);
  const { data: categoryGroups } = useCategoryGroups(selectedBudget?.ID || 0);
  const addCategoryGroupMutation = useAddCategoryGroup();
  const addCategoryMutation = useAddCategory();
  const addAccountMutation = useAddAccount();

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
    runKey.current = crypto.randomUUID();
    previewGeneration.current++;
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
      runKey.current = crypto.randomUUID();
      setError(null);
      setSkippedRowIndices(new Set());

      try {
        const result = await parseImportFile(selectedFile, importConfig.skipRows);

        // Account choices belong to the file they were made for.
        setImportConfig((prev) => ({ ...prev, ...result.configPatch, accountRoutes: undefined }));
        if (result.pdfTable) {
          setRawTableData(result.pdfTable.rawTableData);
          setSelectedHeaderIndex(result.pdfTable.suggestedHeaderIndex);
        }

        setParsedData(result.data);
        setColumnMapping(detectColumnMapping(result.data.headers));
        setCurrentStep('configure');
      } catch (err) {
        console.error('File parsing error:', err);
        setError(getErrorMessage(err, t`Failed to parse file`));
      }
    },
    [importConfig.skipRows, t]
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
        setError(getErrorMessage(err, t`Failed to re-parse file`));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [importConfig.skipRows, t]);

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

  const buildPreview = useCallback(async (): Promise<PreviewRow[]> => {
    if (!parsedData || !selectedBudget) return [];
    return buildFileImportPreview({
      parsedData,
      budgetId: selectedBudget.ID,
      columnMapping,
      importConfig,
      accounts: runtime.services().accounts.listAccounts(selectedBudget.ID),
      skippedRowIndices,
      selectedHeaderIndex,
      runKey: runKey.current,
      duplicates: runtime.services().importHistory.duplicates,
      tolerance: importTolerance(runtime.services()),
      rememberedRoutes: readRememberedRoutes(selectedBudget.ID),
      newCurrency: newAccountCurrency,
    });
  }, [
    parsedData,
    selectedBudget,
    columnMapping,
    importConfig,
    newAccountCurrency,
    skippedRowIndices,
    selectedHeaderIndex,
    runtime,
  ]);

  const generatePreview = useCallback(async () => {
    const generation = ++previewGeneration.current;
    setIsChecking(true);
    setError(null);
    try {
      const preview = await buildPreview();
      if (generation !== previewGeneration.current) return;
      setPreviewData(preview);
      setPreviewTotalCount(preview.length);
      setPreviewImportableCount(preview.filter((row) => row.duplicate.status === 'new').length);
      setPreviewSkippedCount(preview.filter((row) => row.duplicate.status === 'invalid').length);
      setCurrentStep('preview');
    } catch (err) {
      setError(getErrorMessage(err, t`Failed to check duplicates`));
    } finally {
      if (generation === previewGeneration.current) setIsChecking(false);
    }
  }, [buildPreview, t]);

  // A preview belongs to exactly one parsing configuration and destination.
  useEffect(() => {
    previewGeneration.current++;
    setIsChecking(false);
    setPreviewData([]);
    setCurrentStep((step) => (step === 'preview' ? 'configure' : step));
  }, [
    parsedData,
    columnMapping,
    importConfig,
    skippedRowIndices,
    selectedBudget?.ID,
    selectedHeaderIndex,
  ]);

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
    if (!parsedData || !selectedBudget?.ID || importLock.current) return;
    importLock.current = true;
    const generation = previewGeneration.current;
    setIsChecking(true);
    let fresh: PreviewRow[];
    try {
      fresh = await buildPreview();
      if (generation !== previewGeneration.current) {
        importLock.current = false;
        return;
      }
      const signature = (rows: PreviewRow[]) =>
        JSON.stringify(
          rows.map((r) => [
            r.input.fileRowKey,
            r.input.accountId,
            r.duplicate,
            r.transfer,
            r.otherSideExists,
          ])
        );
      if (signature(fresh) !== signature(previewData)) {
        setPreviewData(fresh);
        setCurrentStep('preview');
        setError(t`Transactions or destinations changed. Please review the updated matches.`);
        importLock.current = false;
        return;
      }
      fresh = fresh.map((row, index) => ({
        ...row,
        decision: previewData[index].decision,
        input: { ...row.input, operationId: previewData[index].input.operationId },
      }));
      if (fresh.some((r) => r.duplicate.status === 'needs-review' && !r.decision)) {
        importLock.current = false;
        return;
      }
    } catch (err) {
      setError(getErrorMessage(err, t`Duplicate check failed`));
      importLock.current = false;
      return;
    } finally {
      setIsChecking(false);
    }
    const selectedRows = fresh.filter(
      (r) => r.input.valid && r.decision !== 'skip' && r.decision !== 'match'
    );
    // A row becomes a transfer when it is imported and its other side is
    // imported with it (a pair) or not in the file at all. A pair whose other
    // side is skipped or matched stays a plain transaction.
    const selectedIndices = new Set(selectedRows.map((r) => r.input.index));
    const transferOf = (r: PreviewRow) =>
      r.transfer &&
      selectedIndices.has(r.input.index) &&
      (r.transfer.partnerIndex === undefined || selectedIndices.has(r.transfer.partnerIndex))
        ? r.transfer
        : undefined;
    const matchCandidate = (r: PreviewRow) =>
      r.input.valid && r.decision === 'match' ? r.duplicate.candidates[0]?.id : undefined;
    const transactionsMatched = fresh.filter((r) => matchCandidate(r) !== undefined).length;
    // Match = keep the existing transaction, link this statement row to it and
    // mark it cleared. Undoable, together with the rest of the import.
    const applyMatch = async (r: PreviewRow, accountId: number, transactionId: number) => {
      await executeSpaceMutation(runtime, {
        op: 'importHistory.match',
        payload: {
          budgetId: r.input.budgetId,
          accountId,
          transactionId,
          identity: { ...r.input, accountId },
        },
      });
      await executeSpaceMutation(runtime, {
        op: 'transactions.setCleared',
        payload: { budgetId: r.input.budgetId, ids: [transactionId], cleared: true },
      });
    };
    let duplicatesSkipped = fresh.filter(
      (r) => r.input.valid && r.decision === 'skip' && r.duplicate.status !== 'new'
    ).length;
    // Rows of an account set to "Don't import" were skipped by the user, not invalid.
    const accountSkipped = fresh.filter(
      (r) => r.accountSkipped && !skippedRowIndices.has(r.input.index)
    ).length;
    const userSkipped =
      skippedRowIndices.size +
      accountSkipped +
      fresh.filter((r) => r.input.valid && r.decision === 'skip' && r.duplicate.status === 'new')
        .length;
    const invalidRows = fresh.filter(
      (r) => !r.input.valid && !r.accountSkipped && !skippedRowIndices.has(r.input.index)
    ).length;
    const importRun = startImportRun(parsedData.source.type, 'app');
    if (!selectedRows.length) {
      if (transactionsMatched) useUndoStore.getState().beginGroup();
      try {
        const matchedIds = new Map<number, number>();
        for (const reviewed of fresh) {
          const matchId = matchCandidate(reviewed);
          if (matchId !== undefined) {
            await applyMatch(reviewed, reviewed.input.accountId, matchId);
            matchedIds.set(reviewed.input.index, matchId);
            continue;
          }
          const candidate =
            reviewed.duplicate.candidates[0]?.id ??
            (reviewed.duplicate.sameFileIndex !== undefined
              ? matchedIds.get(reviewed.duplicate.sameFileIndex)
              : undefined);
          if (candidate !== undefined) matchedIds.set(reviewed.input.index, candidate);
          if (
            reviewed.input.valid &&
            reviewed.decision === 'skip' &&
            reviewed.duplicate.status !== 'already-imported' &&
            candidate !== undefined
          ) {
            await executeSpaceMutation(runtime, {
              op: 'importHistory.match',
              payload: {
                budgetId: reviewed.input.budgetId,
                accountId: reviewed.input.accountId,
                transactionId: candidate,
                identity: reviewed.input,
              },
              meta: { skipUndo: true },
            });
          }
        }
        const summary = {
          budgetId: selectedBudget.ID,
          transactionsImported: 0,
          ...(transactionsMatched ? { transactionsMatched } : {}),
          duplicatesSkipped,
          userSkipped,
          invalidRows,
          failedRows: 0,
          accountsCreated: 0,
          categoriesCreated: 0,
        };
        await recordImportRunMutation.mutateAsync({
          budgetId: selectedBudget.ID,
          input: {
            runKey: runKey.current,
            budgetId: selectedBudget.ID,
            sourceType: parsedData.source.type,
            sourceName: parsedData.source.fileName,
            summary,
            transactionIds: [],
            accountIds: [],
            categoryIds: [],
          },
        });
        setImportSummary(summary);
        setCurrentStep('complete');
        importRun.ok(0);
      } catch (err) {
        importRun.error(err);
        setError(getErrorMessage(err, t`Could not finish import`));
      } finally {
        if (transactionsMatched) useUndoStore.getState().endGroup();
        importLock.current = false;
      }
      return;
    }

    setIsImporting(true);
    setCurrentStep('import');
    setError(null);

    // The whole import (created account, categories, every row) is one undo
    // entry, so a single Ctrl+Z reverts it instead of one row at a time.
    useUndoStore.getState().beginGroup();
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
      // Mirror legs of one-sided transfers: in importedTransactionIds, but no file row.
      let mirrorTransactions = 0;
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

      // Rows headed for a new account carry a placeholder id: -1 for the one
      // "Import Account", or one per new account chosen in "Accounts in this
      // file" (planAccountRoutes, the same plan the preview used). Create each
      // once, then send its rows there. Placeholder ids never reach a mutation.
      const routePlan = planAccountRoutes({
        rows: parsedData.rows,
        column: columnMapping.account,
        accounts: runtime.services().accounts.listAccounts(budgetId),
        remembered: readRememberedRoutes(budgetId),
        chosen: importConfig.accountRoutes,
        newAccountCurrency,
        fallbackAccountId: importConfig.defaultAccountId,
      });
      const createdFor = new Map<number, { ID: number; Name: string }>();
      const pendingIds = [
        ...new Set(
          selectedRows
            .flatMap((row) => [row.input.accountId, transferOf(row)?.counterpartAccountId ?? 0])
            .filter((id) => isPlaceholderAccountId(id))
        ),
      ];
      for (const placeholder of pendingIds) {
        const planned = routePlan.newAccounts.find((a) => a.placeholderId === placeholder);
        if (!planned && placeholder !== IMPORT_ACCOUNT_PLACEHOLDER)
          throw new Error(
            t`Transactions or destinations changed. Please review the updated matches.`
          );
        const name = planned?.name ?? t`Import Account`;
        const type = planned?.type ?? AccountTypeEnum.CHECKING;
        const created = await addAccountMutation.mutateAsync({
          name,
          budget_id: budgetId,
          type,
          currency:
            selectedRows.find((row) => row.input.accountId === placeholder)?.input.currency ??
            planned?.currency ??
            newAccountCurrency,
          balance: 0,
          on_budget: defaultOnBudgetForType(type),
        });
        createdFor.set(placeholder, { ID: created.ID, Name: created.Name || name });
        createdAccountIds.push(created.ID);
      }
      const realAccountId = (id: number) => createdFor.get(id)?.ID ?? id;
      const withRealAccount = <T extends { accountId: number }>(identity: T): T => ({
        ...identity,
        accountId: realAccountId(identity.accountId),
      });
      const destinationIds = [
        ...new Set(selectedRows.map((row) => realAccountId(row.input.accountId))),
      ];
      const nameOf = (id: number) =>
        accounts?.find((account) => account.ID === id)?.Name ??
        [...createdFor.values()].find((account) => account.ID === id)?.Name ??
        t`Existing account`;
      destinationAccountName =
        destinationIds.length === 1
          ? nameOf(destinationIds[0])
          : t`${destinationIds.length} accounts`;
      // Next import of a file with these accounts starts from the same choices.
      const chosen: Record<string, number> = {};
      for (const [source, target] of routePlan.targets) {
        if (target.kind === 'existing') chosen[source] = target.accountId;
        if (target.kind === 'new') {
          const created = createdFor.get(target.placeholderId);
          if (created) chosen[source] = created.ID;
        }
      }
      rememberRoutes(budgetId, chosen);

      // Process transactions (excluding any rows the user marked as skipped
      // in the configure step). The planner decides — using the exact same
      // logic the preview displayed — which rows produce a transaction and
      // which are skipped because their amount is missing or unparseable, so
      // the import can no longer silently disagree with the preview.
      const totalRows = fresh.length;
      const failures: { index: number; message: string }[] = [];
      const matchedIds = new Map<number, number>();
      // The run record is saved in batches (every CHECKPOINT_ROWS rows or
      // CHECKPOINT_MS) and each save carries only the transactions added since
      // the previous one; recordImportRun merges them into the stored list.
      // Saving the whole list after every row made a 20k-row import send
      // ~1.6 GB through sync and spend ~17 ms per row in the undo journal.
      let checkpointedIds = 0;
      let lastCheckpointAt = Date.now();
      const checkpoint = async (complete = false) => {
        const newIds = importedTransactionIds.slice(checkpointedIds);
        await recordImportRunMutation.mutateAsync({
          budgetId,
          input: {
            runKey: runKey.current,
            budgetId,
            sourceType: parsedData.source.type,
            sourceName: parsedData.source.fileName,
            summary: {
              transactionsImported: importedTransactionIds.length,
              ...(mirrorTransactions ? { mirrorTransactions } : {}),
              ...(transactionsMatched ? { transactionsMatched } : {}),
              accountsCreated: createdAccountIds.length,
              categoriesCreated: createdCategoryIds.length,
              duplicatesSkipped,
              userSkipped,
              invalidRows,
              failedRows: failures.length,
              failures,
            },
            transactionIds: newIds,
            accountIds: createdAccountIds,
            categoryIds: createdCategoryIds,
            status: !complete
              ? 'in_progress'
              : failures.length
                ? 'completed_with_warnings'
                : 'completed',
          },
        });
        checkpointedIds += newIds.length;
        lastCheckpointAt = Date.now();
      };
      const checkpointIfDue = async () => {
        if (
          importedTransactionIds.length - checkpointedIds >= CHECKPOINT_ROWS ||
          Date.now() - lastCheckpointAt >= CHECKPOINT_MS
        ) {
          await checkpoint();
        }
      };
      await checkpoint();
      let processedCount = 0;
      let successCount = 0;

      // incomeId and uncategorizedId are guaranteed to be set by the
      // initialization block above.
      const resolvedIncomeId = incomeId ?? 0;
      const resolvedUncategorizedId = uncategorizedId ?? 0;

      const rowByIndex = new Map(fresh.map((r) => [r.input.index, r]));
      // Rows created together with their pair's first side.
      const transferDone = new Set<number>();
      for (const reviewed of inDateOrder(fresh)) {
        const plan = reviewed.input;
        const row = reviewed.original;
        if (transferDone.has(plan.index)) {
          processedCount++;
          continue;
        }
        try {
          setProgress({
            step: 'Importing transactions...',
            progress: 25 + (processedCount / totalRows) * 70,
            currentItem: `${processedCount + 1}/${totalRows}`,
            isComplete: false,
          });

          if (!plan.valid) {
            // Missing or unparseable amount — already surfaced in the preview.
            processedCount++;
            continue;
          }

          const matchId = matchCandidate(reviewed);
          if (matchId !== undefined) {
            await applyMatch(reviewed, realAccountId(plan.accountId), matchId);
            matchedIds.set(plan.index, matchId);
            processedCount++;
            continue;
          }

          if (reviewed.decision === 'skip') {
            const candidate =
              reviewed.duplicate.candidates[0]?.id ??
              (reviewed.duplicate.sameFileIndex !== undefined
                ? matchedIds.get(reviewed.duplicate.sameFileIndex)
                : undefined);
            if (candidate !== undefined && reviewed.duplicate.status !== 'already-imported') {
              // Part of the import's undo entry: undoing the import forgets the match too.
              await executeSpaceMutation(runtime, {
                op: 'importHistory.match',
                payload: {
                  budgetId,
                  accountId: realAccountId(plan.accountId),
                  transactionId: candidate,
                  identity: withRealAccount(plan),
                },
              });
            }
            if (candidate !== undefined) matchedIds.set(plan.index, candidate);
            processedCount++;
            continue;
          }

          const transfer = transferOf(reviewed);
          if (transfer) {
            const partner =
              transfer.partnerIndex !== undefined
                ? rowByIndex.get(transfer.partnerIndex)
                : undefined;
            if (partner) transferDone.add(partner.input.index);
            const leg = (input: DuplicateInput) => ({
              inflow: input.inflow,
              outflow: input.outflow,
              accountId: realAccountId(input.accountId),
              categoryId: 0,
              date: input.date,
              memo: input.memo.substring(0, 255),
              payee: input.payee,
              importIdentities: [withRealAccount(input)],
              cleared: true,
            });
            const own = leg(plan);
            // Only this side is in the file: the other account gets the mirror leg.
            const other = partner
              ? leg(partner.input)
              : {
                  inflow: plan.outflow,
                  outflow: plan.inflow,
                  accountId: realAccountId(transfer.counterpartAccountId),
                  categoryId: 0,
                  date: plan.date,
                  memo: plan.memo.substring(0, 255),
                  payee: plan.payee,
                };
            const outgoing = plan.outflow > plan.inflow;
            const { sourceId, destinationId } = await executeSpaceMutation<{
              sourceId: number;
              destinationId: number;
            }>(runtime, {
              op: 'transactions.addTransfer',
              payload: {
                budgetId,
                transferId: `import_${runKey.current}_${plan.index}`,
                source: outgoing ? own : other,
                destination: outgoing ? other : own,
              },
              meta: { label: t`Import transaction`, skipInvalidate: true },
            });
            const [ownId, otherId] = outgoing
              ? [sourceId, destinationId]
              : [destinationId, sourceId];
            matchedIds.set(plan.index, ownId);
            // Both legs belong to the run, so undoing it from Import history
            // removes the whole transfer (and an account the import created).
            importedTransactionIds.push(ownId, otherId);
            successCount++;
            if (partner) {
              matchedIds.set(partner.input.index, otherId);
              successCount++;
            } else mirrorTransactions++;
            processedCount++;
            await checkpointIfDue();
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

          const { transactionId } = await executeSpaceMutation<{
            transactionId: number;
            created: boolean;
          }>(runtime, {
            op: 'transactions.import',
            payload: {
              inflow: plan.inflow,
              outflow: plan.outflow,
              accountId: realAccountId(plan.accountId),
              categoryId,
              budgetId,
              date: plan.date,
              memo: plan.memo.substring(0, 255),
              payee: plan.payee,
              transferId: '',
              importIdentities: [withRealAccount(plan)],
            },
            meta: { label: t`Import transaction`, skipInvalidate: true },
          });
          matchedIds.set(plan.index, transactionId);

          importedTransactionIds.push(transactionId);
          successCount++;
        } catch (rowError) {
          if (reviewed.decision === 'skip' && reviewed.duplicate.status !== 'new')
            duplicatesSkipped--;
          const message = getErrorMessage(rowError, t`Failed to import row`);
          failures.push({ index: plan.index, message });
          // Its pair's other side was to be created with it: it failed too.
          const partnerIndex = transferOf(reviewed)?.partnerIndex;
          if (partnerIndex !== undefined) failures.push({ index: partnerIndex, message });
        }

        processedCount++;
        // A history-write error stops the run; it must not relabel a committed row as failed.
        await checkpointIfDue();
      }

      const skippedCount = totalRows - successCount - transactionsMatched;

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
        ...(transactionsMatched ? { transactionsMatched } : {}),
        duplicatesSkipped,
        userSkipped,
        invalidRows,
        failedRows: failures.length,
        failures,
        accountsCreated: createdAccountIds.length,
        categoriesCreated: createdCategoryIds.length,
        destinationAccountName,
      });

      trackImportedCsvPdf();
      importRun.ok(successCount);

      await checkpoint(true);

      if (budgets) {
        const newBudget = budgets.find((b) => b.ID === budgetId);
        if (newBudget) {
          setSelectedBudget(newBudget);
        }
      }

      // Space queries are keyed [root, spaceKey, ...], so refresh whole roots:
      // the account header and register read accounts/accountTransaction*.
      applyOpInvalidations(queryClient, 'transactions.import');
      applyOpInvalidations(queryClient, 'importHistory.match');
      invalidateRoots(queryClient, 'budgets', 'categories');

      setCurrentStep('complete');
    } catch (err) {
      importRun.error(err);
      console.error('Import error:', err);
      setError(getErrorMessage(err, t`Import failed`));
      setCurrentStep('configure');
    } finally {
      useUndoStore.getState().endGroup();
      setIsImporting(false);
      importLock.current = false;
    }
  }, [
    t,
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
    newAccountCurrency,
    buildPreview,
    previewData,
    resolveCategoryId,
    runtime,
    recordImportRunMutation,
    setSelectedBudget,
    queryClient,
  ]);

  return {
    budgetId: selectedBudget?.ID ?? 0,
    newAccountCurrency,
    currentStep,
    setCurrentStep,

    parsedData,
    columnMapping,
    setColumnMapping,
    importConfig,
    setImportConfig,
    previewData,
    setRowDecision,
    resolveAll,
    isChecking: isChecking || isImporting,
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
