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
printf '%s\n' "$*" >> "$LB_ARGS_LOG"
exit 0
SH
chmod +x "$TMP/bin/lb"
(
  cd "$TMP/work"
  PATH="$TMP/bin:$PATH" LB_ARGS_LOG="$TMP/lb-args.log" RADAR_OS_SNAPSHOT_TIMESTAMP=20261106T000000Z RADAR_OS_ARCH=amd64 "$ROOT/live/auto/config"
  grep -qx linux-image-amd64 config/package-lists/radar-architecture.list.chroot
  ! grep -qx linux-image-arm64 config/package-lists/radar-architecture.list.chroot
  grep -q -- '--bootappend-live console=tty0 console=ttyS0,115200n8 systemd.show_status=1 systemd.unit=multi-user.target' "$TMP/lb-args.log"
  grep -q -- '--mirror-bootstrap https://snapshot.debian.org/archive/debian/20261106T000000Z/' "$TMP/lb-args.log"
  PATH="$TMP/bin:$PATH" LB_ARGS_LOG="$TMP/lb-args.log" RADAR_OS_SNAPSHOT_TIMESTAMP=20261106T000000Z RADAR_OS_ARCH=arm64 "$ROOT/live/auto/config"
  grep -qx linux-image-arm64 config/package-lists/radar-architecture.list.chroot
  ! grep -qx linux-image-amd64 config/package-lists/radar-architecture.list.chroot
  grep -q -- '--bootappend-live console=tty0 console=ttyAMA0,115200n8 systemd.show_status=1 systemd.unit=multi-user.target' "$TMP/lb-args.log"
  grep -q -- '--mirror-chroot-security https://snapshot.debian.org/archive/debian-security/20261106T000000Z/' "$TMP/lb-args.log"
  if PATH="$TMP/bin:$PATH" LB_ARGS_LOG="$TMP/lb-args.log" RADAR_OS_SNAPSHOT_TIMESTAMP=invalid RADAR_OS_ARCH=amd64 "$ROOT/live/auto/config" 2>/dev/null; then
    echo "expected invalid snapshot timestamp to fail" >&2; exit 1
  fi
  if PATH="$TMP/bin:$PATH" env -u RADAR_OS_ARCH "$ROOT/live/auto/config" 2>/dev/null; then
    echo "expected missing architecture to fail" >&2; exit 1
  fi
)
echo "manifest tests passed: common and architecture-specific package lists are isolated and wired into Debian Live"
