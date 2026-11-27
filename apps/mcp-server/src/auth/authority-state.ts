/**
 * RADARMatrix Authority Binding State (M2.2.3) — INTERNAL MODULE.
 *
 * This module holds the process-wide server authority binding and
 * its ONLY write path. It is deliberately NOT part of the
 * general-purpose auth surface:
 *
 * - The general-purpose auth module (./delegation.ts) — the module
 *   request-handling code and runtime adapters import — exports NO
 *   initialization capability. It can only READ the bound authority
 *   (getBoundServerAuthority) and fails closed while unbound.
 * - The ONLY writer is the trusted composition root
 *   (./server-composition.ts), which is the module gateway startup
 *   (and, in the test process, the shared test composition helper)
 *   imports to establish the authority ONCE at boot.
 *
 * M2.2.3 Finding A (secure first initialization): set-once alone
 * did not authenticate the FIRST initializer — any code able to
 * import the old initializeServerAuthority export could establish
 * the authority. The correction separates the capability from the
 * consumers: initialization lives in a dedicated composition-root
 * module, and the binding state lives here, writable only through
 * the internal API that module uses.
 *
 * HONEST ARCHITECTURAL LIMIT: Node.js ESM cannot forbid an import
 * at runtime — any code in the process could technically import this
 * module. The boundary is ARCHITECTURAL, not cryptographic: (1) the
 * request-facing auth surface exposes no write path, (2) the only
 * sanctioned writer is the dedicated composition-root file, whose
 * sole legitimate consumer is trusted startup code, and (3) the
 * import discipline is enforced by review + CI (the runtime adapters
 * and the gateway import delegation.ts, never this module or
 * server-composition.ts). Runtime import permissions (e.g. Node
 * --experimental-permission) are a documented future option for
 * production hardening — recorded, not claimed.
 *
 * Zero runtime npm dependencies. Erasable-syntax TypeScript only.
 */

import type { ActorMembershipSource, RegistryInput } from "./delegation.ts";

/**
 * The bound server authority: a PROTECTED membership adapter (stable
 * method references captured at composition — M2.2.3 Finding B) and
 * an AUTHORITATIVE registry snapshot (validated, copied and frozen
 * at composition — M2.2.3 Finding B). Both are injected exactly once
 * by the trusted composition root.
 */
export interface BoundServerAuthority {
  /** Protected adapter: stable isMember/getRole references. */
  readonly membershipAdapter: ActorMembershipSource;
  /** Server-owned validated snapshot of the canonical tool registry. */
  readonly toolRegistrySnapshot: RegistryInput;
}

/**
 * The process-wide binding. Written once, then frozen and read-only
 * for the process lifetime. This is dependency injection state at
 * the composition boundary — NOT global mutable state: nothing
 * outside the composition root can write it.
 */
let boundAuthority: Readonly<BoundServerAuthority> | null = null;

/**
 * The ONE write path. Callable only from the trusted composition
 * root (server-composition.ts). Set-once: a second call returns
 * false and changes nothing — no request handler, adapter or test
 * can re-point the trusted provenance after boot.
 */
export function bindServerAuthorityInternal(binding: BoundServerAuthority): boolean {
  if (boundAuthority !== null) return false;
  if (!binding || typeof binding !== "object") return false;
  if (!binding.membershipAdapter || typeof binding.membershipAdapter !== "object") return false;
  if (!binding.toolRegistrySnapshot || typeof binding.toolRegistrySnapshot !== "object") return false;
  boundAuthority = Object.freeze({
    membershipAdapter: binding.membershipAdapter,
    toolRegistrySnapshot: binding.toolRegistrySnapshot,
  });
  return true;
}

/**
 * Read path for the fail-closed consumers in delegation.ts. Null
 * until the trusted composition root has bound the authority — every
 * trusted-context mint and grant creation fails closed while null.
 */
export function getBoundServerAuthority(): Readonly<BoundServerAuthority> | null {
  return boundAuthority;
}

/** Whether the trusted composition root has bound the authority. */
export function isServerAuthorityBound(): boolean {
  return boundAuthority !== null;
}
