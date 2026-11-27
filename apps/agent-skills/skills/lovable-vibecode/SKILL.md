---
name: lovable-vibecode
description: Review or modify applications built with Lovable or another prompt-driven AI app builder. Use when builder-specific output, connected services, generated code, or platform settings require verification; treat generated changes as untrusted and use account engineering specialists for general implementation.
---

# Lovable / Vibecode Engineering

Treat AI-generated code as untrusted until inspected and verified.

1. Inspect the app, generated code, backend choice/connection, schema, auth, storage policies, realtime/edge functions, secrets, Git sync, tests, and current security state.
2. State the user outcome and acceptance criteria. Identify the exact layer to change: client/UI, database/schema/policy, server/edge, or external integration.
3. Use authoritative current docs for platform-specific behavior; verify connector and project capabilities rather than assuming them.
4. Preserve working behavior and request the smallest coherent builder change. Review the resulting code/diff, not just the builder's explanation.
5. Check authorization, tenant isolation, secret handling, input validation, event authenticity/idempotency, retries, errors, and regression risks where relevant.
6. Test actual user flows and boundaries. Do not deploy, publish, alter production data, or change permissions without explicit authority.

Report the changed surfaces, builder prompt/action, verification evidence, unresolved risks, and next safe step. A generated response or successful preview compile alone is not proof the feature works.
