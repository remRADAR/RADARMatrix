# ADR: Halo OS ↔ RADAR OS Local IPC

**Status:** Proposed; owner review required.
**Decision scope:** Future contract and threat model only. No privileged IPC service or production socket is created.

## Context

Halo applications need narrow access to RADAR OS capabilities such as status, networking, update state, and recovery requests. Local process presence must not equal authority. Agents and imported content must never gain unrestricted host access through IPC.

## Candidate transport

Unix domain sockets are the preferred initial transport because Linux can provide filesystem ownership/mode controls and peer credentials. A future implementation must evaluate service-manager socket activation and whether an additional authenticated message layer is required. TCP loopback is not the default because local network reachability is a weaker boundary unless separately protected.

## Proposed RM-IPC/1 envelope

A future request contains: protocol version, request ID, device ID, user/session context reference, workspace ID when applicable, operation name from a fixed allowlist, typed arguments, issued-at/expiry, and replay nonce. A response contains version, request ID, status, bounded result or structured error, timestamp, and audit correlation ID.

Unknown operations, unknown security-relevant fields, stale timestamps, duplicate nonces, missing identity, and malformed arguments fail closed.

## Required controls

- Peer authentication using OS credentials and service identity.
- Device binding using the registered device identity once that model exists.
- Capability-based operation allowlists; no generic `command`, shell, argv, or executable path operation.
- Strict schema validation and bounded request/result sizes.
- Request expiry, nonce/replay protection, cancellation, and timeout.
- Workspace/user authority validation by the trusted RADAR service.
- Approval checks for consequential actions.
- Append-only audit events for accepts, denials, failures, cancellations, and service restarts.
- Privilege separation: Halo clients remain unprivileged; the service owns only narrowly required capabilities.
- Fail-closed behavior when authority, audit, policy, or storage dependencies are unavailable.

## Prohibitions

- No unrestricted shell commands through IPC.
- No raw privileged credentials passed to Halo applications.
- No direct agent access to privileged services.
- No trust based solely on local process identity.
- No authorization decisions from client-supplied role, workspace, or capability fields.
- No placeholder socket presented as a working service.

## Service restart and failure behavior

A service restart invalidates in-flight requests unless a future idempotency design explicitly proves safe continuation. Clients must receive bounded unavailable/denied errors, not partial authority. Audit persistence failure blocks consequential operations.

## Open decisions

Owner review is required for socket layout, service account model, peer credential policy, message authentication, nonce store, timeout defaults, and operation allowlists.

## Implementation status

**NOT IMPLEMENTED.** Stage 0.1 creates no socket, daemon, systemd service, privileged helper, or host-control path.
