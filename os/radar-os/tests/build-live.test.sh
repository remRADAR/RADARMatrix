#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
cat > "$TMP/bin/lb" <<'SH'
#!/usr/bin/env bash
printf '%s|%s\n' "$PWD" "$*" >> "$LB_LOG"
SH
chmod +x "$TMP/bin/lb"
export PATH="$TMP/bin:$PATH" LB_LOG="$TMP/lb.log"

for arch in amd64 arm64; do
  RADAR_OS_ARCH="$arch" RADAR_OS_OUT_DIR="$TMP/out-$arch" "$ROOT/scripts/build-live.sh" >"$TMP/$arch.out"
done
[[ "$(wc -l < "$LB_LOG")" -eq 2 ]]
AMD64_DIR="$(sed -n '1s/|.*//p' "$LB_LOG")"
ARM64_DIR="$(sed -n '2s/|.*//p' "$LB_LOG")"
[[ "$AMD64_DIR" != "$ARM64_DIR" ]]
grep -q -- '--architectures amd64' "$LB_LOG"
grep -q -- '--architectures arm64' "$LB_LOG"
[[ ! -e "$ROOT/live/config/package-lists/radar-architecture.list.chroot" ]]

if RADAR_OS_ARCH=amd64 RADAR_OS_RUN_LB=1 RADAR_OS_OUT_DIR="$TMP/out-build" "$ROOT/scripts/build-live.sh" >"$TMP/missing-snapshot.out" 2>"$TMP/missing-snapshot.err"; then
  echo "expected a real build without a pinned snapshot to fail" >&2; exit 1
fi
grep -q 'RADAR_OS_SNAPSHOT_TIMESTAMP must be an immutable' "$TMP/missing-snapshot.err"
echo "build-live tests passed: architecture workspaces are isolated, source tree is untouched, and real builds require an explicit snapshot"
