'use client';

import React, { useId } from 'react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@shared/ui/select';
import { formatOptions } from '@shared/lib/number-format';

interface FormatSelectorProps {
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
  currency: string;
}

export const FormatSelector: React.FC<FormatSelectorProps> = ({
  value,
  onValueChange,
  label = 'Number Format',
  currency,
}) => {
  const triggerId = useId();
  // Let React Compiler handle this optimization automatically
  const formattedOptions = formatOptions.map((option) => {
    const formatter = new Intl.NumberFormat(option.settings.locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: option.settings.fractionDigits,
      maximumFractionDigits: option.settings.fractionDigits,
      useGrouping: option.settings.useGrouping,
    });
    return {
      key: option.key,
      formattedValue: formatter.format(1096.56),
    };
  });

  return (
    <div className="space-y-1">
      <label htmlFor={triggerId} className="block text-xs sm:text-sm font-medium">
        {label}
      </label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={triggerId} size="sm" className="w-full">
          <SelectValue placeholder="Select format" />
        </SelectTrigger>
        <SelectContent>
          {formattedOptions.map((option) => (
            <SelectItem key={option.key} value={option.key}>
              {option.formattedValue}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
