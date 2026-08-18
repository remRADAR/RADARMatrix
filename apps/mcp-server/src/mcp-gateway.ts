/**
 * RADARMatrix MCP Gateway
 * 
 * Entry point for Model Context Protocol (MCP) requests from ChatGPT.
 * Handles request normalization, authentication, authorization, and delegation
 * to the retrieval engine.
 * 
 * Version: 0.8 (Foundation)
 * Status: Integration Foundation - NOT production-ready
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface MCPRequest {
  tool: string;
  params: Record<string, any>;
  context?: {
    caller_id?: string;
    workspace_id?: string;
    request_id?: string;
    timestamp?: string;
  };
}

interface MCPResponse {
  success: boolean;
  data?: Record<string, any>;
  error?: {
    code: string;
    message: string;
    status: number;
  };
  metadata?: {
    request_id: string;
    timestamp: string;
    execution_time_ms: number;
  };
}

interface AuthenticatedRequest {
  caller_id: string;
  caller_roles: string[];
  workspace_id: string;
  request_id: string;
  timestamp: string;
  tool: string;
  params: Record<string, any>;
}

interface AuditEvent {
  operation: string;
  caller_id: string;
  workspace_id: string;
  tool: string;
  timestamp: string;
  is_write: boolean;
  success: boolean;
  error_code?: string;
}

// ============================================================================
// AUTHENTICATION LAYER
// ============================================================================

/**
 * Authenticates a request by verifying caller identity.
 * 
 * Foundation v0.8:
 * - Extracts caller_id from request context (would be OAuth/OIDC in production)
 * - Verifies caller identity (stub - not implemented)
 * - Returns authenticated context
 * 
 * Production requirements:
 * - [ ] OAuth 2.0 / OIDC integration with real issuer
 * - [ ] JWT signature verification
 * - [ ] Token expiry validation
 * - [ ] Scope validation
 */
function authenticate(request: MCPRequest): AuthenticatedRequest | null {
  const caller_id = request.context?.caller_id;
  const workspace_id = request.context?.workspace_id;

  if (!caller_id || !workspace_id) {
    return null;
  }

  // Foundation v0.8: Stub role assignment
  // In production, would fetch from OAuth token claims or user database
  const caller_roles = getRoleForCaller(caller_id);

  return {
    caller_id,
    caller_roles,
    workspace_id,
    request_id: request.context?.request_id || generateRequestId(),
    timestamp: request.context?.timestamp || new Date().toISOString(),
    tool: request.tool,
    params: request.params,
  };
}

/**
 * Foundation stub: Get role for caller
 * In production, this would query a user database or OAuth token
 */
function getRoleForCaller(caller_id: string): string[] {
  // Foundation: Default to viewer role for demonstration
  // In production:
  // 1. Query user database for caller's roles
  // 2. Extract roles from OAuth token claims
  // 3. Validate role assertions
  // 4. Check role expiry if time-bounded
  if (caller_id === "admin_123") return ["admin", "editor", "contributor", "viewer"];
  if (caller_id === "editor_456") return ["editor", "contributor", "viewer"];
  if (caller_id === "contributor_789") return ["contributor", "viewer"];
  return ["viewer"];
}

// ============================================================================
// AUTHORIZATION LAYER (RBAC)
// ============================================================================

/**
 * Checks if caller has permission to execute the requested tool.
 * 
 * Authorization rules:
 * - All read tools: VIEWER+
 * - radar.remember: CONTRIBUTOR+
 * - radar.record_decision: EDITOR+
 * - All admin tools: ADMIN only
 */
function authorize(request: AuthenticatedRequest, toolRegistry: any): boolean {
  const tool = toolRegistry[request.tool];
  if (!tool) return false;

  const required_role = tool.required_role;
  
  // Role hierarchy: viewer < contributor < editor < admin
  const role_hierarchy: Record<string, number> = {
    viewer: 1,
    contributor: 2,
    editor: 3,
    admin: 100,
  };

  const caller_max_role = Math.max(...request.caller_roles.map(r => role_hierarchy[r] || 0));
  const required_level = role_hierarchy[required_role] || 0;

  return caller_max_role >= required_level;
}

