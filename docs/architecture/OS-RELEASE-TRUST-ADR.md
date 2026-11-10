# ADR: RADAR OS Release Trust and Recovery

**Status:** Proposed; owner review required.
**Scope:** Design and development metadata only. No production signing keys, signed production images, or automatic updates are created.

## Trust chain

A future release consists of an image plus a manifest containing release version, target architecture, base/profile identity, build provenance, package-source snapshot, image size, SHA-256 checksum, compatibility contract versions, and recovery metadata. Release metadata is signed by a production release key held outside the repository and verified before installation.

Development/validation signing, if later introduced, must use clearly separate non-production keys and labels. Development signatures must never be accepted by a production updater.

## Update channels

At minimum, separate development, validation, and production channels. A device must opt into a channel, verify target architecture and minimum supported contract versions, reject downgrade/rollback violations, and retain the previous known-good bootable system until the new system passes health checks.

## Recovery

The updater must stage artifacts atomically, verify checksum and signature before activation, preserve a rollback target, and record update state. Boot failure or health-check failure returns to the previous target or recovery image. Recovery must remain possible without cloud connectivity.

## Key lifecycle

Production signing keys require protected ownership, rotation, revocation, and offline/recovery procedures. No production private key belongs in Git, images, CI logs, or this sandbox. Key rotation must support overlapping verification keys and explicit revocation metadata.

## Secure boot

Secure Boot compatibility is a future platform-specific design involving firmware keys, bootloader signing, kernel/module policy, and reference hardware. QEMU boot success does not prove physical Secure Boot compatibility.

## Implementation status

**NOT IMPLEMENTED.** Stage 0.1 may define manifests and validation interfaces but does not generate or provision production keys, configure automatic updates, or distribute production images.
