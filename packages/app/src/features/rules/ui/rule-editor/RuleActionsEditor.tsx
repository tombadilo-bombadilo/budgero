import React from 'react';
import type { Category, Account } from '@budgero/core/browser';
import type { RuleFormAction } from './rule-editor.utils';
import { RuleActionRow } from './RuleActionRow';
import { RuleEditorSection } from './RuleEditorSection';

interface RuleActionsEditorProps {
  actions: RuleFormAction[];
  categories: Category[];
  accounts: Account[];
  budgetId: number;
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<RuleFormAction>) => void;
  onRemove: (index: number) => void;
}

export const RuleActionsEditor = React.memo(function RuleActionsEditor({
  actions,
  categories,
  accounts,
  budgetId,
  onAdd,
  onUpdate,
  onRemove,
}: RuleActionsEditorProps) {
  return (
    <RuleEditorSection
      title="Actions"
      description="Actions run in order after all conditions pass."
      addLabel="Add action"
      onAdd={onAdd}
    >
      {actions.map((action, index) => (
        <RuleActionRow
          key={index}
          action={action}
          index={index}
          categories={categories}
          accounts={accounts}
          budgetId={budgetId}
          canRemove={actions.length > 1}
          onUpdate={onUpdate}
          onRemove={onRemove}
        />
      ))}
    </RuleEditorSection>
  );
});
