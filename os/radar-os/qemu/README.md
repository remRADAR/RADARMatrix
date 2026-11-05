# RADAR OS QEMU validation scaffold

The QEMU scaffold is non-destructive and does not create or overwrite host disks. It expects a prebuilt image path supplied by the caller. Scripts fail if QEMU, firmware, or the image is missing.

Validation stages are intentionally separate:

1. Build success: a live-build command completes.
2. Firmware boot: firmware detects the image.
3. Kernel boot: kernel output appears.
4. Userspace readiness: systemd reaches the defined target.
5. Desktop readiness: a graphical session is separately verified.

Launching QEMU alone is not a pass for all five stages. Serial/headless logs and exit status must be retained under an explicitly selected artifact directory.

The current environment lacks `qemu-system-x86_64`, `qemu-system-aarch64`, `qemu-img`, and firmware files. No boot result is claimed.
