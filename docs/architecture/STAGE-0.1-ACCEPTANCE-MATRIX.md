# Stage 0.1 Acceptance Matrix

**Review branch:** `architecture/stage-0-1-closure`
**Starting SHA:** `93c1dc18f04faae015c0afdd196c854278f5bee1`
**Rule:** PASS requires actual evidence; design claims use PROPOSED or NOT IMPLEMENTED.

| Area | Status | Evidence / limitation |
|---|---|---|
| Repository baseline | PASS | Live audit captured main SHA, PR #11/#12 states, bases, heads, and ancestry before edits. |
| Contract inventory | PASS | `docs/architecture/CONTRACT-INVENTORY.md` maps known sources and marks missing contracts. |
| Compatibility | PASS | `docs/architecture/CONTRACT-COMPATIBILITY-MATRIX.md` identifies adapters, authority, device auth, approval, audit, versions, and failures. |
| MCP | PASS | Existing tool registry/gateway/security docs reviewed; live MCP transport remains unimplemented. |
| RM-IEP/1 | PASS | PR #12 implementation reconciled as an unmerged dependency; validity explicitly separated from authorization. |
| Local IPC | PROPOSED | Security ADR defines candidate Unix socket model and controls; no service/socket exists. |
| Device identity | PROPOSED | ADR defines registration/key/trust/revocation model; no credentials or records exist. |
| Execution authority | PROPOSED | Full acceptance chain and adversarial cases documented; adapter/live dispatch absent. |
| Debian Live | PROPOSED | Minimal config/profile scaffolding and package manifests created; live-build unavailable, no image built. |
| AMD64 QEMU | BLOCKED | QEMU and firmware tools absent in environment; commands/config documented, no boot result fabricated. |
| ARM64 QEMU | BLOCKED | AArch64 QEMU and firmware tools absent; commands/config documented, no physical compatibility claim. |
| Reproducibility | PROPOSED | Build metadata, package pins policy, checksums, and logs defined; no image artifact exists. |
| Release trust | PROPOSED | Trust/recovery ADR created; no production signing keys or automatic updates. |
| Cloud ownership | PROPOSED | Cloudflare/Supabase responsibility matrix created; intended account and production source of truth unresolved. |
| Security regressions | PASS | Existing main tests run; no security check weakened. M2.3.1 remains on PR #12 and was not silently copied into this branch. |
| Privileged Halo services | NOT IMPLEMENTED | Explicitly prohibited in Stage 0.1. |
| Live agent execution | NOT IMPLEMENTED | Explicitly disabled; no runner, worker, or adapter enabled. |

## Exit criteria for Stage 0.1

Stage 0.1 is complete as a planning/scaffolding milestone when the documents and non-destructive scripts are reviewed. Stage 1 OS implementation still requires owner decisions on Debian base, desktop substrate, device identity, IPC, cloud source of truth, and release trust.
