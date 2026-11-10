# RADARMatrix Contract Compatibility Matrix

**Status:** Stage 0.1 design baseline; no new runtime communication is enabled.

## Component matrix

| Producer → consumer | Contract | Direct or adapter | Authority validation | Device auth | Approval | Audit | Status |
|---|---|---|---|---|---|---|---|
| MCP client → gateway | RM-MCP-001/002 | Direct protocol boundary | Required | No, unless device client | Per write/consequence | Required | Existing foundation |
| Trusted authority → execution adapter | RM-IEP/1 + grant/session | Adapter required | Required before request and at adapter | Required for local device | Required when consequential | Required | Proposed; protocol on PR #12, adapter missing |
| Halo Shell → RADAR OS service | RM-IPC-001 | Adapter/service boundary | Required | Required | Operation-dependent | Required | NOT IMPLEMENTED |
| Console → cloud service | Versioned API contract | Adapter required | Required | Device routes require device auth | Operation-dependent | Required | Console is merged via PR #11; current UI remains local/demo-only |
| RADAR OS service → cloud | RM-SYNC-001 | Sync adapter | Required | Required | No implicit authority | Required | NOT IMPLEMENTED |
| Skill registry → router | RM-SKILL-001 | Direct local read | Gateway auth for exposed route | No | No | Route outcome as applicable | Existing plan-only |
| Router → agent executor | RM-TASK-001 + grant | Adapter required | Required | Required for local execution | Required | Required | Plan-only; executor missing |
| Update metadata → updater | RM-OS-001/002 | Verification adapter | Device policy | Device key/trust required | Operator policy | Required | NOT IMPLEMENTED |

## Version compatibility

| Contract | Current | Compatible consumers | Incompatible behavior | Enforcer |
|---|---|---|---|---|
| MCP tools | v0.8 registry | Existing gateway and clients using exact schemas | Reject unknown/malformed tool or schema; no best-effort writes | Gateway/tool registry |
| Gateway response | Foundation/M2 shape | Current tests and local clients | Structured error; no partial authorization | Gateway |
| RM-IEP | RM-IEP/1 | Only validators/adapters explicitly supporting `/1` | Deny before dispatch; report protocol mismatch | Boundary + adapter |
| Local IPC | Proposed 0.1 | None yet | Deny unknown version/op/field policy | Future IPC service |
| Device link | Proposed 0.1 | None yet | Revoke/fail closed; no sync | Future device/cloud service |
| OS manifest | Proposed 0.1 | Future updater/recovery | Do not install unsigned/incompatible artifact | Updater |

## Compatibility policy

- Use explicit protocol versions for wire contracts (`RM-IEP/1`, proposed `RM-IPC/1`, proposed device/update versions).
- Use semantic versions for packages and registries where compatibility can be expressed independently of transport.
- Required fields cannot become optional within a compatible minor release.
- Additive optional fields are permitted only when unknown fields are safely ignored or rejected by an explicitly documented policy; privileged boundaries should default to reject unknown security-relevant fields.
- Breaking schema changes require a new protocol major/version and a compatibility test suite.
- Deprecations require a documented minimum support window and telemetry/audit evidence before removal.
- Every adapter must declare supported contract versions and fail closed on unsupported versions.
- Compatibility tests must cover valid baseline, unknown fields, missing required fields, version mismatch, replay, expiry, and authority mismatch.

## End-to-end flow 1: MCP tool request

`MCP client → gateway → trusted authority → authorization → tool registry → permitted adapter → result → audit`

- Trust boundaries: client/gateway; gateway/authority; authority/adapter; adapter/data.
- Authentication: current provider uses development-only caller_id fixtures; production OAuth/OIDC token verification is **NOT IMPLEMENTED**.
- Authorization: membership, RBAC, workspace match, and tool schema.
- Versions: MCP/tool registry v0.8; gateway response foundation/M2.
- Failure: malformed request, missing identity, unknown tool, workspace mismatch, forbidden role, unavailable storage; deny or structured error.
- Audit: gateway writes outcomes; durable production sink is not yet connected.
- Status: foundation path tested locally; live MCP transport is not implemented.

## End-to-end flow 2: agent execution

`trusted authority → scoped grant → RM-IEP/1 request → isolated adapter → validated tool request → authority authorization → result → audit`

- Trust boundaries: authority/agent; agent/adapter; adapter/authority; adapter/host.
- Authentication: actor, agent, workspace, session, and device identity required; device part is not implemented.
- Authorization: grant integrity/reservation, approval, frozen registry, per-tool authorization, then RM-IEP validation.
- Versions: RM-IEP/1 exists only on open Draft PR #12 (not in main); adapter is absent.
- Failure: any missing or expired authority, protocol mismatch, adapter crash, audit failure, or cancellation must deny/fail closed.
- Audit: required before/after according to operation semantics; durable sink is pending.
- Status: **not operational**; only contract validation and authority tests exist.

## End-to-end flow 3: Halo local service request

`Halo Shell → authenticated local IPC → trusted RADAR service → policy validation → permitted operation → response → audit`

- Trust boundaries: user application/privileged service; privileged service/host.
- Authentication: OS peer credentials plus device binding; exact mechanism is proposed, not implemented.
- Authorization: operation allowlist, user/workspace context, grant/approval where consequential.
- Versions: proposed RM-IPC/1.
- Failure: unknown peer, stale request, invalid schema, unavailable authority, timeout, service restart; deny.
- Audit: every privileged operation and denial must be recorded without secrets.
- Status: **not implemented**; no privileged socket/service may be created in Stage 0.1.

## End-to-end flow 4: device-to-cloud synchronization

`registered device → authenticated sync request → cloud service → workspace/device authorization → validated sync → audit`

- Trust boundaries: device/transport; cloud edge/authority; sync service/storage.
- Authentication: registered device key plus user/workspace authority.
- Authorization: device trust state, workspace membership, resource scope, contract compatibility.
- Versions: proposed RM-SYNC/1 and device identity 0.1.
- Failure: revoked device, key mismatch, stale contract, replay, storage/audit failure; no sync.
- Audit: sync attempts, denials, and durable mutations.
- Status: **not implemented**; no cloud resource or device registration is authorized.
