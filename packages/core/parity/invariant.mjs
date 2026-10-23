// Zero-based budget identity, checked from raw SQL against the budget reads.
// Plain ESM so both the parity runner (bundled cores) and the vitest fuzz suite
// can use it.
//
// For a budget, a mode and a month M (all amounts in the budget currency):
//
//   B(M) = sum of on-budget account rows dated in months <= M
//          + revaluations of on-budget accounts in months <= M
//   B(M) = RTA(M) + sum over budget rows of Available(M) + explicit adjustments
//
// The adjustments, each computed independently from SQL (or from the reads of
// earlier months), are:
//   income      Income-group lines <= M (split-aware) - RTA income
//               (RTA counts parent rows, non-transfers, by date <= today in cumulative mode)
//   transfers   Transfers-group lines <= M + RTA off-budget - RTA in-budget transfers
//               (what is left: legs to off-budget debt accounts, ExcludeFromReadyToAssign
//               legs, unpaired legs, timing)
//   other       lines whose category is none of: Income group, Transfers group, a budget row
//               (Uncategorized, NULL split categories, orphans)
//   splitGap    split parents' amounts - their lines (0 when lines sum to the parent)
//   reval       revaluations in months <= M - RTA revaluations
//   assign      RTA assignments - assignments <= M of the budget-row categories
//   model       how Available departs from "assigned + activity so far":
//               cumulative: CC payment rows hold assigned + funded - refunded - payments (transfers in,
//                 except from another on-budget debt account) instead of
//                 their own activity -> sum over CC rows of (activity <= M + payments <= M
//                 - totalFunded); every other row must equal assigned + activity <= M
//               monthly: every row follows Avail(m) = max(0, Avail(m-1)) + Assigned(m) +
//                 Activity(m) (overspend reset), CC rows' Activity is funded - payments -
//                 refunds -> sum over rows of (assigned + activity <= M from SQL - the sum of
//                 Assigned + Activity over months <= M) - the resets (sum of max(0, -Avail(m))
//                 over months < M); RTA also deducts prior cash overspend, added back here.
//
// A non-zero residual (B - RTA - Available - adjustments) is a violation.

const NO_SPLITS =
  'AND NOT EXISTS (SELECT 1 FROM transaction_splits s2 WHERE s2.TransactionID = t.ID)';

// Transfers from another on-budget debt account (balance transfers) are not
// card payments; same rule as DEBT_PARTNER_LEG in monthly-budgets/queries.ts.
const DEBT_PARTNER_LEG = `(CASE
  WHEN t.TransferID GLOB 'split_transfer_*' THEN EXISTS (
    SELECT 1 FROM transactions p JOIN accounts pa ON pa.ID = p.AccountID
    WHERE p.ID = CAST(substr(t.TransferID, 16) AS INTEGER)
      AND pa.OnBudget = TRUE AND LOWER(pa.Type) IN ('credit', 'loan', 'mortgage'))
  ELSE EXISTS (
    SELECT 1 FROM transactions p JOIN accounts pa ON pa.ID = p.AccountID
    WHERE p.TransferID = t.TransferID AND p.TransferID != '' AND p.ID != t.ID
      AND pa.OnBudget = TRUE AND LOWER(pa.Type) IN ('credit', 'loan', 'mortgage'))
END)`;

/**
 * @param {{ adapter: { prepare(sql: string): { all(...p: unknown[]): any[] } } }} side
 * @param {number} budgetId
 * @param {string[]} months ascending 'YYYY-MM'
 * @param {{ mode: 'cumulative'|'monthly', budget: Record<string, any[]>, rta: Record<string, any> }} reads
 *   budget[m] = getMonthlyBudget(m) rows, rta[m] = RTA breakdown for m (same mode)
 * @returns {{ month: string, residual: number, terms: Record<string, number> }[]} violations
 */
