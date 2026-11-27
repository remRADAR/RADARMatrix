# Specialist Skills and Task Routing

RADARMatrix contains a vendored, verifiable specialist knowledge library and a separate Matrix-specific agent-profile layer. The library is guidance, not executable authority.

## Complete source integration

The 12 upstream packages from `remRADAR/radar-vibe-queue` are preserved under `apps/agent-skills/skills/<skill-id>/SKILL.md` at pinned commit `e8262b19a71c8b0b3d338b69a81659ebc5a8980c`. The existing `radar-master-agent` profile remains separate because it is Matrix-specific. The 15 upstream workflow prompts are under `apps/agent-skills/queues/`.

Supporting resources are namespaced under `apps/agent-skills/source/radar-vibe-queue/`: three RADARMeta references, the agent-continuation handoff template, and the upstream `AGENTS.md`, `QUEUE.md`, `queue.json`, `SKILL-AUDIT.md`, and `SOURCE_NOTES.md` operating documents. No live fetch is required at load time.

## Distinct layers

- **Skill library:** complete Markdown specialist instructions and bundled reference material.
- **Agent profiles:** `registry.json` entries that select skills, categories, and metadata. They do not grant capabilities.
- **Workflow prompts:** copy-ready queue recipes loaded by workflow ID.
- **Knowledge resources:** references, templates, source documents, and workspace cues indexed in `knowledge-index.json`.
- **Execution capabilities:** provider adapters, connector authorization, credentials, workers, and external side effects. These are not supplied by the library.

Every profile remains `plan_only` and every `allowedMcpTools` array remains empty. Loading a skill never authorizes a connector, model call, repository write, deployment, or autonomous execution.

## Inventory and load contracts

`verifyInventory()` checks every declared skill, workflow, reference, source document, and handoff template for existence, substantive content, recorded byte length, and SHA-256 equality. Missing or corrupted content fails closed and is returned in `unresolvedItems`; the loader never reports `complete: true` for a partial corpus.

`loadSkillBundle(skillId)` rejects unknown IDs and path traversal, then returns the complete specialist text, associated references, metadata, file hashes, and upstream provenance. `loadWorkflow(workflowId)` returns the actual queue prompt and its hash result. `loadSourceDocument(file)` resolves only declared supporting resources. These are on-demand APIs so the full corpus is not unnecessarily inserted into every model context.

`loadMasterAgent()` verifies the complete inventory, resolves the selected profile and its skills, reports cue coverage against the live workspace, and explicitly returns `execution.mode: plan_only`. It does not invoke a provider, persist a run, start a worker, or perform an external action.

## Routing interfaces

- `GET /api/agents` returns safe profile metadata.
- `POST /api/task-routing/plan` accepts `{ "goal": "...", "category": "auto" }` and returns a bounded deterministic handoff plan.
- MCP contract tools `radar.list_agents`, `radar.plan_task`, and `radar.load_agent` are read-only and workspace-scoped.

The router selects at most two specialists. Frontier Router guidance determines the smallest useful skill set; the Master Agent coordinates verification and synthesis but is not a hidden executor.

## Verification commands

```bash
npm test
npm run typecheck
npm run verify-agent
node scripts/rebuild-skill-manifest.mjs --check
npm run check:authority-boundary
```

The manifest is generated from actual files. Never fabricate hashes or hand-edit `skill-manifest.json`; run `npm run manifest:agent` after an authorized source update.
