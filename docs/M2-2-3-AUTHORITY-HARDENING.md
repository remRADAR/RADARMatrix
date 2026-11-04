# M2.2.3 — Trusted Authority Hardening (PR #7 review findings)

**Branch:** `security/m2-2-3-authority-hardening` (base: verified M2.2.2 head `bd3acfcfd14978bc8bbd6ea2d74660368a31e7d3`)
**Draft PR:** #8 (head `security/m2-2-3-authority-hardening`, base `security/m2-2-2-provenance`) — owner-gated, NOT to be merged without an explicit owner decision.
**Status:** Implemented + CI-verified. NOT independently reviewed, NOT integrated, NOT staging-verified, NOT merged, NOT deployed. Gateway execution remains UNWIRED.
**Owner principle:** trust is established through controlled architecture, not through assumptions about which code is expected to call a function.

## 1. Baseline (verified before any edit)

- `main` @ `93c1dc18f04faae015c0afdd196c854278f5bee1`; M2 @ `7af32edd059005a922fbe457f3408a27b5eff326`; M2.2.1 @ `0bbf8ae3eb4eb7e99f2c0045ca744b6d5607da57`; **M2.2.2 @ `bd3acfcfd14978bc8bbd6ea2d74660368a31e7d3` (exact expected head — no discrepancy)**; M3 @ `d22e84da086d4c8a1280f0432f1beebab195b8ca` (paused, untouched).
- PR #6 (M2.2.1) and PR #7 (M2.2.2) open/draft/unmerged, green; PR #5 (M3) and PR #3 (M2) open/draft/unmerged.
- Inspected live before editing: `delegation.ts` (M2.2.2 version), `server-authority.helper.mjs`, `test-runner.mjs`, both migrated suites (confirmed: neither `delegation-approval` (38 tests) nor `m2-2-1` (44 tests) imports the init API — zero changes needed there), `chatgpt-app-contract.ts` (TOOL_REGISTRY: 9 tools; hierarchy viewer < contributor < editor < admin), `package.json` (no `exports` field — the module boundary is file layout + import discipline; package.json untouched), and the gateway/contract surfaces (read-only).

## 2. Finding A — Secure the first initialization

