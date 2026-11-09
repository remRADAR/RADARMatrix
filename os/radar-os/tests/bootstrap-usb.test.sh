#!/usr/bin/env bash
# Regression tests for the flash-drive bootstrap guards.
#
# bootstrap-usb.sh destroys whatever is on the target device, so every guard is
# a refusal. These tests prove each refusal fires BEFORE any write, using a
# regular file as a stand-in for a block device (which must itself be refused).
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/bootstrap-usb.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }

# A validated image fixture so the script gets past guard 1.
IMAGE="$TMP/dummy.iso"
printf 'synthetic image fixture\n' > "$IMAGE"
printf '{"architecture":"amd64","format":"iso","image":"dummy.iso"}\n' > "$IMAGE.radar-os.json"
(cd "$TMP" && sha256sum dummy.iso > dummy.iso.sha256)

mkdir -p "$TMP/bin"
cat > "$TMP/bin/file" <<'SH'
#!/usr/bin/env bash
case "${!#}" in
  *.iso) echo 'ISO 9660 CD-ROM filesystem data' ;;
  */vmlinuz) echo 'Linux kernel x86 boot executable bzImage' ;;
  *) echo 'unknown data' ;;
esac
SH
cat > "$TMP/bin/xorriso" <<'SH'
#!/usr/bin/env bash
printf 'synthetic kernel fixture\n' > "${!#}"
SH
chmod +x "$TMP/bin/file" "$TMP/bin/xorriso"
export PATH="$TMP/bin:$PATH"

# expect_refusal <name> <expected-substring> <args...>
expect_refusal() {
  local name="$1" needle="$2"; shift 2
  local out rc=0
  out="$(bash "$SCRIPT" "$@" 2>&1)" || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    bad "$name (expected refusal, got exit 0)"
  elif ! grep -qF -- "$needle" <<<"$out"; then
    bad "$name (exit $rc but message lacked '$needle'; got: $out)"
  else
    ok "$name"
  fi
}

echo "flash-drive bootstrap guards"

# A regular file is not a block device: the most important refusal, because it
# is what a typo'd path looks like.
expect_refusal "regular file is not a block device" "is not a block device" \
  --image "$IMAGE" --arch amd64 --device "$TMP/notadevice" --confirm-bytes 1000

# A non-existent device.
expect_refusal "missing device is refused" "is not a block device" \
  --image "$IMAGE" --arch amd64 --device "$TMP/nope" --confirm-bytes 1000

# Missing required arguments.
expect_refusal "missing --device is refused" "--device is required" \
  --image "$IMAGE" --arch amd64 --confirm-bytes 1000
expect_refusal "missing --confirm-bytes is refused" "--confirm-bytes is required" \
  --image "$IMAGE" --arch amd64 --device /dev/null
expect_refusal "bad --arch is refused" "--arch must be amd64 or arm64" \
  --image "$IMAGE" --arch sparc --device /dev/null --confirm-bytes 1

# An unvalidated image must never be written, even to a plausible device.
BAD="$TMP/bad.iso"
printf 'not an iso\n' > "$BAD"
expect_refusal "unvalidated image is refused" "failed validation" \
  --image "$BAD" --arch amd64 --device /dev/null --confirm-bytes 1

# /dev/null is a character device, not a block device.
expect_refusal "character device is refused" "is not a block device" \
  --image "$IMAGE" --arch amd64 --device /dev/null --confirm-bytes 1

echo
if [[ "$FAIL" -ne 0 ]]; then
  echo "bootstrap-usb tests FAILED: $FAIL failed, $PASS passed" >&2
  exit 1
fi
echo "bootstrap-usb tests passed: $PASS assertions (every guard refuses before any write)"
