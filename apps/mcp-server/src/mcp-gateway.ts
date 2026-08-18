/**
 * RADARMatrix MCP Gateway
 * Version: 0.9 (workspace-isolation hardening)
 *
 * Development transport/foundation.
 * NOT production-ready until the production authentication,
 * persistence, audit, and transport layers are implemented.
 */

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

const {
  DevelopmentAuthenticationProvider,
} = require("./providers/authentication");

const {
  DefaultAuthorizationProvider,
} = require("./providers/authorization");

const {
  DevelopmentMembershipProvider,
} = require("./providers/membership");

/**
 * Development providers.
 *
 * These are intentionally isolated behind provider interfaces so that
 * production implementations can replace them without changing the
 * gateway's security flow.
 */

const authProvider = new DevelopmentAuthenticationProvider();

const authorizationProvider =
  new DefaultAuthorizationProvider();

const membershipProvider =
  new DevelopmentMembershipProvider({
    members: {
      admin_123: ["w_dev"],
      editor_456: ["w_dev"],
      contributor_789: ["w_dev"],
      viewer_000: ["w_dev"],
    },
  });

/**
 * Authenticate an incoming MCP request.
 */
function authenticate(
  request: MCPRequest,
): AuthenticatedRequest | null {
  const principal = authProvider.authenticate(request);

  if (!principal) {
    return null;
  }

  return {
    caller_id: principal.caller_id,
    caller_roles: principal.roles,
    workspace_id: principal.workspace_id,
    request_id:
      principal.request_id || generateRequestId(),
    timestamp:
      principal.timestamp || new Date().toISOString(),
    tool: request.tool,
    params: request.params,
  };
}

/**
 * Authorize the authenticated caller against the tool registry.
 */
function authorize(
  request: AuthenticatedRequest,
  toolRegistry: any,
): boolean {
  return authorizationProvider.isAuthorized(
    request,
    toolRegistry,
    request.tool,
  );
}

/**
 * Fail-closed workspace isolation.
 *
 * A request is permitted only when:
 *
 * 1. caller_id exists
 * 2. workspace_id exists
 * 3. the membership provider explicitly confirms membership
 *
 * No fallback authorization is permitted here.
 */
function validateWorkspaceIsolation(
  request: AuthenticatedRequest,
): boolean {
  if (
    !request ||
    !request.caller_id ||
    !request.workspace_id
  ) {
    return false;
  }

  return membershipProvider.isMember(
    request.caller_id,
    request.workspace_id,
  );
}

/**
 * Audit write operations.
 *
 * Production implementation must replace console logging
 * with an append-only durable audit store.
 */
function auditOperation(event: AuditEvent): void {
  if (!event.is_write) {
    return;
  }

  const status = event.success
    ? "SUCCESS"
    : `FAILED(${event.error_code || "UNKNOWN"})`;

  console.log(
    `[AUDIT] ${event.operation} | ` +
      `${event.caller_id}@${event.workspace_id} | ` +
      `${event.tool} | ${status}`,
  );
}

/**
 * Validate the incoming request against the tool registry.
 */
function validateRequest(
  request: MCPRequest,
  toolRegistry: any,
): string[] {
  const errors: string[] = [];

  if (!request || typeof request !== "object") {
    return ["Invalid request"];
  }

  if (!request.tool || typeof request.tool !== "string") {
    errors.push("Missing tool");
    return errors;
  }

  const tool = toolRegistry[request.tool];

  if (!tool) {
    errors.push(`Unknown tool: ${request.tool}`);
    return errors;
  }

  if (
    !request.params ||
    typeof request.params !== "object"
  ) {
    errors.push("Missing params");
  }

  if (tool.input_schema?.required) {
    for (const field of tool.input_schema.required) {
      if (
        !request.params ||
        !(field in request.params)
      ) {
        errors.push(
          `Missing required field: ${field}`,
        );
      }
    }
  }

  if (!request.context?.workspace_id) {
    errors.push(
      "Missing workspace_id in context",
    );
  }

  return errors;
}

/**
 * Validate the standard RADARMatrix response envelope.
 */
function validateResponse(
  response: MCPResponse,
): boolean {
  if (!response?.metadata) {
    return false;
  }

  if (
    !response.metadata.request_id ||
    !response.metadata.timestamp ||
    response.metadata.execution_time_ms ===
      undefined
  ) {
    return false;
  }

  if (
    response.error &&
    (
      !response.error.code ||
      !response.error.message
    )
  ) {
    return false;
  }

  return true;
}

/**
 * Development tool executor.
 *
 * These implementations intentionally return deterministic
 * development-safe structures. Real persistence will be added
 * through the production repository layer.
 */
