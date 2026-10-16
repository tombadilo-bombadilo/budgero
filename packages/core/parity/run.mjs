/* global process */
// Parity suite: run the same seeded random mutation sequence against two core
// builds (or one build twice, with an init hook switching an implementation on
// one side) and compare every derived figure after each step. Zero diffs allowed.
//
//   node parity/run.mjs --a <packages/core> --b <packages/core> [--seed 1] [--steps 150]
//        [--tx 1200 --years 3] [--a-init hook.mjs] [--b-init hook.mjs] [--every 1]
//        [--ops add,edit,...] [--keep-going] [--registers-every 10] [--no-registers]
//
// Compared after each checked step, in BOTH RtaMode settings:
//   - getMonthlyBudget(month) for every month from the first ledger month to two
//     months past the last one: every row (category) and every field
//   - Ready to Assign breakdown for every one of those months
//   - listAccounts (balances, metadata), and every transaction's running balances
//   - every account register (getTransactionsByAccount) every --registers-every steps
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

const args = parseArgs(process.argv.slice(2), {
  seed: '1',
  steps: '150',
  tx: '800',
  years: '3',
  end: '2026-10-15',
  every: '1',
  'registers-every': '10',
  'gen-core': path.join(BENCH_DIR, '..'),
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
const A = await side('A', args.a, args['a-init']);
const B = await side('B', args.b, args['b-init']);
out(
  `parity A=${args.a} (${A.hash}) B=${args.b} (${B.hash}) seed=${SEED} steps=${args.steps} ledger=${info.transactions} tx`
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

/** Each op returns a function (services) => Promise, applied identically to both sides. */
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
    return (s) => {
      s.transactions.reassignTransactions(to, from);
      s.monthlyBudgets.reassignAssignment(to, from);
      s.categories.deleteCategory(from);
    };
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
  split: 5,
  clearSplits: 2,
  exchangeRate: 3,
  deleteCategory: 1,
  mergeCategory: 1,
};
const enabled = args.ops ? args.ops.split(',') : Object.keys(weights);
const bag = enabled.flatMap((k) => Array(weights[k] ?? 1).fill(k));

// ---- snapshot + compare ----
function months() {
  const r = rowsA(
    'SELECT MIN(Month) a, MAX(Month) b FROM transactions WHERE BudgetID=?',
    budgetId
  )[0];
  const list = [];
  for (let m = r.a; m <= shiftMonth(r.b, 2); m = shiftMonth(m, 1)) list.push(m);
  return list;
}
const canon = (rows, key) =>
  [...rows].sort((x, y) => (x[key] > y[key] ? 1 : x[key] < y[key] ? -1 : 0));
function snapshot(S, monthList, withRegisters) {
  const snap = {};
  for (const mode of ['cumulative', 'monthly']) {
    S.adapter.exec(`UPDATE budgets SET RtaMode='${mode}' WHERE ID=${budgetId}`);
    for (const m of monthList)
      snap[`${mode}/getMonthlyBudget/${m}`] = canon(
        S.services.monthlyBudgets.getMonthlyBudget(m, budgetId),
        'CategoryID'
      );
    // RTA for every month: the batch API where it exists (one rollforward), else per month
    const mb = S.services.monthlyBudgets;
    const rta =
      typeof mb.getReadyToAssignBreakdownMap === 'function'
        ? mb.getReadyToAssignBreakdownMap(budgetId, monthList)
        : null;
    for (const m of monthList)
      snap[`${mode}/rta/${m}`] = rta ? rta.get(m) : mb.getReadyToAssignBreakdown(budgetId, m);
    // the single-month entry point too (it is what the UI calls)
    snap[`${mode}/rta-current`] = mb.getReadyToAssignBreakdown(budgetId, args.end.slice(0, 7));
  }
  S.adapter.exec(`UPDATE budgets SET RtaMode='cumulative' WHERE ID=${budgetId}`);
  snap.accounts = canon(S.services.accounts.listAccounts(budgetId), 'ID');
  snap.running = S.adapter
    .prepare(
      'SELECT ID, AccountID, RunningBalanceConverted, RunningBalanceNative FROM transactions ORDER BY ID'
    )
    .all();
  if (withRegisters)
    for (const a of snap.accounts)
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
      await op(S.services);
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
    const ms = months();
    const withRegisters =
      args['no-registers'] !== 'true' &&
      (step % Number(args['registers-every']) === 0 || step === Number(args.steps));
    const sa = snapshot(A, ms, withRegisters),
      sb = snapshot(B, ms, withRegisters);
    diff = firstDiff(sa, sb);
  }
  if (diff) {
    diffs++;
    out(`DIFF step ${step} op ${kind}: ${diff}`);
    if (args['keep-going'] !== 'true') break;
  } else if (step % 25 === 0)
    out(`step ${step} ok (applied ${applied}, both-failed ${bothFailed})`);
}
out(
  diffs
    ? `FAIL: ${diffs} diverging step(s)`
    : `PASS: 0 diffs after ${args.steps} steps (applied ${applied}, both-failed ${bothFailed})`
);
process.exitCode = diffs ? 1 : 0;
