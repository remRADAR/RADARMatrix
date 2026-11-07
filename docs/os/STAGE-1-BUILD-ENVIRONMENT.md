# Stage 1 build environment definition

## Environment

- **Primary:** ephemeral GitHub Actions runner (`ubuntu-latest`, 4 vCPU / 16 GB),
  destroyed after every run. live-build runs under `sudo` inside this ephemeral
  environment only; no host outside the runner is modified.
- Toolchain installed per run and recorded verbatim into
  `build-environment.txt`: live-build, live-tools, xorriso, file, python3,
  qemu-system-x86, qemu-system-arm, SeaBIOS (amd64 BIOS), AAVMF (arm64 EFI);
  firmware SHA-256 recorded; qemu-user-static + binfmt-support for arm64
  cross-builds on the amd64 runner.
- **Hardened future option (not required for Stage 1 dev images):** a pinned
  Debian container image with a recorded digest running the same pipeline.

## Required provenance record (per run)

- source SHA; base suite; architecture; immutable snapshot timestamp
- live-build, xorriso, file, python, QEMU versions
- firmware identity and SHA-256
- full unedited build log (`build.log`)
- ISO + SHA-256 sidecar + metadata sidecar (produced by `build-live.sh`)
- QEMU command line, serial log, QEMU stderr, boot evidence JSON (produced by
  `run-qemu.sh` via the boot wrappers)

## Privilege boundary

- Root (`sudo`) is used only inside the ephemeral runner for live-build's
  chroot phases. No privileged execution on any other host.
- No credentials are embedded in any workflow. The default GITHUB_TOKEN is
  read-only for build jobs; the real-kernel evidence workflow requests
  `contents: write` solely to commit machine-generated evidence JSON and
  restore executable bits via `git update-index`. GITHUB_TOKEN pushes do not
  re-trigger workflows.

## Reproducibility protocol

- Two independent builds: same source SHA, same immutable snapshot, same
  base/architecture/configuration, same recorded toolchain.
- Both image digests are recorded in `reproducibility.json`; a mismatch is
  recorded as **NOT REPRODUCIBLE** and fails the run. The requirement is never
  silently downgraded; differing digests trigger a nondeterministic-input
  investigation (timestamps are the first suspect).

## Executable-bit incident record (transport artifact)

- The GitHub contents API resets file mode 100755 -> 100644 on every pushed
  file; it cannot set the executable bit at all.
- Impact: CI runs 42331593152 and 42348935554 (direct invocations of
  `validate-image.sh` / `run-qemu.sh` -> exit 1) and 42349265380, 42349323490
  (direct invocations of `live/auto/config` -> exit 126). No assertion ever
  failed; every red run was a transport artifact.
- Heals: `f85287a` (bash-prefixed validate-image invocations; its own push
  stripped run-qemu.sh), `c4601e3` (bash-prefix across script-to-script
  invocations; a duplicated "bash" token and unprefixed `auto/config`
  invocations remained), `6caadd8` (`sh`-prefix on every `auto/config`
  invocation; corrected the run-qemu validator invocation).
- Permanent fixes: (1) every internal invocation uses an explicit interpreter
  prefix, so the pipeline is transport-independent; (2) the real-kernel
  validation workflow's git-client commit restores mode 100755 in the
  repository tree via `git update-index --chmod=+x`.

## Honest environment limits

- Teamily's agent sandbox (1 core / 2 GB) cannot build Debian Live; all real
  builds run in CI or on an owner-designated machine.
- A QEMU pass is not physical hardware validation. Physical-readiness evidence
  requirements remain unmet until tests run on the actual devices.
