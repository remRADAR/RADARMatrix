/**
 * RADARMatrix ChatGPT App Contract
 * 
 * Defines the MCP tool contract for ChatGPT integration.
 * Specifies tool definitions, request/response types, and validation rules.
 * 
 * Version: 0.8 (Foundation)
 * Status: Integration Foundation - NOT production-ready
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * MCP Tool Definition
 */
interface MCPToolDefinition {
  name: string;
  description: string;
  required_role: string;
  is_write_operation: boolean;
  input_schema: Record<string, any>;
  output_schema: Record<string, any>;
}

/**
 * Validation result
 */
interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ============================================================================
// MCP TOOL DEFINITIONS
// ============================================================================

/**
 * Tool 1: radar.search
 * 
 * Purpose: Full-text and semantic search across canonical data and documents.
 * Permission: Viewer+
 * Audit: Yes
 * Read-Only: Yes
 */
const TOOL_RADAR_SEARCH: MCPToolDefinition = {
  name: "radar.search",
  description: "Full-text and semantic search across canonical data and documents",
  required_role: "viewer",
  is_write_operation: false,
  input_schema: {
    type: "object",
    required: ["workspace_id", "query"],
    properties: {
      workspace_id: {
        type: "string",
        description: "Workspace to search within (e.g. w_123)",
      },
      query: {
        type: "string",
        description: "Search query (full-text or semantic)",
      },
      limit: {
        type: "integer",
        description: "Maximum results to return (default: 10)",
        default: 10,
      },
      offset: {
        type: "integer",
        description: "Pagination offset (default: 0)",
        default: 0,
      },
    },
  },
  output_schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        description: "Search results",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            excerpt: { type: "string" },
            relevance_score: { type: "number" },
          },
        },
      },
      total: {
        type: "integer",
        description: "Total results available",
      },
    },
  },
};

/**
 * Tool 2: radar.recall
 * 
 * Purpose: Retrieve decisions and context from decision log.
 * Permission: Viewer+
 * Audit: Yes
 * Read-Only: Yes
 * Immutability: Decisions are immutable after creation
 */
const TOOL_RADAR_RECALL: MCPToolDefinition = {
  name: "radar.recall",
  description: "Retrieve decisions and context from decision log",
  required_role: "viewer",
  is_write_operation: false,
  input_schema: {
    type: "object",
    required: ["workspace_id"],
    properties: {
      workspace_id: {
        type: "string",
        description: "Workspace ID",
      },
      decision_id: {
        type: "string",
        description: "Optional: specific decision to retrieve",
      },
      limit: {
        type: "integer",
        description: "Maximum decisions to return",
        default: 20,
      },
    },
  },
  output_schema: {
    type: "object",
    properties: {
      decisions: {
        type: "array",
        description: "Decisions from log",
        items: {
          type: "object",
          properties: {
            decision_id: { type: "string" },
            recorded_by: { type: "string" },
            recorded_at: { type: "string" },
            rationale: { type: "string" },
            status: { type: "string", enum: ["active", "superseded", "archived"] },
            immutable: { type: "boolean", description: "Always true for decisions" },
          },
        },
      },
      memories: {
        type: "array",
        description: "Associated memories",
        items: { type: "object" },
      },
    },
  },
};

/**
 * Tool 3: radar.get_context
 * 
 * Purpose: Load workspace context and configuration.
 * Permission: Viewer+
 * Audit: Yes
 * Read-Only: Yes
 */
const TOOL_RADAR_GET_CONTEXT: MCPToolDefinition = {
  name: "radar.get_context",
  description: "Load workspace context and configuration",
  required_role: "viewer",
  is_write_operation: false,
  input_schema: {
    type: "object",
    required: ["workspace_id"],
    properties: {
      workspace_id: {
        type: "string",
        description: "Workspace ID",
      },
    },
  },
  output_schema: {
    type: "object",
    properties: {
      workspace_id: { type: "string" },
      name: { type: "string" },
      created_at: { type: "string" },
      config: {
        type: "object",
        description: "Workspace configuration",
        properties: {
          default_role: { type: "string" },
          features: { type: "object" },
        },
      },
      entities: {
        type: "array",
        description: "Entities in workspace",
        items: { type: "object" },
      },
    },
  },
};

