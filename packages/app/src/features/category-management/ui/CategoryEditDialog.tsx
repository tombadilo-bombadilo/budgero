import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Switch } from '@shared/ui/switch';
import { toast } from 'sonner';

interface CategoryEditDialogProps {
  open: boolean;
  onClose: () => void;
  categoryName: string;
  excludeFromBudgetPace: boolean;
  onSave: (name: string, excludeFromBudgetPace: boolean) => void;
  isSaving?: boolean;
}

export const CategoryEditDialog: React.FC<CategoryEditDialogProps> = ({
  open,
  onClose,
  categoryName,
  excludeFromBudgetPace,
  onSave,
  isSaving = false,
}) => {
  const [name, setName] = useState(categoryName);
  const [exclude, setExclude] = useState(excludeFromBudgetPace);

  useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        setName(categoryName);
        setExclude(excludeFromBudgetPace);
      });
    }
  }, [open, categoryName, excludeFromBudgetPace]);

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('Category name cannot be empty');
      return;
    }

    onSave(name.trim(), exclude);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] max-w-md mx-auto">
        <DialogHeader>
          <DialogTitle>Edit Category</DialogTitle>
          <DialogDescription>Update the category name and budget pace settings.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="category-name">Category Name</Label>
            <Input
              id="category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter category name"
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>

          <div className="flex items-center justify-between space-x-2">
            <div className="space-y-0.5">
              <Label htmlFor="exclude-budget-pace" className="text-sm font-medium">
                Exclude from Budget Pace
              </Label>
              <p className="text-xs text-muted-foreground">
                When enabled, this category won't show budget pace lines in spending charts
              </p>
            </div>
            <Switch id="exclude-budget-pace" checked={exclude} onCheckedChange={setExclude} />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
