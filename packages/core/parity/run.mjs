/* global process */
// Parity suite: run the same seeded random mutation sequence against two core
// builds (or one build twice, with an init hook switching an implementation on
// one side) and compare every derived figure after each step. Zero diffs allowed.
//
//   node parity/run.mjs --a <packages/core> --b <packages/core> [--seed 1] [--steps 150]
//        [--tx 1200 --years 3] [--a-init hook.mjs] [--b-init hook.mjs] [--every 1]
//        [--ops add,edit,...] [--keep-going] [--registers-every 10] [--no-registers]
//        [--mode cumulative|monthly] [--no-invariant] [--no-cash-invariant] [--quiet-invariant]
//
// --mode sets budget 1's RtaMode before the first step (mutations then run in
// that mode until an rtaMode op flips it). A second budget (budget 2) with its
// own accounts, cards and categories lives in the same database; some ops write
// to it and both budgets are compared.
//
// Compared after each checked step, in BOTH RtaMode settings:
//   - getMonthlyBudget(month) for every month from the first ledger month to two
//     months past the last one: every row (category) and every field
//   - Ready to Assign breakdown for every one of those months
//   - listAccounts (balances, metadata), and every transaction's running balances
//   - every account register (getTransactionsByAccount) every --registers-every steps
//   - the zero-based identity (invariant.mjs) on each side, both modes, every month:
//     violations are reported per side (a violation on A is a base bug, on B only
//     a snapshot bug); they fail the run only if the sides disagree (that is a diff)
//   - cash conservation (cash-invariant.mjs, tolerating cash-known.mjs) on each
//     side, both modes, every month: reported per side with the tolerated hits,
//     never a diff (--no-cash-invariant skips it)
//
// An init hook is `export default async ({ core, services, adapter, side }) => {}`;
// use it to e.g. enable a snapshot cache on side B while side A recomputes fully.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  parseArgs,
  mulberry32,
  fixClock,
  quiet,
  loadCore,
  openDb,
  out,
  BENCH_DIR,
} from '../bench/lib.mjs';
import { generate } from '../bench/gen.mjs';
import { shiftMonth } from '../bench/cases.mjs';
import { checkZeroBasedIdentity } from './invariant.mjs';
import { checkCashConservation } from './cash-invariant.mjs';
import { KNOWN_DEVIATIONS } from './cash-known.mjs';

const args = parseArgs(process.argv.slice(2), {
  seed: '1',
  steps: '150',
  tx: '800',
  years: '3',
  end: '2026-10-15',
  every: '1',
  'registers-every': '10',
  'gen-core': path.join(BENCH_DIR, '..'),
  mode: 'cumulative',
});
for (const k of ['a', 'b', 'gen-core', 'a-init', 'b-init'])
  if (args[k]) args[k] = path.resolve(args[k]);
if (!args.a || !args.b)
  throw new Error(
    'usage: parity/run.mjs --a <packages/core> --b <packages/core> [options]; see parity/README.md'
  );
fixClock(args.end);
quiet();

