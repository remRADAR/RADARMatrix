# RADARMatrix Security Model

## Executive Summary

RADARMatrix implements a foundation security model based on:
- **Authentication**: Identity verification (OAuth 2.0 / OIDC in production)
- **Authorization**: Role-based access control (RBAC) with strict hierarchy
- **Workspace Isolation**: All operations scoped to single workspace
- **Audit & Compliance**: All write operations logged with immutability enforcement
- **Request/Response Validation**: JSON Schema validation on all inputs and outputs

## Security Principles

1. **Zero Trust**: Verify every request, never assume trust
2. **Least Privilege**: Each role has minimum necessary permissions
3. **Defense in Depth**: Multiple validation layers
4. **Separation of Concerns**: Read/write operations separated
5. **Immutability**: Decisions and memories cannot be modified after creation
6. **Auditability**: All operations logged for compliance

## Authentication

### Foundation Implementation (v0.8)
- Identity provided via `caller_id` in request context
- Role assignment via helper function `getRoleForCaller()`
- No token validation (stub implementation)

### Production Implementation (v0.9+)

**Requirements**:
- OAuth 2.0 or OIDC provider integration
- JWT token validation
- Token signature verification against issuer's public key
- Token expiry validation
- Scope validation
- Token revocation checks

**Token Structure**:
```json
{
  "sub": "user_id",
  "aud": "radarmatrix",
  "scope": "radar.search radar.remember",
  "role": "contributor",
  "workspace_id": "w_123",
  "exp": 1234567890,
  "iat": 1234567890
}
```

**Validation Steps**:
1. Extract JWT from Authorization header
2. Verify JWT signature using issuer's public key
3. Check token expiry (exp claim)
4. Verify audience (aud claim)
5. Extract role from token claims or user database
6. Return authenticated identity

### Authentication Failures

Errors returned:
- `AUTH_FAILED` (401) — No token or invalid format
- `AUTH_EXPIRED` (401) — Token expired
- `AUTH_INVALID_SIG` (401) — Signature verification failed
- `AUTH_SCOPE_MISMATCH` (403) — Required scopes not present

## Authorization (RBAC)

### Role Hierarchy

```
ADMIN (level 100)
  Full access to all operations
  
EDITOR (level 3)
  ├─ All VIEWER operations
  ├─ radar.remember (write)
  ├─ radar.record_decision (write)
  └─ Cannot access admin functions

CONTRIBUTOR (level 2)
  ├─ All VIEWER operations
  ├─ radar.remember (write)
  └─ Cannot record decisions

VIEWER (level 1)
  ├─ radar.search (read)
  ├─ radar.recall (read)
  ├─ radar.get_context (read)
  ├─ radar.get_project (read)
  ├─ radar.get_entity (read)
  └─ No write operations
```

### Permission Matrix

| Operation | VIEWER | CONTRIBUTOR | EDITOR | ADMIN |
|-----------|--------|-------------|--------|-------|
| radar.search | ✅ | ✅ | ✅ | ✅ |
| radar.recall | ✅ | ✅ | ✅ | ✅ |
| radar.get_context | ✅ | ✅ | ✅ | ✅ |
| radar.get_project | ✅ | ✅ | ✅ | ✅ |
| radar.get_entity | ✅ | ✅ | ✅ | ✅ |
| radar.remember | ❌ | ✅ | ✅ | ✅ |
| radar.record_decision | ❌ | ❌ | ✅ | ✅ |
| admin.* | ❌ | ❌ | ❌ | ✅ |

### Authorization Implementation

```typescript
function authorize(
  request: AuthenticatedRequest,
  toolRegistry: any
): boolean {
  const tool = toolRegistry[request.tool];
  if (!tool) return false;

  const required_role = tool.required_role;
  const role_hierarchy = {
    viewer: 1,
    contributor: 2,
    editor: 3,
    admin: 100
  };

  const caller_max_role = Math.max(
    ...request.caller_roles.map(r => role_hierarchy[r] || 0)
  );
  const required_level = role_hierarchy[required_role] || 0;

  return caller_max_role >= required_level;
}
```

