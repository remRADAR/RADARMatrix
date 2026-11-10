#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Every script invocation below uses an explicit "bash" prefix: executable bits
# can be lost when files are pushed through the GitHub contents API (mode
# 100644), and a Permission denied must never masquerade as a test failure.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
IMAGE="$TMP/fake.iso"
CHECKSUM="$IMAGE.sha256"
printf 'synthetic image fixture\n' > "$IMAGE"
if bash "$ROOT/scripts/validate-image.sh" "$IMAGE" 2>"$TMP/no-arch.err"; then
  echo "expected missing architecture to fail" >&2; exit 1
fi
grep -q 'architecture must be explicitly' "$TMP/no-arch.err"
if bash "$ROOT/scripts/validate-image.sh" "$IMAGE" amd64 2>"$TMP/no-checksum.err"; then
  echo "expected missing checksum to fail" >&2; exit 1
fi
grep -q 'required checksum sidecar missing' "$TMP/no-checksum.err"
mkdir -p "$TMP/bin"
# The kernel fixtures below are real file(1) outputs observed on the described
# kernel packagings (file 5.4x on Debian), NOT strings transcribed from the
# validator's own match patterns. MOCK_KERNEL_STYLE selects the descriptor so
# each realistic output can be exercised independently.
cat > "$TMP/bin/file" <<'SH'
#!/usr/bin/env bash
case "${!#}" in
  *.iso) echo 'ISO 9660 CD-ROM filesystem data' ;;
  */vmlinuz) case "${MOCK_KERNEL_STYLE:-bzimage}" in
    bzimage)     echo 'Linux kernel x86 boot executable bzImage, version 6.1.0-54-amd64 (debian 6.1.90-1)' ;;
    arm64-image) echo 'Linux kernel ARM64 boot executable Image (little-endian)' ;;
    pe-arm64)    echo 'PE32+ executable (EFI application) AArch64 (stripped to external PDB), for MS Windows' ;;
    elf-aarch64) echo 'ELF 64-bit LSB executable, ARM aarch64, version 1 (SYSV), statically linked' ;;
    pe-amd64)    echo 'PE32+ executable (EFI application) x86-64 (stripped to external PDB), for MS Windows' ;;
    gzip)        echo 'gzip compressed data, max compression, from Unix, original size modulo 2^32 3917568' ;;
    *) echo 'unknown data' ;;
  esac ;;
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
PATH="$TMP/bin:$PATH" bash "$ROOT/scripts/validate-image.sh" "$IMAGE" amd64 "$TMP/report.json" >/dev/null
python3 - "$TMP/report.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert r['validation']=='PASS' and r['architecture']=='amd64' and r['format']=='iso9660'
assert len(r['image_sha256'])==64
PY
if PATH="$TMP/bin:$PATH" bash "$ROOT/scripts/validate-image.sh" "$IMAGE" arm64 "$TMP/wrong-arch.json" 2>"$TMP/wrong-arch.err"; then
  echo "expected architecture mismatch to fail" >&2; exit 1
fi
grep -q 'metadata architecture mismatch' "$TMP/wrong-arch.err"
printf 'tamper\n' >> "$IMAGE"
if PATH="$TMP/bin:$PATH" bash "$ROOT/scripts/validate-image.sh" "$IMAGE" amd64 2>"$TMP/checksum.err"; then
  echo "expected checksum mismatch to fail" >&2; exit 1
fi
grep -q 'checksum does not match' "$TMP/checksum.err"
printf 'tamper\n' > "$IMAGE"
REAL_HASH="$(sha256sum "$IMAGE" | awk '{print $1}')"
printf '%s  other.iso\n' "$REAL_HASH" > "$CHECKSUM"
if PATH="$TMP/bin:$PATH" bash "$ROOT/scripts/validate-image.sh" "$IMAGE" amd64 2>"$TMP/wrong-name.err"; then
  echo "expected checksum sidecar bound to a different filename to fail" >&2; exit 1
fi
grep -q 'expected fake.iso' "$TMP/wrong-name.err"
printf '%s  fake.iso\n%s  fake.iso\n' "$REAL_HASH" "$REAL_HASH" > "$CHECKSUM"
if PATH="$TMP/bin:$PATH" bash "$ROOT/scripts/validate-image.sh" "$IMAGE" amd64 2>"$TMP/multiple-lines.err"; then
  echo "expected multi-record checksum sidecar to fail" >&2; exit 1
fi
grep -q 'exactly one SHA-256 record' "$TMP/multiple-lines.err"
printf '%s  fake.iso\n' "$(printf '0%.0s' {1..64})" > "$CHECKSUM"
if PATH="$TMP/bin:$PATH" bash "$ROOT/scripts/validate-image.sh" "$IMAGE" amd64 2>"$TMP/wrong-hash.err"; then
  echo "expected wrong exact-image digest to fail" >&2; exit 1
fi
grep -q 'checksum does not match' "$TMP/wrong-hash.err"

# --- Realistic file(1) descriptor matrix ---------------------------------
# Each case rebuilds a consistent fixture set (image, sidecar, metadata) and
# requires PASS only when the kernel descriptor matches the expected
# architecture. Compressed kernels expose no architecture token and must fail
# closed for BOTH architectures; cross-architecture presentations must fail.
validate_style_case() {
  local style="$1" arch="$2" expect="$3" status=0
  printf 'synthetic image fixture\n' > "$IMAGE"
  (cd "$TMP" && sha256sum fake.iso > fake.iso.sha256)
  printf '{"architecture":"%s","format":"iso","image":"fake.iso"}\n' "$arch" > "$IMAGE.radar-os.json"
  PATH="$TMP/bin:$PATH" MOCK_KERNEL_STYLE="$style" bash "$ROOT/scripts/validate-image.sh" "$IMAGE" "$arch" "$TMP/style-report.json" >/dev/null 2>"$TMP/style.err" || status=$?
  if [[ "$expect" == pass ]]; then
    [[ "$status" -eq 0 ]] || { echo "expected $style/$arch to validate, exit=$status: $(cat "$TMP/style.err")" >&2; exit 1; }
    python3 - "$TMP/style-report.json" "$arch" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert r['validation']=='PASS' and r['architecture']==sys.argv[2]
PY
  else
    [[ "$status" -ne 0 ]] || { echo "expected $style/$arch to fail closed" >&2; exit 1; }
    grep -q 'kernel architecture could not be verified' "$TMP/style.err"
  fi
}
validate_style_case bzimage amd64 pass
validate_style_case arm64-image arm64 pass
validate_style_case pe-arm64 arm64 pass
validate_style_case elf-aarch64 arm64 pass
validate_style_case pe-amd64 amd64 pass
# A compressed kernel carries no architecture descriptor: fail closed, both ways.
validate_style_case gzip arm64 fail
validate_style_case gzip amd64 fail
# A kernel of the other architecture must never validate against this metadata.
validate_style_case arm64-image amd64 fail
validate_style_case pe-amd64 arm64 fail

echo "image validation tests passed: required metadata, exact image/hash binding, malformed/multiple checksum records, format and architecture, and realistic file(1) kernel descriptors (bzImage, ARM64 Image, AArch64/x86-64 PE, lowercase aarch64 ELF, compressed-kernel fail-closed)"
