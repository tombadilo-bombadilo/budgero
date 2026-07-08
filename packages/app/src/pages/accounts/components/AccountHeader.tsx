import React from 'react';
import { Badge } from '@shared/ui/badge';
import { CalendarClock, type LucideIcon } from 'lucide-react';

export interface AccountHeaderProps {
  accountName: string;
  accountType: string;
  accountCurrency: string;
  reconciledAt: string | null | undefined;
  AccountIcon: LucideIcon;
}

export const AccountHeader = React.memo(function AccountHeader({
  accountName,
  accountType,
  accountCurrency,
  reconciledAt,
  AccountIcon,
}: AccountHeaderProps) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <AccountIcon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold text-foreground truncate">{accountName}</h1>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
            {accountType}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{accountCurrency}</span>
          {reconciledAt && (
            <>
              <span className="text-border">·</span>
              <span className="flex items-center gap-1">
                <CalendarClock className="w-3 h-3" />
                Reconciled {new Date(reconciledAt).toLocaleDateString()}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
});