### Authorization Failures

Errors returned:
- `FORBIDDEN` (403) — User role insufficient for requested operation
- `ROLE_EXPIRED` (403) — User's role has expired (time-bounded roles)
- `ROLE_REVOKED` (403) — User's role has been revoked

## Workspace Isolation

### Principle

All operations are scoped to a single workspace. Users cannot:
- Access data from other workspaces
- Bypass workspace boundaries
- List other workspaces
- Perform cross-workspace operations

### Implementation

1. **Request Context Validation**
   - Every request must include `workspace_id`
   - Workspace ID must be non-empty string

2. **Tool-Specific Validation**
   - Tool execution validates workspace parameter
   - Query results filtered by workspace
   - Write operations limited to specified workspace

3. **Audit Trail**
   - Workspace ID included in every audit event
   - Audit logs separated per workspace

### Enforcement

```typescript
function validateWorkspaceIsolation(
  request: AuthenticatedRequest
): boolean {
  return (
    request.workspace_id !== undefined &&
    request.workspace_id.length > 0
  );
}
```

### Workspace Isolation Failures

Errors returned:
- `INVALID_WORKSPACE` (400) — Missing or malformed workspace_id
- `UNAUTHORIZED_WORKSPACE` (403) — User not authorized for this workspace
- `WORKSPACE_NOT_FOUND` (404) — Specified workspace does not exist

## Audit & Immutability

### Write Operations

Operations that modify state:
- `radar.remember` — Records to memory
- `radar.record_decision` — Records to decision log

### Audit Events

Every write operation generates an audit event:
```
{
  operation: "WRITE_OPERATION",
  caller_id: "user_123",
  workspace_id: "w_456",
  tool: "radar.remember",
  timestamp: "2026-08-18T10:30:00Z",
  is_write: true,
  success: true,
  error_code?: undefined
}
```

**Audit Event Contents**:
- Operation type (WRITE_OPERATION, UNAUTHORIZED_ACCESS, etc.)
- Caller identity
- Workspace ID
- Tool name
- Timestamp (ISO 8601)
- Success/failure status
- Error code (if failed)

**NOT Included in Audit Events**:
- Request parameters (could contain sensitive data)
- Response data (for privacy)
- User credentials
- API keys or tokens

### Immutability Enforcement

All created resources are immutable:
- Decisions cannot be modified after creation
- Memories cannot be modified after creation
- Status can change (e.g., decision superseded) but history preserved
- Delete operations not supported in foundation

Response includes `immutable: true` flag:
```json
{
  "success": true,
  "data": {
    "memory_id": "mem_123",
    "recorded_at": "2026-08-18T10:30:00Z",
    "immutable": true
  }
}
```

### Audit Trail Storage

**Foundation (v0.8)**:
- Logged to console
- Not persisted

**Production (v1.0+)**:
- Stored in Cloudflare D1 audit table
- Separate from application data
- Immutable (append-only)
- Searchable by workspace, caller, tool
- Retention per organizational policy

## Request/Response Validation

### Input Validation

1. **Format Validation**
   - Request must be valid JSON
   - Must contain required fields: `tool`, `params`

2. **Schema Validation**
   - Tool's input schema must match request parameters
   - Required fields must be present
   - Type validation on parameters

3. **Semantic Validation**
   - workspace_id must not be empty
   - Entity IDs must be valid format
   - Numeric parameters must be in valid range

### Output Validation

Every response must include:
```typescript
interface MCPResponse {
  success: boolean;              // Required
  data?: Record<string, any>;    // If success = true
  error?: {                       // If success = false
    code: string;                // Standard error code
    message: string;             // Human-readable message
    status: number;              // HTTP status code
  };
  metadata: {                    // Always required
    request_id: string;          // Unique request ID
    timestamp: string;           // ISO 8601 timestamp
    execution_time_ms: number;   // Milliseconds taken
  };
}
```

### Error Codes

