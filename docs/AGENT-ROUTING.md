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

## Next work before autonomous runs

A separate execution milestone must add a verified model/provider adapter, durable run/task state, a scoped worker/queue, cancellation/retry/idempotency behavior, per-tool capability enforcement, human approval for external side effects, and production OAuth/workspace authorization. The current deterministic planner should remain the preflight stage and must not be presented as an active multi-agent conversation until those components exist.
