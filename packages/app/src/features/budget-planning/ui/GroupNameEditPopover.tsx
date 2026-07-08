/**
 * Group Name Edit Popover
 *
 * Popover for renaming or deleting a category group, shared by the mobile
 * group-row layouts and the desktop table's group row. The trigger is passed
 * as children since its styling differs per layout.
 */

import type { ReactNode } from 'react';
import { Trash } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';

export interface GroupNameEditPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The name currently being edited. */
  name: string;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onDelete: () => void;
  isUpdating: boolean;
  isDeleting: boolean;
  align?: 'start' | 'center' | 'end';
  /** The popover trigger element (rendered via asChild). */
  children: ReactNode;
}

export function GroupNameEditPopover({
  open,
  onOpenChange,
  name,
  onNameChange,
  onSave,
  onDelete,
  isUpdating,
  isDeleting,
  align,
  children,
}: GroupNameEditPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-80" align={align}>
        <div className="flex flex-col gap-4">
          <Input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="w-full"
            placeholder="Group name"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onSave();
              }
            }}
          />
          <div className="flex items-center justify-between">
            <Button
              variant="destructive"
              size="sm"
              className="flex items-center gap-1"
              onClick={onDelete}
              disabled={isDeleting}
            >
              <Trash className="h-4 w-4" />
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>

            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={onSave} size="sm" disabled={isUpdating}>
                {isUpdating ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
