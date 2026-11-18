import { useLingui } from '@lingui/react/macro';
import { Badge } from '@shared/ui/badge';
import type { RecurringTransaction } from '@budgero/core/browser';

export function RecurringKindBadge({ template }: { template: RecurringTransaction }) {
  const { t } = useLingui();
  const isTransfer = template.toAccountId != null;
  const isInflow = template.direction === 'inflow';

  return (
    <Badge
      variant={isInflow && !isTransfer ? 'default' : 'secondary'}
      className="px-1.5 py-0 text-[0.625rem]"
    >
      {isTransfer ? t`Transfer` : isInflow ? t`Income` : t`Bill`}
    </Badge>
  );
}
