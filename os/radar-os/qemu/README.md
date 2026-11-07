# RADAR OS QEMU validation scaffold

The QEMU scaffold is non-destructive and does not create or overwrite host disks. It requires a prebuilt validated image and an explicit firmware file. Example: `os/radar-os/scripts/boot-qemu-amd64.sh IMAGE.iso ARTIFACTS/amd64.serial.log /path/to/OVMF_CODE.fd [ARTIFACTS/amd64.evidence.json]`. The ARM64 wrapper takes the same arguments and uses the `virt` machine. No firmware path is silently guessed.

Validation stages are intentionally separate:

1. Build success: a live-build command completes.
2. Firmware boot: firmware detects the image.
3. Kernel boot: kernel output appears.
4. Userspace readiness: systemd reaches the defined target.
5. Desktop readiness: a graphical session is separately verified.

The shared runner bounds boot observation with `RADAR_OS_QEMU_TIMEOUT` (default 120 seconds), captures QEMU stderr separately, and requires `RADAR_OS_QEMU_READY_PATTERN` in the serial log (default `Multi-User System.`). It writes a JSON evidence record containing architecture, machine, QEMU version, image and firmware hashes, logs, readiness result, elapsed time, QEMU exit code, and whether cleanup terminated QEMU after readiness. A process that starts but does not emit the marker is a failure, not a boot pass. The runner terminates a still-running QEMU after readiness; it does not claim desktop readiness.

Image validation requires the image, `.sha256` checksum sidecar, and `.radar-os.json` build metadata sidecar. It verifies ISO-9660 format and locates an architecture-checkable kernel from supported Live/root/boot/casper paths with xorriso. Missing validation tooling or any unestablished required property fails closed.

**Archived evidence boundary:** `evidence/qemu-boot-amd64.json`, `evidence/image-validation-amd64.json`, `evidence/serial-amd64-boot.txt`, and `evidence/serial-amd64-ready.txt` record a prior minimal AMD64 ISO boot and serial readiness result. They do not include the actual QEMU argument vector or guest memory value. The runner source at the evidence commit and PR #15 audited head specifies `-m 2048`; the former report's `1024 MB` statement is unsupported and withdrawn. Do not edit the archived JSON/logs to add a value that they did not capture.

This current workspace does not contain the historical ISO, firmware, or complete QEMU stderr capture and lacks the QEMU/xorriso/firmware dependencies needed to reproduce that boot. Accordingly the archived run is not a new execution of the final corrected scripts; no ARM64 boot, live-build image, repeat-build reproducibility, or hardware result is claimed here.
