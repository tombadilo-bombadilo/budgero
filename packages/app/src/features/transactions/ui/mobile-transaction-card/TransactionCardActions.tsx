import React from 'react';
import { Button } from '@shared/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface TransactionCardActionsProps {
  isExpanded: boolean;
  onToggleExpanded: () => void;
}

export const TransactionCardActions = React.memo(function TransactionCardActions({
  isExpanded,
  onToggleExpanded,
}: TransactionCardActionsProps) {
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggleExpanded}
        className="h-6 w-6 p-0"
        aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
      >
        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </Button>
    </div>
  );
});