function executeTool(
  request: AuthenticatedRequest,
): any {
  switch (request.tool) {
    case "radar.search":
      return {
        results: [],
        total: 0,
      };

    case "radar.recall":
      return {
        decisions: [],
        memories: [],
      };

    case "radar.get_context":
      return {
        workspace_id:
          request.workspace_id,
        config: {},
      };

    case "radar.get_project":
      return {
        project_id:
          request.params.project_id,
        name: "Project",
        entities: [],
      };

    case "radar.get_entity":
      return {
        entity_id:
          request.params.entity_id,
        type: "entity",
        data: {},
      };

    case "radar.remember":
      return {
        memory_id: generateId(),
        recorded_at:
          new Date().toISOString(),
        recorded_by:
          request.caller_id,
        immutable: true,
      };

    case "radar.record_decision":
      return {
        decision_id: generateId(),
        recorded_at:
          new Date().toISOString(),
        recorded_by:
          request.caller_id,
        immutable: true,
      };

    default:
      throw new Error(
        `Unknown tool: ${request.tool}`,
      );
  }
}

/**
 * Main MCP request lifecycle:
 *
 * Validate
 *   ↓
 * Authenticate
 *   ↓
 * Workspace isolation
 *   ↓
 * Authorize
 *   ↓
 * Execute
 *   ↓
 * Audit
 *   ↓
 * Validate response
 */
function handleMCPRequest(
  request: MCPRequest,
  toolRegistry: any,
): MCPResponse {
  const startTime = Date.now();

  const requestId =
    request?.context?.request_id ||
    generateRequestId();

  const timestamp =
    new Date().toISOString();

  try {
    /**
     * 1. Request validation
     */
    const validationErrors =
      validateRequest(
        request,
        toolRegistry,
      );

    if (validationErrors.length) {
      return createErrorResponse(
        "INVALID_REQUEST",
        validationErrors.join("; "),
        400,
        requestId,
        timestamp,
        startTime,
      );
    }

    /**
     * 2. Authentication
     */
    const authenticated =
      authenticate(request);

    if (!authenticated) {
      return createErrorResponse(
        "AUTH_FAILED",
        "Authentication failed",
        401,
        requestId,
        timestamp,
        startTime,
      );
    }

    /**
     * 3. Workspace isolation
     */
    if (
      !validateWorkspaceIsolation(
        authenticated,
      )
    ) {
      return createErrorResponse(
        "INVALID_WORKSPACE",
        "Caller is not a member of the requested workspace",
        403,
        requestId,
        timestamp,
        startTime,
      );
    }

    /**
     * 4. Tool authorization
     */
    if (
      !authorize(
        authenticated,
        toolRegistry,
      )
    ) {
      auditOperation({
        operation:
          "UNAUTHORIZED_ACCESS",
        caller_id:
          authenticated.caller_id,
        workspace_id:
          authenticated.workspace_id,
        tool:
          authenticated.tool,
        timestamp,
        is_write: false,
        success: false,
        error_code:
          "FORBIDDEN",
      });

      return createErrorResponse(
        "FORBIDDEN",
        `User role(s) ${authenticated.caller_roles.join(
          ", ",
        )} cannot access ${authenticated.tool}`,
        403,
        requestId,
        timestamp,
        startTime,
      );
    }

    /**
     * 5. Execute
     */
    const tool =
      toolRegistry[
        authenticated.tool
      ];

    const result =
      executeTool(authenticated);

    /**
     * 6. Audit successful writes
     */
    if (tool.is_write_operation) {
      auditOperation({
        operation:
          "WRITE_OPERATION",
        caller_id:
          authenticated.caller_id,
        workspace_id:
          authenticated.workspace_id,
        tool:
          authenticated.tool,
        timestamp,
        is_write: true,
        success: true,
      });
    }

    /**
     * 7. Response validation
     */
    const response =
      createSuccessResponse(
        result,
        requestId,
        timestamp,
        startTime,
      );

    if (!validateResponse(response)) {
      throw new Error(
        "Response validation failed",
      );
    }

    return response;
  } catch (error: any) {
    return createErrorResponse(
      "INTERNAL_ERROR",
      error?.message ||
        "Internal server error",
      500,
      requestId,
      timestamp,
      startTime,
    );
  }
}

function createSuccessResponse(
  data: any,
  requestId: string,
  timestamp: string,
  startTime: number,
): MCPResponse {
  return {
    success: true,
    data,
    metadata: {
      request_id: requestId,
      timestamp,
      execution_time_ms:
        Date.now() - startTime,
    },
  };
}

function createErrorResponse(
  code: string,
  message: string,
  status: number,
  requestId: string,
  timestamp: string,
  startTime: number,
): MCPResponse {
  return {
    success: false,
    error: {
      code,
      message,
      status,
    },
    metadata: {
      request_id: requestId,
      timestamp,
      execution_time_ms:
        Date.now() - startTime,
    },
  };
}

function generateRequestId(): string {
  return (
    `req_${Date.now()}_` +
    Math.random()
      .toString(36)
      .slice(2, 11)
  );
}

function generateId(): string {
  return (
    `id_${Date.now()}_` +
    Math.random()
      .toString(36)
      .slice(2, 11)
  );
}

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