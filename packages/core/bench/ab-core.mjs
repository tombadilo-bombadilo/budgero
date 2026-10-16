/* global process, performance */
// A/B of two core builds on one dataset, interleaved iteration by iteration in
// one process (machine load hits both alike). Kept light on purpose: small
// iteration counts and a per-case time budget, so slow paths are sampled, not
// sat on.
//
//   node bench/ab-core.mjs --a <base packages/core> --b <packages/core> --tx 100000
//        [--modes cumulative,monthly] [--iters 20] [--budget-ms 8000] [--case <regex>]
//        [--gen-core <core that generated the cached dataset>] [--app auto]
//
// Cases: getMonthlyBudget (current, month switch), Ready to Assign (+ breakdown),
// the budget reads right after a current-month edit / an assignment / a
// 5-years-back edit (the edit runs untimed first), and the interactions open
// budget page / switch month / assign money (mutation + the page's refetch set,
// app model from cases.mjs; persists excluded, as in ab.mjs). Prints p50 / p95 /
// p99 of each side and B/A of the p50. "write only" cases time the mutation alone
// (what the snapshot's triggers add to every write).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseArgs,
  fixClock,
  quiet,
  loadCore,
  openDb,
  stats,
  fmt,
  out,
  BENCH_DIR,
} from './lib.mjs';
import { generate } from './gen.mjs';
import { makeContext, interactions, p19Mutations, shiftMonth } from './cases.mjs';

const args = parseArgs(process.argv.slice(2), {
  tx: '50000',
  years: '10',
  seed: '42',
  end: '2026-10-15',
  modes: 'cumulative,monthly',
  iters: '20',
  'budget-ms': '8000',
  app: 'auto',
  'gen-core': path.join(BENCH_DIR, '..'),
});
for (const k of ['a', 'b', 'gen-core']) if (args[k]) args[k] = path.resolve(args[k]);
if (!args.a || !args.b) throw new Error('usage: bench/ab-core.mjs --a <core> --b <core> [options]');
fixClock(args.end);
quiet();
const caseFilter = args.case ? new RegExp(args.case, 'i') : null;
const iters = Number(args.iters);
const budgetMs = Number(args['budget-ms']);

const { hash: genHash } = await loadCore(args['gen-core']);
const dir = path.join(os.tmpdir(), 'budgero-bench', 'data');
const file = path.join(
  dir,
  `budget-${args.tx}tx-${args.years}y-s${args.seed}-${args.end}-${genHash}.sqlite`
);
if (!fs.existsSync(file)) {
  fs.mkdirSync(dir, { recursive: true });
  const { bytes, info } = await generate({ ...args, core: args['gen-core'], mode: 'cumulative' });
  fs.writeFileSync(file, bytes);
  fs.writeFileSync(`${file}.json`, JSON.stringify(info));
}
const bytes = fs.readFileSync(file);
const info = JSON.parse(fs.readFileSync(`${file}.json`, 'utf8'));
const cores = { A: (await loadCore(args.a)).core, B: (await loadCore(args.b)).core };

/** Named cases: { setup?: untimed fn before each sample, run: timed fn }. */
function casesFor(c) {
  const mb = c.s.monthlyBudgets;
  const list = {};
  let k = 0;
  list['getMonthlyBudget current'] = { run: () => mb.getMonthlyBudget(c.month, c.budgetId) };
  list['getMonthlyBudget month switch'] = {
    run: () => mb.getMonthlyBudget(shiftMonth(c.month, -1 - (k++ % 12)), c.budgetId),
  };
  list['RTA + breakdown'] = {
    run: () => {
      mb.getReadyToAssign(c.budgetId, c.month);
      mb.getReadyToAssignBreakdown(c.budgetId, c.month);
    },
  };
  const read = () => {
    mb.getMonthlyBudget(c.month, c.budgetId);
    mb.getReadyToAssignBreakdown(c.budgetId, c.month);
  };
  for (const [name, mutate] of Object.entries(p19Mutations(c)))
    list[`budget + RTA read ${name}`] = { setup: mutate, run: read };
  const ia = interactions(c);
  for (const name of [
    'open budget page',
    'switch month (uncached month)',
    'assign money in a category',
  ]) {
    const it = ia[name];
    list[`interaction: ${name}`] = {
      run: async () => {
        if (it.mutation) await it.mutation();
        for (const r of it.refetch()) r.fn();
      },
    };
  }
  // Write cost alone (the TEMP triggers fire on these): the mutation, no refetch.
  for (const name of [
    'edit amount cell',
    'add transaction (+3 continuous rules)',
    'bulk-categorize 50 rows',
  ]) {
    const it = ia[name];
    if (it?.mutation) list[`write only: ${name}`] = { run: () => it.mutation() };
  }
  return list;
}

const sample = async (cs) => {
  if (cs.setup) await cs.setup();
  const t = performance.now();
  await cs.run();
  return performance.now() - t;
};

out(
  `# A=${args.a} B=${args.b} tx=${args.tx} load ${os
    .loadavg()
    .map((x) => x.toFixed(1))
    .join(' ')}`
);
out(['mode', 'case', 'A p50', 'A p95', 'A p99', 'B p50', 'B p95', 'B p99', 'B/A', 'n'].join('\t'));
for (const mode of args.modes.split(',')) {
  const side = async (core) => {
    const db = await openDb(core, bytes);
    db.adapter.exec(`UPDATE budgets SET RtaMode='${mode}' WHERE ID=${info.budgetId}`);
    const ctx = makeContext({ ...db, info, today: args.end, app: args.app });
    return { ...db, cases: casesFor(ctx) };
  };
  const A = await side(cores.A);
  const B = await side(cores.B);
  // first budget read on a fresh session (B: includes building the snapshot)
  const cold = {};
  for (const [n, S] of [
    ['A', A],
    ['B', B],
  ]) {
    const t = performance.now();
    S.services.monthlyBudgets.getMonthlyBudget(args.end.slice(0, 7), info.budgetId);
    cold[n] = performance.now() - t;
  }
  out(
    [
      mode,
      'first read (cold)',
      fmt(cold.A),
      '',
      '',
      fmt(cold.B),
      '',
      '',
      (cold.B / cold.A).toFixed(3),
      1,
    ].join('\t')
  );
  for (const name of Object.keys(A.cases)) {
    if (caseFilter && !caseFilter.test(name)) continue;
    const sa = [];
    const sb = [];
    await sample(A.cases[name]);
    await sample(B.cases[name]);
    let spent = 0;
    for (let i = 0; i < iters; i++) {
      // alternate which side goes first
      const first = i % 2 ? ['B', sb, B] : ['A', sa, A];
      const second = i % 2 ? ['A', sa, A] : ['B', sb, B];
      for (const [, samples, S] of [first, second]) {
        const d = await sample(S.cases[name]);
        samples.push(d);
        spent += d;
      }
      if (spent > budgetMs && i >= 4) break;
    }
    const a = stats(sa);
    const b = stats(sb);
    out(
      [
        mode,
        name,
        fmt(a.p50),
        fmt(a.p95),
        fmt(a.p99),
        fmt(b.p50),
        fmt(b.p95),
        fmt(b.p99),
        a.p50 > 0 ? (b.p50 / a.p50).toFixed(3) : '-',
        sa.length,
      ].join('\t')
    );
  }
  A.adapter.close();
  B.adapter.close();
}
out(
  `# load ${os
    .loadavg()
    .map((x) => x.toFixed(1))
    .join(' ')}`
);
