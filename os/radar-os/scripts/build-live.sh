#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCH="${RADAR_OS_ARCH:-}"
case "$ARCH" in amd64|arm64) ;; *) echo "RADAR_OS_ARCH must be explicitly set to amd64 or arm64" >&2; exit 2 ;; esac
OUT_DIR="${RADAR_OS_OUT_DIR:-$ROOT/build/$ARCH}"

command -v lb >/dev/null 2>&1 || { echo "BLOCKED: live-build (lb) is required; no image was built." >&2; exit 2; }
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required" >&2; exit 2; }

# Stage 0.1 does not run lb automatically. Set RADAR_OS_RUN_LB=1 only in an
# approved Stage 1 build environment after source/pinning review.
if [[ "${RADAR_OS_RUN_LB:-0}" != 1 ]]; then
  (cd "$ROOT/live" && RADAR_OS_ARCH="$ARCH" ./auto/config)
  echo "READY: Debian Live package lists and configuration prepared for $ARCH; set RADAR_OS_RUN_LB=1 to build in an approved environment."
  exit 0
fi

mkdir -p "$OUT_DIR"
cd "$ROOT/live"
RADAR_OS_ARCH="$ARCH" ./auto/config
lb build 2>&1 | tee "$OUT_DIR/build.log"
IMAGE="$(find . -maxdepth 1 -type f -name '*.iso' -print -quit)"
[[ -n "$IMAGE" ]] || { echo "build completed without a discovered image" >&2; exit 1; }
DEST="$OUT_DIR/$(basename "$IMAGE")"
cp -- "$IMAGE" "$DEST"
(cd "$OUT_DIR" && sha256sum "$(basename "$DEST")" > "$(basename "$DEST").sha256")
printf '{"architecture":"%s","format":"iso","image":"%s"}\n' "$ARCH" "$(basename "$DEST")" > "$DEST.radar-os.json"
"$ROOT/scripts/validate-image.sh" "$DEST" "$ARCH"
printf '%s\n' "architecture=$ARCH" "image=$(basename "$IMAGE")" > "$OUT_DIR/build-metadata.txt"
