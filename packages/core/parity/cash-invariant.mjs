// Cash conservation: envelopes vs. the money that backs them, checked from raw
// SQL against the budget reads. Plain ESM (parity runner + vitest).
//
// Unlike invariant.mjs, nothing here is taken from the model under test: CC
// payments, funding, refunds, resets and cash overspend are all derived from
// the ledger rows, so a model bug that moves money into or out of thin air
// (#68, #69) shows up as a residual instead of being explained away.
//
// For a budget, a mode and a month M (budget currency, milliunits):
//
//   E(M) = Ready to Assign(M) + sum of Available(M) over every budget row
//          (spending rows and CC Payment rows)
//   X(M) = cash: sum over on-budget lines dated in months <= M of their cash part
//          + revaluations of on-budget accounts in months <= M
//          cash part of a line: its amount on a non-credit account. On a credit
//          account: monthly mode, how much it moves the card's positive balance
//          (max(0, balance after) - max(0, balance before), the model's own
//          definition, rows in Date / outflow desc / ID / split order); cumulative
//          mode, 0 (cumulative treats a card's balance as debt only).
//          credit part = amount - cash part.
//
//   E(M) - X(M) = sum of the terms below; anything else is a violation.
//
// Expected terms (each from SQL; "line" = a transaction without splits or a split line):
//   other           lines in no budget row (Uncategorized, NULL split category, a CC
//                   Payment category used as a transaction category, deleted
//                   categories) and Transfers-category lines without a transfer
//                   partner: -cash part (the money moved, no envelope did)
//   income          cumulative only: Income lines as RTA counts them (parents, no
//                   transfers) - their cash part: card income/opening inflows count
//                   in full, Income-category transfer legs not at all
//   assignNonRow    assignments <= M to categories that are no budget row: -amount
//   transferLegs    legs of transfers between on-budget accounts, per leg: -cash part
//                   of a non-credit leg, -amount of a CC payment (card inflow from an
//                   on-budget cash account), -amount of a card leg sending money to
//                   an on-budget cash account (cash advance: YNAB's "inflow from
//                   debt account" raises RTA by the money that left the card's
//                   debt); a pair with both legs <= M nets to 0. The new debt stays
//                   unfunded (CC Payment untouched), like opening card debt.
//   cardToOffBudget card -> off-budget (non-debt) transfer: RTA drops by the full
//                   amount, cash only by the cash part: + credit part (negative)
//   offBudgetDebt   non-credit leg of a Transfers-category transfer to/from an
//                   off-budget debt account (loan, mortgage, credit): RTA ignores
//                   it by design (those are meant to be categorized): -cash part
//   excluded        ExcludeFromReadyToAssign legs with an off-budget partner:
//                   non-credit leg -cash part; card inflow -amount (still a payment)
//   orphan          transfer legs whose partner is gone: non-credit -cash part, card
//                   inflow -amount (counted as a payment)
//   nonRowSpending  monthly: a spending-group category that is no budget row (e.g.
//                   Uncategorized) is rolled forward like a row (its cash overspend is
//                   charged to RTA) but its balance is shown nowhere: -its displayed balance
//   plainRowCredit  rows in the CC Payments group not linked to a card keep
//                   assigned + activity: + credit part of their lines
//   spending (monthly)    -unfunded(M) + phantom(M), from a reference rollforward on
//                   SQL: displayed D(m) = max(0, D(m-1)) + assigned + activity;
//                   funding of each month's credit purchases from
//                   max(0, D(m-1)) + assigned + cash (same-card refunds cancel
//                   purchases first, leftover refunds add to the cover), reference
//                   CC Payment balances (carry + assigned + funded - payments - drawn,
//                   floored at 0 each month; payments = card inflows from on-budget
//                   cash or off-budget non-debt accounts); a leftover refund is drawn
//                   from its card's payment balance (up to carry + assigned + funded).
//                     unfunded(M): this month's credit spending that no envelope
//                       covered (it is reset next month and becomes card debt)
//                     phantom(M): refund credit parts that were NOT drawn from a
//                       payment balance (they reduce unfunded debt, no cash backs
//                       them), still in their category. Phantom money that leaves
//                       the category (displayed balance falls below it at a month
//                       end) must be charged to RTA the next month as cash overspend.
//   rtaAsOfToday    cumulative only: Ready to Assign is computed for today (income,
//                   transfers, cash advances, revaluations dated <= today, every assignment); the
//                   difference to the same parts as of the end of M
//   spending (cumulative) per spending row: credit parts + funded, with card
//                   spending netted per card: funded = min(net purchases, max(0,
//                   assigned + cash activity + leftover refunds)) split per card;
//                   a card's leftover refunds are then drawn from its CC Payment
//                   balance (assigned + funded - payments, floored at 0), except the
//                   part that put the card in credit
//
// Known model deviations (opts.known; added only when listed, so a listed one
// that is fixed makes the check fail until it is removed from the list):
//   #69                card inflows from another card or a debt account (loan,
//                      mortgage, credit; on or off budget) count as CC payments: -amount
//   #68                monthly: cash overspend charged on refund money that was
//                      drawn from a CC Payment balance (or on card-positive cash):
//                      -overcharge
//   #68-cumulative     cumulative: funding uses gross card outflows (refunds not
//                      netted, cash parts included): + model funded - reference funded
//   phantomLeak        monthly: phantom refund money that left its category without
//                      a charge (e.g. funded a later card purchase): +undercharge
//   #67                card -> on-budget cash transfer leaves RTA alone (and, from a
//                      card's positive balance, monthly mode even lowers it): +amount
//                      of the card leg (negative; the credit part for a split line)
//   cardPositiveToOffBudget monthly: card -> off-budget transfer counts the cash part
//                      twice (income and off-budget): + cash part (negative)
//   splitTransferOffBudget a split line transferring to or from an off-budget account
//                      (the line on the on-budget side, or the mirror row when the
//                      split parent is off budget) never moves RTA: -amount
//
// Returns { violations: [{ month, residual, terms }], known: [{ month, key, amount }] }.

