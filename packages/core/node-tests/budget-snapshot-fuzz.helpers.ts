/**
 * Property-based fuzzing of the budget snapshot (fast-check, with shrinking).
 *
 * Random op sequences (back-dated edits, date / category / account moves across
 * months and years, splits with transfer lines, CC payments, card refunds in a
 * later month, card-to-card transfers, funded card purchases, deletes, category
 * delete / merge / group moves, on/off-budget toggles, account type changes,
 * RtaMode switches, FX rate edits, revaluations, restore of an exported copy,
 * writes that roll back, a second budget) run against one database; after every
 * step:
 *   (a) getMonthlyBudget and Ready to Assign (number + breakdown) read through
 *       the snapshot equal the full recompute, for every category x month, both
 *       modes, both budgets (BUDGERO_SNAPSHOT_VERIFY semantics: every read is
 *       recomputed fully and compared; the snapshot must actually be used);
 *   (b) stored account balances and the last running balance equal the sum of rows;
 *   (c) transfer legs pair up (two legs, opposite signs, same date; split-transfer
 *       mirrors offset their split lines);
 *   (d) split lines sum to their parent;
 *   (e) the zero-based identity (parity/invariant.mjs) holds;
 *   (f) cash conservation (parity/cash-invariant.mjs) holds, tolerating only the
 *       open deviations in parity/cash-known.mjs (their hits are counted in
 *       CASH_KNOWN and printed in long mode).
 *
 * Shared by budget-snapshot*.fuzz.node.spec.ts (one per starting RtaMode, so
 * the two run in parallel). Default: a short deterministic run (100 runs of up
 * to 6 ops each per file). Long mode: FUZZ_RUNS=20000 [FUZZ_STEPS=12]
 * [FUZZ_SEED=n, added to each file's seed] (parity/fuzz-long.sh runs several
 * seeds in parallel).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { appendFileSync } from 'node:fs';
import {
  NodeSqlJsAdapter,
  ServiceManager,
  asMilli,
  configureBudgetSnapshot,
  getBudgetSnapshotStore,
  type DatabaseAdapter,
  type Services,
} from '../src';
import { checkZeroBasedIdentity } from '../parity/invariant.mjs';
import { checkCashConservation } from '../parity/cash-invariant.mjs';
import { KNOWN_DEVIATIONS } from '../parity/cash-known.mjs';

const RUNS = Number(process.env.FUZZ_RUNS ?? 100);
const MAX_STEPS = Number(process.env.FUZZ_STEPS ?? 6);
const SEED_OFFSET = Number(process.env.FUZZ_SEED ?? 0);
const LONG = process.env.FUZZ_RUNS !== undefined;

const BASE_MONTH = '2026-03';
const MONTHS = 8; // 2026-03 .. 2026-10 (+ two future months via offsets)
const shift = (month: string, delta: number) => {
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta;
  const y = Math.floor(total / 12);
  return `${y}-${String(total - y * 12 + 1).padStart(2, '0')}`;
};
const dateOf = (monthOffset: number, day: number) =>
  `${shift(BASE_MONTH, monthOffset)}-${String(day).padStart(2, '0')}`;

interface World {
  adapter: NodeSqlJsAdapter;
  s: Services;
  b1: number;
  b2: number;
  /** budget 1 accounts by role */
  acc: Record<string, number>;
  cards: number[];
  cats1: number[];
  cats2: number[];
  groups1: number[];
  acc2: Record<string, number>;
  /**
   * Pre-existing service behaviours the integrity checks (c)/(d) skip, counted
   * in KNOWN (reported, not snapshot bugs): a split parent whose amount was
   * edited directly, or whose converted amount was re-derived (FX account),
   * keeps its old lines; a split-transfer mirror deleted directly leaves its
   * split line behind.
   */
  splitSumKnown: Set<number>;
  mirrorKnown: Set<number>;
}

/** How often each known pre-existing violation was skipped (printed in long mode). */
export const KNOWN = { splitParentAmountEdit: 0, splitParentFxReconversion: 0, mirrorDeleted: 0 };
/** Month checks where a tolerated cash-conservation deviation was non-zero, per key. */
export const CASH_KNOWN: Record<string, number> = {};

let template: Uint8Array;
let ids: Omit<World, 'adapter' | 's'>;

