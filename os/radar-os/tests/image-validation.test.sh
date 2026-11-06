#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
IMAGE="$TMP/fake.iso"
CHECKSUM="$IMAGE.sha256"
printf 'synthetic image fixture\n' > "$IMAGE"
if "$ROOT/scripts/validate-image.sh" "$IMAGE" 2>"$TMP/no-arch.err"; then
  echo "expected missing architecture to fail" >&2; exit 1
fi
grep -q 'architecture must be explicitly' "$TMP/no-arch.err"
if "$ROOT/scripts/validate-image.sh" "$IMAGE" amd64 2>"$TMP/no-checksum.err"; then
  echo "expected missing checksum to fail" >&2; exit 1
fi
grep -q 'required checksum sidecar missing' "$TMP/no-checksum.err"
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
printf 'synthetic x86 kernel fixture\n' > "${!#}"
SH
chmod +x "$TMP/bin/file" "$TMP/bin/xorriso"
cat > "$IMAGE.radar-os.json" <<'JSON'
{"architecture":"amd64","format":"iso","image":"fake.iso"}
JSON
(cd "$TMP" && sha256sum fake.iso > fake.iso.sha256)
PATH="$TMP/bin:$PATH" "$ROOT/scripts/validate-image.sh" "$IMAGE" amd64 "$TMP/report.json" >/dev/null
python3 - "$TMP/report.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert r['validation']=='PASS' and r['architecture']=='amd64' and r['format']=='iso9660'
assert len(r['image_sha256'])==64
PY
if PATH="$TMP/bin:$PATH" "$ROOT/scripts/validate-image.sh" "$IMAGE" arm64 "$TMP/wrong-arch.json" 2>"$TMP/wrong-arch.err"; then
  echo "expected architecture mismatch to fail" >&2; exit 1
fi
grep -q 'metadata architecture mismatch' "$TMP/wrong-arch.err"
printf 'tamper\n' >> "$IMAGE"
if PATH="$TMP/bin:$PATH" "$ROOT/scripts/validate-image.sh" "$IMAGE" amd64 2>"$TMP/checksum.err"; then
  echo "expected checksum mismatch to fail" >&2; exit 1
fi
grep -q 'checksum does not match' "$TMP/checksum.err"
printf 'tamper\n' > "$IMAGE"
REAL_HASH="$(sha256sum "$IMAGE" | awk '{print $1}')"
printf '%s  other.iso\n' "$REAL_HASH" > "$CHECKSUM"
if PATH="$TMP/bin:$PATH" "$ROOT/scripts/validate-image.sh" "$IMAGE" amd64 2>"$TMP/wrong-name.err"; then
  echo "expected checksum sidecar bound to a different filename to fail" >&2; exit 1
fi
grep -q 'expected fake.iso' "$TMP/wrong-name.err"
printf '%s  fake.iso\n%s  fake.iso\n' "$REAL_HASH" "$REAL_HASH" > "$CHECKSUM"
if PATH="$TMP/bin:$PATH" "$ROOT/scripts/validate-image.sh" "$IMAGE" amd64 2>"$TMP/multiple-lines.err"; then
  echo "expected multi-record checksum sidecar to fail" >&2; exit 1
fi
grep -q 'exactly one SHA-256 record' "$TMP/multiple-lines.err"
printf '%s  fake.iso\n' "$(printf '0%.0s' {1..64})" > "$CHECKSUM"
if PATH="$TMP/bin:$PATH" "$ROOT/scripts/validate-image.sh" "$IMAGE" amd64 2>"$TMP/wrong-hash.err"; then
  echo "expected wrong exact-image digest to fail" >&2; exit 1
fi
grep -q 'checksum does not match' "$TMP/wrong-hash.err"
echo "image validation tests passed: required metadata, exact image/hash binding, malformed/multiple checksum records, format and architecture"
