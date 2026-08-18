/**
 * RADARMatrix Development Authentication Provider
 * Version: 0.9
 *
 * DEVELOPMENT ONLY.
 *
 * This provider does NOT implement OAuth/OIDC.
 * It provides deterministic development principals so that
 * the gateway security model can be tested without credentials.
 *
 * Production MUST replace this provider with a verified
 * OAuth 2.0 / OIDC authentication implementation.
 *
 * SECURITY PRINCIPLES:
 * - Never trust a caller identity supplied without validation.
 * - Never infer authorization from arbitrary user input.
 * - Never accept missing caller/workspace context.
 * - Keep authentication and authorization separate.
 */

class DevelopmentAuthenticationProvider {
  constructor(options = {}) {
    this.principals = normalizePrincipals(
      options.principals ||
        defaultDevelopmentPrincipals(),
    );
  }

  /**
   * Authenticate a development request.
   *
   * The development transport uses an explicitly configured
   * caller_id as its test identity.
   *
   * The caller must exist in the configured principal registry.
   *
   * Workspace membership is deliberately NOT decided here.
   * That responsibility belongs to the membership provider.
   */
  authenticate(request) {
    if (
      !request ||
      typeof request !== "object"
    ) {
      return null;
    }

    const context = request.context;

    if (
      !context ||
      typeof context !== "object"
    ) {
      return null;
    }

    const callerId = context.caller_id;
    const workspaceId = context.workspace_id;

    if (
      typeof callerId !== "string" ||
      callerId.trim() === ""
    ) {
      return null;
    }

    if (
      typeof workspaceId !== "string" ||
      workspaceId.trim() === ""
    ) {
      return null;
    }

    const principal =
      this.principals.get(callerId);

    if (!principal) {
      return null;
    }

    return {
      caller_id: principal.caller_id,
      roles: [...principal.roles],
      workspace_id: workspaceId,
      request_id:
        typeof context.request_id ===
          "string" &&
        context.request_id.trim() !== ""
          ? context.request_id
          : generateRequestId(),
      timestamp:
        typeof context.timestamp ===
          "string" &&
        context.timestamp.trim() !== ""
          ? context.timestamp
          : new Date().toISOString(),
    };
  }

  /**
   * Return whether a development principal exists.
   *
   * Useful for tests and diagnostics.
   */
  hasPrincipal(callerId) {
    if (
      typeof callerId !== "string" ||
      callerId.trim() === ""
    ) {
      return false;
    }

    return this.principals.has(callerId);
  }

  /**
   * Return a safe principal description.
   *
   * No credentials or secrets are exposed.
   */
  getPrincipal(callerId) {
    const principal =
      this.principals.get(callerId);

    if (!principal) {
      return null;
    }

    return {
      caller_id: principal.caller_id,
      roles: [...principal.roles],
    };
  }

  /**
   * Return a safe development snapshot.
   */
  snapshot() {
    const result = {};

    for (
      const [callerId, principal]
      of this.principals.entries()
    ) {
      result[callerId] = {
        caller_id: principal.caller_id,
        roles: [...principal.roles],
      };
    }

    return result;
  }
}

/**
 * Default development identities.
 *
 * These identities are TEST FIXTURES ONLY.
 *
 * They must never be treated as production accounts.
 */
function defaultDevelopmentPrincipals() {
  return {
    admin_123: {
      caller_id: "admin_123",
      roles: [
        "admin",
        "editor",
        "contributor",
        "viewer",
      ],
    },

    editor_456: {
      caller_id: "editor_456",
      roles: [
        "editor",
        "contributor",
        "viewer",
      ],
    },

    contributor_789: {
      caller_id: "contributor_789",
      roles: [
        "contributor",
        "viewer",
      ],
    },

    viewer_000: {
      caller_id: "viewer_000",
      roles: ["viewer"],
    },
  };
}

/**
 * Normalize principal configuration.
 *
 * Invalid entries are ignored rather than creating
 * implicit identities.
 */
function normalizePrincipals(input) {
  const principals = new Map();

  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    return principals;
  }

  for (
    const [callerId, value]
    of Object.entries(input)
  ) {
    if (
      typeof callerId !== "string" ||
      callerId.trim() === ""
    ) {
      continue;
    }

    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      continue;
    }

    if (
      typeof value.caller_id !==
        "string" ||
      value.caller_id.trim() === ""
    ) {
      continue;
    }

    if (!Array.isArray(value.roles)) {
      continue;
    }

    const roles = [
      ...new Set(
        value.roles.filter(
          (role) =>
            typeof role ===
              "string" &&
            role.trim() !== "",
        ),
      ),
    ];

    if (roles.length === 0) {
      continue;
    }

    principals.set(callerId, {
      caller_id: value.caller_id,
      roles,
    });
  }

  return principals;
}

function generateRequestId() {
  return (
    `req_${Date.now()}_` +
    Math.random()
      .toString(36)
      .slice(2, 11)
  );
}

module.exports = {
  DevelopmentAuthenticationProvider,
  normalizePrincipals,
  defaultDevelopmentPrincipals,
};