import * as React from 'react';
import { LabelCombobox } from '@features/labels/ui/LabelCombobox';

interface LabelSelectCellProps {
  budgetId: number;
  value?: number | null;
  onCommit: (newLabelId: number | null) => void;
  triggerClassName?: string;
  allowClear?: boolean;
}

export function LabelSelectCell({
  budgetId,
  value,
  onCommit,
  triggerClassName,
  allowClear = true,
}: LabelSelectCellProps) {
  const handleChange = React.useCallback(
    (next: number | null) => {
      if ((value ?? null) === next) {
        return;
      }
      onCommit(next);
    },
    [onCommit, value]
  );

  return (
    <LabelCombobox
      budgetId={budgetId}
      value={value ?? null}
      onChange={handleChange}
      triggerClassName={triggerClassName}
      allowClear={allowClear}
    />
  );
}
