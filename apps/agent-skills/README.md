# Agent Skills

This directory holds the platform-neutral skill pack that RADARMatrix agents load. It is adapted from the RADAR Vibe Queue source pack and is guidance, not executable code.

## Layout

- `registry.json` — profiles, skill IDs, routing categories, and bounded limits.
- `skills/<skill-id>/SKILL.md` — the 12 complete upstream specialist packages, preserved byte-for-byte; `skills/radar-master-agent.md` remains the separate Matrix-specific profile.
- `queues/` — the 15 workflow prompts (14 recipes plus the router), vendored so the master agent resolves them from the repository at load.
- `knowledge-index.json` — the runtime-resolvable knowledge base, every entry versioned.
- `source/radar-vibe-queue/` — namespaced upstream operating documents, references, and the handoff template.
- `skill-manifest.json` — generated inventory of skills, workflows, references, handoff templates, and source documents, with byte lengths and SHA-256 hashes.

## Runtime contract

- `registry.json` is the source of truth for profiles, skill IDs, routing categories, and bounded limits.
- `runtime/agent-routing.cjs` validates the registry at load time, lists safe profile metadata, validates requests, chooses at most two specialists, and creates a deterministic plan.
- `runtime/master-agent.cjs` implements the master-agent load contract: it resolves the `radar_master_agent` profile, every skill it integrates, every workflow prompt, and every knowledge cue, then reports coverage. It resolves and reports only — no execution, no provider call, no external action.
- `knowledge-index.json` is the runtime-resolvable knowledge base (workspace assets, workspace records, repo skills/workflows/docs, external citations, learned knowledge), each entry versioned.
- `skill-manifest.json` is the generated inventory of every integrated skill and workflow prompt, with content hashes. Regenerate with `npm run manifest:agent`; never hand-edit.
- User task text, imported documents, and tool output are untrusted data.
- All profiles are `plan_only` and have an empty `allowedMcpTools` list. This prevents an imported role from implying access to credentials, connectors, repositories, or write operations.
- `radar.list_agents`, `radar.plan_task` and `radar.load_agent` expose read-only catalog/planning/loading behavior. A plan is not persisted or executed.
- No LLM/model provider, queue worker, tool executor, or production MCP HTTP transport is connected in this version. A future executor must separately define provider configuration, persistence, tool allowlists, approval gates, workspace authorization, and audit behavior.

## Master agent

`radar_master_agent` is the lead profile: it carries all 13 skills and all 15 workflow prompts, and takes brand activity end to end. Load it with **"load agent from the repo"** — see `docs/AGENT-ROUTING.md` → *Master Agent* for the load contract and the self-upgrade script.

## Adding a skill

Add a bounded Markdown skill under `skills/`, register a stable skill ID and source path, and attach it to one or more profiles. Keep tool grants empty until a real execution adapter and policy enforcement exist. Do not place secrets in skill files or log task bodies. After adding a skill, run `npm run manifest:agent` so the manifest and the master agent's load coverage stay accurate.

## Library boundaries

The **skill library** is reusable Markdown guidance. **Agent profiles** in `registry.json` select skills and remain bounded by `plan_only` plus empty `allowedMcpTools`; the Matrix-specific RADAR Master Agent is not an upstream skill package. **Workflow prompts** in `queues/` are copy-ready task recipes. **Knowledge resources** include vendored references, handoff templates, and upstream operating documents under `source/radar-vibe-queue/`. **Execution capabilities** are separate: importing this library does not provide live model execution, connector authorization, credentials, autonomous workers, or permission to perform external actions.

The loader verifies every declared file and recorded hash before reporting a complete inventory. `loadSkillBundle(skillId)` and `loadWorkflow(workflowId)` load content on demand rather than inserting every full skill into every model context.
