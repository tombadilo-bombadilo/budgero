# Budgero performance audit: big budgets (2026-10-16)

Every number here was measured, none estimated, unless it says "estimate". OLD = master 4dc2161 (v1.18.0). NEW comes
in three cores:
- `main`: the main checkout `fix/quarterly-code-quality-audit` @ 45a0c3b (recurring, balance and server fixes, no
  query fixes yet);
- `queries`: `audit/queries` @ d77b957 (P1-P7: transfer index guard and one partner join, aggregate future-balance
  and uncategorized queries, EXISTS on delete, date-bounded Upcoming card, batch toolbar without a refetch). Not
  merged into main yet;
- `combined`: main plus the audit/queries core diff applied on top. This is the post-P1-P7 state, and the "after"
  columns below use it.

The `queries` and `combined` interactions also model the audit/queries app changes.

## Answer: after P1-P7, will the app be snappy on big budgets?

**No.** P1-P7 remove the worst freezes. At 50k transactions: Ready to Assign 9.3 s -> 0.1 s, the full register
8.7 s -> 0.8 s, the register page 115 -> 8 ms, getAllTransactionsDetailed 39 s -> 2.0 s, opening the register
6.7 s -> 0.8 s, opening the budget page 13 s -> 2.0 s.

The main thread still blocks on almost every action at 50k (10 years, cumulative RTA mode):
- 2.0 s to open the budget page and 2.9 s per assignment;
- 0.8-1.3 s to open the register or edit a cell;
- 1.6 s for the dashboard;
- 10 s to recategorize 50 rows;
- ~2.5 minutes for a 200-row bank sync with 3 continuous rules.

At 100k it is 6.9 s per assignment and 2 s per edit. In monthly RTA mode the budget page takes 11 s at 50k and
23-32 s at 100k. One local persist costs 16.1 ms at 5k, 63.8 ms at 10k, 86.8 ms at 25k, 188 ms at 50k, 261 ms at 100k of main-thread time.

What remains:
1. The budget engine re-sums all history on every read (P19). The desktop budget page multiplies that by mounting
   six months at once (P20), and RTA runs twice (P8).
2. After every mutation, the whole database is LZ4-compressed on the main thread (P22). Ops that persist per row
   multiply it: bulk edit, bank sync, continuous rules (P10).
3. Some whole-ledger reads are still mounted after P6 (P25). After P1, their cost is mostly JS row
   materialisation in sql.js, not SQL (P27).

### (a) Interactions: total main-thread ms (p50), before vs after P1-P7, cumulative RTA mode unless noted

The total is mutation + every refetch the page triggers + persists x the per-size persist cost. The full
p50/p95/p99 for every size and core is in Appendix A.

| interaction | RTA mode | 50k old | 50k after P1-P7 | 100k old | 100k after P1-P7 | what dominates after P1-P7 (50k, ms) |
|---|---|---|---|---|---|---|
| open budget page | cumulative | 13.2 s | 2.0 s | 52.2 s | 6.9 s | getMonthlyBudget(+5) 299; getMonthlyBudget(+1) 292; getMonthlyBudget(+4) 292 |
| open budget page | monthly | 20.0 s | 11.3 s | 50.2 s | 22.6 s | getMonthlyBudget(+4) 1.3 s; getMonthlyBudget(+1) 1.2 s; getMonthlyBudget(+3) 1.2 s |
| switch month (uncached month) | cumulative | 11.3 s | 591 | 39.9 s | 1.4 s | getMonthlyBudget(new month) 379; getReadyToAssign(new month) 94.4; getReadyToAssignBreakdown(new month) 93.6 |
| switch month (uncached month) | monthly | 13.1 s | 3.4 s | 37.6 s | 7.9 s | getReadyToAssign(new month) 1.2 s; getMonthlyBudget(new month) 1.2 s; getReadyToAssignBreakdown(new month) 1.1 s |
| assign money in a category | cumulative | 12.8 s | 2.9 s | 43.2 s | 6.9 s | persist 1x188 = 188; getMonthlyBudget(+1) 418; getMonthlyBudget(+0) 414 |
| assign money in a category | monthly | 21.4 s | 9.8 s | 44.0 s | 31.7 s | persist 1x188 = 188; getMonthlyBudget(+4) 1.1 s; getMonthlyBudget(+2) 1.1 s |
| open account register | any | 6.7 s | 834 | 22.1 s | 2.2 s | getMonthlyBudget(picker) 348; listAccounts 101; getReadyToAssign(picker) 82.4 |
| scroll register (next page) | any | 116 | 7.57 | 132 | 6.24 | next page 7.57 |
| edit amount cell | cumulative | 7.0 s | 1.3 s | 22.8 s | 2.0 s | persist 1x188 = 188; getMonthlyBudget(picker) 431; mutation 235 |
| edit category cell | cumulative | 7.1 s | 1.1 s | 22.6 s | 2.2 s | persist 1x188 = 188; getMonthlyBudget(picker) 386; listAccounts 114 |
| add transaction (+3 continuous rules) | cumulative | 7.2 s | 1.4 s | 26.6 s | 2.0 s | persist 4x188 = 751; getMonthlyBudget(picker) 416; getReadyToAssign(picker) 96.7 |
| delete transaction | cumulative | 13.8 s | 1.1 s | 57.2 s | 1.6 s | persist 1x188 = 188; getMonthlyBudget(picker) 411; listAccounts 118 |
| bulk-categorize 50 rows | cumulative | 17.2 s | 10.0 s | 32.9 s | 14.3 s | persist 50x188 = 9.4 s; getMonthlyBudget(picker) 436; uncategorizedCounts 90.3 |
| bank-sync import 200 rows + 3 continuous rules | cumulative | 157.5 s | 152.6 s | 231.0 s | 212.1 s | persist 800x188 = 150.2 s; mutation 1.6 s; getMonthlyBudget(picker) 412 |
| open dashboard | any | 55.3 s | 1.6 s | 128.5 s | 3.4 s | uncategorized card: getAllTransactions 821; getMonthlyBudget(current) 300; onBudgetBalanceByDates x2 112 |
| open accounts page (net worth) | any | 29.3 s | 934 | 102.4 s | 1.9 s | netWorth+assetHistory: getAllTransactions 910; listAccounts 96.5; uncategorizedCounts 70.4 |
| open reports (analytics) | any | 1.8 s | 1.3 s | 3.1 s | 3.1 s | getAllTransactionsAnalytics 1.3 s; listAccounts 88.3; uncategorizedCounts 66.7 |

## How it was measured (rerunnable)

- **Suites.** In the new worktree `.worktrees/audit-perf` (branch
  `audit/perf-suite`, commits 605207c and 1369e66, not pushed):
  - `packages/core/bench/`: gen.mjs, run.mjs, cases.mjs, profile.mjs, README;
  - `packages/core/parity/run.mjs`.

  `pnpm bench --core <checkout>/packages/core` bundles that core with esbuild and runs it on sql.js 1.14.2 in Node.
  That is the same engine as the browser (V8 and the same wasm). The suites sit outside src/ and node-tests/ and
  pass `eslint --max-warnings 0`.
- **Dataset** (seed 42, "today" frozen at 2026-10-15):
  - 10 years and 30 accounts: 9 checking incl. EUR/GBP, 5 savings (2 off-budget), 2 cash, 7 cards incl. one EUR,
    2 loans and a mortgage paid through their linked categories, 4 off-budget brokerages;
  - 150 spending categories in 15 groups;
  - ~15% transfer legs, ~3% split parents (2-4 lines), refunds, labels, future-dated rows;
  - monthly assignments, monthly FX rates and revaluations;
  - 20 recurring templates, 10 rules (3 continuous), 15 goals, 5000 audit-log rows.

  It is built through the real migrations and services. Sizes are 5k, 10k, 25k, 50k and 100k transactions
  (4, 6, 11, 19 and 35 MB). For P19 there are also 50k over 2 years and 150k over 10 years. Same seed gives the
  same rows; only wall-clock CreatedAt-style columns differ.
- **Per case.** Warm-up, then up to 200 measured iterations. A case stops early once it has spent 20 s of measured
  time (60 s for the P19 suite at 50k), so slow cases show `n=`. The P19 baseline below was rerun with exactly
  200 iterations.
- **Interactions** are the mutation, plus every query TanStack Query refetches on that page, plus the persists:
  - the refetch set is the op registry's `invalidates` crossed with the hooks mounted on that page, read from the
    app code (cases.mjs);
  - a persist is db.export + LZ4 + Blob copy. AES-GCM runs in WebCrypto off the main thread and is left out.
- **Not included**, so real numbers are higher:
  - React render;
  - TanStack structural sharing (`replaceEqualDeep`), measured separately on getAllTransactions: 23 ms at 10k
    rows, 102 ms at 50k, 217 ms at 100k;
  - the blob upload every 20 mutations (one more export + LZ4 + AES);
  - IndexedDB queue writes.
- **Caveat.** the benchmark machine was shared: load 6-18 on 20 cores, with other agents building. OLD and NEW ran at the same
  time, so ratios are fair, but absolute numbers run roughly 10-40% above an idle machine, and p95/p99 carry that
  noise. An idle 5k run gave getMonthlyBudget 10 ms and LZ4 13 ms, against 10 and 15 ms under load.
## (b) Remaining offenders after P1-P7, ranked by user-visible impact

Numbers: 50k / 10 years, `combined` core (= post P1-P7), per-statement timings from `bench/profile.mjs`, machine under load.

### P19 [HIGH] Budget engine re-sums all history on every read (getMonthlyBudget and RTA)
See the P19 section below (measurements, snapshot design, parity plan). Cumulative getMonthlyBudget ~230-300 ms at 50k and
~600-850 ms at 100k; monthly 1.1-1.6 s at 50k and ~3 s at 100k
(the low-load 200-iteration baseline in the P19 section: 224 ms cumulative, 0.8-1.1 s monthly; RTA 53 ms / 0.65-0.74 s). It grows with the number of rows on file, not with
what changed, and costs the same whether 50k rows span 2 or 10 years.

### P20 [HIGH, new] Desktop budget page computes six months on every load and every write
- `app/src/pages/budgeting/BudgetingPage.desktop.tsx:73-78`: `useMonthlyBudget(month1..month6)` are always enabled. With the
  multi-month view closed `multiMonthAnchor` is the current month, so months current..current+5 are all fetched (month1 is
  deduped with the main query, the other five are extra). Every `['monthlyBudget','*']` invalidation (any assignment, any
  transaction write while the page is open) refetches all six.
- Measured: budget page 6x getMonthlyBudget = ~80% of "open budget page" and "assign money" (cumulative: 6 x ~230 ms; monthly:
  6 x ~1.1 s plus 24 ledger-window passes, profile: 9.4 s of 12.1 s).
- Fix: `enabled: multiMonthOpen && index < monthCount` for months 2-6 (keep month 1). Gain: 5/6 of the budget-month cost on
  the default view (~1.2 s per assignment at 50k cumulative, ~5.5 s monthly). Independent of P19 and trivial.

### P22 [HIGH, new] Every mutation LZ4-compresses the whole database on the main thread
- `core/src/database/web-adapter.ts:479-516` (saveToOPFSPublic -> backup -> persist -> cipher.encrypt) ->
  `runtime/src/crypto/persistence-cipher.ts:41-44` -> `database-crypto.ts:21-25` `compress(data)` (lz4js, pure JS). Called by
  `MutationDispatchService.persistLocalMutation` after every op (`runtime/src/coordinator/mutation-dispatch-service.ts:91-99`).
- Measured main-thread cost per persist (export + LZ4 + copy): ~16 ms at 5k, ~150-190 ms at 50k, see persist table. The
  export itself is cheap (2-10 ms); LZ4 is ~90% of it. A 3-op interaction (add + 3 continuous rules = 4 persists) pays
  ~0.6-0.75 s at 50k just for this; bulk-categorize 50 rows = 50 persists; a 200-row bank sync with 3 continuous rules
  = 800 persists (P10).
- Fix (cheap): do not compress the local OPFS copy (keep LZ4 for the server upload). The decrypt path already accepts
  uncompressed payloads (`tryDecompress` falls back, verified: raw SQLite bytes -> `wasCompressed: false`). AES-GCM stays and
  runs in WebCrypto. Better: coalesce persists (one per batch/user action, or a 250 ms trailing debounce with a flush on
  `pagehide`), and move compress+encrypt into a Worker for the upload path. Gain: ~140-180 ms per mutation at 50k; seconds
  on bulk actions; minutes on a big bank sync.

### P8 [HIGH, reuse] RTA computed twice per read, on every write and register mount
Still present after P1-P7. Post-fix cumulative RTA ~100 ms at 50k (was 9.3 s), monthly 0.7 s (low-load baseline) to 1.9 s (under load), was 10 s; 150-210 ms and ~2.7 s at 100k. Budget page pays it twice
(number + breakdown), register pays it once more under the `'current'` key (P9). Fix as before: derive the number from the
breakdown query (`select:`), skip the cumulative CC block in monthly mode. With P26 cumulative RTA drops to ~35 ms.

### P26 [HIGH, new, quick] Cumulative RTA income sum scans every on-budget row
- `core/src/services/monthly-budgets/queries.ts:349-366`: the planner drives from accounts and reads every row of every
  on-budget account (`DATE(t.Date) <= DATE(?)` is not sargable, `cg.Name = 'Income'` is applied after the join). 71 ms of the
  ~100 ms post-fix RTA at 50k.
- Fix: drive from the Income categories on `idx_transactions_category_date` (`FROM transactions t INDEXED BY
  idx_transactions_category_date ... WHERE t.CategoryID IN (SELECT c.ID ... cg.Name = 'Income') AND t.Date <= ?`).
  Measured 69.6 ms -> 1.0 ms, identical value. Same trick for the two transfer sums (category = Transfers): ~17 ms each.

### P21 [HIGH, new] getCCSpendingByCategoryAndAccount scans every transaction and split of every budget, twice
- `core/src/services/monthly-budgets/queries.ts:1590-1622`: the UNION ALL subquery `x` has no WHERE in its branches (the
  BudgetID / Month / AccountID / OutflowConverted filters are outside), with a per-row NOT EXISTS; it runs once for `= M`
  and once for `< M`. Measured alone: 130-200 ms at 50k, 255-390 ms at 100k (~45% of a cumulative getMonthlyBudget), x6 on the budget page.
- Fix: push the filters into each branch (`t.AccountID IN (...) AND t.BudgetID = ? AND t.Month <= ?` hits
  idx_transactions_budget_account_month) and do one query with `SUM(CASE WHEN Month = ? ...)` for current/prior. Expected
  ~2-5 ms. Folded into P19 later, but worth doing now.

### P25 [MED-HIGH, new] Whole-ledger getAllTransactions still mounted on Dashboard, Accounts page and reports
- P6 fixed the sidebar badge only. `widgets/dashboard/UncategorizedTransactionsCard.tsx:48` (filters the whole ledger in JS
  for a few uncategorized rows), `entities/account/api/useNetWorthHistory.ts:26` and `useMonthlyAssetHistory.ts:54`
  (Accounts page, Wealth report) still load every transaction, and `['allTransactions','*']` is in every transaction write's
  invalidation set, so they refetch while mounted.
- Measured: getAllTransactions 0.8-0.85 s at 50k post-fix, plus ~100 ms structural sharing, plus the JS net-worth fold (P17).
  It is about half of "open dashboard" (1.6 s) and almost all of "open accounts page" (0.93 s).
- Fix: uncategorized card -> `getUncategorizedTransactions(budgetId, limit)` on the category index (see P28);
  net worth / asset history -> a SQL aggregate (month-end balance per account from RunningBalance*, ~30 x 120 rows).

### P27 [MED-HIGH, new] Row materialisation, not SQL, dominates every large result after P1
- `core/src/database/web-adapter.ts:336-350` (and node-sqljs-adapter.ts:109-118): `all()` calls sql.js `getAsObject()` per row,
  which re-reads and UTF-8-decodes every column name for every row, then decodes every string value.
- Measured (getAllTransactionsDetailed SQL, 50k rows): SQLite stepping 235 ms; with getAsObject 1241 ms; with `get()` + column
  names read once per statement 696 ms. Profile of getAllTransactions: 67% JS (decodeUTF8, row objects), 21% SQLite.
- Fix: in both adapters read `getColumnNames()` once and build objects from `get()` (same output). ~45% off every large
  query (full registers, All Transactions, analytics, exports). Further: return IDs instead of repeated names (Category,
  Account, Label) for whole-ledger callers.

### P11 [MED, reuse] listAccounts: 4 ledger scans per account, mounted everywhere, refetched on every write
Post-fix 90-127 ms at 50k and 190-280 ms at 100k per refetch (64 ms at 50k in an idle run). Fix unchanged (sargable future predicate, one
grouped pass, Uncleared moved to the register summary or a partial index).

### P23 [MED, new] Register refetches the full payee usage aggregation on every write, for a list of names
- `app/src/entities/payee/api/usePayees.ts:27` keeps only `.Name` from `getPayeesWithUsage` (`core/src/services/transactions/
  queries.ts:1486-1510`: GROUP BY Payee over every transaction plus split payees). `['payees']` is in TX_WRITE_INVALIDATION_KEYS
  and in `transactions.updateColumn`'s set (domains/transactions.ts:469), so every amount/category/date edit reruns it.
- Measured 57-80 ms at 50k and 120-170 ms at 100k, per write in the register.
- Fix: names-only query (saved payees + `SELECT DISTINCT Payee`, with an index `(BudgetID, Payee)`), usage counts only on
  Settings > Payees; invalidate payees only when Payee changes or rows are added.

### P28 [MED, new, follow-up to P6] The new uncategorized-count query still scans the whole budget on every write
- `getUncategorizedCountsByAccount` (audit/queries, transactions/queries.ts) is `LEFT JOIN categories ... NOT EXISTS splits`
  over every row: 70-93 ms at 50k and 135-220 ms at 100k, mounted on every page (sidebar badge) and refetched on every write.
- Fix: with FKs on, an uncategorized row can only point at an Uncategorized-named category, so drive from those categories
  on idx_transactions_category_date. Measured at 100k: 86 ms -> 0.1 ms, same counts per account (4 uncategorized rows in
  3 accounts). Caveat: rows with CategoryID 0 or a dangling ID only exist while FKs are off; the open-time orphan cleanup
  removes those, but keep a slow-path fallback or a one-off check if in doubt.

### P13 [MED, reuse] Amount edit = incremental update + full recalculateBalances
Profile of "edit amount cell" at 50k: the `WITH balances AS MATERIALIZED (... SUM() OVER (PARTITION BY AccountID ...))`
recompute is the single largest statement (159 ms) and the UPDATE accounts balance sums another 26 ms. Fix unchanged.

### P24 [MED, new] Column-blind invalidation: a memo edit refetches the budget, RTA, accounts and payees
- `app/src/shared/mutations/op-code-registry/domains/transactions.ts:460-470` (`transactions.updateColumn` ->
  TX_WRITE_INVALIDATION_KEYS + payees). Memo, Payee, Label and Cleared edits cannot change Available, RTA or balances
  (Cleared changes Uncleared only).
- Fix: make `invalidates` a function of args (`columnName`) in the op registry; Memo -> register queries only, Payee -> +payees,
  Cleared -> +accounts. Gain at 50k (register, post-fix): a memo edit from ~0.9 s of refetch to ~20 ms (estimate: register page + summary).

### P10 [MED-HIGH, reuse] Continuous rules fan out to one synced, persisted op per (transaction x rule)
Bank sync 200 rows x 3 continuous rules: 800 persists = the bulk of that interaction (table above). P22 makes each one cheap;
running each rule once over the batch removes 600 ops.

### P9, P12, P15, P16, P17, P18 [reuse]
Still present; measured contributions in the tables (picker getMonthlyBudget + RTA on every register write; all-time counts
in getMonthlyBudget; unpaged All Transactions = getAllTransactionsDetailed 2.0 s at 50k post-fix; 30 strftime month queries on
the dashboard ~57 ms; net-worth JS fold; CC N+1).

## P19: the monthly budget and Ready to Assign recompute from the start of history

The owner's main target is getMonthlyBudget itself: per-category Assigned / Activity / Available and the CC payment
rows of the selected month. Ready to Assign has equal priority and gets the same treatment.

### What each read does today

getMonthlyBudget(M), cumulative mode (default), monthly-budgets/index.ts:40-212 and queries.ts:1195-1306:

| part | where | what it reads |
|---|---|---|
| main SQL: activity_month | queries.ts:1199-1214 | month M only |
| main SQL: activity_prior | queries.ts:1215-1230 | every on-budget row and split line before M |
| main SQL: transaction_counts | queries.ts:1240-1257 | every row of the budget, all time (only the delete dialog uses it, P12) |
| main SQL: assignment_totals | queries.ts:1258-1268 | every assignment up to M |
| getActivityByAccountKind | queries.ts:860-927 | month M in cumulative mode; a full-ledger window in monthly mode |
| CC: getCCPaymentAdjustments | queries.ts:1435-1492 | 2 sums per card; the `< M` one reads the card's whole history |
| CC: getCCSpendingByCategoryAndAccount | queries.ts:1566-1655 | twice, each a UNION over every transaction and split of every budget, filtered afterwards (P21) |
| CC: getCCAccountBalances | queries.ts:1687-1708 | every card row up to M |
| CC: getAssignedPriorToMonth per CC row | index.ts:140 | N+1 (P18) |

Monthly mode adds, on every getMonthlyBudget call:
- getActivityByAccountKind(monthly), which is one MONTHLY_ACTIVITY_CTE window pass over the whole ledger;
- computeMonthlyRollforward (queries.ts:929-1193): getCategoryMonthlySeries plus getCreditPurchasesInFundingOrder,
  so two more passes, then a JS fold over every month since the first one;
- the cumulative CC block, which still runs and is then overwritten.

Monthly RTA = an income pass of the same CTE + grouped transfers/assignments/revaluations (`strftime` on the
revaluation dates, not sargable, queries.ts:641-645) + computeMonthlyRollforward(M+1) again.

Profile of "open budget page", monthly mode, 50k post-fix: 12.1 s. Of that, 9.4 s is 24 runs of the ledger-window
CTE, 0.9 s is 12 runs of the CC spending query and 0.8 s is 6 runs of the main SQL.

### Cost vs history length (post-P1-P7 core, p50 / p95 / p99 ms)

Same transaction count spread over 2 years vs 10 years, and 150k over 10 years.

