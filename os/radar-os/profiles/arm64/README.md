# RADAR OS ARM64 profile

**Target:** AArch64 / Debian architecture `arm64`.
**Virtual target:** QEMU `virt` machine with an AArch64 CPU and explicit UEFI firmware path when available.
**Physical target:** a separately named, firmware-compatible reference device.

ARM64 is not one universal hardware platform. A successful QEMU AArch64 boot would validate only the selected virtual machine and image; it would not prove that the image boots on an ARM laptop, single-board computer, or other device.

Stage 0.1 defines the profile but does not build or boot an image because AArch64 QEMU and firmware tools are unavailable in the current environment.
