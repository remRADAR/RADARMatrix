#!/usr/bin/env bash
set -Eeuo pipefail
# auto/config is invoked with an explicit "sh" prefix: the executable bit can
# be lost when files are pushed through the GitHub contents API (mode 100644).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/work"
cat > "$TMP/bin/lb" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >> "$LB_ARGS_LOG"
exit 0
SH
chmod +x "$TMP/bin/lb"
(
  cd "$TMP/work"
  # Default base is trixie.
  PATH="$TMP/bin:$PATH" LB_ARGS_LOG="$TMP/lb.log" RADAR_OS_ARCH=amd64 sh "$ROOT/live/auto/config"
  grep -q -- '--distribution trixie' "$TMP/lb.log"
  # Debian Live requires `lb config noauto`: without it auto/config re-invokes
  # itself and recurses infinitely, so no dispatched build can ever complete.
  # The emitted argv is `config noauto <options...>`, so assert both that noauto
  # is present and that it is the FIRST argument after the `config` subcommand.
  grep -q -- 'noauto' "$TMP/lb.log"
  grep -q -- '^config noauto' "$TMP/lb.log"
  # Explicit bookworm is passed through, not silently substituted.
  : > "$TMP/lb.log"
  PATH="$TMP/bin:$PATH" LB_ARGS_LOG="$TMP/lb.log" RADAR_OS_ARCH=amd64 RADAR_OS_DISTRIBUTION=bookworm sh "$ROOT/live/auto/config"
  grep -q -- '--distribution bookworm' "$TMP/lb.log"
  ! grep -q -- '--distribution trixie' "$TMP/lb.log"
  # Unsupported suites fail closed.
  if PATH="$TMP/bin:$PATH" LB_ARGS_LOG="$TMP/lb.log" RADAR_OS_ARCH=amd64 RADAR_OS_DISTRIBUTION=sid sh "$ROOT/live/auto/config" 2>/dev/null; then
    echo "expected unsupported distribution to fail" >&2; exit 1
  fi
)

# Non-vacuous control: the noauto assertion above must actually catch the
# regression. A copy of auto/config with `noauto` stripped must NOT satisfy it.
MUTANT_ROOT="$TMP/mutant"
mkdir -p "$MUTANT_ROOT/live/auto"
ln -s "$ROOT/config" "$MUTANT_ROOT/config"
sed 's/lb config noauto/lb config/' "$ROOT/live/auto/config" > "$MUTANT_ROOT/live/auto/config"
grep -q 'lb config "\$@"' "$MUTANT_ROOT/live/auto/config" || { echo "control setup failed: noauto mutation did not apply" >&2; exit 1; }
: > "$TMP/lb-mutant.log"
(
  cd "$TMP/work"
  PATH="$TMP/bin:$PATH" LB_ARGS_LOG="$TMP/lb-mutant.log" RADAR_OS_ARCH=amd64 sh "$MUTANT_ROOT/live/auto/config"
)
if grep -q -- 'noauto' "$TMP/lb-mutant.log"; then
  echo "control failed: the noauto assertion is vacuous (mutant still emitted noauto)" >&2; exit 1
fi

echo "distribution tests passed: default trixie, explicit bookworm passthrough, unsupported suites fail closed, and lb is invoked with noauto (regression-guarded)"
