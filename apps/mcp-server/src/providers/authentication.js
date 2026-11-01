/**
 * ESM re-export wrapper (M1a module-format fix).
 *
 * This package declares "type": "module", so a .js file is loaded as
 * ESM. This file previously duplicated the CommonJS implementation
 * with module.exports, which cannot be loaded under ESM semantics.
 *
 * The implementation source of truth is authentication.cjs.
 * This wrapper simply re-exports it for ESM importers so both import
 * styles resolve to ONE implementation. Security semantics are
 * unchanged: strict, fail-closed, allowlist-only.
 */
export {
  DevelopmentAuthenticationProvider,
  normalizePrincipals,
  defaultDevelopmentPrincipals,
} from "./authentication.cjs";
