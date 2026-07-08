import { Button } from '@shared/ui/button';
import { Card, CardContent } from '@shared/ui/card';
import { Calendar as CalendarIcon, Image, Pencil, StickyNote, Trash2 } from 'lucide-react';
import { cn } from '@shared/lib/utils';
import { formatCurrency } from '@entities/currency/lib/currency-utils';
import { toDecimal } from '@budgero/core/browser';
import type { Warranty } from '@budgero/core/browser';
import { getStatus, StatusBadge } from './StatusBadge';

interface WarrantyCardProps {
  warranty: Warranty;
  currencyCode: string;
  notesExpanded: boolean;
  onToggleNotes: (id: number) => void;
  transactionLabel: (transactionId: number | null) => string;
  onEdit: (w: Warranty) => void;
  onDelete: (w: Warranty) => void;
  onViewReceipt: (receipt: Uint8Array) => void;
}

/** Mobile card view of a single warranty (matches the accounts convention). */
export function WarrantyCard({
  warranty: w,
  currencyCode,
  notesExpanded,
  onToggleNotes,
  transactionLabel,
  onEdit,
  onDelete,
  onViewReceipt,
}: WarrantyCardProps) {
  const status = getStatus(w.ExpiresAt);
  const hasNotes = w.Notes.trim().length > 0;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{w.Name}</span>
              <StatusBadge status={status} />
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <CalendarIcon className="h-3.5 w-3.5" />
                {w.ExpiresAt}
              </span>
              {w.Amount > 0 && (
                <span className="font-medium text-foreground">
                  {formatCurrency(toDecimal(w.Amount), currencyCode)}
                </span>
              )}
            </div>
            {w.TransactionID != null && (
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {transactionLabel(w.TransactionID)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {w.ReceiptImage && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => w.ReceiptImage && onViewReceipt(w.ReceiptImage)}
              >
                <Image className="h-4 w-4" />
              </Button>
            )}
            {hasNotes && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => onToggleNotes(w.ID)}
              >
                <StickyNote className={cn('h-4 w-4', notesExpanded && 'text-primary')} />
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => onEdit(w)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => onDelete(w)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
        {hasNotes && notesExpanded && (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-2 pt-2 border-t">
            {w.Notes}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
