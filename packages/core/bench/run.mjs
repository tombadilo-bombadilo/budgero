/* global process, performance */
// Perf bench runner. Works against any checkout of packages/core.
//
//   node bench/run.mjs --core ../path/to/packages/core --label new --tx 50000 \
//        [--years 10 --seed 42 --end 2026-10-15] [--suite queries,p19,interactions,persist]
//        [--modes cumulative,monthly] [--iters 200] [--budget-ms 20000] [--case <regex>]
//        [--app auto|old|new] [--json results.json] [--db file.sqlite] [--min-iters 3] [--p19-budget-ms N]
//
// The dataset is generated once per (size, years, seed, end) with --gen-core
// (default: the core this bench lives in), cached in $TMPDIR/budgero-bench/data,
// and loaded into the core under test (its migrations run on open). Use the same
// --gen-core for OLD and NEW so both read identical bytes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  parseArgs,
  fixClock,
  quiet,
  loadCore,
  loadEsbuild,
  openDb,
  measure,
  fmt,
  out,
  BENCH_DIR,
  nodeModuleDirs,
} from './lib.mjs';
import { generate } from './gen.mjs';
import { makeContext, queryCases, p19Cases, p19Mutations, interactions } from './cases.mjs';

const args = parseArgs(process.argv.slice(2), {
  tx: '50000',
  years: '10',
  seed: '42',
  end: '2026-10-15',
  suite: 'queries,p19,interactions,persist',
  modes: 'cumulative,monthly',
  iters: '200',
  'budget-ms': '20000',
  app: 'auto',
  label: '',
  'gen-core': path.join(BENCH_DIR, '..'),
  warmup: '5',
  'min-iters': '3',
});
if (!args.core)
  throw new Error(
    'usage: run.mjs --core <packages/core of the checkout to measure> [options]; see bench/README.md'
  );
// loadCore may chdir (sql.js wasm lookup), so pin every path first
for (const k of ['core', 'gen-core', 'db', 'json', 'data-dir'])
  if (args[k]) args[k] = path.resolve(args[k]);
fixClock(args.end);
quiet();
const iters = Number(args.iters),
  budgetMs = Number(args['budget-ms']),
  warmup = Number(args.warmup),
  minIters = Number(args['min-iters']);
const p19Budget = Number(args['p19-budget-ms'] || args['budget-ms']);
const caseFilter = args.case ? new RegExp(args.case, 'i') : null;
const suites = new Set(args.suite.split(','));
const label = args.label || path.basename(path.resolve(args.core, '..', '..'));

// ---- dataset ----
async function dataset() {
  if (args.db)
    return {
      bytes: fs.readFileSync(args.db),
      info: JSON.parse(fs.readFileSync(`${args.db}.json`, 'utf8')),
    };
  const dir = args['data-dir'] || path.join(os.tmpdir(), 'budgero-bench', 'data');
  fs.mkdirSync(dir, { recursive: true });
  const { hash } = await loadCore(args['gen-core']);
  const file = path.join(
    dir,
    `budget-${args.tx}tx-${args.years}y-s${args.seed}-${args.end}-${hash}.sqlite`
  );
  if (!fs.existsSync(file)) {
    const { bytes, info } = await generate({
      core: args['gen-core'],
      tx: args.tx,
      years: args.years,
      seed: args.seed,
      end: args.end,
      mode: 'cumulative',
    });
    fs.writeFileSync(file, bytes);
    fs.writeFileSync(`${file}.json`, JSON.stringify(info));
  }
  return {
    bytes: fs.readFileSync(file),
    info: JSON.parse(fs.readFileSync(`${file}.json`, 'utf8')),
  };
}

