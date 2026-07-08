import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Plus, Sparkles } from 'lucide-react';
import { useUiStore } from '@shared/store/useUiStore';
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
import { RecurringTemplateCard, RecurringOccurrenceCard } from './components';

export function RecurringTransactionsSection() {
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const budgetId = selectedBudget?.ID ?? 0;
  const globalLocalizer = useUiStore((state) => state.globalLocalizer);

  const { data: templates = [], isLoading: templatesLoading } = useRecurringTemplates(
    budgetId,
    true
  );
  const {
    data: occurrences = [],
    isLoading: occurrencesLoading,
    isFetching: occurrencesFetching,
  } = useRecurringOccurrences(budgetId, { status: 'scheduled' });

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
    const map = new Map<number, string>();
    for (const account of accounts) {
      map.set(account.ID, account.Name);
    }
    return map;
  }, [accounts]);

  const categoriesById = useMemo(() => {
    const map = new Map<number, string>();
    for (const category of categories) {
      map.set(category.ID, category.Name);
    }
    return map;
  }, [categories]);

  const nextOccurrenceByTemplate = useMemo(() => {
    const map = new Map<number, RecurringOccurrenceWithTemplate>();
    for (const occurrence of occurrences) {
      if (!map.has(occurrence.recurringTransactionId)) {
        map.set(occurrence.recurringTransactionId, occurrence);
      }
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
      toast.error('Select an account');
      return;
    }
    if (!values.categoryId) {
      toast.error('Select a category');
      return;
    }
    if (!values.amount || Number.isNaN(values.amount)) {
      toast.error('Enter a valid amount');
      return;
    }

    try {
      if (editorMode === 'create') {
        await createRecurring.mutateAsync({
          budgetId,
          accountId: values.accountId,
          categoryId: values.categoryId,
          name: values.name,
          memo: values.memo,
          amount: values.amount,
          direction: values.direction,
          schedule: values.schedule,
          notifyDaysBefore: values.notifyDaysBefore,
          active: values.active,
        });
        toast.success('Recurring transaction created', {
          description: 'We will remind you when it is almost due.',
        });
      } else if (editingTemplate) {
        setProcessingTemplateId(editingTemplate.id);
        await updateRecurring.mutateAsync({
          id: editingTemplate.id,
          budgetId,
          patch: {
            accountId: values.accountId,
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
        toast.success('Recurring transaction updated', {
          description: 'Your schedule has been refreshed.',
        });
      }

      handleEditorOpenChange(false);
    } catch (error) {
      const message = getErrorMessage(error, 'Something went wrong.');
      toast.error('Unable to save recurring transaction', {
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
      toast.success('Recurring transaction removed', {
        description: 'Future reminders for this item were cleared.',
      });
    } catch (error) {
      const message = getErrorMessage(error, 'Something went wrong.');
      toast.error('Unable to delete recurring transaction', {
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
      toast.success(nextActive ? 'Recurring transaction enabled' : 'Recurring transaction paused', {
        description: nextActive
          ? 'We will resume reminding you when it is due.'
          : 'Reminders are paused until you re-enable it.',
      });
    } catch (error) {
      const message = getErrorMessage(error, 'Something went wrong.');
      toast.error('Unable to update recurring transaction', {
        description: message,
      });
    } finally {
      setProcessingTemplateId(null);
    }
  };

  const handleMarkReady = async (occurrence: RecurringOccurrenceWithTemplate) => {
    try {
      setProcessingOccurrenceId(occurrence.id);
      const result = await markReady.mutateAsync({ occurrenceId: occurrence.id });
      const accountName = accountsById.get(result.occurrence.template.accountId);
      toast.success('Transaction posted', {
        description: accountName
          ? `Recorded in ${accountName}. You can review it in the Transactions view.`
          : 'Recorded successfully. Review it in the Transactions view.',
      });
    } catch (error) {
      const message = getErrorMessage(error, 'Something went wrong.');
      toast.error('Unable to mark ready', { description: message });
    } finally {
      setProcessingOccurrenceId(null);
    }
  };

  const handleSkipOccurrence = async (occurrence: RecurringOccurrenceWithTemplate) => {
    try {
      setProcessingOccurrenceId(occurrence.id);
      await skipOccurrence.mutateAsync({ id: occurrence.id });
      toast.success('Occurrence skipped', {
        description: 'We will remind you again next time.',
      });
    } catch (error) {
      const message = getErrorMessage(error, 'Something went wrong.');
      toast.error('Unable to skip occurrence', { description: message });
    } finally {
      setProcessingOccurrenceId(null);
    }
  };

  const enableNotifications = async () => {
    try {
      setRequestingPermission(true);
      const result = await requestPermission();
      if (result === 'granted') {
        toast.success('Notifications enabled', {
          description: 'We will send reminders before recurring items are due.',
        });
      } else if (result === 'denied') {
        toast.error('Notifications blocked', {
          description: 'You can enable notifications later from your browser or system settings.',
        });
      }
    } catch (error) {
      const message = getErrorMessage(error, 'Unable to request notifications.');
      toast.error('Notification request failed', { description: message });
    } finally {
      setRequestingPermission(false);
    }
  };

  const renderTemplates = () => {
    if (templatesLoading) {
      return (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <Card key={index} className="animate-pulse border-dashed">
              <CardHeader>
                <div className="h-6 w-32 rounded bg-muted" />
                <div className="mt-2 h-4 w-48 rounded bg-muted" />
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="h-5 w-20 rounded bg-muted" />
                <div className="h-4 w-full rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      );
    }

    if (!templates.length) {
      return (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-5 w-5 text-muted-foreground" />
              Plan ahead with recurring items
            </CardTitle>
            <CardDescription>
              Set up recurring paycheques, bills, or transfers and Budgero will remind you when they
              are due.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={openCreateDialog} variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              Add Recurring Transaction
            </Button>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="grid gap-4 md:grid-cols-2">
        {templates.map((template) => (
          <RecurringTemplateCard
            key={template.id}
            template={template}
            accountName={accountsById.get(template.accountId) ?? 'Unknown account'}
            categoryName={
              template.categoryId ? categoriesById.get(template.categoryId) : 'Unassigned category'
            }
            nextOccurrence={nextOccurrenceByTemplate.get(template.id)}
            localizer={globalLocalizer}
            isProcessing={processingTemplateId === template.id}
            isTogglePending={updateRecurring.isPending}
            onToggleActive={(nextActive) => handleToggleActive(template, nextActive)}
            onEdit={() => openEditDialog(template)}
            onDelete={() => handleDelete(template)}
          />
        ))}
      </div>
    );
  };

  const renderOccurrences = () => {
    if (occurrencesLoading && !occurrences.length) {
      return (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-lg">Upcoming transactions</CardTitle>
            <CardDescription>We are loading your upcoming recurring occurrences.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="h-14 rounded-lg border border-dashed border-primary/20 bg-muted/40 animate-pulse"
                />
              ))}
            </div>
          </CardContent>
        </Card>
      );
    }

    if (!occurrences.length) {
      return (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-lg">No upcoming occurrences</CardTitle>
            <CardDescription>
              When a recurring item is almost due, it will appear here so you can mark it ready.
            </CardDescription>
          </CardHeader>
        </Card>
      );
    }

    return (
      <div className="space-y-3">
        {occurrences.map((occurrence) => {
          const { template } = occurrence;
          const categoryName = template.categoryId
            ? categoriesById.get(template.categoryId) || 'Unassigned category'
            : 'Unassigned category';

          return (
            <RecurringOccurrenceCard
              key={occurrence.id}
              occurrence={occurrence}
              accountName={accountsById.get(template.accountId) ?? 'Unknown account'}
              categoryName={categoryName}
              localizer={globalLocalizer}
              isProcessing={processingOccurrenceId === occurrence.id}
              isMarkReadyPending={markReady.isPending}
              isSkipPending={skipOccurrence.isPending}
              isFetching={occurrencesFetching}
              onMarkReady={() => handleMarkReady(occurrence)}
              onSkip={() => handleSkipOccurrence(occurrence)}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className="mx-4 space-y-8 sm:mx-6 lg:mx-8">
      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Recurring transactions</h2>
            <p className="text-sm text-muted-foreground">
              Keep an eye on regular paycheques, bills, and transfers. Budgero will remind you
              before they run.
            </p>
          </div>
          <Button onClick={openCreateDialog} className="w-full sm:w-auto">
            <Plus className="mr-2 h-4 w-4" /> New recurring transaction
          </Button>
        </div>
        {permission !== 'granted' && permission !== 'unsupported' ? (
          <div className="flex flex-col gap-3 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Enable notifications</p>
              <p className="text-sm text-muted-foreground">
                Get reminders before recurring transactions are due. We will only notify you for
                items you configure.
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={enableNotifications}
              disabled={requestingPermission}
              className="sm:w-auto"
            >
              {requestingPermission ? 'Requesting...' : 'Enable notifications'}
            </Button>
          </div>
        ) : null}
        {renderTemplates()}
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Upcoming occurrences</h2>
          <p className="text-sm text-muted-foreground">
            Mark items as ready when they land to create the matching transaction automatically.
          </p>
        </div>
        {renderOccurrences()}
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
        accounts={accounts.filter((a) => !a.Archived)}
        categories={categories}
        initialValues={editorInitialValues}
        onSubmit={handleEditorSubmit}
        isSubmitting={createRecurring.isPending || updateRecurring.isPending}
      />
    </div>
  );
}
