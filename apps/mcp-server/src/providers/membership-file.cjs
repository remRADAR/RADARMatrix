"use strict";
/**
 * RADARMatrix FileMembershipProvider (M2, Phase P3)
 *
 * Durable (file-backed) membership record implementing the
 * fail-closed MembershipProvider law plus M2 authority semantics:
 *
 * - Explicit map only: { [caller]: [{ workspace, role }] }.
 * - No wildcard, no fallback, no automatic membership.
 * - Unknown roles fail closed AND fail at grant time (throws).
 * - Missing or corrupt file = empty registry (fail closed).
 * - Roles live ONLY here — never in token claims.
 * - grant()/revoke() persist to the backing file when a path is set.
 *
 * This is the development/staging seed of the durable membership
 * store (the StorageAdapter seam). The production D1 adapter (M7
 * plan) must preserve these exact semantics.
 *
 * CommonJS provider implementation (source of truth) per the
 * repository module-format law; the .js sibling is the ESM
 * re-export wrapper.
 */

const fs = require("fs");

const KNOWN_ROLES = {
  viewer: 1,
  contributor: 2,
  editor: 3,
  admin: 4,
};

class FileMembershipProvider {
  constructor(options) {
    this.path =
      options && typeof options.path === "string" ? options.path : null;
    this.members = new Map();

    if (options && options.members && typeof options.members === "object") {
      this.#loadData(options.members);
    } else if (this.path) {
      try {
        const raw = fs.readFileSync(this.path, "utf8");
        this.#loadData(JSON.parse(raw));
      } catch (error) {
        /**
         * Missing or corrupt membership file = EMPTY registry.
         * Fail closed: nobody is a member of anything.
         */
        this.members = new Map();
      }
    }
  }

  #loadData(data) {
    for (const [caller, entries] of Object.entries(data)) {
      if (!Array.isArray(entries)) {
        continue;
      }
      const workspaceMap = new Map();
      for (const entry of entries) {
        if (
          entry &&
          typeof entry.workspace === "string" &&
          typeof entry.role === "string" &&
          Object.prototype.hasOwnProperty.call(KNOWN_ROLES, entry.role)
        ) {
          workspaceMap.set(entry.workspace, entry.role);
        }
      }
      if (workspaceMap.size > 0) {
        this.members.set(caller, workspaceMap);
      }
    }
  }

  #persist() {
    if (!this.path) {
      return;
    }
    const data = {};
    for (const [caller, workspaceMap] of this.members) {
      data[caller] = Array.from(workspaceMap.entries()).map(
        ([workspace, role]) => ({ workspace, role }),
      );
    }
    fs.writeFileSync(this.path, JSON.stringify(data, null, 2));
  }

  isMember(callerId, workspaceId) {
    const workspaceMap = this.members.get(callerId);
    return Boolean(workspaceMap && workspaceMap.has(workspaceId));
  }

  getRole(callerId, workspaceId) {
    const workspaceMap = this.members.get(callerId);
    if (!workspaceMap) {
      return null;
    }
    const role = workspaceMap.get(workspaceId);
    return typeof role === "string" ? role : null;
  }

  getWorkspaces(callerId) {
    const workspaceMap = this.members.get(callerId);
    return workspaceMap ? Array.from(workspaceMap.keys()) : [];
  }

  hasCaller(callerId) {
    return this.members.has(callerId);
  }

  snapshot() {
    const snap = {};
    for (const [caller, workspaceMap] of this.members) {
      snap[caller] = Array.from(workspaceMap.keys());
    }
    return snap;
  }

  grant(callerId, workspaceId, role) {
    if (!callerId || typeof callerId !== "string") {
      throw new Error("grant requires a caller id");
    }
    if (!workspaceId || typeof workspaceId !== "string") {
      throw new Error("grant requires a workspace id");
    }
    if (!Object.prototype.hasOwnProperty.call(KNOWN_ROLES, role)) {
      /** Unknown roles are rejected at WRITE time — never silently stored. */
      throw new Error("grant rejected — unknown role: " + String(role));
    }
    if (!this.members.has(callerId)) {
      this.members.set(callerId, new Map());
    }
    this.members.get(callerId).set(workspaceId, role);
    this.#persist();
  }

  revoke(callerId, workspaceId) {
    const workspaceMap = this.members.get(callerId);
    if (!workspaceMap) {
      return;
    }
    workspaceMap.delete(workspaceId);
    if (workspaceMap.size === 0) {
      this.members.delete(callerId);
    }
    this.#persist();
  }
}

module.exports = { FileMembershipProvider, KNOWN_ROLES };
