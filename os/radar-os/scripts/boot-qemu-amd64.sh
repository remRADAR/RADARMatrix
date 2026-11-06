#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$ROOT/scripts/run-qemu.sh" amd64 "${1:-}" "${2:-}" "${3:-}" "${4:-}"
