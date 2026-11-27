# Skill portfolio audit

**Audit date:** 2026-11-09
**Scope:** `remRADAR/radar-vibe-queue` compared with the Manus account skill bank visible during this session. This repository audit does not modify the account’s separately managed/platform-provided skills.

## Findings

The repository contained 11 skill packages before this addition; it now contains 12 importable skill packages and 14 focused queue prompts (plus the general router prompt). The `agent-continuation` package was tracked but omitted from `queue.json`, the README import table, and the prompt index. The manifest and README therefore understated the actual inventory.

The portfolio has distinct value in RADARCharts-specific social intelligence, AI-builder output review, incident coordination, cross-language semantics, authorized product study, and project-local cross-agent handoffs. Several broader packages overlap account-level skills such as production engineering, systematic debugging, deep research, finance-pro-playbooks, accessibility, API design, code review, performance, SEO, and security. That overlap is acceptable for a portable repository when the bundle adds context, but broad triggers made routing ambiguous. The chosen fix is to narrow triggers and defer generic tasks to focused account skills, not to copy the entire account catalog into this repository.

## Package disposition

| Package | Disposition | Distinctive purpose / boundary |
|---|---|---|
| `frontier-router` | Add; top-level router | First-pass, project-aware skill selection across the session’s actual account and repository skill inventories.

| `radar-vibe-queue` | Retain; tighten | Router for this repository’s RADAR workflows; account specialists take precedence for generic work. |
| `radar-meta` | Retain; tighten | RADARCharts social/account intelligence and read-only recommendations by default. |
| `universal-agent-architect` | Retain; tighten | Material AI-agent/tool-system design, not generic coding or workflow automation. |
| `application-engineering` | Retain; tighten | Portable cross-layer checklist where focused framework/domain skills do not suffice. |
| `web-development` | Retain; tighten | Cross-frontend/backend web-app coordination; defer focused accessibility/security/performance/SEO work. |
| `lovable-vibecode` | Retain; tighten | Review and verification of Lovable/AI-builder-generated output and platform-specific integrations. |
| `debug-incident` | Retain; tighten | Incident coordination and difficult cross-layer failures; routine bugs defer to systematic debugging. |
| `market-intelligence` | Retain; tighten | Financial source/period/risk discipline; detailed investment analysis defers to finance-pro-playbooks. Removed unsupported broker-integration claim from trigger. |
| `code-language` | Retain; tighten | Cross-language translation/migration where runtime semantics affect behavior. |
| `authorized-product-study` | Retain; tighten | Scoped study before an independent equivalent or authorized audit; no access-control bypass/copying. |
| `agent-continuation` | Retain; tighten | Only genuine cross-agent/session handoffs; ledger creation respects user/repository policy and present-state/history semantics are clarified. |

## Changes made

- Reconciled the README and JSON manifest with the actual package/prompt counts; added `agent-continuation` to import and queue indexes.
- Added `frontier-router` as the root entry skill and clarified the RADAR VIBE QUEUE router as its repository-specific sub-router.
- Added a dedicated handoff prompt and exposed it through both routers.
- Narrowed package descriptions to their distinctive use cases and made account-specialist precedence explicit in the umbrella router.
- Removed the unsupported broker-integration promise and corrected the continuation skill’s overly broad must-create/must-write rules and append-only conflict.

## Not changed

The Frontier Router consults the session’s available skill descriptions at runtime; no generic account skills were copied, removed, or modified. No package was retired: the audit found complementary context that remains useful in a portable repository. Detailed contents of referenced resources were not exhaustively rewritten; this was a targeted trigger, inventory, and safety-boundary pass.