const SEED = Number(args.seed);
const { bytes, info } = await generate({
  core: args['gen-core'],
  tx: args.tx,
  years: args.years,
  seed: SEED,
  end: args.end,
});
const side = async (name, corePath, init) => {
  const { core, hash } = await loadCore(corePath);
  const db = await openDb(core, bytes);
  if (init) await (await import(pathToFileURL(init).href)).default({ core, ...db, side: name });
  return { name, hash, core, ...db };
};
// Budget 2: a small second budget in the same database (multi-budget isolation).
async function setupBudget2(S) {
  const s = S.services;
  const b2 = await s.budgets.createBudget({
    name: 'Second',
    display_currency: 'USD',
    badge_icon: 'dollar',
    number_format: '123,456.78',
    create_default_categories: true,
  });
  const acc = {};
  acc.chk = (await s.accounts.createAccount('B2 Checking', b2, 'checking', 'USD', 500000)).ID;
  acc.sav = (
    await s.accounts.createAccount('B2 Savings', b2, 'savings', 'USD', 900000, undefined, false)
  ).ID;
  acc.cc = (await s.accounts.createAccount('B2 Card', b2, 'credit', 'USD', -120000)).ID;
  const cats = s.categories
    .getAllCategories(b2)
    .filter((c) => !['Income', 'Transfers', 'Uncategorized'].includes(c.Name))
    .map((c) => c.ID)
    .filter((id) => {
      const g = S.adapter
        .prepare(
          'SELECT cg.Name n FROM categories c JOIN category_groups cg ON cg.ID=c.CategoryGroupID WHERE c.ID=?'
        )
        .get(id).n;
      return !['Income', 'Transfers', 'Uncategorized', 'Credit Card Payments'].includes(g);
    });
  return { budgetId: b2, acc, cats };
}
const startMode = args.mode === 'monthly' ? 'monthly' : 'cumulative';
const A = await side('A', args.a, args['a-init']);
const B = await side('B', args.b, args['b-init']);
const B2 = { A: await setupBudget2(A), B: await setupBudget2(B) };
if (JSON.stringify(B2.A) !== JSON.stringify(B2.B)) throw new Error('budget 2 setup differs');
const budget2 = B2.A;
for (const S of [A, B])
  S.adapter.exec(`UPDATE budgets SET RtaMode='${startMode}' WHERE ID=${info.budgetId}`);
out(
  `parity A=${args.a} (${A.hash}) B=${args.b} (${B.hash}) seed=${SEED} steps=${args.steps} mode=${startMode} ledger=${info.transactions} tx`
);

const budgetId = info.budgetId;
const ids = info.accountIds;
const rnd = mulberry32(SEED * 7919 + 17);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const firstMonth = shiftMonth(args.end.slice(0, 7), -12 * Number(args.years));
const randomDate = () => {
  const m = shiftMonth(firstMonth, between(0, 12 * Number(args.years) + 1)); // incl. next month (future)
  return `${m}-${String(between(1, 28)).padStart(2, '0')}`;
};
const onBudget = [
  ids.chk0,
  ids.chk1,
  ids.chk2,
  ids.sav0,
  ids.cash0,
  ids.chkEUR,
  ids.chkGBP,
  ...info.cards,
];
const offBudget = [ids.savOff0, ids.inv0, ids.loan0, ids.mort];
const allAccts = [...onBudget, ...offBudget];
let liveCats = [...info.spendCats];
const groupIds = A.adapter
  .prepare(
    "SELECT ID FROM category_groups WHERE BudgetID=? AND Name NOT IN ('Income','Transfers','Uncategorized','Credit Card Payments') ORDER BY ID"
  )
  .all(info.budgetId)
  .map((r) => r.ID);
let tseq = 0;

// state probes run on side A (both sides hold the same rows when in parity)
const rowsA = (sql, ...p) => A.adapter.prepare(sql).all(...p);
const randomTx = (where = '1=1') => {
  const r = rowsA(
    `SELECT ID FROM transactions WHERE BudgetID=? AND ${where} ORDER BY ID`,
    budgetId
  );
  return r.length ? pick(r).ID : null;
};

/**
 * Each op returns a function (services, side) => Promise, applied identically to
 * both sides (the side gives ops that need it the adapter).
 */
