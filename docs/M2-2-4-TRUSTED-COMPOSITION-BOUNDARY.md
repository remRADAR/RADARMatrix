# M2.2.4 — Trusted Composition Boundary Correction

**Branch:** `security/m2-2-4-trusted-composition-boundary`  
**Base:** PR #8 head `3921fe552b8bfe78ade848443b1253451b3d8c7a`  
**Target:** `security/m2-2-3-authority-hardening`  
**Status:** Draft implementation; not merged, deployed, or production-ready.

## 1. Review finding and threat model

The independent review reproduced two attacks against PR #8 in fresh Node.js processes:

1. Directly importing `apps/mcp-server/src/auth/server-composition.ts` and calling `composeServerAuthority()` with an `isMember()` function that always returns `true`, `getRole()` returning `admin`, and an attacker-controlled write-tool registry establishes authority and mints a trusted administrator context.
2. Directly importing `apps/mcp-server/src/auth/authority-state.ts` and calling `bindServerAuthorityInternal()` with forged adapter and registry objects binds authority directly and permits the same result.

The call path is: untrusted same-process module → direct ESM import → composition/state writer → bound authority → `createTrustedActorContext()` → `createDelegatedGrant()`. The provider and registry protections work after a legitimate binding, but they cannot authenticate the first caller when the caller can directly import and invoke the binding module.

## 2. Trust-boundary model

```text
Trusted server startup (future gateway boot)
        |
        | approved source import
        v
server-composition.ts  ---- approved ----> authority-state.ts
        |                                      ^
        | binds once                              |
        v                                      delegation.ts (read consumer)
  frozen adapter + snapshot                         |
        |                                             v
        +------------------------------------> trusted context / grants

Ordinary request/runtime modules
        |  CI-rejected imports of composition/state modules
        v
delegation.ts read-facing APIs only

Malicious code with unrestricted access to this Node process
        | direct source import remains technically possible in Node ESM
        v
Residual runtime limitation: separate process/worker/capability boundary required
```

The protections are deliberately distinguished:

- **API surface restriction:** `delegation.ts` exports no initializer. Request payloads cannot provide live functions and cannot supply providers, registries, roles, or authority configuration.
- **Architectural/import enforcement:** `scripts/check-authority-boundary.mjs` parses the TypeScript/JavaScript module graph and rejects unapproved imports of the composition root or authority-state module. CI runs it on every push and pull request.
- **Runtime isolation:** **not provided** by this work. Node ESM does not authenticate importers. Arbitrary malicious code already executing with unrestricted same-process access can still import the source modules directly. A separate process, protected worker/service, or equivalent runtime capability boundary is required before making that threat in scope.

CI enforcement prevents accidental or unauthorized changes through the supported repository architecture; it is not a defense against arbitrary code execution in the same process.

## 3. Implemented correction

The smallest compatible correction is an executable import-boundary policy rather than a misleading private name or export rename:

- `scripts/check-authority-boundary.mjs` uses the TypeScript parser to inspect static imports and dynamic-import string literals.
- Approved composition-root consumers are limited to the test composition helper and the M2.2.2/M2.2.3/M2.2.4 composition tests. The future gateway boot path is intentionally not wired in this workstream.
- `authority-state.ts` may be imported only by `delegation.ts` and `server-composition.ts`.
- `delegation.ts` is checked for any exported `initializeServerAuthority` declaration.
- CI runs `npm run check:authority-boundary` after strict type-checking and before the full tests.

The existing set-once, fail-closed binding, captured provider methods, immutable registry snapshot, HMAC integrity, approval, reservation, workspace, role, and tool protections remain unchanged.

## 4. Authoritative versus pure derivation APIs

`deriveActorAuthority(actor, registry)` remains a pure policy-calculation helper for compatibility and testing. It is not itself a provenance boundary because it accepts an explicit registry. The security-sensitive `createDelegatedGrant()` path continues to obtain `toolRegistrySnapshot` only from the process binding and never forwards a caller-provided registry. Future callers must use the grant path or a separately introduced server-bound derivation API for authoritative decisions.

## 5. Adversarial evidence

The dedicated `tests/m2-2-4-composition-boundary.test.mjs` suite runs fresh child processes for both direct attacks. It records, rather than hides, the residual result:

- Direct composition import: forged authority, administrator context, and write grant remain possible under unrestricted same-process execution.
- Direct state-writer import: forged authority, administrator context, and write grant remain possible under unrestricted same-process execution.
- Request-shaped JSON dependency injection remains rejected.
- The AST import-boundary checker passes for the approved source graph.

This is intentional evidence that the implementation does not overclaim runtime isolation.

## 6. Gateway and future stronger boundary

Gateway execution remains unwired. No agent dispatch, browser takeover, production secret provisioning, deployment, DNS, database, or production configuration change is included.

Before production authority initialization, the project still requires an owner-approved runtime boundary that prevents untrusted code from executing with unrestricted access to the authority process. Suitable future choices include a separately protected process/service or an equivalent capability-isolated worker. Distributed grant reservation and approval redemption remain future D1/M7 requirements.
