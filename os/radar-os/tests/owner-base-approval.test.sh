#!/usr/bin/env bash
# Regression tests for the owner base-approval gate.
#
# The defect this guards against: the original gate compared a workflow_dispatch
# dropdown against a literal string, so anyone able to dispatch the workflow
# could select "owner-has-approved" and build. That is a self-asserted checkbox.
# The gate now reads a committed decision record, and these tests prove it fails
# closed on every way that record can be wrong.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GATE="$ROOT/scripts/check-owner-base-approval.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }

# expect_block <name> <record-json> <base> <snapshot> <expected-substring>
expect_block() {
  local name="$1" body="$2" base="$3" snap="$4" needle="$5"
  printf '%s\n' "$body" > "$TMP/rec.json"
  local out rc=0
  out="$(bash "$GATE" --base "$base" --snapshot "$snap" --record "$TMP/rec.json" 2>&1)" || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    bad "$name (expected non-zero exit, got 0)"
  elif ! grep -qF -- "$needle" <<<"$out"; then
    bad "$name (exit $rc but message lacked '$needle'; got: $out)"
  else
    ok "$name"
  fi
}

# expect_allow <name> <record-json> <base> <snapshot>
expect_allow() {
  local name="$1" body="$2" base="$3" snap="$4"
  printf '%s\n' "$body" > "$TMP/rec.json"
  local out rc=0
  out="$(bash "$GATE" --base "$base" --snapshot "$snap" --record "$TMP/rec.json" 2>&1)" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    bad "$name (expected exit 0, got $rc: $out)"
  elif ! grep -q '^APPROVED:' <<<"$out"; then
    bad "$name (exit 0 but no APPROVED line: $out)"
  else
    ok "$name"
  fi
}

APPROVED_TRIXIE='{"schema":"radar-os-owner-base-decision/v1","status":"approved","base":"trixie","snapshot":"20261101T000000Z","decided_by":"owner","decided_at_utc":"2026-11-09T00:00:00Z","decision_ref":"issue-1"}'

echo "owner base-approval gate"

# --- The shipped record must be pending, so the gate blocks today ----------
if bash "$GATE" --base trixie --snapshot 20261101T000000Z --record "$ROOT/../docs/os/DEBIAN-BASE-DECISION.json" >/dev/null 2>&1; then
  bad "shipped decision record is pending but the gate allowed a build"
else
  ok "shipped decision record is pending and the gate blocks"
fi

# --- Happy path ------------------------------------------------------------
expect_allow "approved trixie record allows the matching dispatch" "$APPROVED_TRIXIE" trixie 20261101T000000Z

# --- Every way the record can be wrong must block -------------------------
expect_block "empty record file blocks" "" trixie 20261101T000000Z "not valid JSON"

# The helper above writes an empty file; a genuinely absent record must also
# block, and with the "missing" message rather than a JSON parse error.
rm -f "$TMP/rec.json"
if out="$(bash "$GATE" --base trixie --snapshot 20261101T000000Z --record "$TMP/rec.json" 2>&1)"; then
  bad "absent record file was accepted"
elif ! grep -qF "record is missing" <<<"$out"; then
  bad "absent record file did not report 'record is missing': $out"
else
  ok "absent record file blocks with the missing-record message"
fi

expect_block "invalid JSON blocks" '{not json' trixie 20261101T000000Z "not valid JSON"

expect_block "wrong schema blocks" \
  '{"schema":"something-else","status":"approved","base":"trixie","snapshot":"20261101T000000Z","decided_by":"o","decided_at_utc":"t","decision_ref":"r"}' \
  trixie 20261101T000000Z "unexpected decision schema"

# The core anti-self-assertion property: the dispatch input cannot override the
# record. An owner-approved trixie record must NOT permit a bookworm build.
expect_block "dispatched base disagreeing with the record blocks" \
  "$APPROVED_TRIXIE" bookworm 20261101T000000Z "does not match the owner-approved base"

expect_block "dispatched snapshot disagreeing with the record blocks" \
  "$APPROVED_TRIXIE" trixie 20261201T000000Z "does not match the owner-approved snapshot"

expect_block "unassessed base in the record blocks" \
  '{"schema":"radar-os-owner-base-decision/v1","status":"approved","base":"sid","snapshot":"20261101T000000Z","decided_by":"o","decided_at_utc":"t","decision_ref":"r"}' \
  sid 20261101T000000Z "not an assessed suite"

expect_block "mutable snapshot in the record blocks" \
  '{"schema":"radar-os-owner-base-decision/v1","status":"approved","base":"trixie","snapshot":"latest","decided_by":"o","decided_at_utc":"t","decision_ref":"r"}' \
  trixie latest "not an immutable"

expect_block "approval with no attributable author blocks" \
  '{"schema":"radar-os-owner-base-decision/v1","status":"approved","base":"trixie","snapshot":"20261101T000000Z","decided_by":"","decided_at_utc":"t","decision_ref":"r"}' \
  trixie 20261101T000000Z "missing a non-empty 'decided_by'"

expect_block "approval with no decision reference blocks" \
  '{"schema":"radar-os-owner-base-decision/v1","status":"approved","base":"trixie","snapshot":"20261101T000000Z","decided_by":"o","decided_at_utc":"t","decision_ref":"  "}' \
  trixie 20261101T000000Z "missing a non-empty 'decision_ref'"

# --- Argument validation ---------------------------------------------------
if bash "$GATE" --base trixie >/dev/null 2>&1; then
  bad "missing --snapshot was accepted"
else
  ok "missing --snapshot is rejected"
fi

echo
if [[ "$FAIL" -ne 0 ]]; then
  echo "owner-base-approval tests FAILED: $FAIL failed, $PASS passed" >&2
  exit 1
fi
echo "owner-base-approval tests passed: $PASS assertions (gate fails closed on every malformed or mismatched record)"
