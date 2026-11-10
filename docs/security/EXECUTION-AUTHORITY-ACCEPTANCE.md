# Execution Authority Acceptance Design

**Status:** Design-only acceptance specification.
**Rule:** RM-IEP/1 validation alone never authorizes execution. Live agent execution remains disabled.

## Required chain

An execution acceptance test must prove, in order:

1. User authentication and workspace context are cryptographically verified.
2. Actor identity is server-derived, not caller-supplied.
3. Workspace membership and role are current and valid.
4. A task-scoped grant is issued from the frozen canonical tool registry.
5. Grant integrity, scope, expiry, and actor/agent/workspace binding validate.
6. Reservation is atomic and replay/use limits are enforced.
7. Consequential actions require exact, single-use approval redemption.
8. The execution session is scoped, expiring, audience-bound, and device-bound when local.
9. The RM-IEP/1 envelope and named tool arguments validate.
10. The adapter is isolated and receives no trusted authority internals or unrestricted credentials.
11. The adapter rechecks per-tool authorization at its boundary.
12. Results are bounded and schema-validated.
13. Cancellation and failure behavior is deterministic and does not restore authority.
14. Durable audit records capture acceptance, dispatch, result, denial, cancellation, and failure without secrets.
15. Any unavailable authority, adapter, audit sink, or policy dependency fails closed.

## Adversarial acceptance cases

| Case | Expected result |
|---|---|
| Forged actor identity | Deny before grant or dispatch |
| Cross-workspace request | Deny; no reservation or external request |
| Revoked device | Deny device-bound session and sync |
| Expired or mutated grant | Deny; integrity failure; no dispatch |
| Replayed grant | Atomic reservation permits only valid remaining uses |
| Replayed approval | Single-use redemption denies second attempt |
| Unknown/unauthorized tool | Deny from canonical frozen registry |
| Malformed or oversized RM-IEP message | Reject before adapter |
| Invalid argument schema | Reject before adapter |
| Session token reuse or wrong audience | Deny |
| Agent imports trusted authority module | Import guard/process boundary denies; no trusted state exposed |
| Agent bypasses gateway | Adapter requires independently verified grant/session; deny |
| Adapter crash | Bounded failure; no permission expansion; audit outcome |
| Authority unavailable | Fail closed; no external request |
| Audit persistence failure | Consequential operation denied or explicitly rolled back by policy; never silently succeeds |
| Cancellation race | Deterministic terminal state; no duplicate side effect |

## Evidence required before enabling execution

- Focused adversarial tests for every case above.
- Process/isolation evidence, not only same-process import scanning.
- A real adapter with an explicit allowlist and no arbitrary command interface.
- Device identity and local IPC contracts if execution is local.
- Durable audit sink and failure semantics.
- Review of approval, replay, idempotency, cancellation, and timeout behavior.
- Separate owner approval to enable any live dispatch.

## Current evidence

M2.3.1 on PR #12 proves envelope/session/argument validation and import scanning only. Existing M2.2.x tests prove authority provenance, grants, approvals, integrity, and reservation in the current test architecture. The end-to-end adapter chain is **NOT IMPLEMENTED** and no live agent execution is enabled.
