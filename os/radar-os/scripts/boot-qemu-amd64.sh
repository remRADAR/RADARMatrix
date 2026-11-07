#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Invoke run-qemu via an explicit "bash": the executable bit can be lost when
# files are pushed through the GitHub contents API (mode 100644).
exec bash "$ROOT/scripts/run-qemu.sh" amd64 "${1:-}" "${2:-}" "${3:-}" "${4:-}"
