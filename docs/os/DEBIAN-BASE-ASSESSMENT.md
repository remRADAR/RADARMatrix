# Debian base decision: Bookworm (12) vs Trixie (13)

**Status: PENDING owner approval.** No Stage 1 production build has executed.
This document exists so the owner can decide; the Stage 1 build workflow
(`.github/workflows/radar-os-stage1-build.yml`) hard-gates every dispatched run
on the `owner_base_approval` input and refuses to build without it.

## Verified facts (checked 2026-11-07 against snapshot.debian.org)

- Immutable snapshot **20261101T000000Z** exists and serves both the `debian`
  and `debian-security` archives (snapshot mirror run 2026-10-31 20:28:58 UTC).
- Pinned real kernel packages exist in both suites at that snapshot:
  - bookworm amd64: `linux-image-6.1.0-50-amd64_6.1.176-1_amd64.deb`
  - bookworm arm64: `linux-image-6.1.0-50-arm64_6.1.176-1_arm64.deb`
  - trixie amd64: `linux-image-6.12.113+deb13-amd64_6.12.113-1_amd64.deb`
  - trixie arm64: `linux-image-6.12.113+deb13-arm64_6.12.113-1_arm64.deb`
  - (linux-signed source versions: bookworm 6.1.176+1, trixie 6.12.113+1)
- `os/radar-os/live/auto/config` defaults to `--distribution trixie` and
  accepts `RADAR_OS_DISTRIBUTION=bookworm|trixie`; anything else fails closed,
  so the selected base is actually built, never silently substituted.

## Comparison

| Dimension | Bookworm (Debian 12) | Trixie (Debian 13) |
| --- | --- | --- |
| Kernel | Linux 6.1 LTS (older hardware support) | Linux 6.12 LTS (current hardware support) |
| Support position (Nov 2026) | oldstable; past full security support, in Debian LTS until mid-2028 | current stable; full vendor security support until ~mid-2028, LTS until ~mid-2030 |
| live-build compatibility | supported | supported; current live-build defaults target it |
| Risk for Stage 1 | older toolchain behavior; shrinking security coverage | newest kernel/firmware requirements for very old hardware are the only plausible downside |

## Recommendation

**Debian 13 "trixie"** (the `auto/config` default): it is the current stable
line in full vendor security support with the longer runway (to ~2030), the
newer longterm kernel for current hardware, and the suite that current
live-build is primarily tested against. Bookworm remains a viable fallback if
a specific constraint appears; the pipeline supports both bases through
`RADAR_OS_DISTRIBUTION` with the same immutable snapshot pinning.

## What this decision does NOT authorize

Recording a base choice does not merge any PR, deploy anything, or change DNS.
The first real Stage 1 build runs only from the dispatch-gated workflow after
the owner records this decision.
