import { useLingui } from '@lingui/react/macro';
import React from 'react';
import type { Account, RuleConditionJoin } from '@budgero/core/browser';
import { cn } from '@shared/lib/utils';
import type { RuleFormCondition } from './rule-editor.utils';
import { RuleConditionRow } from './RuleConditionRow';
import { RuleEditorSection } from './RuleEditorSection';

interface RuleConditionsEditorProps {
  conditions: RuleFormCondition[];
  accounts: Account[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<RuleFormCondition>) => void;
  onRemove: (index: number) => void;
}

export const RuleConditionsEditor = React.memo(function RuleConditionsEditor({
  conditions,
  accounts,
  onAdd,
  onUpdate,
  onRemove,
}: RuleConditionsEditorProps) {
  const { t } = useLingui();

  return (
    <RuleEditorSection
      title={t`Conditions`}
      description={t`Chain conditions with AND / OR. AND is checked before OR, so each OR starts a new group.`}
      addLabel={t`Add condition`}
      onAdd={onAdd}
    >
      {conditions.map((condition, index) => (
        <React.Fragment key={index}>
          {index > 0 && (
            <ConditionJoinToggle
              value={condition.join === 'or' ? 'or' : 'and'}
              onChange={(join) => onUpdate(index, { join })}
            />
          )}
          <RuleConditionRow
            condition={condition}
            index={index}
            accounts={accounts}
            canRemove={conditions.length > 1}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        </React.Fragment>
      ))}
    </RuleEditorSection>
  );
});

function ConditionJoinToggle({
  value,
  onChange,
}: {
  value: RuleConditionJoin;
  onChange: (join: RuleConditionJoin) => void;
}) {
  const { t } = useLingui();
  const options: { join: RuleConditionJoin; label: string }[] = [
    { join: 'and', label: t`AND` },
    { join: 'or', label: t`OR` },
  ];
  const isOr = value === 'or';

  return (
    <div className="flex items-center gap-2">
      <div className={cn('h-px flex-1', isOr ? 'bg-border' : 'bg-transparent')} />
      <div
        role="radiogroup"
        aria-label={t`Join with previous condition`}
        className="inline-flex rounded-md border bg-background p-0.5"
      >
        {options.map((option) => (
          <button
            key={option.join}
            type="button"
            role="radio"
            aria-checked={value === option.join}
            onClick={() => onChange(option.join)}
            className={cn(
              'rounded px-2 py-0.5 text-[0.6875rem] font-medium transition-colors',
              value === option.join
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className={cn('h-px flex-1', isOr ? 'bg-border' : 'bg-transparent')} />
    </div>
  );
}
