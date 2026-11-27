/**
 * RADARMatrix Trusted Server Composition Root (M2.2.3 Finding A).
 *
 * THE ONLY MODULE THAT MAY ESTABLISH THE SERVER AUTHORITY.
 *
 * M2.2.3 Finding A (secure first initialization): M2.2.2 made the
 * authority binding set-once, but initializeServerAuthority was
 * exported from the GENERAL-PURPOSE auth module (delegation.ts) —
 * any code able to import it could perform the FIRST initialization
 * with caller-chosen dependencies. Set-once prevented a second
 * binding but did not authenticate the first initializer.
 *
 * The correction establishes a trusted composition root:
 *
 * - delegation.ts (the module request-handling code, adapters and
 *   the gateway import) no longer exports ANY initialization
 *   capability. Ordinary request-handling code CANNOT initialize or
 *   replace the server authority: the capability is not on its
 *   import surface.
 * - This module is the dedicated composition root. Its legitimate
 *   consumers are trusted server startup code ONLY: gateway boot
 *   (future wiring, per docs/M2-2-3-AUTHORITY-HARDENING.md) and —
 *   in the test process — the shared test composition
 *   (tests/server-authority.helper.mjs), which plays exactly the
 *   gateway-startup role. Request payloads can never reach this
 *   module: nothing on the request path accepts or forwards
 *   provider/registry values to it, and the values it accepts must
 *   be live server-side objects (functions) — JSON request data
 *   cannot supply them (function-typed validation fails closed on
 *   any serialized value).
 * - The composition root CONSTRUCTS the protected authority from the
 *   injected dependencies rather than storing them raw:
 *   - the membership methods are CAPTURED ONCE and wrapped in a
 *     frozen adapter (M2.2.3 Finding B — post-binding replacement of
 *     the original provider's properties has no effect), and
 *   - the registry is VALIDATED entry-by-entry, COPIED into a
 *     server-owned projection and DEEP-FROZEN (M2.2.3 Finding B —
 *     retained references to the original registry cannot mutate
 *     the bound authority).
 * - Initialization stays fail-closed (malformed configs bind
 *   nothing) and set-once (a second composition returns false and
 *   leaves the original authority serving).
 *
 * HONEST LIMIT (same as authority-state.ts): ESM cannot forbid
 * imports at runtime. The boundary is architectural — the dedicated
 * composition-root file, the stripped general-purpose surface, and
 * review/CI-enforced import discipline. Node runtime permission
 * flags are a documented future production option.
 *
 * Zero runtime npm dependencies. Erasable-syntax TypeScript only.
 */

import {
  bindServerAuthorityInternal,
  getBoundServerAuthority,
} from "./authority-state.ts";
import { ROLE_LEVELS } from "./delegation.ts";
import type { ActorMembershipSource, RegistryInput } from "./delegation.ts";

/**
 * Composes the server authority from server-controlled components.
 * Returns true on the FIRST successful composition; returns false
 * forever after (set-once) and on any malformed configuration
 * (fail-closed: nothing is bound).
 *
 * This is the trusted composition boundary the M2.2.2 directive
 * established; M2.2.3 moves it OUT of the general-purpose auth
 * exports and hardens WHAT it binds (protected adapter + validated
 * frozen snapshot). Dependency injection is preserved here — the
 * real membership provider and the canonical TOOL_REGISTRY (or
 * their D1/M7 durable successors) are supplied by trusted startup
 * code, never by request data.
 */
export function composeServerAuthority(config: unknown): boolean {
  // Set-once: the authority can never be replaced mid-flight.
  if (getBoundServerAuthority() !== null) return false;
  if (!config || typeof config !== "object") return false;

  const provider = (config as { membershipProvider?: unknown }).membershipProvider;
  const registry = (config as { toolRegistry?: unknown }).toolRegistry;

  // The membership provider must be a live server-side object with
  // callable methods. Serialized (request-payload) values can never
  // satisfy this: functions do not survive JSON.
  if (!provider || typeof provider !== "object") return false;
  const isMemberRef = (provider as Record<string, unknown>).isMember;
  const getRoleRef = (provider as Record<string, unknown>).getRole;
  if (typeof isMemberRef !== "function") return false;
  if (typeof getRoleRef !== "function") return false;

  if (!registry || typeof registry !== "object" || Array.isArray(registry)) return false;

  // -----------------------------------------------------------------
  // M2.2.3 Finding B — PROTECTED MEMBERSHIP ADAPTER.
  //
  // The authoritative method references are captured ONCE, here. The
  // adapter is frozen and holds STABLE method identities: replacing
  // provider.isMember / provider.getRole AFTER composition has NO
  // effect on the bound authority (the captured references keep
  // serving). Legitimate updates to the underlying membership data
  // still flow through — the captured references read the provider's
  // live data, and the provider (or its durable D1/M7 successor)
  // remains free to update its own records. Unknown, missing,
  // invalid or unavailable membership fails closed (false / null —
  // never an exception past the boundary, never a permissive
  // fallback).
  // -----------------------------------------------------------------
  const membershipAdapter: ActorMembershipSource = Object.freeze({
    isMember(callerId: string, workspaceId: string): boolean {
      try {
        return (isMemberRef as (c: string, w: string) => unknown).call(
          provider,
          callerId,
          workspaceId,
        ) === true;
      } catch {
        return false;
      }
    },
    getRole(callerId: string, workspaceId: string): string | null {
      try {
        const role = (getRoleRef as (c: string, w: string) => unknown).call(
          provider,
          callerId,
          workspaceId,
        );
        return typeof role === "string" ? role : null;
      } catch {
        return null;
      }
    },
  });

  // -----------------------------------------------------------------
  // M2.2.3 Finding B — AUTHORITATIVE REGISTRY SNAPSHOT.
  //
  // Every entry is VALIDATED before the composition is accepted
  // (invalid entry => the whole composition fails closed, nothing
  // binds). The registry is then COPIED into a server-owned
  // projection holding exactly the authority-relevant fields
  // (required_role, is_write_operation), and BOTH the projection
  // and every individual tool definition are FROZEN. Retained
  // references to the ORIGINAL registry cannot mutate the snapshot:
  // required roles, write permissions and tool identities are
  // immutable after binding. Unknown tools are simply absent —
  // denied. There is no caller-supplied registry fallback.
  // -----------------------------------------------------------------
  const snapshot: Record<string, { required_role: string; is_write_operation: boolean }> = {};
  for (const [toolName, entry] of Object.entries(registry as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") return false;
    const requiredRole = (entry as Record<string, unknown>).required_role;
    if (typeof requiredRole !== "string" || requiredRole.length === 0) return false;
    const roleLevel = (ROLE_LEVELS as Record<string, unknown>)[requiredRole];
    if (roleLevel === undefined) return false; // unknown role in policy => fail closed
    const isWrite = (entry as Record<string, unknown>).is_write_operation;
    if (typeof isWrite !== "boolean") return false;
    snapshot[toolName] = Object.freeze({
      required_role: requiredRole,
      is_write_operation: isWrite,
    });
  }
  const toolRegistrySnapshot: RegistryInput = Object.freeze(snapshot);

  return bindServerAuthorityInternal({
    membershipAdapter,
    toolRegistrySnapshot,
  });
}

/**
 * Whether the trusted composition root has established the authority.
 * False => every trusted-context mint and grant creation in
 * delegation.ts fails closed.
 */
export function isServerAuthorityComposed(): boolean {
  return getBoundServerAuthority() !== null;
}
