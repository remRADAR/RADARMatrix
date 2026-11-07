/**
 * RADARMatrix M2.2.2 shared TEST server-authority composition helper.
 *
 * M2.2.2 binds the trusted membership provider and the canonical
 * tool registry ONCE per process at the server composition boundary
 * (initializeServerAuthority in delegation.ts). The test runner
 * imports every suite into ONE process, so all delegation-touching
 * suites share this single composition: this helper plays the role
 * of the trusted server composition (the gateway startup code in
 * production) and exposes a MUTABLE membership state so each test
 * can point the trusted provider at the (caller, workspace, role)
 * fixture it needs — exactly the way production would point it at
 * the real membership store. The state is the test's OWN server-side
 * data; request payloads still cannot supply any of it.
 *
 * The canonical registry for tests is the MERGED registry: the real
 * TOOL_REGISTRY plus the two read-only github adapter tools used by
 * the M2.2.1 compatibility-adapter suites (both viewer-level, read
 * only) — so grants for them derive legally from every role.
 *
 * IMPORTANT: setMembershipState REPLACES the whole state (no
 * merging) so no test can leak a stale fixture into the next one.
 */

import {
  TOOL_REGISTRY,
} from "../apps/mcp-server/src/chatgpt-app-contract.ts";
import {
  initializeServerAuthority,
  isServerAuthorityInitialized,
} from "../apps/mcp-server/src/auth/delegation.ts";

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

const testMembershipProvider = {
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

// Bind the server authority exactly once per process. Every suite
// imports this helper; whichever loads first performs the binding.
// (initializeServerAuthority itself refuses to rebind — a request
// handler can never swap the provenance mid-flight.)
if (!isServerAuthorityInitialized()) {
  const bound = initializeServerAuthority({
    membershipProvider: testMembershipProvider,
    toolRegistry: TEST_REGISTRY,
  });
  if (!bound && !isServerAuthorityInitialized()) {
    throw new Error("M2.2.2 test composition failed to bind the server authority");
  }
}