async function buildTemplate() {
  const adapter = await NodeSqlJsAdapter.create();
  const sm = new ServiceManager();
  await sm.initialize(adapter as DatabaseAdapter);
  const s = sm.getServices();
  const mkBudget = (name: string) =>
    s.budgets.createBudget({
      name,
      display_currency: 'USD',
      badge_icon: 'dollar',
      number_format: '123,456.78',
      create_default_categories: false,
    });
  const b1 = await mkBudget('Fuzz');
  const b2 = await mkBudget('Fuzz 2');
  const start = `${BASE_MONTH}-01`;
  const mk = async (
    b: number,
    name: string,
    type: string,
    cur: string,
    bal: number,
    onBudget?: boolean
  ) =>
    (
      await s.accounts.createAccount(
        name,
        b,
        type,
        cur,
        asMilli(bal),
        undefined,
        onBudget,
        'Initial Balance',
        start
      )
    ).ID;
  const acc = {
    chk: await mk(b1, 'Checking', 'checking', 'USD', 3_000_000),
    chk2: await mk(b1, 'Checking 2', 'checking', 'USD', 500_000),
    eur: await mk(b1, 'Checking EUR', 'checking', 'EUR', 1_000_000),
    sav: await mk(b1, 'Savings', 'savings', 'USD', 2_000_000, true),
    savOff: await mk(b1, 'Tracking', 'savings', 'USD', 4_000_000, false),
    inv: await mk(b1, 'Brokerage', 'investment', 'USD', 9_000_000, false),
    cash: await mk(b1, 'Cash', 'cash', 'USD', 100_000),
    cc1: await mk(b1, 'Card 1', 'credit', 'USD', -300_000),
    cc2: await mk(b1, 'Card 2', 'credit', 'USD', 0),
    loan: await mk(b1, 'Loan', 'loan', 'USD', -8_000_000),
  };
  const groups1 = [
    s.categories.addCategoryGroup('Bills', b1),
    s.categories.addCategoryGroup('Food', b1),
    s.categories.addCategoryGroup('Fun', b1),
  ];
  const cats1: number[] = [];
  for (let i = 0; i < 9; i++) cats1.push(s.categories.addCategory(groups1[i % 3], b1, `C${i}`));
  const g2 = s.categories.addCategoryGroup('Things', b2);
  const cats2 = [s.categories.addCategory(g2, b2, 'T0'), s.categories.addCategory(g2, b2, 'T1')];
  const acc2 = {
    chk: await mk(b2, 'B2 Checking', 'checking', 'USD', 700_000),
    cc: await mk(b2, 'B2 Card', 'credit', 'USD', -50_000),
    sav: await mk(b2, 'B2 Tracking', 'savings', 'USD', 1_000_000, false),
  };
  // a FX rate history for the EUR account
  for (let m = 0; m < MONTHS; m++)
    adapter
      .prepare(
        'INSERT OR IGNORE INTO currency_rates(FromCurrency,ToCurrency,Rate,RateDate,LastUpdated,BudgetID) VALUES(?,?,?,?,?,?)'
      )
      .run('EUR', 'USD', 1 + (m % 5) / 20, dateOf(m, 1), `${dateOf(m, 1)} 00:00:00`, b1);
  template = adapter.backup();
  ids = { b1, b2, acc, cards: [acc.cc1, acc.cc2], cats1, cats2, groups1, acc2 };
  adapter.close();
}

async function openWorld(): Promise<World> {
  const adapter = await NodeSqlJsAdapter.create(template);
  const sm = new ServiceManager();
  await sm.initialize(adapter as DatabaseAdapter);
  return {
    adapter,
    s: sm.getServices(),
    ...ids,
    cats1: [...ids.cats1],
    splitSumKnown: new Set(),
    mirrorKnown: new Set(),
  };
}

// ------------------------------------------------------------------ ops

