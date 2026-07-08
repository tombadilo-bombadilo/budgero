import React from 'react';
import type { Account } from '@budgero/core/browser';
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
  return (
    <RuleEditorSection
      title="Conditions"
      description="All conditions must match for the rule to fire."
      addLabel="Add condition"
      onAdd={onAdd}
    >
      {conditions.map((condition, index) => (
        <RuleConditionRow
          key={index}
          condition={condition}
          index={index}
          accounts={accounts}
          canRemove={conditions.length > 1}
          onUpdate={onUpdate}
          onRemove={onRemove}
        />
      ))}
    </RuleEditorSection>
  );
});