| query | mode | 50k over 2 years | 50k over 10 years | 150k over 10 years |
|---|---|---|---|---|
| getMonthlyBudget current | cumulative | 302 / 435 / 498 (n=61) | 295 / 417 / 433 (n=61) | 692 / 747 / 765 (n=30) |
| getMonthlyBudget mid-history (-60 mo) | cumulative | 54.2 / 71.8 / 83.3 | 164 / 226 / 251 (n=118) | 411 / 423 / 514 (n=49) |
| getReadyToAssign | cumulative | 70.7 / 76.0 / 102 | 99.2 / 106 / 110 | 166 / 171 / 183 (n=120) |
| getReadyToAssignBreakdown | cumulative | 71.3 / 94.4 / 103 | 103 / 108 / 113 (n=194) | 168 / 176 / 209 (n=119) |
| getMonthlyBudget current | monthly | 1.3 s / 1.6 s / 1.6 s (n=15) | 1.6 s / 2.3 s / 2.3 s (n=12) | 3.3 s / 3.4 s / 3.4 s (n=7) |
| getMonthlyBudget mid-history (-60 mo) | monthly | 81.4 / 108 / 108 | 711 / 1.0 s / 1.1 s (n=26) | 1.7 s / 1.8 s / 1.8 s (n=12) |
| getReadyToAssign | monthly | 1.6 s / 2.1 s / 2.1 s (n=13) | 1.9 s / 2.0 s / 2.0 s (n=13) | 3.0 s / 3.1 s / 3.1 s (n=7) |
| getReadyToAssignBreakdown | monthly | 1.2 s / 2.1 s / 2.1 s (n=15) | 1.9 s / 2.0 s / 2.0 s (n=11) | 3.0 s / 3.0 s / 3.0 s (n=7) |

| part (timed alone) | 50k over 2 years | 50k over 10 years | 150k over 10 years |
|---|---|---|---|
| [old SQL] cte activity_month (=M) | 5.81 / 6.23 / 6.55 | 1.12 / 1.58 / 1.71 | 1.75 / 1.83 / 1.90 |
| [old SQL] cte activity_prior (<M, all history) | 113 / 120 / 120 | 107 / 112 / 123 | 194 / 205 / 238 (n=154) |
| [old SQL] cte transaction_counts (all-time, delete dialog only) | 56.8 / 58.6 / 59.9 | 54.0 / 55.9 / 56.6 | 98.1 / 105 / 121 |
| [old SQL] cte assignment_totals (assigned + assigned_prior) | 4.75 / 4.87 / 5.01 | 12.1 / 13.4 / 13.7 | 8.79 / 9.01 / 9.24 |
| queries.getMonthlyBudget (main SQL) | 187 / 192 / 202 | 181 / 187 / 190 | 310 / 320 / 372 (n=97) |
| getActivityByAccountKind (cumulative) | 7.10 / 7.34 / 7.46 | 1.99 / 2.19 / 2.25 | 2.27 / 2.36 / 2.39 |
| getActivityByAccountKind (monthly: ledger window) | 370 / 384 / 389 (n=165) | 349 / 365 / 369 (n=177) | 555 / 588 / 626 (n=54) |
| CC: getCCPaymentAdjustments (2 sums per card) | 16.1 / 17.5 / 18.2 | 17.0 / 18.5 / 18.8 | 26.0 / 27.1 / 27.8 |
| CC: getCCSpendingByCategoryAndAccount (=M and <M) | 202 / 226 / 227 | 191 / 204 / 208 | 299 / 318 / 342 (n=100) |
| CC: getCCAccountBalances | 39.8 / 40.9 / 41.6 | 36.0 / 37.5 / 39.7 | 52.1 / 54.0 / 55.8 |
| CC: getAssignedPriorToMonth x cards | 0.66 / 0.69 / 0.74 | 0.87 / 0.92 / 0.94 | 0.36 / 0.39 / 0.47 |
| computeMonthlyRollforward (monthly mode, from first month) | 805 / 1.3 s / 1.3 s (n=68) | 1.0 s / 1.4 s / 1.5 s (n=54) | 2.0 s / 2.1 s / 2.1 s (n=16) |
| readyToAssign (cumulative, 5 sums) | 87.9 / 91.3 / 94.4 | 99.0 / 105 / 116 | 167 / 176 / 211 (n=178) |
| readyToAssignMonthlyBatch (monthly, incl. rollforward) | 1.2 s / 1.8 s / 1.8 s (n=44) | 1.9 s / 2.4 s / 2.4 s (n=33) | 2.7 s / 2.9 s / 2.9 s (n=12) |

### Reads right after a mutation (p50 / p95 / p99 ms)

The mutation runs untimed before each timed read. "Back-dated" is a row 5 years back (on the 2-year dataset, the
oldest month).

| read | mode | right after | 50k/10y old | 50k/10y after P1-P7 | 50k/2y after P1-P7 | 100k/10y after P1-P7 |
|---|---|---|---|---|---|---|
| getMonthlyBudget current | cumulative | current-month tx edit | 544 / 574 / 582 (n=122) | 548 / 560 / 569 (n=128) | 288 / 434 / 440 (n=199) | 855 / 915 / 1.1 s (n=28) |
| getMonthlyBudget current | cumulative | assignment | 416 / 442 / 457 (n=144) | 330 / 566 / 572 (n=160) | 409 / 438 / 462 (n=144) | 881 / 886 / 919 (n=26) |
| getMonthlyBudget current | cumulative | back-dated (5y) edit | 414 / 470 / 487 (n=160) | 434 / 456 / 464 (n=140) | 295 / 451 / 484 (n=172) | 607 / 913 / 922 (n=30) |
| getReadyToAssign | cumulative | current-month tx edit | 9.3 s / 10.2 s / 10.2 s (n=7) | 125 / 137 / 138 | 68.2 / 90.8 / 95.7 | 150 / 182 / 207 (n=130) |
| getReadyToAssign | cumulative | assignment | 8.9 s / 10.1 s / 10.1 s (n=7) | 101 / 105 / 107 | 93.9 / 99.1 / 103 | 150 / 177 / 202 (n=130) |
| getReadyToAssign | cumulative | back-dated (5y) edit | 9.2 s / 9.4 s / 9.4 s (n=7) | 94.8 / 102 / 107 | 67.6 / 71.2 / 94.5 | 206 / 220 / 225 (n=107) |
| getReadyToAssignBreakdown | cumulative | current-month tx edit | 6.7 s / 8.8 s / 8.8 s (n=9) | 73.8 / 80.6 / 109 | 91.0 / 98.1 / 105 | 207 / 219 / 269 (n=96) |
| getReadyToAssignBreakdown | cumulative | assignment | 9.7 s / 9.9 s / 9.9 s (n=7) | 100 / 105 / 106 | 89.0 / 95.7 / 98.1 | 151 / 169 / 199 (n=131) |
| getReadyToAssignBreakdown | cumulative | back-dated (5y) edit | 9.2 s / 10.2 s / 10.2 s (n=7) | 98.5 / 109 / 112 | 63.4 / 81.9 / 85.3 | 157 / 275 / 277 (n=99) |
| getMonthlyBudget current | monthly | current-month tx edit | 2.0 s / 2.0 s / 2.1 s (n=32) | 1.4 s / 1.9 s / 2.4 s (n=41) | 1.7 s / 1.7 s / 1.7 s (n=41) | 2.9 s / 3.6 s / 3.6 s (n=7) |
| getMonthlyBudget current | monthly | assignment | 1.3 s / 1.5 s / 2.0 s (n=45) | 1.4 s / 1.9 s / 2.2 s (n=40) | 1.1 s / 1.2 s / 1.2 s (n=54) | 2.9 s / 4.0 s / 4.0 s (n=7) |
| getMonthlyBudget current | monthly | back-dated (5y) edit | 1.3 s / 2.0 s / 2.0 s (n=43) | 1.4 s / 2.0 s / 2.0 s (n=39) | 1.1 s / 1.2 s / 1.2 s (n=53) | 4.1 s / 4.6 s / 4.6 s (n=5) |
| getReadyToAssign | monthly | current-month tx edit | 7.2 s / 9.4 s / 9.4 s (n=9) | 1.4 s / 2.1 s / 2.1 s (n=38) | 1.0 s / 1.1 s / 1.5 s (n=58) | 3.7 s / 3.8 s / 3.8 s (n=6) |
| getReadyToAssign | monthly | assignment | 6.9 s / 9.8 s / 9.8 s (n=9) | 1.9 s / 2.0 s / 2.0 s (n=35) | 1.0 s / 1.1 s / 1.1 s (n=59) | 2.6 s / 3.5 s / 3.5 s (n=8) |
| getReadyToAssign | monthly | back-dated (5y) edit | 6.2 s / 7.4 s / 7.4 s (n=10) | 1.2 s / 1.8 s / 1.9 s (n=45) | 1.0 s / 1.6 s / 1.6 s (n=49) | 3.8 s / 4.0 s / 4.0 s (n=6) |
| getReadyToAssignBreakdown | monthly | current-month tx edit | 7.4 s / 10.0 s / 10.0 s (n=8) | 1.3 s / 2.0 s / 2.0 s (n=42) | 1.0 s / 1.1 s / 1.1 s (n=58) | 2.6 s / 3.6 s / 3.6 s (n=7) |
| getReadyToAssignBreakdown | monthly | assignment | 7.0 s / 9.3 s / 9.3 s (n=8) | 1.5 s / 2.1 s / 2.2 s (n=37) | 1.0 s / 1.4 s / 1.5 s (n=57) | 2.5 s / 4.2 s / 4.2 s (n=8) |
| getReadyToAssignBreakdown | monthly | back-dated (5y) edit | 6.0 s / 6.1 s / 6.1 s (n=10) | 1.2 s / 2.0 s / 2.1 s (n=41) | 973 / 1.1 s / 1.5 s (n=61) | 3.7 s / 3.8 s / 3.8 s (n=6) |

### P19 baseline at exactly 200 iterations (post-P1-P7 core, 50k / 10 years)

This is the reference the snapshot implementation reruns: `pnpm bench --core <branch> --tx 50000 --suite queries,p19
--case "^getMonthlyBudget|^getReadyToAssign" --iters 200 --min-iters 200 --budget-ms 1e8 --p19-budget-ms 1e8
--modes cumulative` (then `--modes monthly`).

| case | mode | p50 | p95 | p99 | n |
|---|---|---|---|---|---|
| getMonthlyBudget current | cumulative | 224 | 240 | 272 | 200 |
| getMonthlyBudget mid-history (-60 mo) | cumulative | 127 | 134 | 146 | 200 |
| getMonthlyBudget month switch (alternating) | cumulative | 223 | 234 | 265 | 200 |
| getReadyToAssign | cumulative | 53.8 | 58.2 | 66.9 | 200 |
| getReadyToAssignBreakdown | cumulative | 52.9 | 55.1 | 56.2 | 200 |
| getMonthlyBudget current after assignment | cumulative | 222 | 230 | 276 | 200 |
| getMonthlyBudget current after back-dated (5y) edit | cumulative | 223 | 237 | 268 | 200 |
| getMonthlyBudget current after current-month tx edit | cumulative | 224 | 232 | 255 | 200 |
| getReadyToAssign after assignment | cumulative | 52.5 | 55.2 | 60.3 | 200 |
| getReadyToAssign after back-dated (5y) edit | cumulative | 53.2 | 55.7 | 61.5 | 200 |
| getReadyToAssign after current-month tx edit | cumulative | 52.7 | 55.8 | 60.5 | 200 |
| getReadyToAssignBreakdown after assignment | cumulative | 52.6 | 56.2 | 64.1 | 200 |
| getReadyToAssignBreakdown after back-dated (5y) edit | cumulative | 51.9 | 55.2 | 64.5 | 200 |
| getReadyToAssignBreakdown after current-month tx edit | cumulative | 52.6 | 55.3 | 60.7 | 200 |
| getMonthlyBudget current | monthly | 1.1 s | 1.1 s | 1.2 s | 200 |
| getMonthlyBudget mid-history (-60 mo) | monthly | 520 | 548 | 592 | 200 |
| getMonthlyBudget month switch (alternating) | monthly | 1.0 s | 1.1 s | 1.1 s | 200 |
| getReadyToAssign | monthly | 744 | 933 | 979 | 200 |
| getReadyToAssignBreakdown | monthly | 717 | 785 | 891 | 200 |
| getMonthlyBudget current after assignment | monthly | 788 | 849 | 874 | 200 |
| getMonthlyBudget current after back-dated (5y) edit | monthly | 715 | 769 | 789 | 200 |
| getMonthlyBudget current after current-month tx edit | monthly | 787 | 839 | 867 | 200 |
| getReadyToAssign after assignment | monthly | 651 | 720 | 743 | 200 |
| getReadyToAssign after back-dated (5y) edit | monthly | 652 | 698 | 712 | 200 |
| getReadyToAssign after current-month tx edit | monthly | 714 | 767 | 790 | 200 |
| getReadyToAssignBreakdown after assignment | monthly | 650 | 673 | 713 | 200 |
| getReadyToAssignBreakdown after back-dated (5y) edit | monthly | 650 | 677 | 708 | 200 |
| getReadyToAssignBreakdown after current-month tx edit | monthly | 716 | 775 | 857 | 200 |
### P19 design: per-category end-of-month snapshot (getMonthlyBudget and RTA from one cache)

**State kept per budget (in memory, derived, never synced or persisted).** One row per (category, month) for
every month from the first ledger month to max(last ledger month, current month + 6):

- deltas: `assigned`, `activity` (split-aware, on-budget accounts only, the same rows `activity_month` sums
  today), and for spending categories `cash` / `credit` (the MONTHLY_ACTIVITY_CTE split);
- cumulative (end-of-month, inclusive) `assignedTotal`, `activityTotal` (cumulative mode Available =
  `assignedTotal(M-1) + activityTotal(M-1) + assigned(M) + activity(M)`, which is exactly today's
  `assigned_prior + activity_prior + assigned + activity`);
- monthly-mode carry state after the fold of month m: `carryTotal`, `carryCash` (the two floored
  envelopes of computeMonthlyRollforward, queries.ts:1039-1104), plus the displayed value and the cash overspend
  charged to RTA in m (that list is `priorCashOverspendDetails`).

Per (spending category, card, month): CC spend (current/prior split of getCCSpendingByCategoryAndAccount and
the funding attribution); per (card, month): payments (transfer inflows), net amount (for
getCCAccountBalances and the credit-card `BalanceAfter` running balance that MONTHLY_ACTIVITY_CTE uses to
split purchases into cash vs credit); per (payment category, month): assigned, funded, refunds, rolled
`carry` (queries.ts:1106-1170) and the per-source funding / debt breakdown for the current month only.

RTA components per month, from the same pass: income (cumulative mode: on-budget Income rows; monthly mode:
the CTE's Income + credit-cash Transfers), assignments, off-budget and in-budget transfers (the 4 copies of
the transfer rule, D8, collapse into this one grouped query), revaluations (by `substr(Date,1,7)`, sargable
with an expression index or a stored Month column). Cumulative RTA = sum of complete months before the
current one + a live `Date <= today` query for the current month (it is day-bounded, the snapshot is not);
monthly RTA(M) = prefix(M) - sum of cash overspend charged before M.

Memory: 121 months x ~170 categories x ~10 numbers is ~200k numbers per budget, a few MB at most.

**Reads.** getMonthlyBudget(M) = category/group rows (small, as today) + snapshot values for M + live
month-M queries that are already cheap (`activity_month`, getActivityByAccountKind cumulative,
current-month CC payments: all `Month = ?` on the (BudgetID, Month, ...) indexes). TotalTransactionCount
leaves the query (P12, lazy in the delete dialog). Monthly mode reads the stored fold at M; months after the
last stored month carry forward with zero deltas, as the current fold does.

**Build.** Lazily on the first budget read after open (or after a full invalidation): one grouped pass
per source (activity by category+month, assignments by category+month, the ledger window by account for
cash/credit + card balances, CC spend by category+card+month, payments by card+month, transfers and
revaluations by month), then the JS fold. Prototype (cumulative, spending categories, a local
`snapproto.mjs`, 50k/10y, machine under load): build 316 ms once, read of a month 0.18 ms, re-deriving
one dirty month 4-5 ms, 0 diffs against getMonthlyBudget over 459 category-months.

**Incremental update.** Every write marks `(budgetId, month)` dirty, using both OLD and NEW values (a
date move 2019-03 -> 2026-10 dirties both, a category move dirties both categories' month). Before a read:
- cumulative mode: re-derive the dirty months' deltas with `Month = ?` grouped queries (4-5 ms per month)
  and rebuild the affected prefix arrays in JS (O(months) per category). A 5-years-back edit costs the
  same as a current-month one.
- monthly mode: the fold is path dependent (floors, `carryCash = max(0, min(rawCash, displayed))`, CC
  funding in purchase order), so recompute from the earliest dirty month D: seed from the stored state at
  end of D-1 (carries + each credit account's running balance), re-run the ledger window for
  `Month >= D` only (sargable), fold D..horizon. Measured one ledger-window pass at 50k/10y under load: full
  history 431 ms, from 5 years back 212 ms, from 1 year back 45 ms, current month only 4.5 ms; today's
  monthly getMonthlyBudget runs three full passes, monthly RTA three more.
- full invalidation (rebuild): account inserted/deleted, `accounts.OnBudget/Type/Metadata/Currency`
  changed (on/off budget flips all history, CC payment links live in Metadata), category moved between
  groups or a group renamed/created/deleted (system groups are matched by name: Income, Transfers,
  Uncategorized, Credit Card Payments, Hidden Categories), budget `RtaMode`/`DisplayCurrency` changed,
  restore/snapshot download/`replaceDatabase`, migrations, and any trigger-install failure (then the
  service falls back to today's full queries).

**Where the invalidation hook lives: in core, at the database layer, as SQLite TEMP triggers.** Rejected:
- the app mutation executor (runtime/src/mutation-executor): it sees op names, not the rows and their OLD
  months; misses writes that are not ops (migrations, orphan cleanup on open, restore, YNAB import,
  exchange-rate refresh writing converted amounts) and needs per-op knowledge of what a mutation touches;
- calls from each core write method: ~40 write paths in transactions/index.ts, split-service,
  categories, accounts, currency, import, rules, recurring; one missed path = silently wrong Available.
- Recommended: `CREATE TEMP TRIGGER ... AFTER INSERT / DELETE / UPDATE OF CategoryID, AccountID, Date,
  InflowConverted, OutflowConverted, TransferID, ExcludeFromReadyToAssign, BudgetID ON main.transactions`
  (and on transaction_splits, assignments, account_revaluations; accounts/categories/category_groups/budgets
  for the full-invalidation columns) that call a JS function `budgero_dirty(budgetId, oldMonth, newMonth)`
  registered with `db.create_function`. `UPDATE OF <cols>` keeps the running-balance bumps (thousands of
  rows per write) from firing it. Triggers fire for FK cascades and for every code path, local or replayed.
  Caveat: sql.js `export()` closes and reopens the connection (sql-wasm-debug.js:1238-1250: it frees
  statements, removes functions, reopens), which drops TEMP triggers and functions. So the adapters'
  `backup()`/`forceSave()`/`replaceDatabase()` must re-install them right after export, and the snapshot
  must treat "hooks missing" as "invalidate all". A dev-mode verify flag (recompute fully on every read and
  assert equality) catches drift during development.

**Correctness risks and edge cases (from reading the rollforward and CC code)**
1. Monthly-mode floors make every later month depend on earlier carries: one missed dirty month corrupts
   all later months silently. The parity suite and the dev verify flag are the guard.
2. Split parents: a row's own amount counts only while it has no split lines (NO_SPLITS_FILTER); adding
   or clearing splits flips which rows count. Split-line triggers must dirty the parent's month (look up
   the parent; if the parent is already gone in a cascade, fall back to full invalidation).
3. Split-transfer mirror rows (`split_transfer_<id>_<date>`) move with the parent date (A4 fix): both
   months dirty.
4. Card cash/credit split depends on each credit account's running balance in ledger order
   (Date, Outflow DESC, ID, PartIndex): replay whole months, never part of a month, and seed the balance.
5. CC funding attribution is per purchase in that order, refunds cancel the same card's earliest purchases
   first (queries.ts:1051-1063): same, whole months only.
6. Cumulative-mode CC payment rows use all-time totals (funded = min(spend, max(0, available + spend))):
   recompute from prefix sums per (category, card), not from per-month deltas of `funded`.
7. Cumulative RTA uses `DATE(t.Date) <= today` while getMonthlyBudget uses Month: keep the current month
   live, and a midnight rollover needs no invalidation.
8. Off-budget transfer detection depends on the partner leg's account (EXISTS mirror): editing one leg
   changes the other leg's contribution; both legs share a date today, but a leg moved to another month must
   dirty the partner's month too (trigger on the partner row covers it when both legs are written; A15 says
   partner updates can land in a later transaction, which is still a trigger-visible write).
9. Account OnBudget/Type/Metadata, category group membership, group names: full rebuild.
10. FX: exchange-rate refresh rewrites Converted columns (trigger-visible); revaluation rows dirty their month.
11. Multi-budget spaces: key the snapshot and the dirty set by BudgetID.
12. Restore / snapshot download replaces the DB object: rebuild; the hooks are gone anyway.
13. Months beyond the last stored month (the UI asks for current+5): carry forward, and extend the
    horizon when a future-dated row or assignment arrives.
14. Undo/redo, replayed remote ops and push-API items are ordinary SQL writes: covered.

**Expected gain** (estimate from the prototype and measured parts, 50k / 10 years):
- cumulative getMonthlyBudget ~300 ms -> ~10 ms (live month-M queries ~3 ms + current-month CC + snapshot read);
- monthly getMonthlyBudget 1.1-1.6 s -> ~10-20 ms after a current-month edit (a one-month replay), and ~250 ms once
  after a 5-years-back edit;
- RTA cumulative ~100 ms -> ~5 ms (the live current-month part), monthly 0.7-1.9 s -> ~5 ms;
- the budget page (6 months + RTA + breakdown, with P20 and P8 unfixed) goes from 2.0 s (cumulative) and 11 s
  (monthly) to ~70 ms per assignment; with P20 and P8 fixed, to ~20 ms.

At 100k every "before" figure roughly doubles or triples while the snapshot reads stay flat.

**Implementation plan**
1. Land P20 (6 mounted months), P8 (RTA once, breakdown derived) and P21 (CC spend query) first: they
   are small and cut the work the snapshot has to beat.
2. `core/src/services/monthly-budgets/snapshot.ts`: build / read / applyDirty for both modes, pure
   functions over the grouped query results (unit-testable without SQL).
3. Grouped "by month" versions of the existing queries (one per source, `Month >= ?` bound for replays).
4. Dirty tracking in `database/`: trigger DDL + `budgero_dirty` registration, re-installed after every
   export/restore in WebDatabaseAdapter and NodeSqlJsAdapter; `onFullInvalidate` hook for restore and
   migrations.
5. MonthlyBudgetService reads through the snapshot when hooks are healthy, falls back to the current
   queries otherwise; `BUDGERO_SNAPSHOT_VERIFY=1` runs both and throws on any difference.
6. Gate: `pnpm parity --a <master> --b <branch>` (and `--b-init` toggling the snapshot on the same build)
   with >= 20 seeds x 300 steps, 0 diffs; plus node-tests for each edge case above. Then
   `pnpm bench` before/after on 50k and 100k.

### P19 as implemented (feat/p19-snapshot)

Code: `packages/core/src/services/monthly-budgets/snapshot/` (model.ts pure folds, store.ts SQL + TEMP
triggers + registry, reads.ts the snapshot-backed reads, compare.ts). Differences from the design above:
- **No stored fold state, no seeded partial replay.** The snapshot keeps only per-month grouped sums (per
  category: non-credit activity, assignments, income rows, transfer legs; per card: net, payments, CC spend;
  every on-budget credit line in ledger order). Every derived figure is recomputed in JS: cumulative sums
  per read (memoised per data version), the monthly rollforward once per data version over all months
  (credit running balance, floors, funding, payment pass). At 100k that refold is a few ms, so a
  5-years-back edit costs one month's `Month IN (...)` queries plus a refold, and nothing path-dependent
  can drift.
- **RtaMode changes need no invalidation**: the sums serve both modes.
- **Category / group membership is applied in JS from live metadata**: a category move or group rename
  re-folds without SQL. Accounts (OnBudget, Type, Metadata, Currency, BudgetID), budget DisplayCurrency and
  deletes rebuild.
- **Revaluations stay live** (a few hundred rows); cumulative RTA reads the previous and current month live
  with the original `DATE(Date) <= today` bound, so a midnight rollover needs no invalidation.
- Transfer partners: the transactions triggers also dirty every leg sharing the OLD/NEW TransferID.
- Inside an explicit transaction the snapshot is never read, built or refreshed (a rollback reverts rows
  without firing triggers); rows with a NULL `DATE(Date)` or a malformed Month make that budget use the full
  queries.
- `BUDGERO_SNAPSHOT=0` turns it off, `BUDGERO_SNAPSHOT_VERIFY=1` recomputes every read fully and throws on
  any difference (`configureBudgetSnapshot` sets both from code).

Interleaved A/B (bench/ab-core.mjs, base = fix/quarterly-code-quality-audit a98ae3d, 20 iterations, machine
at load 8-12), p50 / p95 ms:

| case (100k) | cumulative base | cumulative snapshot | monthly base | monthly snapshot |
|---|---|---|---|---|
| open budget page | 503 / 549 | 118 / 120 | 4185 / 5350 | 86 / 86 |
| switch month | 283 / 299 | 23 / 24 | 5784 / 5951 | 43 / 48 |
| assign money | 305 / 309 | 25 / 25 | 4907 / 6163 | 78 / 85 |
| getMonthlyBudget current | 424 / 435 | 5.4 / 6.7 | 2072 / 2083 | 9.9 / 15 |
| RTA + breakdown | 36 / 36 | 5.4 / 5.6 | 4114 / 5450 | 3.8 / 5.1 |
| first read of a session (builds the snapshot) | 344 | 716 | 2208 | 559 |

Writes: the triggers add nothing measurable to single edits; bulk-categorize 50 rows 11.6 -> 14.4 ms.

### P19 parity test plan (the bar the snapshot implementation must pass)

Tool: `packages/core/parity/run.mjs` (worktree audit/perf-suite). Two sides, same seeded dataset (bench generator,
default 800 rows over 3 years so every check covers every month), same seeded mutation sequence, compared after every step.

Sides:
- A = master 4dc2161 or the branch's own core with the snapshot disabled (full recomputation, today's code).
- B = the branch with the snapshot enabled. If both sides are one build, pass `--b-init enable-snapshot.mjs`
  (an `export default ({ core, services, adapter, side }) => {...}` hook) so only B reads through the cache.

