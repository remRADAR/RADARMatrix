/**
 * RADARMatrix MCP Gateway
 * Version: 0.9
 *
 * Security-hardened development gateway.
 *
 * Execution pipeline:
 *
 * REQUEST
 *   ↓
 * REQUEST VALIDATION
 *   ↓
 * AUTHENTICATION
 *   ↓
 * WORKSPACE MEMBERSHIP
 *   ↓
 * AUTHORIZATION
 *   ↓
 * TOOL EXECUTION
 *   ↓
 * AUDIT
 *   ↓
 * RESPONSE VALIDATION
 *
 * IMPORTANT:
 * This remains a development/foundation gateway.
 * Production authentication must use verified OAuth/OIDC tokens.
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

/**
 * Development providers.
 *
 * Production replacements must preserve these interfaces.
 */
const {
  DevelopmentAuthenticationProvider,
} = require("./providers/authentication");

const {
  DefaultAuthorizationProvider,
} = require("./providers/authorization");

const {
  DevelopmentMembershipProvider,
} = require("./providers/membership");

const {
  TOOL_REGISTRY,
} = require("./chatgpt-app-contract");

const authProvider =
  new DevelopmentAuthenticationProvider();

const authorizationProvider =
  new DefaultAuthorizationProvider();

const membershipProvider =
  new DevelopmentMembershipProvider();

/**
 * --------------------------------------------------------------------------
 * AUTHENTICATION
 * --------------------------------------------------------------------------
 */

function authenticate(
  request: MCPRequest,
): AuthenticatedRequest | null {
  const principal =
    authProvider.authenticate(request);

  if (!principal) {
    return null;
  }

  return {
    caller_id: principal.caller_id,
    caller_roles: principal.roles,
    workspace_id: principal.workspace_id,
    request_id:
      principal.request_id ||
      generateRequestId(),
    timestamp:
      principal.timestamp ||
      new Date().toISOString(),
    tool: request.tool,
    params: request.params,
  };
}

/**
 * --------------------------------------------------------------------------
 * MEMBERSHIP / WORKSPACE ISOLATION
 * --------------------------------------------------------------------------
 *
 * Authentication answers:
 * "Who are you?"
 *
 * Membership answers:
 * "Are you allowed inside this workspace?"
 *
 * Workspace ID supplied by a request is NEVER treated as proof
 * of membership.
 */

function validateWorkspaceIsolation(
  request: AuthenticatedRequest,
): boolean {
  if (
    !request ||
    typeof request.caller_id !== "string" ||
    request.caller_id.trim() === ""
  ) {
    return false;
  }

  if (
    typeof request.workspace_id !== "string" ||
    request.workspace_id.trim() === ""
  ) {
    return false;
  }

  return membershipProvider.isMember(
    request.caller_id,
    request.workspace_id,
  );
}

/**
 * --------------------------------------------------------------------------
 * AUTHORIZATION
 * --------------------------------------------------------------------------
 */

function authorize(
  request: AuthenticatedRequest,
): boolean {
  return authorizationProvider.isAuthorized(
    request,
    TOOL_REGISTRY,
    request.tool,
  );
}

/**
 * --------------------------------------------------------------------------
 * REQUEST VALIDATION
 * --------------------------------------------------------------------------
 */

function validateRequest(
  request: MCPRequest,
): string[] {
  const errors: string[] = [];

  if (
    !request ||
    typeof request !== "object"
  ) {
    return ["Invalid request"];
  }

  if (
    typeof request.tool !== "string" ||
    request.tool.trim() === ""
  ) {
    errors.push("Missing tool");
    return errors;
  }

  if (
    !request.params ||
    typeof request.params !== "object" ||
    Array.isArray(request.params)
  ) {
    errors.push(
      "Invalid params object",
    );
  }

  if (
    !request.context ||
    typeof request.context !== "object"
  ) {
    errors.push(
      "Missing request context",
    );
    return errors;
  }

  if (
    typeof request.context.caller_id !==
      "string" ||
    request.context.caller_id.trim() === ""
  ) {
    errors.push(
      "Missing caller_id in context",
    );
  }

  if (
    typeof request.context.workspace_id !==
      "string" ||
    request.context.workspace_id.trim() === ""
  ) {
    errors.push(
      "Missing workspace_id in context",
    );
  }

  const tool =
    TOOL_REGISTRY[request.tool];

  if (!tool) {
    errors.push(
      `Unknown tool: ${request.tool}`,
    );
    return errors;
  }

  const requiredFields =
    Array.isArray(
      tool.input_schema?.required,
    )
      ? tool.input_schema.required
      : [];

  for (const field of requiredFields) {
    if (
      !Object.prototype.hasOwnProperty.call(
        request.params,
        field,
      )
    ) {
      errors.push(
        `Missing required field: ${field}`,
      );
    }
  }

  /**
   * Prevent a request from silently operating on
   * a workspace different from its authenticated context.
   *
   * If a tool contains workspace_id in params,
   * it must equal the authenticated context.
   */
  if (
    Object.prototype.hasOwnProperty.call(
      request.params,
      "workspace_id",
    )
  ) {
    if (
      request.params.workspace_id !==
      request.context.workspace_id
    ) {
      errors.push(
        "Workspace mismatch between context and params",
      );
    }
  }

  return errors;
}