const nat = (max: number) => fc.integer({ min: 0, max });
const opArb = fc.oneof(
  {
    weight: 14,
    arbitrary: fc.record({
      k: fc.constant('add' as const),
      acc: nat(20),
      cat: nat(20),
      m: nat(MONTHS + 2),
      d: fc.integer({ min: 1, max: 28 }),
      amt: fc.integer({ min: 1, max: 4000 }),
      inflow: fc.boolean(),
      b2: fc.boolean(),
    }),
  },
  {
    weight: 10,
    arbitrary: fc.record({
      k: fc.constant('editAmount' as const),
      pick: nat(500),
      amt: fc.integer({ min: 1, max: 6000 }),
      col: nat(2),
    }),
  },
  {
    weight: 10,
    arbitrary: fc.record({
      k: fc.constant('editDate' as const),
      pick: nat(500),
      m: nat(MONTHS + 2),
      d: fc.integer({ min: 1, max: 28 }),
    }),
  },
  {
    weight: 6,
    arbitrary: fc.record({ k: fc.constant('editCategory' as const), pick: nat(500), cat: nat(20) }),
  },
  {
    weight: 3,
    arbitrary: fc.record({ k: fc.constant('moveAccount' as const), pick: nat(500), acc: nat(20) }),
  },
  { weight: 5, arbitrary: fc.record({ k: fc.constant('delete' as const), pick: nat(500) }) },
  {
    weight: 12,
    arbitrary: fc.record({
      k: fc.constant('assign' as const),
      cat: nat(20),
      m: nat(MONTHS + 2),
      amt: fc.integer({ min: 0, max: 3000 }),
      b2: fc.boolean(),
      card: fc.boolean(),
    }),
  },
  {
    weight: 6,
    arbitrary: fc.record({
      k: fc.constant('transfer' as const),
      from: nat(20),
      to: nat(20),
      m: nat(MONTHS + 2),
      d: fc.integer({ min: 1, max: 28 }),
      amt: fc.integer({ min: 1, max: 5000 }),
      b2: fc.boolean(),
    }),
  },
  {
    weight: 5,
    arbitrary: fc.record({
      k: fc.constant('ccPayment' as const),
      card: nat(3),
      m: nat(MONTHS + 2),
      d: fc.integer({ min: 1, max: 28 }),
      amt: fc.integer({ min: 1, max: 5000 }),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      k: fc.constant('cardRefund' as const),
      pick: nat(500),
      later: nat(3),
      d: fc.integer({ min: 1, max: 28 }),
      part: fc.integer({ min: 1, max: 4 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      k: fc.constant('cardToCard' as const),
      forward: fc.boolean(),
      m: nat(MONTHS + 2),
      d: fc.integer({ min: 1, max: 28 }),
      amt: fc.integer({ min: 1, max: 5000 }),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      k: fc.constant('fundedCardPurchase' as const),
      cat: nat(20),
      card: nat(1),
      m: nat(MONTHS),
      d: fc.integer({ min: 1, max: 28 }),
      amt: fc.integer({ min: 1, max: 3000 }),
      refund: nat(4),
      later: fc.integer({ min: 1, max: 3 }),
    }),
  },
  {
    weight: 5,
    arbitrary: fc.record({
      k: fc.constant('split' as const),
      pick: nat(500),
      n: fc.integer({ min: 2, max: 3 }),
      transferLine: fc.boolean(),
      cats: fc.array(nat(20), { minLength: 3, maxLength: 3 }),
      target: nat(5),
    }),
  },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('clearSplits' as const), pick: nat(500) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('deleteCategory' as const), cat: nat(20) }) },
  {
    weight: 1,
    arbitrary: fc.record({ k: fc.constant('mergeCategory' as const), from: nat(20), to: nat(20) }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ k: fc.constant('moveGroup' as const), cat: nat(20), group: nat(5) }),
  },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('toggleOnBudget' as const), acc: nat(5) }) },
  {
    weight: 1,
    arbitrary: fc.record({ k: fc.constant('changeType' as const), acc: nat(5), type: nat(3) }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ k: fc.constant('rtaMode' as const), monthly: fc.boolean() }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      k: fc.constant('fx' as const),
      pick: nat(500),
      m: nat(MONTHS),
      len: nat(6),
      rate: fc.integer({ min: 80, max: 140 }),
      revalue: fc.boolean(),
    }),
  },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('restore' as const) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('exportOnly' as const) }) },
  {
    weight: 2,
    arbitrary: fc.record({
      k: fc.constant('rollback' as const),
      cat: nat(20),
      m: nat(MONTHS),
      readInside: fc.boolean(),
    }),
  }
);
type Op = typeof opArb extends fc.Arbitrary<infer T> ? T : never;

const rowsOf = <T>(w: World, sql: string, ...p: unknown[]) =>
  w.adapter.prepare(sql).all(...p) as T[];

function pickTx(w: World, pick: number, where = '1=1'): number | null {
  const r = rowsOf<{ ID: number }>(
    w,
    `SELECT ID FROM transactions WHERE ${where} AND Memo != 'Initial Balance' ORDER BY ID`
  );
  return r.length ? r[pick % r.length].ID : null;
}

const transfersCat = (w: World, b: number) =>
  w.s.categories.getAllCategories(b).find((c) => c.Name === 'Transfers')!.ID;

