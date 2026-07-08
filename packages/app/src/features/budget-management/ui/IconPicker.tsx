import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Label } from '@shared/ui/label';
import { iconOptions } from '@features/budget-management/model/icon-options';

interface IconPickerProps {
  value: string;
  onValueChange: (val: string) => void;
  label?: string;
}

export const IconPicker: React.FC<IconPickerProps> = ({ value, onValueChange, label }) => {
  // Let React Compiler handle this optimization automatically
  const selectedIcon = iconOptions.find((icon) => icon.value === value);

  return (
    <div className="flex flex-col space-y-1">
      {label && (
        <Label htmlFor="icon-picker" className="text-xs sm:text-sm">
          {label}
        </Label>
      )}
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger size="sm" className="w-full" data-testid="select-icon-trigger">
          <SelectValue placeholder="Select icon">
            {selectedIcon && (
              <div className="flex items-center">
                <selectedIcon.component className="w-4 h-4" />
                <span className="ml-2">{selectedIcon.label}</span>
              </div>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {iconOptions.map((icon) => (
            <SelectItem key={icon.value} value={icon.value}>
              <div className="flex items-center">
                <icon.component className="w-4 h-4" />
                <span className="ml-2">{icon.label}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
