# RADAR OS Foundation Scaffold

**Status:** Stage 0.1 development/validation scaffold; **not a bootable release.**
No ISO has been built and no boot has been proven. See
`docs/os/EVIDENCE-INTEGRITY.md` — the previously committed boot records were
fabricated and are now quarantined under `evidence/quarantined/`.

RADAR OS is the bootable Linux foundation beneath Halo OS. This directory deliberately contains configuration, profiles, and non-destructive validation scripts only. It does not contain a kernel, privileged RADAR service, agent runner, production key, automatic updater, or physical-device installer.

## Proposed base

Debian 13 Trixie is the current proposal because it provides a mature kernel, systemd, package ecosystem, architecture support, and Debian Live tooling. The selection remains an owner decision. KDE Plasma with Wayland is the proposed future desktop substrate for Halo OS; the full Halo Shell is explicitly out of scope here.

## Layout

- `live/` — minimal Debian Live configuration entry point.
- `config/` — common and architecture-specific package manifests. AMD64 and ARM64 kernel packages are intentionally excluded from the common manifest.
- `profiles/amd64/` and `profiles/arm64/` — architecture-specific decisions.
- `qemu/` — documented virtual-machine targets.
- `scripts/` — safe build/image validation/boot command wrappers.
- `tests/boot/` — acceptance evidence format; no fabricated boot result.

## Build contract

The build wrapper uses a fresh temporary workspace per architecture, so generated configuration and package lists cannot leak between AMD64 and ARM64. For a real build, set `RADAR_OS_RUN_LB=1` and an immutable `RADAR_OS_SNAPSHOT_TIMESTAMP` (format `YYYYMMDDTHHMMSSZ`); bootstrap, chroot, binary, and security repositories are directed to that Debian Snapshot timestamp. Example: `RADAR_OS_ARCH=amd64 RADAR_OS_RUN_LB=1 RADAR_OS_SNAPSHOT_TIMESTAMP=20261106T000000Z os/radar-os/scripts/build-live.sh`. The timestamp and architecture are recorded in build metadata. This pins repository state but does not, by itself, establish bit-for-bit reproducibility; a real build and repeat-build comparison are still required. The first image is a development/validation image, not a production release. Production signing keys and update channels are not configured here.

`RADAR_OS_ARCH=amd64|arm64 os/radar-os/scripts/build-live.sh` requires an explicit target architecture and generates Debian Live `config/package-lists` from the common plus matching architecture manifest. `RADAR_OS_RUN_LB=1` requires an explicit snapshot date and is intended only for an approved build environment. A produced ISO is accepted only with an exact-image `.sha256` sidecar, matching `.radar-os.json` metadata, ISO-9660 format evidence, and extracted kernel architecture evidence; the validator supports Debian Live, root, boot, and casper kernel paths. See `qemu/README.md` for boot test arguments and evidence files.

## Safety boundary

Scripts check dependencies and image paths, use explicit output directories, avoid host-disk mutation and privileged operations, and fail with a documented blocker when required tools are absent. QEMU boot success would validate only the selected virtual machine; it would not prove physical ARM compatibility.