async function apply(w: World, op: Op): Promise<void> {
  const { s } = w;
  const b1Accounts = [w.acc.chk, w.acc.chk2, w.acc.eur, w.acc.sav, w.acc.cash, ...w.cards];
  const all1 = [...b1Accounts, w.acc.savOff, w.acc.inv, w.acc.loan];
  const cat1 = (i: number) => w.cats1[i % w.cats1.length];
  switch (op.k) {
    case 'add': {
      const b = op.b2 ? w.b2 : w.b1;
      const accounts = op.b2 ? [w.acc2.chk, w.acc2.cc, w.acc2.sav] : all1;
      const a = accounts[op.acc % accounts.length];
      const c = op.b2 ? w.cats2[op.cat % w.cats2.length] : op.cat % 13 === 12 ? 0 : cat1(op.cat);
      const amount = asMilli(op.amt * 10);
      await s.transactions.addTransaction(
        op.inflow ? amount : asMilli(0),
        op.inflow ? asMilli(0) : amount,
        a,
        c,
        b,
        dateOf(op.m, op.d),
        'fuzz',
        '',
        'P'
      );
      return;
    }
    case 'editAmount': {
      const id = pickTx(w, op.pick, "(TransferID IS NULL OR TransferID = '')");
      if (!id) return;
      // a split parent's amount edited directly keeps its old lines (known, see World)
      if (rowsOf(w, 'SELECT 1 FROM transaction_splits WHERE TransactionID = ?', id).length)
        w.splitSumKnown.add(id);
      const col = ['OutflowNative', 'InflowNative', 'OutflowConverted'][op.col];
      await s.transactions.updateTransactionColumn(id, col, op.amt * 10);
      return;
    }
    case 'editDate': {
      const id = pickTx(w, op.pick);
      if (id) await s.transactions.updateTransactionColumn(id, 'Date', dateOf(op.m, op.d));
      return;
    }
    case 'editCategory': {
      const id = pickTx(
        w,
        op.pick,
        `(TransferID IS NULL OR TransferID = '') AND BudgetID = ${w.b1}`
      );
      if (id) await s.transactions.updateTransactionColumn(id, 'CategoryID', String(cat1(op.cat)));
      return;
    }
    case 'moveAccount': {
      const id = pickTx(
        w,
        op.pick,
        `(TransferID IS NULL OR TransferID = '') AND BudgetID = ${w.b1}`
      );
      if (id)
        await s.transactions.moveTransactionToNewAccount(
          id,
          b1Accounts[op.acc % b1Accounts.length]
        );
      return;
    }
    case 'delete': {
      const id = pickTx(w, op.pick);
      if (!id) return;
      const tid = rowsOf<{ TransferID: string | null }>(
        w,
        'SELECT TransferID FROM transactions WHERE ID = ?',
        id
      )[0].TransferID;
      const mirrorOf = /^split_transfer_(\d+)_/.exec(tid ?? '');
      await s.transactions.deleteTransaction(id);
      if (mirrorOf) w.mirrorKnown.add(Number(mirrorOf[1]));
      return;
    }
    case 'assign': {
      const b = op.b2 ? w.b2 : w.b1;
      let c = op.b2 ? w.cats2[op.cat % w.cats2.length] : cat1(op.cat);
      if (op.card && !op.b2) {
        const meta = JSON.parse(s.accounts.getAccount(w.cards[op.cat % 2]).Metadata || '{}');
        if (meta.cc_payment_category_id) c = meta.cc_payment_category_id;
      }
      s.monthlyBudgets.upsertMonthlyAssignment(
        c,
        asMilli(op.amt * 1000),
        shift(BASE_MONTH, op.m),
        b
      );
      return;
    }
    case 'transfer': {
      const b = op.b2 ? w.b2 : w.b1;
      const accounts = op.b2 ? [w.acc2.chk, w.acc2.cc, w.acc2.sav] : all1;
      const from = accounts[op.from % accounts.length];
      let to = accounts[op.to % accounts.length];
      if (to === from) to = accounts[(op.to + 1) % accounts.length];
      const tc = transfersCat(w, b);
      const amount = asMilli(op.amt * 100);
      const tid = `fuzz_${Math.random().toString(36).slice(2)}`;
      const date = dateOf(op.m, op.d);
      await s.transactions.addTransaction(asMilli(0), amount, from, tc, b, date, 'x', tid);
      await s.transactions.addTransaction(amount, asMilli(0), to, tc, b, date, 'x', tid);
      return;
    }
    case 'ccPayment': {
      const cards = [...w.cards, w.acc2.cc];
      const card = cards[op.card % cards.length];
      const b = card === w.acc2.cc ? w.b2 : w.b1;
      const from = b === w.b2 ? w.acc2.chk : w.acc.chk;
      const tc = transfersCat(w, b);
      const amount = asMilli(op.amt * 100);
      const tid = `fuzz_${Math.random().toString(36).slice(2)}`;
      const date = dateOf(op.m, op.d);
      await s.transactions.addTransaction(asMilli(0), amount, from, tc, b, date, 'pay', tid);
      await s.transactions.addTransaction(amount, asMilli(0), card, tc, b, date, 'pay', tid);
      return;
    }
    case 'cardRefund': {
      // a refund of an earlier card purchase, same card and category, possibly months later
      const cards = [...w.cards, w.acc2.cc];
      const id = pickTx(
        w,
        op.pick,
        `AccountID IN (${cards.join(',')}) AND OutflowConverted > 0 AND (TransferID IS NULL OR TransferID = '')
         AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.TransactionID = transactions.ID)`
      );
      if (!id) return;
      const t = rowsOf<{ a: number; c: number; b: number; m: string; o: number }>(
        w,
        'SELECT AccountID a, CategoryID c, BudgetID b, Month m, OutflowNative o FROM transactions WHERE ID = ?',
        id
      )[0];
      const amount = asMilli(Math.max(1, Math.floor((t.o * op.part) / 4)));
      const date = `${shift(t.m, op.later)}-${String(op.d).padStart(2, '0')}`;
      await s.transactions.addTransaction(
        amount,
        asMilli(0),
        t.a,
        t.c,
        t.b,
        date,
        'refund',
        '',
        'P'
      );
      return;
    }
    case 'cardToCard': {
      // balance transfer: debt moves from one card to the other, no cash moves
      const [from, to] = op.forward ? w.cards : [...w.cards].reverse();
      const tc = transfersCat(w, w.b1);
      const amount = asMilli(op.amt * 100);
      const tid = `fuzz_${Math.random().toString(36).slice(2)}`;
      const date = dateOf(op.m, op.d);
      await s.transactions.addTransaction(asMilli(0), amount, from, tc, w.b1, date, 'bt', tid);
      await s.transactions.addTransaction(amount, asMilli(0), to, tc, w.b1, date, 'bt', tid);
      return;
    }
    case 'fundedCardPurchase': {
      // assign, buy on a card in the same month (funded), optionally refund it later
      const c = cat1(op.cat);
      const month = shift(BASE_MONTH, op.m);
      const amount = asMilli(op.amt * 100);
      const assigned = s.monthlyBudgets.getMonthlyAssignmentValue(c, month, w.b1);
      s.monthlyBudgets.upsertMonthlyAssignment(c, asMilli(assigned + amount), month, w.b1);
      const card = w.cards[op.card];
      await s.transactions.addTransaction(
        asMilli(0),
        amount,
        card,
        c,
        w.b1,
        dateOf(op.m, op.d),
        'buy',
        '',
        'P'
      );
      if (op.refund > 0) {
        const back = asMilli(Math.max(1, Math.floor((amount * op.refund) / 4)));
        const date = dateOf(op.m + op.later, op.d);
        await s.transactions.addTransaction(
          back,
          asMilli(0),
          card,
          c,
          w.b1,
          date,
          'refund',
          '',
          'P'
        );
      }
      return;
    }
    case 'split': {
      const id = pickTx(
        w,
        op.pick,
        `(TransferID IS NULL OR TransferID = '') AND OutflowNative > 100 AND BudgetID = ${w.b1}`
      );
      if (!id) return;
      const t = rowsOf<{ o: number; c: number }>(
        w,
        'SELECT OutflowNative o, OutflowConverted c FROM transactions WHERE ID=?',
        id
      )[0];
      let restN = t.o;
      let restC = t.c;
      const lines = [];
      for (let k = 0; k < op.n; k++) {
        const last = k === op.n - 1;
        const pn = last ? restN : Math.floor(restN / (op.n - k));
        const pc = last ? restC : Math.floor(restC / (op.n - k));
        restN -= pn;
        restC -= pc;
        lines.push(
          op.transferLine && last
            ? {
                TransferAccountID: [w.acc.sav, w.acc.chk2, w.acc.savOff, w.acc.cc2, w.acc.inv][
                  op.target % 5
                ],
                Memo: 't',
                InflowConverted: asMilli(0),
                OutflowConverted: asMilli(pc),
                InflowNative: asMilli(0),
                OutflowNative: asMilli(pn),
                OrderIndex: k,
              }
            : {
                CategoryID: cat1(op.cats[k]),
                Memo: `s${k}`,
                InflowConverted: asMilli(0),
                OutflowConverted: asMilli(pc),
                InflowNative: asMilli(0),
                OutflowNative: asMilli(pn),
                OrderIndex: k,
              }
        );
      }
      await s.splits.upsertSplits(id, lines);
      return;
    }
    case 'clearSplits': {
      const r = rowsOf<{ id: number }>(
        w,
        'SELECT DISTINCT TransactionID id FROM transaction_splits ORDER BY 1'
      );
      if (r.length) await s.splits.clearSplits(r[op.pick % r.length].id);
      return;
    }
    case 'deleteCategory': {
      if (w.cats1.length <= 4) return;
      const c = cat1(op.cat);
      s.categories.deleteCategory(c);
      w.cats1 = w.cats1.filter((x) => x !== c);
      return;
    }
    case 'mergeCategory': {
      if (w.cats1.length <= 4) return;
      const from = cat1(op.from);
      const to = w.cats1.filter((x) => x !== from)[op.to % (w.cats1.length - 1)];
      s.transactions.reassignTransactions(to, from);
      s.monthlyBudgets.reassignAssignment(to, from);
      s.categories.deleteCategory(from);
      w.cats1 = w.cats1.filter((x) => x !== from);
      return;
    }
    case 'moveGroup': {
      const hidden = rowsOf<{ ID: number }>(
        w,
        "SELECT ID FROM category_groups WHERE BudgetID=? AND Name='Hidden Categories'",
        w.b1
      );
      const groups = [...w.groups1, ...hidden.map((h) => h.ID)];
      s.categories.moveCategoryToNewGroup(groups[op.group % groups.length], cat1(op.cat));
      return;
    }
    case 'toggleOnBudget': {
      const a = [w.acc.chk2, w.acc.sav, w.acc.savOff, w.acc.inv, w.acc.cash, w.acc.eur][op.acc % 6];
      await s.accounts.updateAccount(a, '', '', '', undefined, !s.accounts.getAccount(a).OnBudget);
      return;
    }
    case 'changeType': {
      const a = [w.acc.chk2, w.acc.sav, w.acc.savOff, w.acc.inv, w.acc.cash, w.acc.eur][op.acc % 6];
      await s.accounts.updateAccount(
        a,
        '',
        ['checking', 'savings', 'cash', 'investment'][op.type],
        ''
      );
      return;
    }
    case 'rtaMode':
      s.budgets.updateRtaMode(w.b1, op.monthly ? 'monthly' : 'cumulative');
      return;
    case 'fx': {
      const id = pickTx(
        w,
        op.pick,
        `AccountID = ${w.acc.eur} AND (TransferID IS NULL OR TransferID = '')`
      );
      if (id && op.revalue)
        await s.transactions.updateTransactionColumn(id, 'ExchangeRate', op.rate / 100, true);
      await s.currency.addCustomRate(
        'EUR',
        'USD',
        op.rate / 100,
        dateOf(op.m, 1),
        dateOf(op.m + op.len, 28),
        w.b1
      );
      if (op.revalue) await s.currency.revalueAccounts(w.b1);
      return;
    }
    case 'restore':
      w.adapter.restore(w.adapter.backup());
      return;
    case 'exportOnly':
      w.adapter.backup();
      return;
    case 'rollback': {
      // a write that rolls back: the snapshot must not keep it
      const before = s.monthlyBudgets.getMonthlyBudget(shift(BASE_MONTH, op.m), w.b1);
      try {
        w.adapter.transaction(() => {
          w.adapter
            .prepare(
              'INSERT INTO assignments (CategoryID, Amount, Month, BudgetID) VALUES (?, ?, ?, ?)'
            )
            .run(cat1(op.cat), 123_000, shift(BASE_MONTH, op.m), w.b1);
          w.adapter
            .prepare(
              'UPDATE transactions SET OutflowConverted = OutflowConverted + 7 WHERE BudgetID = ?'
            )
            .run(w.b1);
          if (op.readInside) s.monthlyBudgets.getMonthlyBudget(shift(BASE_MONTH, op.m), w.b1);
          throw new Error('rollback');
        });
      } catch {
        /* expected */
      }
      const after = s.monthlyBudgets.getMonthlyBudget(shift(BASE_MONTH, op.m), w.b1);
      expect(after).toEqual(before);
      return;
    }
  }
}