Mutation mix (weights in run.mjs): add (any account incl. CC, off-budget, debt; past, current, future dates; 5% with
category 0 -> Uncategorized), edit amount (native and converted columns), edit date (moves across months, years apart),
edit category, move to another account, delete, assignment upsert (any category, any month incl. future), transfer
(any pair incl. off-budget savings, investments, loans/mortgage with a linked category on the paying leg), CC payment,
split upsert (2-3 lines, 30% with a transfer line), clear splits, FX rate edit on EUR/GBP rows, category delete,
category merge (reassign transactions + assignments, delete). Still to add when the snapshot lands: account
on/off-budget toggle, account type change, category move between groups, budget RtaMode switch mid-sequence,
`restore()` of an exported copy, exchange-rate refresh, YNAB import into a second budget (multi-budget isolation).

Compared after each step, in BOTH modes (RtaMode flipped on both sides):
- getMonthlyBudget(m) for every month from the first ledger month to 2 months past the last: every category row and
  every field (Available, Activity, CashActivity, CreditActivity, fundingBreakdown, cardBalance, paymentCalculation,
  debtBreakdown, TotalTransactionCount if still present);
- the Ready to Assign breakdown for every one of those months (batch API) plus the single-month entry point the UI uses;
- listAccounts (balances, future impact, uncleared), every transaction's RunningBalanceConverted/Native;
- every account register every N steps (`--registers-every`).
Any field difference, or an op that throws on one side only, fails the run. Zero diffs allowed.

Gate: >= 20 seeds x 300 steps per mode with 0 diffs, plus targeted node-tests for the 14 edge cases listed above, plus
`BUDGERO_SNAPSHOT_VERIFY=1` (recompute fully on every read and assert) on in dev builds and the e2e suite.

Run so far (this audit): the suite itself was validated by
- master vs master: PASS (60 steps);
- audit/queries (P1-P7 core) vs master: PASS, seeds 1, 4, 5 x 150 steps incl. all registers (so the merged partner join of
  P2 is output-identical);
- main+queries vs main: PASS, seed 2 x 150 steps;
- main (balances fixes) vs master: FAIL from step 125 on `deleteCategory` (account BalanceNative 1247890 vs 1272230):
  that is A5, master leaves stale balances after a cascading category delete and main fixes it. Expected, and a
  demonstration that the suite catches silent balance drift.

## (c) "#61 pattern" inventory: computed fields in the hot queries

Cost shares are from `bench/profile.mjs` per-statement timing and the p19 suite at 50k/10y on the post-fix core
(main + audit/queries), machine under load. "Lazy" = should be fetched by the one UI that needs it, when it opens.

### TX_ROW_COLUMNS (transactions/queries.ts:27-69; after audit/queries: TX_ROW_COLUMNS + TX_ROW_JOINS)
Callers: getTransactionsByAccountPage (register), getTransactionsByAccount (full register: Archive dialog,
warranties, P3/P4/P7 old paths), getTransactionsByAccountRange (register search, scheduled panel),
getAllTransactionsDetailed (All Transactions page P15, Upcoming card), getTransactionsByAccountAndMonth
(dashboard AtAGlance, 30 calls), getTransactionForAccountRegister, getTransactionsByCategoryAndMonth.

| field | how | consumers (app) | cost | verdict |
|---|---|---|---|---|
| Category = 'Split' | EXISTS on transaction_splits per row (indexed) | register cells, uncategorized logic | ~1 index probe/row | keep |
| TransferAccountOnBudget | partner-leg lookup (P1/P2) | transfer-category.ts only (read-only category, off-budget leg choice) | was a full scan per transfer row (register page 115 ms at 50k); now one indexed probe | keep, but it and TransferAccountName now share one join (done in audit/queries) |
| TransferAccountName | same partner lookup | payee label "→ Savings" (table-utils, card details, split dialog) | same | keep |
| AccountOnBudget, Label, LabelColor | joins | register, analytics | trivial | keep |
| Account (a.Name) appended by whole-budget callers | join | All Transactions, dashboard | trivial in SQL, but every repeated string is decoded per row (see P27) | return IDs, map names client-side |

The cost left after P1/P2 is not the columns, it is the callers that fetch every row: SQLite itself takes
~235 ms for getAllTransactionsDetailed at 50k, row materialisation in sql.js another ~1000 ms (P27).

### getMonthlyBudget (monthly-budgets/index.ts:40-212, queries.ts:1195-1306)

| field / part | source | consumers | share of cumulative call at 50k | verdict |
|---|---|---|---|---|
| Assigned, Activity (month M) | activity_month, assignment_totals | budget table | small (month-bounded) | keep |
| Available | assigned_prior + activity_prior: all history | budget table, goals, pickers | main SQL 97 ms of ~230 ms | P19 snapshot |
| TotalTransactionCount | transaction_counts: all rows, all time | delete-category dialog only (budget-transforms.ts:127-139,166 -> BudgetTable.tsx:286, BudgetModals.tsx:147) | ~30-40% of the main SQL | lazy (P12) |
| CashActivity / CreditActivity | getActivityByAccountKind: month M (cumulative); full-ledger window (monthly) | overspend colour (red vs yellow) and cash/credit tooltip | ~0 cumulative; ~280 ms monthly | monthly: take from the snapshot/rollforward pass |
| CC rows: Available, Activity | getCCPaymentAdjustments (2 sums per card, `<M` reads history) + getCCSpendingByCategoryAndAccount | budget table CC rows | spending query 100 ms (2 calls, both scan every transaction and split of every budget) | P21 now, then snapshot |
| fundingBreakdown, totalFunded | same CC block (cumulative) or rollforward (monthly) | AvailableInfoPopover, CCUnderfundedBadge, AvailableCell tooltip | included above | could be lazy (popover) but cheap once the block is fixed |
| cardBalance | getCCAccountBalances: every card row <= M | AvailableInfoPopover + CCUnderfundedBadge ("owed" next to "set aside"), display only | 18 ms | lazy, or read listAccounts balances for the current month |
| paymentCalculation, debtBreakdown | computeMonthlyRollforward (monthly) | AvailableInfoPopover, CCUnderfundedBadge only | part of the rollforward | keep with snapshot |
| per-CC-row getAssignedPriorToMonth | N+1 query | CC rows | ~1 ms | drop (P18) |
| cumulative CC block in monthly mode | runs, then overwritten | none | ~120 ms wasted in monthly mode | skip when isMonthly (P8) |

### getReadyToAssign / getReadyToAssignBreakdown (index.ts:322-338, queries.ts:347-753)

| field | source | consumers | cost at 50k (post-fix) | verdict |
|---|---|---|---|---|
| readyToAssign (number) | cumulative: income + assignments + 2 transfer sums + revaluations | toolbar figure, pickers (P9), dashboard | 100 ms: income sum 71 ms (scans every row of every on-budget account, P26), transfer sums 17 ms each | P26 now (1 ms), P19 later |
| income, assignments, off/in-budget transfers, revaluations, futureAssignments | same pass | ReadyToAssignHelpPopover only | 0 extra, but the breakdown is a separate cache entry that recomputes everything (P8) | derive the number from the breakdown query |
| monthly: priorCashOverspend | computeMonthlyRollforward(M+1): 2 full ledger windows | the number | ~0.6 s of ~0.9 s | snapshot |
| monthly: priorCashOverspendDetails | same + filter/map per month | no UI consumer (only the YNAB import status and tests) | small | drop from the UI path |
| monthly: revaluations by month | `strftime('%Y-%m', r.Date)` not sargable (queries.ts:641-645) | number + popover | ~2 ms (few revaluation rows) | use substr/Month column when touching it |

### listAccounts (accounts/queries.ts:66-96)
Mounted on every page (sidebar) and refetched by every transaction write (`['accounts']` in TX_WRITE_INVALIDATION_KEYS).

| field | source | consumers | cost | verdict |
|---|---|---|---|---|
| a.* incl. BalanceNative/Converted | stored | everything | trivial | keep |
| FutureImpactNative / Converted | 2 correlated SUMs per account, `DATE(t.Date) > DATE('now')` not sargable -> reads every row of the account | AccountsList (sidebar "today" balance), useAccountMetrics (register header), plain-add-cache | about half of 90-125 ms at 50k | sargable `t.Date > ?` (served by idx_transactions_account_date_id), one pass for both columns (P11) |
| UnclearedNative / Converted | 2 correlated SUMs per account, no index on Cleared | useAccountMetrics (register header), ReconcileAccountDialog, BankConnectionPanel | the other half | only the register header needs it: move to getAccountTransactionSummary (already scans that account) or a partial index `(AccountID) WHERE Cleared = 0` (P11) |

### getAccountTransactionSummary (transactions/queries.ts:521-596)
One pass over the account's rows, refetched on every write in the register.

| field | consumers | verdict |
|---|---|---|
| TransactionCount | register pagination / header | keep |
| UncategorizedCount | register badge | keep |
| UnclearedCount | register | keep |
| UnsafeTransactionCount (typeof/range check on 6 money columns per row) | money-integrity banner (AccountPage.tsx:199-211) | keep but cheap only because it rides the same pass |
| TransferTransactionCount | EditAccountDialog only (`hasLinkedTransfers`) | lazy |
| TotalInflow/Outflow Converted/Native | no app consumer found outside plain-add-cache | drop or lazy |

### Payee and label directories
| query | consumers | cost at 50k | verdict |
|---|---|---|---|
| getPayeesWithUsage: GROUP BY Payee over every row + split payees + saved payees | register (`usePayees` keeps only the names), PayeeCombobox; UsageCount used only by Settings > Payees | see tables (P23) | names-only query for the register; usage counts only on the Payees page; invalidate on Payee changes, not every amount edit |
| getLabelsWithUsage | LabelCombobox shows counts, LabelsPage | <1 ms | fine |

### Dashboard analytics
| query | cost | note |
|---|---|---|
| getOnBudgetBalanceByDates x2, getSpendingByDatesByCategories x2, getIncomeExpenseByPeriod, getTotalAssignedForBudgetPace x2 | date-bounded, a few ms | fine |
| getTransactionsByAccountAndMonth x 30 accounts (AtAGlance) | `strftime('%Y-%m', t.Date) = ?` not sargable: reads each account's whole ledger (P16) | use `t.Month = ?` (stored column, indexed with AccountID) and one query for all accounts |
| Upcoming card | was the whole budget (P5); now `Date > today` only | fixed in audit/queries |
| Uncategorized card: getAllTransactions | whole ledger + JS filter, still after P6 (P25) | `WHERE uncategorized LIMIT n` query |

### Queries invalidated far more broadly than needed
- Root-wide keys: any invalidation key containing `'*'` or of length 1 becomes `queryKey[0] === root`
  (runtime mutation-executor.ts:102-108): every space, every budget, every account. Inactive queries are only
  marked stale, but every register you navigate back to refetches.
- `transactions.updateColumn` uses TX_WRITE_INVALIDATION_KEYS for every column (op-code-registry
  domains/transactions.ts:80-112, 469): a Memo, Payee, Label or Cleared edit refetches listAccounts,
  monthlyBudget (all mounted months), readyToAssign, payees, labels, uncategorized and all analytics. Only
  amount/date/category/account changes touch balances or the budget; only Payee touches payees (P24).
- `['monthlyBudget','*']` also refetches the goal cycle-financials query (deliberately keyed under
  monthlyBudget, useGoals.ts:135) and all 6 mounted budget months (P20).
- `['readyToAssign','*']` refetches the number and the breakdown separately, plus the `'current'` entry when
  both are mounted (P8/P9).
- Continuous rules: each `rules.execute` op carries RULE_EXECUTE_TX_INVALIDATIONS (everything); only
  deferred when the triggering add was a plain add / bank import (app-runtime.ts:633-653).
- Assignment ops invalidate every month of `monthlyBudget`, though only months >= the assignment month change.


## Profiles: what dominates each top offender

From `pnpm bench:profile` (V8 CPU profile plus per-SQL-statement wall time), 50k / 10 years. The `.cpuprofile`
files are in local scratch (not committed).

| case (core) | ms/iter | buckets | top statements |
|---|---|---|---|
| getReadyToAssign cumulative (old) | 7740 | SQLite wasm 79%, MEMFS page reads 16% | in-budget transfer sum 4243 ms, off-budget transfer sum 3438 ms (P1: a full scan per transfer row) |
| register page 200 rows (old) | 126 | SQLite 80% | the TX_ROW_COLUMNS page query, all of it (P1) |
| getMonthlyBudget cumulative (old) | 330 | SQLite 88% | CC spending x2 144 ms, main SQL 139 ms, CC balances 27 ms |
| getMonthlyBudget cumulative (post-fix) | 228 | SQLite 90% | CC spending x2 101 ms (P21), main SQL 97 ms (activity_prior + transaction_counts, P19/P12), CC balances 18 ms |
| getMonthlyBudget monthly (post-fix) | 1100 | SQLite 87% | MONTHLY_ACTIVITY_CTE x3 836 ms (P19/P8), CC spending x2 102 ms, main SQL 99 ms |
| getReadyToAssign cumulative (post-fix) | ~100 | SQLite | income sum 71 ms (P26), transfer sums 17 + 16 ms |
| getReadyToAssign monthly (post-fix) | ~1900 | SQLite | ledger CTE x3 1843 ms |
| listAccounts (post-fix) | 121 | SQLite 82% | the single listAccounts statement: 4 correlated sums x 30 accounts (P11) |
| getAllTransactionsDetailed (post-fix) | 1480 | JS 69% (row objects, decodeUTF8), SQLite 19%, GC 6% | one statement; SQLite stepping alone 235 ms (P27) |
| getAllTransactions (post-fix) | 785 | JS 67%, SQLite 21% | one statement (P25, P27) |
| open budget page, monthly (post-fix) | 12093 | SQLite 87% | ledger CTE x24 9450 ms, CC spending x12 899 ms, main SQL x6 813 ms (P20 x P19) |
| open budget page, cumulative (post-fix) | 2578 | SQLite 88% | CC spending x12 962 ms, main SQL x6 932 ms, CC balances x6 182 ms (P20 x P21 x P19) |
| edit amount cell (post-fix, refetch only) | 937 | SQLite 90% | recalculateBalances window 159 ms (P13), CC spending 152, main SQL 141, listAccounts 111 (P11), uncategorized counts 83 (P28), payees 63 (P23), account summary 60, RTA income 51 (P26) |
| open dashboard (post-fix) | 1872 | SQLite 55%, JS 32% | uncategorized card getAllTransactions 762 ms (P25), CC spending 170, main SQL 166, balance-by-dates 134, listAccounts 115 |
| add transaction + 3 continuous rules (post-fix, refetch only) | 616 | SQLite 88% | CC spending 160, main SQL 148, uncategorized counts 82, payees 63, RTA income 56; plus 4 persists (P22) |

Other measured facts:
- `db.export()` is cheap: 2-10 ms at 19 MB. It closes and reopens the connection (sql-wasm-debug.js:1238-1250), which
  costs about 1 ms of schema re-parse on the next query; the page cache is cold, but that is not measurable here.
  LZ4 (lz4js) is the persist cost: 0.34 compression ratio, ~180-260 ms at 19-35 MB.
- A bigger SQLite page cache (`PRAGMA cache_size=-131072`; MEMFS page reads are 6-16% of the SQLite profiles) gave
  10-20% in some runs. That is within the load noise, so it is unverified. Note that `export()` resets pragmas.
- Query time scales with row count, not history length: 50k rows over 2 years cost the same as over 10 years for the
  current month (P19 tables). The snapshot pays off by not re-reading rows, whatever their dates.

## Parity suite results (this audit)

| A vs B | seeds x steps | result |
|---|---|---|
| master vs master | 1 x 60 | PASS |
| audit/queries vs master | 3 x 150 (registers every 5-10 steps) | PASS: P1/P2 including the merged partner join are output-identical |
| main+queries vs main | 1 x 150 | PASS |
| main vs master | 1 x 150 | FAIL from step 125 `deleteCategory` (account BalanceNative 1247890 vs 1272230): the A5 balance fix in main. Expected. |

## (d) Recommended fix order

1. **P22 local persist without LZ4** (one-line change in the local cipher, plus coalescing per batch op). Every
   mutation gets 140-250 ms back at 50-100k, and bulk actions get seconds to minutes back. Lowest risk, biggest
   wall-clock win.
2. **P20 enable only the visible budget months.** Trivial; cuts the budget page's work 6x in the default view.
3. **P26 + P28 + P21 query rewrites** (category-index income/transfer sums, category-driven uncategorized
   counts, CC spending filters pushed into the UNION). Each is measured: 70 -> 1 ms, 90 -> 0.3 ms, ~100 -> ~5 ms
   (estimate).
4. **P8 + P9** (one RTA cache entry per month, picker data only while the picker is open) and **P24**
   (column-aware invalidation) and **P23** (payee names query). Together these remove most of the refetch set of
   every register edit.
5. **P27** (sql.js row materialisation: column names once per statement). Small code, ~45% off every large result.
6. **P19 snapshot**, gated by the parity suite (plan above). It turns the remaining 0.3 s (cumulative) and 1.1-1.9 s
   (monthly) budget reads into ~10 ms (estimate from the prototype).
7. **P25** (aggregate net worth / uncategorized-card queries), **P11**, **P13**, **P10** (rules once per batch),
   then P15/P16/P17/P18/P12.

After 1-5, estimated from the measured parts (cumulative, 50k):
- an amount edit in the register goes from ~1.3 s to ~0.45 s: what is left is listAccounts 120 ms, the account
  summary 60 ms and the mutation's full recalculateBalances 235 ms. P11 + P13 then take it to ~0.1 s.
- the budget page on assignment goes from 2.9 s to ~0.25 s: one month at ~200 ms after P21, plus one RTA at ~35 ms
  after P26. P19 then takes it to ~30 ms.
- a 200-row bank sync goes from ~150 s to ~10 s (800 persists at ~10 ms each, plus the inserts and rules).

## Appendix A: interactions, every size (total ms incl. persist; in brackets refetch+mutation p50/p95/p99)

