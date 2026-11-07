# Stage 0.1.1 Review Correction Acceptance Matrix

**Review branch:** `architecture/stage-0-1-1-review-corrections`
**Starting SHA:** `91d95170a541a2355c409b2a2d0c8f30e1b20e71` (verified 2026-11-06)
**Rule:** PASS requires actual evidence; design claims use PROPOSED or NOT IMPLEMENTED.

| Area | Status | Evidence / limitation |
|---|---|---|
| Repository baseline | PASS | Current main SHA and all open PRs inspected. PR #11 is merged; #12/#13 remain Draft, with #12 stacked and #13 based on an old SHA. |
| Contract inventory | PASS | `docs/architecture/CONTRACT-INVENTORY.md` maps known sources and marks missing contracts. |
| Compatibility | PASS | `docs/architecture/CONTRACT-COMPATIBILITY-MATRIX.md` identifies adapters, authority, device auth, approval, audit, versions, and failures. |
| MCP | PASS | Existing tool registry/gateway/security docs reviewed; live MCP transport remains unimplemented. |
| RM-IEP/1 | PASS | PR #12 is open Draft and not in main; validity is explicitly separated from authorization. |
| Local IPC | PROPOSED | Security ADR defines candidate Unix socket model and controls; no service/socket exists. |
| Device identity | PROPOSED | ADR defines registration/key/trust/revocation model; no credentials or records exist. |
| Execution authority | PROPOSED | Full acceptance chain and adversarial cases documented; adapter/live dispatch absent. |
| Debian Live | PROPOSED | Architecture-specific manifests are wired through generated `config/package-lists`; build not run because live-build unavailable. |
| AMD64 QEMU | BLOCKED | Explicit firmware/image and serial readiness required; QEMU/firmware/image tools unavailable here, no boot result claimed. |
| ARM64 QEMU | BLOCKED | Explicit firmware/image and serial readiness required; AArch64 QEMU/firmware unavailable, no hardware claim. |
| Image validation | Implemented, not exercised | Requires ISO format, architecture metadata, extracted kernel architecture, and matching checksum sidecar; xorriso/image absent. |
| Reproducibility | PROPOSED | Build metadata, package policy, checksums, and evidence schema defined; no image artifact exists. |
| Release trust | PROPOSED | Trust/recovery ADR created; no production signing keys or automatic updates. |
| Cloud ownership | PROPOSED | Cloudflare/Supabase responsibility matrix created; intended account and production source of truth unresolved. |
| Security regressions | PASS | Existing main tests run; no security check weakened. M2.3.1 remains on PR #12 and was not silently copied into this branch. |
| Production OAuth/OIDC authentication | NOT IMPLEMENTED | Current provider is deterministic development-only caller_id identity; not production authentication. |
| Privileged Halo services | NOT IMPLEMENTED | Explicitly prohibited in Stage 0.1. |
| Live agent execution | NOT IMPLEMENTED | Explicitly disabled; no runner, worker, or adapter enabled. |

## Exit criteria for Stage 0.1

Stage 0.1 is complete as a planning/scaffolding milestone when the documents and non-destructive scripts are reviewed. Stage 1 OS implementation still requires owner decisions on Debian base, desktop substrate, device identity, IPC, cloud source of truth, and release trust.

## Stage 0.1.1 review-correction criteria

1. Authentication inventory states production OAuth/OIDC is NOT IMPLEMENTED.
2. Current `main`, merged PR #11, open Draft PR #12/#13, ancestry and stale branch bases are reflected in docs.
3. Common package list has no architecture-specific packages; architecture manifests are consumed by Debian Live.
4. QEMU verifies explicit firmware/prerequisites and serial OS readiness, captures evidence, and reports process start separately from boot success.
5. Image validation fails closed without format, architecture, and required checksum proof and emits a structured report.