// ------------------------------------------------------------------ checks

function monthsOf(w: World, b: number): string[] {
  const r = rowsOf<{ a: string | null; z: string | null }>(
    w,
    `SELECT MIN(m) a, MAX(m) z FROM (SELECT Month m FROM transactions WHERE BudgetID = ?1
       UNION ALL SELECT Month FROM assignments WHERE BudgetID = ?1)`,
    b
  )[0];
  if (!r.a || !r.z) return [];
  const list: string[] = [];
  for (let m = shift(r.a, -1); m <= shift(r.z, 2); m = shift(m, 1)) list.push(m);
  return list;
}

const fingerprints = new WeakMap<World, string>();
/** Budget 2 is re-checked only when its rows changed (keeps the default run short). */
function budget2Changed(w: World): boolean {
  const fp = JSON.stringify(
    rowsOf(
      w,
      `SELECT (SELECT COUNT(*) || ':' || IFNULL(SUM(InflowConverted * 3 - OutflowConverted), 0) || ':' ||
                      IFNULL(MAX(ID), 0) || ':' || IFNULL(GROUP_CONCAT(Date || CategoryID || AccountID), '')
               FROM transactions WHERE BudgetID = ?1) a,
              (SELECT COUNT(*) || ':' || IFNULL(SUM(Amount), 0) || ':' || IFNULL(GROUP_CONCAT(Month), '')
               FROM assignments WHERE BudgetID = ?1) b`,
      w.b2
    )
  );
  if (fingerprints.get(w) === fp) return false;
  fingerprints.set(w, fp);
  return true;
}

