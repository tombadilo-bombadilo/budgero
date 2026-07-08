/**
 * Split Editor Component
 *
 * Inline editor for split transactions with multiple category assignments.
 */

import { Split } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { CalculatorCell } from '@shared/ui/calculator-cell';
import { SearchableCategorySelect } from '@features/category-management/ui/SearchableCategorySelect';
import { asMilli, formatMilli, ZERO_MILLI, type MilliUnits } from '@shared/lib/currency/milli';

export interface SplitLine {
  id: string;
  categoryId?: number | null;
  memo?: string;
  /** Positive amount in integer milliunits. */
  amount: MilliUnits;
  transferAccountId?: number | null;
}

interface SplitEditorProps {
  budgetId: number;
  isSplit: boolean;
  onToggleSplit: () => void;
  splitLines: SplitLine[];
  onSplitLinesChange: (lines: SplitLine[]) => void;
  /** Milliunits. */
  remaining: number;
  /** Milliunits. */
  parentAmount: number;
  formatter: Intl.NumberFormat;
}

export function SplitEditor({
  budgetId,
  isSplit,
  onToggleSplit,
  splitLines,
  onSplitLinesChange,
  remaining,
  parentAmount,
  formatter,
}: SplitEditorProps) {
  const updateLine = (id: string, updates: Partial<SplitLine>) => {
    onSplitLinesChange(splitLines.map((l) => (l.id === id ? { ...l, ...updates } : l)));
  };

  const deleteLine = (id: string) => {
    onSplitLinesChange(splitLines.filter((l) => l.id !== id));
  };

  const addLine = () => {
    onSplitLinesChange([
      ...splitLines,
      { id: crypto.randomUUID(), categoryId: undefined, memo: '', amount: ZERO_MILLI },
    ]);
  };

  const splitRemaining = () => {
    // Exact integer milliunit arithmetic throughout.
    const delta = remaining;
    if (splitLines.length === 0) {
      onSplitLinesChange([
        {
          id: crypto.randomUUID(),
          amount: asMilli(Math.abs(parentAmount)),
          memo: '',
          categoryId: undefined,
        },
      ]);
    } else {
      onSplitLinesChange(
        splitLines.map((l, i) =>
          i === splitLines.length - 1
            ? { ...l, amount: asMilli((l.amount || 0) + Math.abs(delta)) }
            : l
        )
      );
    }
  };

  return (
    <div className="space-y-1.5 sm:space-y-2">
      <div className="flex items-center gap-2">
        <Split className="h-4 w-4 text-muted-foreground" />
        <Button
          variant="outline"
          size="sm"
          className="h-8 sm:h-10 w-full flex-1"
          type="button"
          onClick={onToggleSplit}
        >
          {isSplit ? 'Disable Split' : 'Enable Split'}
        </Button>
      </div>

      {isSplit && (
        <div className="space-y-2 sm:space-y-3 border rounded-md p-2 sm:p-3">
          <div className="flex items-center justify-between text-[11px] sm:text-xs text-muted-foreground">
            <span>Remaining to assign</span>
            <span className="font-mono">{formatMilli(formatter, asMilli(remaining))}</span>
          </div>

          {splitLines.map((line) => (
            <div key={line.id} className="grid grid-cols-1 gap-2 items-center">
              <div>
                <SearchableCategorySelect
                  budgetId={budgetId}
                  selectedCategoryId={line.categoryId || null}
                  onCategorySelect={(categoryId) => {
                    updateLine(line.id, { categoryId, transferAccountId: undefined });
                  }}
                  placeholder="Category"
                  triggerClassName="w-full h-8 sm:h-9"
                  popoverContentClassName="w-[320px] max-w-[90vw]"
                />
              </div>
              <div>
                <Input
                  value={line.memo || ''}
                  onChange={(e) => updateLine(line.id, { memo: e.target.value })}
                  placeholder="Memo"
                  className="h-8 sm:h-9"
                />
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <CalculatorCell
                    value={line.amount}
                    onCommit={(val) => updateLine(line.id, { amount: val })}
                    formatter={(val) => formatter.format(val)}
                    localizer={formatter}
                    inputAlign="left"
                    placeholder="0.00"
                    className=""
                    inputClassName="h-8 sm:h-9"
                    displayClassName="bg-background border-input hover:bg-muted/40 px-2 py-1 rounded-md"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="whitespace-nowrap h-8"
                  type="button"
                  onClick={() => deleteLine(line.id)}
                >
                  <span className="hidden sm:inline">Delete</span>
                  <span className="sm:hidden inline">Del</span>
                </Button>
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2 pt-1">
            <Button variant="outline" size="sm" className="h-8" type="button" onClick={addLine}>
              + Line
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              type="button"
              onClick={splitRemaining}
            >
              Split remaining
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
