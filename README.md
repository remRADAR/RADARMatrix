# RADARMatrix

**RADARMatrix** is the cloud intelligence and memory layer for RADARCharts by REM.

## Purpose

RADARMatrix provides a foundation for integrating knowledge management, context retrieval, and decision auditing into AI-powered workflows via Model Context Protocol (MCP) contracts. It establishes secure, workspace-scoped boundaries between ChatGPT, MCP applications, and a canonically-authored data and retrieval engine.

## Current Status

⚠️ **Integration Foundation v0.8** — This repository contains:

- ✅ MCP gateway architecture with authentication, authorization, and workspace isolation
- ✅ Authentication/authorization boundaries with role-based access control (RBAC)
- ✅ Workspace isolation model with audit trails
- ✅ Nine MCP tool contracts: seven foundation tools plus two read-only agent directory/routing tools
- ✅ Versioned RADAR specialist skill registry and deterministic, plan-only task routing in Brand Studio
- ✅ Sandboxed live-preview UI and explicit-consent browser-control integration point
- ✅ Comprehensive security model (read/write separation, immutability, audit events)
- ✅ OAuth protected resource definition
- ✅ Existing foundation checks plus agent-router and BrandGateway API regression tests
- ⏳ **NOT**: Production Cloudflare (D1/R2/Vectorize) deployment
- ⏳ **NOT**: Live MCP endpoint
- ⏳ **NOT**: Live ChatGPT connection
- ⏳ **NOT**: Live OAuth/OIDC validation
- ⏳ **NOT**: Database or vector store connectivity

Production connectivity, deployment infrastructure, and live credential validation are not yet implemented.

## Architecture

RADARMatrix enforces these boundaries:

```
ChatGPT / AI Application
  ↓
MCP / Model Context Protocol
  ↓
RADARMatrix MCP Gateway
  ↓
Authentication Layer
  ↓
Authorization Layer (RBAC)
  ↓
Workspace Isolation
  ↓
Audit & Event Tracking
  ↓
Tool Execution Engine
  ↓
Context / Retrieval Engine
  ↓
Canonical Data + Document Storage + Vector Retrieval
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for complete system design.

## MCP Tool Contract (foundation)

RADARMatrix defines nine MCP tools in the contract. The agent directory and task planner are read-only and plan-only; they do not invoke a model, save a run, or perform external actions. The live MCP endpoint remains unimplemented.

### Read Operations (VIEWER+)

| Tool | Description | Role | Type |
|------|-------------|------|------|
| `radar.search` | Full-text and semantic search across canonical data and documents | VIEWER+ | Read |
| `radar.recall` | Retrieve decisions and context from decision log | VIEWER+ | Read |
| `radar.get_context` | Load workspace context and configuration | VIEWER+ | Read |
| `radar.get_project` | Get project metadata and associated entities | VIEWER+ | Read |
| `radar.get_entity` | Get entity details, relationships, and context | VIEWER+ | Read |
| `radar.list_agents` | List the configured workspace-scoped specialist profiles | VIEWER+ | Read / plan-only |
| `radar.plan_task` | Preview a deterministic route to up to two specialists | VIEWER+ | Read / plan-only |

### Write Operations

| Tool | Description | Role | Type |
|------|-------------|------|------|
| `radar.remember` | Record data to workspace memory | CONTRIBUTOR+ | Write |
| `radar.record_decision` | Log decision with rationale and metadata | EDITOR+ | Write |

## Agent Skills and Task Routing

The RADAR VIBE QUEUE skill pack is adapted into a declarative registry and platform-neutral role files under [`apps/agent-skills/`](apps/agent-skills/). Brand Studio exposes `GET /api/agents` and `POST /api/task-routing/plan`; the planner is deterministic, bounded to 4,000 characters and at most two specialists, and returns clarification questions when no route matches. See [`docs/AGENT-ROUTING.md`](docs/AGENT-ROUTING.md) for categories, pipeline stages, and the execution boundary.

## Live Preview and Browser Control

Brand Studio now has a Live Preview view with an HTTP(S)-only URL form and isolated sandboxed iframe. The Browser Takeover panel remains disabled by default because the repository does not contain an authenticated browser-session service or remote-control transport; it is not simulated. A trusted host adapter contract and production security requirements are documented in [`docs/PREVIEW-AND-BROWSER-CONTROL.md`](docs/PREVIEW-AND-BROWSER-CONTROL.md).

## Role-Based Access Control

| Role | Read Operations | Write Operations | Admin |
|------|-----------------|------------------|-------|
| VIEWER | ✅ All read tools | ❌ None | ❌ |
| CONTRIBUTOR | ✅ All read tools | ✅ `radar.remember` | ❌ |
| EDITOR | ✅ All read tools | ✅ `radar.remember`, `radar.record_decision` | ❌ |
| ADMIN | ✅ All operations | ✅ All operations | ✅ Full access |

## Security Model

### Authentication
- OAuth 2.0 / OIDC token validation (foundation: caller_id context)
- Request context includes: `caller_id`, `workspace_id`, `request_id`, `timestamp`

### Authorization
- Role-based access control (RBAC) with strict role hierarchy
- Per-tool permission checks with fallback to workspace default role
- No destructive, financial, or credential storage operations

### Workspace Isolation
- All operations scoped to single workspace
- Cross-workspace data access forbidden
- Workspace validation on every request

### Audit & Immutability
- All write operations generate audit events
- Decisions and memories marked immutable after creation
- Audit trail includes: operation type, actor, timestamp, workspace, tool
- Audit events do not include sensitive data

### Request/Response Validation
- JSON Schema validation on all input parameters
- Response validation ensures consistent metadata and structure
- Error responses include standard error codes and messages

## Implementation Status

### Foundation Files

- [ARCHITECTURE.md](ARCHITECTURE.md) — Complete system design and component responsibilities
- [SECURITY.md](SECURITY.md) — Detailed security requirements, threat model, and controls
- [docs/V0.8-CHATGPT-INTEGRATION.md](docs/V0.8-CHATGPT-INTEGRATION.md) — Integration specification and roadmap
- [docs/USAGE-TUTORIAL.md](docs/USAGE-TUTORIAL.md) — Step-by-step operating tutorial
- [docs/BRAND-ASSET-APP.md](docs/BRAND-ASSET-APP.md) — Brand-asset application product model
- [docs/AGENT-ROUTING.md](docs/AGENT-ROUTING.md) — Specialist registry, routing rules, and plan-only boundary
- [docs/PREVIEW-AND-BROWSER-CONTROL.md](docs/PREVIEW-AND-BROWSER-CONTROL.md) — Sandboxed live preview and trusted host-bridge contract

### Core Gateway

- `apps/mcp-server/src/mcp-gateway.ts` — MCP request handler with full pipeline
- `apps/mcp-server/src/chatgpt-app-contract.ts` — Tool definitions and schemas
- `apps/mcp-server/.well-known/oauth-protected-resource.json` — OAuth configuration

### Testing

- `tests/v0.7-gateway.test.mjs` — 18 gateway tests (authentication, authorization, isolation, errors)
- `tests/v0.8-chatgpt-contract.test.mjs` — 38 contract tests (tools, schemas, validation)
- `tests/agent-routing.test.mjs` — Deterministic routing, registry, and boundary tests
- `tests/brand-gateway-routing.test.mjs` — Authenticated API and no-side-effect integration checks
- `tests/test-runner.mjs` — Orchestrated test execution
- **Status**: run `npm test` for the current verification result

### Project Configuration

- `package.json` — NPM configuration with test scripts

## Running Tests

```bash
npm test                    # Run all tests
npm run test:gateway        # Run gateway tests only
npm run test:contract        # Run contract tests
npm run test:agents          # Run route planner and BrandGateway integration tests
npm run brand:dev             # Run the local brand command center
```

## Next Steps

### v0.9: Production Hardening
- OAuth 2.0 / OIDC integration with real token validation
- JWT signature verification against issuer public keys
- Token expiry and scope validation
- Scope-based permission checks

### v1.0: Database Integration
- Cloudflare D1 integration for metadata storage
- Cloudflare R2 integration for document storage
- Cloudflare Vectorize for semantic search
- Real tool execution with data persistence

### v1.1+: Production Deployment
- MCP server deployment and scaling
- ChatGPT plugin registration
- Performance optimization and monitoring
- Comprehensive audit logging and compliance reporting

## Security Considerations

This is a **foundation** implementation. Production use requires:

- **No production credentials in configuration** — All OAuth tokens, API keys, and secrets must be managed by the deployment environment
- **Live OAuth validation** — Tokens must be validated against a real OAuth/OIDC issuer
- **Database encryption** — All stored data must be encrypted at rest
- **HTTPS/TLS everywhere** — All communication must be encrypted in transit
- **Rate limiting** — Implement rate limits per workspace and user
- **Audit retention** — Maintain audit trails for compliance
- **Access control** — Verify and enforce workspace isolation

See [SECURITY.md](SECURITY.md) for complete security requirements.

## Contributing

This is a foundation implementation. Contributions should follow the architecture defined in [ARCHITECTURE.md](ARCHITECTURE.md) and security model in [SECURITY.md](SECURITY.md).

## License

MIT

---

**RADARMatrix v0.8** | Integration Foundation