const DEBT_TYPES = new Set(['credit', 'loan', 'mortgage']);
const SPENDING_EXCLUDED = new Set(['Income', 'Transfers', 'Credit Card Payments']);

/** Every class key above; KNOWN_DEVIATIONS (cash-known.mjs) lists the open ones. */
export const DEVIATION_KEYS = [
  '#69',
  '#68',
  '#68-cumulative',
  '#67',
  'phantomLeak',
  'cardPositiveToOffBudget',
  'splitTransferOffBudget',
];

const add = (map, key, v) => map.set(key, (map.get(key) ?? 0) + v);

/**
 * @param {{ adapter: { prepare(sql: string): { all(...p: unknown[]): any[] } } }} side
 * @param {number} budgetId
 * @param {string[]} months ascending 'YYYY-MM' (contiguous, from before the first ledger month)
 * @param {{ mode: 'cumulative'|'monthly', budget: Record<string, any[]>, rta: Record<string, any> }} reads
 * @param {{ today?: string, known?: Iterable<string> }} [opts] today: the date cumulative
 *   Ready to Assign is computed for (default: local today)
 */
export function checkCashConservation(side, budgetId, months, reads, opts = {}) {
  const rows = (sql, ...p) => side.adapter.prepare(sql).all(...p);
  const monthly = reads.mode === 'monthly';
  const known = new Set(opts.known ?? []);
  const today = opts.today ?? localToday();
  if (!months.length) return { violations: [], known: [] };
  const lastMonth = months[months.length - 1];

  // ---- structure -------------------------------------------------------------
  const accounts = new Map();
  const cardToPc = new Map();
  for (const a of rows(`SELECT ID, Type, OnBudget, Metadata, BudgetID FROM accounts`)) {
    const type = String(a.Type).toLowerCase();
    accounts.set(a.ID, {
      onBudget: !!a.OnBudget,
      credit: type === 'credit',
      debt: DEBT_TYPES.has(type),
    });
    if (a.BudgetID === budgetId && type === 'credit') {
      try {
        const pc = JSON.parse(a.Metadata || '{}').cc_payment_category_id;
        if (pc) cardToPc.set(a.ID, pc);
      } catch {
        /* no link */
      }
    }
  }
  const kindOf = (id) => {
    const a = accounts.get(id);
    if (!a) return 'none';
    // on-budget loans / mortgages hold cash like any non-credit account, but a
    // transfer from one into a card moves debt, it pays nothing
    if (a.onBudget) return a.credit ? 'onCard' : a.debt ? 'onDebt' : 'onCash';
    return a.debt ? 'offD' : 'offN';
  };
  const groupOf = new Map(
    rows(
      'SELECT c.ID AS ID, cg.Name AS G FROM categories c JOIN category_groups cg ON cg.ID = c.CategoryGroupID WHERE c.BudgetID = ?1',
      budgetId
    ).map((r) => [r.ID, r.G])
  );
  const pcSet = new Set(cardToPc.values());
  // budget rows (structure only): categories the reads show
  const rowCats = new Set();
  for (const M of months)
    for (const r of reads.budget[M] ?? []) if (r.CategoryID !== -1) rowCats.add(r.CategoryID);
  // Spending categories: the rows outside Income / Transfers / CC Payments. Monthly
  // mode rolls forward (and charges the cash overspend of) every category in those
  // groups, rows or not (e.g. Uncategorized), so the reference does too.
  const isSpending = (c) =>
    groupOf.has(c) && !SPENDING_EXCLUDED.has(groupOf.get(c)) && (monthly || rowCats.has(c));
  const isPlainCcRow = (c) =>
    rowCats.has(c) && groupOf.get(c) === 'Credit Card Payments' && !pcSet.has(c);

  // ---- ledger lines (split-aware), cash parts -----------------------------------
  const lines = rows(
    `SELECT t.ID AS tid, 0 AS part, t.AccountID AS acc, t.CategoryID AS cat, t.Month AS m,
            t.Date AS d, t.OutflowConverted AS tout, t.InflowConverted - t.OutflowConverted AS amt,
            t.TransferID AS tr, NULL AS xacc, t.ExcludeFromReadyToAssign AS ex, 0 AS split,
            t.OutflowConverted AS outflow
     FROM transactions t JOIN accounts a ON a.ID = t.AccountID
     WHERE t.BudgetID = ?1 AND a.OnBudget = TRUE
       AND NOT EXISTS (SELECT 1 FROM transaction_splits s2 WHERE s2.TransactionID = t.ID)
     UNION ALL
     SELECT t.ID, s.OrderIndex, t.AccountID, s.CategoryID, t.Month, t.Date, t.OutflowConverted,
            s.InflowConverted - s.OutflowConverted, NULL, s.TransferAccountID,
            t.ExcludeFromReadyToAssign, 1, s.OutflowConverted
     FROM transaction_splits s JOIN transactions t ON t.ID = s.TransactionID
     JOIN accounts a ON a.ID = t.AccountID
     WHERE t.BudgetID = ?1 AND a.OnBudget = TRUE`,
    budgetId
  ).filter((l) => l.m <= lastMonth);
  lines.sort(
    (x, y) =>
      (x.d < y.d ? -1 : x.d > y.d ? 1 : 0) || y.tout - x.tout || x.tid - y.tid || x.part - y.part
  );
  const running = new Map();
  for (const l of lines) {
    const a = accounts.get(l.acc);
    l.card = a.credit;
    // pos: how much the line moves the card's positive balance (both modes)
    if (a.credit) {
      const before = running.get(l.acc) ?? 0;
      const after = before + l.amt;
      running.set(l.acc, after);
      l.pos = Math.max(0, after) - Math.max(0, before);
    } else l.pos = 0;
    if (!a.credit) l.cash = l.amt;
    else if (!monthly) l.cash = 0;
    else l.cash = l.pos;
    l.credit = l.amt - l.cash;
  }
  // cumulative RTA parts the SQL in cumulativeRtaParts cannot see (cash
  // advances, split-transfer legs to / from off-budget accounts), by date
  const advanceParts = [];

  // transfer partners
  const legsByTid = new Map();
  for (const r of rows(
    `SELECT ID, AccountID, TransferID FROM transactions
     WHERE BudgetID = ?1 AND TransferID IS NOT NULL AND TransferID != ''`,
    budgetId
  )) {
    const list = legsByTid.get(r.TransferID) ?? [];
    list.push(r);
    legsByTid.set(r.TransferID, list);
  }
  const parentAcc = new Map(
    rows(
      `SELECT DISTINCT t.ID AS ID, t.AccountID AS AccountID, t.Date AS Date FROM transactions t
       JOIN transaction_splits s ON s.TransactionID = t.ID
       WHERE t.BudgetID = ?1 AND s.TransferAccountID IS NOT NULL`,
      budgetId
    ).map((r) => [r.ID, r])
  );
  const partnerOf = (l) => {
    if (l.split) {
      if (l.xacc == null) return null;
      const mirror = legsByTid.get(`split_transfer_${l.tid}_${l.d}`) ?? [];
      return mirror.some((x) => x.AccountID === l.xacc) ? kindOf(l.xacc) : 'none';
    }
    if (!l.tr) return null;
    const mirrorOf = /^split_transfer_(\d+)_/.exec(l.tr);
    if (mirrorOf) {
      const p = parentAcc.get(Number(mirrorOf[1]));
      return p && `split_transfer_${p.ID}_${p.Date}` === l.tr ? kindOf(p.AccountID) : 'none';
    }
    const other = (legsByTid.get(l.tr) ?? []).filter((x) => x.ID !== l.tid);
    return other.length ? kindOf(other[0].AccountID) : 'none';
  };

  // ---- per-line expected terms and known deviations, bucketed by month -----------
  const termByMonth = new Map(); // month -> Map(term -> amount)
  const devByMonth = new Map(); // month -> Map(key -> amount)
  const bump = (byMonth, m, key, v) => {
    if (!v) return;
    let t = byMonth.get(m);
    if (!t) byMonth.set(m, (t = new Map()));
    add(t, key, v);
  };
  const payments = new Map(); // card -> month -> legit payments (reference)
  const bogusPayments = new Map(); // card -> month -> #69 payments
  const payBump = (map, card, m, v) => {
    let byM = map.get(card);
    if (!byM) map.set(card, (byM = new Map()));
    add(byM, m, v);
  };
  const cashAt = new Map(); // month -> sum of cash parts

  for (const l of lines) {
    add(cashAt, l.m, l.cash);
    const g = l.cat == null ? undefined : groupOf.get(l.cat);
    const partner = partnerOf(l);
    const transferLeg = partner !== null && (l.split || g === 'Transfers');
    const inflow = l.amt > 0;
    const paysCard = l.card && inflow && !l.split && l.tr && cardToPc.has(l.acc);
    if (transferLeg) {
      if (partner === 'none') {
        if (!l.card) bump(termByMonth, l.m, 'orphan', -l.cash);
        else if (paysCard) bump(termByMonth, l.m, 'orphan', -l.amt);
        if (paysCard) payBump(payments, l.acc, l.m, l.amt);
        continue;
      }
      if (l.split && partner === 'offN') {
        // expected: like a regular transfer to an off-budget account
        if (l.ex) {
          bump(termByMonth, l.m, 'excluded', -l.cash);
          continue;
        }
        if (l.card) bump(termByMonth, l.m, 'cardToOffBudget', l.credit);
        bump(devByMonth, l.m, 'splitTransferOffBudget', -l.amt);
        advanceParts.push({ m: l.m, d: l.d, v: l.amt }); // an RTA part dated like the line
        continue;
      }
      if (partner === 'onCash' || partner === 'onCard' || partner === 'onDebt') {
        // Booked per leg so a pair whose legs sit in different months is right in
        // between: every pair nets to 0.
        if (!l.card) {
          // the envelopes do not move; the cash does
          bump(termByMonth, l.m, 'transferLegs', -l.cash);
        } else if (!inflow && partner !== 'onCard') {
          // cash advance: RTA should rise by the debt-sourced part (the rest was the
          // card's positive balance, already cash), i.e. ideal envelope change
          // -amount + cash part, so -amount after the cash part. Cumulative mode
          // keeps no card cash, so the positive-balance part is booked here.
          bump(termByMonth, l.m, 'transferLegs', monthly ? -l.amt : -l.amt + l.pos);
          if (!monthly) advanceParts.push({ m: l.m, d: l.d, v: -l.amt + l.pos });
          bump(devByMonth, l.m, '#67', l.split ? l.credit : l.amt);
        } else if (l.split) {
          // a split line counts for no envelope (no category)
          bump(termByMonth, l.m, 'transferLegs', -l.cash);
        }
        // (a regular card leg's cash part is counted by monthly RTA like income)
        if (paysCard) {
          if (partner === 'onCash') {
            payBump(payments, l.acc, l.m, l.amt);
            bump(termByMonth, l.m, 'transferLegs', -l.amt);
          } else {
            payBump(bogusPayments, l.acc, l.m, l.amt);
            bump(devByMonth, l.m, '#69', -l.amt);
          }
        }
        continue;
      }
      if (partner === 'offN') {
        // a split-transfer mirror whose split parent is off budget: the off-budget
        // transfer sums only look at TransferIDs with a leg on that account
        if (/^split_transfer_/.test(l.tr)) {
          bump(devByMonth, l.m, 'splitTransferOffBudget', -l.amt);
          if (!l.ex) advanceParts.push({ m: l.m, d: l.d, v: l.amt });
        }
        if (l.ex) {
          if (!l.card) bump(termByMonth, l.m, 'excluded', -l.cash);
          else if (paysCard) bump(termByMonth, l.m, 'excluded', -l.amt);
        } else if (l.card && !inflow) {
          bump(termByMonth, l.m, 'cardToOffBudget', l.credit);
          if (monthly) bump(devByMonth, l.m, 'cardPositiveToOffBudget', l.cash);
        }
        if (paysCard) payBump(payments, l.acc, l.m, l.amt);
        continue;
      }
      // off-budget debt partner (a split line on a card counts for no envelope either)
      if (!l.card || l.split) bump(termByMonth, l.m, 'offBudgetDebt', -l.cash);
      if (paysCard) {
        payBump(bogusPayments, l.acc, l.m, l.amt);
        bump(devByMonth, l.m, '#69', -l.amt);
      }
      continue;
    }
    if (paysCard) {
      // a transfer leg into a card under a non-Transfers category: the model
      // books it as a payment as well as category activity
      payBump(payments, l.acc, l.m, l.amt);
      bump(termByMonth, l.m, 'categorizedCardTransfer', -l.amt);
    }
    if (g === 'Income') {
      if (!monthly) bump(termByMonth, l.m, 'income', -l.cash);
      continue;
    }
    if (isSpending(l.cat)) continue; // reference rollforward below
    if (isPlainCcRow(l.cat)) {
      bump(termByMonth, l.m, 'plainRowCredit', l.credit);
      continue;
    }
    if (g === 'Transfers' && monthly && l.card) continue; // monthly RTA counts the cash part
    bump(termByMonth, l.m, 'other', -l.cash);
  }
  if (!monthly)
    // RTA's cumulative income: Income-category parents, no transfers (split lines
    // above contributed -cash part)
    for (const r of rows(
      `SELECT t.Month AS m, SUM(t.InflowConverted - t.OutflowConverted) AS v
       FROM transactions t JOIN accounts a ON a.ID = t.AccountID
       JOIN categories c ON c.ID = t.CategoryID JOIN category_groups cg ON cg.ID = c.CategoryGroupID
       WHERE t.BudgetID = ?1 AND a.OnBudget = TRUE AND cg.Name = 'Income'
         AND (t.TransferID IS NULL OR t.TransferID = '') GROUP BY t.Month`,
      budgetId
    ))
      bump(termByMonth, r.m, 'income', r.v);

  const assigns = rows(
    'SELECT Month AS m, CategoryID AS c, SUM(Amount) AS v FROM assignments WHERE BudgetID = ?1 GROUP BY 1, 2',
    budgetId
  );
  const asg = new Map(); // cat -> month -> amount
  for (const a of assigns) {
    if (!rowCats.has(a.c) && !isSpending(a.c)) bump(termByMonth, a.m, 'assignNonRow', -a.v);
    let byM = asg.get(a.c);
    if (!byM) asg.set(a.c, (byM = new Map()));
    add(byM, a.m, a.v);
  }
  const revals = new Map(
    rows(
      `SELECT strftime('%Y-%m', r.Date) AS m, SUM(r.DeltaConverted) AS v
       FROM account_revaluations r JOIN accounts a ON a.ID = r.AccountID
       WHERE r.BudgetID = ?1 AND a.OnBudget = TRUE GROUP BY 1`,
      budgetId
    ).map((r) => [r.m, r.v])
  );

  // ---- spending categories: series per category and month ------------------------
  const series = new Map(); // cat -> month -> { cash, credit, purchases: [{card, spend}] }
  for (const l of lines) {
    if (!isSpending(l.cat)) continue;
    let byM = series.get(l.cat);
    if (!byM) series.set(l.cat, (byM = new Map()));
    let s = byM.get(l.m);
    if (!s) byM.set(l.m, (s = { cash: 0, credit: 0, out: new Map(), net: new Map(), lines: [] }));
    s.cash += l.cash;
    s.credit += l.credit;
    if (l.card) {
      s.lines.push({ card: l.acc, spend: -l.credit });
      add(s.net, l.acc, -l.amt);
      if (l.outflow > 0) add(s.out, l.acc, l.outflow);
    }
  }
  const spendingCats = [...groupOf.keys()].filter(isSpending).sort((a, b) => a - b);

  const allMonths = new Set(months);
  for (const l of lines) allMonths.add(l.m);
  for (const a of assigns) if (a.m <= lastMonth) allMonths.add(a.m);
  const axis = [...allMonths].filter((m) => m <= lastMonth).sort();

  const refByMonth = new Map(); // month -> { unfunded, phantom, overcharge, undercharge }
  if (monthly) {
    const D = new Map(); // cat -> displayed at the last processed month
    const carryCash = new Map(); // model mirror (#68)
    const ph = new Map(); // cat -> phantom at the end of the last processed month
    const payCarry = new Map(); // payment category -> carry
    let overcharge = 0;
    let undercharge = 0;
    for (const m of axis) {
      // month boundary: phantom above the new displayed balance left the category
      const funded = new Map(); // pc -> funded this month
      const leftover = []; // { cat, pc, amount } in category order
      let unfunded = 0;
      const monthCat = new Map();
      for (const c of spendingCats) {
        const s = series.get(c)?.get(m) ?? { cash: 0, credit: 0, lines: [] };
        const A = asg.get(c)?.get(m) ?? 0;
        const carry = Math.max(0, D.get(c) ?? 0);
        const refunds = new Map();
        for (const x of s.lines) if (x.spend < 0) add(refunds, x.card, -x.spend);
        const purchases = [];
        for (const x of s.lines) {
          if (x.spend <= 0) continue;
          const r = Math.min(x.spend, refunds.get(x.card) ?? 0);
          refunds.set(x.card, (refunds.get(x.card) ?? 0) - r);
          purchases.push({ card: x.card, spend: x.spend - r });
        }
        let leftoverTotal = 0;
        for (const v of refunds.values()) leftoverTotal += v;
        let remaining = Math.max(0, carry + A + s.cash + leftoverTotal);
        let u = 0;
        for (const p of purchases) {
          const pc = cardToPc.get(p.card);
          const f = pc ? Math.min(p.spend, remaining) : 0;
          remaining -= f;
          if (f > 0) add(funded, pc, f);
          u += p.spend - f;
        }
        unfunded += u;
        for (const [card, r] of refunds)
          if (r > 0) leftover.push({ cat: c, pc: cardToPc.get(card), amount: r });
        const displayed = carry + A + s.cash + s.credit;
        // model mirror: cash overspend from rawCash (carryCash ignores refunds)
        const rawCash = (carryCash.get(c) ?? 0) + A + s.cash;
        carryCash.set(c, Math.max(0, Math.min(rawCash, displayed)));
        monthCat.set(c, { displayed, u, modelCharge: Math.max(0, -rawCash) });
      }
      // reference payment balances: refunds drawn from them
      const created = new Map(); // cat -> phantom created this month
      const byPc = new Map();
      for (const x of leftover) {
        if (!x.pc) {
          add(created, x.cat, x.amount);
          continue;
        }
        const list = byPc.get(x.pc) ?? [];
        list.push(x);
        byPc.set(x.pc, list);
      }
      for (const pc of pcSet) {
        const A = asg.get(pc)?.get(m) ?? 0;
        const f = funded.get(pc) ?? 0;
        let pay = 0;
        for (const [card, p] of cardToPc) {
          if (p !== pc) continue;
          pay += payments.get(card)?.get(m) ?? 0;
          if (known.has('#69')) pay += bogusPayments.get(card)?.get(m) ?? 0;
        }
        const carry = payCarry.get(pc) ?? 0;
        const list = byPc.get(pc) ?? [];
        const total = list.reduce((t, x) => t + x.amount, 0);
        let drawable = Math.min(total, Math.max(0, carry + A + f));
        for (const x of list) {
          const d = Math.min(x.amount, drawable);
          drawable -= d;
          add(created, x.cat, x.amount - d);
        }
        const drawn = Math.min(total, Math.max(0, carry + A + f));
        payCarry.set(pc, Math.max(0, carry + A + f - pay - drawn));
      }
      let phantom = 0;
      for (const c of spendingCats) {
        const x = monthCat.get(c);
        const p = (ph.get(c) ?? 0) + (created.get(c) ?? 0);
        const kept = Math.min(p, Math.max(0, x.displayed));
        // the charge the reference expects at this month's end
        const refCharge = Math.max(0, -x.displayed) - x.u + (p - kept);
        x.diff = x.modelCharge - refCharge;
        x.kept = kept;
        phantom += p;
      }
      let hidden = 0; // displayed balance of spending categories that are no budget row
      for (const c of spendingCats) if (!rowCats.has(c)) hidden += monthCat.get(c).displayed;
      refByMonth.set(m, { unfunded, phantom, overcharge, undercharge, hidden });
      // close the month (only matters for later months)
      for (const c of spendingCats) {
        const x = monthCat.get(c);
        if (x.diff > 0) overcharge += x.diff;
        else undercharge -= x.diff;
        D.set(c, x.displayed);
        ph.set(c, x.kept);
      }
    }
  } else {
    // cumulative: running totals per category. Card spending is netted per card
    // (a refund first cancels the same card's purchases in the category); cards
    // with net spending are funded from assigned + cash + the category's leftover
    // refunds, proportionally per card (rounded per card, as displayed); a card's
    // leftover refunds take money back out of its CC Payment balance (assigned +
    // funded - payments, floored at 0), except the part that put the card in
    // credit (it is the card's positive balance).
    const cum = new Map(); // cat -> { A, act, cash, credit, out: Map(card -> outflow), net }
    const pcAssigned = new Map(); // payment category -> assigned so far
    const cardBalance = new Map(); // card -> balance so far
    const cardPaid = new Map(); // card -> payments so far
    const months2 = new Set(axis);
    for (const m of axis) {
      for (const pc of pcSet) add(pcAssigned, pc, asg.get(pc)?.get(m) ?? 0);
      for (const [card, byM] of payments) add(cardPaid, card, byM.get(m) ?? 0);
      for (const l of lines) if (l.m === m && l.card) add(cardBalance, l.acc, l.amt);
      for (const c of spendingCats) {
        let t = cum.get(c);
        if (!t) cum.set(c, (t = { A: 0, act: 0, cash: 0, credit: 0, out: new Map(), net: new Map() }));
        const s = series.get(c)?.get(m);
        t.A += asg.get(c)?.get(m) ?? 0;
        if (s) {
          t.cash += s.cash;
          t.credit += s.credit;
          t.act += s.cash + s.credit;
          for (const [card, v] of s.out) add(t.out, card, v);
          for (const [card, v] of s.net) add(t.net, card, v);
        }
      }
      if (!months2.has(m)) continue;
      let spending = 0;
      let gross = 0;
      const fundedPc = new Map();
      const leftoverCard = new Map();
      for (const c of spendingCats) {
        const t = cum.get(c);
        let P = 0;
        let L = 0;
        for (const [card, v] of t.net) {
          if (v > 0) P += v;
          else if (v < 0) {
            L -= v;
            add(leftoverCard, card, -v);
          }
        }
        const fTotal = P > 0 ? Math.min(P, Math.max(0, t.A + t.cash + L)) : 0;
        let fRef = 0;
        if (fTotal > 0)
          for (const [card, v] of t.net) {
            if (v <= 0 || !cardToPc.has(card)) continue;
            const share = Math.round(fTotal * (v / P));
            fRef += share;
            add(fundedPc, cardToPc.get(card), share);
          }
        spending += t.credit + fRef;
        // model mirror: gross card outflows, proportional per card, rounded
        let total = 0;
        for (const v of t.out.values()) total += v;
        if (total > 0) {
          const fModel = Math.min(total, Math.max(0, t.A + t.act + total));
          if (fModel > 0)
            for (const [card, v] of t.out)
              if (cardToPc.has(card)) gross += Math.round(fModel * (v / total));
        }
        gross -= fRef;
      }
      const requests = new Map(); // payment category -> leftover refunds to give back
      for (const [card, v] of leftoverCard) {
        const pc = cardToPc.get(card);
        if (!pc) continue;
        add(requests, pc, v - Math.min(v, Math.max(0, cardBalance.get(card) ?? 0)));
      }
      for (const [pc, want] of requests) {
        let paid = 0;
        for (const [card, p] of cardToPc) if (p === pc) paid += cardPaid.get(card) ?? 0;
        const holds = (pcAssigned.get(pc) ?? 0) + (fundedPc.get(pc) ?? 0) - paid;
        spending -= Math.min(want, Math.max(0, holds));
      }
      refByMonth.set(m, { spending, gross });
    }
  }

  // cumulative RTA is computed for `today`; move it to the end of each checked month
  let shiftRows = null;
  if (!monthly) shiftRows = cumulativeRtaParts(rows, budgetId, today, advanceParts);

  // ---- check each month -------------------------------------------------------------
  const violations = [];
  const knownHits = [];
  const runTerms = new Map();
  const runDev = new Map();
  let X = 0;
  const monthSet = new Set(months);
  for (const m of axis) {
    X += (cashAt.get(m) ?? 0) + (revals.get(m) ?? 0);
    for (const [k, v] of termByMonth.get(m) ?? []) add(runTerms, k, v);
    for (const [k, v] of devByMonth.get(m) ?? []) add(runDev, k, v);
    if (!monthSet.has(m)) continue;
    const budget = reads.budget[m];
    const rta = reads.rta[m];
    let E = rta.readyToAssign;
    for (const r of budget) if (r.CategoryID !== -1) E += r.Available;
    const terms = Object.fromEntries([...runTerms].filter(([, v]) => v !== 0));
    const ref = refByMonth.get(m);
    const dev = new Map([...runDev]);
    if (monthly) {
      if (ref.unfunded) terms.unfunded = -ref.unfunded;
      if (ref.phantom) terms.phantom = ref.phantom;
      if (ref.hidden) terms.nonRowSpending = -ref.hidden;
      if (ref.overcharge) dev.set('#68', -ref.overcharge);
      if (ref.undercharge) dev.set('phantomLeak', ref.undercharge);
    } else {
      if (ref.spending) terms.spending = ref.spending;
      if (ref.gross) dev.set('#68-cumulative', ref.gross);
      const shift = shiftRows(m);
      if (shift) terms.rtaAsOfToday = -shift;
    }
    for (const [k, v] of dev) {
      if (!v || !known.has(k)) continue;
      terms[`known ${k}`] = v;
      knownHits.push({ month: m, key: k, amount: v });
    }
    let explained = 0;
    for (const v of Object.values(terms)) explained += v;
    const residual = E - X - explained;
    if (residual !== 0) {
      const unlisted = Object.fromEntries([...dev].filter(([k, v]) => v && !known.has(k)));
      violations.push({ month: m, residual, E, X, terms, unlisted });
    }
  }
  return { violations, known: knownHits };
}

