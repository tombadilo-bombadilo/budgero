import { Dialog, DialogContent } from '@shared/ui/dialog';
import { SearchableCategorySelect } from '@features/category-management/ui/SearchableCategorySelect';

interface RecategorizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  budgetId: number;
  /** The category select is only rendered while a transaction is targeted. */
  hasTransaction: boolean;
  onCategorySelect: (categoryId: number) => void;
}

/**
 * Minimal "Reassign Category" dialog used by the mobile transaction list and
 * the spending drawer's swipe-to-recategorize action.
 */
export function RecategorizeDialog({
  open,
  onOpenChange,
  budgetId,
  hasTransaction,
  onCategorySelect,
}: RecategorizeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <div className="space-y-3">
          <div className="text-sm font-medium">Reassign Category</div>
          {hasTransaction && (
            <SearchableCategorySelect
              budgetId={budgetId}
              selectedCategoryId={null}
              onCategorySelect={onCategorySelect}
              triggerClassName="w-full"
              popoverContentClassName="w-[320px] max-w-[90vw]"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
