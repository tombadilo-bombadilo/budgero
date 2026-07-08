/**
 * Transaction Type Selector Component
 *
 * Tabs for selecting transaction type: Income, Expense, or Transfer.
 * Supports swipe gestures on mobile for switching between types.
 */

import { useEffect, useState } from 'react';
import { ArrowDownUp } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@shared/ui/tabs';
import { useSwipeable } from 'react-swipeable';

export type TransactionType = 'inflow' | 'outflow' | 'transfer';

interface TransactionTypeSelectorProps {
  value: TransactionType;
  onChange: (value: TransactionType) => void;
}

const TAB_ORDER: TransactionType[] = ['inflow', 'outflow', 'transfer'];

export function TransactionTypeSelector({ value, onChange }: TransactionTypeSelectorProps) {
  const [enableSwipe, setEnableSwipe] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mql = window.matchMedia('(hover: none) and (pointer: coarse)');
    const update = () => setEnableSwipe(mql.matches || window.innerWidth < 768);
    update();

    mql.addEventListener?.('change', update);
    const onResize = () => update();
    window.addEventListener('resize', onResize);

    return () => {
      mql.removeEventListener?.('change', update);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => {
      const idx = TAB_ORDER.indexOf(value);
      if (idx < TAB_ORDER.length - 1) {
        const next = TAB_ORDER[idx + 1];
        onChange(next);
        if (navigator.vibrate) navigator.vibrate(8);
      }
    },
    onSwipedRight: () => {
      const idx = TAB_ORDER.indexOf(value);
      if (idx > 0) {
        const prev = TAB_ORDER[idx - 1];
        onChange(prev);
        if (navigator.vibrate) navigator.vibrate(8);
      }
    },
    preventScrollOnSwipe: true,
    trackTouch: true,
    delta: 20,
  });

  return (
    <div
      className="space-y-1.5 sm:space-y-2"
      {...(enableSwipe ? swipeHandlers : {})}
      style={enableSwipe ? { touchAction: 'pan-y' } : undefined}
    >
      <Tabs
        value={value}
        onValueChange={(v: string) => onChange(v as TransactionType)}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-3 gap-1 bg-transparent h-auto p-1">
          <TabsTrigger
            value="inflow"
            data-testid="transaction-type-inflow"
            className="data-[state=active]:bg-success/10 data-[state=active]:text-success data-[state=active]:border-success/20 data-[state=active]:shadow-sm rounded-md border border-transparent py-1.5 px-2 sm:py-2 sm:px-3 text-xs sm:text-sm transition-all duration-200 hover:bg-muted"
          >
            <span className="mr-1 sm:mr-2 font-semibold text-base leading-none">+</span>
            <span className="hidden sm:inline">Income</span>
          </TabsTrigger>
          <TabsTrigger
            value="outflow"
            data-testid="transaction-type-outflow"
            className="data-[state=active]:bg-destructive/10 data-[state=active]:text-destructive data-[state=active]:border-destructive/20 data-[state=active]:shadow-sm rounded-md border border-transparent py-1.5 px-2 sm:py-2 sm:px-3 text-xs sm:text-sm transition-all duration-200 hover:bg-muted"
          >
            <span className="mr-1 sm:mr-2 font-semibold text-base leading-none">−</span>
            <span className="hidden sm:inline">Expense</span>
          </TabsTrigger>
          <TabsTrigger
            value="transfer"
            data-testid="transaction-type-transfer"
            className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border-primary/20 data-[state=active]:shadow-sm rounded-md border border-transparent py-1.5 px-2 sm:py-2 sm:px-3 text-xs sm:text-sm transition-all duration-200 hover:bg-muted"
          >
            <ArrowDownUp className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
            <span className="hidden sm:inline">Transfer</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
