import { useCallback, useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@shared/ui/button';
import { Avatar, AvatarFallback } from '@shared/ui/avatar';
import { Wallet, Undo2, Redo2, Eye, EyeOff } from 'lucide-react';
import { FeedbackIcon } from '@shared/ui/icons/feedback-icon';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@shared/ui/dropdown-menu';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@shared/ui/dialog';
import { ConnectivityStatus } from '@widgets/sync-status/ConnectivityStatus';
import { getBudgetIconComponent } from '@features/budget-management/model/icon-options';
import { useUiStore } from '@shared/store/useUiStore';
import type { Budget } from '@budgero/core/browser';
import BudgetWizard from '@features/budget-management';
import { EditBudgetForm } from '@features/budget-management/ui/EditBudgetForm';
import { DeleteBudgetButton } from '@features/budget-management/ui/DeleteBudgetButton';
import { WorkspaceBudgetList } from '@features/budget-management/ui/WorkspaceBudgetList';
import { useUndoStore } from '@shared/mutations/UndoStore';
import { openQuackback } from '@features/feedback';
import { IS_SELF_HOSTABLE_BUILD } from '@shared/lib/env';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@shared/ui/tooltip';
import { toast } from 'sonner';
import {
  clearStoredDefaultBudgetId,
  getStoredDefaultBudgetId,
} from '@shared/runtime/workspace-preferences';
import { useActiveSpace } from '@shared/runtime/runtime-provider';
import logoImg from '/logo_144.png';

export function MobileTopBar() {
  const selectedBudget = useUiStore((state) => state.selectedBudget);
  const privacyMaskNumbers = useUiStore((state) => state.privacyMaskNumbers);
  const togglePrivacyMaskNumbers = useUiStore((state) => state.togglePrivacyMaskNumbers);
  const navigate = useNavigate();
  const activeSpace = useActiveSpace();
  const canManageBudgets = activeSpace?.role === 'owner';
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);

  const [budgetDropdownOpen, setBudgetDropdownOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedBudgetForEdit, setSelectedBudgetForEdit] = useState<Budget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const feedbackEnabled = !IS_SELF_HOSTABLE_BUILD;

  const canUndo = useUndoStore((s) => s.canUndo());
  const canRedo = useUndoStore((s) => s.canRedo());
  const undo = useUndoStore((s) => s.undo);
  const redo = useUndoStore((s) => s.redo);

  // Close dialogs when permissions change - defer to avoid synchronous cascade
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

  const getBudgetIcon = (badgeIcon: string) => {
    const Icon = getBudgetIconComponent(badgeIcon);
    return Icon ? <Icon className="h-4 w-4" /> : null;
  };

  const handleDeleteSuccess = () => {
    if (selectedBudgetForEdit && selectedBudgetForEdit.ID === getStoredDefaultBudgetId()) {
      clearStoredDefaultBudgetId();
    }
    setEditDialogOpen(false);
    setBudgetDropdownOpen(false);
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
      setBudgetDropdownOpen(false);
      toast.success('Budget created', {
        description: createdBudget
          ? `Switched to "${createdBudget.Name}".`
          : 'Switched to your new budget.',
      });
      void navigate('/', { replace: true });
    },
    [navigate]
  );

  // Expose top bar height via CSS variable for layout sizing
  const topBarRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = topBarRef.current || document.querySelector<HTMLElement>('[data-mobile-top-bar]');
    if (!el) return;
    const applyVar = () => {
      const rect = el.getBoundingClientRect();
      const h = Math.round(rect.height || (el as HTMLElement).offsetHeight || 0);
      if (h > 0) {
        document.documentElement.style.setProperty('--app-topbar-height', `${h}px`);
      }
    };
    applyVar();
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(() => applyVar());
      ro.observe(el);
    } catch {
      /* no-op: ResizeObserver unsupported */
    }
    window.addEventListener('resize', applyVar);
    return () => {
      window.removeEventListener('resize', applyVar);
      ro?.disconnect();
    };
  }, []);

  return (
    <>
      {/* Top Bar */}
      <div
        ref={topBarRef}
        className="sticky top-0 z-50 grid grid-cols-3 items-center px-4 py-3 border-b bg-card relative"
        data-mobile-top-bar
      >
        {/* Left: Budget selector and sync status */}
        <div className="flex items-center gap-2 justify-start">
          {/* Budget Selector with full management functionality */}
          <DropdownMenu open={budgetDropdownOpen} onOpenChange={setBudgetDropdownOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-10 w-10 rounded-full p-0">
                {selectedBudget ? (
                  <div className="flex aspect-square h-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    {getBudgetIcon(selectedBudget.BadgeIcon) || <Wallet className="h-4 w-4" />}
                  </div>
                ) : (
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>
                      <Wallet className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[280px] p-2">
              <WorkspaceBudgetList
                variant="popover"
                onItemSelected={() => setBudgetDropdownOpen(false)}
                onEditBudget={(budget) => {
                  setSelectedBudgetForEdit(budget);
                  setEditDialogOpen(true);
                }}
                onCreateBudget={() => setCreateDialogOpen(true)}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <ConnectivityStatus className="ml-auto" />
        </div>

        {/* Center: Logo */}
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 transition focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label="Open command menu"
          >
            <img src={logoImg} alt="Logo" className="h-10 w-10 rounded-full shadow-sm" />
          </button>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center justify-end gap-1">
          <TooltipProvider>
            <div className="flex items-center pr-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={privacyMaskNumbers ? 'default' : 'ghost'}
                    size="icon"
                    className="h-8 w-6 mr-1"
                    onClick={togglePrivacyMaskNumbers}
                    title={privacyMaskNumbers ? 'Disable privacy mode' : 'Enable privacy mode'}
                    aria-label={privacyMaskNumbers ? 'Disable privacy mode' : 'Enable privacy mode'}
                  >
                    {privacyMaskNumbers ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Privacy mode</TooltipContent>
              </Tooltip>
              {feedbackEnabled && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-6 mr-1"
                  onClick={openQuackback}
                  title="Send feedback"
                  aria-label="Send feedback"
                >
                  <FeedbackIcon className="h-4 w-4" />
                </Button>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-6 mr-3"
                    disabled={!canUndo}
                    onClick={() => undo()}
                  >
                    <Undo2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Undo</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-6"
                    disabled={!canRedo}
                    onClick={() => redo()}
                  >
                    <Redo2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Redo</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>
      </div>

      {/* Edit Budget Dialog */}
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
                setBudgetDropdownOpen(false);
                setSelectedBudgetForEdit(null);
              }}
              onError={setError}
              onClose={() => {
                setEditDialogOpen(false);
                setSelectedBudgetForEdit(null);
              }}
            />

            <div className="flex items-center justify-between gap-2 mt-6 pt-6 border-t">
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

      {canManageBudgets && (
        <Dialog
          open={createDialogOpen}
          onOpenChange={(open) => {
            setCreateDialogOpen(open);
            if (!open) setBudgetDropdownOpen(false);
          }}
        >
          <DialogContent>
            <DialogTitle>Create New Budget</DialogTitle>
            <DialogDescription>Set up a new budget to track your finances</DialogDescription>
            <BudgetWizard onCreated={handleBudgetCreated} />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
