#!/usr/bin/env bash
# QEMU boot-evidence harness for RADAR OS.
#
# WHAT THIS PROVES, AND WHAT IT DOES NOT
# --------------------------------------
# A QEMU process starting is not a boot. A kernel printing to the serial console
# is not a boot. Even reaching a BusyBox `(initramfs)` prompt is not a boot: that
# is the initramfs failing to hand off to the real root filesystem, and it is the
# single most common way a "boot evidence" file ends up claiming something that
# never happened.
#
# This harness therefore reports boot progress as SEPARATE, INDEPENDENT stages
# (see os/radar-os/tests/boot/README.md) and only sets `os_ready` when the
# userspace stage is genuinely reached:
#
#   qemu_process_started  the emulator launched
#   kernel_started        a Linux kernel banner appeared on the serial console
#   userspace_ready       the readiness marker was reached AND no initramfs
#                         failure signature is present
#   desktop_ready         a graphical session marker appeared (optional)
#
# `os_ready` is true only when userspace_ready is true. A run that reaches only
# the initramfs shell is recorded as a FAILURE with the reason, never as a pass.
#
# Usage: run-qemu.sh amd64|arm64 IMAGE SERIAL_LOG FIRMWARE_FILE [EVIDENCE_JSON]
set -Eeuo pipefail
ARCH="${1:-}"
IMAGE="${2:-}"
LOG="${3:-}"
FIRMWARE="${4:-}"
case "$ARCH" in amd64|arm64) ;; *) echo "usage: $0 amd64|arm64 IMAGE SERIAL_LOG FIRMWARE_FILE [EVIDENCE_JSON]" >&2; exit 2 ;; esac
[[ -f "$IMAGE" ]] || { echo "image does not exist: $IMAGE" >&2; exit 2; }
[[ -n "$LOG" ]] || { echo "a serial log path is required" >&2; exit 2; }
[[ -f "$FIRMWARE" ]] || { echo "explicit firmware file is required and must exist: $FIRMWARE" >&2; exit 2; }
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required" >&2; exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Invoke validate-image via an explicit "bash": the executable bit can be lost
# when files are pushed through the GitHub contents API, and the boot pipeline
# must not break on a transport artifact.
bash "$ROOT/scripts/validate-image.sh" "$IMAGE" "$ARCH" >/dev/null
case "$ARCH" in
  amd64) QEMU="qemu-system-x86_64"; MACHINE="q35"; CPU="max" ;;
  arm64) QEMU="qemu-system-aarch64"; MACHINE="virt"; CPU="cortex-a57" ;;