/**
 * --------------------------------------------------------------------------
 * RESPONSE VALIDATION
 * --------------------------------------------------------------------------
 */

function validateResponse(
  response: MCPResponse,
): boolean {
  if (
    !response ||
    typeof response !== "object"
  ) {
    return false;
  }

  if (
    typeof response.success !== "boolean"
  ) {
    return false;
  }

  if (!response.metadata) {
    return false;
  }

  if (
    typeof response.metadata.request_id !==
      "string" ||
    response.metadata.request_id.length ===
      0
  ) {
    return false;
  }

  if (
    typeof response.metadata.timestamp !==
      "string" ||
    response.metadata.timestamp.length ===
      0
  ) {
    return false;
  }

  if (
    typeof response.metadata
      .execution_time_ms !==
      "number"
  ) {
    return false;
  }

  if (response.error) {
    if (
      typeof response.error.code !==
        "string" ||
      typeof response.error.message !==
        "string" ||
      typeof response.error.status !==
        "number"
    ) {
      return false;
    }
  }

  return true;
}

/**
 * --------------------------------------------------------------------------
 * TOOL EXECUTION
 * --------------------------------------------------------------------------
 *
 * v0.9 still uses deterministic development implementations.
 *
 * The security pipeline is real.
 * The underlying persistence/retrieval layer remains a development
 * boundary until the production storage providers are connected.
 */

function executeTool(
  request: AuthenticatedRequest,
): Record<string, any> {
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
        entities: [],
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
      };

    case "radar.record_decision":
      return {
        decision_id: generateId(),
        recorded_at:
          new Date().toISOString(),
      };

    default:
      throw new GatewayError(
        "UNKNOWN_TOOL",
        `Unknown tool: ${request.tool}`,
        404,
      );
  }
}

/**
 * --------------------------------------------------------------------------
 * AUDIT
 * --------------------------------------------------------------------------
 */

function auditOperation(
  event: AuditEvent,
): void {
  /**
   * Development implementation:
   * write operations are logged.
   *
   * Production:
   * append-only durable audit storage.
   */
  if (event.is_write) {
    const status = event.success
      ? "SUCCESS"
      : `FAILED(${event.error_code || "UNKNOWN"})`;

    console.log(
      `[AUDIT] ${event.operation} | ` +
        `${event.caller_id}@${event.workspace_id} | ` +
        `${event.tool} | ${status}`,
    );
  }
}

/**
 * --------------------------------------------------------------------------
 * GATEWAY REQUEST HANDLER
 * --------------------------------------------------------------------------
 */

