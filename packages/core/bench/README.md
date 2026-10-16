# Core perf bench

Measures the queries and UI interactions that block the main thread on large
budgets (the web app runs core + sql.js on the main thread, so query time is UI
freeze time). Plain Node scripts, outside `src/` and `node-tests/`, so `tsc`,
`vitest` and CI never pick them up.

Requirements: `pnpm install` at the repo root (uses the installed `sql.js`,
`lz4js` and the `esbuild` that ships with vite). A worktree without its own
`node_modules` borrows the main checkout's; `BUDGERO_NODE_MODULES=/path/to/node_modules`
overrides.

## Run

From `packages/core`:

```sh
# OLD vs NEW on the same dataset (the dataset is generated with --gen-core, which
# defaults to this checkout, so both runs read identical rows)
pnpm bench --core . --label old --tx 50000 --json /tmp/bench.json
pnpm bench --core /path/to/other/checkout/packages/core --label new --tx 50000 --json /tmp/bench.json

# one suite / one case, fewer iterations
pnpm bench --core . --tx 25000 --suite queries --case "getMonthlyBudget" --iters 50
```

`--core` is any checkout's `packages/core` (or a prebuilt `.cjs` bundle). The runner
bundles `<core>/src` with esbuild (cached by source hash in `$TMPDIR/budgero-bench`)
and, for the persist cost, `<core>/../runtime/src/crypto`.

Options: `--tx` (5000, 10000, 25000, 50000, 100000 were used for the audit),
`--years 10`, `--seed 42`, `--end 2026-10-15` (frozen "today"), `--suite
queries,p19,interactions,persist`, `--modes cumulative,monthly`, `--iters 200`,
`--warmup 5`, `--budget-ms 20000` (a case stops early once it has spent this much
measured time, so very slow cases report `n < 200`), `--min-iters 3`,
`--p19-budget-ms`, `--case <regex>`, `--app auto|old|new`, `--json <file>` (appends),
`--db <file>` (use a given dataset + its `.json` sidecar).

Output: one TSV line per case (`label, tx, suite, mode, case, p50, p95, p99, n`), and
with `--json` the same plus per-interaction breakdowns.

## Suites

- `queries`: single service calls. getMonthlyBudget (current, 60 months back,
  alternating month switch) and Ready to Assign (+ breakdown) in both RTA modes;
  register first page / 10 pages deep / full register; listAccounts;
  getAllTransactionsDetailed / Analytics / getAllTransactions; payee and label
  usage lists; the dashboard queries.
- `p19`: anatomy of getMonthlyBudget / RTA: each CTE of the main SQL timed alone
  (fragments copied from 4dc2161), the CC block queries, the monthly rollforward,
  the RTA batch, and each budget read right after a current-month edit, an
  assignment and a 5-years-back edit.
- `interactions`: a mutation (if any) + every query TanStack Query refetches on the
  mounted page (from the op registry `invalidates` lists and the hooks mounted on
  that page) + the local persist count x the measured per-persist main-thread cost.
  The app model is in `cases.mjs`; `--app new` models the audit/queries app fixes
  (aggregate future-balance / uncategorized queries, date-bounded Upcoming card,
  batch toolbar without a register refetch); `auto` picks it when the core has
  `getUncategorizedCountsByAccount`.
- `persist`: `db.export()`, LZ4, LZ4 + AES-GCM envelope, and the main-thread total
  (export + LZ4 + Blob copy). AES runs off the main thread in browsers.

The runner reads the checkout's runtime/app sources next to `--core` to model
what it does around core (printed as `runtime model` on stderr):

- `localLz4`: the local OPFS copy is LZ4-compressed (before P22a). Without it the
  persist total is export + two copies (WebCrypto input, Blob).
- `coalesced`: `LocalPersistScheduler` exists (P22b). An interaction then costs
  `1 + floor(mutation ms / 1000)` persists (250 ms debounce, 1 s max wait)
  instead of one per op.
- `batchedRules`: bank sync runs each continuous rule once over the batch (P10),
  so the bank-sync case does 3 `executeRule` calls over 200 ids, not 600.

## Dataset (`gen.mjs`)

Seeded and deterministic: same seed, `--end` and generator core give the same rows
(only wall-clock `CreatedAt`-style columns differ). ~10 years, 30 accounts (9
checking incl. EUR/GBP, 5 savings of which 2 off-budget, 2 cash, 7 cards incl. one
EUR, car/student loan + mortgage with payments on the linked categories, 4
off-budget brokerages), 150 spending categories in 15 groups, ~15% transfer legs,
~3% split parents (2-4 lines), refunds, labels, a few uncategorized and
future-dated rows, monthly assignments, FX rates and revaluations, 20 recurring
templates, 10 rules (3 continuous), 15 goals, 5000 audit-log rows.

```sh
pnpm bench:gen --core . --tx 50000 --years 10 --seed 42 --out /tmp/b50k.sqlite
```

## Profiling (`profile.mjs`)

```sh
pnpm bench:profile --core . --tx 50000 --case "^getReadyToAssign$" --iters 20 [--mode monthly]
```

Prints self-time buckets (SQLite wasm / sql.js glue / core JS / GC), the top
functions, and per-SQL-statement wall time; writes a `.cpuprofile` for DevTools.

## Parity (`../parity/run.mjs`)

```sh
pnpm parity --a . --b /path/to/new/packages/core --steps 200 --seed 1
pnpm parity --a . --b . --b-init ./my-snapshot-on.mjs   # same build, implementation toggled on B
```

Applies one seeded random mutation sequence (adds, amount/date/category edits incl.
moves across months, account moves, deletes, assignments, transfers incl. to
off-budget and debt accounts, CC payments, splits incl. transfer lines, split
clears, FX rate edits, category deletes and merges) to both sides. After every
step it compares, in both RTA modes, getMonthlyBudget for every category x every
month (first ledger month to 2 months past the last), the RTA breakdown for every
month, listAccounts, every running balance, and every 10 steps every register.
Any difference (or an op that fails on one side only) fails the run; zero diffs is
the bar. `--keep-going` lists every diverging step.