esac
command -v "$QEMU" >/dev/null 2>&1 || { echo "BLOCKED: $QEMU is unavailable; no boot attempted." >&2; exit 2; }
mkdir -p "$(dirname "$LOG")"
EVIDENCE="${5:-$LOG.evidence.json}"
ERR_LOG="$LOG.qemu-stderr"
READY_PATTERN="${RADAR_OS_QEMU_READY_PATTERN:-Multi-User System.}"
DESKTOP_PATTERN="${RADAR_OS_QEMU_DESKTOP_PATTERN:-Reached target graphical.target}"
TIMEOUT_SECONDS="${RADAR_OS_QEMU_TIMEOUT:-120}"
MEMORY_MB="${RADAR_OS_QEMU_MEMORY:-2048}"
[[ "$TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || { echo "RADAR_OS_QEMU_TIMEOUT must be a positive integer" >&2; exit 2; }
[[ "$MEMORY_MB" =~ ^[1-9][0-9]*$ ]] || { echo "RADAR_OS_QEMU_MEMORY must be a positive integer" >&2; exit 2; }
QEMU_VERSION="$("$QEMU" --version | head -n1)"
IMAGE_SHA="$(sha256sum "$IMAGE" | awk '{print $1}')"
FIRMWARE_SHA="$(sha256sum "$FIRMWARE" | awk '{print $1}')"
CMD=("$QEMU" -machine "$MACHINE" -cpu "$CPU" -m "$MEMORY_MB" -bios "$FIRMWARE" -display none -no-reboot -no-shutdown -serial "file:$LOG")
if [[ "$ARCH" == arm64 ]]; then
  # QEMU's ARM `virt` target uses an explicit virtio-SCSI device chain for
  # optical media. Do not rely on x86-oriented `-cdrom` shorthand here.
  CMD+=(-drive "if=none,id=radar_cdrom,media=cdrom,readonly=on,file=$IMAGE" -device virtio-scsi-device -device scsi-cd,drive=radar_cdrom)
else
  CMD+=(-cdrom "$IMAGE" -boot order=d)
fi
# The exact argv is recorded in the evidence so a reviewer can re-run it.
printf '%q ' "${CMD[@]}" > "$LOG.command"
printf '\n' >> "$LOG.command"
printf 'Starting QEMU process is not a boot pass; waiting up to %ss for serial marker: %s\n' "$TIMEOUT_SECONDS" "$READY_PATTERN"
: > "$LOG"
: > "$ERR_LOG"
"${CMD[@]}" >"$ERR_LOG" 2>&1 &
PID=$!
START="$(date +%s)"
BOOT_OK=0
TERMINATED_AFTER_READY=0
pid_running() {
  kill -0 "$PID" 2>/dev/null || return 1
  [[ -r "/proc/$PID/stat" ]] || return 1
  local state
  state="$(awk '{print $3}' "/proc/$PID/stat")"
  [[ "$state" != Z && "$state" != X ]]
}
while (( $(date +%s) - START < TIMEOUT_SECONDS )); do
  if grep -Fq -- "$READY_PATTERN" "$LOG"; then BOOT_OK=1; break; fi
  if ! pid_running; then break; fi
  sleep 1
done
if pid_running; then
  if [[ "$BOOT_OK" == 1 ]]; then TERMINATED_AFTER_READY=1; fi
  kill -TERM "$PID" 2>/dev/null || true
  for _ in 1 2 3 4 5; do pid_running || break; sleep 1; done
  kill -KILL "$PID" 2>/dev/null || true
fi
if wait "$PID" 2>/dev/null; then QEMU_EXIT_CODE=0; else QEMU_EXIT_CODE=$?; fi
END="$(date +%s)"

# Stage classification and the initramfs false-positive guard live in one place
# so the same rules apply to every architecture and every caller.
python3 - "$EVIDENCE" "$ARCH" "$IMAGE" "$IMAGE_SHA" "$FIRMWARE" "$FIRMWARE_SHA" \
  "$QEMU_VERSION" "$MACHINE" "$CPU" "$MEMORY_MB" "$READY_PATTERN" "$DESKTOP_PATTERN" \
  "$LOG" "$ERR_LOG" "$LOG.command" "$BOOT_OK" "$((END-START))" "$QEMU_EXIT_CODE" \
  "$TERMINATED_AFTER_READY" "$TIMEOUT_SECONDS" <<'PY'
import json, sys, datetime, os, re

(p, arch, image, sha, fw, fwsha, version, machine, cpu, memory, marker,
 desktop_marker, log, err, cmd_path, ok, duration, exit_code, terminated,
 timeout_seconds) = sys.argv[1:]

serial = ""
if os.path.exists(log):
    with open(log, "r", errors="replace") as f:
        serial = f.read()

low = serial.lower()

# --- Stage 1: did a kernel actually start? -------------------------------
kernel_started = bool(re.search(r"linux version \d+\.\d+", low)) or "booting the kernel" in low

# --- Stage 2: userspace ---------------------------------------------------
marker_seen = marker in serial
desktop_seen = desktop_marker in serial

# Initramfs-failure signatures. Any of these means the boot did NOT reach the
# real root filesystem, regardless of what else the console printed. This is the
# guard that stops a BusyBox rescue shell from being reported as a booted OS.
INITRAMFS_FAILURES = [
    ("busybox_shell", re.compile(r"busybox v[\d.]+.*built-in shell", re.I)),
    ("initramfs_prompt", re.compile(r"\(initramfs\)", re.I)),
    ("no_root_device", re.compile(r"unable to find a medium containing a live file system", re.I)),
    ("cannot_mount_root", re.compile(r"cannot mount root|vfs: unable to mount root", re.I)),
    ("kernel_panic", re.compile(r"kernel panic", re.I)),
    ("dropped_to_shell", re.compile(r"can't access tty; job control turned off", re.I)),
]
failures = [name for name, rx in INITRAMFS_FAILURES if rx.search(serial)]

userspace_ready = marker_seen and not failures
os_ready = userspace_ready

if failures:
    verdict = "FAIL_INITRAMFS"
    reason = ("serial console shows an initramfs failure signature ("
              + ", ".join(failures)
              + "); the kernel did not hand off to the real root filesystem")
elif not kernel_started:
    verdict = "FAIL_NO_KERNEL"
    reason = "no Linux kernel banner appeared on the serial console"
elif not marker_seen:
    verdict = "FAIL_NO_READY_MARKER"
    reason = f"readiness marker {marker!r} was not observed within the timeout"
else:
    verdict = "PASS"
    reason = "userspace readiness marker observed with no initramfs failure signature"

data = {
    "schema": "radar-os-qemu-evidence/v2",
    "timestamp_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "architecture": arch,
    "machine": machine,
    "cpu": cpu,
    "memory_mb": int(memory),
    "disk": "cdrom (read-only)",
    "network": "none",
    "timeout_seconds": int(timeout_seconds),
    "qemu_version": version,
    "image": os.path.abspath(image),
    "image_sha256": sha,
    "firmware": os.path.abspath(fw),
    "firmware_sha256": fwsha,
    "exact_command": open(cmd_path).read().strip() if os.path.exists(cmd_path) else "",
    "readiness_marker": marker,
    "desktop_marker": desktop_marker,
    "serial_log": os.path.abspath(log),
    "qemu_stderr_log": os.path.abspath(err),
    "qemu_process_started": True,
    "qemu_exit_code": int(exit_code),
    "terminated_after_readiness": terminated == "1",
    "stages": {
        "qemu_process_started": True,
        "kernel_started": kernel_started,
        "userspace_ready": userspace_ready,
        "desktop_ready": desktop_seen and userspace_ready,
    },
    "initramfs_failure_signatures": failures,
    "os_ready": os_ready,
    "verdict": verdict,
    "verdict_reason": reason,
    "duration_seconds": int(duration),
}
with open(p, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")

if verdict != "PASS":
    print(f"FAIL: {verdict}: {reason}; evidence={p}", file=sys.stderr)
    raise SystemExit(1)
print(f"PASS: userspace readiness observed; evidence={p}")
PY
