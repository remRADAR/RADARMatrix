# M2.3.1 — RM-IEP/1 Boundary Contracts

**Status:** implemented and locally testable; execution remains unwired.

This milestone adds a strict, versioned contract layer for the local execution interface protocol. `apps/mcp-server/src/auth/execution-boundary.ts` validates RM-IEP/1 request, response, cancellation, failure, and audit envelopes; execution-session claims; allowlisted named tool identifiers; and tool-specific object arguments. It intentionally contains no process spawning, runner, dispatch, worker, gateway wiring, browser takeover, or credentials.

## Security contract

Messages are versioned as `RM-IEP/1`, transported as one JSON object per NDJSON line, and capped at 1 MiB in UTF-8 bytes. Unknown message types, malformed JSON, missing required fields, non-finite or unsafe timestamps, expired/not-yet-valid session claims, wrong audience/token use, unknown tools, missing tool arguments, and command-shaped fields (`command`, `cmd`, `shell`, `argv`) fail closed. Arbitrary command strings are not part of the protocol.

The named-tool registry mirrors the existing canonical RADAR tool identifiers. Runtime validation is separate from RBAC, workspace isolation, approval, HMAC grant integrity, reservation, and audit persistence; those existing authority-plane controls remain authoritative and are not bypassed by this contract layer.

The authority-boundary scanner now covers `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.mjs`, and `.cjs`, static imports/exports, import-equals, literal dynamic imports, `require`/`require.resolve`, and rejects non-literal dynamic module-loading expressions. It remains an architectural/review guard, not a same-process sandbox.

## Verification

The focused suite is `npm run test:m2-3-1`; the aggregate `npm test` includes it. Required checks remain `npm run typecheck`, `npm run check:authority-boundary`, `npm run test:deployment`, and `git diff --check`.
