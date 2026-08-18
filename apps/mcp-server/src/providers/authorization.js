// Default authorization provider implementing RBAC
class DefaultAuthorizationProvider {
  constructor() {
    this.role_hierarchy = {
      viewer: 1,
      contributor: 2,
      editor: 3,
      admin: 100,
    };
  }

  // principal: { caller_id, roles: string[], workspace_id }
  // toolRegistry: map of tool definitions with required_role
  isAuthorized(principal, toolRegistry, toolName) {
    if (!principal || !toolRegistry) return false;
    const tool = toolRegistry[toolName || (principal && principal.tool)];
    if (!tool) return false;

    const required_role = tool.required_role;
    const caller_max_role = Math.max(...(principal.roles || []).map(r => this.role_hierarchy[r] || 0));
    const required_level = this.role_hierarchy[required_role] || 0;
    return caller_max_role >= required_level;
  }
}

export { DefaultAuthorizationProvider };
