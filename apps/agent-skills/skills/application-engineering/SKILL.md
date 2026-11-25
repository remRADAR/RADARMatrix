---
name: application-engineering
description: Portable cross-layer application-engineering checklist. Use when a product change spans multiple layers or needs coordinated requirements, architecture, implementation, and verification not better served by a focused framework/domain skill; defer standalone API, accessibility, security, performance, or framework-specific work.
---

# Application Engineering

Start from the product outcome and inspect the actual system before changing it.

## Procedure

1. Inspect repository status/history, architecture, dependencies, tests, runtime/deployment, authentication, data flows, integrations, and conventions. Read continuity notes when present.
2. Translate the request into acceptance criteria and identify scope, permissions, unknowns, rollback, and production boundaries.
3. Work through only necessary layers: user flows, architecture, data model, access controls, API contracts, UI, implementation, testing, security/privacy, performance, and operations.
4. Select technology from requirements; do not force a vendor or framework. Reuse sound existing patterns and make narrow, reversible changes.
5. Distinguish application authorization, database authorization, and tenant isolation. Check read/write cases, webhook authenticity, idempotency, retry behavior, and secrets where relevant.
6. Inspect generated/external code rather than accepting it blindly. Do not broaden access or weaken safeguards to make a test pass.
7. Run targeted tests and appropriate lint/type/build/runtime checks. Review changes for regression, security, unrelated files, and rollback needs.

Do not change production data/configuration, publish, deploy, or modify access unless authorized. Report **Implemented**, exact **Verified** evidence, **Not verified**, production impact, risks, and next approval gate; do not confuse successful compilation with end-to-end correctness.
