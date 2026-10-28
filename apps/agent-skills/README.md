# RADARMatrix Agent Skills

The registry in `registry.json` adapts the user's RADAR VIBE QUEUE skill pack into declarative RADARMatrix roles. Source reference: <https://github.com/remRADAR/radar-vibe-queue>, branch `main`, commit `813095879cf10047142193af52c9c4223e606451` (reviewed 28 October 2026). The `skills/*.md` files here are platform-neutral adaptations; they are not copied platform commands, executable code, or authorization grants.

## Runtime contract

- `registry.json` is the source of truth for profiles, skill IDs, routing categories, and bounded limits.
- `runtime/agent-routing.cjs` validates the registry at load time, lists safe profile metadata, validates requests, chooses at most two specialists, and creates a deterministic plan.
- User task text, imported documents, and tool output are untrusted data.
- All profiles are `plan_only` and have an empty `allowedMcpTools` list. This prevents an imported role from implying access to credentials, connectors, repositories, or write operations.
- `radar.list_agents` and `radar.plan_task` expose read-only catalog/planning behavior. A plan is not persisted or executed.
- No LLM/model provider, queue worker, tool executor, or production MCP HTTP transport is connected in this version. A future executor must separately define provider configuration, persistence, tool allowlists, approval gates, workspace authorization, and audit behavior.

## Adding a skill

Add a bounded Markdown skill under `skills/`, register a stable skill ID and source path, and attach it to one or more profiles. Keep tool grants empty until a real execution adapter and policy enforcement exist. Do not place secrets in skill files or log task bodies.
