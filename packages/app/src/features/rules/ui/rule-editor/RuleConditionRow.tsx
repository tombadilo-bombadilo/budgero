import React from 'react';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Switch } from '@shared/ui/switch';
import { MinusCircle } from 'lucide-react';
import type { RuleConditionField, RuleConditionOperator, Account } from '@budgero/core/browser';
import {
  type RuleFormCondition,
  memoOperators,
  payeeOperators,
  amountOperators,
  accountOperators,
  getOperatorLabel,
} from './rule-editor.utils';

interface RuleConditionRowProps {
  condition: RuleFormCondition;
  index: number;
  accounts: Account[];
  canRemove: boolean;
  onUpdate: (index: number, patch: Partial<RuleFormCondition>) => void;
  onRemove: (index: number) => void;
}

export const RuleConditionRow = React.memo(function RuleConditionRow({
  condition,
  index,
  accounts,
  canRemove,
  onUpdate,
  onRemove,
}: RuleConditionRowProps) {
  const operators =
    condition.field === 'memo'
      ? memoOperators
      : condition.field === 'payee'
        ? payeeOperators
        : condition.field === 'amount'
          ? amountOperators
          : accountOperators;

  return (
    <div className="rounded-lg border bg-card/40 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Select
          value={condition.field}
          onValueChange={(value: RuleConditionField) => onUpdate(index, { field: value })}
        >
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Field" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="memo">Memo</SelectItem>
            <SelectItem value="payee">Payee</SelectItem>
            <SelectItem value="amount">Amount</SelectItem>
            <SelectItem value="account">Account</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={condition.operator}
          onValueChange={(value: RuleConditionOperator) => onUpdate(index, { operator: value })}
        >
          <SelectTrigger className="w-full sm:w-36">
            <SelectValue placeholder="Operator" />
          </SelectTrigger>
          <SelectContent>
            {operators.map((operator) => (
              <SelectItem key={operator} value={operator}>
                {getOperatorLabel(operator)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {condition.field === 'memo' || condition.field === 'payee' ? (
          <Input
            placeholder={condition.operator === 'regex' ? 'Regular expression' : 'Text to match'}
            value={condition.value}
            onChange={(event) => onUpdate(index, { value: event.target.value })}
            className="w-full"
          />
        ) : condition.field === 'amount' ? (
          <Input
            placeholder="Amount"
            type="number"
            value={condition.value}
            onChange={(event) => onUpdate(index, { value: event.target.value })}
            className="w-full"
          />
        ) : (
          <Select
            value={(condition.value ?? '').toString()}
            onValueChange={(value) => onUpdate(index, { value })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.length === 0 ? (
                <SelectItem value="">No accounts available</SelectItem>
              ) : (
                accounts.map((account) => (
                  <SelectItem key={account.ID} value={account.ID.toString()}>
                    {account.Name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={!canRemove}
          onClick={() => onRemove(index)}
          className="self-start"
        >
          <MinusCircle className="h-5 w-5 text-muted-foreground" />
        </Button>
      </div>

      {condition.field === 'memo' || condition.field === 'payee' ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={Boolean(condition.caseSensitive)}
            onCheckedChange={(value) => onUpdate(index, { caseSensitive: value })}
          />
          Case sensitive matching
        </div>
      ) : null}
    </div>
  );
});
