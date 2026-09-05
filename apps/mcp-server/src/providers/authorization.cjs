/**
 * RADARMatrix Authorization Provider
 * Version: 0.9
 *
 * RBAC authorization boundary.
 *
 * SECURITY PRINCIPLES:
 * - Authentication establishes identity.
 * - Membership establishes workspace access.
 * - Authorization establishes whether that identity may invoke
 *   the requested tool.
 * - Never authorize an unknown role.
 * - Never authorize a missing principal.
 * - Never allow a caller to elevate their own role.
 * - Never use workspace_id as evidence of authorization.
 */

class DefaultAuthorizationProvider {
  constructor() {
    this.roleHierarchy = Object.freeze({
      viewer: 1,
      contributor: 2,
      editor: 3,
      admin: 4,
    });

    this.allowedRoles = new Set(
      Object.keys(this.roleHierarchy),
    );
  }

  /**
   * Determine whether an authenticated principal may invoke
   * the requested tool.
   *
   * toolRegistry may be:
   *   {
   *     "radar.search": {
   *       required_role: "viewer"
   *     }
   *   }
   */
  isAuthorized(
    principal,
    toolRegistry,
    toolName,
  ) {
    if (
      !principal ||
      typeof principal !== "object"
    ) {
      return false;
    }

    if (
      typeof principal.caller_id !==
        "string" ||
      principal.caller_id.trim() === ""
    ) {
      return false;
    }

    if (
      typeof principal.workspace_id !==
        "string" ||
      principal.workspace_id.trim() === ""
    ) {
      return false;
    }

    if (
      !Array.isArray(principal.caller_roles) &&
      !Array.isArray(principal.roles)
    ) {
      return false;
    }

    if (
      !toolRegistry ||
      typeof toolRegistry !== "object"
    ) {
      return false;
    }

    if (
      typeof toolName !== "string" ||
      toolName.trim() === ""
    ) {
      return false;
    }

    const tool = toolRegistry[toolName];

    if (
      !tool ||
      typeof tool !== "object"
    ) {
      return false;
    }

    const requiredRole =
      tool.required_role;

    if (
      typeof requiredRole !== "string" ||
      !this.allowedRoles.has(requiredRole)
    ) {
      return false;
    }

    const roles =
      Array.isArray(principal.caller_roles)
        ? principal.caller_roles
        : principal.roles;

    const highestRole =
      this.getHighestRole(roles);

    if (!highestRole) {
      return false;
    }

    return (
      this.roleHierarchy[highestRole] >=
      this.roleHierarchy[requiredRole]
    );
  }

  /**
   * Return the highest valid role possessed by the principal.
   *
   * Unknown roles are ignored rather than granting access.
   */
  getHighestRole(roles) {
    if (!Array.isArray(roles)) {
      return null;
    }

    let highestRole = null;
    let highestLevel = 0;

    for (const role of roles) {
      if (
        typeof role !== "string" ||
        !this.allowedRoles.has(role)
      ) {
        continue;
      }

      const level =
        this.roleHierarchy[role];

      if (level > highestLevel) {
        highestLevel = level;
        highestRole = role;
      }
    }

    return highestRole;
  }

  /**
   * Return the numeric level for a valid role.
   */
  getRoleLevel(role) {
    if (
      typeof role !== "string" ||
      !this.allowedRoles.has(role)
    ) {
      return 0;
    }

    return this.roleHierarchy[role];
  }

  /**
   * Safe diagnostic representation.
   */
  snapshot() {
    return {
      roles: {
        ...this.roleHierarchy,
      },
    };
  }
}

module.exports = {
  DefaultAuthorizationProvider,
};