| Code | Status | Description |
|------|--------|-------------|
| INVALID_REQUEST | 400 | Malformed request |
| AUTH_FAILED | 401 | Authentication failed |
| FORBIDDEN | 403 | Authorization failed |
| NOT_FOUND | 404 | Resource not found |
| INVALID_WORKSPACE | 400 | Invalid workspace context |
| RATE_LIMITED | 429 | Too many requests |
| INTERNAL_ERROR | 500 | Server error |

## What Is NOT Included

To maintain security and compliance, RADARMatrix explicitly does NOT:

### Destructive Operations
- Delete operations on decisions or memories
- Purge functions
- Bulk deletion

### Financial Operations
- Payment processing
- Currency conversion
- Billing
- Cost calculation

### Credential Storage
- API keys
- OAuth tokens
- Passwords
- Private keys

### Production Infrastructure
- Database connections (foundation)
- OAuth provider credentials (foundation)
- Vector database credentials (foundation)
- Storage account keys (foundation)

## Production Security Requirements

When deploying RADARMatrix to production, you MUST:

### 1. OAuth/OIDC Integration
- [ ] Configure real OAuth 2.0 or OIDC provider
- [ ] Implement JWT verification
- [ ] Validate token signatures
- [ ] Check token expiry
- [ ] Verify audience and scopes
- [ ] Implement token revocation

### 2. Data Security
- [ ] Enable encryption at rest (D1, R2)
- [ ] Enable encryption in transit (HTTPS/TLS)
- [ ] Implement key rotation
- [ ] Use secure key management service

### 3. Access Control
- [ ] Implement row-level security in D1
- [ ] Enforce workspace isolation at database layer
- [ ] Use service account for OAuth validation
- [ ] Implement rate limiting per workspace and user

### 4. Audit & Compliance
- [ ] Enable D1 audit logging
- [ ] Implement audit log retention policy
- [ ] Set up compliance monitoring
- [ ] Configure SIEM integration

### 5. Monitoring & Alerting
- [ ] Set up authentication failure alerts
- [ ] Monitor authorization failures
- [ ] Alert on unusual access patterns
- [ ] Track API usage per workspace
- [ ] Monitor error rates

### 6. Secrets Management
- [ ] No hardcoded credentials in code
- [ ] Use Cloudflare Workers environment variables
- [ ] Implement secret rotation
- [ ] Restrict access to secret management

## Threat Model

### 1. Unauthenticated Access
**Threat**: Attacker gains access without valid credentials
**Mitigation**: OAuth/OIDC token verification, JWT signature validation

### 2. Privilege Escalation
**Threat**: User with VIEWER role calls EDITOR-only tools
**Mitigation**: RBAC enforcement, role hierarchy validation

### 3. Cross-Workspace Access
**Threat**: User accesses data from another workspace
**Mitigation**: Workspace isolation validation, row-level security in DB

### 4. Audit Log Tampering
**Threat**: Attacker modifies audit logs to hide activity
**Mitigation**: Immutable append-only audit logs, separate audit database

### 5. Token Theft
**Threat**: OAuth token intercepted and used by attacker
**Mitigation**: TLS for all communication, short token expiry, revocation support

### 6. Denial of Service
**Threat**: Attacker overwhelms system with requests
**Mitigation**: Rate limiting per workspace, request throttling

### 7. Data Exfiltration
**Threat**: Attacker extracts unauthorized data
**Mitigation**: Workspace isolation, audit logging, access monitoring

## Compliance

### Data Protection
- Complies with GDPR data minimization principles
- Supports data retention policies
- Enables audit trails for compliance

### Access Control
- Implements RBAC for fine-grained access control
- Supports role-based audit logging
- Enables compliance monitoring

### Audit & Logging
- All write operations logged
- Audit logs immutable
- Supports compliance reporting

## Future Enhancements

### v0.9
- Real OAuth 2.0 / OIDC integration
- JWT signature verification
- Token expiry validation

### v1.0
- Database encryption at rest
- Encryption in transit (HTTPS/TLS)
- Row-level security in D1
- Audit log retention policies

### v1.1
- Advanced threat detection
- Behavioral analysis
- Anomaly detection
- Automated incident response

---

**RADARMatrix v0.8** | Security Foundation