const { core, hash: coreHash } = await loadCore(args.core);
const data = await dataset();
const results = [];
const record = (suite, mode, name, st, extra = {}) => {
  const r = {
    label,
    core: coreHash,
    tx: data.info.transactions,
    years: Number(args.years),
    suite,
    mode,
    name,
    ...st,
    ...extra,
  };
  results.push(r);
  out(
    `${label}\t${data.info.transactions}\t${suite}\t${mode}\t${name}\tp50 ${fmt(st.p50)}\tp95 ${fmt(st.p95)}\tp99 ${fmt(st.p99)}\tn ${st.n}${extra.note ? `\t${extra.note}` : ''}`
  );
};
const want = (name) => !caseFilter || caseFilter.test(name);
const fresh = async (mode) => {
  const db = await openDb(core, data.bytes);
  db.adapter.exec(`UPDATE budgets SET RtaMode='${mode}' WHERE ID=${data.info.budgetId}`);
  return { ...db, ctx: makeContext({ ...db, info: data.info, today: args.end, app: args.app }) };
};
const modes = args.modes.split(',');
const opts = { iters, warmup, budgetMs, minIters };

// ---- persist path (runtime: export -> LZ4 -> AES-GCM envelope -> OPFS) ----
// Bundles <checkout>/packages/runtime/src/crypto (compression + envelope) next to the core.
async function loadPersist() {
  const cryptoDir = path.resolve(args.core, '..', 'runtime', 'src', 'crypto');
  if (!fs.existsSync(path.join(cryptoDir, 'database-crypto.ts'))) return null;
  const outFile = path.join(os.tmpdir(), 'budgero-bench', `runtime-crypto-${coreHash}.cjs`);
  if (!fs.existsSync(outFile)) {
    const entry = `${outFile}.entry.ts`;
    fs.writeFileSync(
      entry,
      `export * from ${JSON.stringify(path.join(cryptoDir, 'database-crypto.ts'))};\nexport { compress } from ${JSON.stringify(path.join(cryptoDir, 'compression.ts'))};\n`
    );
    const nm = [
      path.resolve(args.core, '..', 'runtime', 'node_modules'),
      ...nodeModuleDirs(args.core).map((d) =>
        path.resolve(d, '..', '..', 'runtime', 'node_modules')
      ),
    ].filter((d) => fs.existsSync(path.join(d, 'lz4js')));
    await loadEsbuild(args.core).build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: outFile,
      nodePaths: nm,
      logLevel: 'error',
    });
  }
  return createRequire(import.meta.url)(outFile);
}
const persistOps = await loadPersist();
const persistOnce = async (adapter) => {
  const b = adapter.backup();
  const c = persistOps ? persistOps.compress(b) : b;
  return c.slice();
};

if (suites.has('persist')) {
  const { adapter } = await openDb(core, data.bytes);
  const size = adapter.backup().length;
  const pOpts = { ...opts, iters: Math.min(iters, 100) };
  record(
    'persist',
    '-',
    'db.export() [main thread]',
    await measure(() => adapter.backup(), pOpts),
    { bytes: size, note: `${(size / 1048576).toFixed(1)} MB` }
  );
  if (persistOps) {
    const bytes = adapter.backup();
    await persistOps.compressAndEncryptDatabase(bytes, 'bench-password'); // PBKDF2 once; DEK is cached afterwards
    record(
      'persist',
      '-',
      'LZ4 compress [main thread, JS]',
      await measure(() => persistOps.compress(bytes), pOpts)
    );
    record(
      'persist',
      '-',
      'compressAndEncryptDatabase (LZ4 + AES-GCM, AES off-thread in browsers)',
      await measure(() => persistOps.compressAndEncryptDatabase(bytes, 'bench-password'), pOpts)
    );
  }
  record(
    'persist',
    '-',
    'persist main-thread total (export + LZ4 + Blob copy)',
    await measure(() => persistOnce(adapter), pOpts)
  );
  adapter.close();
}

if (suites.has('queries')) {
  for (const mode of modes) {
    const { ctx, adapter } = await fresh(mode);
    const { budget, other } = queryCases(ctx);
    for (const [name, fn] of budget)
      if (want(name)) record('queries', mode, name, await measure(fn, opts));
    if (mode === modes[0])
      for (const [name, fn] of other)
        if (want(name)) record('queries', '-', name, await measure(fn, opts));
    adapter.close();
  }
}

