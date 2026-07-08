import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@shared/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@shared/ui/dialog';
import { useUiStore } from '@shared/store/useUiStore';
import BudgetWizard from '@features/budget-management/ui/BudgetWizard';
import { EditBudgetForm } from '@features/budget-management/ui/EditBudgetForm';
import { DeleteBudgetButton } from '@features/budget-management/ui/DeleteBudgetButton';
import { WorkspaceBudgetList } from '@features/budget-management/ui/WorkspaceBudgetList';
import type { Budget } from '@budgero/core/browser';
import { toast } from 'sonner';
import {
  clearStoredDefaultBudgetId,
  getStoredDefaultBudgetId,
} from '@shared/runtime/workspace-preferences';
import { useActiveSpace } from '@shared/runtime/runtime-provider';

export function BudgetSwitcher() {
  const navigate = useNavigate();
  const activeSpace = useActiveSpace();
  const canManageBudgets = activeSpace?.role === 'owner';

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedBudgetForEdit, setSelectedBudgetForEdit] = useState<Budget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  useEffect(() => {
    if (!canManageBudgets) {
      const id = requestAnimationFrame(() => {
        setCreateDialogOpen(false);
        setEditDialogOpen(false);
        setSelectedBudgetForEdit(null);
      });
      return () => cancelAnimationFrame(id);
    }
  }, [canManageBudgets]);

  const handleDeleteSuccess = () => {
    if (selectedBudgetForEdit && selectedBudgetForEdit.ID === getStoredDefaultBudgetId()) {
      clearStoredDefaultBudgetId();
    }
    setEditDialogOpen(false);
    setSelectedBudgetForEdit(null);
    // Radix Dialog sets pointer-events:none on <body> while open. When the
    // component tree unmounts before Radix can clean up (e.g. StartupController
    // swaps the view after deleting the last budget), the style is left behind
    // and the page becomes unresponsive. Remove it explicitly.
    document.body.style.removeProperty('pointer-events');
    void navigate('/', { replace: true });
  };

  const handleBudgetCreated = useCallback(
    (_budgetId: number) => {
      const createdBudget = useUiStore.getState().selectedBudget;
      setCreateDialogOpen(false);
      toast.success('Budget created', {
        description: createdBudget
          ? `Switched to "${createdBudget.Name}".`
          : 'Switched to your new budget.',
      });
      void navigate('/', { replace: true });
    },
    [navigate]
  );

  return (
    <div className="space-y-4 border-b border-border p-3" data-testid="budget-switcher">
      <WorkspaceBudgetList
        variant="sidebar"
        onEditBudget={(budget) => {
          setSelectedBudgetForEdit(budget);
          setEditDialogOpen(true);
        }}
        onCreateBudget={() => setCreateDialogOpen(true)}
      />

      {canManageBudgets && (
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogContent>
            <DialogTitle>Create New Budget</DialogTitle>
            <DialogDescription>Set up a new budget to track your finances</DialogDescription>
            <BudgetWizard onCreated={handleBudgetCreated} />
          </DialogContent>
        </Dialog>
      )}

      {canManageBudgets && selectedBudgetForEdit && (
        <Dialog
          open={editDialogOpen}
          onOpenChange={(open) => {
            setEditDialogOpen(open);
            if (!open) setSelectedBudgetForEdit(null);
          }}
        >
          <DialogContent>
            <DialogTitle>Manage Budget</DialogTitle>
            <DialogDescription>Edit or delete your budget</DialogDescription>

            {error && (
              <div className="rounded-md bg-destructive-foreground/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <EditBudgetForm
              budget={selectedBudgetForEdit}
              onUpdated={() => {
                setEditDialogOpen(false);
                setSelectedBudgetForEdit(null);
              }}
              onError={setError}
              onClose={() => {
                setEditDialogOpen(false);
                setSelectedBudgetForEdit(null);
              }}
            />

            <div className="mt-6 flex items-center justify-between gap-2 border-t pt-6">
              <DeleteBudgetButton
                budget={selectedBudgetForEdit}
                onDeleted={handleDeleteSuccess}
                onError={setError}
              />
              <Button type="submit" form="budget-form" variant="default">
                Update Budget
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
