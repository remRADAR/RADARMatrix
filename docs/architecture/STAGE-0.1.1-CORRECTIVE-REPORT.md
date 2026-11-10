# Stage 0.1.1 corrective report — F-00 through F-03

**Branch:** `architecture/stage-0-1-1-corrections-verified` (base `5e00162f70d17fedf0c5b7c9d3cb43cdd866133c`, the reviewed PR #14 head)
**Date:** 2026-11-06
**Status vocabulary:** *implemented* / *tested locally* / *verified in this environment*. Nothing here is deployed, merged, or staging-verified.

This report corrects defects found by **executing** the Stage 0.1.1 branch rather than reading it. Two of the four defects invalidate claims carried in PR #14.

---

## F-00 (BLOCKER) — The test harness is fail-open; every "tests pass" claim is unverifiable

**Evidence.**

`tests/test-runner.mjs` ended with:

```js
process.exit(0);
```

and the suites caught assertion errors, printed `✗ <name>`, and continued without counting. The orchestrator therefore always exited 0.

Reproduced on the unmodified PR #14 head (`5e00162`). One expectation was inverted in `tests/v0.7-gateway.test.mjs`:

```bash
npm test  >/tmp/soft.log 2>&1; echo "EXIT=$?"
grep -c "✗" /tmp/soft.log
```

```
EXIT=0
3
```

Three failing assertions printed, exit code **0**, and the final banner still read *"All foundation tests executed"*.

A thrown suite did abort the process (a second control test showed exit 1), so the defect was specific to assertion failures — the common case.

**Why it matters.** PR #14 states that `npm test` passed and that CI relied on exit codes. On this branch there is no CI workflow at all (see F-01), so the local exit code was the only signal, and it was constant.

**Correction.**

1. New `tests/harness.mjs` — one shared, process-wide failure counter (`recordFailure`, `getFailures`, `getFailureCount`, `resetFailures`, `check`).
2. `tests/test-runner.mjs` rewritten. Rather than editing ~3400 lines of suite bodies, the runner **taps** `console.log`/`console.error` while each suite runs, forwards every line unchanged, and counts lines beginning with `✗` into the shared counter. The two assert-based suites (`agent-routing`, `brand-gateway-routing`) throw on failure and are caught as suite-level failures. **Both marker-printing suites remain byte-identical to the reviewed head** — no assertion was weakened, deleted, or skipped.
3. New `os/radar-os/tests/harness-fail-closed.test.sh` — a regression test for the harness itself. It copies the repo to a temp dir, requires the clean run to exit 0 and report `RESULT: PASSED`, then inverts one assertion and requires a non-zero exit and `RESULT: FAILED`. Wired into `npm run test:os-scaffold`.

**Verification (executed in this environment).**

| Run | Condition | Exit | Reported |
|---|---|---|---|
| A | unmodified, clean | **0** | `RESULT: PASSED`, 4 suites, 71 checks passed, 0 failed |
| B | one assertion inverted | **1** | `RESULT: FAILED`, 6 failed checks, `MCP Gateway (v0.7)` listed |
| C | `harness-fail-closed.test.sh` | **0** | clean exits 0, injected failure exits non-zero |

The same inverted-assertion experiment that returned exit 0 before the fix now returns exit 1.

---

## F-01 (BLOCKER) — No CI workflow exists on `main` or on the Stage 0.1.1 branch

**Evidence.** Only one workflow exists on either ref:

```
$ git ls-tree -r --name-only main -- .github
.github/workflows/deploy-staging.yml
$ git ls-tree -r --name-only origin/architecture/stage-0-1-1-review-corrections -- .github
.github/workflows/deploy-staging.yml
```

`deploy-staging.yml` triggers only on `push` to a `staging` branch. It runs no tests.

`ci.yml` exists only on `phase1/discovery-and-foundation`, `chat/m2-production-auth-v2`, `security/m2-2-3-authority-hardening` — branches that were never merged. It was lost when the Phase 1 branch stopped being the integration target.

Consequently the only check run on PR #14's head is `Vercel Preview Comments` (success).

**Correction.** Added `.github/workflows/ci.yml`:

- `tests` job — `npm test` with the pipeline status extracted from `PIPESTATUS` and re-exited, a swallowed-`✗` guard, an assertion that the runner printed `RESULT: PASSED`, console typecheck, and the fail-closed deployment smoke.
- `os-scaffold` job — `bash -n` over every OS script, plus the four OS regression suites.
- An explicit step that **states the boot-evidence boundary**: this job does not build an ISO or boot QEMU, because the runner is not provisioned with live-build/QEMU/firmware. It must not be read as proof that an OS boots.

**Status:** added; the run itself is the next observable event and is reported in the PR, not assumed here.

---

## F-02 — `validate-image.sh` rejected every ISO that is not Debian Live

**Evidence.** The repository `validate-image.sh` hardcoded a single kernel path:

```bash
xorriso -osirrox on -indev "$IMAGE" -extract /live/vmlinuz "$TMP/vmlinuz" || {
  echo "FAIL: cannot extract /live/vmlinuz to establish image architecture" >&2; exit 1; }
```

Run against a genuinely bootable, isolinux-based ISO built in this environment, it failed:

```
FAIL: cannot extract /live/vmlinuz to establish image architecture
VALIDATE_EXIT=1
```

The image was valid — `file` reported `ISO 9660 CD-ROM filesystem data (DOS/MBR boot sector) 'RADAROS' (bootable)` and it booted (F-03). The tool refused a correct artifact because of an assumed layout. Its only coverage came from a synthetic fixture that mocked `xorriso` to write any path requested, so the assumption was never exercised.

This is a *widening of the search path*, not a weakening of the check: the architecture claim is still proven from the extracted kernel binary via `file`, and format, checksum sidecar, metadata sidecar, and SHA-256 are unchanged.

**Correction.** The kernel is located across the layouts in use — `/live/vmlinuz*`, `/vmlinuz*`, `/boot/vmlinuz*`, `/casper/vmlinuz` — and the chosen path is recorded in the report as `kernel_path`. If none is found the tool fails closed with the list it searched.

**Verification.** Against the real ISO:

```
PASS: image format, architecture, checksum, and metadata validated
kernel_path: /live/vmlinuz
kernel: Linux kernel x86 boot executable bzImage, version 6.1.0-54-amd64
result: PASS
```

---

## F-03 — "No image / no boot" is no longer accurate; a real boot now exists

PR #14 and the baseline both state that `lb`, QEMU, and firmware are absent, so *"no Debian Live image, ISO architecture inspection, QEMU boot, firmware validation, or hardware result can be claimed."* That was true of the environment as previously provisioned. It is no longer the state of the evidence: a bootable image was built and booted **in this environment**, and the evidence is committed under `os/radar-os/evidence/`.

| Item | Value |
|---|---|
| Image | `radar-os-amd64.iso`, ISO-9660, `(bootable)` |
| ISO SHA-256 | `248574292632e38ed4e94d9e17ffcca55b54214551c7b1aebc8969391cc3cbe4` |
| Kernel | `6.1.0-54-amd64` (Debian `linux-image-amd64`), x86_64 |
| Bootloader | ISOLINUX 6.04 (SeaBIOS → El Torito → ISOLINUX) |
| Userspace | BusyBox 1.35.0 static, custom `/init` PID 1 |
| Firmware used | `/usr/share/seabios/bios-256k.bin` |
| Firmware SHA-256 | `2da2018c7555e50b660a84a273a14a79cb87b9070fe6a90e9f151a53e357f7e6` |
| QEMU | 7.2.22, `-machine q35`, 1024 MB |
| Readiness marker | `BOOT_EVIDENCE_OK` |

Serial output captured from the guest, via the repository's **own** `os/radar-os/scripts/run-qemu.sh`:

```
RADAR-OS: kernel=6.1.0-54-amd64 arch=x86_64
RADAR-OS: initramfs unpacked; /proc /sys /dev mounted
RADAR-OS: Multi-User System. Reached target multi-user.target
RADAR-OS: BOOT_EVIDENCE_OK
PASS: serial readiness marker observed
RUNQEMU_EXIT=0
```

The capture also shows a live BusyBox prompt after readiness, i.e. PID 1 remained running rather than the marker being a last gasp.

Evidence files: `qemu-boot-amd64.json` (`os_ready: true`, `qemu_process_started: true`, `terminated_after_readiness: true`, `duration_seconds: 7`), `image-validation-amd64.json`, `serial-amd64-boot.txt`, `serial-amd64-ready.txt`.

**Scope of this evidence — what it does and does not prove.** It proves that a kernel on this ISO booted under emulation, mounted its pseudo-filesystems, reached the multi-user readiness marker from PID 1, and that `run-qemu.sh` correctly distinguished process-start from readiness. It does **not** prove: a Debian Live root filesystem built by `live-build`, a desktop session, the RADAR OS application stack, real hardware, ARM64, signed/verified boot, or any release/update flow. The ISO is a minimal boot-proving artifact, not a RADAR OS distribution.

Two build defects were found and fixed while producing it, worth recording because they are the kind of thing that silently produces a non-booting image:

- The initial cmdline ended with `console=tty0`, which makes `/dev/console` the VGA console; under `-display none` all init output was discarded and the boot looked hung. Fixed by putting `console=ttyS0,115200` last and having `/init` explicitly redirect to `/dev/ttyS0`.
- The first ISO had the kernel at `/vmlinuz`, which F-02 then rejected. Rebuilt to the Debian Live layout (`/live/vmlinuz`, `/live/initrd.gz`).

---

## Test results — executed, not asserted

```
$ npm test; echo "FULL_EXIT=$?"
FULL_EXIT=0
  Suites:              4 run, 0 failed
  Checks passed:       71
  Checks failed:       0
RESULT: PASSED (all suites green, zero recorded failures)
manifest tests passed: common and architecture-specific package lists are isolated and wired into Debian Live
image validation tests passed: valid evidence reports, missing evidence, architecture mismatch, and checksum mismatch
QEMU tests passed: firmware is mandatory; process start and OS readiness are distinguished for AMD64 and ARM64
test harness tests passed: clean run exits 0 and a single injected assertion failure exits non-zero
```

---

## What is still not done — stated plainly

1. **No independent review.** PR #14 asked Mistral Vibe to review `5e00162`; this report is the implementer's own work and cannot substitute for that.
2. **No merge, no deployment, no DNS/secret/credential/paid-resource change.** `main` is untouched.
3. **ARM64 boot not attempted.** `qemu-system-aarch64`, an ARM64 kernel, and AArch64 firmware are not provisioned here.
4. **`live-build` not used.** The image was assembled manually (kernel + initramfs + isolinux + xorriso). A `live-build`-produced Debian Live image remains unbuilt.
5. **Halo OS, Matrix IDE, Cloud Computer, and Operator Screen are not implemented** beyond the pre-existing Console prototype from merged PR #11.
6. **Production OAuth/OIDC remains NOT IMPLEMENTED**, as PR #14 correctly states.
7. **The M2 security stack is still unmerged** (#3, #5, #6, #7, #8, #10, #12, #13 all open), so no trusted-authority or execution-isolation control is in `main`.
