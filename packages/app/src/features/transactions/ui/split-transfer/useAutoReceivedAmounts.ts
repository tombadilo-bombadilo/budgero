import * as React from 'react';
import { convertScaled } from '@budgero/core/browser';
import { getExchangeRate } from '@entities/currency/lib/currency-utils';
import {
  needsReceivedAmount,
  type SplitTransferAccount,
} from '@features/transactions/lib/split-transfer';

/** How the hook reads a split editor's line (each editor keeps its own shape). */
export interface ReceivedLineAccess<L> {
  target: (line: L) => number | null | undefined;
  /** The line's amount (magnitude) in the editor's currency. */
  amount: (line: L) => number;
  received: (line: L) => number | null | undefined;
  /** false once the user typed an amount (or it was entered before). */
  auto: (line: L) => boolean;
  /** The line amount the stored received amount belongs to (lines loaded from a save). */
  base?: (line: L) => number | null | undefined;
}

interface Options<L> {
  lines: readonly L[] | null;
  access: ReceivedLineAccess<L>;
  /** Called with the auto lines whose estimate changed (line index → received amount). */
  onEstimates: (estimates: ReadonlyMap<number, number>) => void;
  accounts: readonly SplitTransferAccount[];
  /** The parent account's currency (decides which lines ask). */
  parentCurrency: string | null | undefined;
  /** Currency of the line amounts the editor shows. */
  amountCurrency: string | null | undefined;
  date: string;
  budgetId: number;
}

/**
 * Prefills the "Received in" amount of a split editor's transfer lines to an
 * account in another currency: the line amount at the exchange rate of the
 * parent's date, until the user types one. A line loaded with its stored
 * amount keeps it while its own amount is unchanged.
 */
export function useAutoReceivedAmounts<L>({
  lines,
  access,
  onEstimates,
  accounts,
  parentCurrency,
  amountCurrency,
  date,
  budgetId,
}: Options<L>): void {
  const [rates, setRates] = React.useState<Record<string, number | null>>({});

  const targetOf = (line: L) => {
    const id = access.target(line);
    const account = id ? accounts.find((candidate) => candidate.ID === Number(id)) : undefined;
    return account && needsReceivedAmount(parentCurrency, account) ? account : undefined;
  };
  const rateKey = (currency: string) => `${amountCurrency}:${currency}:${date}`;

  // The rates the auto lines need (one key per target currency).
  const wanted = new Set<string>();
  for (const line of lines ?? []) {
    const target = targetOf(line);
    if (amountCurrency && target?.Currency && access.auto(line))
      wanted.add(rateKey(target.Currency));
  }
  const wantedKey = [...wanted].sort().join('|');

  React.useEffect(() => {
    const missing = wantedKey ? wantedKey.split('|').filter((key) => !(key in rates)) : [];
    if (!missing.length || !budgetId) return;
    let cancelled = false;
    void Promise.all(
      missing.map(async (key) => {
        const [from, to, day] = key.split(':');
        try {
          return [key, await getExchangeRate(from, to, day, budgetId)] as const;
        } catch {
          return [key, null] as const;
        }
      })
    ).then((entries) => {
      if (!cancelled) setRates((previous) => ({ ...previous, ...Object.fromEntries(entries) }));
    });
    return () => {
      cancelled = true;
    };
  }, [wantedKey, rates, budgetId]);

  // Auto lines whose estimate differs from what they hold (none once in step).
  const estimates = new Map<number, number>();
  (lines ?? []).forEach((line, index) => {
    const target = targetOf(line);
    if (!amountCurrency || !target?.Currency || !access.auto(line)) return;
    const amount = access.amount(line);
    if (!amount) return;
    const stored = access.received(line);
    if (stored && access.base?.(line) === amount) return;
    const rate = rates[rateKey(target.Currency)];
    if (!rate) return;
    const estimate = convertScaled(amount, rate, amountCurrency, target.Currency);
    if (estimate > 0 && estimate !== stored) estimates.set(index, estimate);
  });
  const estimatesKey = [...estimates].map(([index, value]) => `${index}=${value}`).join(',');

  // Each set of estimates is applied once (the lines then hold them).
  const applied = React.useRef('');
  React.useEffect(() => {
    if (!estimatesKey || applied.current === estimatesKey) return;
    applied.current = estimatesKey;
    onEstimates(
      new Map(
        estimatesKey.split(',').map((entry) => entry.split('=').map(Number) as [number, number])
      )
    );
  }, [estimatesKey, onEstimates]);
}
