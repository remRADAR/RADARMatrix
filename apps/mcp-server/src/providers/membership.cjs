/**
 * RADARMatrix Development Membership Provider
 * Version: 0.9
 *
 * Development-only workspace membership implementation.
 *
 * SECURITY PRINCIPLE:
 * Membership must fail closed.
 *
 * A caller is a member of a workspace ONLY when the
 * configured membership map explicitly contains that
 * caller and workspace.
 *
 * This provider must be replaced by a durable production
 * membership repository before production deployment.
 */

class DevelopmentMembershipProvider {
  constructor(options = {}) {
    this.members = normalizeMembers(options.members);
  }

  /**
   * Determine whether a caller explicitly belongs
   * to the requested workspace.
   *
   * SECURITY:
   * - Missing caller => false
   * - Missing workspace => false
   * - Unknown caller => false
   * - Unknown workspace => false
   * - No wildcard/fallback access
   */
  isMember(callerId, workspaceId) {
    if (
      typeof callerId !== "string" ||
      callerId.trim() === ""
    ) {
      return false;
    }

    if (
      typeof workspaceId !== "string" ||
      workspaceId.trim() === ""
    ) {
      return false;
    }

    const workspaces =
      this.members.get(callerId);

    if (!workspaces) {
      return false;
    }

    return workspaces.has(workspaceId);
  }

  /**
   * Return the explicitly configured workspaces
   * for a caller.
   *
   * This is useful for diagnostics and tests.
   *
   * The returned array is a copy so callers cannot
   * mutate provider state.
   */
  getWorkspaces(callerId) {
    const workspaces =
      this.members.get(callerId);

    if (!workspaces) {
      return [];
    }

    return Array.from(workspaces);
  }

  /**
   * Return whether the provider contains a caller.
   */
  hasCaller(callerId) {
    return this.members.has(callerId);
  }

  /**
   * Return a safe diagnostic snapshot.
   *
   * This intentionally exposes membership identifiers
   * only. No credentials or authentication material
   * should ever be stored here.
   */
  snapshot() {
    const result = {};

    for (
      const [callerId, workspaces]
      of this.members.entries()
    ) {
      result[callerId] =
        Array.from(workspaces);
    }

    return result;
  }
}

/**
 * Normalize the development membership configuration.
 *
 * Supported input:
 *
 * {
 *   admin_123: ["w_dev"],
 *   editor_456: ["w_dev"],
 * }
 *
 * Invalid entries are ignored rather than creating
 * implicit access.
 */
function normalizeMembers(input) {
  const members = new Map();

  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    return members;
  }

  for (
    const [callerId, workspaceIds]
    of Object.entries(input)
  ) {
    if (
      typeof callerId !== "string" ||
      callerId.trim() === ""
    ) {
      continue;
    }

    if (!Array.isArray(workspaceIds)) {
      continue;
    }

    const validWorkspaceIds =
      new Set(
        workspaceIds.filter(
          (workspaceId) =>
            typeof workspaceId ===
              "string" &&
            workspaceId.trim() !== "",
        ),
      );

    if (validWorkspaceIds.size > 0) {
      members.set(
        callerId,
        validWorkspaceIds,
      );
    }
  }

  return members;
}

module.exports = {
  DevelopmentMembershipProvider,
  normalizeMembers,
};