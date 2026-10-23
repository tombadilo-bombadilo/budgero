import { Trans, useLingui } from '@lingui/react/macro';
import { track } from '@shared/lib/analytics/track';
import { useMemo, useState } from 'react';
import { Button } from '@shared/ui/button';
import { Plus } from 'lucide-react';
import { buildCurrencyLocalizer, useUiStore } from '@shared/store/useUiStore';
import {
  useCreateRecurringTransaction,
  useDeleteRecurringTransaction,
  useMarkRecurringOccurrenceReady,
  useRecurringOccurrences,
  useRecurringTemplates,
  useSkipRecurringOccurrence,
  useUpdateRecurringTransaction,
} from '@entities/recurring/api/useRecurringTransactions';
import { useAccounts } from '@entities/account/api/useAccounts';
import { useCategories } from '@entities/category/api/useCategories';
import type { RecurringTransaction, RecurringOccurrenceWithTemplate } from '@budgero/core/browser';
import { getErrorMessage } from '@shared/lib/errors';
import { toast } from 'sonner';
import { useRecurringNotifications } from '@features/recurring/api/useRecurringNotifications';
import {
  RecurringTransactionEditor,
  type RecurringTransactionEditorProps,
  type RecurringTransactionEditorSubmit,
} from '@features/recurring/ui/RecurringTransactionEditor';
import { RecurringTemplateCard } from './components';

