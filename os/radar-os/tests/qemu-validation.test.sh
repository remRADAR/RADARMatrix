#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
IMAGE="$TMP/dummy.iso"
FIRMWARE="$TMP/firmware.fd"
printf 'synthetic image fixture\n' > "$IMAGE"
printf 'synthetic firmware fixture\n' > "$FIRMWARE"
for arch in amd64 arm64; do
  WRAPPER="$ROOT/scripts/boot-qemu-$arch.sh"
  if "$WRAPPER" "$IMAGE" "$TMP/$arch-missing.log" "$TMP/no-firmware.fd" "$TMP/$arch-missing.json" 2>"$TMP/$arch-missing.err"; then
    echo "expected missing firmware to block $arch QEMU" >&2; exit 1
  fi
  grep -q 'explicit firmware file is required' "$TMP/$arch-missing.err"
  [[ ! -e "$TMP/$arch-missing.json" ]]
done
mkdir -p "$TMP/bin"
cat > "$TMP/bin/file" <<'SH'
#!/usr/bin/env bash
case "${!#}" in
  *.iso) echo 'ISO 9660 CD-ROM filesystem data' ;;
  */vmlinuz) if [[ "${MOCK_KERNEL_ARCH:-amd64}" == arm64 ]]; then echo 'Linux kernel ARM64 boot executable Image'; else echo 'Linux kernel x86 boot executable bzImage'; fi ;;
  *) echo 'unknown data' ;;
esac
SH
cat > "$TMP/bin/xorriso" <<'SH'
#!/usr/bin/env bash
printf 'synthetic kernel fixture\n' > "${!#}"
SH
cat > "$TMP/bin/fake-qemu" <<'SH'
#!/usr/bin/env bash
if [[ "${1:-}" == --version ]]; then echo 'QEMU emulator version 99.0-test'; exit 0; fi
SERIAL=''
MACHINE=''
while (($#)); do
  case "$1" in
    -serial) SERIAL="${2#file:}"; shift 2 ;;
    -machine) MACHINE="$2"; shift 2 ;;
    *) shift ;;
  esac
done
EXPECTED=virt
[[ "$0" == *x86_64* ]] && EXPECTED=q35
[[ "$MACHINE" == "$EXPECTED" ]] || { echo "wrong machine: $MACHINE expected $EXPECTED" >&2; exit 11; }
if [[ "${MOCK_QEMU_READY:-0}" == 1 ]]; then echo 'Reached target multi-user.target - Multi-User System.' > "$SERIAL"; else echo 'QEMU process started; no guest readiness signal.' > "$SERIAL"; fi
SH
chmod +x "$TMP/bin/file" "$TMP/bin/xorriso" "$TMP/bin/fake-qemu"
ln -s "$TMP/bin/fake-qemu" "$TMP/bin/qemu-system-x86_64"
ln -s "$TMP/bin/fake-qemu" "$TMP/bin/qemu-system-aarch64"
cat > "$IMAGE.radar-os.json" <<'JSON'
{"architecture":"amd64","format":"iso","image":"dummy.iso"}
JSON
(cd "$TMP" && sha256sum dummy.iso > dummy.iso.sha256)
PATH="$TMP/bin:$PATH" MOCK_KERNEL_ARCH=amd64 MOCK_QEMU_READY=1 RADAR_OS_QEMU_TIMEOUT=3 "$ROOT/scripts/boot-qemu-amd64.sh" "$IMAGE" "$TMP/amd64.serial.log" "$FIRMWARE" "$TMP/amd64.evidence.json" >/dev/null
python3 - "$TMP/amd64.evidence.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
assert x['qemu_process_started'] is True and x['os_ready'] is True and x['machine']=='q35'
PY
cat > "$IMAGE.radar-os.json" <<'JSON'
{"architecture":"arm64","format":"iso","image":"dummy.iso"}
JSON
PATH="$TMP/bin:$PATH" MOCK_KERNEL_ARCH=arm64 MOCK_QEMU_READY=0 RADAR_OS_QEMU_TIMEOUT=3 "$ROOT/scripts/boot-qemu-arm64.sh" "$IMAGE" "$TMP/arm64.serial.log" "$FIRMWARE" "$TMP/arm64.evidence.json" >"$TMP/not-ready.out" 2>"$TMP/not-ready.err" && {
  echo "expected QEMU process start without readiness to fail" >&2; exit 1;
}
grep -q 'QEMU process started but OS readiness marker was not observed' "$TMP/not-ready.err"
python3 - "$TMP/arm64.evidence.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
assert x['qemu_process_started'] is True and x['os_ready'] is False and x['machine']=='virt'
PY
echo "QEMU tests passed: firmware is mandatory; process start and OS readiness are distinguished for AMD64 and ARM64"