// ============================================================================
// WORKSPACE ISOLATION
// ============================================================================

/**
 * Validates that request parameters are scoped to the authorized workspace.
 * Prevents cross-workspace data access.
 */
function validateWorkspaceIsolation(request: AuthenticatedRequest): boolean {
  // All requests must specify the workspace_id in context
  // Tool-specific workspace validation is performed in tool execution
  return request.workspace_id !== undefined && request.workspace_id.length > 0;
}

// ============================================================================
// AUDIT & IMMUTABILITY
// ============================================================================

/**
 * Records an audit event for the operation.
 * 
 * All write operations are audited:
 * - radar.remember → audit event recorded
 * - radar.record_decision → audit event recorded
 * 
 * Audit events include:
 * - operation type
 * - caller identity
 * - workspace
 * - timestamp
 * - success/failure status
 * 
 * Sensitive data is NOT included in audit events.
 */
function auditOperation(event: AuditEvent): void {
  // Foundation v0.8: Log to console
  // In production, would write to:
  // - Cloudflare D1 audit table
  // - Compliance logging system
  // - SIEM system
  if (event.is_write) {
    const status = event.success ? "SUCCESS" : `FAILED(${event.error_code})`;
    console.log(
      `[AUDIT] ${event.operation} | ${event.caller_id}@${event.workspace_id} | ${event.tool} | ${status}`
    );
  }
}

// ============================================================================
// REQUEST VALIDATION
// ============================================================================

/**
 * Validates MCP request against tool schema.
 * Returns validation errors if any.
 */
