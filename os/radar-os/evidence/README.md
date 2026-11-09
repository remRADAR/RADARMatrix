# RADAR OS evidence

**Rule: evidence is only evidence if you can cite the workflow run id and head
SHA that produced it.** A JSON file in this directory is not proof by itself.

## Current contents

| File | Real? | What it proves |
| --- | --- | --- |
| `real-kernel-validation.json` | **Yes** — run `42435089947`, head `84d8ed07` | The kernel-architecture validator accepts same-arch kernels and fails closed on cross-arch and descriptor-less kernels. Does **not** prove an OS boots. |
| `owner-gate-blocked-run.json` | **Yes** — run `42546369451`, head `d98649ec` | The owner base-approval gate blocks a build in real CI when the decision record is pending, even though the dispatch input claimed approval. Steps 4–9 skipped; no ISO, no boot. |
| `quarantined/` | **No** — see `quarantined/QUARANTINE.json` | Nothing. These claimed a build and boot that never happened. Kept only as a record of the problem. |

## What is NOT proven

- No AMD64 ISO has been built.
- No ISO has booted under QEMU.
- ARM64/AAVMF boot has never been attempted.
- The flash-drive bootstrap has never been executed.
- No television has booted RADAR OS.

See `docs/os/EVIDENCE-INTEGRITY.md` for how the quarantined files were shown to
be fabricated, and `docs/os/TV-BOOT.md` for the bootstrap procedure.

## How real evidence is produced

Dispatch `.github/workflows/radar-os-stage1-build.yml`. It refuses to run unless
`docs/os/DEBIAN-BASE-DECISION.json` is `approved` and agrees with the dispatch
inputs. A successful run uploads, as artifacts:

- `out/build.log` — the full unedited live-build log
- `out/*.iso` — the image itself
- `out/*.sha256` — the checksum sidecar
- `out/*.radar-os.json` — the build metadata sidecar
- `out/serial.log` — the full serial console capture
- `out/serial.log.qemu-stderr` — QEMU's own stderr
- `out/serial.log.command` — the exact QEMU argv, so a reviewer can re-run it
- `out/qemu-boot-evidence.json` — the staged boot record
- `build-environment.txt` — toolchain and firmware versions

Only after such a run exists may a boot be described as achieved. The evidence
JSON must show `"verdict": "PASS"` with `"initramfs_failure_signatures": []`.

## Boot stages

`qemu-boot-evidence.json` (schema `radar-os-qemu-evidence/v2`) reports stages
independently, because they fail independently:

```json
"stages": {
  "qemu_process_started": true,
  "kernel_started": true,
  "userspace_ready": true,
  "desktop_ready": false
}
```

`os_ready` is true only when `userspace_ready` is true. A run that reaches a
BusyBox `(initramfs)` shell is recorded as `FAIL_INITRAMFS` and exits non-zero —
it is never reported as a boot.
