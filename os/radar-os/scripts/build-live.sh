#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCH="${RADAR_OS_ARCH:-}"
case "$ARCH" in amd64|arm64) ;; *) echo "RADAR_OS_ARCH must be explicitly set to amd64 or arm64" >&2; exit 2 ;; esac
OUT_DIR="${RADAR_OS_OUT_DIR:-$ROOT/build/$ARCH}"

command -v lb >/dev/null 2>&1 || { echo "BLOCKED: live-build (lb) is required; no image was built." >&2; exit 2; }
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required" >&2; exit 2; }

# Never share mutable live-build configuration between architectures. Each run
# starts from a clean copy, so generated package lists/config cannot leak across
# AMD64 and ARM64 builds.
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/radar-os-${ARCH}.XXXXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT
mkdir -p "$WORK_DIR/live"
cp -a "$ROOT/live/." "$WORK_DIR/live/"
ln -s "$ROOT/config" "$WORK_DIR/config"

# Stage 0.1 does not run lb automatically. A real build requires an explicit,
# immutable Debian snapshot timestamp and must run in an approved environment.
if [[ "${RADAR_OS_RUN_LB:-0}" != 1 ]]; then
  (cd "$WORK_DIR/live" && RADAR_OS_ARCH="$ARCH" ./auto/config)
  echo "READY: isolated Debian Live configuration prepared for $ARCH; a real build additionally requires RADAR_OS_RUN_LB=1, RADAR_OS_SNAPSHOT_TIMESTAMP=YYYYMMDDTHHMMSSZ, and an approved environment."
  exit 0
fi

SNAPSHOT="${RADAR_OS_SNAPSHOT_TIMESTAMP:-}"
[[ "$SNAPSHOT" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo "RADAR_OS_SNAPSHOT_TIMESTAMP must be an immutable YYYYMMDDTHHMMSSZ Debian snapshot timestamp" >&2; exit 2; }
mkdir -p "$OUT_DIR"
cd "$WORK_DIR/live"
RADAR_OS_ARCH="$ARCH" RADAR_OS_SNAPSHOT_TIMESTAMP="$SNAPSHOT" ./auto/config
lb build 2>&1 | tee "$OUT_DIR/build.log"
IMAGE="$(find . -maxdepth 1 -type f -name '*.iso' -print -quit)"
[[ -n "$IMAGE" ]] || { echo "build completed without a discovered image" >&2; exit 1; }
DEST="$OUT_DIR/$(basename "$IMAGE")"
cp -- "$IMAGE" "$DEST"
(cd "$OUT_DIR" && sha256sum "$(basename "$DEST")" > "$(basename "$DEST").sha256")
python3 - "$DEST.radar-os.json" "$ARCH" "$(basename "$DEST")" "$SNAPSHOT" <<'PY'
import json,sys
path,arch,image,snapshot=sys.argv[1:]
with open(path,'w') as f:
    json.dump({'architecture':arch,'format':'iso','image':image,'debian_snapshot_timestamp':snapshot},f,indent=2)
    f.write('\n')
PY
"$ROOT/scripts/validate-image.sh" "$DEST" "$ARCH"
printf '%s\n' "architecture=$ARCH" "image=$(basename "$IMAGE")" "debian_snapshot_timestamp=$SNAPSHOT" > "$OUT_DIR/build-metadata.txt"
