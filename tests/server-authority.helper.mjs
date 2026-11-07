/**
 * RADARMatrix M2.2.2/M2.2.3 shared TEST server-authority composition helper.
 *
 * The trusted membership provider and the canonical tool registry
 * are bound ONCE per process at the trusted server composition
 * boundary. M2.2.3 moved that boundary into the dedicated
 * composition-root module (apps/mcp-server/src/auth/
 * server-composition.ts); the general-purpose auth module
 * (delegation.ts) no longer exports any initialization capability.
 * The test runner imports every suite into ONE process, so all
 * delegation-touching suites share this single composition: this
 * helper plays the role of the trusted server composition (the
 * gateway startup code in production) and exposes a MUTABLE
 * membership state so each test can point the trusted provider at
 * the (caller, workspace, role) fixture it needs — exactly the way
 * production would point it at the real membership store. The state
 * is the test's OWN server-side data; request payloads still cannot
 * supply any of it.
 *
 * The canonical registry for tests is the MERGED registry: the real
 * TOOL_REGISTRY plus the two read-only github adapter tools used by
 * the M2.2.1 compatibility-adapter suites (both viewer-level, read
 * only) — so grants for them derive legally from every role.
 *
 * IMPORTANT: setMembershipState REPLACES the whole state (no
 * merging) so no test can leak a stale fixture into the next one.
 *
 * M2.2.3: the bound provider object is EXPORTED so the
 * authority-hardening suite can attempt post-binding method
 * replacement against it (and prove the protected adapter ignores
 * it). Mutating this object's METHOD PROPERTIES has no effect on
 * the bound authority (the composition root captured the method
 * references once); mutating the underlying DATA still flows through
 * via setMembershipState.
 */

import {
  TOOL_REGISTRY,
} from "../apps/mcp-server/src/chatgpt-app-contract.ts";
import {
  composeServerAuthority,
  isServerAuthorityComposed,
} from "../apps/mcp-server/src/auth/server-composition.ts";

/** Canonical test registry: TOOL_REGISTRY + read-only github adapter tools. */
export const TEST_REGISTRY = Object.freeze(Object.assign({}, TOOL_REGISTRY, {
  "github.read.branches": { required_role: "viewer", is_write_operation: false },
  "github.read.sensitive": { required_role: "viewer", is_write_operation: false },
}));

/**
 * The current server-side membership fixture state. The provider
 * below is bound ONCE and reads this state on every call — tests
 * mutate the STATE (their own server data), never the provider or
 * the binding.
 */
let state = {
  actor: null,
  workspace: null,
  role: null,
  rawRole: undefined,
  isMember: undefined,
  getRole: undefined,
};

/** Replaces the whole membership fixture state (no merge). */
export function setMembershipState(next) {
  state = {
    actor: null,
    workspace: null,
    role: null,
    rawRole: undefined,
    isMember: undefined,
    getRole: undefined,
    ...(next || {}),
  };
}

/**
 * The test process's trusted membership provider (exported for the
 * M2.2.3 immutability tests ONLY — see the header note).
 */
export const testMembershipProvider = {
  isMember(caller, ws) {
    if (state.isMember !== undefined) return state.isMember(caller, ws);
    return caller === state.actor && ws === state.workspace;
  },
  getRole(caller, ws) {
    if (state.getRole !== undefined) return state.getRole(caller, ws);
    if (caller !== state.actor || ws !== state.workspace) return null;
    return state.rawRole !== undefined ? state.rawRole : state.role;
  },
};

// Bind the server authority exactly once per process, through the
// TRUSTED COMPOSITION ROOT (M2.2.3) — the same module gateway
// startup will call in production. Whichever suite loads this
// helper first performs the binding. (composeServerAuthority itself
// refuses a second composition — a request handler can never swap
// the provenance mid-flight, and the general-purpose auth module
// no longer exposes the capability at all.)
if (!isServerAuthorityComposed()) {
  const bound = composeServerAuthority({
    membershipProvider: testMembershipProvider,
    toolRegistry: TEST_REGISTRY,
  });
  if (!bound && !isServerAuthorityComposed()) {
    throw new Error("M2.2.3 test composition failed to bind the server authority");
  }
}