const OPS = {
  add: () => {
    const a = pick(allAccts),
      d = randomDate(),
      out = rnd() < 0.85,
      amt = 10 * between(1, 20000),
      c = rnd() < 0.05 ? 0 : pick(liveCats),
      payee = `P${between(1, 30)}`;
    return (s) =>
      s.transactions.addTransaction(
        out ? 0 : amt,
        out ? amt : 0,
        a,
        c,
        budgetId,
        d,
        'parity',
        '',
        payee
      );
  },
  editAmount: () => {
    const id = randomTx('TransferID IS NULL');
    const v = 10 * between(1, 30000),
      col = pick(['OutflowNative', 'InflowNative', 'OutflowConverted']);
    return id && ((s) => s.transactions.updateTransactionColumn(id, col, v));
  },
  editDate: () => {
    const id = randomTx();
    const d = randomDate();
    return id && ((s) => s.transactions.updateTransactionColumn(id, 'Date', d));
  },
  editCategory: () => {
    const id = randomTx("TransferID IS NULL OR TransferID = ''");
    const c = pick(liveCats);
    return id && ((s) => s.transactions.updateTransactionColumn(id, 'CategoryID', String(c)));
  },
  moveAccount: () => {
    const id = randomTx("TransferID IS NULL OR TransferID = ''");
    const a = pick(onBudget);
    return id && ((s) => s.transactions.moveTransactionToNewAccount(id, a));
  },
  delete: () => {
    const id = randomTx();
    return id && ((s) => s.transactions.deleteTransaction(id));
  },
  assign: () => {
    const c = pick([...liveCats, ...info.cards.map(() => pick(liveCats))]);
    const m = shiftMonth(firstMonth, between(0, 12 * Number(args.years) + 2));
    const v = 1000 * between(0, 900);
    return (s) => s.monthlyBudgets.upsertMonthlyAssignment(c, v, m, budgetId);
  },
  transfer: () => {
    const from = pick(allAccts);
    let to = pick(allAccts);
    if (to === from) to = ids.chk2;
    const d = randomDate(),
      amt = 10 * between(100, 50000),
      tid = `parity_${SEED}_${++tseq}`;
    const fromCat = [ids.loan0, ids.mort].includes(to) && rnd() < 0.7 ? info.spendCats[0] : 0;
    return async (s) => {
      const transfersCat = s.categories
        .getAllCategories(budgetId)
        .find((c) => c.Name === 'Transfers').ID;
      await s.transactions.addTransaction(
        0,
        amt,
        from,
        fromCat || transfersCat,
        budgetId,
        d,
        'xfer',
        tid
      );
      await s.transactions.addTransaction(amt, 0, to, transfersCat, budgetId, d, 'xfer', tid);
    };
  },
  ccPayment: () => {
    const cc = pick(info.cards),
      d = randomDate(),
      amt = 10 * between(1000, 90000),
      tid = `parity_${SEED}_${++tseq}`;
    return async (s) => {
      const transfersCat = s.categories
        .getAllCategories(budgetId)
        .find((c) => c.Name === 'Transfers').ID;
      await s.transactions.addTransaction(
        0,
        amt,
        ids.chk0,
        transfersCat,
        budgetId,
        d,
        'cc pay',
        tid
      );
      await s.transactions.addTransaction(amt, 0, cc, transfersCat, budgetId, d, 'cc pay', tid);
    };
  },
  cardRefund: () => {
    // a refund of an earlier card purchase (same card and category), up to 3 months later
    const r = rowsA(
      `SELECT AccountID a, CategoryID c, Month m, OutflowConverted o FROM transactions
       WHERE BudgetID=? AND AccountID IN (${info.cards.join(',')}) AND OutflowConverted > 0
         AND (TransferID IS NULL OR TransferID = '') ORDER BY ID`,
      budgetId
    );
    if (!r.length) return null;
    const t = pick(r);
    const amt = Math.max(10, 10 * Math.floor((t.o * between(1, 4)) / 40));
    const d = `${shiftMonth(t.m, between(0, 3))}-${String(between(1, 28)).padStart(2, '0')}`;
    return (s) => s.transactions.addTransaction(amt, 0, t.a, t.c, budgetId, d, 'refund', '', 'P');
  },
  cardToCard: () => {
    // balance transfer between two cards: debt moves, no cash does
    if (info.cards.length < 2) return null;
    const from = pick(info.cards);
    const to = pick(info.cards.filter((c) => c !== from));
    const d = randomDate(),
      amt = 10 * between(100, 50000),
      tid = `parity_${SEED}_${++tseq}`;
    return async (s) => {
      const tc = s.categories.getAllCategories(budgetId).find((c) => c.Name === 'Transfers').ID;
      await s.transactions.addTransaction(0, amt, from, tc, budgetId, d, 'bt', tid);
      await s.transactions.addTransaction(amt, 0, to, tc, budgetId, d, 'bt', tid);
    };
  },
  fundedCardPurchase: () => {
    // assign, buy on a card in the same month (funded), refund part of it later (60%)
    const c = pick(liveCats),
      card = pick(info.cards),
      d = randomDate(),
      amt = 10 * between(100, 50000),
      refund = rnd() < 0.6 ? 10 * Math.floor((amt * between(1, 4)) / 40) : 0,
      later = `${shiftMonth(d.slice(0, 7), between(1, 3))}-${String(between(1, 28)).padStart(2, '0')}`;
    return async (s, S) => {
      const m = d.slice(0, 7);
      const cur = S.adapter
        .prepare(
          'SELECT IFNULL(SUM(Amount), 0) v FROM assignments WHERE CategoryID = ? AND Month = ?'
        )
        .get(c, m).v;
      s.monthlyBudgets.upsertMonthlyAssignment(c, cur + amt, m, budgetId);
      await s.transactions.addTransaction(0, amt, card, c, budgetId, d, 'buy', '', 'P');
      if (refund)
        await s.transactions.addTransaction(refund, 0, card, c, budgetId, later, 'refund', '', 'P');
    };
  },
  split: () => {
    const id = randomTx("(TransferID IS NULL OR TransferID = '') AND OutflowNative > 1000");
    if (!id) return null;
    const total = rowsA(
      'SELECT OutflowNative o, OutflowConverted c FROM transactions WHERE ID=?',
      id
    )[0];
    const n = between(2, 3),
      withTransfer = rnd() < 0.3,
      lines = [];
    let restN = total.o,
      restC = total.c;
    for (let k = 0; k < n; k++) {
      const last = k === n - 1,
        pn = last ? restN : Math.floor(restN / (n - k)),
        pc = last ? restC : Math.floor(restC / (n - k));
      restN -= pn;
      restC -= pc;
      lines.push(
        withTransfer && last
          ? {
              TransferAccountID: pick([ids.sav0, ids.chk1]),
              Memo: 't',
              InflowConverted: 0,
              OutflowConverted: pc,
              InflowNative: 0,
              OutflowNative: pn,
              OrderIndex: k,
            }
          : {
              CategoryID: pick(liveCats),
              Memo: `s${k}`,
              InflowConverted: 0,
              OutflowConverted: pc,
              InflowNative: 0,
              OutflowNative: pn,
              OrderIndex: k,
            }
      );
    }
    return (s) => s.splits.upsertSplits(id, lines);
  },
  clearSplits: () => {
    const r = rowsA('SELECT DISTINCT TransactionID id FROM transaction_splits ORDER BY 1');
    if (!r.length) return null;
    const id = pick(r).id;
    return (s) => s.splits.clearSplits(id);
  },
  exchangeRate: () => {
    const id = randomTx(
      `AccountID IN (${ids.chkEUR},${ids.chkGBP}) AND (TransferID IS NULL OR TransferID = '')`
    );
    const r = (0.8 + rnd() * 0.6).toFixed(4);
    return (
      id && ((s) => s.transactions.updateTransactionColumn(id, 'ExchangeRate', Number(r), true))
    );
  },
  deleteCategory: () => {
    if (liveCats.length < 20) return null;
    const c = pick(liveCats.slice(10));
    liveCats = liveCats.filter((x) => x !== c);
    return (s) => s.categories.deleteCategory(c);
  },
  mergeCategory: () => {
    if (liveCats.length < 20) return null;
    const from = pick(liveCats.slice(10));
    const to = pick(liveCats.filter((x) => x !== from));
    liveCats = liveCats.filter((x) => x !== from);
    // A core with the atomic delete (categories.deleteAndReassign) uses it; an
    // older one runs the legacy three steps. Both must end in the same state.
    return (s) => {
      if (s.categories.deleteCategoryWithUndo) return s.categories.deleteCategoryWithUndo(from, to);
      s.transactions.reassignTransactions(to, from);
      s.monthlyBudgets.reassignAssignment(to, from);
      s.categories.deleteCategory(from);
    };
  },
  toggleOnBudget: () => {
    // flips a non-card account on/off budget (full snapshot rebuild path)
    const a = pick([ids.chk1, ids.sav0, ids.cash0, ids.savOff0, ids.inv0, ids.chkGBP]);
    return async (s) => {
      const acc = s.accounts.getAccount(a);
      await s.accounts.updateAccount(a, '', '', '', undefined, !acc.OnBudget);
    };
  },
  changeType: () => {
    const a = pick([ids.chk1, ids.sav0, ids.cash0, ids.savOff0, ids.inv0]);
    const type = pick(['checking', 'savings', 'cash', 'investment']);
    return (s) => s.accounts.updateAccount(a, '', type, '');
  },
  moveCategory: () => {
    const c = pick(liveCats.slice(10));
    const g = pick(groupIds);
    return (s) => s.categories.moveCategoryToNewGroup(g, c);
  },
  rtaMode: () => {
    const mode = rnd() < 0.5 ? 'monthly' : 'cumulative';
    return (s) => s.budgets.updateRtaMode(budgetId, mode);
  },
  restoreExport: () => (_s, S) => S.adapter.restore(S.adapter.backup()),
  exportOnly: () => (_s, S) => {
    S.adapter.backup();
  },
  fxRefresh: () => {
    // a custom EUR rate over a random range rewrites converted amounts in it
    const from = randomDate();
    const to = `${shiftMonth(from.slice(0, 7), between(0, 14))}-28`;
    const r = Number((0.8 + rnd() * 0.6).toFixed(4));
    const reval = rnd() < 0.5;
    return async (s) => {
      await s.currency.addCustomRate('EUR', 'USD', r, from, to, budgetId);
      if (reval) await s.currency.revalueAccounts(budgetId);
    };
  },
  b2add: () => {
    const a = pick([budget2.acc.chk, budget2.acc.cc, budget2.acc.sav]);
    const d = randomDate(),
      amt = 10 * between(1, 20000),
      c = pick(budget2.cats),
      outflow = rnd() < 0.8;
    return (s) =>
      s.transactions.addTransaction(
        outflow ? 0 : amt,
        outflow ? amt : 0,
        a,
        c,
        budget2.budgetId,
        d,
        'b2',
        '',
        'P'
      );
  },
  b2assign: () => {
    const c = pick(budget2.cats);
    const m = shiftMonth(firstMonth, between(0, 12 * Number(args.years) + 2));
    const v = 1000 * between(0, 500);
    return (s) => s.monthlyBudgets.upsertMonthlyAssignment(c, v, m, budget2.budgetId);
  },
  b2transfer: () => {
    const [from, to] = pick([
      [budget2.acc.chk, budget2.acc.cc],
      [budget2.acc.chk, budget2.acc.sav],
      [budget2.acc.sav, budget2.acc.chk],
    ]);
    const d = randomDate(),
      amt = 10 * between(100, 30000),
      tid = `parity_b2_${SEED}_${++tseq}`;
    return async (s) => {
      const tc = s.categories
        .getAllCategories(budget2.budgetId)
        .find((c) => c.Name === 'Transfers').ID;
      await s.transactions.addTransaction(0, amt, from, tc, budget2.budgetId, d, 'x', tid);
      await s.transactions.addTransaction(amt, 0, to, tc, budget2.budgetId, d, 'x', tid);
    };
  },
  b2edit: () => {
    const r = rowsA(
      "SELECT ID FROM transactions WHERE BudgetID=? AND (TransferID IS NULL OR TransferID='') ORDER BY ID",
      budget2.budgetId
    );
    if (!r.length) return null;
    const id = pick(r).ID;
    const kind = rnd();
    const d = randomDate();
    const v = 10 * between(1, 30000);
    return (s) =>
      kind < 0.4
        ? s.transactions.updateTransactionColumn(id, 'Date', d)
        : kind < 0.8
          ? s.transactions.updateTransactionColumn(id, 'OutflowNative', v)
          : s.transactions.deleteTransaction(id);
  },
};
const weights = {
  add: 14,
  editAmount: 12,
  editDate: 10,
  editCategory: 8,
  moveAccount: 4,
  delete: 6,
  assign: 14,
  transfer: 7,
  ccPayment: 5,
  cardRefund: 3,
  cardToCard: 2,
  fundedCardPurchase: 3,
  split: 5,
  clearSplits: 2,
  exchangeRate: 3,
  deleteCategory: 1,
  mergeCategory: 1,
  toggleOnBudget: 1,
  changeType: 1,
  moveCategory: 2,
  rtaMode: 2,
  restoreExport: 1,
  exportOnly: 2,
  fxRefresh: 2,
  b2add: 3,
  b2assign: 2,
  b2transfer: 1,
  b2edit: 2,
};
const enabled = args.ops ? args.ops.split(',') : Object.keys(weights);
const bag = enabled.flatMap((k) => Array(weights[k] ?? 1).fill(k));

