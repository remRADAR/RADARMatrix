import assert from 'assert';

console.log('\n[TEST] v0.9 Authentication & Authorization Providers');

const { DevelopmentAuthenticationProvider } = await import('../apps/mcp-server/src/providers/authentication.js');
const { DefaultAuthorizationProvider } = await import('../apps/mcp-server/src/providers/authorization.js');
const { DevelopmentMembershipProvider } = await import('../apps/mcp-server/src/providers/membership.js');

const auth = new DevelopmentAuthenticationProvider();
const authz = new DefaultAuthorizationProvider();
const members = new DevelopmentMembershipProvider({ members: { 'user_1': ['w_1'] } });

// Authentication tests
const req1 = { context: { caller_id: 'admin_123', workspace_id: 'w_1' } };
const p1 = auth.authenticate(req1);
assert(p1 !== null, 'admin should authenticate');
assert.deepStrictEqual(p1.roles.includes('admin'), true, 'admin role present');
console.log('  ✓ authenticate admin');

const req2 = { context: { workspace_id: 'w_1' } };
const p2 = auth.authenticate(req2);
assert.strictEqual(p2, null, 'missing caller_id should not authenticate');
console.log('  ✓ reject missing caller_id');

// Membership
assert.strictEqual(members.isMember('user_1', 'w_1'), true, 'user_1 member of w_1');
assert.strictEqual(members.isMember('user_2', 'w_1'), true, 'development fallback accepts workspace');
console.log('  ✓ membership checks');

// Authorization
const principal = { caller_id: 'contributor_789', roles: ['contributor'], workspace_id: 'w_1' };
const toolRegistry = {
  'radar.remember': { required_role: 'contributor' },
  'radar.record_decision': { required_role: 'editor' },
};

assert.strictEqual(authz.isAuthorized(principal, toolRegistry, 'radar.remember'), true, 'contributor can remember');
assert.strictEqual(authz.isAuthorized(principal, toolRegistry, 'radar.record_decision'), false, 'contributor cannot record decision');
console.log('  ✓ authorization checks');

console.log('\nAll v0.9 provider tests passed');
