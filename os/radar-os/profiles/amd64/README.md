# RADAR OS AMD64 profile

**Target:** x86-64 / Debian architecture `amd64`.
**Virtual target:** QEMU `q35` or documented fallback, with UEFI where firmware is available.
**Physical target:** designated UEFI PC/laptop only; no universal hardware claim.

The profile must record kernel/image architecture, boot mode, virtual CPU and memory, disk format, serial console, network model, timeout, and output checksum. Stage 0.1 defines the profile but does not build an image because Debian Live and QEMU tools are unavailable in the current environment.

Future physical validation must name exact reference devices, firmware mode, storage media, network adapter, and recovery procedure.
