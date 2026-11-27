# Agent Continuation Queue

**Trigger:** A coding/build task genuinely spans agents or sessions and the next agent needs shared implementation context. Do not create a ledger for ordinary single-agent work or where project/user policy forbids extra files.

## Copy-ready prompt

> Use `skills/agent-continuation/SKILL.md` only if this work needs a real cross-agent/session handoff. First inspect the project’s existing handoff convention and repository policy. Read any existing `HANDOFF.md` and verify its claims against the actual branch, working tree, files, and tests. If a durable ledger is appropriate and allowed, keep current-state sections accurate, distinguish verified facts from claims/proposals/pending approvals, and preserve useful milestones in dated history. Do not create or edit a ledger merely as ceremony, overwrite unrelated work, commit, or deploy unless requested and authorized. At handoff, report completed work, exact verification, remaining unknowns, and the next action.