export function checkZeroBasedIdentity(side, budgetId, months, reads) {
  const rows = (sql, ...p) => side.adapter.prepare(sql).all(...p);
  const lines = rows(
    `SELECT Month, CategoryID, SUM(Amount) AS Amount FROM (
       SELECT t.Month AS Month, t.CategoryID AS CategoryID, t.InflowConverted - t.OutflowConverted AS Amount
       FROM transactions t JOIN accounts a ON a.ID = t.AccountID
       WHERE t.BudgetID = ?1 AND a.OnBudget = TRUE ${NO_SPLITS}
       UNION ALL
       SELECT t.Month, s.CategoryID, s.InflowConverted - s.OutflowConverted
       FROM transaction_splits s JOIN transactions t ON t.ID = s.TransactionID
       JOIN accounts a ON a.ID = t.AccountID
       WHERE t.BudgetID = ?1 AND a.OnBudget = TRUE
     ) GROUP BY Month, CategoryID`,
    budgetId
  );
  const parents = rows(
    `SELECT t.Month AS Month, SUM(t.InflowConverted - t.OutflowConverted) AS Amount
     FROM transactions t JOIN accounts a ON a.ID = t.AccountID
     WHERE t.BudgetID = ?1 AND a.OnBudget = TRUE GROUP BY t.Month`,
    budgetId
  );
  const revals = rows(
    `SELECT strftime('%Y-%m', r.Date) AS Month, SUM(r.DeltaConverted) AS Amount
     FROM account_revaluations r JOIN accounts a ON a.ID = r.AccountID
     WHERE r.BudgetID = ?1 AND a.OnBudget = TRUE GROUP BY 1`,
    budgetId
  );
  const assigns = rows(
    'SELECT Month, CategoryID, SUM(Amount) AS Amount FROM assignments WHERE BudgetID = ?1 GROUP BY Month, CategoryID',
    budgetId
  );
  const cardPays = rows(
    `SELECT t.Month AS Month, t.AccountID AS AccountID, SUM(t.InflowConverted) AS Amount
     FROM transactions t JOIN accounts a ON a.ID = t.AccountID
     WHERE t.BudgetID = ?1 AND LOWER(a.Type) = 'credit' AND t.TransferID IS NOT NULL
       AND t.TransferID != '' AND t.InflowConverted > 0
       AND NOT ${DEBT_PARTNER_LEG} GROUP BY 1, 2`,
    budgetId
  );
  const groups = new Map(
    rows(
      'SELECT c.ID AS ID, cg.Name AS G FROM categories c JOIN category_groups cg ON cg.ID = c.CategoryGroupID'
    ).map((r) => [r.ID, r.G])
  );
  const cardToPc = new Map();
  for (const r of rows(
    `SELECT ID, Metadata FROM accounts WHERE BudgetID = ?1 AND LOWER(Type) = 'credit' AND Metadata IS NOT NULL`,
    budgetId
  )) {
    try {
      const pc = JSON.parse(r.Metadata || '{}').cc_payment_category_id;
      if (pc) cardToPc.set(r.ID, pc);
    } catch {
      /* skip */
    }
  }
  const ccRows = new Set(cardToPc.values());

  const firstMonth = months[0];
  const violations = [];
  const resets = new Map(); // category -> running sum of max(0, -Avail(m)) over checked months < M
  const runningModel = new Map(); // category -> sum of Assigned + Activity over checked months <= M

  for (const M of months) {
    const budget = reads.budget[M];
    const rta = reads.rta[M];
    const rowCats = new Set(budget.filter((r) => r.CategoryID !== -1).map((r) => r.CategoryID));
    let B = 0;
    for (const p of parents) if (p.Month <= M) B += p.Amount;
    let linesTotal = 0;
    let income = 0;
    let transfers = 0;
    let other = 0;
    const actByCat = new Map();
    for (const l of lines) {
      if (l.Month > M) continue;
      linesTotal += l.Amount;
      const g = l.CategoryID === null ? undefined : groups.get(l.CategoryID);
      if (g === 'Income') income += l.Amount;
      else if (g === 'Transfers') transfers += l.Amount;
      else if (rowCats.has(l.CategoryID))
        actByCat.set(l.CategoryID, (actByCat.get(l.CategoryID) ?? 0) + l.Amount);
      else other += l.Amount;
    }
    const splitGap = B - linesTotal;
    let reval = 0;
    for (const r of revals) if (r.Month !== null && r.Month <= M) reval += r.Amount;
    B += reval;
    const asgByCat = new Map();
    for (const a of assigns)
      if (a.Month <= M) asgByCat.set(a.CategoryID, (asgByCat.get(a.CategoryID) ?? 0) + a.Amount);
    let rowAssigned = 0;
    for (const c of rowCats) rowAssigned += asgByCat.get(c) ?? 0;
    const payByPc = new Map();
    for (const p of cardPays) {
      const pc = cardToPc.get(p.AccountID);
      if (p.Month <= M && pc) payByPc.set(pc, (payByPc.get(pc) ?? 0) + p.Amount);
    }

    let available = 0;
    let model = 0;
    for (const r of budget) {
      if (r.CategoryID === -1) continue;
      available += r.Available;
      const raw = (asgByCat.get(r.CategoryID) ?? 0) + (actByCat.get(r.CategoryID) ?? 0);
      if (reads.mode === 'cumulative') {
        if (ccRows.has(r.CategoryID) && r.totalFunded !== undefined)
          model +=
            (actByCat.get(r.CategoryID) ?? 0) +
            (payByPc.get(r.CategoryID) ?? 0) -
            (r.totalFunded - (r.totalRefunded ?? 0));
      } else if (groups.get(r.CategoryID) === 'Credit Card Payments' && !ccRows.has(r.CategoryID)) {
        // unlinked CC-group categories keep their cumulative Available in monthly
        // mode: expected raw - Available = 0, nothing to add
      } else {
        // assignments before the first checked month have no activity around them
        let before = 0;
        if (!runningModel.has(r.CategoryID))
          for (const a of assigns)
            if (a.CategoryID === r.CategoryID && a.Month < firstMonth) before += a.Amount;
        const run = (runningModel.get(r.CategoryID) ?? before) + r.Assigned + r.Activity;
        runningModel.set(r.CategoryID, run);
        model += raw - run - (resets.get(r.CategoryID) ?? 0);
      }
    }
    if (reads.mode === 'monthly')
      for (const r of budget)
        if (
          r.CategoryID !== -1 &&
          !(groups.get(r.CategoryID) === 'Credit Card Payments' && !ccRows.has(r.CategoryID))
        )
          resets.set(r.CategoryID, (resets.get(r.CategoryID) ?? 0) + Math.max(0, -r.Available));

    const terms = {
      income: income - rta.income,
      transfers: transfers + rta.offBudgetTransfers - rta.inBudgetTransfers,
      other,
      splitGap,
      reval: reval - rta.revaluations,
      assign: rta.assignments - rowAssigned,
      model,
      priorCashOverspend: reads.mode === 'monthly' ? rta.priorCashOverspend : 0,
    };
    const explained = Object.values(terms).reduce((s, v) => s + v, 0);
    const residual = B - rta.readyToAssign - available - explained;
    if (residual !== 0) violations.push({ month: M, residual, terms });
  }
  return violations;
}