/**
 * Tool 4: radar.get_project
 * 
 * Purpose: Get project metadata and associated entities.
 * Permission: Viewer+
 * Audit: Yes
 * Read-Only: Yes
 */
const TOOL_RADAR_GET_PROJECT: MCPToolDefinition = {
  name: "radar.get_project",
  description: "Get project metadata and associated entities",
  required_role: "viewer",
  is_write_operation: false,
  input_schema: {
    type: "object",
    required: ["workspace_id", "project_id"],
    properties: {
      workspace_id: {
        type: "string",
        description: "Workspace ID",
      },
      project_id: {
        type: "string",
        description: "Project ID",
      },
    },
  },
  output_schema: {
    type: "object",
    properties: {
      project_id: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      created_at: { type: "string" },
      updated_at: { type: "string" },
      entities: {
        type: "array",
        description: "Associated entities",
        items: { type: "object" },
      },
    },
  },
};

/**
 * Tool 5: radar.get_entity
 * 
 * Purpose: Get entity details, relationships, and context.
 * Permission: Viewer+
 * Audit: Yes
 * Read-Only: Yes
 */
const TOOL_RADAR_GET_ENTITY: MCPToolDefinition = {
  name: "radar.get_entity",
  description: "Get entity details, relationships, and context",
  required_role: "viewer",
  is_write_operation: false,
  input_schema: {
    type: "object",
    required: ["workspace_id", "entity_id"],
    properties: {
      workspace_id: {
        type: "string",
        description: "Workspace ID",
      },
      entity_id: {
        type: "string",
        description: "Entity ID",
      },
    },
  },
  output_schema: {
    type: "object",
    properties: {
      entity_id: { type: "string" },
      type: { type: "string" },
      name: { type: "string" },
      created_at: { type: "string" },
      data: { type: "object" },
      relationships: {
        type: "array",
        description: "Related entities",
        items: { type: "object" },
      },
    },
  },
};

/**
 * Tool 6: radar.remember
 * 
 * Purpose: Record data to workspace memory.
 * Permission: Contributor+
 * Audit: Yes
 * Read-Only: No
 * Immutability: Memories are immutable after creation
 * 
 * Write operation - requires CONTRIBUTOR role or higher
 */
const TOOL_RADAR_REMEMBER: MCPToolDefinition = {
  name: "radar.remember",
  description: "Record data to workspace memory",
  required_role: "contributor",
  is_write_operation: true,
  input_schema: {
    type: "object",
    required: ["workspace_id", "content"],
    properties: {
      workspace_id: {
        type: "string",
        description: "Workspace ID",
      },
      content: {
        type: "string",
        description: "Memory content to store",
      },
      tags: {
        type: "array",
        description: "Optional: tags for categorization",
        items: { type: "string" },
      },
      metadata: {
        type: "object",
        description: "Optional: additional metadata",
      },
    },
  },
  output_schema: {
    type: "object",
    properties: {
      memory_id: {
        type: "string",
        description: "Unique ID of recorded memory",
      },
      recorded_by: {
        type: "string",
        description: "Caller ID who recorded",
      },
      recorded_at: {
        type: "string",
        description: "Timestamp of recording",
      },
      immutable: {
        type: "boolean",
        description: "Always true - memories are immutable after creation",
      },
    },
  },
};

/**
 * Tool 7: radar.record_decision
 * 
 * Purpose: Log decision with rationale and metadata.
 * Permission: Editor+
 * Audit: Yes (critical operation)
 * Read-Only: No
 * Immutability: Decisions are immutable after creation
 * 
 * Write operation - requires EDITOR role or higher
 * This is the highest-permission write operation in the foundation
 */
const TOOL_RADAR_RECORD_DECISION: MCPToolDefinition = {
  name: "radar.record_decision",
  description: "Log decision with rationale and metadata",
  required_role: "editor",
  is_write_operation: true,
  input_schema: {
    type: "object",
    required: ["workspace_id", "decision", "rationale"],
    properties: {
      workspace_id: {
        type: "string",
        description: "Workspace ID",
      },
      decision: {
        type: "string",
        description: "The decision being recorded",
      },
      rationale: {
        type: "string",
        description: "Reasoning behind the decision",
      },
      context: {
        type: "string",
        description: "Optional: decision context and background",
      },
      affected_entities: {
        type: "array",
        description: "Optional: entities affected by decision",
        items: { type: "string" },
      },
    },
  },
  output_schema: {
    type: "object",
    properties: {
      decision_id: {
        type: "string",
        description: "Unique ID of recorded decision",
      },
      recorded_by: {
        type: "string",
        description: "Caller ID who recorded",
      },
      recorded_at: {
        type: "string",
        description: "Timestamp of recording",
      },
      status: {
        type: "string",
        enum: ["active", "superseded", "archived"],
        description: "Decision status",
      },
      immutable: {
        type: "boolean",
        description: "Always true - decisions are immutable after creation",
      },
    },
  },
};

