// Development authentication provider (development-only)
// Exports DevelopmentAuthenticationProvider class

class DevelopmentAuthenticationProvider {
  constructor(options = {}) {
    // options.membershipMap: { caller_id: workspace_id }
    this.options = options;
  }

  // request: { context?: { caller_id, workspace_id, request_id, timestamp }, ... }
  authenticate(request) {
    const caller_id = request.context?.caller_id;
    const workspace_id = request.context?.workspace_id;
    if (!caller_id || !workspace_id) return null;

    // Simple development role assignment based on caller_id prefix
    const roles = this._rolesForCaller(caller_id);

    return {
      caller_id,
      roles,
      workspace_id,
      request_id: request.context?.request_id || `req_${Date.now()}`,
      timestamp: request.context?.timestamp || new Date().toISOString(),
    };
  }

  _rolesForCaller(caller_id) {
    if (caller_id === "admin_123") return ["admin", "editor", "contributor", "viewer"];
    if (caller_id === "editor_456") return ["editor", "contributor", "viewer"];
    if (caller_id === "contributor_789") return ["contributor", "viewer"];
    return ["viewer"];
  }
}

export { DevelopmentAuthenticationProvider };
