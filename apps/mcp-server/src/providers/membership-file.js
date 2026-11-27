/**
 * ESM re-export wrapper (module-format law: .cjs is the provider
 * implementation source of truth; this file re-exports it for ESM
 * consumers like the gateway).
 *
 * This wrapper deliberately contains NO implementation.
 */
export { FileMembershipProvider, KNOWN_ROLES } from "./membership-file.cjs";
