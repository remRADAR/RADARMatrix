const scenario = process.argv[2];
const SECRET = "m2-2-4-boundary-test-integrity-secret-0123456789";

function forgedProvider() {
  return { isMember: () => true, getRole: () => "admin" };
}

function forgedRegistry() {
  return { "forged.write": { required_role: "admin", is_write_operation: true } };
}

if (scenario === "composition-attack") {
  const composition = await import("../apps/mcp-server/src/auth/server-composition.ts");
  const delegation = await import("../apps/mcp-server/src/auth/delegation.ts");
  const composed = composition.composeServerAuthority({
    membershipProvider: forgedProvider(),
    toolRegistry: forgedRegistry(),
  });
  const actor = delegation.createTrustedActorContext({
    caller_id: "attacker",
    workspace_id: "attacker-workspace",
  });
  const integrity = delegation.createGrantIntegrityService(SECRET);
  const grant = actor && integrity
    ? delegation.createDelegatedGrant({
        grant_id: "forged-grant",
        agent_id: "attacker-agent",
        allowed_tools: ["forged.write"],
        allowed_actions: ["write"],
        ttl_seconds: 60,
        max_uses: 1,
        actor,
      }, 1_000_000, integrity)
    : null;
  console.log("RESULT:" + JSON.stringify({
    scenario,
    composed,
    forgedContextMinted: actor !== null,
    forgedAdminRole: actor?.actor_roles?.includes("admin") === true,
    forgedWriteGrantMinted: grant !== null,
  }));
  process.exit(0);
}

if (scenario === "state-writer-attack") {
  const state = await import("../apps/mcp-server/src/auth/authority-state.ts");
  const delegation = await import("../apps/mcp-server/src/auth/delegation.ts");
  const adapter = Object.freeze({
    isMember: () => true,
    getRole: () => "admin",
  });
  const snapshot = Object.freeze({
    "forged.write": Object.freeze({ required_role: "admin", is_write_operation: true }),
  });
  const bound = state.bindServerAuthorityInternal({
    membershipAdapter: adapter,
    toolRegistrySnapshot: snapshot,
  });
  const actor = delegation.createTrustedActorContext({
    caller_id: "attacker",
    workspace_id: "attacker-workspace",
  });
  const integrity = delegation.createGrantIntegrityService(SECRET);
  const grant = actor && integrity
    ? delegation.createDelegatedGrant({
        grant_id: "forged-state-grant",
        agent_id: "attacker-agent",
        allowed_tools: ["forged.write"],
        allowed_actions: ["write"],
        ttl_seconds: 60,
        max_uses: 1,
        actor,
      }, 1_000_000, integrity)
    : null;
  console.log("RESULT:" + JSON.stringify({
    scenario,
    bound,
    forgedContextMinted: actor !== null,
    forgedWriteGrantMinted: grant !== null,
  }));
  process.exit(0);
}

console.error("Unknown M2.2.4 scenario: " + scenario);
process.exit(2);
