#!/usr/bin/env bash
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
"$ROOT/scripts/validate-image.sh" "$IMAGE" "$ARCH" >/dev/null
case "$ARCH" in
  amd64) QEMU="qemu-system-x86_64"; MACHINE="q35" ;;
  arm64) QEMU="qemu-system-aarch64"; MACHINE="virt" ;;
esac
command -v "$QEMU" >/dev/null 2>&1 || { echo "BLOCKED: $QEMU is unavailable; no boot attempted." >&2; exit 2; }
mkdir -p "$(dirname "$LOG")"
EVIDENCE="${5:-$LOG.evidence.json}"
ERR_LOG="$LOG.qemu-stderr"
READY_PATTERN="${RADAR_OS_QEMU_READY_PATTERN:-Multi-User System.}"
TIMEOUT_SECONDS="${RADAR_OS_QEMU_TIMEOUT:-120}"
[[ "$TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || { echo "RADAR_OS_QEMU_TIMEOUT must be a positive integer" >&2; exit 2; }
QEMU_VERSION="$("$QEMU" --version | head -n1)"
IMAGE_SHA="$(sha256sum "$IMAGE" | awk '{print $1}')"
FIRMWARE_SHA="$(sha256sum "$FIRMWARE" | awk '{print $1}')"
CMD=("$QEMU" -machine "$MACHINE" -m 2048 -bios "$FIRMWARE" -display none -no-reboot -no-shutdown -serial "file:$LOG")
if [[ "$ARCH" == arm64 ]]; then
  # QEMU's ARM `virt` target uses an explicit virtio-SCSI device chain for
  # optical media. Do not rely on x86-oriented `-cdrom` shorthand here.
  CMD+=(-drive "if=none,id=radar_cdrom,media=cdrom,readonly=on,file=$IMAGE" -device virtio-scsi-device -device scsi-cd,drive=radar_cdrom)
else
  CMD+=(-cdrom "$IMAGE" -boot order=d)
fi
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
python3 - "$EVIDENCE" "$ARCH" "$IMAGE" "$IMAGE_SHA" "$FIRMWARE" "$FIRMWARE_SHA" "$QEMU_VERSION" "$MACHINE" "$READY_PATTERN" "$LOG" "$ERR_LOG" "$BOOT_OK" "$((END-START))" "$QEMU_EXIT_CODE" "$TERMINATED_AFTER_READY" <<'PY'
import json,sys,datetime,os
p,arch,image,sha,fw,fwsha,version,machine,marker,log,err,ok,duration,exit_code,terminated=sys.argv[1:]
data={'schema':'radar-os-qemu-evidence/v1','timestamp_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'architecture':arch,'machine':machine,'qemu_version':version,'image':os.path.abspath(image),'image_sha256':sha,'firmware':os.path.abspath(fw),'firmware_sha256':fwsha,'readiness_marker':marker,'serial_log':os.path.abspath(log),'qemu_stderr_log':os.path.abspath(err),'qemu_process_started':True,'qemu_exit_code':int(exit_code),'terminated_after_readiness':terminated=='1','os_ready':ok=='1','duration_seconds':int(duration)}
with open(p,'w') as f: json.dump(data,f,indent=2); f.write('\n')
PY
if [[ "$BOOT_OK" != 1 ]]; then
  echo "FAIL: QEMU process started but OS readiness marker was not observed; evidence=$EVIDENCE" >&2
  exit 1
fi
echo "PASS: serial readiness marker observed; reproducible evidence=$EVIDENCE"
