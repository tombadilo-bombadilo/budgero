import { useState } from 'react';
import { Sprout } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { useUiStore } from '@shared/store/useUiStore';
import { useAddAccount, type AddAccountInput } from '@entities/account/api/useAccounts';
import { fromDecimal, ZERO_MILLI, type MilliUnits } from '@shared/lib/currency/milli';
import { getErrorMessage } from '@shared/lib/errors';

/**
 * Dev-only QA helper. Bulk-creates fake accounts so you can scope out the
 * sidebar / accounts page with a realistic long account list (e.g. a user with
 * ~50 accounts) without adding them by hand.
 *
 * Gated by `import.meta.env.DEV` at the call site, the same way the trial-reward
 * dev tools are — in production builds this whole module is dead-code-eliminated.
 * Account creation runs entirely through the client runtime (encryption-aware),
 * so there's no server flag to flip.
 */

type SeedSpec = { name: string; type: string; onBudget: boolean; liabilityType?: string };

// Building blocks that resemble a real, account-heavy budget (sinking funds,
// a wall of credit cards, a few off-budget investment/retirement accounts).
const SINKING_FUNDS = [
  'Supplements',
  'Home Maintenance',
  'Clothing',
  'Holiday Shopping',
  'Homeschooling',
  'Home Taxes',
  'CSA & Meat',
  'New Car Fund',
  'New House Payment',
  'Vacation',
  'Medical',
  'Gifts',
  'Car Repairs',
  'Pet Care',
  'Tech & Gadgets',
  'Date Night',
];
const CREDIT_CARDS = [
  'Delta Amex',
  'JetBlue Mastercard',
  'Amazon Store Card',
  'Target Mastercard',
  'Synchrony Mastercard',
  'PayPal Credit',
  'Apple Mastercard',
  'Discover Card',
  'Chase Sapphire',
  'Citi Double Cash',
];
const INVESTMENTS = ['Traditional IRA', 'Roth IRA', 'ACV Vested RSUs', 'Brokerage', '529 Plan'];

function buildSeedSpecs(count: number): SeedSpec[] {
  const specs: SeedSpec[] = [];

  // A couple of everyday checking/cash accounts up top.
  specs.push({ name: 'ESL - Joint Checking', type: 'Checking', onBudget: true });
  specs.push({ name: 'M&T Bank', type: 'Checking', onBudget: true });
  specs.push({ name: 'Schwab Bank', type: 'Savings', onBudget: true });
  specs.push({ name: 'HSA Bank', type: 'Savings', onBudget: true });
  specs.push({ name: 'Apple Savings', type: 'Savings', onBudget: true });
  specs.push({ name: 'Wallet Cash', type: 'Cash', onBudget: true });

  // Sinking-fund savings accounts (the "ESL - X" wall).
  for (const fund of SINKING_FUNDS) {
    specs.push({ name: `ESL - ${fund}`, type: 'Savings', onBudget: true });
  }

  // Credit cards.
  for (const card of CREDIT_CARDS) {
    specs.push({ name: card, type: 'Credit', onBudget: true, liabilityType: 'credit' });
  }

  // Off-budget investments / retirement.
  for (const inv of INVESTMENTS) {
    const type = inv.includes('RSU') || inv.includes('Brokerage') ? 'Investment' : 'Retirement';
    specs.push({ name: inv, type, onBudget: false });
  }

  // A loan and some tracking assets to round out the off-budget section.
  specs.push({ name: 'Toyota Auto Loan', type: 'Loan', onBudget: false, liabilityType: 'loan' });
  specs.push({
    name: 'Home Mortgage',
    type: 'Mortgage',
    onBudget: false,
    liabilityType: 'mortgage',
  });
  specs.push({ name: 'Primary Residence', type: 'Real Estate', onBudget: false });
  specs.push({ name: '2019 Toyota Sienna', type: 'Other Asset', onBudget: false });

  // If the requested count exceeds the curated pool, top up with numbered
  // sinking funds so names stay unique.
  let extra = 1;
  while (specs.length < count) {
    specs.push({ name: `ESL - Sinking Fund ${extra}`, type: 'Savings', onBudget: true });
    extra += 1;
  }

  return specs.slice(0, count);
}

function randomBalance(): MilliUnits {
  // 50 – 25,000 currency units, milliunit precision.
  return fromDecimal(50 + Math.random() * 24_950);
}

export function DevSeedAccountsButton() {
  const selectedBudget = useUiStore((s) => s.selectedBudget);
  const addAccount = useAddAccount();
  const [count, setCount] = useState(40);
  const [progress, setProgress] = useState<number | null>(null);

  const running = progress !== null;
  const budgetId = selectedBudget?.ID;
  const currency = selectedBudget?.DisplayCurrency || 'USD';

  const handleSeed = async () => {
    if (!budgetId) {
      toast.error('No budget selected');
      return;
    }
    const specs = buildSeedSpecs(Math.max(1, Math.min(200, count)));
    setProgress(0);
    let created = 0;
    try {
      // Sequential on purpose: each create may spin up shared category groups
      // (Income / Transfers / CC Payments) and writes locally — running them in
      // parallel races those reads.
      for (const spec of specs) {
        const metadata: Record<string, unknown> = spec.liabilityType
          ? {
              liability: true,
              liability_type: spec.liabilityType,
              debt_total: randomBalance(),
            }
          : {};
        const input: AddAccountInput = {
          name: spec.name,
          budget_id: budgetId,
          type: spec.type,
          currency,
          balance: spec.liabilityType ? ZERO_MILLI : randomBalance(),
          metadata,
          on_budget: spec.onBudget,
        };
        await addAccount.mutateAsync(input);
        created += 1;
        setProgress(created);
      }
      toast.success(`Seeded ${created} accounts`);
    } catch (err) {
      toast.error(`Stopped after ${created}: ${getErrorMessage(err, 'unknown error')}`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="flex items-center gap-1.5 rounded-md border border-dashed border-amber-600/50 bg-amber-50/30 px-1.5 py-1 dark:bg-amber-950/10">
      <Input
        type="number"
        min={1}
        max={200}
        value={count}
        onChange={(e) => setCount(Number(e.target.value))}
        disabled={running}
        className="h-8 w-16"
        aria-label="Number of accounts to seed"
      />
      <Button
        size="sm"
        variant="outline"
        onClick={handleSeed}
        disabled={running}
        className="gap-1.5"
      >
        <Sprout className="h-4 w-4" />
        {running ? `Seeding ${progress}/${count}…` : 'Seed accounts'}
      </Button>
    </div>
  );
}