| interaction | mode | size | old | main | queries | combined |
|---|---|---|---|---|---|---|
| open budget page | cumulative | 5k | 710 (710/759/768, n=31) | 674 (674/741/743, n=31) | 84.3 (84.3/90.7/193) | 86.1 (86.1/147/171) |
| open budget page | cumulative | 10k | 1.1 s (1.1 s/1.5 s/1.5 s, n=17) | 1.0 s (1.0 s/1.4 s/1.4 s, n=18) | 393 (393/403/435, n=51) | 386 (386/403/415, n=58) |
| open budget page | cumulative | 25k | 3.7 s (3.7 s/3.8 s/3.8 s, n=6) | 3.7 s (3.7 s/3.8 s/3.8 s, n=6) | 1.3 s (1.3 s/1.4 s/1.4 s, n=15) | 928 (928/968/1.0 s, n=22) |
| open budget page | cumulative | 50k | 13.2 s (13.2 s/13.2 s/13.2 s, n=2) | 14.1 s (14.1 s/14.2 s/14.2 s, n=2) | 2.0 s (2.0 s/2.1 s/2.1 s, n=10) | 2.0 s (2.0 s/2.8 s/2.8 s, n=10) |
| open budget page | cumulative | 100k | 52.2 s (52.2 s/52.2 s/52.2 s, n=1) | 53.5 s (53.5 s/53.5 s/53.5 s, n=1) | 6.1 s (6.1 s/6.6 s/6.6 s, n=4) | 6.9 s (6.9 s/7.1 s/7.1 s, n=3) |
| open budget page | monthly | 5k | 1.6 s (1.6 s/1.7 s/1.7 s, n=14) | 1.2 s (1.2 s/1.7 s/1.7 s, n=16) | 997 (997/1.3 s/1.3 s, n=20) | 838 (838/926/960, n=24) |
| open budget page | monthly | 10k | 2.8 s (2.8 s/3.9 s/3.9 s, n=7) | 3.0 s (3.0 s/3.8 s/3.8 s, n=7) | 2.4 s (2.4 s/2.8 s/2.8 s, n=9) | 1.8 s (1.8 s/2.3 s/2.3 s, n=11) |
| open budget page | monthly | 25k | 7.0 s (7.0 s/7.1 s/7.1 s, n=3) | 8.0 s (8.0 s/10.0 s/10.0 s, n=3) | 8.0 s (8.0 s/8.0 s/8.0 s, n=3) | 5.0 s (5.0 s/5.5 s/5.5 s, n=4) |
| open budget page | monthly | 50k | 20.0 s (20.0 s/20.1 s/20.1 s, n=2) | 19.7 s (19.7 s/20.0 s/20.0 s, n=2) | 10.8 s (10.8 s/10.8 s/10.8 s, n=2) | 11.3 s (11.3 s/14.7 s/14.7 s, n=2) |
| open budget page | monthly | 100k | 50.2 s (50.2 s/50.2 s/50.2 s, n=1) | 49.1 s (49.1 s/49.1 s/49.1 s, n=1) | 26.6 s (26.6 s/26.6 s/26.6 s, n=1) | 22.6 s (22.6 s/22.6 s/22.6 s, n=1) |
| switch month (uncached month) | cumulative | 5k | 464 (464/487/508, n=43) | 458 (458/482/557, n=47) | 41.7 (41.7/46.0/49.4) | 28.0 (28.0/32.1/49.7) |
| switch month (uncached month) | cumulative | 10k | 689 (689/819/901, n=29) | 671 (671/743/774, n=30) | 88.5 (88.5/93.7/95.3) | 60.8 (60.8/92.1/110) |
| switch month (uncached month) | cumulative | 25k | 2.7 s (2.7 s/2.8 s/2.8 s, n=8) | 2.7 s (2.7 s/3.8 s/3.8 s, n=7) | 257 (257/284/308, n=78) | 239 (239/261/265, n=90) |
| switch month (uncached month) | cumulative | 50k | 11.3 s (11.3 s/11.3 s/11.3 s, n=2) | 11.0 s (11.0 s/11.2 s/11.2 s, n=2) | 535 (535/617/617, n=40) | 591 (591/626/627, n=35) |
| switch month (uncached month) | cumulative | 100k | 39.9 s (39.9 s/39.9 s/39.9 s, n=1) | 41.6 s (41.6 s/41.6 s/41.6 s, n=1) | 1.4 s (1.4 s/1.4 s/1.4 s, n=15) | 1.4 s (1.4 s/1.5 s/1.5 s, n=15) |
| switch month (uncached month) | monthly | 5k | 542 (542/752/767, n=35) | 574 (574/775/890, n=32) | 398 (398/476/483, n=53) | 281 (281/320/397, n=71) |
| switch month (uncached month) | monthly | 10k | 1.2 s (1.2 s/1.9 s/1.9 s, n=15) | 1.1 s (1.1 s/1.6 s/1.6 s, n=18) | 628 (628/889/908, n=30) | 618 (618/942/947, n=31) |
| switch month (uncached month) | monthly | 25k | 3.5 s (3.5 s/3.7 s/3.7 s, n=6) | 3.3 s (3.3 s/3.6 s/3.6 s, n=6) | 2.5 s (2.5 s/2.7 s/2.7 s, n=8) | 1.7 s (1.7 s/2.2 s/2.2 s, n=12) |
| switch month (uncached month) | monthly | 50k | 13.1 s (13.1 s/13.4 s/13.4 s, n=2) | 12.8 s (12.8 s/12.8 s/12.8 s, n=2) | 4.3 s (4.3 s/5.2 s/5.2 s, n=5) | 3.4 s (3.4 s/4.9 s/4.9 s, n=6) |
| switch month (uncached month) | monthly | 100k | 37.6 s (37.6 s/37.6 s/37.6 s, n=1) | 37.1 s (37.1 s/37.1 s/37.1 s, n=1) | 8.8 s (8.8 s/10.0 s/10.0 s, n=3) | 7.9 s (7.9 s/8.2 s/8.2 s, n=3) |
| assign money in a category | cumulative | 5k | 614 (598/617/621, n=34) | 428 (412/439/503, n=49) | 170 (154/160/162, n=147) | 172 (156/162/163, n=133) |
| assign money in a category | cumulative | 10k | 938 (874/1.3 s/1.3 s, n=21) | 910 (846/935/941, n=24) | 411 (347/367/368, n=58) | 307 (243/318/422, n=80) |
| assign money in a category | cumulative | 25k | 3.4 s (3.3 s/3.3 s/3.3 s, n=7) | 4.7 s (4.6 s/4.7 s/4.7 s, n=5) | 1.3 s (1.2 s/1.3 s/1.3 s, n=17) | 942 (855/935/1.0 s, n=24) |
| assign money in a category | cumulative | 50k | 12.8 s (12.6 s/12.6 s/12.6 s, n=2) | 12.6 s (12.4 s/12.4 s/12.4 s, n=2) | 2.9 s (2.7 s/2.9 s/2.9 s, n=8) | 2.9 s (2.7 s/2.9 s/2.9 s, n=8) |
| assign money in a category | cumulative | 100k | 43.2 s (43.0 s/43.0 s/43.0 s, n=1) | 42.5 s (42.2 s/42.2 s/42.2 s, n=1) | 6.3 s (6.0 s/6.6 s/6.6 s, n=4) | 6.9 s (6.6 s/6.7 s/6.7 s, n=4) |
| assign money in a category | monthly | 5k | 1.1 s (1.1 s/1.7 s/1.7 s, n=16) | 1.3 s (1.2 s/1.6 s/1.6 s, n=16) | 1.2 s (1.2 s/1.2 s/1.2 s, n=19) | 919 (903/1.3 s/1.3 s, n=21) |
| assign money in a category | monthly | 10k | 2.4 s (2.3 s/3.5 s/3.5 s, n=8) | 3.2 s (3.2 s/3.6 s/3.6 s, n=7) | 2.2 s (2.2 s/2.5 s/2.5 s, n=9) | 2.2 s (2.1 s/2.5 s/2.5 s, n=10) |
| assign money in a category | monthly | 25k | 6.0 s (5.9 s/6.0 s/6.0 s, n=4) | 6.0 s (5.9 s/6.0 s/6.0 s, n=4) | 5.7 s (5.6 s/6.2 s/6.2 s, n=4) | 6.3 s (6.2 s/7.1 s/7.1 s, n=4) |
| assign money in a category | monthly | 50k | 21.4 s (21.2 s/21.2 s/21.2 s, n=1) | 18.8 s (18.6 s/19.0 s/19.0 s, n=2) | 11.2 s (11.0 s/11.1 s/11.1 s, n=2) | 9.8 s (9.7 s/11.9 s/11.9 s, n=2) |
| assign money in a category | monthly | 100k | 44.0 s (43.8 s/43.8 s/43.8 s, n=1) | 48.5 s (48.3 s/48.3 s/48.3 s, n=1) | 27.3 s (27.0 s/27.0 s/27.0 s, n=1) | 31.7 s (31.4 s/31.4 s/31.4 s, n=1) |
| open account register | - | 5k | 305 (305/451/482, n=59) | 366 (366/450/473, n=55) | 96.1 (96.1/102/105) | 96.9 (96.9/102/104) |
| open account register | - | 10k | 877 (877/908/918, n=25) | 577 (577/774/921, n=33) | 193 (193/199/218, n=114) | 177 (177/184/213, n=119) |
| open account register | - | 25k | 1.9 s (1.9 s/1.9 s/1.9 s, n=11) | 1.9 s (1.9 s/2.0 s/2.0 s, n=11) | 406 (406/426/442, n=51) | 298 (298/406/509, n=58) |
| open account register | - | 50k | 6.7 s (6.7 s/6.8 s/6.8 s, n=3) | 6.7 s (6.7 s/6.7 s/6.7 s, n=3) | 749 (749/928/935, n=26) | 834 (834/888/919, n=26) |
| open account register | - | 100k | 22.1 s (22.1 s/22.1 s/22.1 s, n=1) | 24.1 s (24.1 s/24.1 s/24.1 s, n=1) | 2.2 s (2.2 s/2.2 s/2.2 s, n=10) | 2.2 s (2.2 s/2.2 s/2.2 s, n=10) |
| scroll register (next page) | - | 5k | 26.1 (108/178/180, n=181) | 19.4 (78.8/124/150) | 6.15 (24.1/37.4/38.2) | 5.99 (23.9/37.3/38.5) |
| scroll register (next page) | - | 10k | 58.1 (232/349/357, n=88) | 42.2 (170/293/346, n=121) | 5.24 (19.0/37.9/48.4) | 6.91 (27.3/42.0/43.8) |
| scroll register (next page) | - | 25k | 73.5 (295/428/443, n=70) | 73.7 (297/437/477, n=70) | 5.76 (22.9/45.5/47.5) | 6.17 (24.5/37.2/38.1) |
| scroll register (next page) | - | 50k | 116 (438/668/675, n=46) | 116 (440/693/755, n=46) | 4.71 (18.8/28.5/29.6) | 7.57 (30.0/45.6/47.3) |
| scroll register (next page) | - | 100k | 132 (474/789/845, n=38) | 134 (476/1.1 s/1.1 s, n=37) | 8.69 (34.6/53.8/54.8) | 6.24 (24.8/52.0/54.7) |
| edit amount cell | cumulative | 5k | 353 (336/458/482, n=55) | 465 (448/463/474, n=49) | 116 (100/105/108) | 88.7 (72.6/100/103) |
| edit amount cell | cumulative | 10k | 674 (611/767/860, n=32) | 666 (602/738/797, n=33) | 206 (142/169/213, n=137) | 263 (199/208/210, n=101) |
| edit amount cell | cumulative | 25k | 2.1 s (2.0 s/2.1 s/2.1 s, n=11) | 2.0 s (2.0 s/2.4 s/2.4 s, n=10) | 443 (357/534/538, n=53) | 617 (530/556/563, n=38) |
| edit amount cell | cumulative | 50k | 7.0 s (6.8 s/6.9 s/6.9 s, n=3) | 7.6 s (7.5 s/7.6 s/7.6 s, n=3) | 984 (796/1.1 s/1.1 s, n=24) | 1.3 s (1.2 s/1.2 s/1.2 s, n=18) |
| edit amount cell | cumulative | 100k | 22.8 s (22.5 s/22.5 s/22.5 s, n=1) | 22.5 s (22.3 s/22.3 s/22.3 s, n=1) | 1.9 s (1.6 s/2.5 s/2.5 s, n=12) | 2.0 s (1.7 s/2.6 s/2.6 s, n=10) |
| edit category cell | cumulative | 5k | 429 (413/454/481, n=54) | 437 (420/465/474, n=50) | 88.5 (72.4/76.7/78.7) | 87.7 (71.6/75.9/79.7) |
| edit category cell | cumulative | 10k | 633 (569/839/880, n=33) | 629 (565/617/642, n=35) | 168 (104/119/153, n=190) | 208 (144/149/151, n=146) |
| edit category cell | cumulative | 25k | 2.0 s (1.9 s/2.0 s/2.0 s, n=11) | 2.0 s (1.9 s/2.8 s/2.8 s, n=10) | 368 (281/307/356, n=71) | 470 (383/391/409, n=53) |
| edit category cell | cumulative | 50k | 7.1 s (6.9 s/7.0 s/7.0 s, n=3) | 6.9 s (6.7 s/6.8 s/6.8 s, n=3) | 825 (637/881/883, n=28) | 1.1 s (864/921/921, n=25) |
| edit category cell | cumulative | 100k | 22.6 s (22.3 s/22.3 s/22.3 s, n=1) | 31.8 s (31.6 s/31.6 s/31.6 s, n=1) | 2.0 s (1.7 s/2.0 s/2.0 s, n=12) | 2.2 s (2.0 s/2.0 s/2.0 s, n=11) |
| add transaction (+3 continuous rules) | cumulative | 5k | 430 (365/441/503, n=55) | 315 (250/365/418, n=75) | 121 (56.6/60.5/63.0) | 121 (56.2/59.7/61.8) |
| add transaction (+3 continuous rules) | cumulative | 10k | 771 (516/587/597, n=39) | 767 (512/581/622, n=39) | 366 (111/121/135, n=184) | 333 (77.8/138/141) |
| add transaction (+3 continuous rules) | cumulative | 25k | 2.1 s (1.8 s/2.6 s/2.6 s, n=11) | 2.2 s (1.8 s/1.9 s/1.9 s, n=11) | 571 (224/236/309, n=89) | 658 (311/340/358, n=64) |
| add transaction (+3 continuous rules) | cumulative | 50k | 7.2 s (6.4 s/6.7 s/6.7 s, n=4) | 7.1 s (6.4 s/6.5 s/6.5 s, n=4) | 1.2 s (493/545/607, n=41) | 1.4 s (689/758/766, n=29) |
| add transaction (+3 continuous rules) | cumulative | 100k | 26.6 s (25.5 s/25.5 s/25.5 s, n=1) | 23.5 s (22.4 s/22.4 s/22.4 s, n=1) | 2.6 s (1.6 s/1.8 s/1.8 s, n=14) | 2.0 s (1.0 s/1.3 s/1.3 s, n=20) |
| delete transaction | cumulative | 5k | 500 (484/738/786, n=39) | 501 (485/737/747, n=38) | 91.9 (75.7/79.5/83.7) | 91.6 (75.5/79.3/82.4) |
| delete transaction | cumulative | 10k | 1.3 s (1.2 s/1.3 s/1.3 s, n=17) | 1.3 s (1.2 s/2.1 s/2.1 s, n=14) | 222 (158/168/206, n=127) | 174 (110/172/189, n=166) |
| delete transaction | cumulative | 25k | 4.6 s (4.5 s/4.5 s/4.5 s, n=5) | 4.6 s (4.5 s/4.9 s/4.9 s, n=5) | 372 (285/301/361, n=70) | 493 (406/426/428, n=50) |
| delete transaction | cumulative | 50k | 13.8 s (13.6 s/13.6 s/13.6 s, n=2) | 13.5 s (13.3 s/13.4 s/13.4 s, n=2) | 895 (708/919/936, n=27) | 1.1 s (876/910/912, n=23) |
| delete transaction | cumulative | 100k | 57.2 s (56.9 s/56.9 s/56.9 s, n=1) | 40.1 s (39.8 s/39.8 s/39.8 s, n=1) | 2.2 s (1.9 s/2.1 s/2.1 s, n=11) | 1.6 s (1.3 s/2.0 s/2.0 s, n=14) |
| bulk-categorize 50 rows | cumulative | 5k | 1.1 s (317/415/415, n=3) | 1.3 s (501/504/504, n=3) | 880 (73.0/74.9/74.9, n=3) | 876 (69.5/69.9/69.9, n=3) |
| bulk-categorize 50 rows | cumulative | 10k | 4.1 s (869/895/895, n=3) | 4.1 s (866/1.6 s/1.6 s, n=3) | 3.3 s (132/140/140, n=3) | 3.3 s (138/150/150, n=3) |
| bulk-categorize 50 rows | cumulative | 25k | 7.5 s (3.1 s/3.1 s/3.1 s, n=3) | 7.5 s (3.1 s/3.2 s/3.2 s, n=3) | 4.5 s (204/222/222, n=3) | 4.6 s (298/300/300, n=3) |
| bulk-categorize 50 rows | cumulative | 50k | 17.2 s (7.8 s/7.9 s/7.9 s, n=3) | 17.3 s (7.9 s/8.0 s/8.0 s, n=3) | 9.8 s (424/431/431, n=3) | 10.0 s (655/655/655, n=3) |
| bulk-categorize 50 rows | cumulative | 100k | 32.9 s (19.9 s/20.0 s/20.0 s, n=3) | 33.2 s (20.2 s/20.2 s/20.2 s, n=3) | 14.4 s (1.3 s/1.3 s/1.3 s, n=3) | 14.3 s (1.3 s/1.3 s/1.3 s, n=3) |
| bank-sync import 200 rows + 3 continuous rules | cumulative | 5k | 14.1 s (1.2 s/1.4 s/1.4 s, n=3) | 14.2 s (1.3 s/1.9 s/1.9 s, n=3) | 14.2 s (1.3 s/1.4 s/1.4 s, n=3) | 14.2 s (1.3 s/1.4 s/1.4 s, n=3) |
| bank-sync import 200 rows + 3 continuous rules | cumulative | 10k | 52.3 s (1.3 s/1.3 s/1.3 s, n=3) | 53.3 s (2.3 s/2.3 s/2.3 s, n=3) | 52.1 s (1.0 s/1.2 s/1.2 s, n=3) | 52.0 s (955/1.0 s/1.0 s, n=3) |
| bank-sync import 200 rows + 3 continuous rules | cumulative | 25k | 72.1 s (2.6 s/2.7 s/2.7 s, n=3) | 72.0 s (2.5 s/2.7 s/2.7 s, n=3) | 70.4 s (1.0 s/1.1 s/1.1 s, n=3) | 71.2 s (1.7 s/1.9 s/1.9 s, n=3) |
| bank-sync import 200 rows + 3 continuous rules | cumulative | 50k | 157.5 s (7.4 s/7.4 s/7.4 s, n=3) | 157.4 s (7.3 s/7.3 s/7.3 s, n=3) | 151.6 s (1.4 s/1.5 s/1.5 s, n=3) | 152.6 s (2.4 s/2.4 s/2.4 s, n=3) |
| bank-sync import 200 rows + 3 continuous rules | cumulative | 100k | 231.0 s (22.5 s/22.9 s/22.9 s, n=3) | 231.3 s (22.8 s/22.8 s/22.8 s, n=3) | 212.1 s (3.6 s/3.8 s/3.8 s, n=3) | 212.1 s (3.6 s/3.8 s/3.8 s, n=3) |
| open dashboard | - | 5k | 1.2 s (1.2 s/1.3 s/1.3 s, n=18) | 1.0 s (1.0 s/1.3 s/1.3 s, n=20) | 246 (246/259/272, n=85) | 248 (248/262/321, n=85) |
| open dashboard | - | 10k | 2.0 s (2.0 s/3.6 s/3.6 s, n=9) | 2.2 s (2.2 s/3.4 s/3.4 s, n=9) | 321 (321/548/562, n=55) | 436 (436/493/578, n=50) |
| open dashboard | - | 25k | 8.7 s (8.7 s/8.7 s/8.7 s, n=3) | 8.7 s (8.7 s/8.7 s/8.7 s, n=3) | 782 (782/1.2 s/1.2 s, n=24) | 723 (723/982/983, n=25) |
| open dashboard | - | 50k | 55.3 s (55.3 s/55.3 s/55.3 s, n=1) | 36.2 s (36.2 s/36.2 s/36.2 s, n=1) | 1.8 s (1.8 s/2.5 s/2.5 s, n=11) | 1.6 s (1.6 s/1.8 s/1.8 s, n=13) |
| open dashboard | - | 100k | 128.5 s (128.5 s/128.5 s/128.5 s, n=1) | 137.1 s (137.1 s/137.1 s/137.1 s, n=1) | 3.5 s (3.5 s/4.4 s/4.4 s, n=6) | 3.4 s (3.4 s/5.6 s/5.6 s, n=5) |
| open accounts page (net worth) | - | 5k | 821 (821/865/915, n=29) | 837 (837/860/860, n=26) | 123 (123/135/139, n=183) | 125 (125/136/142, n=180) |
| open accounts page (net worth) | - | 10k | 1.7 s (1.7 s/2.7 s/2.7 s, n=11) | 2.6 s (2.6 s/2.7 s/2.7 s, n=9) | 190 (190/324/344, n=93) | 245 (245/326/352, n=85) |
| open accounts page (net worth) | - | 25k | 11.3 s (11.3 s/11.3 s/11.3 s, n=3) | 7.2 s (7.2 s/7.3 s/7.3 s, n=3) | 471 (471/753/755, n=38) | 398 (398/575/592, n=45) |
| open accounts page (net worth) | - | 50k | 29.3 s (29.3 s/29.3 s/29.3 s, n=1) | 29.7 s (29.7 s/29.7 s/29.7 s, n=1) | 1.4 s (1.4 s/1.5 s/1.5 s, n=17) | 934 (934/1.4 s/1.4 s, n=19) |
| open accounts page (net worth) | - | 100k | 102.4 s (102.4 s/102.4 s/102.4 s, n=1) | 103.1 s (103.1 s/103.1 s/103.1 s, n=1) | 2.0 s (2.0 s/3.1 s/3.1 s, n=9) | 1.9 s (1.9 s/2.0 s/2.0 s, n=11) |
| open reports (analytics) | - | 5k | 225 (225/311/378, n=81) | 300 (300/367/396, n=68) | 134 (134/204/206, n=131) | 168 (168/199/201, n=123) |
| open reports (analytics) | - | 10k | 367 (367/474/526, n=53) | 438 (438/590/610, n=44) | 278 (278/400/500, n=64) | 381 (381/474/478, n=51) |
| open reports (analytics) | - | 25k | 914 (914/946/982, n=22) | 901 (901/931/997, n=23) | 706 (706/1.0 s/1.1 s, n=27) | 618 (618/858/922, n=31) |
| open reports (analytics) | - | 50k | 1.8 s (1.8 s/1.9 s/1.9 s, n=12) | 1.9 s (1.9 s/2.7 s/2.7 s, n=10) | 2.1 s (2.1 s/2.2 s/2.2 s, n=11) | 1.3 s (1.3 s/2.0 s/2.0 s, n=14) |
| open reports (analytics) | - | 100k | 3.1 s (3.1 s/3.2 s/3.2 s, n=7) | 3.2 s (3.2 s/3.3 s/3.3 s, n=7) | 3.2 s (3.2 s/4.4 s/4.4 s, n=7) | 3.1 s (3.1 s/4.5 s/4.5 s, n=7) |

