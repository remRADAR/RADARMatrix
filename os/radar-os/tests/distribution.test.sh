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
echo "distribution tests passed: default trixie, explicit bookworm passthrough, unsupported suites fail closed"
