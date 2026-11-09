#!/usr/bin/env bash
# RADAR OS flash-drive bootstrap: write a validated ISO to a removable device.
#
# THE OWNER'S BOOTSTRAP, LITERALLY
# --------------------------------
# "load the OS onto a flash drive and boot a television from it". This script is
# that step, and it is deliberately the most paranoid script in the tree: it
# destroys whatever is on the target device, so every guard below is a refusal,
# not a warning.
#
# SAFETY CONTRACT
# ---------------
# 1. The image must pass validate-image.sh first (checksum sidecar, metadata,
#    ISO-9660 format, kernel architecture). An unvalidated image is never written.
# 2. The target must be an explicit block device path. There is no "auto-detect
#    the USB stick" mode: guessing a device is how people erase their laptop.
# 3. The target must be REMOVABLE (sysfs `removable` == 1). An internal disk is
#    refused even if the operator names it.
# 4. The target must not be mounted, and must not host the running root.
# 5. The operator must pass --confirm with the device's exact size in bytes, so a
#    typo cannot silently target a different disk.
# 6. The write is followed by a read-back verification of the ISO region.
#
# This script does NOT run in CI (no removable devices there). It is the
# operator-side step, and it records a machine-readable bootstrap record.
#
# Usage:
#   bootstrap-usb.sh --image out/radar-os-amd64.iso --arch amd64 \
#       --device /dev/sdX --confirm-bytes 16000000000 [--record bootstrap.json]
set -Eeuo pipefail

IMAGE=""
ARCH=""
DEVICE=""
CONFIRM_BYTES=""
RECORD=""
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image) IMAGE="${2:-}"; shift 2 ;;
    --arch) ARCH="${2:-}"; shift 2 ;;
    --device) DEVICE="${2:-}"; shift 2 ;;
    --confirm-bytes) CONFIRM_BYTES="${2:-}"; shift 2 ;;
    --record) RECORD="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "FAIL: unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$IMAGE" ]] || { echo "FAIL: --image is required" >&2; exit 2; }
[[ -n "$ARCH" ]] || { echo "FAIL: --arch is required (amd64|arm64)" >&2; exit 2; }
[[ -n "$DEVICE" ]] || { echo "FAIL: --device is required; there is no auto-detect mode" >&2; exit 2; }
[[ -n "$CONFIRM_BYTES" ]] || { echo "FAIL: --confirm-bytes is required (exact device size in bytes)" >&2; exit 2; }
case "$ARCH" in amd64|arm64) ;; *) echo "FAIL: --arch must be amd64 or arm64" >&2; exit 2 ;; esac
[[ "$CONFIRM_BYTES" =~ ^[0-9]+$ ]] || { echo "FAIL: --confirm-bytes must be an integer" >&2; exit 2; }

# --- Guard 1: the image must be validated ---------------------------------
echo "Validating image before any write: $IMAGE"
bash "$ROOT/scripts/validate-image.sh" "$IMAGE" "$ARCH" >/dev/null || {
  echo "FAIL: image failed validation; nothing was written" >&2; exit 1; }

# --- Guard 2: the target must be a block device ---------------------------
[[ -b "$DEVICE" ]] || { echo "FAIL: $DEVICE is not a block device; nothing was written" >&2; exit 1; }
DEV_NAME="$(basename "$DEVICE")"
SYS_BLOCK="/sys/class/block/$DEV_NAME"
[[ -d "$SYS_BLOCK" ]] || { echo "FAIL: $DEVICE has no sysfs entry; refusing to write" >&2; exit 1; }

# --- Guard 3: the target must be removable --------------------------------
REMOVABLE="$(cat "$SYS_BLOCK/removable" 2>/dev/null || echo "")"
if [[ "$REMOVABLE" != "1" ]]; then
  echo "FAIL: $DEVICE is not removable (sysfs removable='$REMOVABLE'); refusing to write to an internal disk" >&2
  exit 1
fi

# --- Guard 4: not mounted, not the running root ---------------------------
if grep -qs "^$DEVICE" /proc/mounts || grep -qs "^$DEVICE[0-9]" /proc/mounts; then
  echo "FAIL: $DEVICE (or a partition of it) is mounted; unmount it first" >&2
  exit 1
fi
ROOT_SRC="$(findmnt -no SOURCE / 2>/dev/null || echo "")"
if [[ -n "$ROOT_SRC" && "$ROOT_SRC" == "$DEVICE"* ]]; then
  echo "FAIL: $DEVICE hosts the running root filesystem; refusing" >&2
  exit 1
fi

# --- Guard 5: exact size confirmation -------------------------------------
ACTUAL_BYTES="$(blockdev --getsize64 "$DEVICE" 2>/dev/null || echo "")"
[[ -n "$ACTUAL_BYTES" ]] || { echo "FAIL: could not read the size of $DEVICE" >&2; exit 1; }
if [[ "$ACTUAL_BYTES" != "$CONFIRM_BYTES" ]]; then
  echo "FAIL: --confirm-bytes $CONFIRM_BYTES does not match $DEVICE size $ACTUAL_BYTES; refusing" >&2
  exit 1
fi

IMAGE_BYTES="$(stat -c %s "$IMAGE")"
if (( IMAGE_BYTES > ACTUAL_BYTES )); then
  echo "FAIL: image ($IMAGE_BYTES bytes) does not fit on $DEVICE ($ACTUAL_BYTES bytes)" >&2
  exit 1
fi

IMAGE_SHA="$(sha256sum "$IMAGE" | awk '{print $1}')"
echo "Writing $IMAGE ($IMAGE_BYTES bytes, sha256 $IMAGE_SHA) to $DEVICE ($ACTUAL_BYTES bytes)"
sync
dd if="$IMAGE" of="$DEVICE" bs=4M conv=fsync status=progress oflag=direct
sync

# --- Guard 6: read-back verification --------------------------------------
echo "Verifying the written region by read-back"
READBACK_SHA="$(dd if="$DEVICE" bs=4M count=$(( (IMAGE_BYTES + 4194303) / 4194304 )) iflag=direct 2>/dev/null \
  | head -c "$IMAGE_BYTES" | sha256sum | awk '{print $1}')"
if [[ "$READBACK_SHA" != "$IMAGE_SHA" ]]; then
  echo "FAIL: read-back digest $READBACK_SHA does not match image digest $IMAGE_SHA" >&2
  exit 1
fi

if [[ -n "$RECORD" ]]; then
  python3 - "$RECORD" "$IMAGE" "$IMAGE_SHA" "$IMAGE_BYTES" "$DEVICE" "$ACTUAL_BYTES" "$ARCH" <<'PY'
import json, sys, datetime, os
p, image, sha, image_bytes, device, device_bytes, arch = sys.argv[1:]
data = {
    "schema": "radar-os-usb-bootstrap/v1",
    "timestamp_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "image": os.path.abspath(image),
    "image_sha256": sha,
    "image_bytes": int(image_bytes),
    "device": device,
    "device_bytes": int(device_bytes),
    "architecture": arch,
    "removable": True,
    "readback_verified": True,
    "verdict": "PASS",
}
with open(p, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY
  echo "Bootstrap record written: $RECORD"
fi

echo "PASS: $DEVICE now holds a verified RADAR OS image."
echo "Next: boot the target television from this device (UEFI or legacy BIOS, see docs/os/TV-BOOT.md)."
