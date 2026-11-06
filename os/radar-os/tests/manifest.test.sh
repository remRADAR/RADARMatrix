#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMMON="$ROOT/config/package-manifest.common.txt"
! grep -Eq '(^|[[:space:]])linux-image-(amd64|arm64)([[:space:]]|$)' "$COMMON"
grep -qx 'linux-image-amd64' "$ROOT/config/package-manifest.amd64.txt"
grep -qx 'linux-image-arm64' "$ROOT/config/package-manifest.arm64.txt"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/work"
cat > "$TMP/bin/lb" <<'SH'
#!/bin/sh
exit 0
SH
chmod +x "$TMP/bin/lb"
(
  cd "$TMP/work"
  PATH="$TMP/bin:$PATH" RADAR_OS_ARCH=amd64 "$ROOT/live/auto/config"
  grep -qx linux-image-amd64 config/package-lists/radar-architecture.list.chroot
  ! grep -qx linux-image-arm64 config/package-lists/radar-architecture.list.chroot
  PATH="$TMP/bin:$PATH" RADAR_OS_ARCH=arm64 "$ROOT/live/auto/config"
  grep -qx linux-image-arm64 config/package-lists/radar-architecture.list.chroot
  ! grep -qx linux-image-amd64 config/package-lists/radar-architecture.list.chroot
  if PATH="$TMP/bin:$PATH" env -u RADAR_OS_ARCH "$ROOT/live/auto/config" 2>/dev/null; then
    echo "expected missing architecture to fail" >&2; exit 1
  fi
)
echo "manifest tests passed: common and architecture-specific package lists are isolated and wired into Debian Live"