## Appendix B: single queries, p50 / p95 / p99 ms per size x core

| case | mode | size | old p50 / p95 / p99 (ms) | main p50 / p95 / p99 (ms) | queries p50 / p95 / p99 (ms) | combined p50 / p95 / p99 (ms) |
|---|---|---|---|---|---|---|
| getMonthlyBudget current | cumulative | 5k | 9.97 / 11.3 / 12.6 | 9.98 / 11.3 / 11.8 | 9.84 / 11.0 / 11.4 | 10.2 / 11.5 / 12.1 |
| getMonthlyBudget current | cumulative | 10k | 37.0 / 60.2 / 66.3 | 55.1 / 58.2 / 59.7 | 36.7 / 47.4 / 57.3 | 36.4 / 46.3 / 50.1 |
| getMonthlyBudget current | cumulative | 25k | 141 / 156 / 208 (n=140) | 139 / 216 / 218 (n=126) | 137 / 168 / 193 (n=143) | 142 / 191 / 196 (n=132) |
| getMonthlyBudget current | cumulative | 50k | 301 / 428 / 450 (n=59) | 287 / 416 / 428 (n=68) | 420 / 437 / 456 (n=50) | 295 / 417 / 433 (n=61) |
| getMonthlyBudget current | cumulative | 100k | 576 / 822 / 822 (n=32) | 571 / 681 / 721 (n=35) | 575 / 820 / 832 (n=32) | 820 / 852 / 871 (n=26) |
| getMonthlyBudget current | cumulative | 150k |  |  |  | 692 / 747 / 765 (n=30) |
| getMonthlyBudget mid-history (-60 mo) | cumulative | 5k | 7.54 / 8.00 / 8.31 | 7.55 / 7.99 / 8.16 | 7.52 / 7.88 / 8.10 | 7.64 / 8.12 / 9.81 |
| getMonthlyBudget mid-history (-60 mo) | cumulative | 10k | 25.8 / 30.4 / 39.6 | 38.4 / 40.8 / 41.4 | 25.5 / 30.7 / 35.7 | 25.2 / 37.6 / 48.9 |
| getMonthlyBudget mid-history (-60 mo) | cumulative | 25k | 86.8 / 123 / 134 | 85.3 / 134 / 152 (n=199) | 84.8 / 122 / 129 | 84.6 / 118 / 123 |
| getMonthlyBudget mid-history (-60 mo) | cumulative | 50k | 226 / 235 / 269 (n=91) | 161 / 229 / 240 (n=120) | 166 / 237 / 244 (n=104) | 164 / 226 / 251 (n=118) |
| getMonthlyBudget mid-history (-60 mo) | cumulative | 100k | 350 / 428 / 526 (n=56) | 343 / 502 / 531 (n=54) | 346 / 402 / 415 (n=58) | 351 / 500 / 542 (n=51) |
| getMonthlyBudget mid-history (-60 mo) | cumulative | 150k |  |  |  | 411 / 423 / 514 (n=49) |
| getMonthlyBudget month switch (alternating) | cumulative | 5k | 9.65 / 12.1 / 14.3 | 9.67 / 11.8 / 14.2 | 9.63 / 11.7 / 15.3 | 9.77 / 12.0 / 14.6 |
| getMonthlyBudget month switch (alternating) | cumulative | 10k | 35.8 / 56.1 / 60.4 | 36.0 / 54.2 / 54.5 | 48.6 / 54.9 / 70.4 | 36.1 / 53.4 / 58.2 |
| getMonthlyBudget month switch (alternating) | cumulative | 25k | 194 / 215 / 217 (n=104) | 182 / 210 / 217 (n=118) | 138 / 194 / 203 (n=128) | 138 / 187 / 193 (n=136) |
| getMonthlyBudget month switch (alternating) | cumulative | 50k | 410 / 441 / 451 (n=49) | 414 / 426 / 447 (n=51) | 297 / 419 / 428 (n=61) | 290 / 409 / 415 (n=63) |
| getMonthlyBudget month switch (alternating) | cumulative | 100k | 587 / 838 / 891 (n=33) | 578 / 761 / 841 (n=34) | 583 / 617 / 669 (n=35) | 583 / 901 / 921 (n=33) |
| getMonthlyBudget month switch (alternating) | cumulative | 150k |  |  |  | 690 / 717 / 782 (n=29) |
| getReadyToAssign | cumulative | 5k | 89.2 / 92.9 / 112 | 89.8 / 94.1 / 97.1 | 3.16 / 3.35 / 3.44 | 3.18 / 3.48 / 3.74 |
| getReadyToAssign | cumulative | 10k | 322 / 337 / 423 (n=62) | 323 / 351 / 397 (n=62) | 11.2 / 13.2 / 20.5 | 11.3 / 12.7 / 15.6 |
| getReadyToAssign | cumulative | 25k | 1.5 s / 2.3 s / 2.3 s (n=13) | 2.3 s / 2.5 s / 2.5 s (n=9) | 29.2 / 38.6 / 42.2 | 37.0 / 39.8 / 41.9 |
| getReadyToAssign | cumulative | 50k | 9.3 s / 9.3 s / 9.3 s (n=3) | 9.6 s / 9.7 s / 9.7 s (n=3) | 73.1 / 75.2 / 90.8 | 99.2 / 106 / 110 |
| getReadyToAssign | cumulative | 100k | 31.0 s / 31.0 s / 31.0 s (n=1) | 24.7 s / 24.7 s / 24.7 s (n=1) | 145 / 163 / 195 (n=136) | 208 / 220 / 228 (n=100) |
| getReadyToAssign | cumulative | 150k |  |  |  | 166 / 171 / 183 (n=120) |
| getReadyToAssignBreakdown | cumulative | 5k | 120 / 176 / 183 (n=173) | 123 / 172 / 175 (n=171) | 3.13 / 3.51 / 3.77 | 3.14 / 3.27 / 3.38 |
| getReadyToAssignBreakdown | cumulative | 10k | 323 / 334 / 419 (n=62) | 322 / 348 / 436 (n=62) | 11.3 / 13.7 / 14.0 | 11.4 / 14.2 / 21.2 |
| getReadyToAssignBreakdown | cumulative | 25k | 1.5 s / 1.6 s / 1.6 s (n=14) | 2.4 s / 2.5 s / 2.5 s (n=9) | 29.0 / 31.5 / 33.1 | 37.0 / 40.1 / 41.3 |
| getReadyToAssignBreakdown | cumulative | 50k | 9.7 s / 10.1 s / 10.1 s (n=3) | 9.8 s / 9.9 s / 9.9 s (n=3) | 73.9 / 84.1 / 106 | 103 / 108 / 113 (n=194) |
| getReadyToAssignBreakdown | cumulative | 100k | 34.1 s / 34.1 s / 34.1 s (n=1) | 25.4 s / 25.4 s / 25.4 s (n=1) | 148 / 217 / 234 (n=128) | 154 / 234 / 240 (n=110) |
| getReadyToAssignBreakdown | cumulative | 150k |  |  |  | 168 / 176 / 209 (n=119) |
| register page (200 rows, first) | - | 5k | 15.8 / 17.1 / 17.3 | 16.1 / 17.3 / 17.7 | 2.52 / 2.99 / 3.71 | 2.49 / 3.55 / 3.90 |
| register page (200 rows, first) | - | 10k | 34.4 / 44.2 / 53.0 | 35.4 / 58.0 / 59.8 | 4.52 / 6.14 / 6.78 | 4.67 / 6.42 / 6.99 |
| register page (200 rows, first) | - | 25k | 71.7 / 86.5 / 106 | 123 / 133 / 137 (n=175) | 4.82 / 5.46 / 5.78 | 6.09 / 6.92 / 7.24 |
| register page (200 rows, first) | - | 50k | 115 / 180 / 189 (n=163) | 117 / 194 / 196 (n=143) | 4.92 / 5.84 / 7.27 | 7.85 / 9.19 / 11.8 |
| register page (200 rows, first) | - | 100k | 227 / 248 / 266 (n=98) | 160 / 236 / 253 (n=114) | 8.55 / 9.97 / 12.7 | 8.42 / 9.57 / 12.8 |
| register page (200 rows, 10 pages deep) | - | 5k | 12.6 / 13.9 / 14.8 | 8.12 / 8.77 / 9.11 | 2.50 / 2.91 / 3.06 | 2.43 / 2.83 / 3.01 |
| register page (200 rows, 10 pages deep) | - | 10k | 29.2 / 32.1 / 37.2 | 48.3 / 50.5 / 51.5 | 6.58 / 7.88 / 8.24 | 4.47 / 6.26 / 8.09 |
| register page (200 rows, 10 pages deep) | - | 25k | 80.0 / 104 / 142 | 120 / 129 / 146 (n=185) | 4.94 / 5.63 / 6.14 | 6.34 / 7.24 / 7.60 |
| register page (200 rows, 10 pages deep) | - | 50k | 199 / 218 / 219 (n=105) | 124 / 187 / 217 (n=153) | 4.94 / 6.40 / 8.56 | 7.81 / 8.77 / 9.11 |
| register page (200 rows, 10 pages deep) | - | 100k | 249 / 395 / 396 (n=69) | 277 / 404 / 416 (n=67) | 5.51 / 8.69 / 9.32 | 8.05 / 9.16 / 9.65 |
| full register getTransactionsByAccount (main checking) | - | 5k | 165 / 175 / 202 (n=121) | 165 / 175 / 192 (n=122) | 36.7 / 38.7 / 42.7 | 36.3 / 38.6 / 42.3 |
| full register getTransactionsByAccount (main checking) | - | 10k | 650 / 1.1 s / 1.1 s (n=29) | 1.0 s / 1.1 s / 1.1 s (n=21) | 166 / 182 / 213 (n=130) | 126 / 188 / 194 (n=143) |
| full register getTransactionsByAccount (main checking) | - | 25k | 3.0 s / 4.6 s / 4.6 s (n=6) | 2.9 s / 3.1 s / 3.1 s (n=7) | 301 / 470 / 493 (n=59) | 262 / 374 / 412 (n=72) |
| full register getTransactionsByAccount (main checking) | - | 50k | 8.7 s / 9.8 s / 9.8 s (n=3) | 11.3 s / 11.6 s / 11.6 s (n=2) | 796 / 936 / 984 (n=27) | 782 / 922 / 937 (n=27) |
| full register getTransactionsByAccount (main checking) | - | 100k | 30.8 s / 30.8 s / 30.8 s (n=1) | 29.0 s / 29.0 s / 29.0 s (n=1) | 1.4 s / 1.8 s / 1.8 s (n=14) | 1.3 s / 1.8 s / 1.8 s (n=15) |
| listAccounts | - | 5k | 5.64 / 5.90 / 6.67 | 5.55 / 5.73 / 6.27 | 3.82 / 4.06 / 4.27 | 3.85 / 4.11 / 4.39 |
| listAccounts | - | 10k | 13.0 / 13.9 / 14.8 | 13.3 / 15.7 / 27.1 | 17.7 / 18.4 / 19.2 | 13.3 / 18.7 / 19.7 |
| listAccounts | - | 25k | 32.0 / 37.3 / 45.5 | 33.6 / 42.7 / 49.3 | 34.1 / 34.8 / 35.6 | 34.5 / 36.8 / 38.2 |
| listAccounts | - | 50k | 124 / 128 / 130 (n=175) | 89.9 / 125 / 140 | 127 / 139 / 146 (n=165) | 90.3 / 104 / 133 |
| listAccounts | - | 100k | 195 / 265 / 299 (n=98) | 193 / 227 / 259 (n=102) | 278 / 299 / 299 (n=78) | 190 / 205 / 237 (n=104) |
| getAllTransactionsDetailed | - | 5k | 322 / 419 / 484 (n=60) | 318 / 353 / 381 (n=62) | 65.7 / 73.9 / 79.8 | 67.1 / 75.4 / 84.2 |
| getAllTransactionsDetailed | - | 10k | 1.3 s / 1.6 s / 1.6 s (n=16) | 1.5 s / 2.2 s / 2.2 s (n=13) | 240 / 350 / 399 (n=74) | 322 / 353 / 397 (n=68) |
| getAllTransactionsDetailed | - | 25k | 8.7 s / 8.9 s / 8.9 s (n=3) | 9.6 s / 11.1 s / 11.1 s (n=3) | 706 / 1.1 s / 1.1 s (n=24) | 618 / 875 / 893 (n=30) |
| getAllTransactionsDetailed | - | 50k | 39.2 s / 39.2 s / 39.2 s (n=1) | 34.7 s / 34.7 s / 34.7 s (n=1) | 1.7 s / 2.3 s / 2.3 s (n=12) | 2.0 s / 2.2 s / 2.2 s (n=11) |
| getAllTransactionsDetailed | - | 100k | 150.7 s / 150.7 s / 150.7 s (n=1) | 163.1 s / 163.1 s / 163.1 s (n=1) | 3.4 s / 3.7 s / 3.7 s (n=6) | 3.2 s / 4.0 s / 4.0 s (n=7) |
| getAllTransactionsAnalytics | - | 5k | 87.0 / 131 / 138 | 88.2 / 133 / 143 | 81.0 / 118 / 122 | 83.5 / 121 / 125 |
| getAllTransactionsAnalytics | - | 10k | 218 / 345 / 363 (n=83) | 219 / 309 / 372 (n=87) | 211 / 251 / 321 (n=93) | 218 / 286 / 323 (n=88) |
| getAllTransactionsAnalytics | - | 25k | 909 / 978 / 980 (n=24) | 1.1 s / 1.1 s / 1.1 s (n=21) | 618 / 1.0 s / 1.0 s (n=29) | 535 / 770 / 793 (n=34) |
| getAllTransactionsAnalytics | - | 50k | 1.5 s / 2.2 s / 2.2 s (n=12) | 1.4 s / 2.4 s / 2.4 s (n=14) | 1.3 s / 2.0 s / 2.0 s (n=14) | 1.3 s / 1.9 s / 1.9 s (n=15) |
| getAllTransactionsAnalytics | - | 100k | 4.1 s / 4.2 s / 4.2 s (n=5) | 3.5 s / 3.7 s / 3.7 s (n=6) | 2.6 s / 3.6 s / 3.6 s (n=7) | 2.8 s / 3.9 s / 3.9 s (n=7) |
| getAllTransactions | - | 5k | 55.0 / 59.0 / 61.1 | 56.4 / 64.2 / 79.1 | 56.6 / 85.5 / 86.3 | 55.9 / 58.8 / 69.3 |
| getAllTransactions | - | 10k | 144 / 212 / 244 (n=127) | 137 / 198 / 228 (n=131) | 195 / 209 / 239 (n=115) | 140 / 211 / 224 (n=126) |
| getAllTransactions | - | 25k | 588 / 631 / 645 (n=37) | 380 / 678 / 690 (n=48) | 402 / 640 / 709 (n=43) | 336 / 503 / 536 (n=53) |
| getAllTransactions | - | 50k | 805 / 1.2 s / 1.4 s (n=24) | 836 / 1.3 s / 1.5 s (n=21) | 976 / 1.3 s / 1.3 s (n=20) | 838 / 1.1 s / 1.3 s (n=23) |
| getAllTransactions | - | 100k | 1.7 s / 2.4 s / 2.4 s (n=11) | 1.7 s / 2.3 s / 2.3 s (n=12) | 1.8 s / 2.5 s / 2.5 s (n=11) | 1.6 s / 2.3 s / 2.3 s (n=12) |
| payeesWithUsage | - | 5k | 6.74 / 9.70 / 10.5 | 6.58 / 7.28 / 10.5 | 6.59 / 6.79 / 8.42 | 6.56 / 6.86 / 9.75 |
| payeesWithUsage | - | 10k | 13.2 / 16.9 / 23.6 | 19.3 / 20.7 / 27.5 | 14.6 / 22.1 / 24.1 | 14.0 / 17.4 / 23.2 |
| payeesWithUsage | - | 25k | 39.5 / 42.7 / 46.1 | 27.8 / 35.3 / 40.0 | 39.6 / 42.6 / 43.3 | 28.9 / 40.6 / 41.7 |
| payeesWithUsage | - | 50k | 56.9 / 70.3 / 93.4 | 80.2 / 88.4 / 92.4 | 80.5 / 87.9 / 93.6 | 58.8 / 82.2 / 85.7 |
| payeesWithUsage | - | 100k | 153 / 191 / 228 (n=132) | 113 / 194 / 225 (n=158) | 171 / 176 / 181 (n=119) | 123 / 165 / 193 (n=146) |
| labelsWithUsage | - | 5k | 0.16 / 0.16 / 0.17 | 0.16 / 0.18 / 0.19 | 0.16 / 0.20 / 0.27 | 0.16 / 0.16 / 0.17 |
| labelsWithUsage | - | 10k | 0.35 / 0.38 / 0.47 | 0.57 / 0.60 / 0.64 | 0.44 / 0.50 / 0.59 | 0.38 / 0.70 / 1.18 |
| labelsWithUsage | - | 25k | 1.15 / 1.26 / 1.35 | 0.79 / 0.88 / 0.92 | 1.33 / 2.09 / 2.17 | 0.81 / 0.94 / 1.08 |
| labelsWithUsage | - | 50k | 2.58 / 2.97 / 3.84 | 3.99 / 4.72 / 5.51 | 4.11 / 4.54 / 4.87 | 3.87 / 4.30 / 4.49 |
| labelsWithUsage | - | 100k | 5.95 / 6.31 / 6.78 | 5.70 / 6.12 / 7.34 | 9.57 / 10.1 / 10.3 | 9.85 / 10.8 / 11.7 |
| dash: onBudgetBalanceByDates (30d) | - | 5k | 4.11 / 4.27 / 5.82 | 4.09 / 4.20 / 4.49 | 4.24 / 4.45 / 4.92 | 4.17 / 4.33 / 4.39 |
| dash: onBudgetBalanceByDates (30d) | - | 10k | 9.40 / 18.7 / 19.3 | 12.1 / 13.0 / 13.4 | 13.2 / 21.0 / 22.5 | 10.2 / 13.1 / 20.9 |
| dash: onBudgetBalanceByDates (30d) | - | 25k | 27.2 / 29.1 / 29.7 | 20.1 / 21.2 / 22.2 | 27.8 / 30.3 / 31.5 | 21.6 / 24.8 / 30.6 |
| dash: onBudgetBalanceByDates (30d) | - | 50k | 54.9 / 65.4 / 93.5 | 76.9 / 81.6 / 84.2 | 75.8 / 80.0 / 82.3 | 78.4 / 81.4 / 82.3 |
| dash: onBudgetBalanceByDates (30d) | - | 100k | 123 / 177 / 206 (n=146) | 126 / 174 / 192 (n=144) | 167 / 170 / 173 (n=120) | 172 / 176 / 179 (n=116) |
| dash: spendingByDatesByCategories (30d) | - | 5k | 2.06 / 2.11 / 2.17 | 2.07 / 2.13 / 2.38 | 2.07 / 2.27 / 2.32 | 2.09 / 2.13 / 2.15 |
| dash: spendingByDatesByCategories (30d) | - | 10k | 5.57 / 6.10 / 6.29 | 7.09 / 7.74 / 8.05 | 7.63 / 7.96 / 8.10 | 6.06 / 8.31 / 12.4 |
| dash: spendingByDatesByCategories (30d) | - | 25k | 15.2 / 21.1 / 21.4 | 14.8 / 15.3 / 16.7 | 19.9 / 21.8 / 24.1 | 15.5 / 22.7 / 26.5 |
| dash: spendingByDatesByCategories (30d) | - | 50k | 41.9 / 45.8 / 48.6 | 59.9 / 61.9 / 64.9 | 61.1 / 63.2 / 64.1 | 62.2 / 63.8 / 68.6 |
| dash: spendingByDatesByCategories (30d) | - | 100k | 125 / 129 / 132 (n=161) | 125 / 128 / 134 (n=161) | 122 / 134 / 142 (n=163) | 133 / 145 / 153 (n=153) |
| dash: incomeExpenseByPeriod (30d, week) | - | 5k | 3.05 / 3.08 / 3.11 | 3.06 / 3.22 / 3.34 | 3.08 / 4.01 / 4.34 | 3.10 / 3.15 / 3.20 |
| dash: incomeExpenseByPeriod (30d, week) | - | 10k | 7.10 / 7.71 / 13.5 | 9.13 / 9.80 / 10.6 | 9.84 / 10.7 / 11.2 | 8.54 / 15.7 / 16.5 |
| dash: incomeExpenseByPeriod (30d, week) | - | 25k | 17.1 / 23.1 / 27.3 | 17.6 / 19.7 / 23.1 | 17.6 / 18.2 / 18.8 | 18.0 / 18.9 / 20.6 |
| dash: incomeExpenseByPeriod (30d, week) | - | 50k | 46.6 / 68.3 / 80.0 | 45.6 / 60.6 / 70.2 | 68.9 / 70.1 / 77.5 | 69.4 / 71.7 / 72.0 |
| dash: incomeExpenseByPeriod (30d, week) | - | 100k | 138 / 143 / 148 (n=145) | 139 / 150 / 157 (n=144) | 134 / 153 / 157 (n=150) | 144 / 163 / 190 (n=147) |
| dash: allAccountsMonthlyTransactions (30 accts) | - | 5k | 10.3 / 10.4 / 10.8 | 10.5 / 11.1 / 12.9 | 10.2 / 12.6 / 12.8 | 6.43 / 9.28 / 11.8 |
| dash: allAccountsMonthlyTransactions (30 accts) | - | 10k | 29.6 / 44.9 / 53.6 | 46.7 / 49.7 / 51.2 | 18.8 / 19.9 / 21.4 | 12.0 / 15.2 / 18.7 |
| dash: allAccountsMonthlyTransactions (30 accts) | - | 25k | 131 / 175 / 220 (n=148) | 132 / 220 / 227 (n=144) | 21.7 / 32.6 / 36.5 | 21.2 / 23.0 / 24.1 |
| dash: allAccountsMonthlyTransactions (30 accts) | - | 50k | 613 / 699 / 702 (n=33) | 637 / 788 / 988 (n=31) | 64.4 / 66.7 / 67.6 | 62.4 / 64.0 / 68.8 |
| dash: allAccountsMonthlyTransactions (30 accts) | - | 100k | 3.5 s / 3.6 s / 3.6 s (n=6) | 3.8 s / 3.9 s / 3.9 s (n=6) | 73.2 / 80.5 / 107 | 85.1 / 117 / 163 |
| dash: onBudgetBalance | - | 5k | 1.43 / 1.44 / 1.45 | 1.45 / 1.74 / 2.81 | 1.43 / 1.51 / 1.62 | 1.47 / 1.67 / 1.76 |
| dash: onBudgetBalance | - | 10k | 3.44 / 3.84 / 4.24 | 4.42 / 4.77 / 4.93 | 4.78 / 5.16 / 5.36 | 3.52 / 5.68 / 7.33 |
| dash: onBudgetBalance | - | 25k | 7.98 / 8.48 / 8.76 | 11.7 / 12.0 / 12.6 | 10.5 / 12.9 / 15.2 | 8.43 / 11.6 / 12.0 |
| dash: onBudgetBalance | - | 50k | 24.2 / 26.7 / 34.3 | 24.2 / 45.0 / 46.0 | 33.5 / 35.0 / 35.7 | 33.6 / 35.1 / 35.3 |
| dash: onBudgetBalance | - | 100k | 69.1 / 72.9 / 76.1 | 73.4 / 76.7 / 77.7 | 67.5 / 88.4 / 93.8 | 51.1 / 86.0 / 94.0 |
| getMonthlyBudget current | monthly | 5k | 87.9 / 93.1 / 113 | 90.5 / 132 / 133 | 86.8 / 139 / 142 | 89.0 / 126 / 135 |
| getMonthlyBudget current | monthly | 10k | 222 / 325 / 332 (n=78) | 367 / 424 / 426 (n=54) | 328 / 374 / 457 (n=68) | 253 / 333 / 352 (n=75) |
| getMonthlyBudget current | monthly | 25k | 943 / 1.1 s / 1.1 s (n=24) | 935 / 991 / 1.0 s (n=24) | 663 / 1.0 s / 1.1 s (n=28) | 655 / 1.0 s / 1.1 s (n=30) |
| getMonthlyBudget current | monthly | 50k | 1.5 s / 2.1 s / 2.1 s (n=13) | 1.4 s / 1.9 s / 1.9 s (n=14) | 1.5 s / 2.3 s / 2.3 s (n=12) | 1.6 s / 2.3 s / 2.3 s (n=12) |
| getMonthlyBudget current | monthly | 100k | 4.3 s / 4.4 s / 4.4 s (n=5) | 4.5 s / 4.8 s / 4.8 s (n=5) | 3.0 s / 4.4 s / 4.4 s (n=6) | 2.9 s / 4.3 s / 4.3 s (n=7) |
| getMonthlyBudget current | monthly | 150k |  |  |  | 3.3 s / 3.4 s / 3.4 s (n=7) |
| getMonthlyBudget mid-history (-60 mo) | monthly | 5k | 48.6 / 52.4 / 66.8 | 69.6 / 75.2 / 83.6 | 49.7 / 74.5 / 82.0 | 49.3 / 53.5 / 78.1 |
| getMonthlyBudget mid-history (-60 mo) | monthly | 10k | 184 / 193 / 204 (n=110) | 185 / 206 / 233 (n=108) | 175 / 193 / 205 (n=126) | 126 / 199 / 226 (n=141) |
| getMonthlyBudget mid-history (-60 mo) | monthly | 25k | 475 / 546 / 564 (n=46) | 341 / 521 / 543 (n=53) | 481 / 531 / 628 (n=46) | 343 / 503 / 521 (n=50) |
| getMonthlyBudget mid-history (-60 mo) | monthly | 50k | 1.0 s / 1.0 s / 1.0 s (n=20) | 1.0 s / 1.1 s / 1.1 s (n=23) | 764 / 1.0 s / 1.0 s (n=24) | 711 / 1.0 s / 1.1 s (n=26) |
| getMonthlyBudget mid-history (-60 mo) | monthly | 100k | 2.2 s / 2.3 s / 2.3 s (n=10) | 2.2 s / 2.4 s / 2.4 s (n=10) | 1.5 s / 2.2 s / 2.2 s (n=13) | 1.5 s / 1.8 s / 1.8 s (n=14) |
| getMonthlyBudget mid-history (-60 mo) | monthly | 150k |  |  |  | 1.7 s / 1.8 s / 1.8 s (n=12) |
| getMonthlyBudget month switch (alternating) | monthly | 5k | 88.3 / 132 / 139 (n=199) | 87.7 / 132 / 136 | 86.6 / 93.1 / 107 | 102 / 135 / 150 (n=185) |
| getMonthlyBudget month switch (alternating) | monthly | 10k | 230 / 375 / 409 (n=75) | 224 / 346 / 361 (n=81) | 221 / 335 / 387 (n=84) | 224 / 318 / 350 (n=84) |
| getMonthlyBudget month switch (alternating) | monthly | 25k | 741 / 963 / 966 (n=26) | 931 / 953 / 961 (n=25) | 730 / 998 / 1.0 s (n=26) | 651 / 938 / 939 (n=27) |
| getMonthlyBudget month switch (alternating) | monthly | 50k | 2.1 s / 2.1 s / 2.1 s (n=11) | 1.4 s / 1.7 s / 1.7 s (n=14) | 2.2 s / 2.3 s / 2.3 s (n=10) | 1.5 s / 1.9 s / 1.9 s (n=13) |
| getMonthlyBudget month switch (alternating) | monthly | 100k | 4.4 s / 4.5 s / 4.5 s (n=5) | 4.3 s / 4.4 s / 4.4 s (n=5) | 3.5 s / 4.4 s / 4.4 s (n=6) | 4.3 s / 4.4 s / 4.4 s (n=5) |
| getMonthlyBudget month switch (alternating) | monthly | 150k |  |  |  | 3.2 s / 3.3 s / 3.3 s (n=7) |
| getReadyToAssign | monthly | 5k | 188 / 193 / 229 (n=107) | 189 / 193 / 201 (n=106) | 84.2 / 90.6 / 96.5 | 84.2 / 90.2 / 98.9 |
| getReadyToAssign | monthly | 10k | 756 / 797 / 801 (n=28) | 518 / 678 / 682 (n=38) | 214 / 325 / 355 (n=81) | 213 / 322 / 337 (n=90) |
| getReadyToAssign | monthly | 25k | 1.9 s / 2.7 s / 2.7 s (n=10) | 1.8 s / 2.6 s / 2.6 s (n=10) | 623 / 866 / 874 (n=31) | 621 / 857 / 935 (n=30) |
| getReadyToAssign | monthly | 50k | 10.3 s / 10.5 s / 10.5 s (n=2) | 10.5 s / 10.7 s / 10.7 s (n=2) | 2.0 s / 2.0 s / 2.0 s (n=11) | 1.9 s / 2.0 s / 2.0 s (n=13) |
| getReadyToAssign | monthly | 100k | 37.5 s / 37.5 s / 37.5 s (n=1) | 38.4 s / 38.4 s / 38.4 s (n=1) | 3.0 s / 4.1 s / 4.1 s (n=7) | 2.7 s / 3.3 s / 3.3 s (n=8) |
| getReadyToAssign | monthly | 150k |  |  |  | 3.0 s / 3.1 s / 3.1 s (n=7) |
| getReadyToAssignBreakdown | monthly | 5k | 188 / 203 / 272 (n=104) | 188 / 195 / 222 (n=106) | 87.3 / 130 / 132 | 86.3 / 102 / 130 |
| getReadyToAssignBreakdown | monthly | 10k | 738 / 750 / 765 (n=28) | 514 / 904 / 949 (n=34) | 326 / 347 / 378 (n=61) | 321 / 348 / 419 (n=64) |
| getReadyToAssignBreakdown | monthly | 25k | 1.8 s / 1.9 s / 1.9 s (n=12) | 2.3 s / 2.5 s / 2.5 s (n=9) | 601 / 909 / 953 (n=30) | 628 / 890 / 937 (n=28) |
| getReadyToAssignBreakdown | monthly | 50k | 10.1 s / 10.1 s / 10.1 s (n=2) | 10.5 s / 10.6 s / 10.6 s (n=2) | 1.5 s / 2.0 s / 2.0 s (n=13) | 1.9 s / 2.0 s / 2.0 s (n=11) |
| getReadyToAssignBreakdown | monthly | 100k | 38.7 s / 38.7 s / 38.7 s (n=1) | 30.8 s / 30.8 s / 30.8 s (n=1) | 2.7 s / 3.0 s / 3.0 s (n=8) | 2.9 s / 4.0 s / 4.0 s (n=7) |
| getReadyToAssignBreakdown | monthly | 150k |  |  |  | 3.0 s / 3.0 s / 3.0 s (n=7) |


