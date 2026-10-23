/* global process, performance */
// A/B of two app models on one core, interleaved iteration by iteration in one
// process, so machine load hits both sides alike (a shared box makes
// back-to-back runs unfair). Same dataset and options as run.mjs.
//
//   node bench/ab.mjs --core . --tx 50000 --a new --b refetch [--modes cumulative,monthly]
//        [--iters 15] [--case <regex>]
//
// Prints per interaction the p50 of A and B (mutation + refetch set) and B/A.
// Persists are left out: both sides persist the same number of times (the
// `persists` column; see run.mjs's persist suite for the per-persist cost).
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
import { makeContext, interactions } from './cases.mjs';

const args = parseArgs(process.argv.slice(2), {
  tx: '50000',
  years: '10',
  seed: '42',
  end: '2026-10-15',
  modes: 'cumulative,monthly',
  iters: '15',
  a: 'new',
  b: 'refetch',
  'gen-core': path.join(BENCH_DIR, '..'),
});
for (const k of ['core', 'gen-core']) if (args[k]) args[k] = path.resolve(args[k]);
fixClock(args.end);
quiet();
const caseFilter = args.case ? new RegExp(args.case, 'i') : null;
const iters = Number(args.iters);

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
const { core } = await loadCore(args.core);

const side = async (app, mode) => {
  const db = await openDb(core, bytes);
  db.adapter.exec(`UPDATE budgets SET RtaMode='${mode}' WHERE ID=${info.budgetId}`);
  const ctx = makeContext({ ...db, info, today: args.end, app });
  return { ...db, list: interactions(ctx) };
};
const run = async (it) => {
  const t = performance.now();
  if (it.mutation) await it.mutation();
  for (const r of it.refetch()) r.fn();
  return performance.now() - t;
};

// per-persist main-thread cost (export + Blob copy; LZ4 excluded: see note below)
const { adapter: padapter } = await openDb(core, bytes);
const ps = [];
for (let i = 0; i < 10; i++) {
  const t = performance.now();
  padapter.backup().slice();
  ps.push(performance.now() - t);
}
padapter.close();
const exportMs = stats(ps).p50;
out(
  `# load ${os
    .loadavg()
    .map((x) => x.toFixed(1))
    .join(' ')}; export+copy per persist ${fmt(exportMs)} ms`
);
out(
  [
    'mode',
    'interaction',
    `${args.a} p50`,
    `${args.b} p50`,
    `${args.b}/${args.a}`,
    'persists',
    'n',
  ].join('\t')
);

for (const mode of args.modes.split(',')) {
  const A = await side(args.a, mode);
  const B = await side(args.b, mode);
  for (const name of Object.keys(A.list)) {
    if (caseFilter && !caseFilter.test(name)) continue;
    const budgetModeOnly = /budget page|switch month|assign/.test(name);
    if (mode !== args.modes.split(',')[0] && !budgetModeOnly) continue;
    const heavy = /bank-sync|bulk/.test(name);
    const n = heavy ? 2 : iters;
    const sa = [],
      sb = [];
    if (!heavy) {
      await run(A.list[name]);
      await run(B.list[name]);
    }
    for (let i = 0; i < n; i++) {
      // alternate which side goes first
      if (i % 2) {
        sb.push(await run(B.list[name]));
        sa.push(await run(A.list[name]));
      } else {
        sa.push(await run(A.list[name]));
        sb.push(await run(B.list[name]));
      }
    }
    const a = stats(sa).p50,
      b = stats(sb).p50;
    out(
      [mode, name, fmt(a), fmt(b), a > 0 ? (b / a).toFixed(2) : '-', A.list[name].persists, n].join(
        '\t'
      )
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
