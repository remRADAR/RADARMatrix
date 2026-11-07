#!/usr/bin/env bash
set -Eeuo pipefail

IMAGE="${1:-}"
EXPECTED_ARCH="${2:-}"
REPORT="${3:-${IMAGE}.validation.json}"
[[ -n "$IMAGE" && -f "$IMAGE" ]] || { echo "usage: $0 IMAGE [amd64|arm64]" >&2; exit 2; }
case "$EXPECTED_ARCH" in amd64|arm64) ;; *) echo "expected architecture must be explicitly amd64 or arm64" >&2; exit 2 ;; esac
CHECKSUM="$IMAGE.sha256"
METADATA="$IMAGE.radar-os.json"
[[ -f "$CHECKSUM" ]] || { echo "FAIL: required checksum sidecar missing: $CHECKSUM" >&2; exit 1; }
[[ -f "$METADATA" ]] || { echo "FAIL: required build metadata missing: $METADATA" >&2; exit 1; }
for tool in sha256sum file python3 xorriso; do command -v "$tool" >/dev/null 2>&1 || { echo "BLOCKED: required validation tool '$tool' is unavailable" >&2; exit 2; }; done
(cd "$(dirname "$IMAGE")" && sha256sum --check --status "$(basename "$CHECKSUM")") || { echo "FAIL: checksum does not match $IMAGE" >&2; exit 1; }
FORMAT="$(file -b "$IMAGE")"
grep -qi 'ISO 9660' <<<"$FORMAT" || { echo "FAIL: expected Debian Live ISO-9660 image, got: $FORMAT" >&2; exit 1; }
python3 - "$METADATA" "$EXPECTED_ARCH" "$(basename "$IMAGE")" <<'PY'
import json,sys
p,arch,name=sys.argv[1:]
try: m=json.load(open(p))
except Exception as e: raise SystemExit(f'FAIL: invalid metadata JSON: {e}')
if m.get('architecture') != arch: raise SystemExit(f"FAIL: metadata architecture mismatch: expected {arch}, got {m.get('architecture')!r}")
if m.get('format') != 'iso' or m.get('image') != name: raise SystemExit('FAIL: metadata format/image does not match this ISO')
PY
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
xorriso -osirrox on -indev "$IMAGE" -extract /live/vmlinuz "$TMP/vmlinuz" >/dev/null 2>&1 || { echo "FAIL: cannot extract /live/vmlinuz to establish image architecture" >&2; exit 1; }
KERNEL_INFO="$(file -b "$TMP/vmlinuz")"
case "$EXPECTED_ARCH:$KERNEL_INFO" in
  amd64:*'x86 boot'*) ;;
  amd64:*'x86_64'*) ;;
  arm64:*'ARM64'*) ;;
  arm64:*'AArch64'*) ;;
  *) echo "FAIL: kernel architecture could not be verified; expected=$EXPECTED_ARCH detected='$KERNEL_INFO'" >&2; exit 1 ;;
esac
HASH="$(sha256sum "$IMAGE" | awk '{print $1}')"
mkdir -p "$(dirname "$REPORT")"
python3 - "$REPORT" "$IMAGE" "$EXPECTED_ARCH" "$HASH" "$FORMAT" "$KERNEL_INFO" "$CHECKSUM" "$METADATA" <<'PY'
import json,sys,datetime,os
p,image,arch,sha,fmt,kernel,checksum,metadata=sys.argv[1:]
d={'schema':'radar-os-image-validation/v1','timestamp_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'image':os.path.abspath(image),'architecture':arch,'format':'iso9660','image_sha256':sha,'file_description':fmt,'kernel_description':kernel,'checksum_sidecar':os.path.abspath(checksum),'metadata_sidecar':os.path.abspath(metadata),'validation':'PASS'}
with open(p,'w') as f: json.dump(d,f,indent=2); f.write('\n')
PY
printf 'PASS: image format, architecture, checksum, and metadata validated\nimage=%s\narchitecture=%s\nsha256=%s\nreport=%s\n' "$IMAGE" "$EXPECTED_ARCH" "$HASH" "$REPORT"
