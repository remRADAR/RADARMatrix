# RADARMatrix

**RADARMatrix** is the cloud intelligence and memory layer for RADARCharts by REM.

## Purpose

RADARMatrix provides a foundation for integrating knowledge management, context retrieval, and decision auditing into AI-powered workflows via Model Context Protocol (MCP) contracts. It establishes secure, workspace-scoped boundaries between ChatGPT, MCP applications, and a canonically-authored data and retrieval engine.

## Current Status

⚠️ **Integration Foundation v0.8** — This repository contains:

- ✅ MCP gateway architecture with authentication, authorization, and workspace isolation
- ✅ Authentication/authorization boundaries with role-based access control (RBAC)
- ✅ Workspace isolation model with audit trails
- ✅ Seven production-ready MCP tools with full type safety
- ✅ Comprehensive security model (read/write separation, immutability, audit events)
- ✅ OAuth protected resource definition
- ✅ Complete test suite (56 tests, all passing)
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

## MCP Tool Contract (v0.8)

RADARMatrix exposes seven production MCP tools:

### Read Operations (VIEWER+)

| Tool | Description | Role | Type |
|------|-------------|------|------|
| `radar.search` | Full-text and semantic search across canonical data and documents | VIEWER+ | Read |
| `radar.recall` | Retrieve decisions and context from decision log | VIEWER+ | Read |
| `radar.get_context` | Load workspace context and configuration | VIEWER+ | Read |
| `radar.get_project` | Get project metadata and associated entities | VIEWER+ | Read |
| `radar.get_entity` | Get entity details, relationships, and context | VIEWER+ | Read |

### Write Operations

| Tool | Description | Role | Type |
|------|-------------|------|------|
| `radar.remember` | Record data to workspace memory | CONTRIBUTOR+ | Write |
| `radar.record_decision` | Log decision with rationale and metadata | EDITOR+ | Write |

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

### Core Gateway

- `apps/mcp-server/src/mcp-gateway.ts` — MCP request handler with full pipeline
- `apps/mcp-server/src/chatgpt-app-contract.ts` — Tool definitions and schemas
- `apps/mcp-server/.well-known/oauth-protected-resource.json` — OAuth configuration

### Testing

- `tests/v0.7-gateway.test.mjs` — 18 gateway tests (authentication, authorization, isolation, errors)
- `tests/v0.8-chatgpt-contract.test.mjs` — 38 contract tests (tools, schemas, validation)
- `tests/test-runner.mjs` — Orchestrated test execution
- **Status**: 56/56 tests passing ✅

### Project Configuration

- `package.json` — NPM configuration with test scripts

## Running Tests

```bash
npm test                    # Run all tests
npm run test:gateway        # Run gateway tests only
npm run test:contract       # Run contract tests only
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