**Weakness (PR #7 review):** `initializeServerAuthority()` was exported from the general-purpose auth module (`delegation.ts`). Set-once prevented a SECOND binding but did not authenticate the FIRST initializer: any code able to import the module could establish the authority with caller-chosen dependencies.

**Correction — trusted server composition root:**

1. **`initializeServerAuthority` is REMOVED** from `delegation.ts` exports. The module that request-handling code and the runtime adapters import now exports only fail-closed READ consumers of the bound authority (`isServerAuthorityInitialized()` remains as a read-only predicate; `ROLE_LEVELS` is exported as frozen policy data so the composition root can validate registry entries — it is not an authority-bearing capability).
2. **New trusted composition root — `apps/mcp-server/src/auth/server-composition.ts`:** the ONLY module that may establish the authority. It exports `composeServerAuthority(config)` + `isServerAuthorityComposed()`. Its sole legitimate consumers are trusted server startup code (future gateway boot) and, in the test process, the shared test composition helper (`tests/server-authority.helper.mjs`), which plays exactly the gateway-startup role.
3. **New internal binding-state module — `apps/mcp-server/src/auth/authority-state.ts`:** holds the process-wide binding and its ONLY write path (`bindServerAuthorityInternal`, used solely by the composition root). `delegation.ts` reads through `getBoundServerAuthority()` / `isServerAuthorityBound()` and fails closed while unbound.
4. **Request payloads can never supply dependencies:** the composition root accepts only live server-side objects — `isMember`/`getRole` must be actual functions, and functions do not survive JSON. Any serialized/`JSON.parse`-shaped config is refused and binds nothing.
5. **Set-once and fail-closed preserved:** a second `composeServerAuthority` call returns false and the ORIGINAL authority keeps serving; malformed configs (bad provider shape, invalid registry entries — see Finding B) bind NOTHING.
6. **Dependency injection preserved at the trusted boundary** for tests and future D1/M7 durable adapters (the `ActorMembershipSource` / `RegistryInput` abstractions are unchanged).

**Honest architectural limit (documented in-code, not claimed as solved):** Node.js ESM cannot forbid an import at runtime — any code in the process could technically import the composition-root module. The boundary is therefore ARCHITECTURAL, not cryptographic: (a) the request-facing auth surface exposes no write path; (b) the only sanctioned writer is the dedicated composition-root file whose sole legitimate consumer is trusted startup code; (c) the import discipline (gateway/runtime adapters import `delegation.ts`, never the composition root or state module) is enforced by review + CI. Runtime import permissions (Node `--experimental-permission`) are recorded as a future production hardening option. No claim is made that a TypeScript interface, a private-looking function name, or a runtime Symbol alone authenticates a caller.

## 3. Finding B — Immutable bound dependencies

**Weakness (PR #7 review):** the M2.2.2 outer `Object.freeze()` protected the binding object but NOT the provider's method references (replacing `provider.isMember`/`provider.getRole` after binding would re-point the bound authority) and NOT the registry entries (retained references to the original registry could mutate required roles, write flags or tool identities after binding).

**Membership provider — protected adapter:**
- The authoritative `isMember`/`getRole` function references are **captured ONCE** at composition and wrapped in a **frozen adapter** with stable method identities.
- Post-binding replacement of the original provider's method properties has **no effect** — the captured references keep serving.
- The captured references read the provider's own **live data**: legitimate membership record updates (role changes, the D1/M7 durable successor) still flow through **without replacing the provider**. The live membership store is never frozen.
- The adapter **fails closed** (returns `false`/`null`, never throws past the boundary, never permits a fallback) on unknown, missing, invalid or unavailable membership.
- Workspace-scoped verification is preserved (membership is checked against the requested workspace only).

**Tool registry — authoritative validated snapshot:**
- Every entry is **validated** before the composition is accepted: each must be an object with a non-empty `required_role` present in `ROLE_LEVELS` and a boolean `is_write_operation`. An invalid entry fails the **whole composition** (fail-closed — nothing binds).
- The registry is **copied** into a server-owned projection holding exactly the authority-relevant fields (`{required_role, is_write_operation}` per tool) — the snapshot is not the caller's object.
- **Deep-frozen:** each individual tool definition AND the outer snapshot object are frozen. Retained references to the original registry cannot mutate required roles, write permissions or tool identities after binding.
- **Unknown tools are simply absent** from the snapshot — denied. There is **no caller-supplied registry fallback**.
- Existing tool definitions and role policy are **unchanged** — no permission was relaxed or tightened to make tests pass.

## 4. Tests (dedicated M2.2.3 suite — 19 tests)

`tests/m2-2-3-authority-hardening.test.mjs`. First-initialization behavior requires FRESH module state, so A1/A2/A5 spawn child processes via the new `tests/m2223-composition-child.mjs` (the shared test process composes once at import, through the helper):

- **A1** unauthorized first initialization cannot establish authority — fresh process imports only `delegation.ts`: `initializeServerAuthority` and `composeServerAuthority` are both `undefined` on its export surface; a fabricated provider smuggled as an argument mints nothing; the process stays unbound.
- **A2** only the trusted composition path establishes authority — fresh process composes via `server-composition.ts`: composition succeeds, membership verifies, grants mint.
- **A3** second composition attempt rejected (set-once preserved); original authority keeps serving.
- **A4** request-controlled values cannot influence initialization — a `JSON.parse`-shaped config is refused; original authority untouched; no payload tool entered the snapshot.
- **A5** unbound authority fails closed (fresh process): no mints, no grants, no exceptions.
- **A6** existing legitimate server initialization works (the shared test composition): contexts and grants mint.
- **B1/B2** replacing the retained provider's `isMember`/`getRole` after initialization has no effect (bound adapter keeps using the captured references; the stranger still fails; the real member still mints).
- **B3** a forged provider (full method replacement) cannot elevate a viewer to admin.
- **B4** invalid/unavailable membership (throwing membership layer, unknown role) remains denied — fail-closed, no exception past the boundary.
- **B5** legitimate membership data changes are observed through the trusted provider WITHOUT replacing it (viewer → editor promotion observed by the same bound adapter).
- **B6** cross-workspace access remains denied.
- **C1/C2/C3** mutating the original registry entry / an individual tool definition / nested authority-relevant properties has no effect on the bound snapshot (read grants still work exactly as policy defines; write elevation never appears).
- **C4** a caller cannot inject a new tool (frozen registry refuses; unknown tool grant denied).
- **C5** a caller cannot lower an existing tool's required role (`radar.record_decision` stays editor-only in the snapshot).
- **C6** a caller cannot flip read↔write after binding (`radar.remember` stays a write tool in the snapshot).
- **C7** unknown tools remain denied.

**Existing protections retained and re-run (directive §5 D):** all M2.2.1 and M2.2.2 suites pass unchanged — `delegation-approval` (38) and `m2-2-1` (44) were never edited (verified to not import the init API before any edit); `m2-2-2-provenance` (13) was migrated to `composeServerAuthority` with every assertion preserved (byte-level diff: import block + the set-once test's wording only — no denial assertion touched); the M2.2.1 HMAC integrity/mutation rejection, atomic reservation, approval ordering, actor/workspace binding, role hierarchy, self-delegation restrictions, membership persistence protections and fail-closed propagation all re-ran green. Runner total: 12 suites.

## 5. Integration boundary (documented — NOT wired)

The gateway remains **UNWIRED** (per directive §6). No delegated execution, no browser takeover, no live tool dispatch, no credentials/secrets, no production configuration changes, no deploy, no merge.

**Where trusted initialization must eventually occur:** gateway startup (`apps/mcp-server/src/mcp-gateway.ts` boot path) calls `composeServerAuthority({ membershipProvider: <real FileMembershipProvider-or-D1 instance>, toolRegistry: TOOL_REGISTRY })` from `apps/mcp-server/src/auth/server-composition.ts` ONCE, before serving requests; the HMAC integrity service is constructed there from server-held configuration; delegated execution routes through the corrected adapter ordering. The eventual sequence remains: authenticated principal → trusted server composition → membership verification → role derivation → immutable canonical registry → grant creation → HMAC validation → atomic reservation → approval validation → bounded execution → audit. These remain owner-gated integration decisions (M2.2.2 Finding D, refined here).

## 6. Remaining architectural limitations (honest)

1. **The ESM import boundary is architectural, not runtime-cryptographic** (§2) — enforced by file layout + review + CI import discipline; Node permission flags are the recorded future option.
2. **Per-process binding:** set-once within one Node process; a fresh process can bind again — only the composition owner (gateway startup) may, and it is the only code with the capability on its import surface.
3. **In-memory reservations/redemptions** remain per-process (single-instance); cross-process single-use/capacity requires the durable store (D1, M7) — unchanged roadmap.
4. **Delegation remains unwired** to live tool dispatch; the gateway does not yet call the composition root.
5. **HMAC secret production provisioning** (secret store + rotation) remains pending — fail-closed until wired.

## 7. CI evidence (actual runs; green claimed only from the final heads)

- Code commit 1 `9532de8ab6f53a14ed095d05ddfd4f735664799e`: push run **41904834426** + PR #8 run **41904865802** — **FAILURE**: tsc strict rejected unnecessary `Record<string, unknown>` casts around the newly exported ROLE_LEVELS lookups (`delegation.ts#L488`: "Operator '>' cannot be applied to types '{}' and 'number'"). Typecheck-only defect; NO test executed on this head; no security-logic defect.
- Final code head `fbe878656f453e34e629153e593c88f84db12fb6`: push run **41905022180** + PR #8 run **41905034289** — **SUCCESS** (typecheck, 12 suites, failure-marker guard, deployment smoke). The fix restored the direct-indexing style the CI-green M2.2.2 baseline used (undefined-guards kept; zero runtime change; no test touched).
- Docs commit: verified post-push; run IDs recorded in the ledger and the owner report.

A green CI is necessary but does not independently establish security acceptance — that requires the owner's independent review.