// ============================================================================
// TOOL REGISTRY
// ============================================================================

/**
 * Complete registry of all MCP tools.
 * Maps tool name to tool definition.
 */
const TOOL_REGISTRY: Record<string, MCPToolDefinition> = {
  "radar.search": TOOL_RADAR_SEARCH,
  "radar.recall": TOOL_RADAR_RECALL,
  "radar.get_context": TOOL_RADAR_GET_CONTEXT,
  "radar.get_project": TOOL_RADAR_GET_PROJECT,
  "radar.get_entity": TOOL_RADAR_GET_ENTITY,
  "radar.remember": TOOL_RADAR_REMEMBER,
  "radar.record_decision": TOOL_RADAR_RECORD_DECISION,
};

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validates tool definition structure and completeness.
 */
function validateToolDefinition(tool: MCPToolDefinition): ValidationResult {
  const errors: string[] = [];

  if (!tool.name) errors.push("Tool must have a name");
  if (!tool.description) errors.push("Tool must have a description");
  if (!tool.required_role) errors.push("Tool must specify required_role");
  if (tool.is_write_operation === undefined) errors.push("Tool must specify is_write_operation");
  if (!tool.input_schema) errors.push("Tool must have input_schema");
  if (!tool.output_schema) errors.push("Tool must have output_schema");

  const valid_roles = ["viewer", "contributor", "editor", "admin"];
  if (!valid_roles.includes(tool.required_role)) {
    errors.push(`Invalid required_role: ${tool.required_role}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates that all tools in registry are valid.
 */
function validateRegistry(): ValidationResult {
  const errors: string[] = [];
  const read_only_count = 0;
  const write_count = 0;

  for (const [name, tool] of Object.entries(TOOL_REGISTRY)) {
    const result = validateToolDefinition(tool);
    if (!result.valid) {
      errors.push(`Tool ${name}: ${result.errors.join("; ")}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates request parameters against tool schema.
 */
function validateRequestParams(
  tool_name: string,
  params: Record<string, any>
): ValidationResult {
  const errors: string[] = [];
  const tool = TOOL_REGISTRY[tool_name];

  if (!tool) {
    errors.push(`Unknown tool: ${tool_name}`);
    return { valid: false, errors };
  }

  const schema = tool.input_schema;
  if (!schema.required) {
    return { valid: true, errors: [] };
  }

  for (const field of schema.required) {
    if (!(field in params)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// ROLE-BASED ACCESS CONTROL LOOKUP
// ============================================================================

/**
 * Determines if a given role can execute a given tool.
 * Uses role hierarchy: viewer < contributor < editor < admin
 */
function canRoleExecuteTool(role: string, tool_name: string): boolean {
  const tool = TOOL_REGISTRY[tool_name];
  if (!tool) return false;

  const role_hierarchy: Record<string, number> = {
    viewer: 1,
    contributor: 2,
    editor: 3,
    admin: 100,
  };

  const role_level = role_hierarchy[role] || 0;
  const required_level = role_hierarchy[tool.required_role] || 0;

  return role_level >= required_level;
}

// ============================================================================
// EXPORTS FOR TESTING AND INTEGRATION
// ============================================================================

export {
  TOOL_REGISTRY,
  TOOL_RADAR_SEARCH,
  TOOL_RADAR_RECALL,
  TOOL_RADAR_GET_CONTEXT,
  TOOL_RADAR_GET_PROJECT,
  TOOL_RADAR_GET_ENTITY,
  TOOL_RADAR_REMEMBER,
  TOOL_RADAR_RECORD_DECISION,
  validateToolDefinition,
  validateRegistry,
  validateRequestParams,
  canRoleExecuteTool,
  MCPToolDefinition,
  ValidationResult,
};