// ---- snapshot + compare ----
function monthsOf(b) {
  const r = rowsA('SELECT MIN(Month) a, MAX(Month) b FROM transactions WHERE BudgetID=?', b)[0];
  const list = [];
  if (!r.a) return list;
  for (let m = r.a; m <= shiftMonth(r.b, 2); m = shiftMonth(m, 1)) list.push(m);
  return list;
}
const canon = (rows, key) =>
  [...rows].sort((x, y) => (x[key] > y[key] ? 1 : x[key] < y[key] ? -1 : 0));
const invariantStats = { A: { checks: 0, violations: [] }, B: { checks: 0, violations: [] } };
const cashStats = {
  A: { checks: 0, violations: [], known: {} },
  B: { checks: 0, violations: [], known: {} },
};
function snapshot(S, monthLists, withRegisters, step) {
  const snap = {};
  for (const [b, monthList] of monthLists) {
    const saved = S.adapter.prepare('SELECT RtaMode FROM budgets WHERE ID=?').get(b).RtaMode;
    for (const mode of ['cumulative', 'monthly']) {
      S.adapter.exec(`UPDATE budgets SET RtaMode='${mode}' WHERE ID=${b}`);
      const reads = { mode, budget: {}, rta: {} };
      for (const m of monthList) {
        const rows = S.services.monthlyBudgets.getMonthlyBudget(m, b);
        reads.budget[m] = rows;
        snap[`${b}/${mode}/getMonthlyBudget/${m}`] = canon(rows, 'CategoryID');
      }
      // RTA for every month: the batch API where it exists (one rollforward), else per month
      const mb = S.services.monthlyBudgets;
      const rta =
        typeof mb.getReadyToAssignBreakdownMap === 'function'
          ? mb.getReadyToAssignBreakdownMap(b, monthList)
          : null;
      for (const m of monthList) {
        reads.rta[m] = rta ? rta.get(m) : mb.getReadyToAssignBreakdown(b, m);
        snap[`${b}/${mode}/rta/${m}`] = reads.rta[m];
      }
      // the single-month entry point too (it is what the UI calls)
      snap[`${b}/${mode}/rta-current`] = mb.getReadyToAssignBreakdown(b, args.end.slice(0, 7));
      if (args['no-invariant'] !== 'true' && monthList.length) {
        const v = checkZeroBasedIdentity(S, b, monthList, reads);
        invariantStats[S.name].checks += monthList.length;
        for (const x of v) invariantStats[S.name].violations.push({ step, budget: b, mode, ...x });
        snap[`${b}/${mode}/invariant`] = v;
      }
      if (args['no-cash-invariant'] !== 'true' && monthList.length) {
        const c = checkCashConservation(S, b, monthList, reads, {
          today: args.end,
          known: KNOWN_DEVIATIONS,
        });
        const st = cashStats[S.name];
        st.checks += monthList.length;
        for (const x of c.violations) st.violations.push({ step, budget: b, mode, ...x });
        for (const k of new Set(c.known.map((x) => x.key))) st.known[k] = (st.known[k] ?? 0) + 1;
      }
    }
    S.adapter.exec(`UPDATE budgets SET RtaMode='${saved}' WHERE ID=${b}`);
    snap[`${b}/accounts`] = canon(S.services.accounts.listAccounts(b), 'ID');
  }
  snap.running = S.adapter
    .prepare(
      'SELECT ID, AccountID, RunningBalanceConverted, RunningBalanceNative FROM transactions ORDER BY ID'
    )
    .all();
  if (withRegisters)
    for (const [b] of monthLists)
      for (const a of snap[`${b}/accounts`])
        snap[`register/${a.ID}`] = S.services.transactions.getTransactionsByAccount(a.ID);
  return snap;
}
function firstDiff(a, b, p = '') {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b))
      return null;
    return `${p}: ${JSON.stringify(a)?.slice(0, 200)} != ${JSON.stringify(b)?.slice(0, 200)}`;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = firstDiff(a[k], b[k], `${p}/${k}`);
    if (d) return d;
  }
  return null;
}

