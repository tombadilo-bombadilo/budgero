/* global process, performance */
// CPU-profile one bench case with the V8 inspector and print where the time goes.
//
//   node bench/profile.mjs --core <packages/core> --tx 50000 --case "getMonthlyBudget current" \
//        [--mode monthly] [--iters 20] [--out /tmp/case.cpuprofile]
//
// --case matches (regex, case-insensitive) a query, p19 or interaction case name.
// The .cpuprofile opens in Chrome DevTools (Performance > Load profile).
// Summary buckets: "sqlite (wasm)" = SQLite engine inside sql.js, "sql.js glue" =
// statement binding / row marshalling in sql.js JS, "core" = Budgero core JS.
import fs from 'node:fs';
import path from 'node:path';
import inspector from 'node:inspector/promises';
import { parseArgs, fixClock, quiet, loadCore, openDb, out } from './lib.mjs';
import { makeContext, queryCases, p19Cases, interactions } from './cases.mjs';

const args = parseArgs(process.argv.slice(2), {
  tx: '50000',
  years: '10',
  seed: '42',
  end: '2026-10-15',
  mode: 'cumulative',
  iters: '20',
  app: 'auto',
});
for (const k of ['core', 'db', 'out']) if (args[k]) args[k] = path.resolve(args[k]);
if (!args.core || !args.case)
  throw new Error(
    'usage: profile.mjs --core <packages/core> --case <regex> [--tx N --mode cumulative|monthly --iters N --out file]'
  );
fixClock(args.end);
quiet();
const { core } = await loadCore(args.core);
const dbFile =
  args.db ||
  (() => {
    const dir = path.join(process.env.TMPDIR || '/tmp', 'budgero-bench', 'data');
    const f = fs
      .readdirSync(dir)
      .find(
        (x) =>
          x.startsWith(`budget-${args.tx}tx-${args.years}y-s${args.seed}-${args.end}-`) &&
          x.endsWith('.sqlite')
      );
    if (!f)
      throw new Error(
        'dataset not generated yet: run bench/run.mjs once with the same --tx/--years/--seed'
      );
    return path.join(dir, f);
  })();
const info = JSON.parse(fs.readFileSync(`${dbFile}.json`, 'utf8'));
const db = await openDb(core, fs.readFileSync(dbFile));
db.adapter.exec(`UPDATE budgets SET RtaMode='${args.mode}' WHERE ID=${info.budgetId}`);
const ctx = makeContext({ ...db, info, today: args.end, app: args.app });
const re = new RegExp(args.case, 'i');
const qc = queryCases(ctx);
const Q = core.MonthlyBudgetQueries ? new core.MonthlyBudgetQueries(db.adapter) : null;
const all = [
  ...qc.budget,
  ...qc.other,
  ...p19Cases(ctx, Q),
  ...Object.entries(interactions(ctx)).map(([n, it]) => [
    n,
    async () => {
      if (it.mutation) await it.mutation();
      for (const r of it.refetch()) r.fn();
    },
  ]),
];
const hit = all.find(([n]) => re.test(n));
if (!hit) throw new Error(`no case matches ${args.case}`);
const [name, fn] = hit;
await fn(0); // warm-up
// per-statement timing: wrap the adapter's prepare so every get/all/run is attributed to its SQL
const sqlTime = new Map();
const realPrepare = db.adapter.prepare.bind(db.adapter);
db.adapter.prepare = (sql) => {
  const st = realPrepare(sql);
  const key = sql.replace(/\s+/g, ' ').trim().slice(0, 140);
  const wrap =
    (m) =>
    (...a) => {
      const t = performance.now();
      try {
        return st[m](...a);
      } finally {
        const e = sqlTime.get(key) || { ms: 0, n: 0 };
        e.ms += performance.now() - t;
        e.n++;
        sqlTime.set(key, e);
      }
    };
  return {
    ...st,
    get: wrap('get'),
    all: wrap('all'),
    run: wrap('run'),
    finalize: () => st.finalize?.(),
  };
};
const session = new inspector.Session();
session.connect();
await session.post('Profiler.enable');
await session.post('Profiler.setSamplingInterval', { interval: 200 });
await session.post('Profiler.start');
const t0 = performance.now();
for (let i = 0; i < Number(args.iters); i++) await fn(i + 1);
const wall = performance.now() - t0;
const { profile } = await session.post('Profiler.stop');
db.adapter.prepare = realPrepare;
const file =
  args.out ||
  path.join(
    process.env.TMPDIR || '/tmp',
    `budgero-${name.replace(/\W+/g, '_')}-${args.mode}.cpuprofile`
  );
fs.writeFileSync(file, JSON.stringify(profile));

// self time per node -> function + bucket
const dt = new Map();
for (let i = 0; i < profile.samples.length; i++)
  dt.set(profile.samples[i], (dt.get(profile.samples[i]) || 0) + (profile.timeDeltas[i] || 0));
const byFn = new Map(),
  byBucket = new Map();
const bucket = (cf) => {
  if (/wasm/.test(cf.url) || /^\$?wasm-function|^\$/.test(cf.functionName)) return 'sqlite (wasm)';
  if (
    /sql\.js|sql-wasm/.test(cf.url) ||
    /^(Statement|Database|Ub|xb|tb|ub|vb)/.test(cf.functionName)
  )
    return 'sql.js glue';
  if (cf.url.includes('core-')) return 'core / sql.js bundle (JS)';
  if (cf.functionName === '(garbage collector)') return 'GC';
  if (cf.functionName === '(program)' || cf.functionName === '(idle)') return 'other';
  return 'node / other JS';
};
for (const n of profile.nodes) {
  const us = dt.get(n.id) || 0;
  if (!us) continue;
  const cf = n.callFrame;
  const key =
    `${cf.functionName || '(anonymous)'} ${cf.url ? `${path.basename(cf.url)}:${cf.lineNumber + 1}` : ''}`.trim();
  byFn.set(key, (byFn.get(key) || 0) + us);
  const b = bucket(cf);
  byBucket.set(b, (byBucket.get(b) || 0) + us);
}
const total = [...byBucket.values()].reduce((a, b) => a + b, 0);
out(
  `case: ${name} [${args.mode}] x${args.iters}: wall ${wall.toFixed(0)} ms (${(wall / Number(args.iters)).toFixed(1)} ms/iter); profile ${file}`
);
out(
  `buckets: ${[...byBucket]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${((100 * v) / total).toFixed(0)}%`)
    .join(', ')}`
);
out('top self time:');
for (const [k, v] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 12))
  out(`  ${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`);
out('top SQL statements (wall ms per iteration, calls per iteration):');
for (const [k, v] of [...sqlTime].sort((a, b) => b[1].ms - a[1].ms).slice(0, 10))
  out(
    `  ${(v.ms / Number(args.iters)).toFixed(1).padStart(8)} ms  x${(v.n / Number(args.iters)).toFixed(0).padStart(3)}  ${k}`
  );
