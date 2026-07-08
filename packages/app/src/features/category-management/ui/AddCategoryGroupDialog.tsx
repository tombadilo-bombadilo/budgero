import React from 'react';
import { AddNameDialog } from './AddNameDialog';

interface AddCategoryGroupDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  isSaving?: boolean;
}

export const AddCategoryGroupDialog: React.FC<AddCategoryGroupDialogProps> = (props) => (
  <AddNameDialog
    {...props}
    title="Add Category Group"
    description="Create a new category group to organize your budget categories"
    inputId="group-name"
    labelText="Group Name"
    placeholder="e.g., Monthly Bills"
    savingLabel="Creating..."
    confirmLabel="Create Group"
  />
);
