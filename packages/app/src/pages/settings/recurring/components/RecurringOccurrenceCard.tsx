import { formatDistanceToNow, parseISO } from 'date-fns';
import { Card, CardContent } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Badge } from '@shared/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@shared/ui/alert-dialog';
import { Loader2, Sparkles } from 'lucide-react';
import type { RecurringOccurrenceWithTemplate } from '@budgero/core/browser';
import { formatRecurringAmount } from './format-recurring-amount';

interface RecurringOccurrenceCardProps {
  occurrence: RecurringOccurrenceWithTemplate;
  accountName: string;
  toAccountName?: string;
  categoryName: string;
  localizer: { format: (n: number) => string };
  isProcessing: boolean;
  isMarkReadyPending: boolean;
  isSkipPending: boolean;
  isFetching: boolean;
  onMarkReady: () => void;
  onSkip: () => void;
}

export function RecurringOccurrenceCard({
  occurrence,
  accountName,
  toAccountName,
  categoryName,
  localizer,
  isProcessing,
  isMarkReadyPending,
  isSkipPending,
  isFetching,
  onMarkReady,
  onSkip,
}: RecurringOccurrenceCardProps) {
  const { template } = occurrence;
  const amountDisplay = formatRecurringAmount(template, localizer);
  const dueDate = parseISO(occurrence.dueDate);
  const dueLabel = formatDistanceToNow(dueDate, { addSuffix: true });

  return (
    <Card className="relative">
      <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant={template.direction === 'inflow' ? 'default' : 'secondary'}>
              {template.toAccountId != null
                ? 'Transfer'
                : template.direction === 'inflow'
                  ? 'Income'
                  : 'Bill'}
            </Badge>
            <span className="text-sm text-muted-foreground">{template.name}</span>
          </div>
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Due:</span> {occurrence.dueDate} (
            {dueLabel})
          </div>
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Amount:</span> {amountDisplay}
          </div>
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {template.toAccountId != null ? 'From account:' : 'Account:'}
            </span>{' '}
            {accountName}
          </div>
          {template.toAccountId != null ? (
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">To account:</span>{' '}
              {toAccountName ?? 'Unknown account'}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Category:</span> {categoryName}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" disabled={isProcessing || isMarkReadyPending || isFetching}>
                {isProcessing && isMarkReadyPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                Mark ready
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Mark “{template.name}” as ready?</AlertDialogTitle>
                <AlertDialogDescription>
                  We will create the transaction dated {occurrence.dueDate} and run continuous rules
                  automatically.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onMarkReady}>Post transaction</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            disabled={isProcessing || isSkipPending || isFetching}
            onClick={onSkip}
          >
            Skip this time
          </Button>
        </div>
        {(isProcessing || isFetching) && (
          <div className="absolute inset-0 rounded-xl bg-background/70 backdrop-blur-sm" />
        )}
      </CardContent>
    </Card>
  );
}