## Appendix C: persist path

| case | mode | size | old p50 / p95 / p99 (ms) | main p50 / p95 / p99 (ms) | queries p50 / p95 / p99 (ms) | combined p50 / p95 / p99 (ms) |
|---|---|---|---|---|---|---|
| db.export() [main thread] | - | 5k | 0.86 / 2.84 / 3.95 (n=100) | 0.97 / 1.83 / 3.15 (n=100) | 1.11 / 3.10 / 4.31 (n=100) | 0.92 / 2.55 / 4.24 (n=100) |
| db.export() [main thread] | - | 10k | 1.33 / 4.12 / 5.10 (n=100) | 1.86 / 4.63 / 6.69 (n=100) | 1.52 / 4.53 / 5.75 (n=100) | 1.60 / 4.35 / 5.94 (n=100) |
| db.export() [main thread] | - | 25k | 4.04 / 9.34 / 14.1 (n=100) | 3.75 / 9.31 / 10.3 (n=100) | 2.27 / 6.52 / 7.23 (n=100) | 3.13 / 8.67 / 9.38 (n=100) |
| db.export() [main thread] | - | 50k | 6.11 / 14.0 / 15.2 (n=100) | 7.69 / 18.4 / 23.0 (n=100) | 9.66 / 19.4 / 21.4 (n=100) | 10.4 / 20.5 / 22.9 (n=100) |
| db.export() [main thread] | - | 100k | 12.3 / 28.9 / 33.4 (n=100) | 14.9 / 30.8 / 40.5 (n=100) | 12.7 / 29.9 / 32.3 (n=100) | 15.9 / 31.9 / 37.0 (n=100) |
| LZ4 compress [main thread, JS] | - | 5k | 14.9 / 19.9 / 22.3 (n=100) | 14.5 / 17.3 / 20.9 (n=100) | 14.5 / 18.3 / 20.0 (n=100) | 14.6 / 17.9 / 19.9 (n=100) |
| LZ4 compress [main thread, JS] | - | 10k | 58.5 / 70.2 / 76.3 (n=100) | 58.5 / 72.5 / 76.0 (n=100) | 40.2 / 64.4 / 73.0 (n=100) | 42.3 / 64.4 / 81.0 (n=100) |
| LZ4 compress [main thread, JS] | - | 25k | 74.9 / 93.6 / 98.7 (n=100) | 78.5 / 122 / 131 (n=100) | 74.2 / 118 / 130 (n=100) | 82.1 / 120 / 124 (n=100) |
| LZ4 compress [main thread, JS] | - | 50k | 181 / 195 / 197 (n=100) | 129 / 186 / 199 (n=100) | 170 / 194 / 197 (n=100) | 149 / 195 / 198 (n=100) |
| LZ4 compress [main thread, JS] | - | 100k | 335 / 348 / 366 (n=62) | 230 / 335 / 373 (n=83) | 236 / 263 / 335 (n=84) | 336 / 350 / 356 (n=61) |
| compressAndEncryptDatabase (LZ4 + AES-GCM, AES off-thread in browsers) | - | 5k | 16.7 / 20.2 / 20.8 (n=100) | 16.2 / 19.4 / 19.9 (n=100) | 16.7 / 21.0 / 23.6 (n=100) | 16.4 / 20.0 / 20.5 (n=100) |
| compressAndEncryptDatabase (LZ4 + AES-GCM, AES off-thread in browsers) | - | 10k | 63.3 / 76.4 / 78.3 (n=100) | 64.3 / 76.6 / 79.1 (n=100) | 42.3 / 53.5 / 59.3 (n=100) | 42.7 / 54.8 / 60.7 (n=100) |
| compressAndEncryptDatabase (LZ4 + AES-GCM, AES off-thread in browsers) | - | 25k | 85.6 / 133 / 134 (n=100) | 78.7 / 125 / 133 (n=100) | 79.0 / 99.3 / 139 (n=100) | 86.1 / 127 / 130 (n=100) |
| compressAndEncryptDatabase (LZ4 + AES-GCM, AES off-thread in browsers) | - | 50k | 189 / 212 / 214 (n=100) | 181 / 208 / 213 (n=100) | 143 / 198 / 216 (n=100) | 176 / 216 / 223 (n=100) |
| compressAndEncryptDatabase (LZ4 + AES-GCM, AES off-thread in browsers) | - | 100k | 358 / 379 / 396 (n=61) | 271 / 374 / 380 (n=70) | 351 / 373 / 389 (n=61) | 293 / 374 / 386 (n=65) |
| persist main-thread total (export + LZ4 + Blob copy) | - | 5k | 15.8 / 21.3 / 22.1 (n=100) | 16.1 / 20.3 / 22.1 (n=100) | 16.0 / 20.6 / 23.7 (n=100) | 16.3 / 22.2 / 23.1 (n=100) |
| persist main-thread total (export + LZ4 + Blob copy) | - | 10k | 63.8 / 78.1 / 80.6 (n=100) | 64.3 / 75.4 / 77.6 (n=100) | 42.0 / 54.2 / 60.8 (n=100) | 62.2 / 74.1 / 77.5 (n=100) |
| persist main-thread total (export + LZ4 + Blob copy) | - | 25k | 123 / 130 / 135 (n=100) | 86.8 / 129 / 131 (n=100) | 79.2 / 123 / 127 (n=100) | 81.4 / 113 / 121 (n=100) |
| persist main-thread total (export + LZ4 + Blob copy) | - | 50k | 146 / 210 / 218 (n=100) | 198 / 214 / 221 (n=100) | 145 / 170 / 189 (n=100) | 188 / 215 / 217 (n=100) |
| persist main-thread total (export + LZ4 + Blob copy) | - | 100k | 355 / 371 / 381 (n=60) | 251 / 298 / 329 (n=79) | 259 / 369 / 380 (n=71) | 261 / 365 / 368 (n=70) |


## Appendix D: P19 suite (parts and reads after edits), every size x core

