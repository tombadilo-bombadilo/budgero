import { Trans, useLingui } from '@lingui/react/macro';
import React from 'react';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/select';
import { X } from 'lucide-react';
import type { RuleActionType, Category, Account } from '@budgero/core/browser';
import { LabelCombobox } from '@features/labels/ui/LabelCombobox';
import { PayeeCombobox } from '@features/payees/ui/PayeeCombobox';
import { SearchableCategorySelect } from '@features/category-management/ui/SearchableCategorySelect';
import type { RuleFormAction } from './rule-editor.utils';
import { RuleAccountSelect } from './RuleAccountSelect';

interface RuleActionRowProps {
  action: RuleFormAction;
  index: number;
  categories: Category[];
  accounts: Account[];
  budgetId: number;
  canRemove: boolean;
  onUpdate: (index: number, patch: Partial<RuleFormAction>) => void;
  onRemove: (index: number) => void;
}

export const RuleActionRow = React.memo(function RuleActionRow({
  action,
  index,
  categories,
  accounts,
  budgetId,
  canRemove,
  onUpdate,
  onRemove,
}: RuleActionRowProps) {
  const { t } = useLingui();

  const handlePayloadChange = (payload: Record<string, string | number | undefined>) => {
    onUpdate(index, { payload });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card/40 p-2 sm:flex-nowrap">
      <Select
        value={action.type}
        onValueChange={(value: RuleActionType) => onUpdate(index, { type: value })}
      >
        <SelectTrigger size="sm" className="w-full sm:w-52 sm:shrink-0">
          <SelectValue placeholder={t`Select action`} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>
              <Trans>Memo</Trans>
            </SelectLabel>
            <SelectItem value="memo.set">
              <Trans>Set memo</Trans>
            </SelectItem>
            <SelectItem value="memo.remove_regex">
              <Trans>Remove pattern from memo</Trans>
            </SelectItem>
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>
              <Trans>Category</Trans>
            </SelectLabel>
            <SelectItem value="category.set">
              <Trans>Set category</Trans>
            </SelectItem>
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>
              <Trans>Payee</Trans>
            </SelectLabel>
            <SelectItem value="payee.set">
              <Trans>Set payee</Trans>
            </SelectItem>
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>
              <Trans>Amount</Trans>
            </SelectLabel>
            <SelectItem value="amount.set">
              <Trans>Set amount</Trans>
            </SelectItem>
            <SelectItem value="amount.adjust_value">
              <Trans>Adjust by value</Trans>
            </SelectItem>
            <SelectItem value="amount.adjust_percent">
              <Trans>Adjust by %</Trans>
            </SelectItem>
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>
              <Trans>Account</Trans>
            </SelectLabel>
            <SelectItem value="account.set">
              <Trans>Set account</Trans>
            </SelectItem>
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>
              <Trans>Label</Trans>
            </SelectLabel>
            <SelectItem value="label.set">
              <Trans>Set label</Trans>
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <div className="min-w-0 flex-1">
        <ActionPayloadEditor
          action={action}
          onChange={handlePayloadChange}
          categories={categories}
          accounts={accounts}
          budgetId={budgetId}
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={!canRemove}
        onClick={() => onRemove(index)}
        className="size-8 shrink-0 text-muted-foreground"
        title={t`Remove action`}
        aria-label={t`Remove action`}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
});

interface ActionPayloadEditorProps {
  action: RuleFormAction;
  onChange: (payload: Record<string, string | number | undefined>) => void;
  categories: Category[];
  accounts: Account[];
  budgetId: number;
}

const ActionPayloadEditor = React.memo(function ActionPayloadEditor({
  action,
  onChange,
  categories,
  accounts,
  budgetId,
}: ActionPayloadEditorProps) {
  const { t } = useLingui();
  const inputClassName = 'h-8';

  switch (action.type) {
    case 'memo.remove_regex':
      return (
        <div className="flex gap-2">
          <Input
            className={inputClassName}
            aria-label={t`Pattern`}
            placeholder="e.g. (#\d{4})"
            value={action.payload.pattern ?? ''}
            onChange={(event) => onChange({ ...action.payload, pattern: event.target.value })}
          />
          <Input
            className={`${inputClassName} w-16 shrink-0 font-mono`}
            aria-label={t`Flags`}
            title={t`JavaScript regex flags, e.g. gi`}
            placeholder="gi"
            value={action.payload.flags ?? 'gi'}
            onChange={(event) => onChange({ ...action.payload, flags: event.target.value || 'gi' })}
          />
        </div>
      );
    case 'memo.set':
      return (
        <Input
          className={inputClassName}
          aria-label={t`Memo`}
          placeholder={t`e.g. Groceries at Walmart`}
          value={action.payload.memo ?? ''}
          onChange={(event) => onChange({ memo: event.target.value })}
        />
      );
    case 'category.set':
      return (
        <SearchableCategorySelect
          budgetId={budgetId}
          categories={categories}
          selectedCategoryId={action.payload.categoryId ? Number(action.payload.categoryId) : null}
          onCategorySelect={(categoryId) => onChange({ categoryId })}
          placeholder={t`Select category`}
          showAvailableForMonth={false}
          triggerClassName="h-8 w-full"
          popoverContentClassName="w-[320px] max-w-[90vw]"
        />
      );
    case 'payee.set':
      return (
        <PayeeCombobox
          budgetId={budgetId}
          value={String(action.payload.payee ?? '')}
          onChange={(value) => onChange({ payee: value })}
          placeholder={t`Payee (blank clears it)`}
          triggerClassName="h-8 w-full"
          allowClear
        />
      );
    case 'label.set':
      return (
        <LabelCombobox
          budgetId={budgetId}
          value={action.payload.labelId ? Number(action.payload.labelId) : null}
          // null = "No label": the rule clears the label.
          onChange={(labelId) => onChange({ labelId: labelId ?? '' })}
          triggerClassName="h-8 w-full"
          allowClear
        />
      );
    case 'account.set':
      return (
        <RuleAccountSelect
          value={(action.payload.accountId ?? '').toString()}
          accounts={accounts}
          onChange={(accountId) => onChange({ accountId: Number(accountId) })}
        />
      );
    case 'amount.set':
      return (
        <Input
          className={inputClassName}
          aria-label={t`New amount`}
          type="number"
          placeholder="0.00"
          value={action.payload.amount ?? ''}
          onChange={(event) => onChange({ amount: event.target.value })}
        />
      );
    case 'amount.adjust_value':
      return (
        <Input
          className={inputClassName}
          aria-label={t`Difference`}
          title={t`Positive numbers increase, negatives decrease the amount.`}
          type="number"
          placeholder="e.g. -12.50"
          value={action.payload.delta ?? ''}
          onChange={(event) => onChange({ delta: event.target.value })}
        />
      );
    case 'amount.adjust_percent':
      return (
        <Input
          className={inputClassName}
          aria-label={t`Percent`}
          title={t`Use positive/negative percentages to scale the amount.`}
          type="number"
          placeholder="e.g. -10"
          value={action.payload.percent ?? ''}
          onChange={(event) => onChange({ percent: event.target.value })}
        />
      );
    default:
      return null;
  }
});
