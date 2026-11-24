# Specialist Skills and Task Routing

## Current capability

RADARMatrix now has a versioned, declarative specialist registry and a deterministic plan-only router. It selects the smallest useful specialist set from the requested goal, associates skill IDs, and returns a bounded handoff plan. It does **not** invoke a model, persist a task, start a worker, or perform an external action. This is deliberate: the repository has no agent execution provider/queue, and the existing production OAuth/MCP transport is not live.

The registry is in `apps/agent-skills/registry.json`; adapted skill guidance is in `apps/agent-skills/skills/`. Source provenance is recorded in the registry and `apps/agent-skills/README.md`.

## Specialist profiles

The configured roster contains a plan-only RADAR Orchestrator and eight specialists: RADAR Social Intelligence, Agent Architect, Application Engineer, Web Engineer, AI Builder/Vibecode Engineer, Debug/Incident Responder, Market Intelligence Analyst, and Authorized Product Study Analyst. Optional `code-language` support is attached when language/runtime semantics or migration is central.

Routing precedence is incident diagnosis, AI-builder work, authorized product study, RADAR social intelligence, agent architecture, market intelligence, web development, then general application engineering. The router uses configured keyword signals, stable ordering, an optional explicit category, a maximum of two specialists, and a clarification response when no configured route matches. The orchestrator performs routing/review only; it is not a hidden executor.

## Interfaces

- `GET /api/agents` returns the safe agent directory and available routing categories.
- `POST /api/task-routing/plan` accepts `{ "goal": "...", "category": "auto" }` and returns a route plan only.
- MCP contract tools `radar.list_agents` and `radar.plan_task` are read-only and require `workspace_id`; the plan tool also requires a goal.
- The Brand Studio Agent Operations view uses those API routes to browse the roster and preview a route.

Task goals are bounded to 4,000 characters. The route plan identifies candidate agents, skills, rationales, ordered handoffs, unresolved questions, and an explicit execution state of `plan_only`. It does not echo the full task body into audit metadata. All agents have no MCP tools granted; connector access must be implemented and authorized separately.

## Master Agent

`radar_master_agent` is the master / lead handling agent for the brand's major activities. It is not a sub-agent: it takes a request end to end, and the other profiles are its bench.

### Load contract

Say **"load agent from the repo"** (or "load the master agent", "load master agent", "load agent from repo", "load the agent", "radar master agent"). That single instruction resolves the agent with everything already integrated — no manual assembly, no per-skill import:

| Resolved at load | Source |
|---|---|
| Agent definition, lead role, futuristic skill set, goals, upgrade behaviour | `apps/agent-skills/skills/radar-master-agent.md` |
| All 13 skills (12 discipline skills + the master definition) | `apps/agent-skills/skills/*.md` |
| All 15 workflow prompts (14 recipes + the router) | `apps/agent-skills/queues/*.md` |
| Every knowledge cue, with versions | `apps/agent-skills/knowledge-index.json` |
| Content hashes proving the corpus is intact | `apps/agent-skills/skill-manifest.json` |

Three ways to load:

- **In conversation** — the phrase above. The router matches the `master_agent` route (priority 110) and returns the master agent as the lead.
- **Through the gateway** — `radar.load_agent` with `{ workspace_id, instruction }`. Read-only, viewer-level, workspace-scoped. It returns the resolved bundle: agent, skills, workflows, cues, coverage counts, and `complete: true|false`.
- **From the shell** — `node -e "console.log(JSON.stringify(require('./apps/mcp-server/src/runtime/master-agent.cjs').loadMasterAgent({instruction:'load agent from the repo'}),null,2))"`.

The load **resolves and reports only**. It performs no model call, no connector call, no external action, and it cannot grant a capability: `assertRegistry()` still requires every profile — this one included — to be `plan_only` with `allowedMcpTools: []`.

`coverage` is the honesty check. If a skill file is missing or stubbed, or a cue's target does not exist, the load reports `complete: false` and names the gap rather than claiming a full load.

### Knowledge cues

`knowledge-index.json` is the runtime-resolvable knowledge base. Each cue has an `id`, a `type`, a `version`, and a target:

- `workspace-asset` — resolved live from the workspace store (`asset_voice`, `asset_visual`, `asset_community`, `asset_pillars`).
- `workspace-record` — a dotted path into the workspace record (`policy`, `safety`).
- `repo-skill` / `repo-workflow` / `repo-doc` — a file in this repository, path-confined to its root.
- `external-source` — cited by URL; never fetched at load.
- `learned-skill` / `learned-cue` — knowledge captured by the upgrade script; carries its own summary and resolves inline.

A cue is *resolved* only when its target actually exists. That is what makes the index a knowledge base rather than a list of names.

### Self-upgrade

The agent improves itself from each prompt. One script, runnable from the repo:

```bash
npm run upgrade-agent -- "the prompt that was handled" \
  --skill new-skill-id:Skill Name:what it does \
  --cue new-cue-id:the fact learned \
  --revise voice-tone:the corrected guidance \
  --question "what is still unknown"
```

Or structured: `--input '{"prompt":"…","skills":[…],"cues":[…],"revisions":[…],"questions":[…]}'`, or `--from-file run.json`.

What happens, end to end:

1. **Capture** — the prompt, new skills, new cues, revisions, open questions.
2. **Reconcile** — matched by `id`. Identical content is **de-duplicated** (counted, not written). Different content is a **revision**: the entry's summary is replaced, its own version is bumped, and the prior text is preserved in the changelog.
3. **Version** — `generation` increments and `indexVersion` advances (minor for additions, patch when revisions are present). Every touched entry gets `updatedAt`.
4. **Record** — one entry appended to `docs/KNOWLEDGE-CHANGELOG.md`: generation, version, prompt digest, added, revised (with prior text), de-duplicated, open questions, resulting counts.

Useful flags: `--dry-run` previews without writing; `--verify` (`npm run verify-agent`) checks the index is well-formed and every manifest file exists. A run that learned nothing writes nothing and says so — the upgrade is eager, not noisy.

The upgrade path only grows knowledge. It never edits the registry, never changes a role, and never adds a tool grant.

### Keeping the corpus honest

`npm run manifest:agent` regenerates `skill-manifest.json` from the registry and the queue files, hashing the real bytes. `node scripts/rebuild-skill-manifest.mjs --check` fails if the manifest has drifted. Run it after any intentional re-sync from the upstream source pack.

## Next work before autonomous runs

A separate execution milestone must add a verified model/provider adapter, durable run/task state, a scoped worker/queue, cancellation/retry/idempotency behavior, per-tool capability enforcement, human approval for external side effects, and production OAuth/workspace authorization. The current deterministic planner should remain the preflight stage and must not be presented as an active multi-agent conversation until those components exist.
