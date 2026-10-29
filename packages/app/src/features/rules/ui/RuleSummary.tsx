import { Trans, useLingui } from '@lingui/react/macro';
import type { ReactNode } from 'react';
import {
  groupRuleConditions,
  type RuleAction,
  type RuleCondition,
  type TransactionRule,
} from '@budgero/core/browser';
import { useLabels } from '@entities/label/api/useLabels';
import { asMilli, toDecimal } from '@shared/lib/currency/milli';
import { getOperatorLabel } from './rule-editor/rule-editor.utils';

interface RuleSummaryProps {
  rule: TransactionRule;
  categoryNames: Map<number, string>;
  accountNames: Map<number, string>;
}

function decimal(value: unknown): string {
  const num = Number(value);
  return Number.isFinite(num) ? String(toDecimal(asMilli(num))) : String(value);
}

function signed(value: string): string {
  return value.startsWith('-') ? value : `+${value}`;
}

function Line({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <li className="flex min-w-0 items-baseline gap-1.5 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-medium">{value}</span>
    </li>
  );
}

export function RuleSummary({ rule, categoryNames, accountNames }: RuleSummaryProps) {
  const { t } = useLingui();
  const { byId: labelsById } = useLabels(
    rule.budgetId,
    rule.actions.some((action) => action.type === 'label.set')
  );

  const fieldLabel = (field: RuleCondition['field']) =>
    ({ memo: t`Memo`, payee: t`Payee`, amount: t`Amount`, account: t`Account` })[field];

  const conditionValue = (condition: RuleCondition) => {
    if (condition.field === 'amount') return decimal(condition.value);
    if (condition.field === 'account') {
      return accountNames.get(Number(condition.value)) ?? t`Unknown account`;
    }
    const text = `“${condition.value}”`;
    return condition.options?.caseSensitive ? `${text} (${t`case-sensitive`})` : text;
  };

  const actionLine = (action: RuleAction): { label: string; value: string } => {
    switch (action.type) {
      case 'memo.set':
        return { label: t`Set memo`, value: `“${action.payload.memo}”` };
      case 'memo.remove_regex':
        return {
          label: t`Remove pattern from memo`,
          value: `/${action.payload.pattern}/${action.payload.flags ?? ''}`,
        };
      case 'category.set':
        return {
          label: t`Set category`,
          value: categoryNames.get(action.payload.categoryId) ?? t`Unknown category`,
        };
      case 'payee.set':
        return {
          label: t`Set payee`,
          value: action.payload.payee ? `“${action.payload.payee}”` : t`(clear)`,
        };
      case 'amount.set':
        return { label: t`Set amount`, value: decimal(action.payload.amount) };
      case 'amount.adjust_value':
        return { label: t`Adjust by value`, value: signed(decimal(action.payload.delta)) };
      case 'amount.adjust_percent':
        return { label: t`Adjust by %`, value: `${signed(String(action.payload.percent))}%` };
      case 'account.set':
        return {
          label: t`Set account`,
          value: accountNames.get(action.payload.accountId) ?? t`Unknown account`,
        };
      case 'label.set':
        return {
          label: t`Set label`,
          value: action.payload.labelId
            ? (labelsById.get(action.payload.labelId)?.Name ?? t`Deleted label`)
            : t`(clear)`,
        };
      default:
        return { label: String((action as RuleAction).type), value: '' };
    }
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="min-w-0 space-y-1">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <Trans>When</Trans>
        </div>
        {groupRuleConditions(rule.conditions).map((group, groupIndex) => (
          <div key={groupIndex} className="space-y-0.5">
            {groupIndex > 0 && (
              <div className="py-0.5 text-[10px] font-semibold text-primary">{t`OR`}</div>
            )}
            <ul className="space-y-0.5">
              {group.map((condition, index) => (
                <Line
                  key={index}
                  label={`${index > 0 ? `${t`AND`} ` : ''}${fieldLabel(condition.field)} ${getOperatorLabel(condition.operator)}`}
                  value={conditionValue(condition)}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="min-w-0 space-y-1">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <Trans>Then</Trans>
        </div>
        <ol className="space-y-0.5">
          {rule.actions.map((action, index) => {
            const { label, value } = actionLine(action);
            return <Line key={index} label={label} value={value} />;
          })}
        </ol>
      </div>
    </div>
  );
}
