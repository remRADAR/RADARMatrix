# RADAR OS Foundation Scaffold

**Status:** Stage 0.1 development/validation scaffold; not a bootable release.

RADAR OS is the bootable Linux foundation beneath Halo OS. This directory deliberately contains configuration, profiles, and non-destructive validation scripts only. It does not contain a kernel, privileged RADAR service, agent runner, production key, automatic updater, or physical-device installer.

## Proposed base

Debian 13 Trixie is the current proposal because it provides a mature kernel, systemd, package ecosystem, architecture support, and Debian Live tooling. The selection remains an owner decision. KDE Plasma with Wayland is the proposed future desktop substrate for Halo OS; the full Halo Shell is explicitly out of scope here.

## Layout

- `live/` — minimal Debian Live configuration entry point.
- `config/` — common package and build policy.
- `profiles/amd64/` and `profiles/arm64/` — architecture-specific decisions.
- `qemu/` — documented virtual-machine targets.
- `scripts/` — safe build/image validation/boot command wrappers.
- `tests/boot/` — acceptance evidence format; no fabricated boot result.

## Build contract

A future build must pin package sources and record profile, architecture, source snapshot, package manifest, build log, image name, checksum, and provenance. The first image is a development/validation image, not a production release. Production signing keys and update channels are not configured here.

## Safety boundary

Scripts check dependencies and image paths, use explicit output directories, avoid host-disk mutation and privileged operations, and fail with a documented blocker when required tools are absent. QEMU boot success would validate only the selected virtual machine; it would not prove physical ARM compatibility.