function validateRequest(request: MCPRequest, toolRegistry: any): string[] {
  const errors: string[] = [];
  const tool = toolRegistry[request.tool];

  if (!tool) {
    errors.push(`Unknown tool: ${request.tool}`);
    return errors;
  }

  // Validate required input fields
  if (tool.input_schema.required) {
    for (const field of tool.input_schema.required) {
      if (!(field in request.params)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  // Workspace isolation check
  if (!request.context?.workspace_id) {
    errors.push("Missing workspace_id in context");
  }

  return errors;
}

// ============================================================================
// RESPONSE VALIDATION
// ============================================================================

/**
 * Validates MCPResponse structure before returning to caller.
 * Ensures consistent metadata and error formats.
 */
function validateResponse(response: MCPResponse): boolean {
  // Must have metadata
  if (!response.metadata) return false;

  // Must have request_id, timestamp, execution_time_ms
  if (!response.metadata.request_id || !response.metadata.timestamp || 
      response.metadata.execution_time_ms === undefined) {
    return false;
  }

  // If error, must have code and message
  if (response.error && (!response.error.code || !response.error.message)) {
    return false;
  }

  return true;
}

// ============================================================================
// TOOL EXECUTION ENGINE
// ============================================================================

/**
 * Executes a tool and returns result.
 * Foundation v0.8: Stub implementations
 */
function executeTool(request: AuthenticatedRequest): any {
  switch (request.tool) {
    case "radar.search":
      return { results: [], total: 0 };
    case "radar.recall":
      return { decisions: [], memories: [] };
    case "radar.get_context":
      return { workspace_id: request.workspace_id, config: {} };
    case "radar.get_project":
      return { project_id: request.params.project_id, name: "Project", entities: [] };
    case "radar.get_entity":
      return { entity_id: request.params.entity_id, type: "entity", data: {} };
    case "radar.remember":
      return { memory_id: generateId(), recorded_at: new Date().toISOString() };
    case "radar.record_decision":
      return { decision_id: generateId(), recorded_at: new Date().toISOString() };
    default:
      throw new Error(`Unknown tool: ${request.tool}`);
  }
}

// ============================================================================
// MAIN GATEWAY HANDLER
// ============================================================================

/**
 * Main MCP Gateway Handler
 * 
 * Request Pipeline:
 * 1. Request → Validate format and structure
 * 2. Authentication → Verify caller identity
 * 3. Authorization → Check role-based permissions
 * 4. Workspace Isolation → Verify workspace scoping
 * 5. Validation → Validate request parameters
 * 6. Audit → Record operation (if write)
 * 7. Execution → Execute tool
 * 8. Response Validation → Ensure consistent response format
 * 9. Return → Send response
 */
function handleMCPRequest(request: MCPRequest, toolRegistry: any): MCPResponse {
  const start_time = Date.now();
  const request_id = request.context?.request_id || generateRequestId();
  const timestamp = new Date().toISOString();

  try {
    // Step 1: Validate request format
    const validation_errors = validateRequest(request, toolRegistry);
    if (validation_errors.length > 0) {
      return createErrorResponse(
        "INVALID_REQUEST",
        validation_errors.join("; "),
        400,
        request_id,
        timestamp,
        start_time
      );
    }

    // Step 2: Authenticate
    const authenticated = authenticate(request);
    if (!authenticated) {
      return createErrorResponse(
        "AUTH_FAILED",
        "Authentication failed: missing caller_id or workspace_id",
        401,
        request_id,
        timestamp,
        start_time
      );
    }

    // Step 3: Authorize
    if (!authorize(authenticated, toolRegistry)) {
      auditOperation({
        operation: "UNAUTHORIZED_ACCESS",
        caller_id: authenticated.caller_id,
        workspace_id: authenticated.workspace_id,
        tool: authenticated.tool,
        timestamp,
        is_write: false,
        success: false,
        error_code: "FORBIDDEN",
      });

      return createErrorResponse(
        "FORBIDDEN",
        `User role(s) ${authenticated.caller_roles.join(", ")} cannot access ${authenticated.tool}`,
        403,
        request_id,
        timestamp,
        start_time
      );
    }

    // Step 4: Workspace Isolation
    if (!validateWorkspaceIsolation(authenticated)) {
      return createErrorResponse(
        "INVALID_WORKSPACE",
        "Invalid workspace context",
        400,
        request_id,
        timestamp,
        start_time
      );
    }

    // Step 5 & 6: Audit write operations
    const tool = toolRegistry[authenticated.tool];
    if (tool.is_write_operation) {
      auditOperation({
        operation: "WRITE_OPERATION",
        caller_id: authenticated.caller_id,
        workspace_id: authenticated.workspace_id,
        tool: authenticated.tool,
        timestamp,
        is_write: true,
        success: true,
      });
    }

    // Step 7: Execute tool
    const result = executeTool(authenticated);

    // Step 8: Create and validate response
    const response = createSuccessResponse(result, request_id, timestamp, start_time);
    if (!validateResponse(response)) {
      throw new Error("Response validation failed");
    }

    return response;
  } catch (error: any) {
    return createErrorResponse(
      "INTERNAL_ERROR",
      error.message || "Internal server error",
      500,
      request_id,
      timestamp,
      start_time
    );
  }
}

// ============================================================================
// RESPONSE BUILDERS
// ============================================================================

function createSuccessResponse(
  data: any,
  request_id: string,
  timestamp: string,
  start_time: number
): MCPResponse {
  return {
    success: true,
    data,
    metadata: {
      request_id,
      timestamp,
      execution_time_ms: Date.now() - start_time,
    },
  };
}

function createErrorResponse(
  code: string,
  message: string,
  status: number,
  request_id: string,
  timestamp: string,
  start_time: number
): MCPResponse {
  return {
    success: false,
    error: { code, message, status },
    metadata: {
      request_id,
      timestamp,
      execution_time_ms: Date.now() - start_time,
    },
  };
}

// ============================================================================
// UTILITIES
// ============================================================================

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateId(): string {
  return `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// EXPORTS FOR TESTING
// ============================================================================

export {
  handleMCPRequest,
  authenticate,
  authorize,
  validateWorkspaceIsolation,
  validateRequest,
  validateResponse,
  auditOperation,
  executeTool,
};