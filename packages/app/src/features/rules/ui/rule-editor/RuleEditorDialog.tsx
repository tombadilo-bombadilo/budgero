import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { X } from 'lucide-react';
import { Sheet, SheetClose, SheetContent } from '@shared/ui/sheet';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import type { TransactionRule, RuleCondition, RuleAction } from '@budgero/core/browser';
import { useRuleEditorState } from './useRuleEditorState';
import { RuleMetadataForm } from './RuleMetadataForm';
import { RuleConditionsEditor } from './RuleConditionsEditor';
import { RuleActionsEditor } from './RuleActionsEditor';
import { RulePreview } from './RulePreview';

export interface RuleFormValues {
  name: string;
  description: string;
  mode: 'continuous' | 'one_time' | 'autofill';
  enabled: boolean;
  runOrder: number;
  conditions: RuleCondition[];
  actions: RuleAction[];
}

export interface RuleEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  budgetId: number;
  mode: 'create' | 'edit';
  initialRule?: TransactionRule | null;
  isSubmitting?: boolean;
  onSubmit: (values: RuleFormValues) => Promise<void> | void;
}

export function RuleEditorDialog({
  open,
  onOpenChange,
  budgetId,
  mode,
  initialRule,
  isSubmitting = false,
  onSubmit,
}: RuleEditorDialogProps) {
  const state = useRuleEditorState({
    open,
    budgetId,
    mode,
    initialRule,
    onSubmit,
  });

  const isMobile = useIsMobile();

  const formSections = (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 sm:gap-10 lg:max-w-5xl xl:max-w-6xl">
      <RuleMetadataForm
        name={state.name}
        onNameChange={state.setName}
        description={state.description}
        onDescriptionChange={state.setDescription}
        enabled={state.enabled}
        onEnabledChange={state.setEnabled}
        modeValue={state.modeValue}
        onModeChange={state.setModeValue}
        runOrder={state.runOrder}
        onRunOrderChange={state.setRunOrder}
      />

      <RuleConditionsEditor
        conditions={state.conditions}
        accounts={state.accounts}
        onAdd={state.addCondition}
        onUpdate={state.updateCondition}
        onRemove={state.removeCondition}
      />

      <RuleActionsEditor
        actions={state.actions}
        categories={state.categories}
        accounts={state.accounts}
        budgetId={budgetId}
        onAdd={state.addAction}
        onUpdate={state.updateAction}
        onRemove={state.removeAction}
      />

      <RulePreview />

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );

  const body = (
    <div className="flex-1 overflow-y-auto px-4 pb-24 sm:px-6 sm:py-6">{formSections}</div>
  );

  const footerButtons = (
    <>
      <Button
        variant="outline"
        onClick={() => onOpenChange(false)}
        disabled={isSubmitting}
        className="w-full sm:w-auto"
      >
        Cancel
      </Button>
      <Button onClick={state.handleSubmit} disabled={isSubmitting} className="w-full sm:w-auto">
        {isSubmitting ? 'Saving...' : mode === 'create' ? 'Create rule' : 'Save changes'}
      </Button>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="flex h-[min(92dvh,720px)] max-h-[100dvh] w-full max-w-full flex-col overflow-hidden rounded-t-3xl border-0 bg-background pb-[calc(env(safe-area-inset-bottom,0px))] pt-3 shadow-2xl duration-200 [&>button:last-child]:hidden"
        >
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-muted" />
          <div className="flex items-start justify-between gap-2 px-4 pb-4">
            <div className="space-y-1">
              <h2 className="text-left text-lg font-semibold">{state.dialogTitle}</h2>
              <p className="text-left text-sm leading-relaxed text-muted-foreground">
                {state.dialogDescription}
              </p>
            </div>
            <SheetClose asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </Button>
            </SheetClose>
          </div>
          {body}
          <div className="border-t bg-background/95 px-4 pb-4 pt-4 backdrop-blur">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {footerButtons}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border bg-background p-0 sm:h-auto sm:max-h-[90vh] lg:max-w-6xl xl:max-w-7xl"
      >
        <div className="flex items-start justify-between gap-2 border-b px-6 py-6">
          <div className="space-y-1">
            <DialogTitle className="text-left text-2xl font-semibold">
              {state.dialogTitle}
            </DialogTitle>
            <DialogDescription className="text-left text-sm leading-relaxed text-muted-foreground">
              {state.dialogDescription}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </DialogClose>
        </div>
        {body}
        <div className="border-t bg-background/95 px-6 py-6 backdrop-blur">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {footerButtons}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
