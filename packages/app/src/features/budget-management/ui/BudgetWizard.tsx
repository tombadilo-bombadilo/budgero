'use client';

import React from 'react';
import CreateBudgetForm from '@features/budget-management/ui/CreateBudgetForm';

interface BudgetWizardProps {
  onCreated?: (budgetId: number) => void;
  onModeChange?: (mode: 'manual' | 'core' | 'import') => void;
  defaultTab?: 'manual' | 'core' | 'import';
  hideHeader?: boolean;
}

const BudgetWizard: React.FC<BudgetWizardProps> = ({
  onCreated,
  onModeChange,
  defaultTab,
  hideHeader,
}) => {
  return (
    <div className="rounded-xl p-2 sm:p-4">
      {!hideHeader && (
        <h2 className="font-semibold text-base sm:text-lg mb-2 sm:mb-3">Start a New Budget</h2>
      )}
      <CreateBudgetForm onCreated={onCreated} onModeChange={onModeChange} defaultTab={defaultTab} />
    </div>
  );
};

export default BudgetWizard;
