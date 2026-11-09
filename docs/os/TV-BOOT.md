# Booting RADAR OS on a television

This is the owner's bootstrap path, end to end:

> load the OS onto a flash drive and boot a television from it

## Status: NOT YET PROVEN

No RADAR OS image has been built, and no television has booted from one. The
Stage 1 build workflow has never completed a build (its only run failed before
producing an image), and the committed `os/radar-os/evidence/` boot records do
not correspond to any real run — see `docs/os/EVIDENCE-INTEGRITY.md`.

Everything below is the **procedure**, written so it can be executed the moment
the owner records the Debian base decision. It is not a claim of a result.

## What a television actually requires

A TV is not a PC. Three things decide whether this works, and none of them are
under our control from a build script:

| Requirement | Why it matters | How we handle it |
| --- | --- | --- |
| **Bootable input** | Most TVs boot only from their own firmware, not from USB. | The TV must expose USB boot (many do via a service menu or "USB media" source), or the stick must be plugged into a device that does (mini-PC, HDMI stick, set-top box). |
| **Firmware mode** | TVs are overwhelmingly UEFI, often 64-bit x86 or ARM. | The ISO is `iso-hybrid`, so it boots under both legacy BIOS and UEFI. ARM64 needs AAVMF/UEFI firmware. |
| **Display output** | A TV is an HDMI sink with no keyboard. | The image must reach a graphical target and accept input from USB HID. Until the desktop stage is real, a TV will show a text console at best. |

**Honest conclusion:** "boot a television from a flash drive" is achievable only
through a device that presents the TV as a display. The realistic Stage 1 target
is a **mini-PC or HDMI stick running RADAR OS, displayed on the TV**. A TV's own
SoC booting our ISO is a separate, hardware-specific problem that this repo does
not yet address.

## Procedure

### 1. Build and validate the image (CI)

Dispatch `.github/workflows/radar-os-stage1-build.yml` with:

- `owner_base_approval: owner-has-approved` (must match the committed decision record)
- `base`: the owner-approved suite
- `arch`: `amd64` (TV-attached mini-PC) or `arm64` (ARM stick)
- `snapshot`: the owner-approved immutable snapshot

The workflow refuses to run unless `docs/os/DEBIAN-BASE-DECISION.json` is
`approved` and agrees with the dispatch inputs. It produces the ISO, its
`.sha256` sidecar, its `.radar-os.json` metadata, the full build log, the serial
log, and `qemu-boot-evidence.json`.

### 2. Confirm the QEMU boot evidence is a real PASS

Open `qemu-boot-evidence.json` and check:

```json
"stages": { "kernel_started": true, "userspace_ready": true },
"initramfs_failure_signatures": [],
"verdict": "PASS"
```

A `verdict` of `FAIL_INITRAMFS` means the kernel reached a rescue shell and the
image is **not** bootable — do not write it to a stick.

### 3. Write the flash drive

On the operator machine, with the stick inserted:

```bash
lsblk -o NAME,SIZE,TRAN,REMOVABLE   # identify the stick, e.g. /dev/sdb
sudo os/radar-os/scripts/bootstrap-usb.sh \
  --image out/radar-os-amd64.iso \
  --arch amd64 \
  --device /dev/sdb \
  --confirm-bytes "$(sudo blockdev --getsize64 /dev/sdb)" \
  --record bootstrap.json
```

The script refuses to write unless the image validates, the device is
**removable**, unmounted, not the running root, and its exact size matches
`--confirm-bytes`. It verifies the written region by read-back.

### 4. Boot the television

1. Connect the device to the TV's HDMI input (via the mini-PC/stick).
2. Enter the device firmware boot menu and select the USB device.
3. For UEFI: select the `UEFI: <device>` entry. For legacy: select the device
   without the `UEFI:` prefix.
4. The serial console is not available on a TV; the on-screen console is the
   only feedback. If the screen stays black, the boot did not reach the kernel —
   re-check the QEMU evidence before blaming the TV.

### 5. Record the result

A television boot is only evidence if it is recorded. Capture:

- a photograph of the screen showing the RADAR OS console/desktop;
- the device model and firmware version;
- the ISO SHA-256 that was written;
- the `bootstrap.json` record.

Store these under `os/radar-os/evidence/tv-boot/` with a matching JSON record.
Until that exists, the TV boot path is **UNPROVEN**.

## What is still missing for a real TV boot

1. **A real image.** Blocked on the owner base decision.
2. **A graphical target.** The current package manifests do not install a
   desktop; a TV would show a text console. The Halo Shell desktop is a separate
   track.
3. **Input.** A TV remote is not a keyboard. USB HID or a paired remote is
   required.
4. **Hardware.** No TV or mini-PC is available in the build environment; this
   step is operator-side by necessity.