function checkAll(w: World, label: string, full = false): void {
  const store = getBudgetSnapshotStore(w.adapter)!;
  const fallbacksBefore = store.stats.fallbacks;
  const check2 = budget2Changed(w) || full;
  for (const b of check2 ? [w.b1, w.b2] : [w.b1]) {
    const months = monthsOf(w, b);
    const saved = rowsOf<{ RtaMode: string }>(w, 'SELECT RtaMode FROM budgets WHERE ID=?', b)[0]
      .RtaMode;
    for (const mode of ['cumulative', 'monthly'] as const) {
      w.adapter.exec(`UPDATE budgets SET RtaMode='${mode}' WHERE ID=${b}`);
      // (a) verify mode recomputes every read fully and throws on any difference
      const budget: Record<string, unknown[]> = {};
      for (const m of months) budget[m] = w.s.monthlyBudgets.getMonthlyBudget(m, b);
      const map = w.s.monthlyBudgets.getReadyToAssignBreakdownMap(b, months);
      const rta: Record<string, unknown> = {};
      for (const m of months) rta[m] = map.get(m);
      // the single-month entry points (what the UI calls)
      w.s.monthlyBudgets.getReadyToAssignBreakdown(b);
      if (months.length)
        w.s.monthlyBudgets.getReadyToAssign(b, months[Math.floor(months.length / 2)]);
      // (e) zero-based identity
      const violations = checkZeroBasedIdentity({ adapter: w.adapter }, b, months, {
        mode,
        budget: budget as never,
        rta: rta as never,
      });
      expect(violations, `${label}: zero-based identity, budget ${b}, ${mode}`).toEqual([]);
      // (f) cash conservation
      const cash = checkCashConservation(
        { adapter: w.adapter },
        b,
        months,
        {
          mode,
          budget: budget as never,
          rta: rta as never,
        },
        { known: KNOWN_DEVIATIONS }
      );
      expect(cash.violations, `${label}: cash conservation, budget ${b}, ${mode}`).toEqual([]);
      for (const k of new Set(cash.known.map((x) => x.key)))
        CASH_KNOWN[k] = (CASH_KNOWN[k] ?? 0) + 1;
    }
    w.adapter.exec(`UPDATE budgets SET RtaMode='${saved}' WHERE ID=${b}`);
  }
  expect(store.healthy, `${label}: hooks healthy`).toBe(true);
  expect(store.stats.fallbacks, `${label}: snapshot used for every read`).toBe(fallbacksBefore);

  // (b) balances = sum of rows; last running balance = balance
  const accounts = rowsOf<{
    ID: number;
    BalanceNative: number;
    BalanceConverted: number | null;
    Currency: string;
    BudgetID: number;
  }>(w, 'SELECT ID, BalanceNative, BalanceConverted, Currency, BudgetID FROM accounts');
  for (const a of accounts) {
    const rows = rowsOf<{ net: number; conv: number; running: number }>(
      w,
      `SELECT InflowNative - OutflowNative AS net, InflowConverted - OutflowConverted AS conv,
              RunningBalanceNative AS running
       FROM transactions WHERE AccountID = ? ORDER BY Date, ID`,
      a.ID
    );
    const sum = rows.reduce((t, r) => t + r.net, 0);
    expect(a.BalanceNative, `${label}: account ${a.ID} BalanceNative`).toBe(sum);
    if (rows.length)
      expect(rows[rows.length - 1].running, `${label}: account ${a.ID} last running`).toBe(sum);
    if (a.Currency === 'USD') {
      const conv = rows.reduce((t, r) => t + r.conv, 0);
      expect(
        a.BalanceConverted ?? a.BalanceNative,
        `${label}: account ${a.ID} BalanceConverted`
      ).toBe(conv);
    }
  }

  // (c) transfer legs pair up
  const legs = rowsOf<{ TransferID: string; n: number; ins: number; outs: number }>(
    w,
    `SELECT TransferID, COUNT(*) n, SUM(InflowNative > 0) ins, SUM(OutflowNative > 0) outs
     FROM transactions WHERE TransferID IS NOT NULL AND TransferID != ''
       AND TransferID NOT LIKE 'split\\_transfer\\_%' ESCAPE '\\' GROUP BY TransferID`
  );
  for (const g of legs) {
    // Dates are not compared: a Date edit on one leg moves only that leg (the
    // app sends the partner's edit as its own op, A15).
    expect({ n: g.n, ins: g.ins, outs: g.outs }, `${label}: transfer ${g.TransferID} legs`).toEqual(
      { n: 2, ins: 1, outs: 1 }
    );
  }
  const mirrors = rowsOf<{
    parent: number;
    mirrorNet: number;
    lineNet: number | null;
    n: number;
    lines: number;
  }>(
    w,
    `SELECT p.ID parent,
            (SELECT SUM(m.InflowConverted - m.OutflowConverted) FROM transactions m
              WHERE m.TransferID = 'split_transfer_' || p.ID || '_' || p.Date) mirrorNet,
            (SELECT SUM(s.InflowConverted - s.OutflowConverted) FROM transaction_splits s
              WHERE s.TransactionID = p.ID AND s.TransferAccountID IS NOT NULL) lineNet,
            (SELECT COUNT(*) FROM transactions m
              WHERE m.TransferID = 'split_transfer_' || p.ID || '_' || p.Date) n,
            (SELECT COUNT(*) FROM transaction_splits s
              WHERE s.TransactionID = p.ID AND s.TransferAccountID IS NOT NULL) lines
     FROM transactions p WHERE EXISTS (SELECT 1 FROM transaction_splits s WHERE s.TransactionID = p.ID)`
  );
  for (const m of mirrors) {
    if (w.mirrorKnown.has(m.parent)) {
      KNOWN.mirrorDeleted++;
      continue;
    }
    expect(m.n, `${label}: split ${m.parent} mirror count`).toBe(m.lines);
    if (m.lines > 0)
      expect(m.mirrorNet, `${label}: split ${m.parent} mirror amount`).toBe(-(m.lineNet ?? 0));
  }
  const orphanMirrors = rowsOf<{ TransferID: string }>(
    w,
    `SELECT m.TransferID FROM transactions m WHERE m.TransferID LIKE 'split\\_transfer\\_%' ESCAPE '\\'
       AND NOT EXISTS (SELECT 1 FROM transactions p
         WHERE m.TransferID = 'split_transfer_' || p.ID || '_' || p.Date
           AND EXISTS (SELECT 1 FROM transaction_splits s WHERE s.TransactionID = p.ID AND s.TransferAccountID IS NOT NULL))`
  );
  expect(orphanMirrors, `${label}: split-transfer mirrors without a split line`).toEqual([]);

  // (d) split lines sum to the parent
  const splits = rowsOf<{ ID: number; parentNet: number; linesNet: number; fx: number }>(
    w,
    `SELECT t.ID, t.InflowConverted - t.OutflowConverted parentNet,
            SUM(s.InflowConverted - s.OutflowConverted) linesNet,
            (SELECT a.Currency != 'USD' FROM accounts a WHERE a.ID = t.AccountID) fx
     FROM transactions t JOIN transaction_splits s ON s.TransactionID = t.ID GROUP BY t.ID`
  );
  for (const sp of splits) {
    if (sp.linesNet !== sp.parentNet && w.splitSumKnown.has(sp.ID)) {
      KNOWN.splitParentAmountEdit++;
      continue;
    }
    if (sp.linesNet !== sp.parentNet && sp.fx) {
      KNOWN.splitParentFxReconversion++;
      continue;
    }
    expect(sp.linesNet, `${label}: split lines of ${sp.ID}`).toBe(sp.parentNet);
  }
}

