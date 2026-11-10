#!/usr/bin/env bash
# Regression guard for the test harness itself.
#
# The Stage 0.1.1 defect was not in product code: `tests/test-runner.mjs` ended
# in an unconditional `process.exit(0)`, so `npm test` exited 0 while printing
# failing assertions. Any review or CI gate built on that exit code was
# meaningless.
#
# This test proves the harness cannot silently regress to fail-open. It runs the
# REAL runner against a throwaway copy of the repo with one assertion inverted,
# and requires a non-zero exit.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

WORK="$TMP/repo"
mkdir -p "$WORK"
# Copy only what the runner needs.
cp -r "$ROOT/tests" "$WORK/tests"
cp -r "$ROOT/apps" "$WORK/apps"
cp "$ROOT/package.json" "$WORK/package.json"

# --- Positive control: unmodified copy must pass with exit 0 ---
if ! (cd "$WORK" && node tests/test-runner.mjs >"$TMP/clean.log" 2>&1); then
  echo "FAIL: unmodified suite did not pass; harness is broken" >&2
  tail -20 "$TMP/clean.log" >&2
  exit 1
fi
grep -q "RESULT: PASSED" "$TMP/clean.log" || {
  echo "FAIL: clean run did not report RESULT: PASSED" >&2
  exit 1
}

# --- Negative control: one inverted assertion must fail with exit non-zero ---
python3 - "$WORK/tests/v0.7-gateway.test.mjs" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
needle = "assert.strictEqual(result, test.expected, `${test.name} failed`);"
repl = "assert.strictEqual(result, '__WRONG__' + test.expected, `${test.name} failed`);"
if needle not in s:
    raise SystemExit("FAIL: anchor assertion not found; update this regression test")
open(p, "w").write(s.replace(needle, repl, 1))
PY

if (cd "$WORK" && node tests/test-runner.mjs >"$TMP/fail.log" 2>&1); then
  echo "FAIL: runner exited 0 despite an injected assertion failure (fail-open regression)" >&2
  grep -E "RESULT|✗" "$TMP/fail.log" >&2 || true
  exit 1
fi
grep -q "RESULT: FAILED" "$TMP/fail.log" || {
  echo "FAIL: runner failed but did not report RESULT: FAILED" >&2
  exit 1
}

echo "test harness tests passed: clean run exits 0 and a single injected assertion failure exits non-zero"