| case | mode | size | old p50 / p95 / p99 (ms) | main p50 / p95 / p99 (ms) | queries p50 / p95 / p99 (ms) | combined p50 / p95 / p99 (ms) |
|---|---|---|---|---|---|---|
| [old SQL] cte activity_month (=M) | cumulative | 5k | 0.40 / 0.43 / 0.47 | 0.20 / 0.20 / 0.22 | 0.20 / 0.22 / 0.25 | 0.20 / 0.23 / 0.28 |
| [old SQL] cte activity_month (=M) | cumulative | 10k | 0.66 / 0.70 / 0.73 | 0.66 / 0.71 / 0.75 | 0.67 / 0.72 / 0.74 | 0.68 / 0.71 / 0.74 |
| [old SQL] cte activity_month (=M) | cumulative | 25k | 0.57 / 0.70 / 0.78 | 0.60 / 0.72 / 0.77 | 0.99 / 1.36 / 1.38 | 1.12 / 1.25 / 1.31 |
| [old SQL] cte activity_month (=M) | cumulative | 50k | 1.15 / 1.98 / 2.16 | 1.86 / 2.07 / 2.25 | 1.12 / 2.18 / 2.29 | 1.12 / 1.58 / 1.71 |
| [old SQL] cte activity_month (=M) | cumulative | 100k | 1.93 / 2.49 / 2.96 | 1.80 / 2.00 / 2.28 | 1.75 / 1.96 / 2.10 | 2.64 / 2.83 / 3.02 |
| [old SQL] cte activity_month (=M) | cumulative | 150k |  |  |  | 1.75 / 1.83 / 1.90 |
| [old SQL] cte activity_prior (<M, all history) | cumulative | 5k | 5.98 / 6.43 / 6.78 | 4.28 / 4.37 / 4.46 | 4.22 / 4.28 / 4.41 | 4.41 / 4.70 / 4.74 |
| [old SQL] cte activity_prior (<M, all history) | cumulative | 10k | 16.4 / 17.2 / 18.0 | 14.2 / 22.3 / 22.8 | 16.6 / 17.4 / 17.6 | 16.5 / 16.9 / 17.1 |
| [old SQL] cte activity_prior (<M, all history) | cumulative | 25k | 30.2 / 31.8 / 43.3 | 30.5 / 43.9 / 45.5 | 42.0 / 43.6 / 44.0 | 42.4 / 43.9 / 45.2 |
| [old SQL] cte activity_prior (<M, all history) | cumulative | 50k | 74.8 / 86.6 / 98.5 | 108 / 117 / 118 | 83.9 / 115 / 132 | 107 / 112 / 123 |
| [old SQL] cte activity_prior (<M, all history) | cumulative | 100k | 168 / 221 / 245 (n=116) | 172 / 295 / 301 (n=104) | 166 / 213 / 251 (n=118) | 242 / 256 / 275 (n=83) |
| [old SQL] cte activity_prior (<M, all history) | cumulative | 150k |  |  |  | 194 / 205 / 238 (n=154) |
| [old SQL] cte transaction_counts (all-time, delete dialog only) | cumulative | 5k | 4.33 / 4.58 / 5.42 | 2.82 / 2.94 / 3.12 | 2.79 / 2.87 / 2.96 | 2.97 / 3.14 / 3.17 |
| [old SQL] cte transaction_counts (all-time, delete dialog only) | cumulative | 10k | 11.0 / 11.4 / 11.7 | 7.57 / 8.67 / 10.2 | 10.9 / 11.5 / 11.8 | 10.9 / 12.0 / 12.5 |
| [old SQL] cte transaction_counts (all-time, delete dialog only) | cumulative | 25k | 17.5 / 18.2 / 18.3 | 17.6 / 18.3 / 18.6 | 18.4 / 25.8 / 26.5 | 25.6 / 26.5 / 26.7 |
| [old SQL] cte transaction_counts (all-time, delete dialog only) | cumulative | 50k | 37.4 / 42.0 / 56.0 | 53.3 / 57.0 / 57.9 | 40.3 / 56.0 / 71.0 | 54.0 / 55.9 / 56.6 |
| [old SQL] cte transaction_counts (all-time, delete dialog only) | cumulative | 100k | 80.9 / 127 / 150 | 83.1 / 97.8 / 116 | 117 / 123 / 127 (n=186) | 120 / 123 / 127 (n=167) |
| [old SQL] cte transaction_counts (all-time, delete dialog only) | cumulative | 150k |  |  |  | 98.1 / 105 / 121 |
| [old SQL] cte assignment_totals (assigned + assigned_prior) | cumulative | 5k | 2.97 / 3.14 / 3.21 | 2.16 / 2.29 / 2.32 | 2.12 / 2.14 / 2.15 | 2.07 / 2.23 / 2.27 |
| [old SQL] cte assignment_totals (assigned + assigned_prior) | cumulative | 10k | 5.86 / 6.27 / 6.51 | 3.88 / 4.37 / 5.22 | 5.66 / 5.93 / 6.03 | 5.61 / 6.30 / 6.72 |
| [old SQL] cte assignment_totals (assigned + assigned_prior) | cumulative | 25k | 6.32 / 6.62 / 6.96 | 6.25 / 6.45 / 6.61 | 6.58 / 7.15 / 7.66 | 8.71 / 9.37 / 9.57 |
| [old SQL] cte assignment_totals (assigned + assigned_prior) | cumulative | 50k | 8.72 / 9.26 / 10.2 | 12.1 / 12.6 / 12.9 | 9.11 / 12.0 / 19.0 | 12.1 / 13.4 / 13.7 |
| [old SQL] cte assignment_totals (assigned + assigned_prior) | cumulative | 100k | 10.7 / 11.6 / 12.9 | 11.3 / 15.8 / 19.6 | 15.7 / 16.7 / 17.2 | 16.1 / 17.0 / 18.3 |
| [old SQL] cte assignment_totals (assigned + assigned_prior) | cumulative | 150k |  |  |  | 8.79 / 9.01 / 9.24 |
| queries.getMonthlyBudget (main SQL) | cumulative | 5k | 14.4 / 14.8 / 14.9 | 10.6 / 11.7 / 16.1 | 10.7 / 21.0 / 21.9 | 11.0 / 16.7 / 20.6 |
| queries.getMonthlyBudget (main SQL) | cumulative | 10k | 35.5 / 37.0 / 37.7 | 25.2 / 27.6 / 34.7 | 34.9 / 36.8 / 38.6 | 34.9 / 35.9 / 36.4 |
| queries.getMonthlyBudget (main SQL) | cumulative | 25k | 56.9 / 64.8 / 80.6 | 56.9 / 78.1 / 79.9 | 59.5 / 74.3 / 89.7 | 82.1 / 87.2 / 87.9 |
| queries.getMonthlyBudget (main SQL) | cumulative | 50k | 126 / 145 / 167 | 182 / 187 / 191 | 134 / 170 / 191 | 181 / 187 / 190 |
| queries.getMonthlyBudget (main SQL) | cumulative | 100k | 254 / 291 / 323 (n=78) | 384 / 406 / 406 (n=52) | 395 / 405 / 406 (n=53) | 401 / 409 / 422 (n=51) |
| queries.getMonthlyBudget (main SQL) | cumulative | 150k |  |  |  | 310 / 320 / 372 (n=97) |
| getActivityByAccountKind (cumulative) | cumulative | 5k | 0.48 / 0.55 / 0.63 | 0.25 / 0.27 / 0.33 | 0.52 / 0.56 / 0.60 | 0.25 / 0.26 / 0.30 |
| getActivityByAccountKind (cumulative) | cumulative | 10k | 0.78 / 0.82 / 0.82 | 0.44 / 0.93 / 0.97 | 0.81 / 0.89 / 0.94 | 0.78 / 0.83 / 0.86 |
| getActivityByAccountKind (cumulative) | cumulative | 25k | 0.76 / 0.86 / 0.93 | 1.33 / 1.45 / 1.52 | 0.84 / 0.91 / 1.06 | 1.35 / 1.41 / 1.47 |
| getActivityByAccountKind (cumulative) | cumulative | 50k | 1.34 / 1.57 / 1.84 | 2.16 / 2.28 / 2.55 | 1.42 / 1.65 / 2.23 | 1.99 / 2.19 / 2.25 |
| getActivityByAccountKind (cumulative) | cumulative | 100k | 2.27 / 2.56 / 3.13 | 3.53 / 3.77 / 3.91 | 3.36 / 3.54 / 3.61 | 3.55 / 3.71 / 3.81 |
| getActivityByAccountKind (cumulative) | cumulative | 150k |  |  |  | 2.27 / 2.36 / 2.39 |
| getActivityByAccountKind (monthly: ledger window) | cumulative | 5k | 19.6 / 21.1 / 22.3 | 14.3 / 14.9 / 22.2 | 14.1 / 14.5 / 20.6 | 14.2 / 14.4 / 14.6 |
| getActivityByAccountKind (monthly: ledger window) | cumulative | 10k | 54.0 / 57.5 / 59.4 | 52.6 / 74.0 / 76.8 | 54.3 / 57.0 / 57.9 | 54.6 / 56.5 / 63.8 |
| getActivityByAccountKind (monthly: ledger window) | cumulative | 25k | 93.9 / 101 / 135 | 96.2 / 144 / 146 (n=182) | 99.5 / 115 / 142 (n=198) | 148 / 153 / 157 (n=136) |
| getActivityByAccountKind (monthly: ledger window) | cumulative | 50k | 227 / 338 / 347 | 338 / 365 / 388 (n=197) | 343 / 355 / 388 (n=193) | 349 / 365 / 369 (n=177) |
| getActivityByAccountKind (monthly: ledger window) | cumulative | 100k | 471 / 672 / 710 (n=37) | 467 / 493 / 567 (n=43) | 694 / 711 / 714 (n=29) | 720 / 763 / 788 (n=28) |
| getActivityByAccountKind (monthly: ledger window) | cumulative | 150k |  |  |  | 555 / 588 / 626 (n=54) |
| CC: getCCPaymentAdjustments (2 sums per card) | cumulative | 5k | 0.65 / 0.66 / 0.69 | 0.66 / 0.67 / 0.69 | 0.65 / 0.66 / 0.69 | 0.65 / 0.67 / 0.71 |
| CC: getCCPaymentAdjustments (2 sums per card) | cumulative | 10k | 2.61 / 2.83 / 2.94 | 2.53 / 2.77 / 2.83 | 2.52 / 2.79 / 2.87 | 1.43 / 1.58 / 1.82 |
| CC: getCCPaymentAdjustments (2 sums per card) | cumulative | 25k | 3.99 / 4.22 / 4.32 | 4.09 / 6.41 / 6.70 | 4.23 / 4.65 / 5.38 | 6.61 / 7.07 / 7.95 |
| CC: getCCPaymentAdjustments (2 sums per card) | cumulative | 50k | 17.8 / 22.5 / 23.7 | 12.1 / 13.4 / 15.2 | 13.9 / 21.5 / 22.6 | 17.0 / 18.5 / 18.8 |
| CC: getCCPaymentAdjustments (2 sums per card) | cumulative | 100k | 30.4 / 35.7 / 38.8 | 22.6 / 24.2 / 25.4 | 30.8 / 32.7 / 34.1 | 23.5 / 34.5 / 36.8 |
| CC: getCCPaymentAdjustments (2 sums per card) | cumulative | 150k |  |  |  | 26.0 / 27.1 / 27.8 |
| CC: getCCSpendingByCategoryAndAccount (=M and <M) | cumulative | 5k | 1.02 / 1.05 / 1.09 | 1.04 / 1.07 / 1.11 | 1.03 / 1.05 / 1.08 | 1.03 / 1.06 / 1.09 |
| CC: getCCSpendingByCategoryAndAccount (=M and <M) | cumulative | 10k | 7.19 / 8.05 / 9.30 | 7.13 / 7.67 / 8.11 | 7.18 / 7.71 / 9.45 | 4.98 / 5.73 / 6.40 |
| CC: getCCSpendingByCategoryAndAccount (=M and <M) | cumulative | 25k | 59.6 / 85.2 / 91.8 | 59.8 / 62.0 / 81.2 | 94.5 / 99.0 / 111 | 93.2 / 96.1 / 98.3 |
| CC: getCCSpendingByCategoryAndAccount (=M and <M) | cumulative | 50k | 197 / 203 / 215 | 127 / 143 / 175 | 132 / 153 / 201 | 191 / 204 / 208 |
| CC: getCCSpendingByCategoryAndAccount (=M and <M) | cumulative | 100k | 258 / 381 / 384 (n=70) | 252 / 407 / 413 (n=69) | 386 / 396 / 405 (n=52) | 255 / 293 / 331 (n=78) |
| CC: getCCSpendingByCategoryAndAccount (=M and <M) | cumulative | 150k |  |  |  | 299 / 318 / 342 (n=100) |
| CC: getCCAccountBalances | cumulative | 5k | 0.79 / 0.81 / 0.82 | 0.80 / 0.81 / 0.84 | 0.82 / 0.83 / 0.84 | 0.82 / 0.84 / 0.85 |
| CC: getCCAccountBalances | cumulative | 10k | 3.98 / 4.27 / 4.42 | 4.11 / 4.45 / 4.89 | 3.99 / 4.31 / 4.40 | 2.68 / 2.92 / 3.13 |
| CC: getCCAccountBalances | cumulative | 25k | 8.83 / 9.30 / 9.67 | 8.82 / 9.27 / 9.36 | 9.21 / 9.97 / 10.7 | 14.0 / 14.8 / 15.2 |
| CC: getCCAccountBalances | cumulative | 50k | 37.8 / 39.9 / 41.2 | 22.7 / 41.5 / 42.7 | 24.1 / 31.9 / 36.3 | 36.0 / 37.5 / 39.7 |
| CC: getCCAccountBalances | cumulative | 100k | 72.6 / 78.8 / 81.4 | 73.5 / 76.4 / 79.5 | 74.3 / 77.2 / 78.0 | 44.9 / 59.8 / 68.2 |
| CC: getCCAccountBalances | cumulative | 150k |  |  |  | 52.1 / 54.0 / 55.8 |
| CC: getCCAccountPaymentCategoryMap | cumulative | 5k | 0.04 / 0.04 / 0.05 | 0.04 / 0.05 / 0.05 | 0.04 / 0.05 / 0.05 | 0.04 / 0.05 / 0.05 |
| CC: getCCAccountPaymentCategoryMap | cumulative | 10k | 0.12 / 0.13 / 0.13 | 0.12 / 0.13 / 0.13 | 0.12 / 0.13 / 0.14 | 0.05 / 0.06 / 0.06 |
| CC: getCCAccountPaymentCategoryMap | cumulative | 25k | 0.05 / 0.06 / 0.08 | 0.05 / 0.06 / 0.06 | 0.06 / 0.09 / 0.10 | 0.12 / 0.14 / 0.15 |
| CC: getCCAccountPaymentCategoryMap | cumulative | 50k | 0.12 / 0.13 / 0.15 | 0.05 / 0.06 / 0.09 | 0.05 / 0.07 / 0.08 | 0.11 / 0.12 / 0.13 |
| CC: getCCAccountPaymentCategoryMap | cumulative | 100k | 0.12 / 0.14 / 0.15 | 0.12 / 0.13 / 0.14 | 0.12 / 0.14 / 0.15 | 0.05 / 0.07 / 0.09 |
| CC: getCCAccountPaymentCategoryMap | cumulative | 150k |  |  |  | 0.03 / 0.04 / 0.05 |
| CC: getAssignedPriorToMonth x cards | cumulative | 5k | 0.41 / 0.42 / 0.43 | 0.41 / 0.42 / 0.44 | 0.41 / 0.42 / 0.44 | 0.41 / 0.42 / 0.43 |
| CC: getAssignedPriorToMonth x cards | cumulative | 10k | 0.93 / 0.99 / 1.04 | 0.90 / 0.94 / 0.99 | 0.91 / 1.04 / 1.12 | 0.50 / 0.74 / 0.83 |
| CC: getAssignedPriorToMonth x cards | cumulative | 25k | 0.48 / 0.51 / 0.53 | 0.48 / 0.52 / 0.54 | 0.50 / 0.69 / 0.81 | 1.00 / 1.07 / 1.19 |
| CC: getAssignedPriorToMonth x cards | cumulative | 50k | 0.94 / 1.01 / 1.14 | 0.54 / 0.82 / 0.97 | 0.47 / 0.53 / 0.63 | 0.87 / 0.92 / 0.94 |
| CC: getAssignedPriorToMonth x cards | cumulative | 100k | 1.00 / 1.10 / 1.13 | 0.91 / 0.97 / 1.01 | 0.97 / 1.03 / 1.07 | 0.51 / 0.59 / 0.64 |
| CC: getAssignedPriorToMonth x cards | cumulative | 150k |  |  |  | 0.36 / 0.39 / 0.47 |
| computeMonthlyRollforward (monthly mode, from first month) | cumulative | 5k | 57.4 / 63.3 / 66.3 | 58.2 / 66.2 / 81.8 | 59.6 / 76.0 / 91.0 | 59.4 / 62.0 / 84.3 |
| computeMonthlyRollforward (monthly mode, from first month) | cumulative | 10k | 222 / 233 / 250 (n=90) | 215 / 278 / 287 (n=98) | 177 / 238 / 244 (n=109) | 224 / 235 / 274 (n=92) |
| computeMonthlyRollforward (monthly mode, from first month) | cumulative | 25k | 415 / 619 / 674 (n=43) | 415 / 441 / 514 (n=48) | 432 / 649 / 759 (n=44) | 640 / 714 / 715 (n=34) |
| computeMonthlyRollforward (monthly mode, from first month) | cumulative | 50k | 1.3 s / 1.4 s / 1.5 s (n=52) | 1.4 s / 1.4 s / 1.5 s (n=46) | 1.0 s / 1.4 s / 1.4 s (n=55) | 1.0 s / 1.4 s / 1.5 s (n=54) |
| computeMonthlyRollforward (monthly mode, from first month) | cumulative | 100k | 2.0 s / 2.7 s / 2.7 s (n=10) | 2.3 s / 2.6 s / 2.6 s (n=9) | 1.8 s / 2.7 s / 2.7 s (n=11) | 2.2 s / 2.8 s / 2.8 s (n=10) |
| computeMonthlyRollforward (monthly mode, from first month) | cumulative | 150k |  |  |  | 2.0 s / 2.1 s / 2.1 s (n=16) |
| readyToAssign (cumulative, 5 sums) | cumulative | 5k | 131 / 134 / 168 (n=153) | 131 / 133 / 137 (n=153) | 4.58 / 4.80 / 5.04 | 4.58 / 4.73 / 4.88 |
| readyToAssign (cumulative, 5 sums) | cumulative | 10k | 473 / 481 / 512 (n=43) | 335 / 393 / 448 (n=59) | 11.2 / 20.9 / 21.6 | 14.8 / 15.6 / 15.9 |
| readyToAssign (cumulative, 5 sums) | cumulative | 25k | 1.5 s / 2.0 s / 2.0 s (n=13) | 1.5 s / 1.6 s / 1.6 s (n=14) | 29.3 / 31.4 / 52.2 | 44.4 / 45.7 / 46.4 |
| readyToAssign (cumulative, 5 sums) | cumulative | 50k | 9.5 s / 9.7 s / 9.7 s (n=7) | 6.8 s / 7.1 s / 7.1 s (n=9) | 100 / 104 / 107 | 99.0 / 105 / 116 |
| readyToAssign (cumulative, 5 sums) | cumulative | 100k | 23.9 s / 23.9 s / 23.9 s (n=1) | 23.3 s / 23.3 s / 23.3 s (n=1) | 202 / 227 / 252 (n=98) | 149 / 199 / 241 (n=129) |
| readyToAssign (cumulative, 5 sums) | cumulative | 150k |  |  |  | 167 / 176 / 211 (n=178) |
| readyToAssignMonthlyBatch (monthly, incl. rollforward) | cumulative | 5k | 188 / 192 / 206 (n=108) | 189 / 227 / 265 (n=105) | 83.5 / 85.4 / 129 | 83.4 / 85.3 / 89.9 |
| readyToAssignMonthlyBatch (monthly, incl. rollforward) | cumulative | 10k | 521 / 751 / 818 (n=35) | 596 / 981 / 982 (n=28) | 308 / 335 / 353 (n=72) | 225 / 342 / 397 (n=80) |
| readyToAssignMonthlyBatch (monthly, incl. rollforward) | cumulative | 25k | 2.1 s / 2.7 s / 2.7 s (n=9) | 1.9 s / 2.0 s / 2.0 s (n=11) | 609 / 1.0 s / 1.0 s (n=29) | 612 / 937 / 943 (n=27) |
| readyToAssignMonthlyBatch (monthly, incl. rollforward) | cumulative | 50k | 12.8 s / 13.0 s / 13.0 s (n=5) | 7.5 s / 10.6 s / 10.6 s (n=8) | 1.7 s / 2.0 s / 2.1 s (n=37) | 1.9 s / 2.4 s / 2.4 s (n=33) |
| readyToAssignMonthlyBatch (monthly, incl. rollforward) | cumulative | 100k | 25.1 s / 25.1 s / 25.1 s (n=1) | 36.8 s / 36.8 s / 36.8 s (n=1) | 3.0 s / 4.0 s / 4.0 s (n=6) | 3.9 s / 4.0 s / 4.0 s (n=6) |
| readyToAssignMonthlyBatch (monthly, incl. rollforward) | cumulative | 150k |  |  |  | 2.7 s / 2.9 s / 2.9 s (n=12) |
| getMonthlyBudget current after current-month tx edit | cumulative | 5k | 13.5 / 14.3 / 17.6 | 13.4 / 14.4 / 17.6 | 20.1 / 21.0 / 21.5 | 14.1 / 14.6 / 15.2 |
| getMonthlyBudget current after current-month tx edit | cumulative | 10k | 36.2 / 50.1 / 54.0 | 50.8 / 64.5 / 66.2 | 35.7 / 47.9 / 61.2 | 36.4 / 51.6 / 52.8 |
| getMonthlyBudget current after current-month tx edit | cumulative | 25k | 188 / 204 / 209 (n=106) | 135 / 190 / 198 (n=142) | 142 / 212 / 218 (n=118) | 139 / 153 / 223 (n=141) |
| getMonthlyBudget current after current-month tx edit | cumulative | 50k | 544 / 574 / 582 (n=122) | 436 / 591 / 597 (n=140) | 313 / 418 / 538 (n=183) | 548 / 560 / 569 (n=128) |
| getMonthlyBudget current after current-month tx edit | cumulative | 100k | 609 / 902 / 920 (n=28) | 583 / 903 / 948 (n=31) | 871 / 887 / 914 (n=24) | 855 / 915 / 1.1 s (n=28) |
| getMonthlyBudget current after current-month tx edit | cumulative | 150k |  |  |  | 548 / 621 / 623 (n=55) |
| getReadyToAssign after current-month tx edit | cumulative | 5k | 116 / 119 / 128 (n=173) | 118 / 120 / 134 (n=171) | 6.16 / 6.62 / 7.38 | 4.81 / 5.10 / 6.86 |
| getReadyToAssign after current-month tx edit | cumulative | 10k | 508 / 556 / 568 (n=44) | 459 / 468 / 482 (n=44) | 11.3 / 17.9 / 20.6 | 11.4 / 14.2 / 19.7 |
| getReadyToAssign after current-month tx edit | cumulative | 25k | 2.1 s / 2.3 s / 2.3 s (n=10) | 1.5 s / 1.6 s / 1.6 s (n=14) | 40.4 / 46.2 / 50.2 | 29.2 / 46.6 / 50.7 |
| getReadyToAssign after current-month tx edit | cumulative | 50k | 9.3 s / 10.2 s / 10.2 s (n=7) | 6.9 s / 9.1 s / 9.1 s (n=8) | 78.4 / 108 / 112 | 125 / 137 / 138 |
| getReadyToAssign after current-month tx edit | cumulative | 100k | 34.7 s / 34.7 s / 34.7 s (n=1) | 23.1 s / 23.1 s / 23.1 s (n=1) | 212 / 220 / 231 (n=95) | 150 / 182 / 207 (n=130) |
| getReadyToAssign after current-month tx edit | cumulative | 150k |  |  |  | 124 / 137 / 148 |
| getReadyToAssignBreakdown after current-month tx edit | cumulative | 5k | 115 / 121 / 138 (n=177) | 117 / 124 / 135 (n=175) | 4.77 / 4.97 / 5.09 | 4.81 / 5.08 / 5.14 |
| getReadyToAssignBreakdown after current-month tx edit | cumulative | 10k | 533 / 550 / 553 (n=38) | 461 / 467 / 469 (n=44) | 11.4 / 13.1 / 15.1 | 11.5 / 13.8 / 20.8 |
| getReadyToAssignBreakdown after current-month tx edit | cumulative | 25k | 2.2 s / 2.2 s / 2.2 s (n=10) | 2.0 s / 2.0 s / 2.0 s (n=11) | 41.6 / 45.3 / 45.7 | 29.3 / 34.0 / 41.5 |
| getReadyToAssignBreakdown after current-month tx edit | cumulative | 50k | 6.7 s / 8.8 s / 8.8 s (n=9) | 9.1 s / 9.3 s / 9.3 s (n=7) | 105 / 113 / 135 | 73.8 / 80.6 / 109 |
| getReadyToAssignBreakdown after current-month tx edit | cumulative | 100k | 34.7 s / 34.7 s / 34.7 s (n=1) | 23.0 s / 23.0 s / 23.0 s (n=1) | 213 / 221 / 239 (n=104) | 207 / 219 / 269 (n=96) |
| getReadyToAssignBreakdown after current-month tx edit | cumulative | 150k |  |  |  | 127 / 161 / 166 |
| getMonthlyBudget current after assignment | cumulative | 5k | 12.4 / 13.0 / 13.0 | 12.6 / 13.0 / 13.0 | 14.1 / 15.6 / 17.4 | 14.0 / 14.3 / 14.6 |
| getMonthlyBudget current after assignment | cumulative | 10k | 57.7 / 59.7 / 60.6 | 52.7 / 55.8 / 56.1 | 35.2 / 37.9 / 41.8 | 35.4 / 42.5 / 51.2 |
| getMonthlyBudget current after assignment | cumulative | 25k | 183 / 199 / 203 (n=108) | 183 / 196 / 199 (n=109) | 196 / 218 / 221 (n=113) | 140 / 155 / 184 (n=141) |
| getMonthlyBudget current after assignment | cumulative | 50k | 416 / 442 / 457 (n=144) | 315 / 444 / 494 (n=172) | 313 / 451 / 563 (n=176) | 330 / 566 / 572 (n=160) |
| getMonthlyBudget current after assignment | cumulative | 100k | 948 / 967 / 976 (n=22) | 582 / 818 / 855 (n=33) | 892 / 1.1 s / 1.1 s (n=23) | 881 / 886 / 919 (n=26) |
| getMonthlyBudget current after assignment | cumulative | 150k |  |  |  | 514 / 546 / 588 (n=58) |
| getReadyToAssign after assignment | cumulative | 5k | 113 / 121 / 132 (n=177) | 109 / 121 / 130 (n=178) | 4.70 / 4.83 / 4.90 | 4.83 / 5.00 / 5.13 |
| getReadyToAssign after assignment | cumulative | 10k | 525 / 571 / 699 (n=38) | 463 / 487 / 496 (n=43) | 11.2 / 13.1 / 16.0 | 11.3 / 12.1 / 15.3 |
| getReadyToAssign after assignment | cumulative | 25k | 2.0 s / 2.0 s / 2.0 s (n=11) | 1.4 s / 1.9 s / 1.9 s (n=13) | 42.4 / 44.2 / 44.7 | 29.8 / 32.3 / 34.1 |
| getReadyToAssign after assignment | cumulative | 50k | 8.9 s / 10.1 s / 10.1 s (n=7) | 7.0 s / 9.2 s / 9.2 s (n=8) | 79.3 / 134 / 147 | 101 / 105 / 107 |
| getReadyToAssign after assignment | cumulative | 100k | 37.8 s / 37.8 s / 37.8 s (n=1) | 36.5 s / 36.5 s / 36.5 s (n=1) | 201 / 213 / 243 (n=99) | 150 / 177 / 202 (n=130) |
| getReadyToAssign after assignment | cumulative | 150k |  |  |  | 123 / 130 / 142 |
| getReadyToAssignBreakdown after assignment | cumulative | 5k | 108 / 112 / 131 (n=185) | 108 / 111 / 144 (n=184) | 4.69 / 4.80 / 6.39 | 4.87 / 5.07 / 5.27 |
| getReadyToAssignBreakdown after assignment | cumulative | 10k | 476 / 504 / 529 (n=42) | 492 / 497 / 498 (n=41) | 11.1 / 21.1 / 22.7 | 11.3 / 12.1 / 16.5 |
| getReadyToAssignBreakdown after assignment | cumulative | 25k | 1.9 s / 2.1 s / 2.1 s (n=11) | 1.3 s / 1.4 s / 1.4 s (n=15) | 42.1 / 43.7 / 44.6 | 29.5 / 38.1 / 43.3 |
| getReadyToAssignBreakdown after assignment | cumulative | 50k | 9.7 s / 9.9 s / 9.9 s (n=7) | 6.5 s / 8.0 s / 8.0 s (n=9) | 79.9 / 138 / 181 | 100 / 105 / 106 |
| getReadyToAssignBreakdown after assignment | cumulative | 100k | 34.8 s / 34.8 s / 34.8 s (n=1) | 37.6 s / 37.6 s / 37.6 s (n=1) | 208 / 214 / 215 (n=97) | 151 / 169 / 199 (n=131) |
| getReadyToAssignBreakdown after assignment | cumulative | 150k |  |  |  | 123 / 129 / 151 |
| getMonthlyBudget current after back-dated (5y) edit | cumulative | 5k | 11.3 / 12.1 / 12.2 | 11.4 / 12.1 / 12.9 | 13.8 / 15.2 / 19.0 | 14.1 / 16.3 / 18.2 |
| getMonthlyBudget current after back-dated (5y) edit | cumulative | 10k | 52.5 / 54.7 / 62.6 | 55.7 / 58.7 / 60.5 | 52.0 / 54.1 / 54.8 | 52.2 / 54.3 / 55.0 |
| getMonthlyBudget current after back-dated (5y) edit | cumulative | 25k | 169 / 179 / 181 (n=118) | 117 / 122 / 139 (n=169) | 142 / 214 / 237 (n=122) | 205 / 214 / 218 (n=106) |
| getMonthlyBudget current after back-dated (5y) edit | cumulative | 50k | 414 / 470 / 487 (n=160) | 293 / 367 / 453 (n=198) | 454 / 471 / 475 (n=133) | 434 / 456 / 464 (n=140) |
| getMonthlyBudget current after back-dated (5y) edit | cumulative | 100k | 889 / 948 / 960 (n=26) | 950 / 964 / 965 (n=22) | 875 / 885 / 908 (n=23) | 607 / 913 / 922 (n=30) |
| getMonthlyBudget current after back-dated (5y) edit | cumulative | 150k |  |  |  | 510 / 543 / 576 (n=59) |
| getReadyToAssign after back-dated (5y) edit | cumulative | 5k | 108 / 112 / 134 (n=185) | 109 / 114 / 135 (n=184) | 4.77 / 4.95 / 5.02 | 4.82 / 4.99 / 5.12 |
| getReadyToAssign after back-dated (5y) edit | cumulative | 10k | 479 / 499 / 555 (n=43) | 481 / 490 / 496 (n=42) | 14.7 / 15.7 / 16.1 | 14.7 / 15.8 / 16.7 |
| getReadyToAssign after back-dated (5y) edit | cumulative | 25k | 1.8 s / 1.9 s / 1.9 s (n=11) | 1.3 s / 1.4 s / 1.4 s (n=16) | 29.1 / 32.0 / 38.0 | 37.5 / 42.3 / 44.8 |
| getReadyToAssign after back-dated (5y) edit | cumulative | 50k | 9.2 s / 9.4 s / 9.4 s (n=7) | 6.6 s / 6.9 s / 6.9 s (n=10) | 102 / 109 / 112 | 94.8 / 102 / 107 |
| getReadyToAssign after back-dated (5y) edit | cumulative | 100k | 34.0 s / 34.0 s / 34.0 s (n=1) | 34.7 s / 34.7 s / 34.7 s (n=1) | 200 / 220 / 234 (n=104) | 206 / 220 / 225 (n=107) |
| getReadyToAssign after back-dated (5y) edit | cumulative | 150k |  |  |  | 122 / 129 / 130 |
| getReadyToAssignBreakdown after back-dated (5y) edit | cumulative | 5k | 108 / 151 / 206 (n=179) | 108 / 161 / 216 (n=172) | 4.77 / 5.00 / 5.06 | 4.80 / 4.94 / 5.08 |
| getReadyToAssignBreakdown after back-dated (5y) edit | cumulative | 10k | 474 / 478 / 484 (n=43) | 468 / 479 / 485 (n=43) | 15.2 / 16.4 / 17.0 | 15.0 / 16.4 / 16.9 |
| getReadyToAssignBreakdown after back-dated (5y) edit | cumulative | 25k | 1.8 s / 1.9 s / 1.9 s (n=12) | 1.3 s / 1.4 s / 1.4 s (n=16) | 29.1 / 34.7 / 43.7 | 37.7 / 41.3 / 42.2 |
| getReadyToAssignBreakdown after back-dated (5y) edit | cumulative | 50k | 9.2 s / 10.2 s / 10.2 s (n=7) | 6.8 s / 10.4 s / 10.4 s (n=9) | 97.0 / 105 / 109 | 98.5 / 109 / 112 |
| getReadyToAssignBreakdown after back-dated (5y) edit | cumulative | 100k | 32.7 s / 32.7 s / 32.7 s (n=1) | 33.7 s / 33.7 s / 33.7 s (n=1) | 204 / 219 / 221 (n=108) | 157 / 275 / 277 (n=99) |
| getReadyToAssignBreakdown after back-dated (5y) edit | cumulative | 150k |  |  |  | 123 / 128 / 132 |
| getActivityByAccountKind (monthly: ledger window) | monthly | 5k | 16.3 / 18.9 / 22.6 | 16.1 / 21.8 / 25.1 | 14.1 / 16.3 / 21.3 | 14.3 / 15.0 / 15.1 |
| getActivityByAccountKind (monthly: ledger window) | monthly | 10k | 37.7 / 57.3 / 58.0 | 52.9 / 59.1 / 61.3 | 54.9 / 57.0 / 57.6 | 52.1 / 54.5 / 57.1 |
| getActivityByAccountKind (monthly: ledger window) | monthly | 25k | 122 / 124 / 134 (n=166) | 84.8 / 88.1 / 108 | 99.5 / 152 / 154 (n=176) | 150 / 155 / 157 (n=134) |
| getActivityByAccountKind (monthly: ledger window) | monthly | 50k | 230 / 367 / 379 | 357 / 373 / 386 (n=192) | 332 / 370 / 384 | 324 / 358 / 373 |
| getActivityByAccountKind (monthly: ledger window) | monthly | 100k | 475 / 720 / 729 (n=36) | 484 / 766 / 768 (n=38) | 470 / 497 / 600 (n=43) | 465 / 648 / 716 (n=41) |
| getActivityByAccountKind (monthly: ledger window) | monthly | 150k |  |  |  | 416 / 433 / 468 (n=72) |
| computeMonthlyRollforward (monthly mode, from first month) | monthly | 5k | 66.0 / 96.1 / 98.9 | 93.2 / 98.0 / 102 | 57.7 / 64.4 / 67.5 | 60.1 / 87.9 / 90.8 |
| computeMonthlyRollforward (monthly mode, from first month) | monthly | 10k | 206 / 235 / 252 (n=106) | 143 / 226 / 232 (n=124) | 146 / 230 / 239 (n=114) | 219 / 224 / 244 (n=99) |
| computeMonthlyRollforward (monthly mode, from first month) | monthly | 25k | 560 / 583 / 587 (n=38) | 550 / 579 / 579 (n=41) | 431 / 692 / 727 (n=40) | 423 / 630 / 669 (n=43) |
| computeMonthlyRollforward (monthly mode, from first month) | monthly | 50k | 877 / 1.1 s / 1.4 s (n=66) | 885 / 1.4 s / 1.4 s (n=60) | 1.3 s / 1.5 s / 1.5 s (n=48) | 888 / 1.4 s / 1.5 s (n=56) |
| computeMonthlyRollforward (monthly mode, from first month) | monthly | 100k | 1.7 s / 2.8 s / 2.8 s (n=12) | 2.4 s / 2.8 s / 2.8 s (n=9) | 1.8 s / 2.1 s / 2.1 s (n=11) | 1.7 s / 2.2 s / 2.2 s (n=11) |
| computeMonthlyRollforward (monthly mode, from first month) | monthly | 150k |  |  |  | 1.5 s / 1.5 s / 1.6 s (n=21) |
| readyToAssignMonthlyBatch (monthly, incl. rollforward) | monthly | 5k | 305 / 312 / 336 (n=68) | 232 / 274 / 307 (n=85) | 83.1 / 88.1 / 105 | 84.7 / 125 / 132 |
| readyToAssignMonthlyBatch (monthly, incl. rollforward) | monthly | 10k | 498 / 596 / 710 (n=40) | 489 / 596 / 674 (n=40) | 209 / 324 / 358 (n=85) | 311 / 323 / 327 (n=72) |
| readyToAssignMonthlyBatch (monthly, incl. rollforward) | monthly | 25k | 1.6 s / 1.7 s / 1.7 s (n=13) | 1.6 s / 2.0 s / 2.0 s (n=13) | 955 / 1.0 s / 1.0 s (n=24) | 589 / 928 / 932 (n=32) |
| readyToAssignMonthlyBatch (monthly, incl. rollforward) | monthly | 50k | 10.7 s / 11.4 s / 11.4 s (n=7) | 7.1 s / 11.4 s / 11.4 s (n=8) | 1.3 s / 1.9 s / 2.1 s (n=40) | 1.9 s / 2.2 s / 2.2 s (n=34) |
| readyToAssignMonthlyBatch (monthly, incl. rollforward) | monthly | 100k | 24.5 s / 24.5 s / 24.5 s (n=1) | 35.8 s / 35.8 s / 35.8 s (n=1) | 2.6 s / 3.0 s / 3.0 s (n=8) | 2.5 s / 3.4 s / 3.4 s (n=8) |
| readyToAssignMonthlyBatch (monthly, incl. rollforward) | monthly | 150k |  |  |  | 2.2 s / 2.3 s / 2.3 s (n=14) |
| getMonthlyBudget current after current-month tx edit | monthly | 5k | 117 / 150 / 162 (n=161) | 101 / 126 / 164 (n=193) | 84.9 / 87.6 / 98.6 | 86.7 / 124 / 124 |
| getMonthlyBudget current after current-month tx edit | monthly | 10k | 223 / 331 / 382 (n=78) | 214 / 318 / 333 (n=86) | 220 / 333 / 447 (n=86) | 243 / 355 / 413 (n=74) |
| getMonthlyBudget current after current-month tx edit | monthly | 25k | 565 / 577 / 636 (n=36) | 566 / 833 / 864 (n=35) | 662 / 824 / 840 (n=30) | 659 / 902 / 908 (n=28) |
| getMonthlyBudget current after current-month tx edit | monthly | 50k | 2.0 s / 2.0 s / 2.1 s (n=32) | 1.3 s / 2.1 s / 2.2 s (n=43) | 1.5 s / 2.1 s / 2.1 s (n=39) | 1.4 s / 1.9 s / 2.4 s (n=41) |
| getMonthlyBudget current after current-month tx edit | monthly | 100k | 3.1 s / 4.0 s / 4.0 s (n=6) | 2.8 s / 4.1 s / 4.1 s (n=7) | 3.1 s / 3.3 s / 3.3 s (n=7) | 2.9 s / 3.6 s / 3.6 s (n=7) |
| getMonthlyBudget current after current-month tx edit | monthly | 150k |  |  |  | 2.4 s / 2.5 s / 2.5 s (n=13) |
| getReadyToAssign after current-month tx edit | monthly | 5k | 221 / 311 / 316 (n=81) | 301 / 313 / 329 (n=69) | 78.6 / 82.0 / 85.7 | 76.3 / 84.4 / 88.1 |
| getReadyToAssign after current-month tx edit | monthly | 10k | 677 / 700 / 716 (n=34) | 489 / 526 / 595 (n=41) | 222 / 321 / 326 (n=85) | 323 / 337 / 381 (n=65) |
| getReadyToAssign after current-month tx edit | monthly | 25k | 1.6 s / 1.7 s / 1.7 s (n=13) | 1.6 s / 1.7 s / 1.7 s (n=13) | 650 / 886 / 897 (n=29) | 569 / 806 / 834 (n=32) |
| getReadyToAssign after current-month tx edit | monthly | 50k | 7.2 s / 9.4 s / 9.4 s (n=9) | 9.7 s / 10.8 s / 10.8 s (n=7) | 1.4 s / 2.0 s / 2.1 s (n=38) | 1.4 s / 2.1 s / 2.1 s (n=38) |
| getReadyToAssign after current-month tx edit | monthly | 100k | 32.7 s / 32.7 s / 32.7 s (n=1) | 23.0 s / 23.0 s / 23.0 s (n=1) | 3.7 s / 3.8 s / 3.8 s (n=6) | 3.7 s / 3.8 s / 3.8 s (n=6) |
| getReadyToAssign after current-month tx edit | monthly | 150k |  |  |  | 2.2 s / 2.3 s / 2.3 s (n=14) |
| getReadyToAssignBreakdown after current-month tx edit | monthly | 5k | 218 / 233 / 299 (n=91) | 305 / 319 / 338 (n=66) | 73.7 / 75.5 / 81.0 | 74.3 / 78.5 / 100 |
| getReadyToAssignBreakdown after current-month tx edit | monthly | 10k | 690 / 747 / 760 (n=32) | 488 / 543 / 718 (n=40) | 309 / 327 / 334 (n=71) | 214 / 320 / 331 (n=80) |
| getReadyToAssignBreakdown after current-month tx edit | monthly | 25k | 1.6 s / 1.7 s / 1.7 s (n=13) | 1.6 s / 1.7 s / 1.7 s (n=13) | 583 / 764 / 818 (n=34) | 648 / 876 / 878 (n=29) |
| getReadyToAssignBreakdown after current-month tx edit | monthly | 50k | 7.4 s / 10.0 s / 10.0 s (n=8) | 8.9 s / 10.1 s / 10.1 s (n=7) | 1.3 s / 2.0 s / 2.0 s (n=40) | 1.3 s / 2.0 s / 2.0 s (n=42) |
| getReadyToAssignBreakdown after current-month tx edit | monthly | 100k | 34.9 s / 34.9 s / 34.9 s (n=1) | 24.9 s / 24.9 s / 24.9 s (n=1) | 3.1 s / 3.8 s / 3.8 s (n=7) | 2.6 s / 3.6 s / 3.6 s (n=7) |
| getReadyToAssignBreakdown after current-month tx edit | monthly | 150k |  |  |  | 2.2 s / 2.3 s / 2.3 s (n=14) |
| getMonthlyBudget current after assignment | monthly | 5k | 101 / 160 / 168 (n=173) | 102 / 153 / 160 (n=168) | 71.7 / 80.0 / 91.2 | 71.3 / 79.7 / 82.7 |
| getMonthlyBudget current after assignment | monthly | 10k | 219 / 315 / 332 (n=80) | 290 / 328 / 338 (n=75) | 231 / 411 / 439 (n=77) | 217 / 420 / 447 (n=78) |
| getMonthlyBudget current after assignment | monthly | 25k | 567 / 639 / 646 (n=36) | 569 / 583 / 639 (n=35) | 996 / 1.0 s / 1.0 s (n=21) | 633 / 755 / 757 (n=31) |
| getMonthlyBudget current after assignment | monthly | 50k | 1.3 s / 1.5 s / 2.0 s (n=45) | 1.3 s / 1.5 s / 2.1 s (n=44) | 1.4 s / 2.3 s / 2.3 s (n=38) | 1.4 s / 1.9 s / 2.2 s (n=40) |
| getMonthlyBudget current after assignment | monthly | 100k | 4.0 s / 4.1 s / 4.1 s (n=6) | 2.7 s / 2.8 s / 2.8 s (n=8) | 4.1 s / 4.3 s / 4.3 s (n=5) | 2.9 s / 4.0 s / 4.0 s (n=7) |
| getMonthlyBudget current after assignment | monthly | 150k |  |  |  | 2.4 s / 2.8 s / 2.8 s (n=13) |
| getReadyToAssign after assignment | monthly | 5k | 322 / 342 / 350 (n=71) | 224 / 340 / 352 (n=81) | 75.5 / 77.7 / 82.6 | 75.5 / 77.8 / 85.0 |
| getReadyToAssign after assignment | monthly | 10k | 511 / 762 / 764 (n=34) | 520 / 700 / 815 (n=35) | 280 / 351 / 395 (n=72) | 401 / 409 / 412 (n=52) |
| getReadyToAssign after assignment | monthly | 25k | 1.6 s / 1.7 s / 1.7 s (n=13) | 2.3 s / 2.4 s / 2.4 s (n=9) | 692 / 897 / 900 (n=28) | 575 / 877 / 890 (n=31) |
| getReadyToAssign after assignment | monthly | 50k | 6.9 s / 9.8 s / 9.8 s (n=9) | 6.9 s / 8.9 s / 8.9 s (n=9) | 1.3 s / 2.1 s / 2.1 s (n=39) | 1.9 s / 2.0 s / 2.0 s (n=35) |
| getReadyToAssign after assignment | monthly | 100k | 24.6 s / 24.6 s / 24.6 s (n=1) | 25.3 s / 25.3 s / 25.3 s (n=1) | 2.8 s / 4.0 s / 4.0 s (n=7) | 2.6 s / 3.5 s / 3.5 s (n=8) |
| getReadyToAssign after assignment | monthly | 150k |  |  |  | 2.2 s / 2.3 s / 2.3 s (n=14) |
| getReadyToAssignBreakdown after assignment | monthly | 5k | 321 / 341 / 347 (n=69) | 335 / 354 / 366 (n=65) | 68.9 / 76.3 / 83.4 | 69.3 / 74.0 / 78.5 |
| getReadyToAssignBreakdown after assignment | monthly | 10k | 681 / 772 / 799 (n=32) | 526 / 713 / 732 (n=35) | 271 / 373 / 385 (n=72) | 399 / 412 / 413 (n=50) |
| getReadyToAssignBreakdown after assignment | monthly | 25k | 1.6 s / 1.7 s / 1.7 s (n=13) | 1.6 s / 1.7 s / 1.7 s (n=13) | 738 / 906 / 921 (n=27) | 573 / 877 / 881 (n=31) |
| getReadyToAssignBreakdown after assignment | monthly | 50k | 7.0 s / 9.3 s / 9.3 s (n=8) | 7.7 s / 10.1 s / 10.1 s (n=8) | 1.3 s / 2.0 s / 2.0 s (n=39) | 1.5 s / 2.1 s / 2.2 s (n=37) |
| getReadyToAssignBreakdown after assignment | monthly | 100k | 23.3 s / 23.3 s / 23.3 s (n=1) | 24.9 s / 24.9 s / 24.9 s (n=1) | 2.6 s / 3.7 s / 3.7 s (n=8) | 2.5 s / 4.2 s / 4.2 s (n=8) |
| getReadyToAssignBreakdown after assignment | monthly | 150k |  |  |  | 2.2 s / 2.4 s / 2.4 s (n=14) |
| getMonthlyBudget current after back-dated (5y) edit | monthly | 5k | 105 / 164 / 197 (n=162) | 106 / 166 / 177 (n=157) | 70.3 / 73.8 / 85.0 | 70.5 / 71.8 / 76.9 |
| getMonthlyBudget current after back-dated (5y) edit | monthly | 10k | 218 / 229 / 317 (n=91) | 317 / 336 / 349 (n=71) | 326 / 417 / 429 (n=67) | 413 / 420 / 422 (n=52) |
| getMonthlyBudget current after back-dated (5y) edit | monthly | 25k | 644 / 862 / 875 (n=29) | 575 / 658 / 664 (n=34) | 830 / 1.0 s / 1.0 s (n=25) | 634 / 862 / 965 (n=30) |
| getMonthlyBudget current after back-dated (5y) edit | monthly | 50k | 1.3 s / 2.0 s / 2.0 s (n=43) | 1.3 s / 2.0 s / 2.1 s (n=42) | 1.4 s / 2.0 s / 2.1 s (n=39) | 1.4 s / 2.0 s / 2.0 s (n=39) |
| getMonthlyBudget current after back-dated (5y) edit | monthly | 100k | 2.7 s / 3.0 s / 3.0 s (n=8) | 2.7 s / 4.0 s / 4.0 s (n=7) | 2.9 s / 3.8 s / 3.8 s (n=7) | 4.1 s / 4.6 s / 4.6 s (n=5) |
| getMonthlyBudget current after back-dated (5y) edit | monthly | 150k |  |  |  | 2.4 s / 2.5 s / 2.5 s (n=13) |
| getReadyToAssign after back-dated (5y) edit | monthly | 5k | 316 / 328 / 334 (n=66) | 228 / 332 / 340 (n=79) | 67.7 / 71.8 / 76.6 | 68.7 / 72.6 / 76.1 |
| getReadyToAssign after back-dated (5y) edit | monthly | 10k | 504 / 760 / 771 (n=37) | 491 / 529 / 798 (n=41) | 217 / 353 / 412 (n=78) | 321 / 409 / 423 (n=62) |
| getReadyToAssign after back-dated (5y) edit | monthly | 25k | 1.7 s / 2.5 s / 2.5 s (n=12) | 1.6 s / 1.7 s / 1.7 s (n=13) | 587 / 844 / 860 (n=30) | 564 / 666 / 689 (n=35) |
| getReadyToAssign after back-dated (5y) edit | monthly | 50k | 6.2 s / 7.4 s / 7.4 s (n=10) | 6.0 s / 6.6 s / 6.6 s (n=10) | 1.8 s / 2.0 s / 2.0 s (n=35) | 1.2 s / 1.8 s / 1.9 s (n=45) |
| getReadyToAssign after back-dated (5y) edit | monthly | 100k | 24.7 s / 24.7 s / 24.7 s (n=1) | 32.9 s / 32.9 s / 32.9 s (n=1) | 2.6 s / 4.2 s / 4.2 s (n=7) | 3.8 s / 4.0 s / 4.0 s (n=6) |
| getReadyToAssign after back-dated (5y) edit | monthly | 150k |  |  |  | 2.2 s / 2.3 s / 2.3 s (n=14) |
| getReadyToAssignBreakdown after back-dated (5y) edit | monthly | 5k | 309 / 339 / 369 (n=69) | 234 / 346 / 383 (n=76) | 68.4 / 69.8 / 73.5 | 68.9 / 71.5 / 76.1 |
| getReadyToAssignBreakdown after back-dated (5y) edit | monthly | 10k | 530 / 723 / 728 (n=34) | 494 / 782 / 786 (n=37) | 218 / 402 / 424 (n=76) | 219 / 343 / 357 (n=79) |
| getReadyToAssignBreakdown after back-dated (5y) edit | monthly | 25k | 1.6 s / 1.7 s / 1.7 s (n=13) | 1.6 s / 1.7 s / 1.7 s (n=13) | 594 / 882 / 917 (n=29) | 802 / 843 / 855 (n=27) |
| getReadyToAssignBreakdown after back-dated (5y) edit | monthly | 50k | 6.0 s / 6.1 s / 6.1 s (n=10) | 6.0 s / 6.1 s / 6.1 s (n=11) | 1.3 s / 2.1 s / 2.1 s (n=41) | 1.2 s / 2.0 s / 2.1 s (n=41) |
| getReadyToAssignBreakdown after back-dated (5y) edit | monthly | 100k | 25.3 s / 25.3 s / 25.3 s (n=1) | 23.9 s / 23.9 s / 23.9 s (n=1) | 3.7 s / 4.1 s / 4.1 s (n=6) | 3.7 s / 3.8 s / 3.8 s (n=6) |
| getReadyToAssignBreakdown after back-dated (5y) edit | monthly | 150k |  |  |  | 2.2 s / 2.3 s / 2.3 s (n=14) |

