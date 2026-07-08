/**
 * Maps successful op-code executions to trial-rewards behavior signals.
 *
 * Called from the central executeMutationOp runner after a mutation succeeds.
 * Selective: most ops produce no signal. The mapping intentionally errs on
 * the side of *not* firing — the rewards system tolerates missing signals
 * (tier eval is idempotent on each new signal) but spurious signals would
 * let users earn tiers they didn't actually qualify for.
 *
 * Tier criteria mapping (current spec):
 *   T1 — Foundation: 5 transactions logged (counted via transaction_in_month)
 *   T2 — Discipline: T1 + reconciliation + goal funded
 *   T3 — Persistence: T2 + ≥21 days + crossed signup_month + activity in
 *        ≥2 distinct calendar months (assignments AND transactions)
 *
 * Goal-funded detection: after every monthlyBudgets.upsertAssignment we
 * read the affected category's goal (if any) and the current monthly row.
 * If (Available + Activity) ≥ goal.Target the category is "fully funded"
 * per the budget-planner UI's own check, and we fire goal_funded.
 */

import { S } from '@shared/mutations/op-code-registry/shared';
import { reportTrialSignal, type TrialSignalKind } from './trial-signals';

interface MonthlyBudgetRowLike {
  CategoryID?: number;
  category_id?: number;
  categoryId?: number;
  Available?: number;
  available?: number;
  Activity?: number;
  activity?: number;
}

/** YYYY-MM-DD or YYYY-MM string → YYYY-MM. Returns '' when unparseable. */
function toYearMonth(s: unknown): string {
  if (typeof s !== 'string' || s.length < 7) return '';
  const m = s.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(m) ? m : '';
}

export function dispatchTrialSignalForOp(
  op: string,
  args: Record<string, unknown>,
  _result: unknown
): void {
  switch (op) {
    case 'transactions.add': {
      // T1: counts as a daily-logging day (debounced to one per UTC day).
      reportTrialSignal('daily_logging');
      // T3: track which calendar month the transaction is dated for.
      const month = toYearMonth(args.date);
      if (month) reportTrialSignal('transaction_in_month', month);
      return;
    }

    case 'transactions.updateColumn': {
      // Categorizing a (typically imported) transaction counts as logging.
      // We don't know the transaction's date from the args here, so we
      // don't fire transaction_in_month for category updates — only for
      // fresh additions.
      const col = String(args.columnName ?? '').toLowerCase();
      if (col === 'categoryid' || col === 'category_id') {
        reportTrialSignal('daily_logging');
      }
      return;
    }

    case 'transactions.reconcile':
      reportTrialSignal('reconciliation');
      return;

    case 'monthlyBudgets.upsertAssignment': {
      const month = toYearMonth(args.month);
      if (month) reportTrialSignal('assignment_in_month', month);
      void detectGoalFunded(args, month);
      return;
    }

    case 'monthlyBudgets.batchUpsertAssignments': {
      // Each assignment in the batch can be in a different month. Fire one
      // signal per distinct month. Goal-funded detection is best-effort
      // skipped here — batch flows are rare in normal user actions.
      const list = (args.assignments as { month?: string }[] | undefined) ?? [];
      const seenMonths = new Set<string>();
      for (const a of list) {
        const m = toYearMonth(a?.month);
        if (m) seenMonths.add(m);
      }
      for (const m of seenMonths) {
        reportTrialSignal('assignment_in_month', m);
      }
      return;
    }

    default:
      return;
  }
}

/**
 * After a successful upsertAssignment, check if the affected category has a
 * goal that's now in a "good" state. Uses the goal service's own
 * calculateGoalProgressByCategoryId — the same calculation that powers the
 * UI's "This month's target met!" callout — so the rules around yearly /
 * monthly / target-date goals all match what the user already sees.
 *
 * Fires goal_funding when the goal is on track OR fully funded. Server-side
 * `(user, kind, day)` PK collapses repeats; the tier-2 evaluator only cares
 * whether goal_funded_at is set (any qualifying assignment counts).
 */
async function detectGoalFunded(args: Record<string, unknown>, month: string): Promise<void> {
  const categoryId = Number(args.categoryId);
  const budgetId = Number(args.budgetId);
  const monthArg = String(args.month ?? '');
  if (!Number.isFinite(categoryId) || !Number.isFinite(budgetId) || !monthArg) return;

  try {
    const services = S();
    if (!services.goals?.getGoalByCategoryID || !services.goals?.calculateGoalProgress) return;

    const goal = services.goals.getGoalByCategoryID(categoryId);
    if (!goal) return;

    const rows = (await services.monthlyBudgets?.getMonthlyBudget?.(monthArg, budgetId)) as
      | MonthlyBudgetRowLike[]
      | undefined;
    if (!Array.isArray(rows)) return;
    const row = rows.find((r) => {
      const id = r.CategoryID ?? r.category_id ?? r.categoryId;
      return id === categoryId;
    });
    if (!row) return;

    const finances = {
      available: Number(row.Available ?? row.available ?? 0),
      assigned: Number(
        (row as { Assigned?: number; assigned?: number }).Assigned ??
          (row as { Assigned?: number; assigned?: number }).assigned ??
          0
      ),
      activity: Number(row.Activity ?? row.activity ?? 0),
    };
    const currentMonth = month || monthArg.slice(0, 7);

    const progress = services.goals.calculateGoalProgress(goal, finances, currentMonth) as
      | { isOnTrack?: boolean; isFunded?: boolean }
      | null
      | undefined;
    if (!progress) return;

    if (progress.isOnTrack || progress.isFunded) {
      reportTrialSignal('goal_funding' as TrialSignalKind);
    }
  } catch {
    /* no runtime or transient error — drop silently */
  }
}
