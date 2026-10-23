'use client';

import { plural } from '@lingui/core/macro';

import { Trans, useLingui } from '@lingui/react/macro';

import React, { useEffect, useState, useRef, ChangeEvent } from 'react';
import { useSwipeable } from 'react-swipeable';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui/tabs';
import { useAddBudget } from '@entities/budget/api/useBudgets';
import { useUiStore } from '@shared/store/useUiStore';
import { useQueryClient } from '@tanstack/react-query';
import { Upload, Plus, HardDrive } from 'lucide-react';
import { useRuntime } from '@shared/runtime/runtime-provider';
import type {
  YNABApiPlanSnapshot,
  YNABApiPlanSummary,
  YNABImportConfig,
  YNABImportProgressUpdate,
  YNABImportPreview,
  YNABImportResult,
  DatabaseAdapter,
} from '@budgero/core/browser';
import { YNABApiClient, YNABImportService } from '@budgero/core/browser';
import { useUpdateOnboarding } from '@entities/user/api/useAuth';
import { getBudgetsQueryKey, syncBudgetStateFromRuntime } from '@shared/runtime/budget-gate';
import { trackBudgetCreated, trackImportedFromYnab } from '@shared/lib/analytics/analytics';
import { startImportRun, type ImportRun } from '@shared/lib/analytics/import-tracking';
import { getErrorMessage } from '@shared/lib/errors';
import { notifyUpdateRequired } from '@shared/lib/update-required';
import { ManualBudgetTab } from '@features/budget-management/ui/create-budget-form/ManualBudgetTab';
import { RestoreBackupTab } from '@features/budget-management/ui/create-budget-form/RestoreBackupTab';
import { YnabImportTab } from '@features/budget-management/ui/create-budget-form/YnabImportTab';
import {
  hasCompleteCreditPaymentMappings,
  type CreditPaymentMappings,
} from '@features/budget-management/ui/create-budget-form/ynab-credit-payment-matching';
import { YnabImportStatus } from '@features/budget-management/ui/create-budget-form/YnabImportStatus';
import {
  holdUploadsForImport,
  type ImportUploadGuard,
} from '@features/budget-management/model/import-upload-guard';

interface CreateBudgetFormProps {
  onCreated?: (budgetId: number) => void;
  onModeChange?: (mode: 'manual' | 'core' | 'import') => void;
  /** True while the YNAB verification report (a wide table) is showing. */
  onWideLayoutChange?: (wide: boolean) => void;
  defaultTab?: 'manual' | 'core' | 'import';
}

/**
 * Let React commit a progress update and the browser paint it before the next
 * synchronous sql.js import batch starts. A timeout fallback also keeps imports
 * moving in background tabs where animation frames may be throttled.
 */
function yieldAfterPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (
      typeof document === 'undefined' ||
      document.visibilityState !== 'visible' ||
      typeof requestAnimationFrame !== 'function'
    ) {
      setTimeout(resolve, 0);
      return;
    }

    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

