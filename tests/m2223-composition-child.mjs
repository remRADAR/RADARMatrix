/**
 * RADARMatrix M2.2.3 composition child process (TEST ONLY).
 *
 * The shared test process binds the server authority ONCE at import
 * time (through ./server-authority.helper.mjs), so the M2.2.3 suite
 * cannot exercise FIRST-initialization behavior in that process.
 * This script is spawned in a FRESH Node process per scenario so the
 * tests can prove, from a clean process state:
 *
 *   - request-surface: a fresh process that imports ONLY the
 *     general-purpose auth module (delegation.ts) — the module
 *     request-handling code and the runtime adapters import — has NO
 *     initialization capability on its surface, cannot smuggle a
 *     provider through the mint call, and fails closed while the
 *     authority is unbound.
 *   - trusted-composition: a fresh process where the TRUSTED
 *     COMPOSITION ROOT (server-composition.ts) — the module only
 *     gateway startup may call — establishes the authority, and the
 *     bound registry snapshot ignores post-binding mutation of the
 *     ORIGINAL registry object.
 *
 * Usage: node tests/m2223-composition-child.mjs <scenario>
 * Emits exactly one "RESULT:" line with a JSON object; exit 0.
 */

const scenario = process.argv[2];

if (scenario === "request-surface") {
  const delegation = await import("../apps/mcp-server/src/auth/delegation.ts");
  const result = {
    scenario,
    // The general-purpose auth module must NOT export any
    // initialization capability:
    initExportType: typeof delegation.initializeServerAuthority,
    composeExportType: typeof delegation.composeServerAuthority,
    // ...and its read-only predicate reports the unbound state:
    initialized: delegation.isServerAuthorityInitialized(),
    // A fabricated provider smuggled as a second argument is
    // rejected (fail-closed):
    fabricatedProviderMintNull:
      delegation.createTrustedActorContext(
        { caller_id: "user_editor", workspace_id: "w_prod" },
        { isMember: () => true, getRole: () => "admin" },
      ) === null,
    // Every mint fails closed while unbound:
    unboundMintNull:
      delegation.createTrustedActorContext({ caller_id: "user_editor", workspace_id: "w_prod" }) === null,
  };
  // And a grant cannot be created from a fabricated context while
  // unbound:
  const integrity = delegation.createGrantIntegrityService(
    "m2223-child-integrity-secret-0123456789abcdef",
  );
  result.unboundGrantNull =
    integrity !== null &&
    delegation.createDelegatedGrant(
      {
        grant_id: "grant_child",
        agent_id: "agent_x",
        allowed_tools: ["radar.search"],
        allowed_actions: ["read"],
        ttl_seconds: 600,
        actor: { actor_id: "user_editor", actor_roles: ["editor"], workspace_id: "w_prod" },
      },
      1_000_000,
      integrity,
    ) === null;
  console.log("RESULT:" + JSON.stringify(result));
  process.exit(0);
}

if (scenario === "trusted-composition") {
  const { composeServerAuthority, isServerAuthorityComposed } = await import(
    "../apps/mcp-server/src/auth/server-composition.ts"
  );
  const delegation = await import("../apps/mcp-server/src/auth/delegation.ts");

  // Server-side fixtures (the composition root receives LIVE
  // server-side objects — never request data):
  const membershipData = {
    alice: { role: "editor" },
    bob: { role: "viewer" },
  };
  const provider = {
    isMember(caller, ws) {
      return (
        ws === "w_prod" &&
        Object.prototype.hasOwnProperty.call(membershipData, caller)
      );
    },
    getRole(caller, ws) {
      if (ws !== "w_prod") return null;
      const rec = membershipData[caller];
      return rec ? rec.role : null;
    },
  };
  const registry = {
    "radar.search": { required_role: "viewer", is_write_operation: false },
    "radar.record_decision": { required_role: "editor", is_write_operation: true },
  };

  const composed = composeServerAuthority({ membershipProvider: provider, toolRegistry: registry });
  const secondCompose = composeServerAuthority({
    membershipProvider: { isMember: () => true, getRole: () => "admin" },
    toolRegistry: registry,
  });

  const integrity = delegation.createGrantIntegrityService(
    "m2223-child-integrity-secret-0123456789abcdef",
  );

  function grantFor(actorCtx, tool, actions) {
    return delegation.createDelegatedGrant(
      {
        grant_id: "grant_child_" + tool,
        agent_id: "agent_x",
        allowed_tools: [tool],
        allowed_actions: actions,
        ttl_seconds: 600,
        actor: actorCtx,
      },
      1_000_000,
      integrity,
    );
  }

  const alice = delegation.createTrustedActorContext({ caller_id: "alice", workspace_id: "w_prod" });
  const aliceEditorGrant =
    alice === null ? null : grantFor(alice, "radar.record_decision", ["write"]);

  // Post-binding mutation of the ORIGINAL registry object must have
  // NO effect on the bound snapshot:
  registry["radar.record_decision"].required_role = "viewer";
  const bob = delegation.createTrustedActorContext({ caller_id: "bob", workspace_id: "w_prod" });
  const bobViewerGrantAfterRegistryMutation =
    bob === null ? null : grantFor(bob, "radar.record_decision", ["write"]);

  // Post-binding replacement of the ORIGINAL provider's methods must
  // have NO effect on the protected adapter:
  provider.isMember = () => true;
  provider.getRole = () => "admin";
  const stranger = delegation.createTrustedActorContext({ caller_id: "stranger", workspace_id: "w_prod" });

  const result = {
    scenario,
    composed,
    secondComposeRejected: secondCompose === false,
    isComposed: isServerAuthorityComposed(),
    aliceMinted: alice !== null,
    aliceEditorGrantMinted: aliceEditorGrant !== null,
    bobMinted: bob !== null,
    bobStillDeniedAfterRegistryMutation: bobViewerGrantAfterRegistryMutation === null,
    strangerStillNullAfterProviderMutation: stranger === null,
  };
  console.log("RESULT:" + JSON.stringify(result));
  process.exit(0);
}

console.error("m2223-composition-child: unknown scenario " + scenario);
process.exit(2);
