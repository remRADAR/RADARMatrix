# ARM64 QEMU target

Preferred target: `virt` machine, `qemu-system-aarch64`, explicit AArch64 CPU, memory, serial console, isolated image path, and an explicit UEFI firmware path where used. The machine model and firmware must be recorded with every result.

A future command should define: `-M virt`, `-cpu max` or a pinned compatible CPU, `-m 2048`, `-serial file:<log>`, `-display none`, `-drive file=<validated-image>,readonly=on`, documented network mode, and a timeout wrapper. The command must never point at a host block device.

A successful AArch64 VM boot validates only this virtual target. It does not prove physical compatibility for any ARM device.