const CreateBudgetForm: React.FC<CreateBudgetFormProps> = ({
  onCreated,
  onModeChange,
  onWideLayoutChange,
  defaultTab,
}) => {
  const { t } = useLingui();

  // Common state
  const { setIsBudgetImporting } = useUiStore();
  const queryClient = useQueryClient();

  // Manual creation state
  const [name, setName] = useState('');
  const [displayCurrency, setDisplayCurrency] = useState('USD');
  const [badgeIcon, setBadgeIcon] = useState('');
  const [selectedFormat, setSelectedFormat] = useState<string>('$1,096.56');
  const [createDefaultCategories, setCreateDefaultCategories] = useState(true);

  // YNAB import state
  const [budgetName, setBudgetName] = useState<string>('');
  const [currency, setCurrency] = useState('USD');
  const [numberFormat, setNumberFormat] = useState<string>('1.096,56 $');
  const [importBadgeIcon, setImportBadgeIcon] = useState<string>('💰');
  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [isInspectingYnab, setIsInspectingYnab] = useState(false);
  const [ynabPreview, setYnabPreview] = useState<YNABImportPreview | null>(null);
  const [ynabCreditPaymentMappings, setYnabCreditPaymentMappings] =
    useState<CreditPaymentMappings>();
  const ynabSourceRequestRef = useRef(0);
  const [ynabDateOrder, setYnabDateOrder] = useState<YNABImportConfig['dateOrder']>();
  const [ynabSourceMode, setYnabSourceMode] = useState<'api' | 'zip'>('api');
  const [ynabPersonalAccessToken, setYnabPersonalAccessToken] = useState('');
  const [ynabPlans, setYnabPlans] = useState<YNABApiPlanSummary[]>([]);
  const [selectedYnabPlanId, setSelectedYnabPlanId] = useState('');
  const [ynabApiSnapshot, setYnabApiSnapshot] = useState<YNABApiPlanSnapshot | null>(null);
  const [isConnectingYnab, setIsConnectingYnab] = useState(false);
  const [ynabImportView, setYnabImportView] = useState<'form' | 'status'>('form');
  const [ynabImportUpdates, setYnabImportUpdates] = useState<YNABImportProgressUpdate[]>([]);
  const [ynabImportError, setYnabImportError] = useState<string | null>(null);
  const [ynabImportResult, setYnabImportResult] = useState<YNABImportResult | null>(null);
  const [isFinalizingYnab, setIsFinalizingYnab] = useState(false);
  const pendingYnabBudgetIdRef = useRef<number | null>(null);
  const ynabImportRunRef = useRef<{
    cancelled: boolean;
    saving: boolean;
    /** The importer is still writing (it rolls itself back on failure). */
    importing: boolean;
    deleteBudget: (budgetId: number) => void;
    /** Holds snapshot uploads until the import is accepted or removed. */
    uploads: ImportUploadGuard;
    analytics: ImportRun;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Budgero backup import state
  const [coreFile, setCoreFile] = useState<File | null>(null);
  const [isCoreImporting, setIsCoreImporting] = useState<boolean>(false);
  const [coreStatus, setCoreStatus] = useState<string | null>(null);
  const coreFileInputRef = useRef<HTMLInputElement>(null);

  const addBudgetMutation = useAddBudget();
  const runtime = useRuntime();
  const { mutateAsync: updateOnboardingAsync } = useUpdateOnboarding();

  useEffect(
    () => () => {
      ynabSourceRequestRef.current += 1;
      const run = ynabImportRunRef.current;
      if (run) run.cancelled = true;
      if (run && !run.saving) run.analytics.cancelled();
      // Once saving starts, finalization owns the accepted budget. Publishing
      // its state can itself unmount this form during first-budget onboarding.
      if (run?.saving) return;
      const pendingBudgetId = pendingYnabBudgetIdRef.current;
      if (pendingBudgetId === null) {
        // A running import notices the cancel and rolls itself back first.
        if (run && !run.importing) run.uploads.rollBack();
        return;
      }
      try {
        run?.deleteBudget(pendingBudgetId);
        run?.uploads.rollBack();
      } catch (error) {
        console.warn('[CreateBudgetForm] Failed to remove an unaccepted YNAB import', error);
      }
      pendingYnabBudgetIdRef.current = null;
    },
    [runtime]
  );

  const resetForm = () => {
    ynabSourceRequestRef.current += 1;
    setIsConnectingYnab(false);
    setIsInspectingYnab(false);
    setName('');
    setBudgetName('');
    setFile(null);
    setYnabPreview(null);
    setYnabCreditPaymentMappings(undefined);
    setYnabDateOrder(undefined);
    setYnabPersonalAccessToken('');
    setYnabPlans([]);
    setSelectedYnabPlanId('');
    setYnabApiSnapshot(null);
    setYnabImportView('form');
    setYnabImportUpdates([]);
    setYnabImportError(null);
    setYnabImportResult(null);
    setCoreFile(null);
    setCoreStatus(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (coreFileInputRef.current) {
      coreFileInputRef.current.value = '';
    }
  };

  // Manual budget creation
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const budgetId = await addBudgetMutation.mutateAsync({
        name,
        displayCurrency,
        badgeIcon,
        number_format: selectedFormat,
        create_default_categories: createDefaultCategories,
      });
      trackBudgetCreated();
      if (onCreated) {
        onCreated(budgetId);
        resetForm();
      } else {
        toast.success(t`Budget "${name}" created successfully!`);
      }
    } catch (err: unknown) {
      const errorMessage = getErrorMessage(err, t`Failed to create budget`);
      toast.error(errorMessage);
    }
  };

  // YNAB import
  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    const request = ++ynabSourceRequestRef.current;
    setFile(selectedFile);
    setYnabPreview(null);
    setYnabCreditPaymentMappings(undefined);
    setYnabDateOrder(undefined);
    setIsInspectingYnab(true);

    try {
      const preview = await YNABImportService.inspectYNABZip(await selectedFile.arrayBuffer());
      if (request !== ynabSourceRequestRef.current) return;
      setYnabPreview(preview);
    } catch (error) {
      if (request !== ynabSourceRequestRef.current) return;
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      toast.error(getErrorMessage(error, t`Could not inspect this YNAB export.`));
    } finally {
      if (request === ynabSourceRequestRef.current) setIsInspectingYnab(false);
    }
  };

  const loadYnabApiPlan = async (planId: string, token = ynabPersonalAccessToken) => {
    if (!planId || !token.trim()) return;
    const request = ++ynabSourceRequestRef.current;
    setIsConnectingYnab(true);
    setYnabPreview(null);
    setYnabCreditPaymentMappings(undefined);
    setYnabApiSnapshot(null);
    try {
      const client = new YNABApiClient(token);
      const snapshot = await client.getPlan(planId);
      if (request !== ynabSourceRequestRef.current) return;
      setSelectedYnabPlanId(planId);
      setYnabApiSnapshot(snapshot);
      setYnabPreview(YNABImportService.inspectYNABApiSnapshot(snapshot));
      setBudgetName(snapshot.plan.name);
      if (snapshot.plan.currency_format) {
        setCurrency(snapshot.plan.currency_format.iso_code);
        setNumberFormat(snapshot.plan.currency_format.example_format);
      }
    } catch (error) {
      if (request !== ynabSourceRequestRef.current) return;
      toast.error(getErrorMessage(error, t`Could not read that YNAB plan.`));
    } finally {
      if (request === ynabSourceRequestRef.current) setIsConnectingYnab(false);
    }
  };

  const handleConnectYnab = async () => {
    if (!ynabPersonalAccessToken.trim()) return;
    const request = ++ynabSourceRequestRef.current;
    setIsConnectingYnab(true);
    setYnabPreview(null);
    setYnabCreditPaymentMappings(undefined);
    setYnabApiSnapshot(null);
    try {
      const client = new YNABApiClient(ynabPersonalAccessToken);
      const plans = await client.listPlans();
      if (request !== ynabSourceRequestRef.current) return;
      if (plans.length === 0) throw new Error('No YNAB plans are available for this token');
      setYnabPlans(plans);
      const planId = plans[0].id;
      const snapshot = await client.getPlan(planId);
      if (request !== ynabSourceRequestRef.current) return;
      setSelectedYnabPlanId(planId);
      setYnabApiSnapshot(snapshot);
      setYnabPreview(YNABImportService.inspectYNABApiSnapshot(snapshot));
      setBudgetName(snapshot.plan.name);
      if (snapshot.plan.currency_format) {
        setCurrency(snapshot.plan.currency_format.iso_code);
        setNumberFormat(snapshot.plan.currency_format.example_format);
      }
    } catch (error) {
      if (request !== ynabSourceRequestRef.current) return;
      setYnabPlans([]);
      setSelectedYnabPlanId('');
      toast.error(getErrorMessage(error, t`Could not connect to YNAB.`));
    } finally {
      if (request === ynabSourceRequestRef.current) setIsConnectingYnab(false);
    }
  };

  const finalizeYnabImport = async (result: YNABImportResult, acceptedWithWarnings: boolean) => {
    const activeSpaceId = runtime.getActiveSpaceId();
    if (!activeSpaceId) throw new Error('No active workspace selected');

    const run = ynabImportRunRef.current;
    if (!run || run.cancelled) return;
    setIsFinalizingYnab(true);
    setIsBudgetImporting(true);
    setYnabImportUpdates((current) => [
      ...current,
      {
        stage: 'complete',
        status: 'running',
        progress: 99,
        label: acceptedWithWarnings
          ? t`Saving imported budget with accepted warnings`
          : t`Saving imported budget`,
      },
    ]);
    try {
      await yieldAfterPaint();
      if (run.cancelled) return;
      run.saving = true;
      runtime.services().importHistory.recordImportRun({
        budgetId: result.budgetId,
        sourceType: ynabSourceMode === 'api' ? 'ynab-api' : 'ynab-zip',
        sourceName:
          ynabSourceMode === 'api'
            ? ynabApiSnapshot?.plan.name || 'YNAB API'
            : file?.name || 'YNAB export ZIP',
        summary: {
          transactionsImported: result.summary.transactionsCreated,
          accountsCreated: result.verification?.accounts.checked ?? ynabPreview?.accountCount ?? 0,
          categoriesCreated: ynabPreview?.categoryCount ?? 0,
          ...(result.verification ? { verification: result.verification } : {}),
          ...(acceptedWithWarnings ? { acceptedWithWarnings: true } : {}),
        },
        transactionIds: [],
        accountIds: [],
        categoryIds: [],
        status: acceptedWithWarnings ? 'completed_with_warnings' : 'completed',
      });

      trackBudgetCreated();
      trackImportedFromYnab();
      run.analytics.ok(result.summary.transactionsCreated);

      const db = runtime.getDatabase();
      if (db && typeof db.saveToOPFSPublic === 'function') {
        await db.saveToOPFSPublic();
      }

      // Accepted: uploads may publish the budget from here on.
      run.uploads.commit();
      try {
        await runtime.finalizeOutOfBandMutation({ uploadSnapshot: true });
      } catch (uploadError) {
        console.error('Failed to finalize out-of-band import sync:', uploadError);
        // The accepted import is already saved locally; a later sync can retry.
      }

      // Release cleanup ownership before publishing the budget. Updating the
      // startup budget gate can unmount this form immediately.
      pendingYnabBudgetIdRef.current = null;
      syncBudgetStateFromRuntime({
        runtime,
        queryClient,
        spaceId: activeSpaceId,
        preferredBudgetId: result.budgetId,
      });
      await queryClient.invalidateQueries({ queryKey: getBudgetsQueryKey(activeSpaceId) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['categories'] }),
        queryClient.invalidateQueries({ queryKey: ['accounts'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['assignments'] }),
        queryClient.invalidateQueries({ queryKey: ['monthly-budgets'] }),
        queryClient.invalidateQueries({ queryKey: ['importHistory'] }),
      ]);

      const categoryNames = result.summary.missingCategoriesCreated.map(
        (category) => `${category.categoryGroup} › ${category.category}`
      );
      const summaryParts: string[] = [];
      if (categoryNames.length > 0) {
        summaryParts.push(
          plural(categoryNames.length, {
            one: `Created # historical category referenced by transactions: ${categoryNames.join(', ')}.`,
            other: `Created # historical categories referenced by transactions: ${categoryNames.join(', ')}.`,
          })
        );
      }
      if (result.summary.splitTransactionsImported > 0) {
        summaryParts.push(
          plural(result.summary.splitTransactionsImported, {
            one: `Imported # split transaction.`,
            other: `Imported # split transactions.`,
          })
        );
      }
      if (result.summary.accountBalancesVerified !== undefined) {
        summaryParts.push(
          plural(result.summary.accountBalancesVerified, {
            one: `Verified # account balance against YNAB.`,
            other: `Verified # account balances against YNAB.`,
          })
        );
      } else {
        summaryParts.push(t`Review imported account types before budgeting.`);
      }
      if (result.summary.readyToAssignMonthsVerified !== undefined) {
        summaryParts.push(
          plural(result.summary.readyToAssignMonthsVerified, {
            one: `Matched Ready to Assign for # month.`,
            other: `Matched Ready to Assign for # months.`,
          })
        );
      }
      if ((result.summary.debtBalanceAdjustmentsCreated ?? 0) > 0) {
        summaryParts.push(
          plural(result.summary.debtBalanceAdjustmentsCreated ?? 0, {
            one: `Created # visible YNAB debt interest adjustment.`,
            other: `Created # visible YNAB debt interest adjustments.`,
          })
        );
      }

      try {
        await updateOnboardingAsync({ status: 'completed', snoozed_until: null });
      } catch (error) {
        console.warn('[CreateBudgetForm] Failed to mark onboarding complete after import', error);
      }

      setYnabImportUpdates((current) => [
        ...current,
        {
          stage: 'complete',
          status: 'passed',
          progress: 100,
          label: acceptedWithWarnings
            ? t`Imported budget saved with warnings`
            : t`Imported budget saved`,
          detail: summaryParts.join(' ') || undefined,
        },
      ]);
      setYnabImportResult(result);
    } finally {
      run.saving = false;
      if (run.cancelled && pendingYnabBudgetIdRef.current !== null) {
        run.deleteBudget(pendingYnabBudgetIdRef.current);
        run.uploads.rollBack();
        pendingYnabBudgetIdRef.current = null;
      }
      setIsFinalizingYnab(false);
      setIsBudgetImporting(false);
    }
  };

  const handleImport = async () => {
    const hasSource = ynabSourceMode === 'api' ? Boolean(ynabApiSnapshot) : Boolean(file);
    if (!hasSource || !budgetName.trim()) {
      toast.error(
        ynabSourceMode === 'api'
          ? t`Please connect to YNAB, select a plan, and provide a budget name`
          : t`Please provide a budget name and select a file`
      );
      return;
    }

    if (ynabSourceMode === 'zip' && ynabPreview?.dateOrderAmbiguous && !ynabDateOrder) {
      toast.error('Select the date format used in your YNAB export.');
      return;
    }
    if (
      ynabSourceMode === 'api' &&
      !hasCompleteCreditPaymentMappings(
        ynabPreview?.creditPaymentMatching,
        ynabCreditPaymentMappings
      )
    ) {
      toast.error(t`Match each credit card to its payment category before importing.`);
      return;
    }
    if (ynabImportRunRef.current?.saving || isImporting) return;
    const budgetService = runtime.services().budgets;
    const deleteBudget = (budgetId: number) => budgetService.deleteBudget(budgetId);
    const run = {
      cancelled: false,
      saving: false,
      importing: true,
      deleteBudget,
      // From the first write until accepted or removed, nothing of this
      // import may reach the server (a timer/hide upload would publish it).
      uploads: holdUploadsForImport(runtime, deleteBudget),
      analytics: startImportRun(ynabSourceMode === 'api' ? 'ynab_api' : 'ynab_zip', 'app'),
    };
    ynabImportRunRef.current = run;
    setIsImporting(true);
    setIsBudgetImporting(true);
    setYnabImportView('status');
    setYnabImportUpdates([]);
    setYnabImportError(null);
    setYnabImportResult(null);

    try {
      const dbAdapter = runtime.getDatabase();

      if (!dbAdapter) {
        throw new Error('Database not initialized');
      }

      const importService = new YNABImportService(dbAdapter as unknown as DatabaseAdapter);
      const activeSpaceId = runtime.getActiveSpaceId();
      if (!activeSpaceId) {
        throw new Error('No active workspace selected');
      }

      const config: YNABImportConfig = {
        spaceId: activeSpaceId,
        budgetName: budgetName.trim(),
        currency,
        numberFormat,
        badgeIcon: importBadgeIcon,
        // numberFormat is the Budgero display format, not the export's;
        // auto-detect amounts in the CSV.
        ...(ynabSourceMode === 'zip' ? { sourceNumberFormat: '' } : {}),
        ...(ynabSourceMode === 'zip' && ynabDateOrder ? { dateOrder: ynabDateOrder } : {}),
        ...(ynabSourceMode === 'api' &&
        ynabPreview?.creditPaymentMatching &&
        ynabCreditPaymentMappings
          ? { creditPaymentMappings: ynabCreditPaymentMappings }
          : {}),
        onBudgetCreated: (budgetId) => run.uploads.trackBudget(budgetId, budgetName.trim()),
        onProgress: async (update) => {
          if (run.cancelled) throw new Error('YNAB import cancelled');
          setYnabImportUpdates((current) => [...current, update]);
          await yieldAfterPaint();
          // Throwing at a progress boundary lets the importer roll back its
          // own database if navigation unmounted the form during a batch.
          if (run.cancelled) throw new Error('YNAB import cancelled');
        },
      };

      const result =
        ynabSourceMode === 'api' && ynabApiSnapshot
          ? await importService.importYNABFromApiSnapshotWithSummary(ynabApiSnapshot, config)
          : await importService.importYNABFromZipWithSummary(
              await (file as File).arrayBuffer(),
              config
            );
      run.importing = false;
      if (run.cancelled) {
        run.analytics.cancelled();
        run.deleteBudget(result.budgetId);
        run.uploads.rollBack();
        return;
      }
      pendingYnabBudgetIdRef.current = result.budgetId;
      setYnabImportResult(result);
      if (result.verification?.status === 'warning') {
        setYnabImportUpdates((current) => [
          ...current,
          {
            stage: 'complete',
            status: 'warning',
            progress: 99,
            label: t`Waiting for your review`,
            detail: 'The imported budget has not been saved or synced yet.',
          },
        ]);
        return;
      }

      await finalizeYnabImport(result, false);
    } catch (err) {
      run.importing = false;
      // The importer removed its budget; make sure, then let uploads resume.
      if (pendingYnabBudgetIdRef.current === null) run.uploads.rollBack();
      if (run.cancelled) {
        run.analytics.cancelled();
        return;
      }
      run.analytics.error(err);
      console.error('Import failed:', err);
      setYnabImportError(
        getErrorMessage(err, t`Import failed. Please check your source and try again.`)
      );
    } finally {
      setIsImporting(false);
      setIsBudgetImporting(false);
    }
  };

  const handleContinueYnabImport = () => {
    if (!ynabImportResult) return;
    const { budgetId } = ynabImportResult;
    if (onCreated) {
      onCreated(budgetId);
    } else {
      toast.success(t`Successfully imported YNAB budget "${budgetName}"!`);
    }
    resetForm();
  };

  const discardPendingYnabImport = async () => {
    const pendingBudgetId = pendingYnabBudgetIdRef.current;
    if (pendingBudgetId !== null) {
      ynabImportRunRef.current?.deleteBudget(pendingBudgetId);
      pendingYnabBudgetIdRef.current = null;
    }
    ynabImportRunRef.current?.uploads.rollBack();
    ynabImportRunRef.current?.analytics.cancelled();
    setYnabImportView('form');
    setYnabImportUpdates([]);
    setYnabImportError(null);
    setYnabImportResult(null);
  };

  const handleAcceptYnabWarnings = async () => {
    if (!ynabImportResult || ynabImportResult.verification?.status !== 'warning') return;
    setYnabImportError(null);
    try {
      await finalizeYnabImport(ynabImportResult, true);
    } catch (error) {
      console.error('Failed to save accepted YNAB import:', error);
      setYnabImportError(
        getErrorMessage(error, t`Could not save the accepted import. You can cancel it safely.`)
      );
    }
  };

  const handleBackFromYnabImport = () => {
    void discardPendingYnabImport();
  };

  // Budgero backup import
  const handleCoreFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setCoreFile(e.target.files[0]);
      setCoreStatus(null);
    }
  };

  const resetCoreImport = () => {
    setCoreFile(null);
    setCoreStatus(null);
    if (coreFileInputRef.current) {
      coreFileInputRef.current.value = '';
    }
  };

  const handleCoreImport = async () => {
    if (!coreFile) {
      toast.error(t`Select the Budgero backup file you want to restore.`);
      return;
    }

    setIsCoreImporting(true);
    setIsBudgetImporting(true);
    setCoreStatus('Restoring Budgero backup…');

    try {
      const arrayBuffer = await coreFile.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);
      const db = runtime.getDatabase();
      if (!db) {
        throw new Error('Database not initialized');
      }

      // Hot swap the database, then bring an older backup up to the current
      // schema — including the float → integer-milliunit money migration
      // (raw restore would leave stale float amounts that fail validation).
      if (!db.restoreAndMigrate) {
        throw new Error('This build cannot migrate restored backups');
      }
      await db.restoreAndMigrate(data);
      await queryClient.invalidateQueries();
      const activeSpaceId = runtime.getActiveSpaceId();
      if (activeSpaceId) {
        syncBudgetStateFromRuntime({
          runtime,
          queryClient,
          spaceId: activeSpaceId,
        });
      }

      try {
        await runtime.finalizeOutOfBandMutation({ uploadSnapshot: true });
      } catch (saveError) {
        console.warn('[CreateBudgetForm] Failed to finalize sync after Core restore', saveError);
      }

      try {
        await updateOnboardingAsync({ status: 'completed', snoozed_until: null });
      } catch (err) {
        console.warn(
          '[CreateBudgetForm] Failed to mark onboarding complete after Core restore',
          err
        );
      }

      setCoreStatus('Import complete. Loading your budgets…');
      toast.success(t`Budgero backup imported successfully.`);
      setCoreFile(null);
      if (coreFileInputRef.current) {
        coreFileInputRef.current.value = '';
      }
    } catch (err) {
      console.error('Budgero backup import error:', err);
      setCoreStatus(null);
      // Backup file from a newer app version — its schema is ahead of this
      // build; prompt for an update instead of a generic failure.
      if ((err as { code?: string })?.code === 'DB_NEWER_THAN_APP') {
        notifyUpdateRequired('restore-newer-than-app');
      }
      toast.error(
        getErrorMessage(
          err,
          t`Failed to import Budgero backup. Please verify the file and try again.`
        )
      );
    } finally {
      setIsCoreImporting(false);
      setIsBudgetImporting(false);
    }
  };

  // Swipe between tabs on mobile
  const [tab, setTab] = useState<'manual' | 'core' | 'import'>(defaultTab ?? 'manual');
  const [enableSwipe, setEnableSwipe] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(hover: none) and (pointer: coarse)');
    const update = () => setEnableSwipe(mql.matches || window.innerWidth < 768);
    update();
    mql.addEventListener?.('change', update);
    window.addEventListener('resize', update);
    return () => {
      mql.removeEventListener?.('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  const tabOrder: ('manual' | 'core' | 'import')[] = ['manual', 'core', 'import'];
  const isWritingBudget = isImporting || isFinalizingYnab || isCoreImporting;

  const swipeTabs = useSwipeable({
    onSwipedLeft: () => {
      if (isWritingBudget) return;
      const currentIndex = tabOrder.indexOf(tab);
      if (currentIndex < tabOrder.length - 1) {
        setTab(tabOrder[currentIndex + 1]);
        if (navigator.vibrate) navigator.vibrate(8);
      }
    },
    onSwipedRight: () => {
      if (isWritingBudget) return;
      const currentIndex = tabOrder.indexOf(tab);
      if (currentIndex > 0) {
        setTab(tabOrder[currentIndex - 1]);
        if (navigator.vibrate) navigator.vibrate(8);
      }
    },
    preventScrollOnSwipe: true,
    trackTouch: true,
    delta: 20,
  });

  useEffect(() => {
    if (!onModeChange) return;
    onModeChange(tab);
  }, [tab, onModeChange]);

  const isWideLayout = tab === 'import' && ynabImportView === 'status';
  useEffect(() => {
    if (!onWideLayoutChange) return;
    onWideLayoutChange(isWideLayout);
    return () => onWideLayoutChange(false);
  }, [isWideLayout, onWideLayoutChange]);

  return (
    <div className="min-w-0 space-y-3 px-1 text-sm sm:space-y-4 sm:px-0 sm:text-base">
      <Tabs
        value={tab}
        onValueChange={(v) => {
          if (!isWritingBudget) setTab(v as 'manual' | 'core' | 'import');
        }}
        className="w-full"
        {...(enableSwipe ? swipeTabs : {})}
        style={enableSwipe ? { touchAction: 'pan-y' } : undefined}
      >
        <TabsList className="grid w-full grid-cols-3 h-auto">
          <TabsTrigger
            disabled={isWritingBudget}
            value="manual"
            className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2 py-1 px-2 sm:px-3 text-[11px] sm:text-xs"
          >
            <Plus className="h-3 w-3" />
            <span className="text-[11px] sm:text-xs">
              <Trans>New</Trans>
            </span>
          </TabsTrigger>
          <TabsTrigger
            disabled={isWritingBudget}
            value="core"
            className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2 py-1 px-2 sm:px-3 text-[11px] sm:text-xs"
          >
            <HardDrive className="h-3 w-3" />
            <span className="text-[11px] sm:text-xs">
              <Trans>Backup</Trans>
            </span>
          </TabsTrigger>
          <TabsTrigger
            disabled={isWritingBudget}
            value="import"
            className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2 py-1 px-2 sm:px-3 text-[11px] sm:text-xs"
          >
            <Upload className="h-3 w-3" />
            <span className="text-[11px] sm:text-xs">YNAB</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="manual" className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
          <ManualBudgetTab
            name={name}
            onNameChange={setName}
            displayCurrency={displayCurrency}
            onDisplayCurrencyChange={setDisplayCurrency}
            badgeIcon={badgeIcon}
            onBadgeIconChange={setBadgeIcon}
            selectedFormat={selectedFormat}
            onSelectedFormatChange={setSelectedFormat}
            createDefaultCategories={createDefaultCategories}
            onCreateDefaultCategoriesChange={setCreateDefaultCategories}
            isPending={addBudgetMutation.isPending}
            onSubmit={handleManualSubmit}
          />
        </TabsContent>

        <TabsContent value="core" className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
          <RestoreBackupTab
            coreFileInputRef={coreFileInputRef}
            coreFile={coreFile}
            coreStatus={coreStatus}
            isCoreImporting={isCoreImporting}
            onFileChange={handleCoreFileChange}
            onReset={resetCoreImport}
            onImport={handleCoreImport}
          />
        </TabsContent>

        <TabsContent value="import" className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
          {ynabImportView === 'status' ? (
            <YnabImportStatus
              sourceMode={ynabSourceMode}
              updates={ynabImportUpdates}
              error={ynabImportError}
              summary={ynabImportResult?.summary ?? null}
              verification={ynabImportResult?.verification ?? null}
              currency={currency}
              isFinalizing={isFinalizingYnab}
              onBack={handleBackFromYnabImport}
              onContinue={handleContinueYnabImport}
              onAcceptWarnings={() => void handleAcceptYnabWarnings()}
              onCancelPending={() => void discardPendingYnabImport()}
            />
          ) : (
            <YnabImportTab
              sourceMode={ynabSourceMode}
              onSourceModeChange={(mode) => {
                ynabSourceRequestRef.current += 1;
                setIsConnectingYnab(false);
                setIsInspectingYnab(false);
                setYnabSourceMode(mode);
                setYnabPreview(null);
                setYnabCreditPaymentMappings(undefined);
                setYnabApiSnapshot(null);
                setYnabDateOrder(undefined);
              }}
              personalAccessToken={ynabPersonalAccessToken}
              onPersonalAccessTokenChange={(token) => {
                ynabSourceRequestRef.current += 1;
                setYnabPersonalAccessToken(token);
                setYnabPreview(null);
                setYnabApiSnapshot(null);
                setYnabCreditPaymentMappings(undefined);
                setYnabPlans([]);
                setSelectedYnabPlanId('');
                setIsConnectingYnab(false);
              }}
              plans={ynabPlans}
              selectedPlanId={selectedYnabPlanId}
              onSelectedPlanChange={(planId) => void loadYnabApiPlan(planId)}
              isConnecting={isConnectingYnab}
              onConnect={() => void handleConnectYnab()}
              budgetName={budgetName}
              onBudgetNameChange={setBudgetName}
              currency={currency}
              onCurrencyChange={setCurrency}
              numberFormat={numberFormat}
              onNumberFormatChange={setNumberFormat}
              importBadgeIcon={importBadgeIcon}
              onImportBadgeIconChange={setImportBadgeIcon}
              fileInputRef={fileInputRef}
              file={file}
              onFileChange={handleFileChange}
              preview={ynabPreview}
              dateOrder={ynabDateOrder}
              onDateOrderChange={setYnabDateOrder}
              creditPaymentMappings={ynabCreditPaymentMappings}
              onCreditPaymentMappingsChange={setYnabCreditPaymentMappings}
              isInspecting={isInspectingYnab}
              isImporting={isImporting}
              onReset={resetForm}
              onImport={handleImport}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default CreateBudgetForm;
