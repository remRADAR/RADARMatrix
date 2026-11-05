# AMD64 QEMU target

Preferred target: `q35` machine, `qemu-system-x86_64`, explicit `-machine`, `-cpu`, memory, serial console, and an isolated temporary copy or read-only image reference. UEFI firmware is required when validating UEFI; its path must be passed explicitly and verified before launch.

A future command should define: `-machine q35`, `-cpu max` or a pinned compatible CPU, `-m 2048`, `-serial file:<log>`, `-display none` for headless mode, `-drive file=<validated-image>,readonly=on`, a documented network mode, and a timeout wrapper. The command must never point at a host block device.

Acceptance requires image checksum and architecture checks, firmware detection, bootloader/kernel/systemd evidence, root mount, timeout compliance, and retained logs.
