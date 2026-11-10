# ARM64 QEMU target

The ARM64 wrapper targets the QEMU `virt` machine using `qemu-system-aarch64`, an explicit firmware image, a serial log, and a bounded wait for guest readiness. Optical media is attached through an explicit virtio-SCSI controller and SCSI CD-ROM device rather than x86-oriented `-cdrom` shorthand. The machine model, firmware hash, QEMU version, image hash, and readiness result are recorded with every result.

The current command uses `-M virt`, `-m 2048`, `-serial file:<log>`, `-display none`, the explicit firmware file, and `-drive if=none,...,media=cdrom,readonly=on` plus virtio-SCSI/SCSI-CD devices. It does not attach a network interface or any host block device. A successful script-level/mock test is not proof of a real ARM64 firmware or guest boot; real boot evidence still requires a matching AArch64 firmware, QEMU, and image.

A successful AArch64 VM boot validates only this virtual target. It does not prove physical compatibility for any ARM device.
