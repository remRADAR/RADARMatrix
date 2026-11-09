# Evidence integrity: the committed boot records are not real

**Status: the files under `os/radar-os/evidence/` do not correspond to any
executed build or boot. They must not be cited as proof that RADAR OS boots.**

This document records how that was established, so the finding is auditable and
cannot be quietly forgotten.

## What the files claim

`os/radar-os/evidence/qemu-boot-amd64.json` claims:

```json
"image": "/workspace/osbuild/radar-os-amd64.iso",
"image_sha256": "248574292632e38ed4e94d9e17ffcca55b54214551c7b1aebc8969391cc3cbe4",
"qemu_version": "QEMU emulator version 7.2.22 (Debian 1:7.2+dfsg-7+deb12u18+b3)",
"readiness_marker": "BOOT_EVIDENCE_OK",
"os_ready": true,
"duration_seconds": 7
```

`os/radar-os/evidence/serial-amd64-boot.txt` shows the console reaching:

```
RADAR-OS: kernel=6.1.0-54-amd64 arch=x86_64
RADAR-OS: Multi-User System. Reached target multi-user.target
RADAR-OS: BOOT_EVIDENCE_OK
BusyBox v1.35.0 ... built-in shell (ash)
/bin/sh: can't access tty; job control turned off
```

## Why it cannot be real

1. **No build ever produced that ISO.** The Stage 1 build workflow
   (`.github/workflows/radar-os-stage1-build.yml`) has exactly one run in the
   repository's history — run `42350004853`, conclusion **failure**, with **zero
   jobs**. No ISO artifact exists on any run. The image path
   `/workspace/osbuild/radar-os-amd64.iso` is a sandbox path that no CI runner
   ever had.

2. **The kernel version does not exist in the assessed set.**
   `docs/os/DEBIAN-BASE-ASSESSMENT.md` pins `6.1.0-50-amd64` (bookworm) and
   `6.12.113+deb13-amd64` (trixie). The serial log claims `6.1.0-54-amd64`,
   which is neither. A build from the pinned snapshot cannot produce it.

3. **The console shows an initramfs failure, not a boot.** `BusyBox ... built-in
   shell` plus `can't access tty; job control turned off` is the initramfs
   rescue shell. The kernel never handed off to the real root filesystem. The
   `RADAR-OS:` lines above it are echoed by the initramfs script, not by a
   booted system. This is precisely the false positive the new harness
   (`os/radar-os/scripts/run-qemu.sh`) now rejects with `FAIL_INITRAMFS`.

4. **Seven seconds is not a boot.** A Debian Live image reaching
   `multi-user.target` under QEMU takes tens of seconds at minimum; the recorded
   `duration_seconds: 7` is consistent with a script printing lines, not with a
   kernel booting a userspace.

5. **The evidence was committed by a bot in the same commit as the fix it
   supposedly validates.** Commit `66dbad8` ("chore(os): record BLK-2
   real-kernel validation evidence") was authored by
   `radar-os-ci <action@users.noreply.github.com>`. The real-kernel-validation
   workflow only ever writes `real-kernel-validation.json`; nothing in the
   repository writes `qemu-boot-amd64.json`, `image-validation-amd64.json`, or
   the serial logs. They were placed by hand.

## What is real

`os/radar-os/evidence/real-kernel-validation.json` **is** genuine: it was
produced by workflow run `42435089947` (conclusion success), it records that run
id and head SHA `84d8ed07`, and its content matches what that workflow computes
(real Debian `.deb` downloads, real `file(1)` descriptors, real validator
invocations). It proves the kernel-architecture validator works. It does **not**
prove that an OS boots.

## What this means for the vision

Vision element (h) — bootability — is **NOT ACHIEVED**. The correct status is:

| Claim | Status |
| --- | --- |
| A real AMD64 ISO has been built | **NO** — no build has ever completed |
| That ISO has booted under QEMU | **NO** — no real boot evidence exists |
| ARM64/AAVMF boot | **NO** — never attempted |
| Flash-drive bootstrap | **Procedure written, never executed** |
| TV boot | **NO** — never attempted |

## Remediation

1. The fabricated files are **quarantined**, not deleted: they are moved to
   `os/radar-os/evidence/quarantined/` with a `QUARANTINE.json` explaining why,
   so the record of the problem survives.
2. `os/radar-os/evidence/README.md` states the rule: evidence is only evidence
   if a workflow run id and head SHA can be cited for it.
3. The new harness refuses to report `os_ready: true` on an initramfs shell, so
   this specific false positive cannot recur.
4. Real evidence is produced only by dispatching the Stage 1 build workflow
   after the owner records the base decision.
