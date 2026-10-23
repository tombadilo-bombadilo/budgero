/* global process, performance, console */
/* eslint-disable import-x/no-dynamic-require -- loads bundles/tools by computed path */
// Shared helpers for the perf bench and the parity suite.
// Plain Node ESM, no dependencies beyond what the monorepo already installs
// (esbuild via vite, sql.js, lz4js). Nothing here is imported by src/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export function parseArgs(argv, defaults = {}) {
  const out = { ...defaults, _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) out[k] = v;
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
    else out[k] = 'true';
  }
  return out;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Freeze "now" (local noon of `day`) so RTA / future-row logic is reproducible. */
export function fixClock(day) {
  const RealDate = Date;
  const [y, m, d] = day.split('-').map(Number);
  const fixed = new RealDate(y, m - 1, d, 12, 0, 0).getTime();
  class FixedDate extends RealDate {
    constructor(...a) {
      if (a.length === 0) super(fixed);
      else super(...a);
    }

    static now() {
      return fixed;
    }
  }
  globalThis.Date = FixedDate;
}

/** Core logs through `debug` and console; silence everything except our own output. */
export function quiet() {
  // eslint-disable-next-line no-console
  for (const k of ['log', 'info', 'debug', 'warn']) console[k] = () => {};
  globalThis.fetch = async () => {
    throw new Error('offline (bench)');
  };
}

export const out = (s) => process.stdout.write(`${s}\n`);

// ---------- locating dependencies ----------
function findUp(start, rel) {
  let dir = path.resolve(start);
  for (;;) {
    const p = path.join(dir, rel);
    if (fs.existsSync(p)) return p;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** node_modules dirs that can satisfy the core's imports (sql.js, debug, jszip). */
export function nodeModuleDirs(corePath) {
  const dirs = [];
  const add = (d) => {
    if (d && fs.existsSync(path.join(d, 'sql.js')) && !dirs.includes(d)) dirs.push(d);
  };
  if (process.env.BUDGERO_NODE_MODULES) add(process.env.BUDGERO_NODE_MODULES);
  add(path.join(corePath, 'node_modules'));
  add(path.join(BENCH_DIR, '..', 'node_modules'));
  // A worktree without its own install: borrow the main checkout's.
  const gitFile = findUp(corePath, '.git');
  if (gitFile && fs.statSync(gitFile).isFile()) {
    const m = /gitdir: (.*)/.exec(fs.readFileSync(gitFile, 'utf8'));
    if (m)
      add(
        path.join(m[1].split(`${path.sep}.git${path.sep}`)[0], 'packages', 'core', 'node_modules')
      );
  }
  if (!dirs.length)
    throw new Error(
      `No node_modules with sql.js found for ${corePath}. Run pnpm install or set BUDGERO_NODE_MODULES.`
    );
  return dirs;
}

export function loadEsbuild(corePath) {
  try {
    return require('esbuild');
  } catch {
    /* fall through */
  }
  for (const start of [corePath, BENCH_DIR]) {
    const pnpm = findUp(start, path.join('node_modules', '.pnpm'));
    if (!pnpm) continue;
    const hit = fs
      .readdirSync(pnpm)
      .filter((d) => d.startsWith('esbuild@'))
      .sort()
      .pop();
    if (hit) return require(path.join(pnpm, hit, 'node_modules', 'esbuild'));
  }
  throw new Error('esbuild not found (it ships with vite in this monorepo; run pnpm install).');
}

/** Hash of every source file of a core checkout; keys the bundle cache. */
function sourceHash(corePath) {
  const h = crypto.createHash('sha1');
  const walk = (d) => {
    for (const e of fs
      .readdirSync(d, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ts$/.test(e.name)) {
        h.update(p.slice(corePath.length));
        h.update(fs.readFileSync(p));
      }
    }
  };
  walk(path.join(corePath, 'src'));
  return h.digest('hex').slice(0, 12);
}

/**
 * Bundle `<corePath>/src` (any checkout of packages/core) into one CJS file and
 * load it. Extra internal classes are re-exported for the generator.
 */
export async function loadCore(
  corePath,
  { cacheDir = path.join(os.tmpdir(), 'budgero-bench') } = {}
) {
  corePath = path.resolve(corePath);
  if (corePath.endsWith('.cjs'))
    return { core: require(corePath), bundle: corePath, label: path.basename(corePath) };
  if (!fs.existsSync(path.join(corePath, 'src', 'index.ts')))
    throw new Error(`${corePath} is not packages/core`);
  fs.mkdirSync(cacheDir, { recursive: true });
  const hash = sourceHash(corePath);
  const bundle = path.join(cacheDir, `core-${hash}.cjs`);
  if (!fs.existsSync(bundle)) {
    const entry = path.join(cacheDir, `entry-${hash}.ts`);
    const src = (p) => JSON.stringify(path.join(corePath, 'src', p));
    fs.writeFileSync(
      entry,
      [
        `export * from ${src('index.ts')};`,
        `export { TransactionQueries } from ${src('services/transactions/queries.ts')};`,
        `export { MonthlyBudgetQueries } from ${src('services/monthly-budgets/queries.ts')};`,
      ].join('\n')
    );
    await loadEsbuild(corePath).build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: bundle,
      nodePaths: nodeModuleDirs(corePath),
      logLevel: 'error',
      sourcemap: 'inline',
    });
  }
  ensureSqlJsCwd(corePath);
  return { core: require(bundle), bundle, hash };
}

/** NodeSqlJsAdapter locates the wasm via process.cwd()/node_modules/sql.js. */
export function ensureSqlJsCwd(corePath) {
  if (fs.existsSync(path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')))
    return;
  const nm = nodeModuleDirs(corePath)[0];
  const dir = path.join(os.tmpdir(), 'budgero-bench', 'cwd');
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  const link = path.join(dir, 'node_modules', 'sql.js');
  if (!fs.existsSync(link)) fs.symlinkSync(fs.realpathSync(path.join(nm, 'sql.js')), link);
  process.chdir(dir);
}

export async function openDb(core, bytes) {
  const adapter = await core.NodeSqlJsAdapter.create(bytes ? new Uint8Array(bytes) : undefined);
  const sm = new core.ServiceManager();
  await sm.initialize(adapter);
  return { adapter, services: sm.getServices(), sm };
}

// ---------- stats ----------
export function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  return { n: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), min: s[0], max: s[s.length - 1] };
}

/**
 * Time `fn` with warm-up. Runs up to `iters` measured iterations but stops early
 * once `budgetMs` of measured time is spent (slow cases report n < iters).
 */
export async function measure(
  fn,
  { iters = 200, warmup = 5, budgetMs = 20000, minIters = 3, setup } = {}
) {
  const t0 = performance.now();
  for (let i = 0; i < warmup; i++) {
    if (setup) await setup(i);
    await fn(i);
    if (performance.now() - t0 > budgetMs / 4) break;
  }
  const samples = [];
  let spent = 0;
  for (let i = 0; i < iters; i++) {
    if (setup) await setup(i);
    const a = performance.now();
    await fn(i);
    const d = performance.now() - a;
    samples.push(d);
    spent += d;
    if (spent > budgetMs && samples.length >= minIters) break;
  }
  return stats(samples);
}

export const fmt = (ms) => (ms >= 100 ? ms.toFixed(0) : ms >= 10 ? ms.toFixed(1) : ms.toFixed(2));
