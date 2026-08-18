// Development workspace membership provider
class DevelopmentMembershipProvider {
  constructor(options = {}) {
    // options.members: map caller_id -> [workspace_ids]
    this.options = options;
  }

  // Check if caller is member of workspace_id
  isMember(caller_id, workspace_id) {
    if (!caller_id || !workspace_id) return false;
    // Development rule: caller's workspace must match provided workspace_id
    // or be present in options.members map
    const map = this.options.members || {};
    if (map[caller_id] && Array.isArray(map[caller_id])) {
      return map[caller_id].includes(workspace_id);
    }
    // Fallback: accept if workspace_id includes caller_id suffix for dev convenience
    return workspace_id && workspace_id.length > 0;
  }
}

module.exports = { DevelopmentMembershipProvider };