let diffs = 0,
  applied = 0,
  bothFailed = 0;
const every = Number(args.every);
for (let step = 1; step <= Number(args.steps); step++) {
  const kind = pick(bag);
  const op = OPS[kind]();
  if (!op) continue;
  const run = async (S) => {
    try {
      await op(S.services, S);
      return null;
    } catch (e) {
      return String(e?.message ?? e).slice(0, 160);
    }
  };
  const ea = await run(A),
    eb = await run(B);
  if (ea && eb) bothFailed++;
  else applied++;
  let diff = null;
  if (Boolean(ea) !== Boolean(eb)) diff = `op outcome differs: A=${ea ?? 'ok'} B=${eb ?? 'ok'}`;
  else if (step % every === 0 || step === Number(args.steps)) {
    const ms = [
      [budgetId, monthsOf(budgetId)],
      [budget2.budgetId, monthsOf(budget2.budgetId)],
    ];
    const withRegisters =
      args['no-registers'] !== 'true' &&
      (step % Number(args['registers-every']) === 0 || step === Number(args.steps));
    const sa = snapshot(A, ms, withRegisters, step),
      sb = snapshot(B, ms, withRegisters, step);
    diff = firstDiff(sa, sb);
  }
  if (diff) {
    diffs++;
    out(`DIFF step ${step} op ${kind}: ${diff}`);
    if (args['keep-going'] !== 'true') break;
  } else if (step % 25 === 0)
    out(`step ${step} ok (applied ${applied}, both-failed ${bothFailed})`);
}
for (const name of ['A', 'B']) {
  const st = invariantStats[name];
  out(
    `invariant ${name}: ${st.checks} month checks, ${st.violations.length} violations${
      st.violations.length ? ` (first: ${JSON.stringify(st.violations[0])})` : ''
    }`
  );
  if (args['quiet-invariant'] !== 'true')
    for (const v of st.violations.slice(0, 20)) out(`  ${name} ${JSON.stringify(v)}`);
}
for (const name of ['A', 'B']) {
  const st = cashStats[name];
  out(
    `cash invariant ${name}: ${st.checks} month checks, ${st.violations.length} violations, tolerated ${JSON.stringify(st.known)}`
  );
  if (args['quiet-invariant'] !== 'true')
    for (const v of st.violations.slice(0, 20)) out(`  ${name} ${JSON.stringify(v)}`);
}
out(
  diffs
    ? `FAIL: ${diffs} diverging step(s)`
    : `PASS: 0 diffs after ${args.steps} steps (applied ${applied}, both-failed ${bothFailed})`
);
process.exitCode = diffs ? 1 : 0;
