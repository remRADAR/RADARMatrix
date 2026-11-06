# Stage 0.1.1 audit closure — implementation evidence

**Snapshot date:** 2026-11-06  
**Repository:** `remRADAR/RADARMatrix`  
**Main SHA at inventory:** `91d95170a541a2355c409b2a2d0c8f30e1b20e71`  
**Authoritative corrective workstream:** `architecture/stage-0-1-1-corrections-verified`, stacked on PR #14.  
**Scope:** source-level fixes and regression evidence only. Mistral Vibe's independent verdict on PR #15 head `d863939` is **ACCEPTED WITH NON-BLOCKING FINDINGS**. That verdict is not release certification, a real ARM64 boot record, or declaration that all operating-system acceptance gates have passed.

## Repository and PR inventory

- `main` points to `91d95170a541a2355c409b2a2d0c8f30e1b20e71` at the time checked.
- PR #11, “Prototype: RADARMatrix Console v1”, is merged. The Console prototype is part of main.
- PR #12 is an open draft from `security/m2-3-1-boundary-contracts` based on `security/m2-2-3-authority-hardening`; it is not part of main.
- PR #13, “Stage 0.1: close architecture and scaffold RADAR OS foundation”, is an open draft from `architecture/stage-0-1-closure` based on `main` (base SHA at PR inspection: `93c1dc18f04faae015c0afdd196c854278f5bee1`). It is not merged.
- PR #14, “Stage 0.1.1: correct review findings F-01–F-05”, is open as a draft from `architecture/stage-0-1-1-review-corrections` at `5e00162f70d17fedf0c5b7c9d3cb43cdd866133c`, based on main.
- PR #15, “fix(stage-0.1.1): fail-closed test harness, real CI, validated boot evidence (F-00..F-03)”, is the corrective continuation from `architecture/stage-0-1-1-corrections-verified` at audited head `d863939cbcacf86f302fa42806db6f3b8855c86f`, based on PR #14's head. It remains an open draft. CI run [42297311871](https://github.com/remRADAR/RADARMatrix/actions/runs/42297311871) passed both “Tests and typecheck” and “RADAR OS script checks”. The independent verdict on this exact head is accepted with non-blocking findings.
- The sandbox used for this execution had no pre-existing RADARMatrix checkout or uncommitted project work; a new checkout was cloned to continue the existing remote PR #15 branch. No remote branch was reset, force-pushed, or deleted.

## Finding-by-finding status

| Finding | Implemented in this workstream | Verification / remaining boundary |
|---|---|---|
| AUD-01 — Architecture-specific serial console and real guest readiness | Debian Live config now appends `console=ttyS0,115200n8` for AMD64 and `console=ttyAMA0,115200n8` for ARM64, enables systemd status output, and targets `multi-user.target`. | Manifest/config regression asserts both exact boot append strings. This is source-level evidence only; real guest readiness must still be demonstrated on both architectures. |
| AUD-02 — ARM64 boot media and firmware validation | ARM64 QEMU runner now uses explicit virtio-SCSI + SCSI-CD media and the required caller-supplied firmware file; no firmware path is guessed. QEMU's architecture-specific binary, `virt` machine selection, and firmware/image hashes are recorded. | Mock tests assert the media topology and firmware-required fail-closed path. No actual ARM64 firmware/QEMU boot is claimed; QEMU is expected to reject incompatible firmware at execution, and that real validation remains pending. |
| AUD-03 — Exact-image checksum sidecar binding | Validator accepts exactly one SHA-256 sidecar record, requires its filename to equal the ISO basename, then compares the digest to that exact image. | Regression cases cover valid binding, missing and malformed/multiple records, a different filename, wrong digest, and metadata/architecture mismatch. |
| AUD-04 — Authentication documentation consistency | The root README labels protected-resource metadata as discovery metadata only. The v0.8 integration guide labels its future bearer-token example “NOT IMPLEMENTED” and explicitly distinguishes it from development `caller_id` fixtures. | Documentation inspection; no OAuth implementation is claimed or added. |
| AUD-05 — Reproducible, architecture-isolated Debian Live builds | Build wrapper copies the Live config into a fresh temporary workspace per architecture. Real builds require an explicit Debian Snapshot timestamp and use snapshot URLs for bootstrap, chroot, binary, and security repositories; provenance records architecture and timestamp. | The configuration is tested with a mocked `lb`; this environment did not run `lb build`. A bit-for-bit repeat-build comparison has not been performed, so full reproducibility is not certified. |
| AUD-06 — Pull-request CI and test execution | Existing PR #15 work adds `.github/workflows/ci.yml`, separating product tests from OS script checks and stating that the workflow does not build/boot an ISO. | CI run `42297311871` on exact head `d863939` passed both CI jobs; it did not build or boot an ISO. |
| AUD-07 — Test-runner failure propagation | Existing PR #15 work counts failed assertions and exits non-zero; the harness regression injects an inverted assertion and checks failure. | At `d863939`, local `npm test` passed 71 JavaScript checks and all five OS scaffold scripts, including the failure-injection harness regression. |
| AUD-08 — Accurate repository and PR inventory | This document records the observed main SHA and the relevant PR #11–#15 states and branch relationships, and distinguishes merged Console code from draft work. | Inventory is a timestamped snapshot; refresh it before any later release or merge decision. |

## Current verification and blockers

At PR #15 head `d863939`, local verification passed: 71 JavaScript checks, all five OS scaffold scripts, Bash syntax checks, Matrix Console typecheck/build/smoke, production-mode fail-closed smoke, and `git diff --check`. CI run `42297311871` passed both jobs. The Mistral Vibe independent verdict was **ACCEPTED WITH NON-BLOCKING FINDINGS**.

The archived evidence contains a prior minimal AMD64 QEMU boot; its JSON and serial records do not capture the QEMU memory argument. The earlier report's `1024 MB` claim is withdrawn; runner source at the evidence commit and audited head specifies `-m 2048`, but actual executed memory is not recorded in the retained evidence. Not verified: a Debian Live build, repeat-build bit identity, a new real QEMU boot under the final source state, ARM64 boot with actual firmware, desktop readiness, real hardware, production OAuth/OIDC, Halo OS, Matrix IDE, Cloud Computer, or product-level runtime capabilities. Debian 13 Trixie remains subject to owner approval. PR #15 must not be merged without owner approval; no production deployment is authorized.
