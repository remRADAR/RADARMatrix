#!/usr/bin/env bash
# Owner base-approval gate for the RADAR OS Stage 1 build.
#
# WHY THIS EXISTS
# ---------------
# The previous gate was a workflow_dispatch dropdown whose only effect was to
# compare a string the dispatcher had just selected. Anyone able to dispatch the
# workflow could select "owner-has-approved" and the build would run. That is a
# self-asserted checkbox, not an owner decision: it records nothing, it is not
# reviewable, and it cannot be audited after the fact.
#
# This gate reads a committed decision record (docs/os/DEBIAN-BASE-DECISION.json)
# that the owner approves through normal review. The record is the authority.
# The dispatch input is only a claim, and it must AGREE with the record: a
# dispatcher cannot build a base the owner did not approve, and cannot build at
# all while the record is pending.
#
# FAIL-CLOSED CONTRACT
# --------------------
# Every failure path exits non-zero and prints a single BLOCKED/FAIL line naming
# the reason. There is no path that prints a warning and continues.
#
# Usage:
#   check-owner-base-approval.sh --base trixie --snapshot 20261101T000000Z \
#       [--record docs/os/DEBIAN-BASE-DECISION.json]
set -Eeuo pipefail

BASE=""
SNAPSHOT=""
RECORD="docs/os/DEBIAN-BASE-DECISION.json"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE="${2:-}"; shift 2 ;;
    --snapshot) SNAPSHOT="${2:-}"; shift 2 ;;
    --record) RECORD="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "FAIL: unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$BASE" ]] || { echo "FAIL: --base is required" >&2; exit 2; }
[[ -n "$SNAPSHOT" ]] || { echo "FAIL: --snapshot is required" >&2; exit 2; }

# The two assessed suites. Anything else is not a decision this gate can honour.
case "$BASE" in
  trixie|bookworm) ;;
  *) echo "FAIL: base '$BASE' is not an assessed suite (trixie|bookworm)" >&2; exit 2 ;;
esac

if [[ ! -f "$RECORD" ]]; then
  echo "BLOCKED: owner base decision record is missing: $RECORD" >&2
  echo "No build was executed. The owner must approve docs/os/DEBIAN-BASE-DECISION.json." >&2
  exit 1
fi

command -v python3 >/dev/null 2>&1 || { echo "BLOCKED: python3 is required to read the decision record" >&2; exit 2; }

# The record is parsed strictly: unknown/missing fields, a non-approved status,
# a base outside the assessed set, or a base that disagrees with the dispatch
# input all fail closed. The script prints the reason and exits non-zero.
python3 - "$RECORD" "$BASE" "$SNAPSHOT" <<'PY'
import json, sys, re

record_path, want_base, want_snapshot = sys.argv[1:4]

def fail(msg):
    print(f"BLOCKED: {msg}", file=sys.stderr)
    print("No build was executed.", file=sys.stderr)
    raise SystemExit(1)

try:
    with open(record_path) as f:
        rec = json.load(f)
except Exception as e:
    fail(f"owner base decision record is not valid JSON ({e})")

if not isinstance(rec, dict):
    fail("owner base decision record must be a JSON object")

if rec.get("schema") != "radar-os-owner-base-decision/v1":
    fail(f"unexpected decision schema {rec.get('schema')!r}; expected 'radar-os-owner-base-decision/v1'")

status = rec.get("status")
if status != "approved":
    fail(f"owner base decision status is {status!r}, not 'approved'")

base = rec.get("base")
if base not in ("trixie", "bookworm"):
    fail(f"owner-approved base {base!r} is not an assessed suite (trixie|bookworm)")

# The dispatch input is a claim; it must match the approved record exactly.
# This is what stops a dispatcher from building a base the owner did not choose.
if base != want_base:
    fail(f"dispatched base {want_base!r} does not match the owner-approved base {base!r}")

snapshot = rec.get("snapshot")
if not isinstance(snapshot, str) or not re.fullmatch(r"[0-9]{8}T[0-9]{6}Z", snapshot):
    fail(f"owner-approved snapshot {snapshot!r} is not an immutable YYYYMMDDTHHMMSSZ timestamp")

if snapshot != want_snapshot:
    fail(f"dispatched snapshot {want_snapshot!r} does not match the owner-approved snapshot {snapshot!r}")

# An approval with no attributable author or reference is not an approval.
for field in ("decided_by", "decided_at_utc", "decision_ref"):
    value = rec.get(field)
    if not isinstance(value, str) or not value.strip():
        fail(f"owner base decision is missing a non-empty {field!r}")

print(f"APPROVED: base={base} snapshot={snapshot} decided_by={rec['decided_by']} ref={rec['decision_ref']}")
PY
