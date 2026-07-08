import { Fragment } from 'react';
import { Button } from '@shared/ui/button';
import { Card } from '@shared/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { Calendar as CalendarIcon, Image, Pencil, StickyNote, Trash2 } from 'lucide-react';
import { formatCurrency } from '@entities/currency/lib/currency-utils';
import { toDecimal } from '@budgero/core/browser';
import type { Warranty } from '@budgero/core/browser';
import { getStatus, StatusBadge } from './StatusBadge';

interface WarrantyTableProps {
  warranties: Warranty[];
  currencyCode: string;
  expandedNotes: Set<number>;
  onToggleNotes: (id: number) => void;
  transactionLabel: (transactionId: number | null) => string;
  onEdit: (w: Warranty) => void;
  onDelete: (w: Warranty) => void;
  onViewReceipt: (receipt: Uint8Array) => void;
}

/** Desktop table view of warranties (matches the accounts convention). */
export function WarrantyTable({
  warranties,
  currencyCode,
  expandedNotes,
  onToggleNotes,
  transactionLabel,
  onEdit,
  onDelete,
  onViewReceipt,
}: WarrantyTableProps) {
  return (
    <Card className="hidden md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Expiry Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Transaction</TableHead>
            <TableHead>Receipt</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {warranties.map((w) => {
            const status = getStatus(w.ExpiresAt);
            const hasNotes = w.Notes.trim().length > 0;
            const notesExpanded = expandedNotes.has(w.ID);
            return (
              <Fragment key={w.ID}>
                <TableRow>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{w.Name}</span>
                      {hasNotes && (
                        <button
                          onClick={() => onToggleNotes(w.ID)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="Toggle notes"
                        >
                          <StickyNote className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {w.Amount > 0 ? formatCurrency(toDecimal(w.Amount), currencyCode) : '—'}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1">
                      <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      {w.ExpiresAt}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={status} />
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                    {transactionLabel(w.TransactionID)}
                  </TableCell>
                  <TableCell>
                    {w.ReceiptImage ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => w.ReceiptImage && onViewReceipt(w.ReceiptImage)}
                      >
                        <Image className="h-4 w-4" />
                      </Button>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => onEdit(w)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => onDelete(w)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {hasNotes && notesExpanded && (
                  <TableRow>
                    <TableCell colSpan={7} className="pt-0 pb-3">
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap pl-1">
                        {w.Notes}
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
