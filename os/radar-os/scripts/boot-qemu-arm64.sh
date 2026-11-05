#!/usr/bin/env bash
set -Eeuo pipefail
IMAGE="${1:-}"
LOG="${2:-./qemu-arm64-$(date -u +%Y%m%dT%H%M%SZ).log}"
[[ -f "$IMAGE" ]] || { echo "usage: $0 IMAGE [LOG]" >&2; exit 2; }
command -v qemu-system-aarch64 >/dev/null 2>&1 || { echo "BLOCKED: qemu-system-aarch64 is unavailable; no boot attempted." >&2; exit 2; }
mkdir -p "$(dirname "$LOG")"
TIMEOUT_SECONDS="${RADAR_OS_QEMU_TIMEOUT:-120}"
command -v timeout >/dev/null 2>&1 || { echo "timeout is required" >&2; exit 2; }
exec timeout --signal=TERM "$TIMEOUT_SECONDS" qemu-system-aarch64 \
  -M virt -cpu max -m 2048 \
  -drive "file=$IMAGE,readonly=on,format=raw" \
  -serial "file:$LOG" -display none -no-reboot -no-shutdown
