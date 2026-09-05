# RADARMatrix Brand-Asset Application

## Product purpose

RADARMatrix is becoming the remRADAR brand’s governed operating application. It is the place where canonical brand knowledge, reusable assets, content drafts, approvals, community work, newsletter ideas, and account-safety state come together.

The first usable slice is intentionally local and dependency-free. It provides a navigable brand command center with persistent browser-local demo state. It does not claim to be a production database, live Instagram connector, or live recovery system.

## First slice

The first slice includes:

| Surface | Purpose |
|---|---|
| Overview | Brand health, pending approvals, content pipeline, and safety status |
| Brand assets | Canonical voice, colors, visual direction, policy, and reusable content pillars |
| Content queue | Drafts and approvals with clear execution boundaries |
| Community | Triage categories, response status, and human-review posture |
| Instagram safety | Account state, webhook status, rate governance, and emergency-stop control |
| Activity | Audit-oriented recent changes and actions |

## Product principles

The application should treat brand assets as canonical records, not loose inspiration. Every public action should be connected to a policy version, approval state, account state, and audit event. The interface should make the difference between draft, approved, scheduled, sent, blocked, and unverified explicit.

The local first slice uses a small client-side state model. Future persistence should map the same objects to the existing MCP gateway, workspace storage, and audit model rather than replacing those boundaries.

## Future integration seams

The UI is prepared for future adapters:

- `brandAssets` → canonical memory and document retrieval.
- `contentQueue` → draft, approval, scheduling, publication, and receipt services.
- `communityItems` → comments, messages, mentions, moderation, and human escalation.
- `safety` → webhook monitor, rate governor, circuit breakers, and incident records.
- `activity` → immutable audit events and decision records.

## Non-goals for this slice

This first slice does not send Instagram messages, publish content, change account settings, accept collaborations, submit appeals, or store production credentials. Those actions require authenticated connectors, server-side authorization, durable storage, consent, and explicit approval gates.

## Implemented local runtime seam

The Brand Studio server now calls a server-side `BrandGateway` adapter for workspace reads and writes. The adapter reuses the development authentication, authorization, and membership providers, then applies the local token-bucket rate guard, approval and consent gates, mutation-pause state, and audit append before invoking storage operations.

The local `WorkspaceStore` persists workspace state and audit events through atomic JSON-file replacement. The default path is `.data/workspace.json`, which is ignored by Git. This adapter is a local durable-storage implementation and is not a production database. Its purpose is to give the interface a real persistence boundary now while keeping the future database migration behind the same gateway contract.