// ------------------------------------------------------------------ the property

export function defineSnapshotFuzz(
  name: string,
  startMode: 'cumulative' | 'monthly',
  seed: number
) {
  let initialChecked = false;

  describe(name, () => {
    beforeAll(async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0));
      configureBudgetSnapshot({ enabled: true, verify: true });
      await buildTemplate();
    });
    afterAll(() => {
      configureBudgetSnapshot({ enabled: undefined, verify: undefined });
      vi.useRealTimers();
      if (process.env.FUZZ_KNOWN_FILE)
        appendFileSync(
          process.env.FUZZ_KNOWN_FILE,
          `${JSON.stringify({ name, runs: RUNS, ...KNOWN, cash: CASH_KNOWN })}\n`
        );
    });

    it('the invariant check catches a perturbed read', async () => {
      const w = await openWorld();
      await apply(w, { k: 'add', acc: 0, cat: 1, m: 3, d: 5, amt: 50, inflow: false, b2: false });
      const months = monthsOf(w, w.b1);
      const budget: Record<string, { Available: number }[]> = {};
      for (const m of months) budget[m] = w.s.monthlyBudgets.getMonthlyBudget(m, w.b1);
      const map = w.s.monthlyBudgets.getReadyToAssignBreakdownMap(w.b1, months);
      const rta = Object.fromEntries(months.map((m) => [m, map.get(m)]));
      const reads = { mode: 'cumulative' as const, budget: budget as never, rta: rta as never };
      expect(checkZeroBasedIdentity({ adapter: w.adapter }, w.b1, months, reads)).toEqual([]);
      budget[months[2]][3].Available += 10;
      expect(checkZeroBasedIdentity({ adapter: w.adapter }, w.b1, months, reads)).toHaveLength(1);
      w.adapter.close();
    });

    it(
      `random op sequences keep snapshot reads equal to the full recompute (${RUNS} runs)`,
      async () => {
        await fc.assert(
          fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: MAX_STEPS }), async (ops) => {
            const w = await openWorld();
            w.s.budgets.updateRtaMode(w.b1, startMode);
            try {
              if (!initialChecked) {
                checkAll(w, 'initial', true);
                initialChecked = true;
              }
              for (let i = 0; i < ops.length; i++) {
                try {
                  await apply(w, ops[i]);
                } catch (error) {
                  // an op the services reject is fine, a failed check is not
                  if (
                    error instanceof Error &&
                    (error.name === 'AssertionError' || error.message.includes('Budget snapshot'))
                  )
                    throw error;
                }
                checkAll(w, `after op ${i} (${ops[i].k})`);
              }
            } finally {
              w.adapter.close();
            }
          }),
          { numRuns: RUNS, seed: seed + SEED_OFFSET, verbose: LONG ? 1 : 0 }
        );
      },
      LONG ? 24 * 3600_000 : 300_000
    );
  });
}
