# RADARMatrix Architecture

## Overview

RADARMatrix is a Model Context Protocol (MCP) integration layer that provides secure, workspace-scoped access to a knowledge management, context retrieval, and decision auditing system.

The architecture enforces strict boundaries between:
- **External Systems** (ChatGPT, AI applications)
- **MCP Integration Layer** (this repository)
- **Core Services** (authentication, authorization, audit, retrieval)
- **Data Layer** (canonical data, documents, vector stores)

## System Architecture

```
┌─────────────────────────────────────────┐
│      ChatGPT / AI Applications          │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│    Model Context Protocol (MCP)         │
│    Tool Invocation Contract             │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│   RADARMatrix MCP Gateway               │
│   ├─ Request Dispatcher                 │
│   └─ Response Formatter                 │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│   Authentication & Authorization        │
│   ├─ Identity Verification              │
│   ├─ Token Validation                   │
│   └─ Role-Based Access Control          │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│   Workspace Isolation                   │
│   └─ Scope All Operations               │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│   Audit & Compliance                    │
│   ├─ Write Operation Tracking           │
│   ├─ Decision Log                       │
│   └─ Immutability Enforcement           │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│   Tool Execution Engine                 │
│   ├─ Request Validation                 │
│   ├─ Tool Dispatch                      │
│   └─ Response Validation                │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│   Core Services Layer                   │
│   ├─ Retrieval Engine                   │
│   ├─ Search (full-text & semantic)      │
│   ├─ Context Loading                    │
│   └─ Decision Tracking                  │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│   Data Layer (Production)               │
│   ├─ Cloudflare D1 (metadata)           │
│   ├─ Cloudflare R2 (documents)          │
│   ├─ Cloudflare Vectorize (vectors)     │
│   └─ Audit Tables                       │
└─────────────────────────────────────────┘
```

## Component Responsibilities

### 1. MCP Gateway (`mcp-gateway.ts`)

**Responsibility**: Normalize MCP requests and orchestrate the processing pipeline.

**Key Functions**:
- `handleMCPRequest()` — Main entry point
- `authenticate()` — Identity verification
- `authorize()` — Permission checking
- `validateWorkspaceIsolation()` — Scope validation
- `validateRequest()` — Input validation
- `validateResponse()` — Output validation
- `auditOperation()` — Event tracking
- `executeTool()` — Tool invocation

**Pipeline**:
1. Request normalization
2. Format validation
3. Authentication
4. Authorization (RBAC)
5. Workspace isolation check
6. Request parameter validation
7. Audit logging (for write operations)
8. Tool execution
9. Response validation
10. Return to caller

### 2. ChatGPT App Contract (`chatgpt-app-contract.ts`)

**Responsibility**: Define MCP tool contract with schemas and validation.

**Seven Tools**:

#### Read Operations (VIEWER+)
1. **radar.search** — Full-text and semantic search
2. **radar.recall** — Decision log retrieval
3. **radar.get_context** — Workspace context loading
4. **radar.get_project** — Project metadata
5. **radar.get_entity** — Entity details

#### Write Operations
6. **radar.remember** (CONTRIBUTOR+) — Memory recording
7. **radar.record_decision** (EDITOR+) — Decision logging

**Key Components**:
- `TOOL_REGISTRY` — Complete tool definitions
- Input/output schemas for each tool
- Validation functions
- RBAC lookup functions

### 3. OAuth Protected Resource (`.well-known/oauth-protected-resource.json`)

**Responsibility**: Advertise OAuth resource definition for integration.

**Contents**:
- Resource identification
- Scopes (read, write, admin)
- Authorization server metadata
- Token endpoint information

### 4. Test Suites

#### v0.7 Gateway Tests (`v0.7-gateway.test.mjs`)
- Authentication flow validation
- Authorization checks
- Workspace isolation enforcement
- Error handling
- Request/response flow
- Audit trail generation
- Immutability enforcement

#### v0.8 Contract Tests (`v0.8-chatgpt-contract.test.mjs`)
- Tool existence validation
- Tool contract compliance
- Role-based access control
- Tool descriptions
- Request validation
- Response structure
- Write operation gating
- Registry completeness
- Security requirements

## Data Flow

### Read Operation (e.g., `radar.search`)

```
Caller
  ↓
  Send: { tool: "radar.search", params: {...}, context: {...} }
  ↓
MCP Gateway
  ├─ Authenticate caller
  ├─ Get caller roles
  ├─ Authorize tool access (VIEWER+ required)
  ├─ Validate workspace scope
  ├─ Log audit event (read operations)
  ├─ Execute tool
  ├─ Validate response
  └─ Return results
  ↓
Return: { success: true, data: {...}, metadata: {...} }
```

### Write Operation (e.g., `radar.remember`)

