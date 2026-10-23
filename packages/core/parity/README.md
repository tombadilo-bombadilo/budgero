# Parity suite

Compares two core builds (or one build with an implementation toggled by an init hook) over the same seeded mutation sequence. Zero diffs allowed. Usage and what is compared: see `../bench/README.md` (Parity section) and the header of `run.mjs`.

- `run.mjs --mode cumulative|monthly` sets the starting RtaMode; ops also switch it mid-sequence.
- `invariant.mjs`: the zero-based identity (on-budget balances = Ready to Assign + Available + explicit adjustments), checked on both sides for every month and both modes; used by `run.mjs` and the budget-snapshot fuzz tests.
- `cash-invariant.mjs`: cash conservation (envelopes = cash + explicit, SQL-derived exceptions), with no CC payment, funding or overspend figure taken from the model; `cash-known.mjs` lists the open deviations it tolerates (keyed by issue; delete a key when its fix merges). Used by `run.mjs`, the budget-snapshot fuzz and `node-tests/cash-conservation.node.spec.ts`.
- `fuzz-long.sh [processes] [runs] [steps]`: the long budget-snapshot fuzz (`pnpm fuzz:snapshot:long`); the default short run is part of `pnpm test`.

Budget snapshot gate (P19): side A = the branch base without the snapshot, side B = the branch:

```sh
for mode in cumulative monthly; do for seed in $(seq 1 20); do
  node parity/run.mjs --a <base>/packages/core --b . --seed $seed --steps 300 --mode $mode
done; done
```