export function RecurringTransactionsSection() {
  const { t } = useLingui();

  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const budgetId = selectedBudget?.ID ?? 0;
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);

  const { data: templates = [], isLoading: templatesLoading } = useRecurringTemplates(
    budgetId,
    true
  );
  const { data: occurrences = [], isFetching: occurrencesFetching } = useRecurringOccurrences(
    budgetId,
    { status: 'scheduled' }
  );

  const { data: accounts = [] } = useAccounts(budgetId);
  const { data: categories = [] } = useCategories(budgetId);

  const createRecurring = useCreateRecurringTransaction();
  const updateRecurring = useUpdateRecurringTransaction();
  const deleteRecurring = useDeleteRecurringTransaction();
  const markReady = useMarkRecurringOccurrenceReady();
  const skipOccurrence = useSkipRecurringOccurrence();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editingTemplate, setEditingTemplate] = useState<RecurringTransaction | null>(null);
  const [editorInitialValues, setEditorInitialValues] =
    useState<RecurringTransactionEditorProps['initialValues']>();
  const [processingOccurrenceId, setProcessingOccurrenceId] = useState<number | null>(null);
  const [processingTemplateId, setProcessingTemplateId] = useState<number | null>(null);
  const [requestingPermission, setRequestingPermission] = useState(false);

  const { permission, requestPermission } = useRecurringNotifications({ autoCheck: false });

  const accountsById = useMemo(() => {
    const map = new Map<number, (typeof accounts)[number]>();
    for (const account of accounts) {
      map.set(account.ID, account);
    }
    return map;
  }, [accounts]);

  const accountLocalizersById = useMemo(() => {
    const map = new Map<number, { format: (value: number) => string }>();
    for (const account of accounts) {
      const localizer = buildCurrencyLocalizer(
        account.Currency,
        selectedBudget?.NumberFormat ?? ''
      );
      if (localizer) map.set(account.ID, localizer);
    }
    return map;
  }, [accounts, selectedBudget?.NumberFormat]);

  const budgetCurrency = selectedBudget?.DisplayCurrency;

  const categoriesById = useMemo(() => {
    const map = new Map<number, string>();
    for (const category of categories) {
      map.set(category.ID, category.Name);
    }
    return map;
  }, [categories]);

  const occurrencesByTemplate = useMemo(() => {
    const map = new Map<number, RecurringOccurrenceWithTemplate[]>();
    for (const occurrence of occurrences) {
      const list = map.get(occurrence.recurringTransactionId);
      if (list) list.push(occurrence);
      else map.set(occurrence.recurringTransactionId, [occurrence]);
    }
    return map;
  }, [occurrences]);

  const openCreateDialog = () => {
    setEditorMode('create');
    setEditingTemplate(null);
    setEditorInitialValues({
      direction: 'outflow',
      active: true,
      accountId: accounts.length === 1 ? accounts[0].ID : null,
      categoryId: null,
    });
    setEditorOpen(true);
  };

  const openEditDialog = (template: RecurringTransaction) => {
    setEditorMode('edit');
    setEditingTemplate(template);
    setEditorInitialValues({
      name: template.name,
      memo: template.memo ?? '',
      amount: template.amount,
      direction: template.direction,
      accountId: template.accountId,
      toAccountId: template.toAccountId ?? null,
      categoryId: template.categoryId ?? null,
      schedule: template.schedule,
      notifyDaysBefore: template.notifyDaysBefore ?? 0,
      active: template.active,
    });
    setEditorOpen(true);
  };

  const handleEditorOpenChange = (open: boolean) => {
    setEditorOpen(open);
    if (!open) {
      setEditingTemplate(null);
      setEditorInitialValues(undefined);
    }
  };

  const handleEditorSubmit = async (values: RecurringTransactionEditorSubmit) => {
    if (!budgetId) return;
    if (!values.accountId) {
      toast.error(t`Select an account`);
      return;
    }
    if (values.toAccountId != null) {
      if (values.toAccountId === values.accountId) {
        toast.error(t`Pick two different accounts for a transfer`);
        return;
      }
    } else if (!values.categoryId) {
      toast.error(t`Select a category`);
      return;
    }
    if (!values.amount || Number.isNaN(values.amount)) {
      toast.error(t`Enter a valid amount`);
      return;
    }

    try {
      if (editorMode === 'create') {
        await createRecurring.mutateAsync({
          budgetId,
          accountId: values.accountId,
          toAccountId: values.toAccountId,
          categoryId: values.categoryId,
          name: values.name,
          memo: values.memo,
          amount: values.amount,
          direction: values.direction,
          schedule: values.schedule,
          notifyDaysBefore: values.notifyDaysBefore,
          active: values.active,
        });
        toast.success(t`Recurring transaction created`, {
          description: t`We will remind you when it is almost due.`,
        });
      } else if (editingTemplate) {
        setProcessingTemplateId(editingTemplate.id);
        await updateRecurring.mutateAsync({
          id: editingTemplate.id,
          budgetId,
          patch: {
            accountId: values.accountId,
            toAccountId: values.toAccountId,
            categoryId: values.categoryId,
            name: values.name,
            memo: values.memo,
            amount: values.amount,
            direction: values.direction,
            schedule: values.schedule,
            notifyDaysBefore: values.notifyDaysBefore,
            active: values.active,
          },
        });
        toast.success(t`Recurring transaction updated`, {
          description: t`Your schedule has been refreshed.`,
        });
      }

      handleEditorOpenChange(false);
    } catch (error) {
      const message = getErrorMessage(error, t`Something went wrong.`);
      toast.error(t`Unable to save recurring transaction`, {
        description: message,
      });
    } finally {
      setProcessingTemplateId(null);
    }
  };

  const handleDelete = async (template: RecurringTransaction) => {
    try {
      setProcessingTemplateId(template.id);
      await deleteRecurring.mutateAsync({ id: template.id, budgetId: template.budgetId });
      toast.success(t`Recurring transaction removed`, {
        description: t`Future reminders for this item were cleared.`,
      });
    } catch (error) {
      const message = getErrorMessage(error, t`Something went wrong.`);
      toast.error(t`Unable to delete recurring transaction`, {
        description: message,
      });
    } finally {
      setProcessingTemplateId(null);
    }
  };

  const handleToggleActive = async (template: RecurringTransaction, nextActive: boolean) => {
    try {
      setProcessingTemplateId(template.id);
      await updateRecurring.mutateAsync({
        id: template.id,
        budgetId: template.budgetId,
        patch: { active: nextActive },
      });
      toast.success(
        nextActive ? t`Recurring transaction enabled` : t`Recurring transaction paused`,
        {
          description: nextActive
            ? t`We will resume reminding you when it is due.`
            : t`Reminders are paused until you re-enable it.`,
        }
      );
    } catch (error) {
      const message = getErrorMessage(error, t`Something went wrong.`);
      toast.error(t`Unable to update recurring transaction`, {
        description: message,
      });
    } finally {
      setProcessingTemplateId(null);
    }
  };

  const handleMarkReady = async (
    occurrence: RecurringOccurrenceWithTemplate,
    transactionDate?: string
  ) => {
    try {
      setProcessingOccurrenceId(occurrence.id);
      const result = await markReady.mutateAsync({
        occurrenceId: occurrence.id,
        transactionDate,
      });
      track('recurring_posted', { how: transactionDate ? 'post_now' : 'mark_ready' });
      const accountName = accountsById.get(result.occurrence.template.accountId)?.Name;
      toast.success(t`Transaction posted`, {
        description: accountName
          ? t`Recorded in ${accountName}. You can review it in the Transactions view.`
          : t`Recorded successfully. Review it in the Transactions view.`,
      });
    } catch (error) {
      const message = getErrorMessage(error, t`Something went wrong.`);
      toast.error(t`Unable to mark ready`, { description: message });
    } finally {
      setProcessingOccurrenceId(null);
    }
  };

  const handleSkipOccurrence = async (occurrence: RecurringOccurrenceWithTemplate) => {
    try {
      setProcessingOccurrenceId(occurrence.id);
      await skipOccurrence.mutateAsync({ id: occurrence.id });
      toast.success(t`Occurrence skipped`, {
        description: t`We will remind you again next time.`,
      });
    } catch (error) {
      const message = getErrorMessage(error, t`Something went wrong.`);
      toast.error(t`Unable to skip occurrence`, { description: message });
    } finally {
      setProcessingOccurrenceId(null);
    }
  };

  const enableNotifications = async () => {
    try {
      setRequestingPermission(true);
      const result = await requestPermission();
      if (result === 'granted') {
        toast.success(t`Notifications enabled`, {
          description: t`We will send reminders before recurring items are due.`,
        });
      } else if (result === 'denied') {
        toast.error(t`Notifications blocked`, {
          description: t`You can enable notifications later from your browser or system settings.`,
        });
      }
    } catch (error) {
      const message = getErrorMessage(error, t`Unable to request notifications.`);
      toast.error(t`Notification request failed`, { description: message });
    } finally {
      setRequestingPermission(false);
    }
  };

  const renderTemplates = () => {
    if (templatesLoading) {
      return <SkeletonRows count={2} />;
    }

    if (!templates.length) {
      return (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            <Trans>
              Set up recurring paycheques, bills, or transfers and Budgero will remind you when they
              are due.
            </Trans>
          </p>
          <Button onClick={openCreateDialog} variant="outline" size="sm" className="shrink-0">
            <Trans>
              <Plus className="mr-1 h-4 w-4" />
              Add Recurring Transaction
            </Trans>
          </Button>
        </div>
      );
    }

    return (
      <div className="divide-y overflow-hidden rounded-lg border bg-card">
        {templates.map((template) => (
          <RecurringTemplateCard
            key={template.id}
            template={template}
            accountName={accountsById.get(template.accountId)?.Name ?? 'Unknown account'}
            accountCurrency={accountsById.get(template.accountId)?.Currency}
            toAccountName={
              template.toAccountId != null
                ? accountsById.get(template.toAccountId)?.Name
                : undefined
            }
            categoryName={
              template.categoryId ? categoriesById.get(template.categoryId) : 'Unassigned category'
            }
            occurrences={occurrencesByTemplate.get(template.id) ?? EMPTY_OCCURRENCES}
            accountLocalizer={accountLocalizersById.get(template.accountId) ?? globalLocalizer}
            budgetAmount={occurrencesByTemplate.get(template.id)?.[0]?.template.budgetAmount}
            budgetCurrency={budgetCurrency}
            budgetLocalizer={globalLocalizer}
            isProcessing={processingTemplateId === template.id}
            isTogglePending={updateRecurring.isPending}
            onToggleActive={(nextActive) => handleToggleActive(template, nextActive)}
            onEdit={() => openEditDialog(template)}
            onDelete={() => handleDelete(template)}
            processingOccurrenceId={processingOccurrenceId}
            isMarkReadyPending={markReady.isPending}
            isSkipPending={skipOccurrence.isPending}
            isOccurrencesFetching={occurrencesFetching}
            onMarkReady={handleMarkReady}
            onSkip={handleSkipOccurrence}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="mx-4 space-y-6 sm:mx-6 lg:mx-8">
      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">
              <Trans>Recurring transactions</Trans>
            </h2>
            <p className="text-sm text-muted-foreground">
              <Trans>
                Keep an eye on regular paycheques, bills, and transfers. Budgero will remind you
                before they run.
              </Trans>
            </p>
          </div>
          <Button onClick={openCreateDialog} size="sm" className="w-full sm:w-auto">
            <Trans>
              <Plus className="mr-1 h-4 w-4" />
              New recurring transaction
            </Trans>
          </Button>
        </div>
        {permission !== 'granted' && permission !== 'unsupported' ? (
          <div className="flex flex-col gap-3 rounded-lg border border-dashed border-primary/30 bg-primary/5 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">
                <Trans>Enable notifications</Trans>
              </p>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Get reminders before recurring transactions are due. We will only notify you for
                  items you configure.
                </Trans>
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={enableNotifications}
              disabled={requestingPermission}
              className="sm:w-auto"
            >
              {requestingPermission ? t`Requesting...` : t`Enable notifications`}
            </Button>
          </div>
        ) : null}
        {renderTemplates()}
      </section>

      <div
        aria-hidden="true"
        className="sm:hidden"
        style={{ height: 'var(--mobile-bottom-nav-height, 96px)' }}
      />

      <RecurringTransactionEditor
        open={editorOpen}
        mode={editorMode}
        onOpenChange={handleEditorOpenChange}
        budgetId={budgetId}
        accounts={accounts.filter((a) => !a.Archived)}
        categories={categories}
        initialValues={editorInitialValues}
        onSubmit={handleEditorSubmit}
        isSubmitting={createRecurring.isPending || updateRecurring.isPending}
      />
    </div>
  );
}

const EMPTY_OCCURRENCES: RecurringOccurrenceWithTemplate[] = [];

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="divide-y overflow-hidden rounded-lg border">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="animate-pulse space-y-1.5 px-3 py-2.5">
          <div className="h-4 w-40 rounded bg-muted" />
          <div className="h-3 w-64 max-w-full rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
