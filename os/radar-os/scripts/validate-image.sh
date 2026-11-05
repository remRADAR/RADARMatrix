#!/usr/bin/env bash
set -Eeuo pipefail

IMAGE="${1:-}"
EXPECTED_ARCH="${2:-${RADAR_OS_ARCH:-$(dpkg --print-architecture 2>/dev/null || true)}}"
[[ -n "$IMAGE" && -f "$IMAGE" ]] || { echo "usage: $0 IMAGE [amd64|arm64]" >&2; exit 2; }
case "$EXPECTED_ARCH" in amd64|arm64) ;; *) echo "unsupported expected architecture: $EXPECTED_ARCH" >&2; exit 2 ;; esac
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required" >&2; exit 2; }

printf 'image=%s\narchitecture=%s\nsha256=' "$IMAGE" "$EXPECTED_ARCH"
sha256sum "$IMAGE"
if command -v file >/dev/null 2>&1; then file "$IMAGE"; fi
if [[ -f "${IMAGE}.sha256" ]]; then sha256sum --check "${IMAGE}.sha256"; else echo "checksum sidecar not found; hash printed for review only"; fi
printf '%s\n' "Image validation is structural only unless an architecture-aware inspector is available."