/**
 * Cumulative Ready to Assign counts income, transfers and revaluations dated up
 * to `today` and every assignment. Returns month -> (the same parts as of the
 * end of that month) - (the parts RTA used), so RTA + shift is "RTA at month M".
 */
function cumulativeRtaParts(rows, budgetId, today, advances = []) {
  const offPartner = `(SELECT DISTINCT mirror.TransferID AS TransferID FROM accounts oa
      JOIN transactions mirror ON mirror.AccountID = oa.ID
      WHERE oa.OnBudget = FALSE AND LOWER(oa.Type) NOT IN ('credit', 'loan', 'mortgage')
        AND mirror.TransferID != '')`;
  const transfersCats = `(SELECT c.ID FROM categories c JOIN category_groups cg ON cg.ID = c.CategoryGroupID WHERE cg.Name = 'Transfers')`;
  const parts = rows(
    `SELECT t.Month AS m, DATE(t.Date) <= DATE(?2) AS asOf, SUM(t.InflowConverted - t.OutflowConverted) AS v
     FROM transactions t JOIN accounts a ON a.ID = t.AccountID
     JOIN categories c ON c.ID = t.CategoryID JOIN category_groups cg ON cg.ID = c.CategoryGroupID
     WHERE t.BudgetID = ?1 AND a.OnBudget = TRUE AND cg.Name = 'Income'
       AND (t.TransferID IS NULL OR t.TransferID = '') GROUP BY 1, 2
     UNION ALL
     SELECT t.Month, DATE(t.Date) <= DATE(?2), -SUM(t.OutflowConverted)
     FROM ${offPartner} p JOIN transactions t ON t.TransferID = p.TransferID
     JOIN accounts a ON a.ID = t.AccountID
     WHERE t.TransferID <> '' AND t.CategoryID IN ${transfersCats} AND t.BudgetID = ?1
       AND a.OnBudget = TRUE AND t.OutflowConverted > 0 AND t.ExcludeFromReadyToAssign = FALSE
     GROUP BY 1, 2
     UNION ALL
     SELECT t.Month, DATE(t.Date) <= DATE(?2), SUM(t.InflowConverted)
     FROM ${offPartner} p JOIN transactions t ON t.TransferID = p.TransferID
     JOIN accounts a ON a.ID = t.AccountID
     WHERE t.TransferID <> '' AND t.CategoryID IN ${transfersCats} AND t.BudgetID = ?1
       AND a.OnBudget = TRUE AND t.InflowConverted > 0 AND t.ExcludeFromReadyToAssign = FALSE
     GROUP BY 1, 2
     UNION ALL
     SELECT strftime('%Y-%m', r.Date), DATE(r.Date) <= DATE(?2), SUM(r.DeltaConverted)
     FROM account_revaluations r JOIN accounts a ON a.ID = r.AccountID
     WHERE r.BudgetID = ?1 AND a.OnBudget = TRUE GROUP BY 1, 2
     UNION ALL
     SELECT Month, 1, -SUM(Amount) FROM assignments WHERE BudgetID = ?1 GROUP BY 1`,
    budgetId,
    today
  );
  for (const a of advances) parts.push({ m: a.m, asOf: a.d.slice(0, 10) <= today, v: a.v });
  let used = 0;
  for (const p of parts) if (p.asOf) used += p.v;
  return (M) => {
    let atM = 0;
    for (const p of parts) if (p.m !== null && p.m <= M) atM += p.v;
    return atM - used;
  };
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
