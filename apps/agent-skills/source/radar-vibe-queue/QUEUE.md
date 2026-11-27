# Queue workflow

The queue is a **router**, not a requirement to run every prompt in sequence.

## Intake → route → work → verify → hand off

1. **Intake:** restate the requested outcome, expected deliverable, audience, relevant time period, and constraints. Distinguish requested work from ideas mentioned in context.
2. **Route:** choose one primary queue from `queue.json`; add only the supporting modules needed. If unclear but low-risk, state a reasonable assumption; ask only when the ambiguity changes the outcome materially.
3. **Preflight:** inspect source files, repository state, access scopes, and available tools. Confirm source freshness for time-sensitive facts. Do not infer a capability from another platform's documentation.
4. **Work:** follow the chosen module. Keep analysis separate from side effects; record evidence, decisions, and uncertainty.
5. **Verify:** check the relevant artifact, test, source citation, or connector confirmation. Report precisely what is verified and not verified.
6. **Handoff:** give the output, concise provenance, remaining limitations, and next step. Do not mark recommendations as executed.

## Priority rules

- User's explicit requested outcome and limits come first; then platform policy/permissions; then this queue.
- Safety, account integrity, and privacy precede convenience or growth metrics.
- For engineering, preserve working behavior and conventions; for research, prefer primary sources; for RADARMeta, prioritize authentic African-music community and evidence over vanity metrics.
- A module may be used for analysis without enabling execution. Tool availability must be independently verified by the current agent.

## Standard report vocabulary

- **FACT / VERIFIED:** directly established by an observed source, tool, test, or artifact.
- **OBSERVATION:** a descriptive pattern in the available evidence.
- **INFERENCE / HYPOTHESIS:** a reasoned interpretation with support and confidence; not proof.
- **UNKNOWN / NOT VERIFIED:** unavailable or insufficiently tested.
- **RECOMMENDATION:** proposed next step, not performed.
- **ACTION COMPLETED:** only a confirmed action within the user's authorization.
