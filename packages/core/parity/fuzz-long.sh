#!/usr/bin/env bash
# Long budget-snapshot fuzz: N parallel vitest processes, each a different seed
# offset, each running both fuzz files with FUZZ_RUNS runs of up to FUZZ_STEPS ops.
#   parity/fuzz-long.sh [processes=4] [runs per process and file=2500] [steps=12]
set -u
cd "$(dirname "$0")/.."
P=${1:-4}
RUNS=${2:-2500}
STEPS=${3:-12}
OUT=${FUZZ_OUT:-$(mktemp -d)}
echo "logs in $OUT"
for i in $(seq 1 "$P"); do
  FUZZ_RUNS=$RUNS FUZZ_STEPS=$STEPS FUZZ_SEED=$((i * 1000003)) FUZZ_KNOWN_FILE="$OUT/known.jsonl" \
    npx vitest run node-tests/budget-snapshot.fuzz.node.spec.ts \
    node-tests/budget-snapshot-monthly.fuzz.node.spec.ts >"$OUT/fuzz-$i.log" 2>&1 &
done
fail=0
for job in $(jobs -p); do wait "$job" || fail=1; done
grep -h "Tests " "$OUT"/fuzz-*.log
cat "$OUT/known.jsonl" 2>/dev/null
exit $fail
