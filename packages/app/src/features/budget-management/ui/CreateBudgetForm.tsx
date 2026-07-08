'use client';

import React, { useEffect, useState, useRef, ChangeEvent } from 'react';
import { useSwipeable } from 'react-swipeable';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui/tabs';
import { useAddBudget } from '@entities/budget/api/useBudgets';
import { useUiStore } from '@shared/store/useUiStore';
import { useQueryClient } from '@tanstack/react-query';
import { Upload, Plus, HardDrive } from 'lucide-react';
import { useRuntime } from '@shared/runtime/runtime-provider';
import type { YNABImportConfig, DatabaseAdapter } from '@budgero/core/browser';
import { YNABImportService } from '@budgero/core/browser';
import { useUpdateOnboarding } from '@entities/user/api/useAuth';
import { getBudgetsQueryKey, syncBudgetStateFromRuntime } from '@shared/runtime/budget-gate';
import { trackBudgetCreated, trackImportedFromYnab } from '@shared/lib/analytics/analytics';
import { getErrorMessage } from '@shared/lib/errors';
import { notifyUpdateRequired } from '@shared/lib/update-required';
import { ManualBudgetTab } from '@features/budget-management/ui/create-budget-form/ManualBudgetTab';
import { RestoreBackupTab } from '@features/budget-management/ui/create-budget-form/RestoreBackupTab';
import { YnabImportTab } from '@features/budget-management/ui/create-budget-form/YnabImportTab';

interface CreateBudgetFormProps {
  onCreated?: (budgetId: number) => void;
  onModeChange?: (mode: 'manual' | 'core' | 'import') => void;
  defaultTab?: 'manual' | 'core' | 'import';
}

const CreateBudgetForm: React.FC<CreateBudgetFormProps> = ({
  onCreated,
  onModeChange,
  defaultTab,
}) => {
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Budgero backup import state
  const [coreFile, setCoreFile] = useState<File | null>(null);
  const [isCoreImporting, setIsCoreImporting] = useState<boolean>(false);
  const [coreStatus, setCoreStatus] = useState<string | null>(null);
  const coreFileInputRef = useRef<HTMLInputElement>(null);

  const addBudgetMutation = useAddBudget();
  const runtime = useRuntime();
  const { mutateAsync: updateOnboardingAsync } = useUpdateOnboarding();

  const resetForm = () => {
    setName('');
    setBudgetName('');
    setFile(null);
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
        toast.success(`Budget "${name}" created successfully!`);
      }
    } catch (err: unknown) {
      const errorMessage = getErrorMessage(err, 'Failed to create budget');
      toast.error(errorMessage);
    }
  };

  // YNAB import
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleImport = async () => {
    if (!file || !budgetName.trim()) {
      toast.error('Please provide a budget name and select a file');
      return;
    }

    setIsImporting(true);

    try {
      const dbAdapter = runtime.getDatabase();

      if (!dbAdapter) {
        toast.error('Database not initialized');
        return;
      }

      const importService = new YNABImportService(dbAdapter as unknown as DatabaseAdapter);

      const arrayBuffer = await file.arrayBuffer();

      const config: YNABImportConfig = {
        budgetName: budgetName.trim(),
        currency,
        numberFormat,
        badgeIcon: importBadgeIcon,
      };

      const budgetId = await importService.importYNABFromZip(arrayBuffer, config);
      trackBudgetCreated();
      trackImportedFromYnab();

      const db = runtime.getDatabase();

      if (db && typeof db.saveToOPFSPublic === 'function') {
        await db.saveToOPFSPublic();
      }

      try {
        await runtime.finalizeOutOfBandMutation({ uploadSnapshot: true });
      } catch (uploadError) {
        console.error('Failed to finalize out-of-band import sync:', uploadError);
        // Don't fail the import if upload fails - data is saved locally
      }

      const activeSpaceId = runtime.getActiveSpaceId();
      if (activeSpaceId) {
        syncBudgetStateFromRuntime({
          runtime,
          queryClient,
          spaceId: activeSpaceId,
          preferredBudgetId: budgetId,
        });
        await queryClient.invalidateQueries({ queryKey: getBudgetsQueryKey(activeSpaceId) });
      }

      await queryClient.invalidateQueries({ queryKey: ['categories'] });
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['assignments'] });
      await queryClient.invalidateQueries({ queryKey: ['monthly-budgets'] });

      if (onCreated) {
        onCreated(budgetId);
        resetForm();
      } else {
        toast.success(`Successfully imported YNAB budget "${budgetName}"!`);
        setFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }

      try {
        await updateOnboardingAsync({ status: 'completed', snoozed_until: null });
      } catch (err) {
        console.warn('[CreateBudgetForm] Failed to mark onboarding complete after import', err);
      }
    } catch (err) {
      console.error('Import failed:', err);
      toast.error(getErrorMessage(err, 'Import failed. Please check your file and try again.'));
    } finally {
      setIsImporting(false);
    }
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
      toast.error('Select the Budgero backup file you want to restore.');
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
      toast.success('Budgero backup imported successfully.');
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
          'Failed to import Budgero backup. Please verify the file and try again.'
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

  const swipeTabs = useSwipeable({
    onSwipedLeft: () => {
      const currentIndex = tabOrder.indexOf(tab);
      if (currentIndex < tabOrder.length - 1) {
        setTab(tabOrder[currentIndex + 1]);
        if (navigator.vibrate) navigator.vibrate(8);
      }
    },
    onSwipedRight: () => {
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

  return (
    <div className="space-y-3 sm:space-y-4 text-sm sm:text-base max-h-[min(92vh,calc(100dvh-2rem))] overflow-y-auto sm:max-h-none sm:overflow-visible px-1 sm:px-0">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as 'manual' | 'core' | 'import')}
        className="w-full"
        {...(enableSwipe ? swipeTabs : {})}
        style={enableSwipe ? { touchAction: 'pan-y' } : undefined}
      >
        <TabsList className="grid w-full grid-cols-3 h-auto">
          <TabsTrigger
            value="manual"
            className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2 py-1 px-2 sm:px-3 text-[11px] sm:text-xs"
          >
            <Plus className="h-3 w-3" />
            <span className="text-[11px] sm:text-xs">New</span>
          </TabsTrigger>
          <TabsTrigger
            value="core"
            className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2 py-1 px-2 sm:px-3 text-[11px] sm:text-xs"
          >
            <HardDrive className="h-3 w-3" />
            <span className="text-[11px] sm:text-xs">Backup</span>
          </TabsTrigger>
          <TabsTrigger
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
          <YnabImportTab
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
            isImporting={isImporting}
            onReset={resetForm}
            onImport={handleImport}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default CreateBudgetForm;