```
Caller
  ↓
  Send: { tool: "radar.remember", params: {...}, context: {...} }
  ↓
MCP Gateway
  ├─ Authenticate caller
  ├─ Get caller roles
  ├─ Authorize tool access (CONTRIBUTOR+ required)
  ├─ Validate workspace scope
  ├─ Validate request parameters
  ├─ CREATE AUDIT EVENT (BEFORE execution)
  ├─ Execute tool
  ├─ Mark result as immutable
  ├─ Validate response
  └─ Return result
  ↓
Return: { success: true, data: {memory_id: "...", immutable: true}, metadata: {...} }
```

## Role Hierarchy

```
ADMIN (100)
  ├─ All read operations
  ├─ All write operations
  └─ Administrative access
  ↑
EDITOR (3)
  ├─ All read operations
  ├─ radar.remember (CONTRIBUTOR+)
  ├─ radar.record_decision (EDITOR+)
  └─ Cannot access admin functions
  ↑
CONTRIBUTOR (2)
  ├─ All read operations
  ├─ radar.remember (CONTRIBUTOR+)
  └─ Cannot record decisions
  ↑
VIEWER (1)
  ├─ radar.search
  ├─ radar.recall
  ├─ radar.get_context
  ├─ radar.get_project
  ├─ radar.get_entity
  └─ No write operations
```

## Security Model

### Authentication
- **Foundation v0.8**: Caller identity via `caller_id` context field
- **Production v0.9+**: OAuth 2.0 / OIDC token validation
  - JWT signature verification
  - Token expiry validation
  - Scope validation
  - Token revocation checks

### Authorization
- **Mechanism**: Role-based access control (RBAC)
- **Hierarchy**: VIEWER → CONTRIBUTOR → EDITOR → ADMIN
- **Enforcement**: Per-tool permission checks
- **Fallback**: Workspace default role

### Workspace Isolation
- **Principle**: All operations scoped to single workspace
- **Enforcement**: 
  - Request context validation
  - Tool-specific workspace checks
  - Cross-workspace data access forbidden
  - Workspace ID in audit events

### Audit & Immutability
- **Audit Events**: All write operations logged
- **Immutability**: Decisions and memories marked immutable after creation
- **Audit Trail**: Operation, actor, timestamp, workspace, tool, status
- **Sensitive Data**: NOT included in audit events

### Request/Response Validation
- **Input Validation**: JSON Schema validation on all parameters
- **Output Validation**: Consistent metadata and structure
- **Error Format**: Standard error codes and HTTP status codes

## Deployment Architecture

### Foundation (v0.8)
- Standalone TypeScript/JavaScript implementation
- No external dependencies on infrastructure
- Stub implementations for authentication/storage
- Testable locally

### Production (v1.0+)

```
┌─────────────────────────────────────────┐
│   Cloudflare Workers (MCP Endpoint)     │
│   └─ mcp-gateway.ts deployed            │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│   Cloudflare D1 (Metadata Storage)      │
│   ├─ Projects & entities                │
│   ├─ Workspace configuration            │
│   ├─ Decisions log                      │
│   └─ Audit trail                        │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│   Cloudflare R2 (Document Storage)      │
│   ├─ Documents                          │
│   ├─ Context files                      │
│   └─ Raw data                           │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│   Cloudflare Vectorize (Semantic Search)│
│   ├─ Document embeddings                │
│   ├─ Semantic search index              │
│   └─ Vector operations                  │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│   OAuth 2.0 / OIDC Provider             │
│   ├─ Token validation                   │
│   ├─ Role information                   │
│   └─ User identity                      │
└─────────────────────────────────────────┘
```

## Integration Points

### ChatGPT / AI Applications
- **Protocol**: Model Context Protocol (MCP)
- **Tool Invocation**: JSON request/response format
- **Authentication**: OAuth 2.0 / OIDC tokens (production)

### Data Backends
- **Metadata**: Cloudflare D1 (relational)
- **Documents**: Cloudflare R2 (object storage)
- **Vectors**: Cloudflare Vectorize (vector database)

### Audit & Compliance
- **Audit Events**: Logged for compliance
- **Data Retention**: Per organizational policy
- **Access Logs**: Separate from audit events

## Scaling Considerations

### Horizontal Scaling
- Stateless gateway design
- MCP endpoints can be replicated
- Database connection pooling
- Cache layer for hot data

### Vertical Scaling
- Worker timeout limits
- Database query optimization
- Batch operations for bulk tasks
- Vector search optimization

### Multi-Tenancy
- Workspace isolation by design
- Database row-level security (future)
- Separate audit trails per workspace
- Rate limiting per workspace

## Future Enhancements

### v0.9: Production Hardening
- Real OAuth 2.0 / OIDC integration
- JWT signature verification
- Token expiry validation
- Scope-based access control

### v1.0: Database Integration
- Cloudflare D1 implementation
- Cloudflare R2 integration
- Cloudflare Vectorize integration
- Real tool execution

### v1.1: Performance
- Query caching
- Vector search optimization
- Batch operation support
- Rate limiting

### v1.2: Advanced Features
- Cross-workspace relationships
- Advanced audit reporting
- Workflow execution
- Decision versioning

---

**RADARMatrix v0.8** | Foundation Architecture