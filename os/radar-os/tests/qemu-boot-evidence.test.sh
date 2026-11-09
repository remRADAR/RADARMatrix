#!/usr/bin/env bash
# Regression tests for the QEMU boot-evidence harness.
#
# The defect this guards against: the committed "boot evidence" recorded
# os_ready: true for a serial console that had actually dropped to a BusyBox
# initramfs rescue shell. A kernel that never hands off to the real root
# filesystem is not a boot, and the harness must say so.
#
# These tests drive the REAL run-qemu.sh with a fake QEMU that writes a chosen
# serial transcript, so the classification logic is exercised end to end.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }

mkdir -p "$TMP/bin"
IMAGE="$TMP/dummy.iso"
FIRMWARE="$TMP/firmware.fd"
printf 'synthetic image fixture\n' > "$IMAGE"
printf 'synthetic firmware fixture\n' > "$FIRMWARE"
printf '{"architecture":"amd64","format":"iso","image":"dummy.iso"}\n' > "$IMAGE.radar-os.json"
(cd "$TMP" && sha256sum dummy.iso > dummy.iso.sha256)

# Fake toolchain: file/xorriso satisfy validate-image.sh, fake-qemu writes the
# transcript named by MOCK_SERIAL_FILE.
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
cat > "$TMP/bin/fake-qemu" <<'SH'
#!/usr/bin/env bash
if [[ "${1:-}" == --version ]]; then echo 'QEMU emulator version 99.0-test'; exit 0; fi
SERIAL=''
while (($#)); do
  case "$1" in -serial) SERIAL="${2#file:}"; shift 2 ;; *) shift ;; esac
done
cp "$MOCK_SERIAL_FILE" "$SERIAL"
SH
chmod +x "$TMP/bin/file" "$TMP/bin/xorriso" "$TMP/bin/fake-qemu"
ln -s "$TMP/bin/fake-qemu" "$TMP/bin/qemu-system-x86_64"
ln -s "$TMP/bin/fake-qemu" "$TMP/bin/qemu-system-aarch64"

# run_case <name> <transcript-file> <expected-verdict> <expected-exit-zero:yes|no>
run_case() {
  local name="$1" transcript="$2" want_verdict="$3" want_zero="$4"
  local ev="$TMP/$name.evidence.json" rc=0
  PATH="$TMP/bin:$PATH" MOCK_SERIAL_FILE="$transcript" RADAR_OS_QEMU_TIMEOUT=3 \
    bash "$ROOT/scripts/boot-qemu-amd64.sh" "$IMAGE" "$TMP/$name.serial.log" "$FIRMWARE" "$ev" \
    >"$TMP/$name.out" 2>"$TMP/$name.err" || rc=$?
  if [[ ! -f "$ev" ]]; then bad "$name (no evidence file written)"; return; fi
  local got
  got="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['verdict'])" "$ev")"
  if [[ "$got" != "$want_verdict" ]]; then
    bad "$name (verdict $got, expected $want_verdict)"; return
  fi
  if [[ "$want_zero" == yes && "$rc" -ne 0 ]]; then bad "$name (expected exit 0, got $rc)"; return; fi
  if [[ "$want_zero" == no && "$rc" -eq 0 ]]; then bad "$name (expected non-zero exit, got 0)"; return; fi
  ok "$name (verdict=$got, exit=$rc)"
}

echo "QEMU boot-evidence harness"

# --- The exact false positive that was committed --------------------------
# This transcript is the shape of the quarantined serial-amd64-boot.txt: a
# kernel banner, a hand-printed "Multi-User System." line, then a BusyBox shell.
cat > "$TMP/initramfs.txt" <<'TXT'
[    1.928819] Run /init as init process
RADAR-OS: kernel=6.1.0-54-amd64 arch=x86_64
RADAR-OS: initramfs unpacked; /proc /sys /dev mounted
RADAR-OS: Multi-User System. Reached target multi-user.target
RADAR-OS: BOOT_EVIDENCE_OK
BusyBox v1.35.0 (Debian 1:1.35.0-4+deb12u1+b1) built-in shell (ash)
Enter 'help' for a list of built-in commands.
/bin/sh: can't access tty; job control turned off
TXT
run_case "initramfs_shell_is_not_a_boot" "$TMP/initramfs.txt" FAIL_INITRAMFS no

# --- A genuine userspace boot --------------------------------------------
cat > "$TMP/real-boot.txt" <<'TXT'
[    0.000000] Linux version 6.12.113+deb13-amd64 (debian-kernel@lists.debian.org)
[    1.100000] Run /init as init process
[    2.400000] systemd[1]: Reached target Local File Systems.
[    9.800000] systemd[1]: Reached target Multi-User System.
[    9.900000] systemd[1]: Startup finished in 9.1s.
TXT
run_case "real_userspace_boot_passes" "$TMP/real-boot.txt" PASS yes

# --- Kernel panic ---------------------------------------------------------
cat > "$TMP/panic.txt" <<'TXT'
[    0.000000] Linux version 6.12.113+deb13-amd64
[    3.000000] Kernel panic - not syncing: VFS: Unable to mount root fs
TXT
run_case "kernel_panic_fails" "$TMP/panic.txt" FAIL_INITRAMFS no

# --- No kernel at all -----------------------------------------------------
printf 'SeaBIOS (version 1.16.0)\nBooting from DVD/CD...\n' > "$TMP/nokernel.txt"
run_case "no_kernel_banner_fails" "$TMP/nokernel.txt" FAIL_NO_KERNEL no

# --- Kernel but never reaches userspace ----------------------------------
printf '[    0.000000] Linux version 6.12.113+deb13-amd64\n[    1.000000] Run /init as init process\n' > "$TMP/noready.txt"
run_case "kernel_without_readiness_fails" "$TMP/noready.txt" FAIL_NO_READY_MARKER no

# --- The evidence must carry the stages and the exact command -------------
python3 - "$TMP/real_userspace_boot_passes.evidence.json" <<'PY' && ok "evidence records stages, exact command and no failure signatures" || bad "evidence missing stages/exact_command"
import json, sys
d = json.load(open(sys.argv[1]))
assert d['schema'] == 'radar-os-qemu-evidence/v2'
assert d['stages']['kernel_started'] is True
assert d['stages']['userspace_ready'] is True
assert d['initramfs_failure_signatures'] == []
assert d['exact_command'].startswith('qemu-system-x86_64')
assert d['os_ready'] is True
PY

echo
if [[ "$FAIL" -ne 0 ]]; then
  echo "QEMU harness tests FAILED: $FAIL failed, $PASS passed" >&2
  exit 1
fi
echo "QEMU harness tests passed: $PASS assertions (an initramfs rescue shell is never reported as a boot)"
