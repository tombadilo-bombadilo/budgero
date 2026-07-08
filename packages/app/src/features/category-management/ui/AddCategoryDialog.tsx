import React from 'react';
import { AddNameDialog } from './AddNameDialog';

interface AddCategoryDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  isSaving?: boolean;
}

export const AddCategoryDialog: React.FC<AddCategoryDialogProps> = (props) => (
  <AddNameDialog
    {...props}
    title="Add Category"
    description="Create a new category in this group"
    inputId="category-name"
    labelText="Category Name"
    placeholder="e.g., Groceries"
    savingLabel="Creating..."
    confirmLabel="Create Category"
  />
);