function handleRequest(
  request: MCPRequest,
): MCPResponse {
  const startedAt = Date.now();

  const requestId =
    request?.context?.request_id ||
    generateRequestId();

  const timestamp =
    new Date().toISOString();

  /**
   * 1. Validate request shape.
   */
  const validationErrors =
    validateRequest(request);

  if (validationErrors.length > 0) {
    return buildErrorResponse(
      requestId,
      timestamp,
      startedAt,
      "INVALID_REQUEST",
      validationErrors.join("; "),
      400,
    );
  }

  /**
   * 2. Authenticate.
   */
  const authenticated =
    authenticate(request);

  if (!authenticated) {
    return buildErrorResponse(
      requestId,
      timestamp,
      startedAt,
      "UNAUTHENTICATED",
      "Authentication failed",
      401,
    );
  }

  /**
   * 3. Verify workspace membership.
   */
  if (
    !validateWorkspaceIsolation(
      authenticated,
    )
  ) {
    const isWrite =
      isWriteOperation(
        authenticated.tool,
      );

    auditOperation({
      operation:
        "workspace_membership_check",
      caller_id:
        authenticated.caller_id,
      workspace_id:
        authenticated.workspace_id,
      tool: authenticated.tool,
      timestamp:
        new Date().toISOString(),
      is_write: isWrite,
      success: false,
      error_code:
        "WORKSPACE_FORBIDDEN",
    });

    return buildErrorResponse(
      authenticated.request_id,
      authenticated.timestamp,
      startedAt,
      "WORKSPACE_FORBIDDEN",
      "Caller is not a member of the requested workspace",
      403,
    );
  }

  /**
   * 4. Authorize tool.
   */
  if (!authorize(authenticated)) {
    const isWrite =
      isWriteOperation(
        authenticated.tool,
      );

    auditOperation({
      operation:
        "authorization_check",
      caller_id:
        authenticated.caller_id,
      workspace_id:
        authenticated.workspace_id,
      tool: authenticated.tool,
      timestamp:
        new Date().toISOString(),
      is_write: isWrite,
      success: false,
      error_code:
        "FORBIDDEN",
    });

    return buildErrorResponse(
      authenticated.request_id,
      authenticated.timestamp,
      startedAt,
      "FORBIDDEN",
      "Caller is not authorized to invoke this tool",
      403,
    );
  }

  /**
   * 5. Execute.
   */
  const isWrite =
    isWriteOperation(
      authenticated.tool,
    );

  try {
    const data =
      executeTool(authenticated);

    /**
     * 6. Audit successful write operations.
     */
    auditOperation({
      operation:
        "tool_execution",
      caller_id:
        authenticated.caller_id,
      workspace_id:
        authenticated.workspace_id,
      tool: authenticated.tool,
      timestamp:
        new Date().toISOString(),
      is_write: isWrite,
      success: true,
    });

    /**
     * 7. Construct response.
     */
    const response: MCPResponse = {
      success: true,
      data,
      metadata: {
        request_id:
          authenticated.request_id,
        timestamp:
          new Date().toISOString(),
        execution_time_ms:
          Date.now() - startedAt,
      },
    };

    /**
     * 8. Validate response before returning.
     */
    if (!validateResponse(response)) {
      return buildErrorResponse(
        authenticated.request_id,
        authenticated.timestamp,
        startedAt,
        "INVALID_RESPONSE",
        "Gateway generated an invalid response",
        500,
      );
    }

    return response;
  } catch (error) {
    const gatewayError =
      normalizeError(error);

    auditOperation({
      operation:
        "tool_execution",
      caller_id:
        authenticated.caller_id,
      workspace_id:
        authenticated.workspace_id,
      tool: authenticated.tool,
      timestamp:
        new Date().toISOString(),
      is_write: isWrite,
      success: false,
      error_code:
        gatewayError.code,
    });

    return buildErrorResponse(
      authenticated.request_id,
      authenticated.timestamp,
      startedAt,
      gatewayError.code,
      gatewayError.message,
      gatewayError.status,
    );
  }
}

/**
 * --------------------------------------------------------------------------
 * HELPERS
 * --------------------------------------------------------------------------
 */

function isWriteOperation(
  toolName: string,
): boolean {
  const tool =
    TOOL_REGISTRY[toolName];

  return Boolean(
    tool &&
      tool.is_write_operation === true,
  );
}

function buildErrorResponse(
  requestId: string,
  timestamp: string,
  startedAt: number,
  code: string,
  message: string,
  status: number,
): MCPResponse {
  const response: MCPResponse = {
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
        Date.now() - startedAt,
    },
  };

  /**
   * Defensive validation.
   *
   * If this itself fails, return the same shape rather than
   * exposing an exception or sensitive internal information.
   */
  if (!validateResponse(response)) {
    return {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message:
          "Unable to construct a valid gateway response",
        status: 500,
      },
      metadata: {
        request_id: requestId,
        timestamp:
          new Date().toISOString(),
        execution_time_ms:
          Date.now() - startedAt,
      },
    };
  }

  return response;
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

class GatewayError extends Error {
  code: string;
  status: number;

  constructor(
    code: string,
    message: string,
    status: number,
  ) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.status = status;
  }
}

function normalizeError(
  error: unknown,
): {
  code: string;
  message: string;
  status: number;
} {
  if (error instanceof GatewayError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
    };
  }

  /**
   * Never expose arbitrary internal exception messages
   * to the external caller.
   */
  return {
    code: "INTERNAL_ERROR",
    message: "Tool execution failed",
    status: 500,
  };
}

/**
 * --------------------------------------------------------------------------
 * EXPORTS
 * --------------------------------------------------------------------------
 */

module.exports = {
  authenticate,
  authorize,
  validateWorkspaceIsolation,
  validateRequest,
  validateResponse,
  executeTool,
  auditOperation,
  handleRequest,
  isWriteOperation,
  generateRequestId,
  generateId,
  GatewayError,
};