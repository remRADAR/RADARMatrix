"use strict";
/**
 * RADARMatrix FileMembershipProvider (M2, Phase P3; hardened M2.2, corrected M2.2.1)
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
 * - M2.2: persistence is ATOMIC-ON-DISK — the JSON is written to a
 *   process-unique temporary file and moved into place with
 *   fs.renameSync (atomic on POSIX). A crash mid-write can no longer
 *   truncate the live membership file.
 * - M2.2.1 SECURITY CORRECTION E (persistence hardening):
 *   * EXCLUSIVE temporary-file creation: the temp file is opened with
 *     the "wx" flag (fail if the path already exists) — an attacker
 *     can no longer pre-create or symlink-hijack a PREDICTABLE
 *     temporary name, because the name is unpredictable (random
 *     64-bit suffix) AND its creation refuses to clobber anything.
 *   * RESTRICTIVE PERMISSIONS: the temp file is created with mode
 *     0o600 (owner read/write only) and the atomic rename carries
 *     that mode to the live membership file — on POSIX the live file
 *     is never group/world-readable. (The mode argument is a no-op
 *     on Windows; the CI runtime is POSIX.)
 *   * SAME DIRECTORY: the temp file is created next to the target
 *     (same directory => same filesystem => rename is atomic).
 *   * SAFE CLEANUP: on ANY write/rename failure the temp file is
 *     closed and removed, and the error PROPAGATES (loud, never
 *     swallowed); a failed write never leaves temp residue and
 *     never replaces the previous valid membership file.
 *   * SYMLINK SAFETY: the exclusive "wx" open follows no pre-placed
 *     link (creation fails on an existing path, including a
 *     symlink); rename replaces the target path atomically without
 *     following a pre-existing symlink at the target in a way that
 *     would write through it (rename replaces directory entries; it
 *     does not open/write through the old target).
 *   * fsync: the temp file is flushed to disk before the rename so
 *     the renamed file never contains unflushed data.
 *   - A crash BEFORE the rename still loses that single mutation —
 *     the in-memory map stays authoritative for this process.
 *
 * OPERATIONAL BOUNDARY (M2.1 documentation — semantics unchanged in
 * M2.2/M2.2.1): This is an INTERIM, SINGLE-INSTANCE, FILE-BACKED
 * implementation. It is NOT a transactional distributed membership
 * store:
 * - File writes are atomic single-file replacements, but they are
 *   NOT database transactions. There is no locking, no merge, and
 *   no versioning.
 * - Concurrent writers (multiple provider instances, multiple
 *   processes) race: last-writer-wins clobbers the other's
 *   grant/revoke. Atomic rename prevents TORN writes; it does not
 *   prevent LOST writes. DO NOT claim atomic rename solves
 *   concurrent multi-instance lost updates.
 * - Multi-process or horizontally scaled production deployments
 *   REQUIRE a stronger storage adapter (the StorageAdapter seam;
 *   planned durable store, D1 at M7 per the owner roadmap). This
 *   provider must not be used as-if it were such a store.
 * - Membership revocation IS effective for subsequent authorization
 *   decisions: revoke() updates the in-memory map immediately (the
 *   very next isMember/getRole call reflects it) and persists to the
 *   file for future instances.
 * - Corrupt or missing membership data fails CLOSED (empty registry)
 *   — availability is sacrificed before security, by design. There
 *   is NO silent recovery with development fixtures.
 * This provider is NOT production-grade distributed persistence.
 * Introducing a real database is explicitly out of scope for M2.
 *
 * This is the development/staging seed of the durable membership
 * store (the StorageAdapter seam). The production adapter (M7 plan)
 * must preserve these exact semantics.
 *
 * CommonJS provider implementation (source of truth) per the
 * repository module-format law; the .js sibling is the ESM
 * re-export wrapper.
 */

const fs = require("fs");
const crypto = require("crypto");

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
    /**
     * Test-only seam for verifying EXCLUSIVE temporary-file
     * creation: when provided, the temporary name is exactly
     * path + ".tmp-" + tmpNameFn() so a test can pre-create the
     * predicted name and prove the "wx" open refuses to clobber it.
     * Production code never passes this option.
     */
    this._tmpNameFn =
      options && typeof options._tmpNameFn === "function"
        ? options._tmpNameFn
        : null;

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

  /**
   * M2.2/M2.2.1: atomic-on-disk persistence.
   *
   * The serialized registry is written to an unpredictable
   * temporary file in the SAME directory (same filesystem => rename
   * is atomic), opened EXCLUSIVELY ("wx" — refuses to clobber a
   * pre-existing path, defeating predictable-name hijack and
   * symlink attacks) with RESTRICTIVE permissions (0o600), flushed
   * (fsync), closed, and only then moved into place with
   * fs.renameSync. Effects:
   * - A crash mid-write leaves the live file untouched.
   * - Readers can never observe a torn/partial JSON file from this
   *   writer. (A corrupt file from an external source still loads
   *   as an empty, fail-closed registry.)
   * - The live file ends with mode 0o600 on POSIX.
   * - On any open/write/fsync/close/rename error the temporary file
   *   is removed (best-effort) and the error propagates loudly —
   *   persistence failures are never silently swallowed, and the
   *   previous valid membership file survives intact.
   */
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
    const payload = JSON.stringify(data, null, 2);
    const suffix = this._tmpNameFn
      ? this._tmpNameFn()
      : process.pid + "-" + crypto.randomBytes(8).toString("hex");
    const tmpPath = this.path + ".tmp-" + suffix;
    let fd = null;
    try {
      // EXCLUSIVE creation + restrictive permissions. "wx" fails
      // with EEXIST if anything (file OR symlink) already sits at
      // tmpPath — a hijacked/predictable temp name can never be
      // silently overwritten or written through.
      fd = fs.openSync(tmpPath, "wx", 0o600);
      fs.writeSync(fd, payload, "utf8");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;
      // Atomic replacement (POSIX rename). The previous valid file
      // survives until this instant.
      fs.renameSync(tmpPath, this.path);
    } catch (error) {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch (closeError) {
          /* best-effort — the primary error is rethrown below */
        }
      }
      try {
        fs.unlinkSync(tmpPath);
      } catch (cleanupError) {
        /* best-effort cleanup — the primary error is rethrown below */
      }
      throw error;
    }
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
