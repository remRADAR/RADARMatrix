#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCH="${RADAR_OS_ARCH:-$(dpkg --print-architecture 2>/dev/null || true)}"
OUT_DIR="${RADAR_OS_OUT_DIR:-$ROOT/build/$ARCH}"
mkdir -p "$OUT_DIR"

command -v lb >/dev/null 2>&1 || { echo "BLOCKED: live-build (lb) is required; no image was built." >&2; exit 2; }
case "$ARCH" in amd64|arm64) ;; *) echo "unsupported architecture: $ARCH" >&2; exit 2 ;; esac
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required" >&2; exit 2; }

# Stage 0.1 does not run lb automatically. Set RADAR_OS_RUN_LB=1 only in an
# approved Stage 1 build environment after source/pinning review.
if [[ "${RADAR_OS_RUN_LB:-0}" != 1 ]]; then
  echo "READY: configuration scaffold validated for $ARCH; set RADAR_OS_RUN_LB=1 to build in an approved environment."
  exit 0
fi

cd "$ROOT"
RADAR_OS_ARCH="$ARCH" live/auto/config
lb build 2>&1 | tee "$OUT_DIR/build.log"
IMAGE="$(find . -maxdepth 1 -type f \( -name '*.iso' -o -name '*.img' \) | head -n1)"
[[ -n "$IMAGE" ]] || { echo "build completed without a discovered image" >&2; exit 1; }
cp -- "$IMAGE" "$OUT_DIR/"
sha256sum "$OUT_DIR/$(basename "$IMAGE")" | tee "$OUT_DIR/SHA256SUMS"
printf '%s\n' "architecture=$ARCH" "image=$(basename "$IMAGE")" > "$OUT_DIR/build-metadata.txt"
