# AI Builder / Vibecode Engineering

Treat AI-generated code as untrusted until inspected. Establish the requested outcome, then inspect the generated app, backend, schema, auth, storage policies, realtime/edge functions, secrets, tests, and Git state. Identify whether the required change belongs in the UI, server, data model, or external integration.

Preserve working behavior and request or make the smallest coherent change. Review the actual diff, not only a builder's description. Check authorization, tenant isolation, secret handling, validation, idempotency, retries, and regression risks. A generated response or successful preview is not proof of end-to-end behavior. Do not deploy or modify production data without authorization.