if (suites.has('p19')) {
  for (const mode of modes) {
    const { ctx, adapter } = await fresh(mode);
    const Q = core.MonthlyBudgetQueries ? new core.MonthlyBudgetQueries(adapter) : null;
    for (const [name, fn] of p19Cases(ctx, Q)) {
      if (!want(name)) continue;
      if (mode !== modes[0] && !/rollforward|monthly|getActivityByAccountKind \(monthly/.test(name))
        continue;
      record('p19', mode, name, await measure(fn, { ...opts, budgetMs: p19Budget }));
    }
    const muts = p19Mutations(ctx);
    for (const [mname, mut] of Object.entries(muts)) {
      for (const [qname, qfn] of [
        [
          'getMonthlyBudget current',
          () => ctx.s.monthlyBudgets.getMonthlyBudget(ctx.month, ctx.budgetId),
        ],
        ['getReadyToAssign', () => ctx.s.monthlyBudgets.getReadyToAssign(ctx.budgetId, ctx.month)],
        [
          'getReadyToAssignBreakdown',
          () => ctx.s.monthlyBudgets.getReadyToAssignBreakdown(ctx.budgetId, ctx.month),
        ],
      ]) {
        const name = `${qname} ${mname}`;
        if (want(name))
          record(
            'p19',
            mode,
            name,
            await measure(qfn, { ...opts, budgetMs: p19Budget, setup: mut })
          );
      }
    }
    adapter.close();
  }
}

if (suites.has('interactions')) {
  // per-persist main-thread cost on this DB size (export + LZ4 + copy); AES runs off-thread
  const { adapter: padapter } = await openDb(core, data.bytes);
  const pst = await measure(() => persistOnce(padapter), { iters: 20, warmup: 2, budgetMs: 10000 });
  padapter.close();
  for (const mode of modes) {
    const { ctx, adapter } = await fresh(mode);
    const list = interactions(ctx);
    for (const [name, it] of Object.entries(list)) {
      if (!want(name)) continue;
      const budgetModeOnly = /budget page|switch month|assign/.test(name);
      if (mode !== modes[0] && !budgetModeOnly) continue;
      const heavy = /bank-sync|bulk/.test(name);
      const parts = {};
      const st = await measure(
        async () => {
          let t = performance.now();
          if (it.mutation) await it.mutation();
          parts.mutation = (parts.mutation || 0) + (performance.now() - t);
          for (const r of it.refetch()) {
            t = performance.now();
            r.fn();
            parts[r.name] = (parts[r.name] || 0) + (performance.now() - t);
          }
        },
        {
          iters: heavy ? 3 : iters,
          warmup: heavy ? 0 : Math.min(warmup, 2),
          budgetMs: heavy ? budgetMs * 3 : budgetMs,
          minIters: heavy ? 1 : minIters,
        }
      );
      const persistMs = it.persists * pst.p50;
      const breakdown = Object.fromEntries(
        Object.entries(parts)
          .map(([k, v]) => [k, v / (st.n + (heavy ? 0 : Math.min(warmup, 2)))])
          .sort((a, b) => b[1] - a[1])
      );
      record('interactions', it.mutation || budgetModeOnly ? mode : '-', name, st, {
        persists: it.persists,
        persistMs,
        totalP50: st.p50 + persistMs,
        breakdown,
        note: `+ persist ${it.persists}x${fmt(pst.p50)} = ${fmt(persistMs)} ms => total p50 ${fmt(st.p50 + persistMs)} | top: ${Object.entries(
          breakdown
        )
          .slice(0, 3)
          .map(([k, v]) => `${k} ${fmt(v)}`)
          .join(', ')}`,
      });
    }
    adapter.close();
  }
}

if (args.json) {
  const prev = fs.existsSync(args.json) ? JSON.parse(fs.readFileSync(args.json, 'utf8')) : [];
  fs.writeFileSync(args.json, JSON.stringify([...prev, ...results], null, 1));
}
