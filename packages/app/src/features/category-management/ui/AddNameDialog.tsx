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

interface AddNameDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  isSaving?: boolean;
  title: string;
  description: string;
  inputId: string;
  labelText: string;
  placeholder: string;
  savingLabel: string;
  confirmLabel: string;
}

export const AddNameDialog: React.FC<AddNameDialogProps> = ({
  open,
  onClose,
  onSave,
  isSaving = false,
  title,
  description,
  inputId,
  labelText,
  placeholder,
  savingLabel,
  confirmLabel,
}) => {
  const [name, setName] = useState('');

  useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        setName('');
      });
    }
  }, [open]);

  const handleSave = () => {
    if (!name.trim()) {
      return;
    }
    onSave(name.trim());
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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor={inputId}>{labelText}</Label>
            <Input
              id={inputId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={placeholder}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !name.trim()}>
            {isSaving ? savingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
